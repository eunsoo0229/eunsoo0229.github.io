-- 소셜 1/3 — 공개 프로필 · 팔로우 · 차단 · 신고 · 알림 · 게시물 공개범위
--
-- 0001_profiles.sql made `profiles` strictly own-row-only. A social graph
-- needs other people's profiles to be readable, so the SELECT policy is
-- widened here. That is safe for THIS table specifically because every
-- column on it is already public elsewhere: `nickname` is denormalised into
-- community_posts.author_nickname, which 0027 made world-readable. Writes
-- stay own-row-only, and nothing private (email, auth metadata, training
-- records) lives on profiles.
--
-- Object order matters: helper functions are created before the policies
-- that call them, and the tables they read before that again.

-- ============ 1. profiles: social columns ============
alter table public.profiles
  add column if not exists handle text,
  add column if not exists bio text not null default '',
  add column if not exists avatar_url text,
  add column if not exists primary_art text,
  add column if not exists years_training int,
  add column if not exists gym_name text,
  -- 비공개 계정: 팔로우 요청 승인 후에만 콘텐츠를 볼 수 있다
  add column if not exists is_private boolean not null default false,
  -- 탭별 공개 범위 (1-1 "각 탭은 개별적으로 공개/비공개")
  add column if not exists show_likes boolean not null default false,
  add column if not exists show_reposts boolean not null default true,
  add column if not exists dm_policy text not null default 'everyone',
  add column if not exists follower_count int not null default 0,
  add column if not exists following_count int not null default 0,
  add column if not exists post_count int not null default 0;

do $$ begin
  alter table public.profiles add constraint profiles_dm_policy_check
    check (dm_policy in ('everyone', 'followers', 'nobody'));
exception when duplicate_object then null; end $$;

create unique index if not exists profiles_handle_key on public.profiles (lower(handle)) where handle is not null;
create index if not exists profiles_nickname_idx on public.profiles (lower(nickname));

drop policy if exists "profiles_select_own" on public.profiles;
drop policy if exists "profiles_select_all" on public.profiles;
create policy "profiles_select_all" on public.profiles for select using (true);
grant select on public.profiles to anon, authenticated;

-- ============ 2. blocks (팔로우 정책이 참조하므로 먼저) ============
create table if not exists public.user_blocks (
  blocker_id uuid not null references auth.users (id) on delete cascade,
  blocked_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_id, blocked_id),
  constraint user_blocks_no_self check (blocker_id <> blocked_id)
);
alter table public.user_blocks enable row level security;
drop policy if exists "user_blocks_select_own" on public.user_blocks;
create policy "user_blocks_select_own" on public.user_blocks for select using (blocker_id = auth.uid());
drop policy if exists "user_blocks_insert_own" on public.user_blocks;
create policy "user_blocks_insert_own" on public.user_blocks for insert with check (blocker_id = auth.uid());
drop policy if exists "user_blocks_delete_own" on public.user_blocks;
create policy "user_blocks_delete_own" on public.user_blocks for delete using (blocker_id = auth.uid());

-- 차단은 양방향으로 막는다. SECURITY DEFINER라 user_blocks의 "내 행만 보임"
-- 정책에 걸리지 않고 반대 방향(상대가 나를 차단)도 확인할 수 있다.
create or replace function public.is_blocked_between(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.user_blocks
    where (blocker_id = a and blocked_id = b) or (blocker_id = b and blocked_id = a)
  );
$$;
revoke all on function public.is_blocked_between(uuid, uuid) from public;
grant execute on function public.is_blocked_between(uuid, uuid) to anon, authenticated;

create or replace function public.is_account_private(p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select is_private from public.profiles where user_id = p_user), false);
$$;
revoke all on function public.is_account_private(uuid) from public;
grant execute on function public.is_account_private(uuid) to anon, authenticated;

-- ============ 3. follows ============
create table if not exists public.follows (
  follower_id uuid not null references auth.users (id) on delete cascade,
  following_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (follower_id, following_id),
  constraint follows_no_self check (follower_id <> following_id)
);
create index if not exists follows_following_idx on public.follows (following_id, created_at desc);
create index if not exists follows_follower_idx on public.follows (follower_id, created_at desc);

alter table public.follows enable row level security;
drop policy if exists "follows_select_all" on public.follows;
create policy "follows_select_all" on public.follows for select using (true);
drop policy if exists "follows_insert_own" on public.follows;
-- 비공개 계정은 바로 팔로우할 수 없다 — follow_requests + approve를 거쳐야 한다.
create policy "follows_insert_own" on public.follows for insert
  with check (
    follower_id = auth.uid()
    and not public.is_blocked_between(follower_id, following_id)
    and not public.is_account_private(following_id)
  );
drop policy if exists "follows_delete_own" on public.follows;
-- 본인이 언팔로우하거나, 상대가 내 팔로워를 제거할 수 있다
create policy "follows_delete_own" on public.follows for delete
  using (follower_id = auth.uid() or following_id = auth.uid());

create or replace function public.is_following(p_follower uuid, p_following uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.follows where follower_id = p_follower and following_id = p_following);
$$;
revoke all on function public.is_following(uuid, uuid) from public;
grant execute on function public.is_following(uuid, uuid) to anon, authenticated;

-- ============ 4. follow requests (비공개 계정) ============
create table if not exists public.follow_requests (
  requester_id uuid not null references auth.users (id) on delete cascade,
  target_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (requester_id, target_id),
  constraint follow_requests_no_self check (requester_id <> target_id)
);
create index if not exists follow_requests_target_idx on public.follow_requests (target_id, created_at desc);

alter table public.follow_requests enable row level security;
drop policy if exists "follow_requests_select_party" on public.follow_requests;
create policy "follow_requests_select_party" on public.follow_requests for select
  using (requester_id = auth.uid() or target_id = auth.uid());
drop policy if exists "follow_requests_insert_own" on public.follow_requests;
create policy "follow_requests_insert_own" on public.follow_requests for insert
  with check (requester_id = auth.uid() and not public.is_blocked_between(requester_id, target_id));
drop policy if exists "follow_requests_delete_party" on public.follow_requests;
-- 요청자는 취소, 대상자는 거절 — 승인은 approve_follow_request()로만
create policy "follow_requests_delete_party" on public.follow_requests for delete
  using (requester_id = auth.uid() or target_id = auth.uid());

-- ============ 5. reports ============
create table if not exists public.user_reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references auth.users (id) on delete cascade,
  target_type text not null check (target_type in ('user', 'post', 'comment', 'message', 'clan')),
  target_id text not null,
  reason text not null,
  detail text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists user_reports_target_idx on public.user_reports (target_type, target_id);
alter table public.user_reports enable row level security;
drop policy if exists "user_reports_insert_own" on public.user_reports;
create policy "user_reports_insert_own" on public.user_reports for insert with check (reporter_id = auth.uid());
drop policy if exists "user_reports_select_own" on public.user_reports;
create policy "user_reports_select_own" on public.user_reports for select using (reporter_id = auth.uid());

-- ============ 6. notifications ============
create table if not exists public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  type text not null check (type in ('follow', 'follow_request', 'like', 'comment', 'repost', 'message', 'clan_invite', 'clan_join')),
  actor_id uuid references auth.users (id) on delete cascade,
  entity_type text,
  entity_id text,
  body text not null default '',
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on public.notifications (user_id, created_at desc);
alter table public.notifications enable row level security;
drop policy if exists "notifications_select_own" on public.notifications;
create policy "notifications_select_own" on public.notifications for select using (user_id = auth.uid());
drop policy if exists "notifications_update_own" on public.notifications;
create policy "notifications_update_own" on public.notifications for update using (user_id = auth.uid());
drop policy if exists "notifications_delete_own" on public.notifications;
create policy "notifications_delete_own" on public.notifications for delete using (user_id = auth.uid());
-- 알림 행은 트리거(SECURITY DEFINER)만 만든다 — 클라이언트 INSERT 정책 없음.

create or replace function public.notify(p_user uuid, p_type text, p_actor uuid, p_entity_type text, p_entity_id text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, body)
  values (p_user, p_type, p_actor, p_entity_type, p_entity_id, coalesce(p_body, ''));
end;
$$;

-- ============ 7. 승인 RPC ============
create or replace function public.approve_follow_request(p_requester uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  if not exists (select 1 from public.follow_requests
                 where requester_id = p_requester and target_id = auth.uid()) then
    raise exception 'no such follow request';
  end if;
  insert into public.follows (follower_id, following_id)
  values (p_requester, auth.uid())
  on conflict do nothing;
  delete from public.follow_requests where requester_id = p_requester and target_id = auth.uid();
end;
$$;
revoke all on function public.approve_follow_request(uuid) from public;
grant execute on function public.approve_follow_request(uuid) to authenticated;

-- ============ 8. counts + 알림 트리거 ============
create or replace function public.on_follow_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set follower_count = follower_count + 1 where user_id = new.following_id;
    update public.profiles set following_count = following_count + 1 where user_id = new.follower_id;
    perform public.notify(new.following_id, 'follow', new.follower_id, 'user', new.follower_id::text, '');
    return new;
  else
    update public.profiles set follower_count = greatest(follower_count - 1, 0) where user_id = old.following_id;
    update public.profiles set following_count = greatest(following_count - 1, 0) where user_id = old.follower_id;
    return old;
  end if;
end;
$$;
drop trigger if exists follows_count_trigger on public.follows;
create trigger follows_count_trigger
  after insert or delete on public.follows
  for each row execute function public.on_follow_change();

create or replace function public.on_follow_request_insert()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.notify(new.target_id, 'follow_request', new.requester_id, 'user', new.requester_id::text, '');
  return new;
end;
$$;
drop trigger if exists follow_requests_notify_trigger on public.follow_requests;
create trigger follow_requests_notify_trigger
  after insert on public.follow_requests
  for each row execute function public.on_follow_request_insert();

-- ============ 9. 게시물 공개범위 ============
alter table public.community_posts
  add column if not exists visibility text not null default 'public';
do $$ begin
  alter table public.community_posts add constraint community_posts_visibility_check
    check (visibility in ('public', 'followers', 'private'));
exception when duplicate_object then null; end $$;
create index if not exists community_posts_author_idx on public.community_posts (author_id, created_at desc);

-- 기존 0027의 "누구나 읽기"를 공개범위 기준으로 좁힌다. 기본값이 'public'
-- 이라 지금 존재하는 모든 게시물의 가시성은 바뀌지 않는다.
drop policy if exists "community_posts_select_all" on public.community_posts;
create policy "community_posts_select_visible" on public.community_posts for select
  using (
    author_id = auth.uid()
    or (
      not public.is_blocked_between(author_id, auth.uid())
      and (
        (visibility = 'public' and not public.is_account_private(author_id))
        or (visibility = 'public' and public.is_following(auth.uid(), author_id))
        or (visibility = 'followers' and public.is_following(auth.uid(), author_id))
      )
    )
  );

-- 작성자의 post_count 유지
create or replace function public.on_post_count_change()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.profiles set post_count = post_count + 1 where user_id = new.author_id;
    return new;
  else
    update public.profiles set post_count = greatest(post_count - 1, 0) where user_id = old.author_id;
    return old;
  end if;
end;
$$;
drop trigger if exists community_posts_count_trigger on public.community_posts;
create trigger community_posts_count_trigger
  after insert or delete on public.community_posts
  for each row execute function public.on_post_count_change();

grant select, insert, delete on public.follows to authenticated;
grant select, insert, delete on public.follow_requests to authenticated;
grant select, insert, delete on public.user_blocks to authenticated;
grant select, insert on public.user_reports to authenticated;
grant select, update, delete on public.notifications to authenticated;

-- ============ 10. 게시물 하위 테이블도 같은 가시성으로 ============
-- 게시물 행만 막고 미디어/댓글을 'using (true)'로 두면 비공개 게시물의 사진과
-- 댓글이 그대로 읽힌다. 부모 게시물에 EXISTS를 걸면 community_posts의 RLS가
-- 그 서브쿼리에도 적용되므로 가시성 규칙이 한 곳에서만 정의된다.
drop policy if exists "community_post_media_select_all" on public.community_post_media;
create policy "community_post_media_select_visible" on public.community_post_media for select
  using (exists (select 1 from public.community_posts p where p.id = community_post_media.post_id));

drop policy if exists "community_post_comments_select_all" on public.community_post_comments;
create policy "community_post_comments_select_visible" on public.community_post_comments for select
  using (exists (select 1 from public.community_posts p where p.id = community_post_comments.post_id));

drop policy if exists "community_post_likes_select_all" on public.community_post_likes;
create policy "community_post_likes_select_visible" on public.community_post_likes for select
  using (exists (select 1 from public.community_posts p where p.id = community_post_likes.post_id));

-- reposts key the original by `original_post_id` (nullable: 0026 sets it to
-- NULL when the original is deleted). A repost whose original is gone — or
-- is no longer visible to this viewer — therefore drops out of the feed,
-- which is exactly the behaviour the spec asks for.
drop policy if exists "community_post_reposts_select_all" on public.community_post_reposts;
create policy "community_post_reposts_select_visible" on public.community_post_reposts for select
  using (exists (select 1 from public.community_posts p where p.id = community_post_reposts.original_post_id));
