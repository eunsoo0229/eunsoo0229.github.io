-- 클랜 초대 (기획 14-1 "초대 전용", 16 clan_invitations).
--
-- 0047은 join_policy에 'invite'를 두면서 초대 자체를 만들지 않아, 초대 전용
-- 클랜에 들어갈 방법이 없었다. clan_members의 INSERT 정책은 join_policy='open'
-- 인 클랜만 허용하므로, 초대 수락은 아래 RPC를 거쳐야만 가능하다.
-- 0045의 notifications.type에 이미 'clan_invite'가 있다 — 여기서 처음 쓴다.

create table if not exists public.clan_invitations (
  clan_id uuid not null references public.clans (id) on delete cascade,
  invitee_id uuid not null references auth.users (id) on delete cascade,
  inviter_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (clan_id, invitee_id)
);
create index if not exists clan_invitations_invitee_idx on public.clan_invitations (invitee_id, created_at desc);

alter table public.clan_invitations enable row level security;

drop policy if exists "clan_invitations_select" on public.clan_invitations;
-- 받은 사람 본인, 또는 그 클랜의 방장·부방장만 볼 수 있다.
create policy "clan_invitations_select" on public.clan_invitations for select
  using (invitee_id = auth.uid() or public.can_manage_clan(clan_id, auth.uid()));

drop policy if exists "clan_invitations_insert_manager" on public.clan_invitations;
-- 초대는 방장·부방장만. inviter_id는 클라이언트 입력을 믿지 않고 auth.uid()와
-- 같아야 통과하며, 차단 관계면 거부된다.
create policy "clan_invitations_insert_manager" on public.clan_invitations for insert
  with check (
    inviter_id = auth.uid()
    and public.can_manage_clan(clan_id, auth.uid())
    and invitee_id <> auth.uid()
    and not public.is_blocked_between(auth.uid(), invitee_id)
    and not public.is_clan_member(clan_id, invitee_id)
  );

drop policy if exists "clan_invitations_delete" on public.clan_invitations;
-- 받은 사람이 거절하거나, 관리자가 취소한다.
create policy "clan_invitations_delete" on public.clan_invitations for delete
  using (invitee_id = auth.uid() or public.can_manage_clan(clan_id, auth.uid()));

-- 수락 — clan_members의 INSERT 정책이 open 클랜만 허용하므로 이 경로밖에 없다.
create or replace function public.accept_clan_invitation(p_clan uuid)
returns void language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.clan_invitations where clan_id = p_clan and invitee_id = me) then
    raise exception 'no such invitation';
  end if;
  insert into public.clan_members (clan_id, user_id, role) values (p_clan, me, 'member')
    on conflict do nothing;
  delete from public.clan_invitations where clan_id = p_clan and invitee_id = me;
end;
$$;
revoke all on function public.accept_clan_invitation(uuid) from public;
grant execute on function public.accept_clan_invitation(uuid) to authenticated;

-- 초대받은 사람에게 알림
create or replace function public.on_clan_invitation_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare cname text;
begin
  select name into cname from public.clans where id = new.clan_id;
  perform public.notify(new.invitee_id, 'clan_invite', new.inviter_id, 'clan', new.clan_id::text, coalesce(cname, ''));
  return new;
end;
$$;
drop trigger if exists clan_invitations_notify_trigger on public.clan_invitations;
create trigger clan_invitations_notify_trigger
  after insert on public.clan_invitations
  for each row execute function public.on_clan_invitation_insert();

grant select, insert, delete on public.clan_invitations to authenticated;
