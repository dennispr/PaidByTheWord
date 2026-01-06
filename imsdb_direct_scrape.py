#!/usr/bin/env python3
"""
Direct IMSDb URL scraper - bypasses search, uses direct script URLs
"""

import re
import time
import json
from pathlib import Path
from urllib.parse import urlparse

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm


# -----------------------------
# Config
# -----------------------------
URLS_FILE = Path("imsdb_urls.txt")
BOOKS_DIR = Path("books")
RAW_HTML_DIR = Path("imsdb_raw_html")
REPORT_FILE = Path("imsdb_direct_report.json")

REQUEST_DELAY_SECONDS = 1.2
TIMEOUT = 30

RESUME = True  # skip URLs that already have books/<Title>.txt

# Cleaning toggles (stage directions ON)
REMOVE_SCENE_HEADINGS = True
REMOVE_CHARACTER_CUES = True
REMOVE_PARENTHETICAL_LINES = False

SCENE_HEADING_RE = re.compile(
    r"^(INT\.|EXT\.|INT/EXT\.|INT\.\/EXT\.)\b", re.IGNORECASE
)


# -----------------------------
# Helpers
# -----------------------------
def make_session() -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": "Mozilla/5.0 (compatible; imsdb-direct/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
    })
    return s


def fetch_html(session: requests.Session, url: str) -> str:
    r = session.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def safe_filename(url: str) -> str:
    """Extract a safe filename from the URL"""
    path = urlparse(url).path
    # Extract filename from path like /scripts/Deadpool-%2526-Wolverine.html
    filename = Path(path).stem  # Gets "Deadpool-%2526-Wolverine"
    
    # Clean up URL encoding and special chars
    filename = filename.replace("%2526", "&")  # Fix double-encoded &
    filename = filename.replace("%20", " ")    # Spaces
    filename = re.sub(r"[^\w\s\-&]", "", filename)  # Keep alphanumeric, spaces, hyphens, ampersands
    filename = re.sub(r"\s+", "", filename)    # Remove spaces for filename
    
    return filename[:120] or "Script"


def url_to_title(url: str) -> str:
    """Convert URL to a readable title"""
    path = urlparse(url).path
    filename = Path(path).stem
    
    # Clean up URL encoding
    title = filename.replace("%2526", " & ")
    title = title.replace("%20", " ")
    title = re.sub(r"[^\w\s\-&]", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    
    return title or "Unknown Script"


def read_urls(path: Path) -> list[str]:
    """Read URLs from file, one per line"""
    if not path.exists():
        raise FileNotFoundError(f"URLs file not found: {path}")
    
    urls = []
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line and not line.startswith("#"):  # Skip empty lines and comments
            urls.append(line)
    return urls


def extract_script_text(html: str) -> str:
    """Extract script text from the HTML"""
    soup = BeautifulSoup(html, "html.parser")
    pre = soup.find("pre")
    return pre.get_text("\n", strip=False) if pre else soup.get_text("\n", strip=True)


def clean_script(text: str) -> str:
    """Clean the extracted script text"""
    lines = text.splitlines()
    out = []

    for line in lines:
        if not line.strip():
            continue

        s = line.strip()

        if REMOVE_SCENE_HEADINGS and SCENE_HEADING_RE.match(s):
            continue

        if REMOVE_CHARACTER_CUES and s.isupper() and 3 <= len(s) <= 28:
            continue

        if REMOVE_PARENTHETICAL_LINES and s.startswith("(") and s.endswith(")"):
            continue

        out.append(s)

    return re.sub(r"\s+", " ", " ".join(out)).strip()


def already_scraped(url: str) -> bool:
    """Check if we already have this script"""
    filename = safe_filename(url)
    out_path = BOOKS_DIR / (filename + ".txt")
    return out_path.exists() and out_path.stat().st_size > 0


def process_url(session: requests.Session, url: str) -> dict:
    """Process a single URL and return result info"""
    title = url_to_title(url)
    filename = safe_filename(url)
    
    try:
        # Resume skip
        if RESUME and already_scraped(url):
            return {"status": "skipped", "title": title, "reason": "already exists"}
        
        # Fetch the script page
        print(f"Fetching: {title}")
        script_html = fetch_html(session, url)
        time.sleep(REQUEST_DELAY_SECONDS)
        
        # Save raw HTML
        RAW_HTML_DIR.joinpath(filename + ".html").write_text(
            script_html, encoding="utf-8", errors="ignore"
        )
        
        # Extract and clean script
        cleaned = clean_script(extract_script_text(script_html))
        
        if not cleaned or len(cleaned) < 100:
            return {"status": "failed", "title": title, "reason": "no script content found"}
        
        # Save cleaned text
        (BOOKS_DIR / (filename + ".txt")).write_text(cleaned, encoding="utf-8")
        
        return {"status": "success", "title": title, "url": url, "filename": filename}
        
    except Exception as e:
        return {"status": "failed", "title": title, "url": url, "error": str(e)}


# -----------------------------
# Main
# -----------------------------
def main() -> None:
    # Create directories
    BOOKS_DIR.mkdir(exist_ok=True)
    RAW_HTML_DIR.mkdir(exist_ok=True)
    
    # Read URLs
    try:
        urls = read_urls(URLS_FILE)
    except FileNotFoundError:
        print(f"Please create {URLS_FILE} with one IMSDb URL per line.")
        print("Example content:")
        print("https://imsdb.com/scripts/Deadpool-%2526-Wolverine.html")
        print("https://imsdb.com/scripts/Avatar.html")
        return
    
    if not urls:
        print(f"No URLs found in {URLS_FILE}")
        return
    
    print(f"Processing {len(urls)} URLs from {URLS_FILE}")
    
    session = make_session()
    report = {
        "processed": [],
        "skipped_existing": [],
        "failed": [],
        "total_urls": len(urls),
        "resume": RESUME,
    }
    
    # Process each URL
    for url in tqdm(urls, desc="Scraping IMSDb URLs"):
        result = process_url(session, url)
        
        if result["status"] == "success":
            report["processed"].append(result)
        elif result["status"] == "skipped":
            report["skipped_existing"].append(result)
        else:  # failed
            report["failed"].append(result)
    
    # Write report
    REPORT_FILE.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )
    
    # Summary
    print(f"\nDone!")
    print(f"Processed: {len(report['processed'])}")
    print(f"Skipped existing: {len(report['skipped_existing'])}")
    print(f"Failed: {len(report['failed'])}")
    print(f"Report written to {REPORT_FILE}")
    
    if report["failed"]:
        print(f"\nFailed URLs:")
        for item in report["failed"]:
            print(f"  {item.get('url', 'Unknown')}: {item.get('error', item.get('reason', 'Unknown error'))}")


if __name__ == "__main__":
    main()