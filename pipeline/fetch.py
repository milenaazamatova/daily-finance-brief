"""Step 1-2: fetch articles from RSS feeds and Finnhub, normalise into one format."""
import calendar
import html
import os
import re
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path

import feedparser
import requests
import yaml

FEEDS_FILE = Path(__file__).parent / "feeds.yaml"
EXCERPT_CHARS = 300  # copyright rule: short excerpt only, never full text
MIN_TITLE_WORDS = 3  # real headlines have several words
HEADERS = {
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126 Safari/537.36 DailyFinanceBrief/1.0",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


def clean_text(raw: str) -> str:
    """Strip HTML tags/entities and collapse whitespace."""
    text = re.sub(r"<[^>]+>", " ", raw or "")
    text = html.unescape(text)
    return re.sub(r"\s+", " ", text).strip()


def make_excerpt(raw: str) -> str:
    text = clean_text(raw)
    if len(text) <= EXCERPT_CHARS:
        return text
    return text[:EXCERPT_CHARS].rsplit(" ", 1)[0] + "…"


def load_config() -> dict:
    with open(FEEDS_FILE) as f:
        return yaml.safe_load(f)


def fetch_rss_feed(feed: dict, since: datetime, skip_titles: list[re.Pattern]) -> list[dict]:
    resp = requests.get(feed["url"], headers=HEADERS, timeout=20)
    resp.raise_for_status()
    parsed = feedparser.parse(resp.content)
    is_google_news = "news.google.com" in feed["url"]

    articles = []
    for entry in parsed.entries:
        when = entry.get("published_parsed") or entry.get("updated_parsed")
        if not when or not entry.get("link") or not entry.get("title"):
            continue  # without a date we can't tell if it's from the last 24h
        published_at = datetime.fromtimestamp(calendar.timegm(when), tz=timezone.utc)
        if published_at < since:
            continue

        title = clean_text(entry.title)
        excerpt = make_excerpt(entry.get("summary", ""))
        if is_google_news:
            # Google News titles end in " - Publisher" and the summary just repeats the title.
            title = title.rsplit(" - ", 1)[0]
            excerpt = ""
        if len(title.split()) < MIN_TITLE_WORDS or any(p.search(title) for p in skip_titles):
            continue  # e.g. Reuters stock-quote pages ("PTBA.D", "... | Stock Price & Latest News")

        articles.append({
            "title": title,
            "source": feed["name"],
            "url": entry.link.strip(),
            "published_at": published_at.isoformat(),
            "excerpt": excerpt,
        })
    return articles


def fetch_finnhub(category: str, since: datetime) -> list[dict]:
    api_key = os.environ.get("FINNHUB_API_KEY")
    if not api_key:
        return []
    resp = requests.get(
        "https://finnhub.io/api/v1/news",
        params={"category": category},
        headers={"X-Finnhub-Token": api_key},  # key in a header, not the URL, so it never shows up in logs
        timeout=20,
    )
    resp.raise_for_status()

    articles = []
    for item in resp.json():
        published_at = datetime.fromtimestamp(item.get("datetime", 0), tz=timezone.utc)
        if published_at < since or not item.get("url") or not item.get("headline"):
            continue
        articles.append({
            "title": clean_text(item["headline"]),
            "source": f"{item.get('source') or 'Unknown'} (via Finnhub)",
            "url": item["url"].strip(),
            "published_at": published_at.isoformat(),
            "excerpt": make_excerpt(item.get("summary", "")),
        })
    return articles


def fetch_all(hours: int = 24) -> tuple[list[dict], list[str]]:
    """Return (articles, report_lines). One failing source never stops the others."""
    config = load_config()
    since = datetime.now(timezone.utc) - timedelta(hours=hours)
    feeds = [f for f in config.get("rss", []) if f.get("enabled", True)]
    skip_titles = [re.compile(p) for p in config.get("skip_titles", [])]

    articles, report = [], []

    def run(feed):
        try:
            return feed["name"], fetch_rss_feed(feed, since, skip_titles), None
        except Exception as e:
            return feed["name"], [], f"{type(e).__name__}: {e}"

    # Fetch feeds in parallel: ~45 feeds take a few seconds instead of a minute.
    with ThreadPoolExecutor(max_workers=8) as pool:
        for name, items, error in pool.map(run, feeds):
            articles.extend(items)
            report.append(f"{name}: {'FAILED ' + error if error else len(items)}")

    finnhub_cfg = config.get("finnhub", {})
    if finnhub_cfg.get("enabled"):
        for category in finnhub_cfg.get("categories", ["general"]):
            try:
                items = fetch_finnhub(category, since)
                articles.extend(items)
                report.append(f"Finnhub ({category}): {len(items)}")
            except Exception as e:
                report.append(f"Finnhub ({category}): FAILED {type(e).__name__}")

    return articles, report
