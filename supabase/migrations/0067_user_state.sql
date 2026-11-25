-- 계정 데이터 자동 동기화 저장소.
--
-- 지금까지는 `user_backups` 하나로 두 가지 일을 했다 — 사용자가 프로필에서 직접 누르는 "백업"과,
-- 새 기기에서 누르는 "복원". 그래서 백업을 누르는 걸 잊으면 기기를 바꿨을 때 기록이 사라졌다.
--
-- 이 표는 그 둘을 나눈다:
--   user_backups : 사용자가 직접 만든 **백업본** — 사용자가 누를 때만 바뀐다. 되돌릴 지점이다.
--   user_state   : 앱이 알아서 올리는 **현재 상태** — 수시로 덮어쓰이고, 앱을 열 때 자동으로 내려온다.
--
-- 둘을 섞지 않는 이유: 자동 동기화가 백업본까지 덮어쓰면 "되돌리기"가 사라진다. 실수로 기록을 지웠을 때
-- 돌아갈 곳이 필요하다.
--
-- device_id / device_name 은 "어느 기기가 마지막으로 올렸는지"를 사용자에게 보여 주기 위한 것이다.
-- 다른 기기에서 올린 더 새로운 상태가 있으면 앱이 묻고 덮어쓴다(앱 쪽 cloudSync/autoState.ts).

create table if not exists public.user_state (
  user_id uuid primary key references auth.users (id) on delete cascade,
  data jsonb not null,
  /** 이 상태를 마지막으로 올린 기기 — 사용자에게 "맥북에서 10분 전" 처럼 보여 준다. */
  device_id text,
  device_name text,
  /** 앱이 스냅샷을 만든 시각 (기기 시계). updated_at 은 서버 시각이라 둘 다 둔다. */
  captured_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- 자동 동기화라 자주 쓰인다. 통째로 덮어쓰는 구조라 행이 커질 수 있으므로 상한을 둔다
-- (백업본과 같은 성격의 데이터이고, 지금 실제 스냅샷은 수백 KB 수준이다).
alter table public.user_state
  drop constraint if exists user_state_data_is_object;
alter table public.user_state
  add constraint user_state_data_is_object check (jsonb_typeof(data) = 'object');
alter table public.user_state
  drop constraint if exists user_state_data_size;
alter table public.user_state
  add constraint user_state_data_size check (pg_column_size(data) <= 8 * 1024 * 1024);

alter table public.user_state enable row level security;

drop policy if exists "user_state_select_own" on public.user_state;
create policy "user_state_select_own" on public.user_state
  for select using (auth.uid() = user_id);
drop policy if exists "user_state_insert_own" on public.user_state;
create policy "user_state_insert_own" on public.user_state
  for insert with check (auth.uid() = user_id);
drop policy if exists "user_state_update_own" on public.user_state;
create policy "user_state_update_own" on public.user_state
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
drop policy if exists "user_state_delete_own" on public.user_state;
create policy "user_state_delete_own" on public.user_state
  for delete using (auth.uid() = user_id);

grant select, insert, update, delete on public.user_state to authenticated;

-- updated_at 은 서버가 정한다 — 기기 시계가 틀려도 "어느 쪽이 더 새 것인지" 판정이 흔들리지 않는다.
create or replace function public.touch_user_state() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists user_state_touch on public.user_state;
create trigger user_state_touch before insert or update on public.user_state
  for each row execute function public.touch_user_state();
