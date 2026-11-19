-- 개인 파이터 프로필 (src/lib/fighterProfile/). One row per user, same
-- additive "data jsonb" singleton shape as nutrition_profiles (0021) — no
-- existing table is modified, the login flow is untouched.
--
-- The logical parts of a profile live inside `data` (FighterProfile):
--   items      — attributes / measurements / preferences / habits, one entry per
--                field key, each with value, source (self_report | measured |
--                video_observed | system_calculated | coach_inferred), status
--                (confirmed | unconfirmed | needs_review | outdated) and, for
--                measurements, kind / method / date / side / lead-rear / confidence.
--                Deleted items stay as tombstones so a deletion syncs.
--   style      — the rule-based style analysis and whether the user confirmed it
--   history    — change log (set / delete / confirm / review)
--   interview  — interview progress (current question, messages, pending confirmations)
-- The client merges item by item (newer side wins per item), so editing
-- different items on two devices keeps both.
--
-- Not applied automatically — apply with the Supabase SQL editor / CLI after review.

create table if not exists public.fighter_profiles (
  user_id uuid not null primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint fighter_profiles_data_object check (jsonb_typeof(data) = 'object'),
  constraint fighter_profiles_data_items check (jsonb_typeof(data -> 'items') = 'object'),
  -- generous cap (a full profile with interview log is ~100 KB)
  constraint fighter_profiles_data_size check (pg_column_size(data) < 1048576)
);

alter table public.fighter_profiles enable row level security;

drop policy if exists "fighter_profiles_select_own" on public.fighter_profiles;
create policy "fighter_profiles_select_own" on public.fighter_profiles
  for select using (auth.uid() = user_id);
drop policy if exists "fighter_profiles_insert_own" on public.fighter_profiles;
create policy "fighter_profiles_insert_own" on public.fighter_profiles
  for insert with check (auth.uid() = user_id);
drop policy if exists "fighter_profiles_update_own" on public.fighter_profiles;
create policy "fighter_profiles_update_own" on public.fighter_profiles
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "fighter_profiles_delete_own" on public.fighter_profiles;
create policy "fighter_profiles_delete_own" on public.fighter_profiles
  for delete using (auth.uid() = user_id);

revoke all on public.fighter_profiles from anon;
grant select, insert, update, delete on public.fighter_profiles to authenticated;
