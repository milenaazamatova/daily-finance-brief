-- Migration 2026-09-28b: Phase 6 - full-text search. Also removes the unused `takes` table.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.

-- 0. Remove the unused takes table (Phase 4 was dropped; the table is empty and nothing uses it).
drop table if exists public.takes;

-- 1. Full-text search columns + indexes.
--    A tsvector is the list of words in a text reduced to their root form ("rates" -> "rate"),
--    so a search matches any form of a word. GIN indexes keep searches fast as the archive grows.
alter table public.stories add column if not exists search tsvector
  generated always as (to_tsvector('english',
    coalesce(headline, '') || ' ' || coalesce(what_happened, '') || ' ' || coalesce(why_it_matters, '') || ' ' ||
    coalesce(concept_term, '') || ' ' || coalesce(interview_question, ''))) stored;
create index if not exists stories_search_idx on public.stories using gin (search);

alter table public.articles add column if not exists search tsvector
  generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) stored;
create index if not exists articles_search_idx on public.articles using gin (search);

-- 2. The public may use the articles search column too (same rows as before: only articles a story
--    cites). Excerpts themselves stay hidden.
grant select (id, title, source, url, published_at, search) on public.articles to anon, authenticated;

-- 3. Search function for the website.
--    SECURITY INVOKER: it runs with the caller's permissions, so the public can only search what RLS
--    already lets them read. websearch_to_tsquery understands "exact phrases", OR, and -excluded words.
create or replace function public.search_stories(q text)
returns table (story_id bigint, rank real)
language sql stable security invoker set search_path = ''
as $$
  with query as (select websearch_to_tsquery('english', left(q, 200)) as tsq),
  hits as (
    -- the story's own text
    select s.id as story_id, ts_rank(s.search, query.tsq) as rank
      from public.stories s, query
     where s.search @@ query.tsq
    union all
    -- affected companies / sectors / markets
    select e.story_id, 0.3::real
      from public.story_entities e, query
     where to_tsvector('english', e.entity) @@ query.tsq
    union all
    -- the headlines and excerpts of the story's source articles
    select ss.story_id, ts_rank(a.search, query.tsq) * 0.5
      from public.story_sources ss
      join public.articles a on a.id = ss.article_id, query
     where a.search @@ query.tsq
  )
  select story_id, max(rank)::real as rank from hits group by story_id order by rank desc limit 500;
$$;

revoke all on function public.search_stories(text) from public;
grant execute on function public.search_stories(text) to anon, authenticated, service_role;
