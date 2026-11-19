-- 0045의 카운터 트리거는 '앞으로의' INSERT/DELETE만 센다. 이미 존재하던
-- 게시물은 profiles.post_count 에 반영되지 않으므로 한 번 백필한다.
-- follower/following 은 0045에서 처음 생긴 테이블이라 지금은 전부 0이 맞지만,
-- 같은 쿼리를 함께 둬서 이후 재실행만으로 정합성을 맞출 수 있게 한다.

update public.profiles p
   set post_count = coalesce(c.n, 0)
  from (
    select author_id, count(*)::int as n
      from public.community_posts
     group by author_id
  ) c
 where c.author_id = p.user_id
   and p.post_count is distinct from c.n;

update public.profiles p
   set follower_count = coalesce((select count(*) from public.follows f where f.following_id = p.user_id), 0),
       following_count = coalesce((select count(*) from public.follows f where f.follower_id = p.user_id), 0)
 where p.follower_count is distinct from coalesce((select count(*) from public.follows f where f.following_id = p.user_id), 0)
    or p.following_count is distinct from coalesce((select count(*) from public.follows f where f.follower_id = p.user_id), 0);
