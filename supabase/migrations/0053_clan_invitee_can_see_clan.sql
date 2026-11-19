-- 비공개 클랜에 초대받은 사람이 그 클랜을 볼 수 있게 한다.
--
-- 0047의 clans SELECT 정책은 공개 클랜이거나 이미 멤버인 경우만 허용해서,
-- 비공개 클랜에 초대받은 사람(아직 멤버 아님)은 초대 목록에서 클랜 이름이
-- "(알 수 없는 클랜)"으로 보이고 알림을 눌러도 클랜 화면이 열리지 않았다.
-- 대기 중인 초대가 있는 동안만 보이고, 수락·거절·취소로 초대 행이 지워지면
-- 다시 안 보인다. 비공개 클랜이 탐색/검색에 나오지 않는 것은 그대로다.

create or replace function public.has_clan_invitation(p_clan uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.clan_invitations where clan_id = p_clan and invitee_id = p_user);
$$;
revoke all on function public.has_clan_invitation(uuid, uuid) from public;
grant execute on function public.has_clan_invitation(uuid, uuid) to authenticated;

drop policy if exists "clans_select_public_or_member" on public.clans;
create policy "clans_select_public_or_member" on public.clans for select
  using (is_public or public.is_clan_member(id, auth.uid()) or public.has_clan_invitation(id, auth.uid()));
