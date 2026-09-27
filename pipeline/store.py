"""Steps 5 and 8: save articles, the brief, stories and glossary terms to Supabase."""
import os
from datetime import date

from supabase import Client, create_client

from summarise import Brief

CHUNK = 100  # insert rows in batches instead of one request per row


def get_client() -> Client:
    # Service role key: full access, bypasses RLS. Only ever used by the pipeline, never in a browser.
    return create_client(os.environ["SUPABASE_URL"], os.environ["SUPABASE_SERVICE_ROLE_KEY"])


def save_articles(db: Client, articles: list[dict]) -> list[dict]:
    """Upsert on url (unique). Returns the articles with their database id attached."""
    url_to_id = {}
    for i in range(0, len(articles), CHUNK):
        rows = articles[i:i + CHUNK]
        result = db.table("articles").upsert(rows, on_conflict="url").execute()
        url_to_id.update({r["url"]: r["id"] for r in result.data})
    return [{**a, "id": url_to_id[a["url"]]} for a in articles if a["url"] in url_to_id]


def get_brief_id(db: Client, brief_date: date):
    result = db.table("briefs").select("id").eq("brief_date", brief_date.isoformat()).execute()
    return result.data[0]["id"] if result.data else None


def delete_brief(db: Client, brief_id: int) -> None:
    # Glossary terms first introduced by this brief go too, so a re-run can add them back cleanly.
    story_ids = [r["id"] for r in db.table("stories").select("id").eq("brief_id", brief_id).execute().data]
    if story_ids:
        db.table("glossary").delete().in_("first_seen_story_id", story_ids).execute()
    # Cascades to stories, story_entities, story_sources (and takes on those stories).
    db.table("briefs").delete().eq("id", brief_id).execute()


def save_brief(db: Client, brief_date: date, brief: Brief) -> int:
    brief_id = db.table("briefs").insert({"brief_date": brief_date.isoformat()}).execute().data[0]["id"]
    try:
        existing_terms = {r["term"].lower() for r in db.table("glossary").select("term").execute().data}

        # Inserted in Gemini's ranking order, so ascending id = rank within each section.
        for story in brief.stories:
            story_id = db.table("stories").insert({
                "brief_id": brief_id,
                "headline": story.headline,
                "category": story.category,
                "region": story.region,
                "is_top_story": story.is_top_story,
                "importance": story.importance,
                "what_happened": story.what_happened,
                "why_it_matters": story.why_it_matters,
                "concept_term": story.concept.term,
                "interview_question": story.interview_question,
            }).execute().data[0]["id"]

            db.table("story_entities").insert([
                {"story_id": story_id, "entity": e.entity, "impact": e.impact, "reason": e.reason}
                for e in story.who_is_affected
            ]).execute()

            db.table("story_sources").insert([
                {"story_id": story_id, "article_id": int(a)} for a in dict.fromkeys(story.source_article_ids)
            ]).execute()

            term = story.concept.term.strip()
            if term.lower() not in existing_terms:
                db.table("glossary").upsert(
                    {"term": term, "explanation": story.concept.explanation, "first_seen_story_id": story_id},
                    on_conflict="term", ignore_duplicates=True,
                ).execute()
                existing_terms.add(term.lower())
    except Exception:
        # Supabase's REST API has no multi-table transaction, so undo a half-written brief ourselves.
        delete_brief(db, brief_id)
        raise
    return brief_id
