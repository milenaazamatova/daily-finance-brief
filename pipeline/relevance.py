"""Step 4: relevance filter. ONE batched Gemini call classifies every article as relevant or not."""
import json

from pydantic import BaseModel, ValidationError

from llm import RELEVANCE_RULES, call_gemini, get_client, json_config


class Verdict(BaseModel):
    id: str
    relevant: bool


class Classification(BaseModel):
    results: list[Verdict]


PROMPT = """You are filtering a news feed for someone who follows the finance and investment world.
Classify EVERY article below as relevant (true) or not relevant (false) using these rules.
Judge by the headline and excerpt only. When an article is borderline, ask: does it clearly
affect markets, the economy, companies or investing? If not, mark it false.

{rules}

Return one result per article, using the article's id exactly as given.

ARTICLES (JSON):
{articles}
"""


def filter_relevant(articles: list[dict]) -> tuple[list[dict], dict]:
    """Return (relevant_articles, stats). Articles Gemini fails to classify are dropped, not kept."""
    # Articles have no database id yet (only relevant ones get saved), so use their list position.
    compact = [{"id": str(i), "source": a["source"], "title": a["title"], "excerpt": a["excerpt"]}
               for i, a in enumerate(articles)]
    prompt = PROMPT.format(rules=RELEVANCE_RULES, articles=json.dumps(compact, ensure_ascii=False))
    client = get_client()
    config = json_config(Classification, temperature=0)  # 0 = most consistent yes/no decisions

    verdicts, last_error = None, None
    for attempt in (1, 2):  # first try + one retry if the JSON is invalid
        response = call_gemini(client, prompt, config)
        try:
            verdicts = {v.id: v.relevant for v in Classification.model_validate_json(response.text).results}
            break
        except (ValidationError, ValueError, TypeError) as e:
            last_error = e
            print(f"  ! Relevance output invalid on attempt {attempt}: {str(e)[:200]}")
    if verdicts is None:
        raise RuntimeError(f"Relevance filter failed after 2 attempts: {last_error}")

    relevant = [a for i, a in enumerate(articles) if verdicts.get(str(i)) is True]
    dropped = [a for i, a in enumerate(articles) if verdicts.get(str(i)) is False]
    stats = {
        "kept": len(relevant),
        "dropped": len(dropped),
        "unclassified": len(articles) - len(relevant) - len(dropped),  # treated as dropped
        "dropped_examples": [f"[{a['source']}] {a['title']}" for a in dropped[:8]],
    }
    return relevant, stats
