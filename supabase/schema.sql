-- Daily Finance Brief: database schema
-- Run in Supabase: Dashboard -> SQL Editor -> New query -> paste -> Run.
-- Safe to re-run (uses IF NOT EXISTS / DROP POLICY IF EXISTS).
-- This file is the full CURRENT schema for a fresh database. Changes to an existing database
-- are applied with the dated files in supabase/migrations/ (run them in order).
--
-- Security model
--   This project has "Automatically expose new tables" ON and "automatic RLS" OFF,
--   so every table below explicitly (1) enables RLS and (2) sets grants for anon/authenticated.
--   - Pipeline writes with the service_role key (bypasses RLS; never used in the browser).
--   - Website reads with the anon key: SELECT only on briefs, stories, story_entities,
--     story_sources, glossary.
--   - articles: anon/authenticated may read only the link columns (id, title, source, url,
--     published_at, search) of articles a story cites; everything else (e.g. excerpts) is pipeline-only.

-- =========================================================================
-- Tables
-- =========================================================================

create table if not exists public.articles (
  id           bigint generated always as identity primary key,
  title        text        not null,
  source       text        not null,
  url          text        not null unique,
  published_at timestamptz,
  excerpt      text,
  fetched_at   timestamptz not null default now()
);
create index if not exists articles_published_at_idx on public.articles (published_at desc);
-- Full-text search: words reduced to root forms ("rates" -> "rate"), GIN-indexed for speed.
alter table public.articles add column if not exists search tsvector
  generated always as (to_tsvector('english', coalesce(title, '') || ' ' || coalesce(excerpt, ''))) stored;
create index if not exists articles_search_idx on public.articles using gin (search);

create table if not exists public.briefs (
  id         bigint generated always as identity primary key,
  brief_date date        not null unique,
  created_at timestamptz not null default now()
);

create table if not exists public.stories (
  id                 bigint generated always as identity primary key,
  brief_id           bigint   not null references public.briefs (id) on delete cascade,
  headline           text     not null,
  category           text     not null constraint stories_category_check check (category in
                       ('rates_macro','markets','earnings','deals_ipos','banking','oil_energy','companies','other')),
  region             text     not null constraint stories_region_check check (region in
                       ('uae','us','china','russia','global')),
  is_top_story       boolean  not null default false,
  importance         smallint not null check (importance between 1 and 5),
  what_happened      text     not null,
  why_it_matters     text     not null,
  concept_term       text,
  interview_question text,
  created_at         timestamptz not null default now()
);
create index if not exists stories_brief_id_region_idx on public.stories (brief_id, region);
alter table public.stories add column if not exists search tsvector
  generated always as (to_tsvector('english',
    coalesce(headline, '') || ' ' || coalesce(what_happened, '') || ' ' || coalesce(why_it_matters, '') || ' ' ||
    coalesce(concept_term, '') || ' ' || coalesce(interview_question, ''))) stored;
create index if not exists stories_search_idx on public.stories using gin (search);

create table if not exists public.story_entities (
  id       bigint generated always as identity primary key,
  story_id bigint not null references public.stories (id) on delete cascade,
  entity   text   not null,
  impact   text   not null check (impact in ('positive','negative','mixed')),
  reason   text
);
create index if not exists story_entities_story_id_idx on public.story_entities (story_id);

create table if not exists public.story_sources (
  story_id   bigint not null references public.stories (id) on delete cascade,
  article_id bigint not null references public.articles (id) on delete cascade,
  primary key (story_id, article_id)
);
create index if not exists story_sources_article_id_idx on public.story_sources (article_id);

create table if not exists public.glossary (
  id                  bigint generated always as identity primary key,
  term                text   not null unique,
  explanation         text   not null,
  first_seen_story_id bigint references public.stories (id) on delete set null
);
create index if not exists glossary_first_seen_story_id_idx on public.glossary (first_seen_story_id);

-- =========================================================================
-- Row Level Security: ON for every table, no exceptions
-- =========================================================================

alter table public.articles       enable row level security;
alter table public.briefs         enable row level security;
alter table public.stories        enable row level security;
alter table public.story_entities enable row level security;
alter table public.story_sources  enable row level security;
alter table public.glossary       enable row level security;

-- =========================================================================
-- Grants: start from zero for anon/authenticated, then add back only what's needed
-- =========================================================================

revoke all on public.articles, public.briefs, public.stories, public.story_entities,
              public.story_sources, public.glossary
  from anon, authenticated;

-- Public read-only tables
grant select on public.briefs, public.stories, public.story_entities,
                public.story_sources, public.glossary
  to anon, authenticated;

-- articles: link columns only (RLS below limits rows to articles cited by a story)
grant select (id, title, source, url, published_at, search) on public.articles to anon, authenticated;

-- Pipeline (service_role) needs full access to everything
grant all on public.articles, public.briefs, public.stories, public.story_entities,
             public.story_sources, public.glossary
  to service_role;

-- =========================================================================
-- Policies
-- =========================================================================

-- Public read on the brief tables
drop policy if exists "Public read" on public.briefs;
create policy "Public read" on public.briefs         for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.stories;
create policy "Public read" on public.stories        for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.story_entities;
create policy "Public read" on public.story_entities for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.story_sources;
create policy "Public read" on public.story_sources  for select to anon, authenticated using (true);
drop policy if exists "Public read" on public.glossary;
create policy "Public read" on public.glossary       for select to anon, authenticated using (true);

-- articles: only rows cited by a story (story_sources), and only the granted link columns.
drop policy if exists "Public read of cited articles" on public.articles;
create policy "Public read of cited articles" on public.articles
  for select to anon, authenticated
  using (exists (select 1 from public.story_sources ss where ss.article_id = articles.id));

-- =========================================================================
-- Search function (Phase 6)
-- =========================================================================
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
