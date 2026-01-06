from __future__ import annotations

import re
import time
import json
from pathlib import Path
from urllib.parse import urljoin, urlparse, quote_plus

import requests
from bs4 import BeautifulSoup
from tqdm import tqdm


# -----------------------------
# Config
# -----------------------------
BASE = "https://imsdb.com/"
SEARCH_URL = "https://imsdb.com/search.php?search_query="

SEED_FILE = Path("test_titles.txt") #"seed_titles.txt")
BOOKS_DIR = Path("books")
RAW_HTML_DIR = Path("imsdb_raw_html")
REPORT_FILE = Path("imsdb_seed_report.json")

REQUEST_DELAY_SECONDS = 1.2
TIMEOUT = 30

MAX_TITLES = 25          # set to None for unlimited
START_INDEX = 0          # optional: begin at Nth seed entry
RESUME = True            # skip titles that already have books/<Title>.txt

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
        "User-Agent": "Mozilla/5.0 (compatible; imsdb-seeded/1.0)",
        "Accept-Language": "en-US,en;q=0.9",
    })
    return s


def fetch_html(session: requests.Session, url: str) -> str:
    r = session.get(url, timeout=TIMEOUT)
    r.raise_for_status()
    return r.text


def safe_filename(title: str) -> str:
    # Must match the naming used for output .txt files so resume works.
    title = re.sub(r"[^\w\s\-]", "", title)
    title = re.sub(r"\s+", " ", title).strip()
    return title.replace(" ", "")[:120] or "Script"


def is_same_domain(url: str, domain: str) -> bool:
    return urlparse(url).netloc.endswith(domain)


def read_seed_titles(path: Path) -> list[str]:
    if not path.exists():
        raise FileNotFoundError(f"Seed file not found: {path}")
    return [
        line.strip()
        for line in path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def normalize_for_match(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", s.lower())


def find_landing_page_for_title(session: requests.Session, title: str) -> str | None:
    q = quote_plus(title)
    html = fetch_html(session, SEARCH_URL + q)
    soup = BeautifulSoup(html, "lxml")

    candidates = []
    for a in soup.select('a[href*="Movie Scripts/"][href$=" Script.html"]'):
        href = a.get("href", "").strip()
        if not href:
            continue
        text = a.get_text(" ", strip=True)
        full = urljoin(BASE, href)
        candidates.append((text, full))

    if not candidates:
        return None

    want = normalize_for_match(title)
    print(f"DEBUG: Searching for '{title}' -> normalized: '{want}'")

    def score(item):
        have = normalize_for_match(item[0])
        scores = (
            have == want,
            want in have,
            have in want,
            -abs(len(have) - len(want)),
        )
        print(f"DEBUG: '{item[0]}' -> '{have}' scores: {scores}")
        return scores

    candidates.sort(key=score, reverse=True)
    print(f"DEBUG: Best match: '{candidates[0][0]}' -> {candidates[0][1]}")
    return candidates[0][1]


def find_script_url(landing_html: str) -> str | None:
    soup = BeautifulSoup(landing_html, "lxml")
    for a in soup.select('a[href^="/scripts/"]'):
        href = a.get("href", "")
        if href.lower().endswith(".html"):
            return urljoin(BASE, href)
    return None


def extract_script_text(html: str) -> str:
    soup = BeautifulSoup(html, "lxml")
    pre = soup.find("pre")
    return pre.get_text("\n", strip=False) if pre else soup.get_text("\n", strip=True)


def clean_script(text: str) -> str:
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


def already_scraped_html(title: str) -> bool:
    """
    Check if we already have the raw HTML for this title
    """
    filename = safe_filename(title)
    html_path = RAW_HTML_DIR / (filename + ".html")
    return html_path.exists() and html_path.stat().st_size > 0


def already_scraped(title: str) -> bool:
    """
    Resume logic: if the cleaned output exists, we consider it done.
    """
    out_path = BOOKS_DIR / (safe_filename(title) + ".txt")
    return out_path.exists() and out_path.stat().st_size > 0


# -----------------------------
# Main
# -----------------------------
def main() -> None:
    BOOKS_DIR.mkdir(exist_ok=True)
    RAW_HTML_DIR.mkdir(exist_ok=True)

    session = make_session()
    all_titles = read_seed_titles(SEED_FILE)

    # apply start index
    titles = all_titles[START_INDEX:]

    # optional hard limit (after start index)
    if MAX_TITLES is not None:
        titles = titles[:MAX_TITLES]

    report = {
        "max_titles": MAX_TITLES,
        "start_index": START_INDEX,
        "resume": RESUME,
        "processed": [],
        "skipped_existing": [],
        "missed": [],
        "failed": [],
        "seed_total": len(all_titles),
        "attempted_this_run": len(titles),
    }

    print(f"Seed titles total: {len(all_titles)}")
    print(f"Attempting this run: {len(titles)} (START_INDEX={START_INDEX}, MAX_TITLES={MAX_TITLES}, RESUME={RESUME})")

    for title in tqdm(titles, desc="Scraping IMSDb (seeded)"):
        # Resume skip
        if RESUME and already_scraped(title):
            report["skipped_existing"].append(title)
            continue

        filename = safe_filename(title)
        html_path = RAW_HTML_DIR / (filename + ".html")
        
        try:
            # Check if we already have the HTML file
            if already_scraped_html(title):
                print(f"Using existing HTML for: {title}")
                script_html = html_path.read_text(encoding="utf-8", errors="ignore")
                
                # Skip to processing the existing HTML
                cleaned = clean_script(extract_script_text(script_html))
                (BOOKS_DIR / (filename + ".txt")).write_text(cleaned, encoding="utf-8")

                report["processed"].append({
                    "seed": title,
                    "matched": "existing HTML file"
                })
                continue
            
            # Original download process if HTML doesn't exist
            landing_url = find_landing_page_for_title(session, title)
            time.sleep(REQUEST_DELAY_SECONDS)

            if not landing_url:
                report["missed"].append({"title": title, "reason": "No IMSDb search match"})
                continue

            landing_html = fetch_html(session, landing_url)
            time.sleep(REQUEST_DELAY_SECONDS)

            script_url = find_script_url(landing_html)
            if not script_url or not is_same_domain(script_url, "imsdb.com"):
                report["missed"].append({"title": title, "reason": "No /scripts/*.html link"})
                continue

            script_html = fetch_html(session, script_url)
            time.sleep(REQUEST_DELAY_SECONDS)

            html_path.write_text(
                script_html, encoding="utf-8", errors="ignore"
            )

            cleaned = clean_script(extract_script_text(script_html))
            (BOOKS_DIR / (filename + ".txt")).write_text(cleaned, encoding="utf-8")

            report["processed"].append({
                "seed": title,
                "matched": landing_url
            })

        except Exception as e:
            report["failed"].append({
                "title": title,
                "error": str(e)
            })

    REPORT_FILE.write_text(
        json.dumps(report, indent=2, ensure_ascii=False),
        encoding="utf-8"
    )

    print("\nDone.")
    print(f"Processed: {len(report['processed'])}")
    print(f"Skipped existing: {len(report['skipped_existing'])}")
    print(f"Missed: {len(report['missed'])}")
    print(f"Failed: {len(report['failed'])}")
    print(f"Report written to {REPORT_FILE}")


if __name__ == "__main__":
    main()
