"""Steps 6-7: send the relevant articles to Gemini in ONE call, validate the JSON, retry once.

The brief has two parts, chosen in the same call:
  - Top Stories: the 5-7 most important stories worldwide, ranked purely by global market impact.
  - Regional sections (uae, us, china, russia, global): the 2-4 most important REMAINING stories each.
"""
import json
from typing import Literal

from pydantic import BaseModel, Field, ValidationError

from llm import RELEVANCE_RULES, call_gemini, get_client, json_config

MAX_ARTICLES = 500  # keeps the single request well inside free-tier token limits
MAX_TOP_STORIES = 7
MAX_PER_REGION = 4

Category = Literal["rates_macro", "markets", "earnings", "deals_ipos", "banking", "oil_energy", "companies", "other"]
Region = Literal["uae", "us", "china", "russia", "global"]
REGIONS = ["uae", "us", "china", "russia", "global"]


# These classes ARE the output schema from the project brief. Pydantic uses them to
# (1) tell Gemini the exact JSON shape and (2) check Gemini's answer afterwards.
class AffectedEntity(BaseModel):
    entity: str
    impact: Literal["positive", "negative", "mixed"]
    reason: str


class Concept(BaseModel):
    term: str
    explanation: str


class Story(BaseModel):
    headline: str
    category: Category
    region: Region
    is_top_story: bool
    importance: int = Field(ge=1, le=5)
    what_happened: str
    why_it_matters: str
    who_is_affected: list[AffectedEntity] = Field(min_length=1)
    concept: Concept
    interview_question: str
    source_article_ids: list[str] = Field(min_length=1)


class Brief(BaseModel):
    # No size limit here: Gemini rejects "too complex" schemas (400 INVALID_ARGUMENT) when a large
    # maxItems is combined with this many fields. The 7 / 4-per-region caps are applied by enforce_limits().
    stories: list[Story]


PROMPT = """You are preparing a daily finance news brief for an accounting student in Dubai who is
preparing for finance job interviews (e.g. investment banks like JP Morgan).
Coverage is GLOBAL: all key news regardless of region. No region is weighted above another.

The brief has two parts. Choose them in this order:

1. TOP STORIES (is_top_story = true): the 5-7 most important finance and market stories in the world
   today, from any region, ranked purely by global market impact.
2. REGIONAL SECTIONS (is_top_story = false): for each region (uae, us, china, russia, global), the 2-4
   most important REMAINING stories for that region. Never repeat a Top Story here. A section can be
   short or empty on a quiet day; never fill it with weak stories.

Region: every story (Top Stories included) gets exactly one region: the country it is mainly about
("uae", "us", "china", "russia"), or "global" if it isn't mainly about one of those four
(e.g. Europe, Japan, India, OPEC, emerging markets).

Priority topics everywhere: interest rates and central banks, markets, the economy, earnings,
M&A and IPOs, banking, and oil and energy.
If several articles cover the same event, combine them into ONE story and list all their ids.
Some articles may be in other languages (e.g. Russian central bank releases); always write in English.

{rules}

For each story provide: headline, category, region, is_top_story, importance (1-5, 5 = most important),
what_happened (2-3 sentences), why_it_matters (2-3 sentences), who_is_affected,
concept (one finance concept from the story explained in plain language for a student),
interview_question (a question an interviewer might ask about this story),
source_article_ids (the ids of the articles you used).

Rules:
- Apply the INCLUDE/EXCLUDE rules above again. Never select a story from the EXCLUDE list, even on
  a slow news day; return fewer stories instead.
- Use ONLY information in the provided articles. Never invent numbers, quotes or facts.
  If an excerpt is thin, keep the summary general rather than guessing details.
- Sentiment is per affected entity, not per article (a rate cut can help property developers
  and hurt bank margins in the same story).
- In why_it_matters, explain the global market impact. Mention links between regions only where
  they are genuine (e.g. the dirham is pegged to the US dollar, so UAE rates generally follow Fed
  decisions); don't force them.
- Write in your own words; do not copy sentences from the articles.
- List Top Stories first, most important first; then each region's stories, most important first.

ARTICLES (JSON):
{articles}
"""


def build_prompt(articles: list[dict]) -> str:
    compact = [
        {"id": str(a["id"]), "source": a["source"], "title": a["title"],
         "published_at": a["published_at"], "excerpt": a["excerpt"]}
        for a in articles
    ]
    return PROMPT.format(rules=RELEVANCE_RULES, articles=json.dumps(compact, ensure_ascii=False))


def enforce_limits(stories: list[Story]) -> tuple[list[Story], list[str]]:
    """Keep Gemini's order (its ranking) but cap Top Stories at 7 and each region at 4,
    and drop regional stories that just repeat a Top Story. Returns (stories, notes)."""
    notes, kept, per_region = [], [], {r: 0 for r in REGIONS}
    top = [s for s in stories if s.is_top_story]
    if len(top) > MAX_TOP_STORIES:
        notes.append(f"trimmed Top Stories from {len(top)} to {MAX_TOP_STORIES}")
    top = top[:MAX_TOP_STORIES]
    top_sources = [set(s.source_article_ids) for s in top]
    kept.extend(top)

    for s in stories:
        if s.is_top_story:
            continue
        if set(s.source_article_ids) in top_sources:
            notes.append(f"dropped regional repeat of a Top Story: {s.headline}")
            continue
        if per_region[s.region] >= MAX_PER_REGION:
            notes.append(f"trimmed extra {s.region} story: {s.headline}")
            continue
        per_region[s.region] += 1
        kept.append(s)
    return kept, notes


def generate_brief(articles: list[dict]) -> tuple[Brief, list[str]]:
    articles = articles[:MAX_ARTICLES]  # newest first, so the oldest are dropped if over the cap
    client = get_client()
    prompt = build_prompt(articles)
    config = json_config(Brief, temperature=0.3)  # low = more factual, less creative

    valid_ids = {str(a["id"]) for a in articles}
    last_error = None
    for attempt in (1, 2):  # first try + one retry, as the brief requires
        response = call_gemini(client, prompt, config)
        try:
            brief = Brief.model_validate_json(response.text)
        except (ValidationError, ValueError, TypeError) as e:
            last_error = e
            print(f"  ! Gemini output invalid on attempt {attempt}: {str(e)[:200]}")
            continue

        # Guard against invented sources: drop ids that weren't in the batch,
        # and any story left with no real source.
        for story in brief.stories:
            story.source_article_ids = [i for i in story.source_article_ids if i in valid_ids]
        returned = len(brief.stories)
        brief.stories = [s for s in brief.stories if s.source_article_ids]
        if returned == 0 or brief.stories:
            brief.stories, notes = enforce_limits(brief.stories)
            return brief, notes
        last_error = ValueError("every story cited article ids that weren't in the batch")
        print(f"  ! Attempt {attempt}: {last_error}")

    raise RuntimeError(f"Gemini did not return a valid brief after 2 attempts: {last_error}")
