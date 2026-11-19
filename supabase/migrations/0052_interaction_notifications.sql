-- 상호작용 알림 — 0045가 notifications.type 에 'like'/'comment'/'repost'를
-- 정의해 두고도 그것을 만드는 트리거가 없어서, 실제로 쌓이던 알림은 팔로우 ·
-- 메시지 · 클랜뿐이었다. 여기서 나머지를 채운다.
--
-- 대상:
--   게시물    좋아요 / 댓글 / 리포스트            → 작성자에게
--   콤보·셋업 좋아요 / 내 콤보를 연결(link)       → 작성자에게
--   커리큘럼  마켓 구매 / 리뷰                     → 판매자에게
--
-- 모두 INSERT 트리거다 — 좋아요를 취소했다가 다시 눌러도 알림이 사라지지는
-- 않지만, 취소 자체로 알림이 생기지도 않는다.

-- 새 유형 3개 (link / purchase / review)를 추가한다.
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type in ('follow', 'follow_request', 'like', 'comment', 'repost', 'message',
           'clan_invite', 'clan_join', 'link', 'purchase', 'review')
);

-- 차단한 상대의 행동은 알림으로도 오지 않아야 한다. 모든 알림이 이 함수를
-- 거치므로 여기 한 곳에서 막으면 기존 경로(팔로우·메시지·클랜)에도 함께 적용된다.
create or replace function public.notify(p_user uuid, p_type text, p_actor uuid, p_entity_type text, p_entity_id text, p_body text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_user is null or p_user = p_actor then return; end if;
  if p_actor is not null and public.is_blocked_between(p_user, p_actor) then return; end if;
  insert into public.notifications (user_id, type, actor_id, entity_type, entity_id, body)
  values (p_user, p_type, p_actor, p_entity_type, p_entity_id, coalesce(p_body, ''));
end;
$$;

-- ---------- 게시물: 좋아요 ----------
create or replace function public.on_post_like_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; snippet text;
begin
  select author_id, left(content, 80) into owner, snippet from public.community_posts where id = new.post_id;
  perform public.notify(owner, 'like', new.user_id, 'post', new.post_id, coalesce(snippet, ''));
  return new;
end;
$$;
drop trigger if exists community_post_likes_notify on public.community_post_likes;
create trigger community_post_likes_notify
  after insert on public.community_post_likes
  for each row execute function public.on_post_like_insert();

-- ---------- 게시물: 댓글 ----------
create or replace function public.on_post_comment_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  select author_id into owner from public.community_posts where id = new.post_id;
  perform public.notify(owner, 'comment', new.author_id, 'post', new.post_id, left(coalesce(new.content, ''), 80));
  return new;
end;
$$;
drop trigger if exists community_post_comments_notify on public.community_post_comments;
create trigger community_post_comments_notify
  after insert on public.community_post_comments
  for each row execute function public.on_post_comment_insert();

-- ---------- 게시물: 리포스트 ----------
-- reposts 테이블은 원작자의 닉네임만 들고 있어(0026) id를 원본에서 찾는다.
create or replace function public.on_post_repost_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid;
begin
  if new.original_post_id is null then return new; end if;
  select author_id into owner from public.community_posts where id = new.original_post_id;
  perform public.notify(owner, 'repost', new.user_id, 'post', new.original_post_id, left(coalesce(new.original_content_snippet, ''), 80));
  return new;
end;
$$;
drop trigger if exists community_post_reposts_notify on public.community_post_reposts;
create trigger community_post_reposts_notify
  after insert on public.community_post_reposts
  for each row execute function public.on_post_repost_insert();

-- ---------- 콤보·셋업: 좋아요 ----------
create or replace function public.on_combo_like_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; cname text;
begin
  select author_id, name into owner, cname from public.shared_combos where id = new.combo_id;
  perform public.notify(owner, 'like', new.user_id, 'combo', new.combo_id, coalesce(cname, ''));
  return new;
end;
$$;
drop trigger if exists shared_combo_likes_notify on public.shared_combo_likes;
create trigger shared_combo_likes_notify
  after insert on public.shared_combo_likes
  for each row execute function public.on_combo_like_insert();

-- ---------- 콤보·셋업: 내 콤보를 자기 흐름에 연결했을 때 ----------
-- 양쪽 콤보의 주인에게 알린다(같은 사람이면 notify가 한 번만 넣고 자기 자신은 건너뛴다).
create or replace function public.on_combo_link_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare from_owner uuid; to_owner uuid; to_name text;
begin
  select author_id into from_owner from public.shared_combos where id = new.from_id;
  select author_id, name into to_owner, to_name from public.shared_combos where id = new.to_id;
  perform public.notify(to_owner, 'link', new.author_id, 'combo', new.to_id, coalesce(to_name, ''));
  if from_owner is distinct from to_owner then
    perform public.notify(from_owner, 'link', new.author_id, 'combo', new.from_id, coalesce(to_name, ''));
  end if;
  return new;
end;
$$;
drop trigger if exists shared_combo_links_notify on public.shared_combo_links;
create trigger shared_combo_links_notify
  after insert on public.shared_combo_links
  for each row execute function public.on_combo_link_insert();

-- ---------- 커리큘럼: 마켓 구매 ----------
create or replace function public.on_marketplace_order_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare t text;
begin
  if new.status <> 'completed' then return new; end if;
  select title into t from public.marketplace_curricula where id = new.curriculum_id;
  perform public.notify(new.seller_user_id, 'purchase', new.buyer_user_id, 'curriculum', new.curriculum_id, coalesce(t, ''));
  return new;
end;
$$;
drop trigger if exists marketplace_orders_notify on public.marketplace_orders;
create trigger marketplace_orders_notify
  after insert on public.marketplace_orders
  for each row execute function public.on_marketplace_order_insert();

-- ---------- 커리큘럼: 마켓 리뷰 ----------
create or replace function public.on_marketplace_review_insert()
returns trigger language plpgsql security definer set search_path = public as $$
declare owner uuid; t text;
begin
  select seller_user_id, title into owner, t from public.marketplace_curricula where id = new.curriculum_id;
  perform public.notify(owner, 'review', new.reviewer_user_id, 'curriculum', new.curriculum_id,
                        coalesce(t, '') || ' · ' || new.rating::text || '점');
  return new;
end;
$$;
drop trigger if exists marketplace_reviews_notify on public.marketplace_reviews;
create trigger marketplace_reviews_notify
  after insert on public.marketplace_reviews
  for each row execute function public.on_marketplace_review_insert();
