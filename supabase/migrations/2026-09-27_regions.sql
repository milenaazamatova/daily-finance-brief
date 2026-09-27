-- Migration 2026-09-27: global coverage with Top Stories + regional sections.
-- Run once in Supabase: SQL Editor -> New query -> paste -> Run. Safe to re-run.
--   - stories.region        : uae | us | china | russia | global (exactly one per story)
--   - stories.is_top_story  : true for the 5-7 Top Stories of the day
--   - stories.category      : 'uae_gcc' replaced by 'companies' (UAE is now a region, not a category)
-- Grants and RLS need no change: table-level SELECT already covers new columns.

alter table public.stories add column if not exists region text;
alter table public.stories add column if not exists is_top_story boolean not null default false;

-- Existing stories (written before this change): UAE category becomes the UAE region, the rest global.
update public.stories set region = 'uae'    where region is null and category = 'uae_gcc';
update public.stories set region = 'global' where region is null;
update public.stories set category = 'other' where category = 'uae_gcc';

alter table public.stories alter column region set not null;

alter table public.stories drop constraint if exists stories_region_check;
alter table public.stories add constraint stories_region_check
  check (region in ('uae','us','china','russia','global'));

alter table public.stories drop constraint if exists stories_category_check;
alter table public.stories add constraint stories_category_check
  check (category in ('rates_macro','markets','earnings','deals_ipos','banking','oil_energy','companies','other'));

-- The website will load one brief's stories grouped by region.
create index if not exists stories_brief_id_region_idx on public.stories (brief_id, region);
-- It also covers lookups by brief_id alone, so the old single-column index is no longer needed.
drop index if exists public.stories_brief_id_idx;
