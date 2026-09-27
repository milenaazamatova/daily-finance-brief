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
--   - articles: no anon/authenticated access at all.
--   - takes: only the logged-in owner can read/write their own rows.

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

create table if not exists public.takes (
  id         bigint generated always as identity primary key,
  story_id   bigint not null references public.stories (id) on delete cascade,
  user_id    uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  take_text  text   not null,
  created_at timestamptz not null default now()
);
create index if not exists takes_story_id_idx on public.takes (story_id);
create index if not exists takes_user_id_idx  on public.takes (user_id);

-- =========================================================================
-- Row Level Security: ON for every table, no exceptions
-- =========================================================================

alter table public.articles       enable row level security;
alter table public.briefs         enable row level security;
alter table public.stories        enable row level security;
alter table public.story_entities enable row level security;
alter table public.story_sources  enable row level security;
alter table public.glossary       enable row level security;
alter table public.takes          enable row level security;

-- =========================================================================
-- Grants: start from zero for anon/authenticated, then add back only what's needed
-- =========================================================================

revoke all on public.articles, public.briefs, public.stories, public.story_entities,
              public.story_sources, public.glossary, public.takes
  from anon, authenticated;

-- Public read-only tables
grant select on public.briefs, public.stories, public.story_entities,
                public.story_sources, public.glossary
  to anon, authenticated;

-- takes: logged-in users only (RLS below limits them to their own rows)
grant select, insert, update, delete on public.takes to authenticated;

-- Pipeline (service_role) needs full access to everything
grant all on public.articles, public.briefs, public.stories, public.story_entities,
             public.story_sources, public.glossary, public.takes
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

-- articles: intentionally NO policies -> only service_role (pipeline) can access.

-- takes: owner-only
drop policy if exists "Owner can read own takes" on public.takes;
create policy "Owner can read own takes" on public.takes
  for select to authenticated using ((select auth.uid()) = user_id);
drop policy if exists "Owner can insert own takes" on public.takes;
create policy "Owner can insert own takes" on public.takes
  for insert to authenticated with check ((select auth.uid()) = user_id);
drop policy if exists "Owner can update own takes" on public.takes;
create policy "Owner can update own takes" on public.takes
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
drop policy if exists "Owner can delete own takes" on public.takes;
create policy "Owner can delete own takes" on public.takes
  for delete to authenticated using ((select auth.uid()) = user_id);

-- To make takes PUBLICLY READABLE later, run these two lines (writing stays owner-only):
--   grant select on public.takes to anon;
--   create policy "Public read takes" on public.takes for select to anon, authenticated using (true);
