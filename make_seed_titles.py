from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import List, Dict, Tuple

import requests
from bs4 import BeautifulSoup

OUT_TXT = Path("seed_titles.txt")
OUT_DEBUG = Path("seed_titles_debug.json")

BOXOFFICEMOJO_WW = "https://www.boxofficemojo.com/chart/ww_top_lifetime_gross/"  # worldwide lifetime gross
IMDB_TOP = "https://www.imdb.com/chart/top/"  # IMDb Top 250
WIKI_HIGHEST_GROSSING = "https://en.wikipedia.org/wiki/List_of_highest-grossing_films"

DEFAULT_HEADERS = {
    "User-Agent": "Mozilla/5.0 (compatible; seed-titles/1.0; +local-analysis)",
    "Accept-Language": "en-US,en;q=0.9",
}

# --- tweak these ---
TOP_N_BOXOFFICE = 150
TOP_N_IMDB = 150

def normalize_title(t: str) -> str:
    t = t.strip()

    # remove year in parentheses like "Alien (1979)"
    t = re.sub(r"\s*\(\d{4}\)\s*$", "", t)

    # normalize apostrophes/quotes (optional)
    t = t.replace("’", "'").replace("“", '"').replace("”", '"')

    # collapse whitespace
    t = re.sub(r"\s+", " ", t).strip()
    return t

def fetch_html(url: str) -> str:
    r = requests.get(url, headers=DEFAULT_HEADERS, timeout=30)
    r.raise_for_status()
    return r.text

def scrape_boxofficemojo_worldwide(limit: int) -> List[str]:
    """
    Parses Box Office Mojo's worldwide lifetime gross chart.
    """
    html = fetch_html(BOXOFFICEMOJO_WW)
    soup = BeautifulSoup(html, "lxml")

    # BOM uses a table; titles are usually in <a> links within rows
    # We'll look for rows that contain a rank + title.
    titles = []
    # Newer BOM layouts often use "a[href^='/title/']" in the chart.
    for a in soup.select("table a[href^='/title/']"):
        txt = a.get_text(" ", strip=True)
        if not txt:
            continue
        titles.append(normalize_title(txt))
        if len(titles) >= limit:
            break

    if len(titles) < min(20, limit):
        raise RuntimeError("Box Office Mojo parsing returned too few titles (layout changed or blocked).")

    return titles

def scrape_imdb_top(limit: int) -> List[str]:
    """
    Parses IMDb Top 250.
    """
    html = fetch_html(IMDB_TOP)
    soup = BeautifulSoup(html, "lxml")

    titles = []

    # IMDb page structure shifts; these selectors aim for the visible title text.
    # Try multiple strategies:
    # 1) Look for list items in the chart with a title link.
    for a in soup.select("a.ipc-title-link-wrapper"):
        txt = a.get_text(" ", strip=True)
        # Titles often look like "1. The Shawshank Redemption"
        txt = re.sub(r"^\d+\.\s*", "", txt).strip()
        if txt:
            titles.append(normalize_title(txt))
        if len(titles) >= limit:
            break

    # Fallback selector (older layout)
    if len(titles) < min(20, limit):
        titles = []
        for td in soup.select("td.titleColumn a"):
            txt = td.get_text(" ", strip=True)
            if txt:
                titles.append(normalize_title(txt))
            if len(titles) >= limit:
                break

    if len(titles) < min(20, limit):
        raise RuntimeError("IMDb parsing returned too few titles (layout changed or blocked).")

    return titles

def scrape_wikipedia_highest_grossing(limit: int) -> List[str]:
    """
    Fallback: Wikipedia highest-grossing films table (top 'limit').
    """
    html = fetch_html(WIKI_HIGHEST_GROSSING)
    soup = BeautifulSoup(html, "lxml")

    titles = []

    # The top table is typically a wikitable with titles linked.
    # We'll grab the first table row titles.
    table = soup.select_one("table.wikitable")
    if not table:
        raise RuntimeError("Wikipedia table not found.")

    for row in table.select("tr")[1:]:
        cells = row.select("td")
        if len(cells) < 2:
            continue
        # Title is often in the 2nd cell
        title_cell = cells[1]
        a = title_cell.find("a")
        if a and a.get_text(strip=True):
            titles.append(normalize_title(a.get_text(" ", strip=True)))
        if len(titles) >= limit:
            break

    if len(titles) < min(10, limit):
        raise RuntimeError("Wikipedia parsing returned too few titles.")

    return titles

def merge_seeds(primary: List[str], secondary: List[str]) -> Tuple[List[str], Dict[str, str]]:
    seen = set()
    merged = []
    source = {}

    for t in primary:
        if t not in seen:
            seen.add(t)
            merged.append(t)
            source[t] = "boxofficemojo"

    for t in secondary:
        if t not in seen:
            seen.add(t)
            merged.append(t)
            source[t] = "imdb"

    return merged, source

def main() -> None:
    debug = {"boxofficemojo": [], "imdb": [], "wikipedia_fallback": [], "final": []}

    # 1) Box Office Mojo worldwide
    try:
        bom = scrape_boxofficemojo_worldwide(TOP_N_BOXOFFICE)
        debug["boxofficemojo"] = bom
    except Exception as e:
        print(f"[warn] BoxOfficeMojo failed: {e}")
        bom = []
        # fallback to Wikipedia for the same “popular” feel
        wiki = scrape_wikipedia_highest_grossing(TOP_N_BOXOFFICE)
        debug["wikipedia_fallback"] = wiki
        bom = wiki

    # 2) IMDb Top 250
    try:
        imdb = scrape_imdb_top(TOP_N_IMDB)
        debug["imdb"] = imdb
    except Exception as e:
        print(f"[warn] IMDb failed: {e}")
        imdb = []

    final, source_map = merge_seeds(bom, imdb)
    debug["final"] = [{"title": t, "source": source_map.get(t, "unknown")} for t in final]

    OUT_TXT.write_text("\n".join(final) + "\n", encoding="utf-8")
    OUT_DEBUG.write_text(json.dumps(debug, indent=2, ensure_ascii=False), encoding="utf-8")

    print(f"✅ Wrote {len(final)} titles to {OUT_TXT}")
    print(f"ℹ️ Debug info: {OUT_DEBUG}")

if __name__ == "__main__":
    main()
