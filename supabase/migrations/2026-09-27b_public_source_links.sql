-- Migration 2026-09-27b: let the website show source links.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--
-- The website (anon key) may read from `articles`:
--   - only the columns needed for a link: id, title, source, url, published_at (no excerpt, no fetched_at)
--   - only rows that a published story cites (i.e. appear in story_sources)
-- Everything else in `articles` stays pipeline-only. Writing is still not allowed for anon/authenticated.

-- Layer 1, grants (which columns): start from zero, then allow just these columns.
revoke all on public.articles from anon, authenticated;
grant select (id, title, source, url, published_at) on public.articles to anon, authenticated;

-- Layer 2, Row Level Security (which rows): only articles cited by a story.
drop policy if exists "Public read of cited articles" on public.articles;
create policy "Public read of cited articles" on public.articles
  for select to anon, authenticated
  using (exists (select 1 from public.story_sources ss where ss.article_id = articles.id));
