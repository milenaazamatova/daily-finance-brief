"""Step 3: remove duplicates (same URL, or near-identical headlines across outlets)."""
import re
from difflib import SequenceMatcher
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

HEADLINE_SIMILARITY = 0.85  # 0-1; higher = only remove very close matches


def normalise_url(url: str) -> str:
    """Same article often appears with tracking params (utm_*) or a trailing slash."""
    parts = urlsplit(url.strip())
    query = [(k, v) for k, v in parse_qsl(parts.query) if not k.lower().startswith(("utm_", "cmpid", "ref"))]
    path = parts.path.rstrip("/") or "/"
    return urlunsplit((parts.scheme.lower(), parts.netloc.lower(), path, urlencode(query), ""))


def normalise_headline(title: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", title.lower()).strip()


def dedupe(articles: list[dict]) -> list[dict]:
    # Prefer articles with an excerpt, so the kept copy gives Gemini more context.
    ordered = sorted(articles, key=lambda a: len(a["excerpt"]), reverse=True)

    kept, seen_urls, kept_headlines = [], set(), []
    for article in ordered:
        url = normalise_url(article["url"])
        if url in seen_urls:
            continue
        headline = normalise_headline(article["title"])
        if any(SequenceMatcher(None, headline, h).ratio() >= HEADLINE_SIMILARITY for h in kept_headlines):
            continue
        article["url"] = url
        seen_urls.add(url)
        kept_headlines.append(headline)
        kept.append(article)

    return sorted(kept, key=lambda a: a["published_at"], reverse=True)
