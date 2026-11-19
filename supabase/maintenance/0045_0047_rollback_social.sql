-- 롤백 — 0045/0046/0047 (소셜: 프로필·팔로우·DM·클랜)을 적용 전 상태로 되돌린다.
-- 수동 실행 전용. supabase/migrations/ 가 아니라 여기에 두는 이유는 `db push`가
-- 자동으로 집어가지 않게 하기 위해서다.
--
-- 주의: 소셜 기능을 쓴 뒤 실행하면 그 데이터(팔로우·DM·클랜·알림)는 사라진다.
-- 되돌리는 것은 "이 세 마이그레이션이 만든 것"뿐이며, 0001~0044가 만든 기존
-- 테이블과 데이터는 건드리지 않는다.

begin;

-- ---- 0047 clans
drop trigger if exists clan_members_count_trigger on public.clan_members;
drop function if exists public.on_clan_member_change();
drop function if exists public.transfer_clan_ownership(uuid, uuid);
drop function if exists public.set_clan_role(uuid, uuid, text);
drop function if exists public.approve_clan_join(uuid, uuid);
drop function if exists public.create_clan(text, text, text, text, text, boolean, text);
drop table if exists public.clan_announcements cascade;
drop table if exists public.clan_messages cascade;
drop table if exists public.clan_join_requests cascade;
drop table if exists public.clan_members cascade;
drop table if exists public.clans cascade;
drop function if exists public.can_manage_clan(uuid, uuid);
drop function if exists public.clan_role_of(uuid, uuid);
drop function if exists public.is_clan_member(uuid, uuid);

-- ---- 0046 DM
drop trigger if exists messages_after_insert on public.messages;
drop function if exists public.on_message_insert();
drop function if exists public.start_conversation(uuid);
drop table if exists public.messages cascade;
drop table if exists public.conversation_members cascade;
drop table if exists public.conversations cascade;
drop function if exists public.conversation_other_member(uuid, uuid);
drop function if exists public.is_conversation_member(uuid, uuid);

-- ---- 0045 게시물 가시성 정책을 0027 상태로 되돌린다
drop policy if exists "community_posts_select_visible" on public.community_posts;
create policy "community_posts_select_all" on public.community_posts for select using (true);
drop policy if exists "community_post_media_select_visible" on public.community_post_media;
create policy "community_post_media_select_all" on public.community_post_media for select using (true);
drop policy if exists "community_post_comments_select_visible" on public.community_post_comments;
create policy "community_post_comments_select_all" on public.community_post_comments for select using (true);
drop policy if exists "community_post_likes_select_visible" on public.community_post_likes;
create policy "community_post_likes_select_all" on public.community_post_likes for select using (true);
drop policy if exists "community_post_reposts_select_visible" on public.community_post_reposts;
create policy "community_post_reposts_select_all" on public.community_post_reposts for select using (true);

drop trigger if exists community_posts_count_trigger on public.community_posts;
drop function if exists public.on_post_count_change();
-- visibility 컬럼은 남겨둔다 (데이터 손실 없음). 완전히 지우려면:
--   alter table public.community_posts drop column if exists visibility;

-- ---- 0045 소셜 테이블
drop trigger if exists follow_requests_notify_trigger on public.follow_requests;
drop trigger if exists follows_count_trigger on public.follows;
drop function if exists public.on_follow_request_insert();
drop function if exists public.on_follow_change();
drop function if exists public.approve_follow_request(uuid);
drop function if exists public.notify(uuid, text, uuid, text, text, text);
drop table if exists public.notifications cascade;
drop table if exists public.user_reports cascade;
drop table if exists public.follow_requests cascade;
drop table if exists public.follows cascade;
drop function if exists public.is_following(uuid, uuid);
drop table if exists public.user_blocks cascade;
drop function if exists public.is_account_private(uuid);
drop function if exists public.is_blocked_between(uuid, uuid);

-- ---- 0045 profiles 를 0001 의 "본인 행만" 으로 되돌린다
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_own" on public.profiles for select using (auth.uid() = user_id);
revoke select on public.profiles from anon;
-- 추가된 소셜 컬럼은 남겨둔다 (사용자가 입력한 소개/핸들이 사라지지 않도록).

commit;
