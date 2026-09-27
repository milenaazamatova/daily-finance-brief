"""Daily Finance Brief pipeline:
fetch -> dedupe -> relevance filter -> store articles -> Gemini brief -> store brief -> log.

Usage (from the pipeline folder):
    .venv/bin/python main.py             # full run
    .venv/bin/python main.py --dry-run   # fetch + dedupe only (no keys needed, nothing saved)
    .venv/bin/python main.py --force     # replace today's brief if it already exists
"""
import argparse
import os
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from dotenv import load_dotenv

from dedupe import dedupe
from fetch import fetch_all

ROOT = Path(__file__).resolve().parent.parent
REQUIRED_VARS = ["GEMINI_API_KEY", "GEMINI_MODEL", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]
SECRET_VARS = ["GEMINI_API_KEY", "FINNHUB_API_KEY", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"]


def redact(text: str) -> str:
    """Logs are committed to a public repo, so mask any secret value that might appear in an error."""
    for name in SECRET_VARS:
        value = os.environ.get(name)
        if value:
            text = text.replace(value, "***")
    return text


def write_log(brief_date, lines: list[str]) -> Path:
    log_dir = ROOT / "logs"
    log_dir.mkdir(exist_ok=True)
    path = log_dir / f"{brief_date.isoformat()}.txt"
    path.write_text("\n".join(lines) + "\n")
    return path


def format_sections(stories) -> list[str]:
    """Top Stories first, then each regional section (stories are already in rank order)."""
    lines = ["", "TOP STORIES"]
    lines += [f"  [{s.importance}] {s.region.upper():6} {s.category}: {s.headline}" for s in stories if s.is_top_story]
    for region, label in [("uae", "UAE"), ("us", "US"), ("china", "CHINA"), ("russia", "RUSSIA"), ("global", "GLOBAL")]:
        items = [s for s in stories if s.region == region and not s.is_top_story]
        lines.append(f"{label} ({len(items)})")
        lines += [f"  [{s.importance}] {s.category}: {s.headline}" for s in items]
    return lines


def main() -> int:
    sys.stdout.reconfigure(line_buffering=True)  # show progress live, even when output is piped or logged
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="fetch and dedupe only")
    parser.add_argument("--force", action="store_true", help="replace today's brief if it exists")
    args = parser.parse_args()

    load_dotenv(Path(__file__).parent / ".env")  # locally; in GitHub Actions the vars come from Secrets
    brief_date = datetime.now(ZoneInfo("Asia/Dubai")).date()  # the brief is for a Dubai morning
    log = [f"Daily Finance Brief run {datetime.now(ZoneInfo('Asia/Dubai')):%Y-%m-%d %H:%M} Dubai"]

    if not args.dry_run:
        missing = [v for v in REQUIRED_VARS if not os.environ.get(v)]
        if missing:
            print(f"Missing values in pipeline/.env: {', '.join(missing)}")
            return 1

    try:
        return run(args, brief_date, log)
    except Exception as e:
        # Still write the day's log, so a failed run is visible in the repo, not just in the Actions page.
        log.append(f"\nFAILED: {type(e).__name__}: {redact(str(e))[:500]}")
        if not args.dry_run:
            write_log(brief_date, log)
        raise


def run(args, brief_date, log: list[str]) -> int:
    print("1-2. Fetching and normalising articles from the last 24 hours…")
    articles, report = fetch_all(hours=24)
    for line in report:
        print(f"   {line}")
    log += ["", "Sources:"] + [f"  {line}" for line in report]

    print("3. Removing duplicates…")
    unique = dedupe(articles)
    print(f"   {len(articles)} fetched -> {len(unique)} unique")
    log.append(f"\nArticles: {len(articles)} fetched, {len(unique)} after dedupe")

    if args.dry_run:
        for a in unique[:10]:
            print(f"   - [{a['source']}] {a['title']}")
        print("Dry run: nothing sent to Gemini or saved.")
        return 0

    # Imported here so --dry-run works before the Supabase/Gemini keys are filled in.
    from relevance import filter_relevant
    from store import delete_brief, get_brief_id, get_client, save_articles, save_brief
    from summarise import generate_brief

    db = get_client()
    existing = get_brief_id(db, brief_date)
    if existing and not args.force:
        print(f"A brief for {brief_date} already exists. Use --force to replace it.")
        return 0

    print("4. Relevance filter: asking Gemini which articles are about finance and markets…")
    relevant, stats = filter_relevant(unique)
    print(f"   kept {stats['kept']}, dropped {stats['dropped']}"
          + (f", unclassified {stats['unclassified']} (dropped)" if stats["unclassified"] else ""))
    for example in stats["dropped_examples"]:
        print(f"   x {example}")
    log.append(f"Relevance filter: {stats['kept']} kept, {stats['dropped']} dropped"
               + (f", {stats['unclassified']} unclassified (dropped)" if stats["unclassified"] else ""))

    if not relevant:
        print("No relevant articles today, so no brief was created.")
        log.append("No relevant articles: no brief created")
        write_log(brief_date, log)
        return 0

    print("5. Saving relevant articles to Supabase…")
    saved = save_articles(db, relevant)
    print(f"   {len(saved)} articles saved")

    print(f"6-7. Asking Gemini ({os.environ['GEMINI_MODEL']}) to pick Top Stories and regional sections…")
    brief, notes = generate_brief(saved)
    print(f"   {len(brief.stories)} stories returned and validated")
    for note in notes:
        print(f"   ~ {note}")

    if existing:
        delete_brief(db, existing)
    if not brief.stories:
        print("Gemini found no story worth including today, so no brief was created.")
        log.append("0 stories selected: no brief created")
        write_log(brief_date, log)
        return 0

    print("8. Saving the brief, stories and glossary terms…")
    brief_id = save_brief(db, brief_date, brief)
    print(f"   Brief {brief_date} saved (id {brief_id})")

    sections = format_sections(brief.stories)
    log.append(f"Brief {brief_date}: {len(brief.stories)} stories")
    log += [f"  {line}" for line in notes] + sections
    path = write_log(brief_date, log)
    print(f"9. Log written to {path.relative_to(ROOT)}")

    print("\nToday's brief:")
    for line in sections:
        print(line)
    return 0


if __name__ == "__main__":
    sys.exit(main())
