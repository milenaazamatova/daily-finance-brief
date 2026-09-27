"""Shared Gemini helpers: client, retry/fallback on busy servers, and the relevance rules."""
import os
import time

import httpx
from google import genai
from google.genai import errors, types

# One definition of "relevant", used by BOTH the relevance filter and the story selection.
RELEVANCE_RULES = """WHAT COUNTS AS RELEVANT (the finance and investment world)
INCLUDE: stock, bond, currency and commodity markets; central banks, interest rates and economic
data (inflation, jobs, GDP); company earnings and guidance; M&A, IPOs and capital raising; banking
and financial services; investing, asset management, funds and sovereign wealth funds; oil and
energy markets; real estate as a market or investment sector; fintech and crypto markets; financial
regulation; the economy and markets of any country or region. Politics, trade and geopolitics ONLY when they clearly move
markets or the economy (e.g. tariffs, sanctions, fiscal policy).
EXCLUDE: general news, crime, protests, weather and traffic alerts, lifestyle, events, awards and
summits, product and car reviews, sports, religion, entertainment, and anything without a clear link
to markets, the economy, companies or investing."""


REQUEST_TIMEOUT_SECONDS = 300  # a full brief normally takes 1-3 minutes; never wait forever on a stalled server


def get_client() -> genai.Client:
    return genai.Client(api_key=os.environ["GEMINI_API_KEY"],
                        http_options=types.HttpOptions(timeout=REQUEST_TIMEOUT_SECONDS * 1000))  # milliseconds


def json_config(schema, temperature: float) -> types.GenerateContentConfig:
    """Structured output: Gemini must reply with JSON matching `schema` (a Pydantic model)."""
    return types.GenerateContentConfig(
        response_mime_type="application/json",
        response_schema=schema,
        temperature=temperature,
        automatic_function_calling=types.AutomaticFunctionCallingConfig(disable=True),  # we use no tools
    )


def call_gemini(client: genai.Client, prompt: str, config: types.GenerateContentConfig):
    """One request, trying GEMINI_MODEL first, then each model in GEMINI_FALLBACK_MODEL (comma-separated).
    - 'server busy' (5xx): temporary, so wait and retry the same model, then move on.
    - 'quota exhausted' (429): free-tier limits are per model per day, so move to the next model at once.
    - no reply within REQUEST_TIMEOUT_SECONDS: a stalled model tends to stall again, so move on."""
    fallbacks = os.environ.get("GEMINI_FALLBACK_MODEL", "")
    models = [os.environ["GEMINI_MODEL"]] + [m.strip() for m in fallbacks.split(",") if m.strip()]

    last_error = None
    for model in models:
        for wait in (0, 20, 60):
            if wait:
                print(f"  ! {model} busy (503); waiting {wait}s and retrying…")
                time.sleep(wait)
            try:
                return client.models.generate_content(model=model, contents=prompt, config=config)
            except errors.ServerError as e:
                last_error = e
            except errors.ClientError as e:
                if e.code != 429:
                    raise  # a real problem with our request: retrying won't help
                last_error = e
                print(f"  ! {model} free-tier quota used up (429); trying the next model")
                break
            except httpx.TimeoutException as e:
                last_error = e
                print(f"  ! {model} gave no reply within {REQUEST_TIMEOUT_SECONDS}s; trying the next model")
                break
        else:
            print(f"  ! {model} still unavailable after 3 tries")
    raise last_error
