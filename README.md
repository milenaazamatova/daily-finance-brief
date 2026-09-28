# Daily Finance Brief

A personal system that builds a daily briefing of the most important finance and market news,
explained so it's actually understandable. Built by an accounting student preparing for finance
interviews: each story answers **what happened, why it matters, who is affected, and one finance
concept in plain language**, plus a question an interviewer might ask about it.

Everything runs on free tiers: GitHub Actions, the Google Gemini API, Supabase and Vercel.

**Live site:** https://daily-finance-brief-ten.vercel.app

## What a daily brief looks like

- **Top Stories**: the 5–7 most important finance and market stories worldwide, ranked by global market impact.
- **Regional sections**: UAE, US, China, Russia and Global, with the 2–4 most important remaining stories each
  (short or empty on quiet days, never padded with weak stories).

## Architecture

```
feeds.yaml (~45 business/markets section feeds) + Finnhub API
      │ 1-2  fetch.py      download, keep last 24h, normalise, 300-char excerpts only
      ▼
      │ 3    dedupe.py     same URL, or headlines ≥85% similar → keep one
      ▼
      │ 4    relevance.py  Gemini call #1: classify every article relevant / not (Include/Exclude rules)
      ▼
      │ 5    store.py      save relevant articles → Supabase `articles`
      ▼
      │ 6-7  summarise.py  Gemini call #2: Top Stories + regional sections as strict JSON, validated by Pydantic
      ▼
      │ 8    store.py      briefs → stories → story_entities / story_sources / glossary
      ▼
        9    logs/YYYY-MM-DD.txt   (committed daily by GitHub Actions)
```

| Part | Technology | Why |
|---|---|---|
| Pipeline | Python (`/pipeline`) | Mature free libraries for feeds, APIs and validation |
| Sources | RSS section feeds + Finnhub | Free, stable, publisher-intended; config in `feeds.yaml`, not code |
| AI | Google Gemini (free tier) | Large context fits a whole day's articles in one call; structured JSON output |
| Validation | Pydantic | One schema both instructs Gemini and checks its answer |
| Database | Supabase (PostgreSQL) | Relational data with constraints, built-in API and Auth, free plan |
| Scheduler | GitHub Actions | Free for public repos; daily cron at 07:00 Dubai time |
| Website | Next.js on Vercel (`/web`) | Free Hobby plan; server-rendered pages cached for 10 min; reads Supabase with the public anon key only |

### Design decisions

- **Two batched Gemini calls per day, not one per article.** Keeps well inside free-tier limits, and lets
  the model compare and merge coverage of the same event across outlets.
- **Reliability.** Free-tier limits are per model, and Google's servers are sometimes overloaded, so the pipeline
  rotates through a list of models (`GEMINI_FALLBACK_MODEL`) when one is busy, pausing between rounds for up to ~12 minutes,
  and never waits more than 5 minutes for one request. One broken feed never stops a run, and a failed save is rolled back.
- **Hallucination guards.** Gemini may only use facts from the supplied articles, every story must cite
  article ids, and ids that weren't in the batch are discarded.
- **Search.** The Archive uses PostgreSQL full-text search over stories, affected companies and source
  articles (word forms, "exact phrases", OR, -exclude), GIN-indexed. The Search page takes any topic and shows
  matching stories from past briefs plus the latest finance-focused news from Google News (free, no API key,
  nothing stored, identical searches cached for 15 minutes).
- **Copyright.** Only headline, source, link, publish time and a short excerpt are stored; never full text.
  The website always links to the original article.
- **Security.** Row Level Security is enabled on every table with explicit grants: the public anon key can only
  read the brief tables and only the link columns of articles a story cites; nothing is writable by the public.
  The pipeline's service-role key lives only in GitHub Secrets / a local `.env`. `npm run test:security`
  (in `/web`) proves what the anon key can and can't do.

## Repository structure

```
/pipeline              Python pipeline (fetch, dedupe, relevance, summarise, store)
/pipeline/feeds.yaml   news sources, each labelled with region and section
/supabase/schema.sql   full database schema (tables, RLS, grants, policies)
/supabase/migrations   dated changes applied to the existing database
/logs                  one small log file per day
/.github/workflows     daily GitHub Actions workflow
/web                   Next.js website: Today, Archive, Story and Search pages
```

## Running it locally

```bash
cd pipeline
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cp ../.env.example .env        # then fill in your own keys in pipeline/.env
.venv/bin/python main.py --dry-run   # fetch + dedupe only, no keys needed
.venv/bin/python main.py             # full run: saves today's brief
.venv/bin/python main.py --force     # replace today's brief
```

Website:

```bash
cd web
npm install
cp .env.example .env.local     # then add your Supabase URL and anon key
npm run dev                    # http://localhost:3000
npm run test:security          # checks the anon key can read briefs but not write anything
```

Database setup: run `supabase/schema.sql` in the Supabase SQL Editor (new database), or the files in
`supabase/migrations/` in date order (existing database).

### Environment variables

| Name | Purpose |
|---|---|
| `GEMINI_API_KEY` | Google AI Studio API key (free tier) |
| `GEMINI_MODEL` | Main Gemini model, e.g. `gemini-3.8-flash` |
| `GEMINI_FALLBACK_MODEL` | Optional comma-separated backup models |
| `FINNHUB_API_KEY` | Finnhub free API key |
| `SUPABASE_URL` | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service-role key (pipeline only; never in the website) |

Never commit real keys: `.env` files are git-ignored, and `.env.example` lists names only.

---
*For personal learning; not investment advice.*
