-- 소셜 3/3 — 클랜 (커뮤니티 · 직책 · 실시간 채팅 · 공지 · 가입 신청)
--
-- 클랜은 체육관과 별개다: gyms/gym_members(0022)는 실제 수련 장소의 관장-학생
-- 관계이고, 여기는 사용자가 자유롭게 만드는 온라인 모임이다. 두 소속 관계는
-- 서로 참조하지 않는다.

create table if not exists public.clans (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  description text not null default '',
  primary_art text,
  avatar_url text,
  banner_url text,
  rules text not null default '',
  -- 자유 가입 / 신청 후 승인 / 초대 전용
  join_policy text not null default 'open' check (join_policy in ('open', 'request', 'invite')),
  is_public boolean not null default true,
  owner_id uuid not null references auth.users (id) on delete cascade,
  member_count int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists clans_public_idx on public.clans (is_public, created_at desc);
create index if not exists clans_name_idx on public.clans (lower(name));

create table if not exists public.clan_members (
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'officer', 'member')),
  joined_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);
create index if not exists clan_members_user_idx on public.clan_members (user_id);

create table if not exists public.clan_join_requests (
  clan_id uuid not null references public.clans (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  message text not null default '',
  created_at timestamptz not null default now(),
  primary key (clan_id, user_id)
);

create table if not exists public.clan_messages (
  id uuid primary key default gen_random_uuid(),
  clan_id uuid not null references public.clans (id) on delete cascade,
  sender_id uuid not null references auth.users (id) on delete cascade,
  body text not null default '',
  image_url text,
  created_at timestamptz not null default now()
);
create index if not exists clan_messages_clan_idx on public.clan_messages (clan_id, created_at desc);

create table if not exists public.clan_announcements (
  id uuid primary key default gen_random_uuid(),
  clan_id uuid not null references public.clans (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null,
  body text not null default '',
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists clan_announcements_clan_idx on public.clan_announcements (clan_id, pinned desc, created_at desc);

alter table public.clans enable row level security;
alter table public.clan_members enable row level security;
alter table public.clan_join_requests enable row level security;
alter table public.clan_messages enable row level security;
alter table public.clan_announcements enable row level security;

-- ---------- helpers (RLS 재귀 방지: 0023과 같은 이유) ----------
create or replace function public.is_clan_member(p_clan uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.clan_members where clan_id = p_clan and user_id = p_user);
$$;
create or replace function public.clan_role_of(p_clan uuid, p_user uuid)
returns text language sql security definer set search_path = public stable as $$
  select role from public.clan_members where clan_id = p_clan and user_id = p_user;
$$;
create or replace function public.can_manage_clan(p_clan uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select public.clan_role_of(p_clan, p_user) in ('owner', 'officer');
$$;
revoke all on function public.is_clan_member(uuid, uuid) from public;
revoke all on function public.clan_role_of(uuid, uuid) from public;
revoke all on function public.can_manage_clan(uuid, uuid) from public;
grant execute on function public.is_clan_member(uuid, uuid) to anon, authenticated;
grant execute on function public.clan_role_of(uuid, uuid) to anon, authenticated;
grant execute on function public.can_manage_clan(uuid, uuid) to anon, authenticated;

-- ---------- clans ----------
drop policy if exists "clans_select_public_or_member" on public.clans;
-- 비공개 클랜은 탐색/검색에 아예 나오지 않는다
create policy "clans_select_public_or_member" on public.clans for select
  using (is_public or public.is_clan_member(id, auth.uid()));
drop policy if exists "clans_insert_own" on public.clans;
create policy "clans_insert_own" on public.clans for insert with check (owner_id = auth.uid());
drop policy if exists "clans_update_owner" on public.clans;
-- 설정 변경은 방장만 (부방장은 멤버/공지/채팅만)
create policy "clans_update_owner" on public.clans for update
  using (public.clan_role_of(id, auth.uid()) = 'owner');
drop policy if exists "clans_delete_owner" on public.clans;
create policy "clans_delete_owner" on public.clans for delete
  using (public.clan_role_of(id, auth.uid()) = 'owner');

-- ---------- members ----------
drop policy if exists "clan_members_select" on public.clan_members;
create policy "clan_members_select" on public.clan_members for select
  using (
    public.is_clan_member(clan_id, auth.uid())
    or exists (select 1 from public.clans c where c.id = clan_members.clan_id and c.is_public)
  );
drop policy if exists "clan_members_insert_open" on public.clan_members;
-- 자유 가입 클랜만 직접 INSERT. 신청/초대형은 approve_clan_join()을 거친다.
-- 직책은 여기서 절대 'member' 외의 값이 될 수 없다 — 클라이언트가 role을
-- 'owner'로 보내도 WITH CHECK에서 거부된다.
create policy "clan_members_insert_open" on public.clan_members for insert
  with check (
    user_id = auth.uid()
    and role = 'member'
    and exists (select 1 from public.clans c where c.id = clan_members.clan_id and c.join_policy = 'open')
  );
drop policy if exists "clan_members_delete" on public.clan_members;
-- 본인 탈퇴 또는 방장/부방장의 강퇴. 방장 행은 지울 수 없다(이전 먼저).
create policy "clan_members_delete" on public.clan_members for delete
  using (
    (user_id = auth.uid() and role <> 'owner')
    or (public.can_manage_clan(clan_id, auth.uid()) and role = 'member')
  );
-- 직책 변경(UPDATE) 정책 없음 — set_clan_role() RPC로만 가능하다.

-- ---------- join requests ----------
drop policy if exists "clan_join_requests_select" on public.clan_join_requests;
create policy "clan_join_requests_select" on public.clan_join_requests for select
  using (user_id = auth.uid() or public.can_manage_clan(clan_id, auth.uid()));
drop policy if exists "clan_join_requests_insert_own" on public.clan_join_requests;
create policy "clan_join_requests_insert_own" on public.clan_join_requests for insert
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.clans c where c.id = clan_join_requests.clan_id and c.join_policy = 'request')
  );
drop policy if exists "clan_join_requests_delete" on public.clan_join_requests;
create policy "clan_join_requests_delete" on public.clan_join_requests for delete
  using (user_id = auth.uid() or public.can_manage_clan(clan_id, auth.uid()));

-- ---------- chat ----------
drop policy if exists "clan_messages_select_member" on public.clan_messages;
-- 가입자만. 탈퇴/강퇴되면 clan_members 행이 사라지므로 즉시 접근이 끊긴다.
create policy "clan_messages_select_member" on public.clan_messages for select
  using (public.is_clan_member(clan_id, auth.uid()));
drop policy if exists "clan_messages_insert_member" on public.clan_messages;
create policy "clan_messages_insert_member" on public.clan_messages for insert
  with check (sender_id = auth.uid() and public.is_clan_member(clan_id, auth.uid()));
drop policy if exists "clan_messages_delete" on public.clan_messages;
-- 본인 메시지 또는 방장/부방장의 관리 삭제
create policy "clan_messages_delete" on public.clan_messages for delete
  using (sender_id = auth.uid() or public.can_manage_clan(clan_id, auth.uid()));

-- ---------- announcements ----------
drop policy if exists "clan_announcements_select_member" on public.clan_announcements;
create policy "clan_announcements_select_member" on public.clan_announcements for select
  using (public.is_clan_member(clan_id, auth.uid())
         or exists (select 1 from public.clans c where c.id = clan_announcements.clan_id and c.is_public));
drop policy if exists "clan_announcements_write_manager" on public.clan_announcements;
create policy "clan_announcements_write_manager" on public.clan_announcements for insert
  with check (author_id = auth.uid() and public.can_manage_clan(clan_id, auth.uid()));
drop policy if exists "clan_announcements_update_manager" on public.clan_announcements;
create policy "clan_announcements_update_manager" on public.clan_announcements for update
  using (public.can_manage_clan(clan_id, auth.uid()));
drop policy if exists "clan_announcements_delete_manager" on public.clan_announcements;
create policy "clan_announcements_delete_manager" on public.clan_announcements for delete
  using (public.can_manage_clan(clan_id, auth.uid()));

-- ---------- RPCs: 생성 / 승인 / 직책 / 방장 이전 ----------
create or replace function public.create_clan(
  p_name text, p_slug text, p_description text, p_primary_art text,
  p_join_policy text, p_is_public boolean, p_rules text
) returns uuid language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid(); new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  insert into public.clans (name, slug, description, primary_art, join_policy, is_public, rules, owner_id)
  values (p_name, lower(p_slug), coalesce(p_description, ''), p_primary_art,
          coalesce(p_join_policy, 'open'), coalesce(p_is_public, true), coalesce(p_rules, ''), me)
  returning id into new_id;
  insert into public.clan_members (clan_id, user_id, role) values (new_id, me, 'owner');
  return new_id;
end;
$$;

create or replace function public.approve_clan_join(p_clan uuid, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.can_manage_clan(p_clan, auth.uid()) then raise exception 'not a clan manager'; end if;
  if not exists (select 1 from public.clan_join_requests where clan_id = p_clan and user_id = p_user) then
    raise exception 'no such join request';
  end if;
  insert into public.clan_members (clan_id, user_id, role) values (p_clan, p_user, 'member')
    on conflict do nothing;
  delete from public.clan_join_requests where clan_id = p_clan and user_id = p_user;
  perform public.notify(p_user, 'clan_join', auth.uid(), 'clan', p_clan::text, '');
end;
$$;

-- 부방장 임명/해임 — 방장만. 'owner'로는 절대 올릴 수 없다.
create or replace function public.set_clan_role(p_clan uuid, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.clan_role_of(p_clan, auth.uid()) <> 'owner' then raise exception 'owner only'; end if;
  if p_role not in ('officer', 'member') then raise exception 'invalid role'; end if;
  if p_user = auth.uid() then raise exception 'cannot change your own role'; end if;
  update public.clan_members set role = p_role where clan_id = p_clan and user_id = p_user;
end;
$$;

-- 방장 권한 이전 (14-2 "방장이 탈퇴해도 클랜이 방치되지 않도록")
create or replace function public.transfer_clan_ownership(p_clan uuid, p_to uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.clan_role_of(p_clan, auth.uid()) <> 'owner' then raise exception 'owner only'; end if;
  if not public.is_clan_member(p_clan, p_to) then raise exception 'target is not a member'; end if;
  update public.clan_members set role = 'member' where clan_id = p_clan and user_id = auth.uid();
  update public.clan_members set role = 'owner' where clan_id = p_clan and user_id = p_to;
  update public.clans set owner_id = p_to where id = p_clan;
end;
$$;

revoke all on function public.create_clan(text, text, text, text, text, boolean, text) from public;
revoke all on function public.approve_clan_join(uuid, uuid) from public;
revoke all on function public.set_clan_role(uuid, uuid, text) from public;
revoke all on function public.transfer_clan_ownership(uuid, uuid) from public;
grant execute on function public.create_clan(text, text, text, text, text, boolean, text) to authenticated;
grant execute on function public.approve_clan_join(uuid, uuid) to authenticated;
grant execute on function public.set_clan_role(uuid, uuid, text) to authenticated;
grant execute on function public.transfer_clan_ownership(uuid, uuid) to authenticated;

-- ---------- member_count ----------
create or replace function public.on_clan_member_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.clans set member_count = member_count + 1 where id = new.clan_id;
    return new;
  else
    update public.clans set member_count = greatest(member_count - 1, 0) where id = old.clan_id;
    return old;
  end if;
end;
$$;
drop trigger if exists clan_members_count_trigger on public.clan_members;
create trigger clan_members_count_trigger
  after insert or delete on public.clan_members
  for each row execute function public.on_clan_member_change();

grant select, insert, update, delete on public.clans to authenticated;
grant select, insert, delete on public.clan_members to authenticated;
grant select, insert, delete on public.clan_join_requests to authenticated;
grant select, insert, delete on public.clan_messages to authenticated;
grant select, insert, update, delete on public.clan_announcements to authenticated;
grant select on public.clans to anon;
grant select on public.clan_members to anon;

do $$ begin
  alter publication supabase_realtime add table public.clan_messages;
exception when duplicate_object then null; end $$;
