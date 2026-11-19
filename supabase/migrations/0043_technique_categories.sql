-- 신규 기술 카테고리 레지스트리 (src/lib/categoryRegistry/). Categories created while registering a technique
-- (or by a category administrator), attached to the computed technique taxonomy (src/lib/techniqueTaxonomy/).
-- Additive only: no existing table, technique id, category string, video, favourite or review row is touched.
-- A technique points at a category by id (Technique.taxonomyNodeId inside add_teq.data); renaming / moving /
-- merging a category only changes the row here.
--
-- Rules enforced in the database (the app checks them too):
--   • id and parent_id / merged_into stay inside the same art ("<art>/…")
--   • no parent cycles, no merge cycles, at most 4 levels (Level 2 = top-level groups)
--   • anyone signed in may READ and CREATE (as themselves, status active); only category administrators may edit,
--     move, merge, deactivate or delete — except that a creator may delete their own unused category (rollback of a
--     registration that failed after the category was made)
--   • a category in use cannot be deleted (checked against add_teq: placed techniques, its category string, merges)
--
-- Not applied automatically — apply with the Supabase SQL editor / CLI after review.

create table if not exists public.category_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);
alter table public.category_admins enable row level security;
-- no policies: only security-definer functions and the service role read it
revoke all on public.category_admins from anon, authenticated;

create or replace function public.is_category_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.category_admins where user_id = auth.uid());
$$;
grant execute on function public.is_category_admin() to authenticated;

-- the operator account (ID "MARTIALDEX" → loginEmailFor) is the first administrator
insert into public.category_admins (user_id)
select id from auth.users where lower(email) = 'martialdex@martialdex.local'
on conflict do nothing;

create table if not exists public.technique_categories (
  id text primary key,
  art text not null,
  parent_id text,
  ko text not null,
  en text not null default '',
  description text not null default '',
  status text not null default 'active',
  merged_into text,
  category_string text,
  origin text not null default 'user',
  created_by uuid references auth.users (id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint technique_categories_id_in_art check (id like art || '/%'),
  constraint technique_categories_parent_in_art check (parent_id is null or parent_id like art || '/%'),
  constraint technique_categories_merge_in_art check (merged_into is null or merged_into like art || '/%'),
  constraint technique_categories_not_own_parent check (parent_id is distinct from id and merged_into is distinct from id),
  constraint technique_categories_status check (status in ('active', 'inactive', 'merged')),
  constraint technique_categories_merged check ((status = 'merged') = (merged_into is not null)),
  constraint technique_categories_origin check (origin in ('user', 'admin', 'ai_approved')),
  constraint technique_categories_names check (char_length(btrim(ko)) between 1 and 40 and char_length(en) <= 60 and char_length(description) <= 300),
  -- a top-level category needs its category string ("한국어 (English)"); a sub-category has none
  constraint technique_categories_top_level check ((parent_id is null) = (category_string is not null))
);

create index if not exists technique_categories_art_idx on public.technique_categories (art);
create index if not exists technique_categories_parent_idx on public.technique_categories (parent_id);
-- the same name twice under the same parent of the same art (case / spaces ignored) is rejected
create unique index if not exists technique_categories_unique_name on public.technique_categories (art, coalesce(parent_id, ''), lower(regexp_replace(ko, '\s+', '', 'g'))) where status <> 'merged';

-- parent / merge chains: no cycles, at most 4 levels
create or replace function public.technique_categories_check_tree()
returns trigger
language plpgsql
as $$
declare
  cur text := new.parent_id;
  steps int := 0;
  base int := 2;          -- a top-level registry category is Level 2
  seen text[] := array[new.id];
  next_parent text;
begin
  -- walk up through registry rows; a parent that is not a registry row is a built-in taxonomy node whose level is
  -- its number of path segments ("bjj/half-guard" = 2, "bjj/half-guard/sweep" = 3)
  while cur is not null loop
    if cur = any(seen) then
      raise exception 'technique_categories: parent cycle at %', cur;
    end if;
    seen := seen || cur;
    steps := steps + 1;
    select parent_id into next_parent from public.technique_categories where id = cur;
    if not found then
      base := array_length(string_to_array(cur, '/'), 1);
      exit;
    end if;
    cur := next_parent;
  end loop;
  if new.parent_id is not null and base + steps > 4 then
    raise exception 'technique_categories: more than 4 levels';
  end if;
  cur := new.merged_into;
  seen := array[new.id];
  while cur is not null loop
    if cur = any(seen) then
      raise exception 'technique_categories: merge cycle at %', cur;
    end if;
    seen := seen || cur;
    select merged_into into next_parent from public.technique_categories where id = cur;
    if not found then exit; end if;
    cur := next_parent;
  end loop;
  new.updated_at := greatest(new.updated_at, now());
  return new;
end;
$$;
drop trigger if exists technique_categories_check_tree on public.technique_categories;
create trigger technique_categories_check_tree before insert or update on public.technique_categories
  for each row execute function public.technique_categories_check_tree();

-- in use = a shared-library technique placed under it, carrying its category string, or another category merged into
-- it / under it
create or replace function public.technique_category_in_use(cat_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.add_teq where data -> 'technique' ->> 'taxonomyNodeId' = cat_id)
      or exists (select 1 from public.technique_categories c join public.add_teq a on a.data -> 'technique' ->> 'category' = c.category_string and a.data -> 'technique' ->> 'martialArt' = c.art where c.id = cat_id)
      or exists (select 1 from public.technique_categories where parent_id = cat_id or merged_into = cat_id);
$$;
grant execute on function public.technique_category_in_use(text) to authenticated;

alter table public.technique_categories enable row level security;

drop policy if exists "technique_categories_select" on public.technique_categories;
create policy "technique_categories_select" on public.technique_categories
  for select to authenticated using (true);

drop policy if exists "technique_categories_insert" on public.technique_categories;
create policy "technique_categories_insert" on public.technique_categories
  for insert to authenticated
  with check (created_by = auth.uid() and status = 'active' and merged_into is null and (origin <> 'admin' or public.is_category_admin()));

drop policy if exists "technique_categories_update_admin" on public.technique_categories;
create policy "technique_categories_update_admin" on public.technique_categories
  for update to authenticated using (public.is_category_admin()) with check (public.is_category_admin());

drop policy if exists "technique_categories_delete" on public.technique_categories;
create policy "technique_categories_delete" on public.technique_categories
  for delete to authenticated
  using ((public.is_category_admin() or created_by = auth.uid()) and not public.technique_category_in_use(id));

revoke all on public.technique_categories from anon;
grant select, insert, update, delete on public.technique_categories to authenticated;
