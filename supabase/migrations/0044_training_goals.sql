-- 개인 목표 (src/lib/goals/). One row per user, the same additive "data jsonb" singleton shape as
-- fighter_profiles (0041) — no existing table is modified and the login flow is untouched.
--
-- data = GoalsData:
--   entries — one entry per PERIOD the user wrote for, never per label:
--               scope 'week' | 'month' | 'year' | 'long_term'
--               periodKey  week "2026-W45" · month "2026-11" · year "2026" · long_term ""
--             so the year is always derived from today (내년 목표 written in 2026 is simply the 2026+1 year
--             entry, read as 올해 목표 once 2027 starts) and a finished week/month becomes a past goal on its
--             own. Deleted entries stay as tombstones (deletedAt) so a deletion syncs; nothing is auto-removed.
--   The client merges entry by entry (newer updatedAt wins per scope+periodKey), so two devices editing
--   different periods keep both — cloudSync/goalsSync.ts.
--
-- The goals are the user's own free text; only the owner can read or write the row (RLS below).
--
-- Not applied automatically — apply with the Supabase SQL editor / CLI after review.

create table if not exists public.training_goals (
  user_id uuid not null primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  updated_at timestamptz not null default now(),
  constraint training_goals_data_object check (jsonb_typeof(data) = 'object'),
  constraint training_goals_data_entries check (jsonb_typeof(data -> 'entries') = 'array'),
  -- a goal is a note: 400 entries x 4000 chars is far under this
  constraint training_goals_data_size check (pg_column_size(data) < 1048576)
);

alter table public.training_goals enable row level security;

drop policy if exists "training_goals_select_own" on public.training_goals;
create policy "training_goals_select_own" on public.training_goals
  for select using (auth.uid() = user_id);
drop policy if exists "training_goals_insert_own" on public.training_goals;
create policy "training_goals_insert_own" on public.training_goals
  for insert with check (auth.uid() = user_id);
drop policy if exists "training_goals_update_own" on public.training_goals;
create policy "training_goals_update_own" on public.training_goals
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "training_goals_delete_own" on public.training_goals;
create policy "training_goals_delete_own" on public.training_goals
  for delete using (auth.uid() = user_id);

revoke all on public.training_goals from anon;
grant select, insert, update, delete on public.training_goals to authenticated;
