-- DRAFT — NOT APPLIED. Apply to the live project only after the owner approves.
--
-- 신규 기술·셋업·콤보 후보 (src/lib/martialdexKnowledge/candidateStore.ts).
-- Research output found by the self-hosted search and compared with the
-- MARTIALDEX DB. Private to the user who ran the research, same convention as
-- 0006_combos.sql: `data` holds the full local KnowledgeCandidate JSON.
-- Deliberately separate from add_teq (shared, readable by all) so unverified
-- web findings never appear as library techniques. Promotion of a candidate
-- into add_teq / shared_combos stays a separate, reviewed step.

create table if not exists public.knowledge_candidates (
  id text not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('technique', 'setup', 'combo')),
  status text not null check (status in ('verified', 'partially_verified', 'pending', 'insufficient', 'duplicate')),
  martial_art text not null,
  name text not null,
  data jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, user_id)
);

alter table public.knowledge_candidates enable row level security;

create policy "knowledge_candidates_select_own" on public.knowledge_candidates
  for select using (auth.uid() = user_id);
create policy "knowledge_candidates_insert_own" on public.knowledge_candidates
  for insert with check (auth.uid() = user_id);
create policy "knowledge_candidates_update_own" on public.knowledge_candidates
  for update using (auth.uid() = user_id);
create policy "knowledge_candidates_delete_own" on public.knowledge_candidates
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.knowledge_candidates to authenticated;
