-- 소셜 2/3 — DM (1:1 대화 · 실시간 · 읽음 · 메시지 요청함)
--
-- Membership checks go through SECURITY DEFINER helpers for the same reason
-- 0023 had to fix gym_members: a policy on conversation_members that selects
-- from conversation_members re-triggers its own policy and recurses (42P17).

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references auth.users (id) on delete cascade,
  -- 1:1 대화의 중복 생성을 DB에서 막는다 (작은 uuid::큰 uuid 로 정규화한 키)
  pair_key text unique,
  last_message_at timestamptz not null default now(),
  last_message_preview text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists conversations_last_msg_idx on public.conversations (last_message_at desc);

create table if not exists public.conversation_members (
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 모르는 사람의 첫 메시지는 'request'로 들어가 메시지 요청함에 쌓인다
  state text not null default 'accepted' check (state in ('accepted', 'request')),
  muted boolean not null default false,
  last_read_at timestamptz not null default 'epoch',
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists conversation_members_user_idx on public.conversation_members (user_id, state);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '',
  image_url text,
  created_at timestamptz not null default now()
);
create index if not exists messages_conversation_idx on public.messages (conversation_id, created_at desc);

alter table public.conversations enable row level security;
alter table public.conversation_members enable row level security;
alter table public.messages enable row level security;

-- ---------- helpers ----------
create or replace function public.is_conversation_member(p_conversation uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.conversation_members
    where conversation_id = p_conversation and user_id = p_user
  );
$$;
revoke all on function public.is_conversation_member(uuid, uuid) from public;
grant execute on function public.is_conversation_member(uuid, uuid) to authenticated;

-- 대화 상대(1:1 기준) — 차단/알림 판정에 쓴다
create or replace function public.conversation_other_member(p_conversation uuid, p_user uuid)
returns uuid language sql security definer set search_path = public stable as $$
  select user_id from public.conversation_members
  where conversation_id = p_conversation and user_id <> p_user
  limit 1;
$$;
revoke all on function public.conversation_other_member(uuid, uuid) from public;
grant execute on function public.conversation_other_member(uuid, uuid) to authenticated;

-- ---------- policies ----------
drop policy if exists "conversations_select_member" on public.conversations;
create policy "conversations_select_member" on public.conversations for select
  using (public.is_conversation_member(id, auth.uid()));
drop policy if exists "conversations_update_member" on public.conversations;
create policy "conversations_update_member" on public.conversations for update
  using (public.is_conversation_member(id, auth.uid()));
-- 대화 생성은 start_conversation() RPC로만 (INSERT 정책 없음)

drop policy if exists "conversation_members_select_member" on public.conversation_members;
create policy "conversation_members_select_member" on public.conversation_members for select
  using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "conversation_members_update_own" on public.conversation_members;
-- 읽음 시각 / 알림 끄기 / 요청 수락은 본인 행만
create policy "conversation_members_update_own" on public.conversation_members for update
  using (user_id = auth.uid());
drop policy if exists "conversation_members_delete_own" on public.conversation_members;
-- 대화방 나가기
create policy "conversation_members_delete_own" on public.conversation_members for delete
  using (user_id = auth.uid());

drop policy if exists "messages_select_member" on public.messages;
create policy "messages_select_member" on public.messages for select
  using (public.is_conversation_member(conversation_id, auth.uid()));
drop policy if exists "messages_insert_member" on public.messages;
-- 발신자 id는 클라이언트 입력을 믿지 않는다: auth.uid()와 같아야만 통과.
-- 참여자가 아니거나 차단 관계면 INSERT 자체가 거부된다.
create policy "messages_insert_member" on public.messages for insert
  with check (
    sender_id = auth.uid()
    and public.is_conversation_member(conversation_id, auth.uid())
    and not public.is_blocked_between(auth.uid(), public.conversation_other_member(conversation_id, auth.uid()))
  );
drop policy if exists "messages_delete_own" on public.messages;
create policy "messages_delete_own" on public.messages for delete using (sender_id = auth.uid());

-- ---------- 대화 시작 ----------
-- 중복 대화방 생성을 막고, 수신자의 dm_policy / 차단을 서버에서 검증한다.
create or replace function public.start_conversation(p_other uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  key text;
  conv uuid;
  policy_v text;
  other_state text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  if p_other = me then raise exception 'cannot message yourself'; end if;
  if public.is_blocked_between(me, p_other) then raise exception 'blocked'; end if;

  select dm_policy into policy_v from public.profiles where user_id = p_other;
  if policy_v = 'nobody' then raise exception 'recipient does not accept messages'; end if;
  if policy_v = 'followers' and not public.is_following(p_other, me) then
    raise exception 'recipient only accepts messages from people they follow';
  end if;

  key := case when me < p_other then me::text || ':' || p_other::text
              else p_other::text || ':' || me::text end;

  select id into conv from public.conversations where pair_key = key;
  if conv is not null then
    -- 내가 나갔던 방이면 다시 들어간다
    insert into public.conversation_members (conversation_id, user_id, state)
    values (conv, me, 'accepted') on conflict do nothing;
    return conv;
  end if;

  insert into public.conversations (created_by, pair_key) values (me, key) returning id into conv;
  -- 서로 팔로우가 아니면 받는 쪽에서는 '메시지 요청함'으로 분리된다
  other_state := case when public.is_following(p_other, me) then 'accepted' else 'request' end;
  insert into public.conversation_members (conversation_id, user_id, state) values (conv, me, 'accepted');
  insert into public.conversation_members (conversation_id, user_id, state) values (conv, p_other, other_state);
  return conv;
end;
$$;
revoke all on function public.start_conversation(uuid) from public;
grant execute on function public.start_conversation(uuid) to authenticated;

-- ---------- 새 메시지 → 대화 미리보기 갱신 + 알림 ----------
create or replace function public.on_message_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare other uuid;
begin
  update public.conversations
     set last_message_at = new.created_at,
         last_message_preview = left(coalesce(nullif(new.body, ''), '사진'), 120)
   where id = new.conversation_id;
  other := public.conversation_other_member(new.conversation_id, new.sender_id);
  if other is not null and not exists (
    select 1 from public.conversation_members
    where conversation_id = new.conversation_id and user_id = other and muted
  ) then
    perform public.notify(other, 'message', new.sender_id, 'conversation', new.conversation_id::text, left(coalesce(new.body, ''), 120));
  end if;
  return new;
end;
$$;
drop trigger if exists messages_after_insert on public.messages;
create trigger messages_after_insert
  after insert on public.messages
  for each row execute function public.on_message_insert();

grant select, update on public.conversations to authenticated;
grant select, update, delete on public.conversation_members to authenticated;
grant select, insert, delete on public.messages to authenticated;

-- Realtime: 메시지 테이블만 publication에 넣는다. 채널 권한은 위의 RLS가
-- 그대로 적용되므로 참여자가 아니면 아무 행도 받지 못한다.
do $$ begin
  alter publication supabase_realtime add table public.messages;
exception when duplicate_object then null; end $$;
