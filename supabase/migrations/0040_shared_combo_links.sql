-- 사용자 콤보·셋업 연결 — 공유된 콤보/셋업 두 개를 "A → B"로 잇는다.
--
--   follow_up   이어서      A가 끝난 자세에서 바로 B로 이어 친다
--   opens       열어줌      A(주로 셋업)가 만든 반응·빈틈으로 B를 넣는다
--   if_blocked  막히면 전환  A가 막히거나 상대가 반응하지 않으면 B로 바꾼다
--
-- 누구나 공개된 콤보/셋업끼리 연결을 만들 수 있다(내 것 ↔ 다른 사람 것 포함).
-- 연결은 만든 사람의 것이며, 같은 연결을 여러 사람이 만들면 그만큼 지지가
-- 쌓인다(같은 사람이 같은 A→B·관계를 두 번 만들 수는 없음). 원본
-- shared_combos와 그 RLS는 바꾸지 않는다. 연결된 콤보가 공유 취소되면
-- 연결도 함께 사라진다(on delete cascade).
--
-- 패턴은 0037 shared_combos와 같다: 공개 읽기(anon 포함), 본인 행만 쓰기,
-- 작성자 닉네임은 작성 시점에 평문 복사.

create table if not exists public.shared_combo_links (
  id text not null primary key,
  author_id uuid not null references auth.users (id) on delete cascade,
  author_nickname text not null,
  from_id text not null references public.shared_combos (id) on delete cascade,
  to_id text not null references public.shared_combos (id) on delete cascade,
  relation text not null check (relation in ('follow_up', 'opens', 'if_blocked')),
  note text not null default '' check (char_length(note) <= 300),
  created_at timestamptz not null default now(),
  check (from_id <> to_id)
);

create unique index if not exists shared_combo_links_unique_idx on public.shared_combo_links (author_id, from_id, to_id, relation);
create index if not exists shared_combo_links_from_idx on public.shared_combo_links (from_id);
create index if not exists shared_combo_links_to_idx on public.shared_combo_links (to_id);

alter table public.shared_combo_links enable row level security;

drop policy if exists "shared_combo_links_select_all" on public.shared_combo_links;
create policy "shared_combo_links_select_all" on public.shared_combo_links
  for select using (true);
drop policy if exists "shared_combo_links_insert_own" on public.shared_combo_links;
create policy "shared_combo_links_insert_own" on public.shared_combo_links
  for insert to authenticated with check (author_id = auth.uid());
drop policy if exists "shared_combo_links_delete_own" on public.shared_combo_links;
create policy "shared_combo_links_delete_own" on public.shared_combo_links
  for delete to authenticated using (author_id = auth.uid());
-- no update policy: a link is deleted and re-created, never edited in place

grant select on public.shared_combo_links to anon, authenticated;
grant insert, delete on public.shared_combo_links to authenticated;

-- author_id / created_at are never taken from the client on insert
create or replace function public.trg_protect_shared_combo_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.author_id := auth.uid();
  new.created_at := now();
  return new;
end;
$$;

drop trigger if exists shared_combo_links_protect on public.shared_combo_links;
create trigger shared_combo_links_protect
  before insert on public.shared_combo_links
  for each row execute function public.trg_protect_shared_combo_link();
