-- 통합 플랫폼 2/4 — 숏폼·게시물 기술 평가(퍼센트 투표)
--
-- 별도 피드를 만들지 않는다: 평가 설정은 기존 community_posts 1행에 1:1로 붙는다
-- (숏폼 = 영상이 있는 community_posts 이므로 같은 테이블이 둘 다 담당).
-- 좋아요(community_post_likes)와 완전히 별개다.
--
-- 신뢰성 설계
--   * 투표 행은 본인만 읽을 수 있다(RLS). 다른 사람의 개별 점수는 어떤 경로로도 내려가지 않는다.
--   * 쓰기 정책이 없다 — 투표·변경·철회는 SECURITY DEFINER RPC 로만 가능하며,
--     RPC 가 공개범위·차단·기간·자기 투표·점수 범위·평가 항목·속도 제한을 서버에서 검사한다.
--   * (post_id, voter_id) 기본키 → 사용자당 콘텐츠별 유효 투표 1개. 변경하면 같은 행을 덮어쓰므로
--     최신 점수만 집계된다.
--   * 통계는 get_technique_evaluation_stats() 가 매 호출마다 유효 투표에서 직접 계산한다.
--     클라이언트가 보낸 숫자를 저장하는 집계 컬럼이 없으므로 요청 조작으로 평균·참여자 수를 바꿀 수 없다.
--   * 그룹 평균은 3명 미만이면 숨긴다(소수 그룹에서 개인 점수가 역산되지 않도록).
--   * 평가자 그룹은 verified_credentials(0055, 플랫폼 관리자만 기록)만 쓴다. 자기 신고는 '미검증'.
--   * 작성자와 같은 체육관(gym_members) 회원의 표를 뺀 평균을 따로 낸다(체육관 내부 편향 확인용).

-- ============ 1. 게시물 공개범위 판정 (0045 정책과 같은 식) ============
create or replace function public.can_view_community_post(p_post text, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.community_posts p
    where p.id = p_post
      and (
        p.author_id = p_user
        or (
          not public.is_blocked_between(p.author_id, p_user)
          and (
            (p.visibility = 'public' and not public.is_account_private(p.author_id))
            or (p.visibility = 'public' and public.is_following(p_user, p.author_id))
            or (p.visibility = 'followers' and public.is_following(p_user, p.author_id))
          )
        )
      )
  );
$$;
revoke all on function public.can_view_community_post(text, uuid) from public;
grant execute on function public.can_view_community_post(text, uuid) to anon, authenticated;

-- ============ 2. 평가 설정 ============
create table if not exists public.technique_evaluations (
  post_id text primary key references public.community_posts (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  martial_art text not null check (char_length(martial_art) between 1 and 60),
  technique_id text,
  technique_name text not null check (char_length(technique_name) between 1 and 120),
  criteria text[] not null check (
    cardinality(criteria) between 1 and 8
    and criteria <@ array['stance', 'balance', 'accuracy', 'distance', 'timing', 'speed', 'completeness',
                          'power', 'guard', 'footwork', 'transition', 'control', 'grip', 'base', 'recovery']::text[]
  ),
  results_visibility text not null default 'public' check (results_visibility in ('public', 'author_only')),
  allow_self_vote boolean not null default false,
  opens_at timestamptz not null default now(),
  closes_at timestamptz,
  closed_at timestamptz,
  created_at timestamptz not null default now(),
  check (closes_at is null or closes_at > opens_at)
);
create index if not exists technique_evaluations_author_idx on public.technique_evaluations (author_id, created_at desc);
create index if not exists technique_evaluations_art_idx on public.technique_evaluations (martial_art);
alter table public.technique_evaluations enable row level security;

drop policy if exists "technique_evaluations_select_visible" on public.technique_evaluations;
create policy "technique_evaluations_select_visible" on public.technique_evaluations for select
  using (public.can_view_community_post(post_id, auth.uid()));
drop policy if exists "technique_evaluations_insert_author" on public.technique_evaluations;
create policy "technique_evaluations_insert_author" on public.technique_evaluations for insert with check (
  author_id = auth.uid()
  and exists (select 1 from public.community_posts p where p.id = post_id and p.author_id = auth.uid())
);
drop policy if exists "technique_evaluations_update_author" on public.technique_evaluations;
create policy "technique_evaluations_update_author" on public.technique_evaluations for update using (author_id = auth.uid());
drop policy if exists "technique_evaluations_delete_author" on public.technique_evaluations;
create policy "technique_evaluations_delete_author" on public.technique_evaluations for delete using (author_id = auth.uid());
grant select on public.technique_evaluations to anon, authenticated;
grant insert, update, delete on public.technique_evaluations to authenticated;

-- 투표가 시작된 뒤에는 평가 대상·항목을 바꿀 수 없다(이미 낸 점수의 의미가 바뀌므로).
-- 공개범위 · 마감 · 종료는 언제든 바꿀 수 있다. 종료 후 다시 열 수는 없다(결과 보존).
create or replace function public.trg_technique_evaluation_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.post_id is distinct from old.post_id or new.author_id is distinct from old.author_id then
    raise exception 'evaluation keys are immutable';
  end if;
  if exists (select 1 from public.technique_votes v where v.post_id = old.post_id) then
    if new.criteria is distinct from old.criteria or new.martial_art is distinct from old.martial_art
       or new.technique_id is distinct from old.technique_id or new.technique_name is distinct from old.technique_name
       or new.opens_at is distinct from old.opens_at or new.allow_self_vote is distinct from old.allow_self_vote then
      raise exception 'criteria and target cannot change after voting started';
    end if;
  end if;
  if old.closed_at is not null and new.closed_at is null then
    raise exception 'a closed evaluation cannot be reopened';
  end if;
  return new;
end;
$$;

-- ============ 3. 투표 ============
create table if not exists public.technique_votes (
  post_id text not null references public.technique_evaluations (post_id) on delete cascade,
  voter_id uuid not null references auth.users (id) on delete cascade,
  scores jsonb not null check (jsonb_typeof(scores) = 'object'),
  feedback jsonb not null default '{}'::jsonb check (jsonb_typeof(feedback) = 'object' and pg_column_size(feedback) < 16384),
  comment text not null default '' check (char_length(comment) <= 500),
  status text not null default 'valid' check (status in ('valid', 'withdrawn', 'invalidated')),
  invalidated_reason text,
  helpful boolean not null default false,
  revision int not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (post_id, voter_id)
);
create index if not exists technique_votes_voter_idx on public.technique_votes (voter_id, updated_at desc);
alter table public.technique_votes enable row level security;
drop policy if exists "technique_votes_select_own" on public.technique_votes;
create policy "technique_votes_select_own" on public.technique_votes for select using (voter_id = auth.uid());
grant select on public.technique_votes to authenticated;
-- INSERT/UPDATE/DELETE 권한 없음 — RPC 전용

drop trigger if exists technique_evaluations_guard on public.technique_evaluations;
create trigger technique_evaluations_guard before update on public.technique_evaluations
  for each row execute function public.trg_technique_evaluation_guard();

-- 피드백 한 건의 익명 id (작성자가 "유용함" 표시·신고할 때 쓴다; 투표자 id 는 노출하지 않음)
create or replace function public.technique_feedback_id(p_post text, p_voter uuid)
returns text language sql immutable as $$ select md5(p_post || ':' || p_voter::text) $$;

create or replace function public.technique_evaluation_is_open(e public.technique_evaluations)
returns boolean language sql stable as $$
  select e.closed_at is null and now() >= e.opens_at and (e.closes_at is null or now() < e.closes_at);
$$;

create or replace function public.cast_technique_vote(p_post text, p_scores jsonb, p_feedback jsonb default '{}'::jsonb, p_comment text default '')
returns void language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  e public.technique_evaluations;
  k text;
  v jsonb;
  n int := 0;
  recent int;
  prev_status text;
  fb jsonb := coalesce(p_feedback, '{}'::jsonb);
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into e from public.technique_evaluations where post_id = p_post;
  if not found then raise exception 'evaluation not found'; end if;
  if not public.can_view_community_post(p_post, me) then raise exception 'post not visible'; end if;
  if not public.technique_evaluation_is_open(e) then raise exception 'evaluation closed'; end if;
  if e.author_id = me and not e.allow_self_vote then raise exception 'self vote not allowed'; end if;
  if public.is_blocked_between(e.author_id, me) then raise exception 'blocked'; end if;

  if p_scores is null or jsonb_typeof(p_scores) <> 'object' then raise exception 'scores must be an object'; end if;
  for k, v in select * from jsonb_each(p_scores) loop
    if not (k = any (e.criteria)) then raise exception 'unknown criterion %', k; end if;
    if jsonb_typeof(v) <> 'number' or (v::text)::numeric <> trunc((v::text)::numeric)
       or (v::text)::numeric < 0 or (v::text)::numeric > 100 then
      raise exception 'score for % must be an integer 0..100', k;
    end if;
    n := n + 1;
  end loop;
  if n = 0 then raise exception 'at least one score is required'; end if;

  if jsonb_typeof(fb) <> 'object' then raise exception 'feedback must be an object'; end if;
  for k, v in select * from jsonb_each(fb) loop
    if not (k = any (e.criteria)) then raise exception 'unknown feedback criterion %', k; end if;
    if jsonb_typeof(v) <> 'string' or char_length(v #>> '{}') > 300 then raise exception 'feedback text too long'; end if;
  end loop;

  -- 자동화·연타 방지: 1분에 20건, 하루 300건을 넘으면 거절
  select count(*) into recent from public.technique_votes where voter_id = me and updated_at > now() - interval '1 minute';
  if recent >= 20 then raise exception 'too many votes, slow down'; end if;
  select count(*) into recent from public.technique_votes where voter_id = me and updated_at > now() - interval '1 day';
  if recent >= 300 then raise exception 'daily vote limit reached'; end if;

  select status into prev_status from public.technique_votes where post_id = p_post and voter_id = me;
  if prev_status = 'invalidated' then raise exception 'this vote was invalidated by moderation'; end if;

  insert into public.technique_votes (post_id, voter_id, scores, feedback, comment)
  values (p_post, me, p_scores, fb, left(coalesce(p_comment, ''), 500))
  on conflict (post_id, voter_id) do update
    set scores = excluded.scores, feedback = excluded.feedback, comment = excluded.comment,
        status = 'valid', helpful = false, revision = public.technique_votes.revision + 1, updated_at = now();
end;
$$;
revoke all on function public.cast_technique_vote(text, jsonb, jsonb, text) from public;
grant execute on function public.cast_technique_vote(text, jsonb, jsonb, text) to authenticated;

create or replace function public.withdraw_technique_vote(p_post text)
returns void language plpgsql security definer set search_path = public as $$
declare e public.technique_evaluations;
begin
  if auth.uid() is null then raise exception 'not authenticated'; end if;
  select * into e from public.technique_evaluations where post_id = p_post;
  if not found then raise exception 'evaluation not found'; end if;
  if not public.technique_evaluation_is_open(e) then raise exception 'evaluation closed'; end if;
  update public.technique_votes set status = 'withdrawn', updated_at = now()
   where post_id = p_post and voter_id = auth.uid() and status = 'valid';
end;
$$;
revoke all on function public.withdraw_technique_vote(text) from public;
grant execute on function public.withdraw_technique_vote(text) to authenticated;

-- 평가자의 검증 등급 (이 무술 또는 '*', 취소되지 않은 것 중 가장 높은 등급; 없으면 'unverified')
create or replace function public.rater_tier(p_user uuid, p_art text)
returns text language sql security definer set search_path = public stable as $$
  select coalesce((
    select c.tier from public.verified_credentials c
    where c.user_id = p_user and c.revoked_at is null and (c.martial_art = p_art or c.martial_art = '*')
    order by case c.tier when 'instructor' then 4 when 'advanced' then 3 when 'intermediate' then 2 else 1 end desc
    limit 1
  ), 'unverified');
$$;

create or replace function public.shares_gym(a uuid, b uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.gym_members m1 join public.gym_members m2 on m1.gym_id = m2.gym_id
    where m1.user_id = a and m2.user_id = b
  );
$$;

-- ============ 4. 집계 (서버에서 매번 계산) ============
create or replace function public.get_technique_evaluation_stats(p_post text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  me uuid := auth.uid();
  e public.technique_evaluations;
  participants int;
  result jsonb;
  min_group int := 3;
begin
  select * into e from public.technique_evaluations where post_id = p_post;
  if not found then return null; end if;
  if not public.can_view_community_post(p_post, me) then return null; end if;

  select count(*) into participants from public.technique_votes where post_id = p_post and status = 'valid';

  if e.results_visibility = 'author_only' and me is distinct from e.author_id then
    return jsonb_build_object('hidden', true, 'participants', participants,
      'open', public.technique_evaluation_is_open(e), 'closesAt', e.closes_at, 'closedAt', e.closed_at);
  end if;

  with v as (
    select t.voter_id, t.scores, public.rater_tier(t.voter_id, e.martial_art) as tier,
           public.shares_gym(t.voter_id, e.author_id) as same_gym
    from public.technique_votes t where t.post_id = p_post and t.status = 'valid'
  ),
  s as (
    select v.voter_id, v.tier, v.same_gym, c.key as criterion, (c.value #>> '{}')::numeric as score
    from v cross join lateral jsonb_each(v.scores) c
    where c.key = any (e.criteria)
  ),
  overall as (
    select criterion, count(*) as n, round(avg(score), 1) as avg,
           jsonb_build_array(
             count(*) filter (where score < 20), count(*) filter (where score >= 20 and score < 40),
             count(*) filter (where score >= 40 and score < 60), count(*) filter (where score >= 60 and score < 80),
             count(*) filter (where score >= 80)) as dist
    from s group by criterion
  ),
  grp as (
    select tier, count(distinct voter_id) as voters from v group by tier
  ),
  grp_avg as (
    select s.tier, s.criterion, count(*) as n, round(avg(s.score), 1) as avg from s group by s.tier, s.criterion
  ),
  outside as (
    select criterion, count(*) as n, round(avg(score), 1) as avg from s where not same_gym group by criterion
  )
  select jsonb_build_object(
    'hidden', false,
    'participants', participants,
    'open', public.technique_evaluation_is_open(e),
    'opensAt', e.opens_at, 'closesAt', e.closes_at, 'closedAt', e.closed_at,
    'criteria', to_jsonb(e.criteria),
    'overall', coalesce((select jsonb_object_agg(criterion, jsonb_build_object('n', n, 'avg', avg, 'dist', dist)) from overall), '{}'::jsonb),
    'groups', coalesce((
      select jsonb_object_agg(g.tier, case when g.voters < min_group
        then jsonb_build_object('voters', g.voters, 'suppressed', true)
        else jsonb_build_object('voters', g.voters, 'suppressed', false,
          'avg', coalesce((select jsonb_object_agg(a.criterion, a.avg) from grp_avg a where a.tier = g.tier), '{}'::jsonb))
        end)
      from grp g), '{}'::jsonb),
    'sameGymVoters', (select count(*) from v where same_gym),
    'outsideGym', case when (select count(*) from v where not same_gym) < min_group
      then jsonb_build_object('voters', (select count(*) from v where not same_gym), 'suppressed', true)
      else jsonb_build_object('voters', (select count(*) from v where not same_gym), 'suppressed', false,
        'avg', coalesce((select jsonb_object_agg(criterion, avg) from outside), '{}'::jsonb)) end,
    'minGroupSize', min_group
  ) into result;
  return result;
end;
$$;
revoke all on function public.get_technique_evaluation_stats(text) from public;
grant execute on function public.get_technique_evaluation_stats(text) to anon, authenticated;

-- 항목별 피드백 (익명). 작성자에게는 항상, 다른 사람에게는 결과 공개일 때만.
create or replace function public.list_technique_feedback(p_post text)
returns table (feedback_id text, feedback jsonb, comment text, helpful boolean, updated_at timestamptz)
language plpgsql security definer set search_path = public stable as $$
declare e public.technique_evaluations; me uuid := auth.uid();
begin
  select * into e from public.technique_evaluations where post_id = p_post;
  if not found or not public.can_view_community_post(p_post, me) then return; end if;
  if e.results_visibility = 'author_only' and me is distinct from e.author_id then return; end if;
  return query
    select public.technique_feedback_id(t.post_id, t.voter_id), t.feedback, t.comment, t.helpful, t.updated_at
    from public.technique_votes t
    where t.post_id = p_post and t.status = 'valid' and (t.feedback <> '{}'::jsonb or t.comment <> '')
      and not public.is_blocked_between(t.voter_id, me)
    order by t.helpful desc, t.updated_at desc
    limit 200;
end;
$$;
revoke all on function public.list_technique_feedback(text) from public;
grant execute on function public.list_technique_feedback(text) to anon, authenticated;

create or replace function public.mark_technique_feedback_helpful(p_post text, p_feedback_id text, p_helpful boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.technique_evaluations where post_id = p_post and author_id = auth.uid()) then
    raise exception 'only the author can mark feedback';
  end if;
  update public.technique_votes set helpful = p_helpful
   where post_id = p_post and public.technique_feedback_id(post_id, voter_id) = p_feedback_id;
end;
$$;
revoke all on function public.mark_technique_feedback_helpful(text, text, boolean) from public;
grant execute on function public.mark_technique_feedback_helpful(text, text, boolean) to authenticated;

-- 부정 투표 무효화 (플랫폼 관리자 — 신고 처리). 무효 투표는 통계에서 빠지고 투표자가 되살릴 수 없다.
create or replace function public.invalidate_technique_vote(p_post text, p_feedback_id text, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  update public.technique_votes set status = 'invalidated', invalidated_reason = coalesce(p_reason, ''), updated_at = now()
   where post_id = p_post and public.technique_feedback_id(post_id, voter_id) = p_feedback_id;
  if not found then raise exception 'vote not found'; end if;
end;
$$;
revoke all on function public.invalidate_technique_vote(text, text, text) from public;
grant execute on function public.invalidate_technique_vote(text, text, text) to authenticated;

-- 프로필: 내가(또는 그 사용자가) 받은 기술 평가 요약 — 결과 공개 평가만, 볼 수 있는 게시물만.
create or replace function public.get_user_evaluation_summary(p_user uuid)
returns jsonb language sql security definer set search_path = public stable as $$
  with e as (
    select ev.* from public.technique_evaluations ev
    where ev.author_id = p_user
      and public.can_view_community_post(ev.post_id, auth.uid())
      and (ev.results_visibility = 'public' or auth.uid() = p_user)
  ),
  per as (
    select e.post_id, e.martial_art, e.technique_name,
           (select count(*) from public.technique_votes t where t.post_id = e.post_id and t.status = 'valid') as voters,
           (select round(avg((c.value #>> '{}')::numeric), 1)
              from public.technique_votes t cross join lateral jsonb_each(t.scores) c
              where t.post_id = e.post_id and t.status = 'valid') as avg
    from e
  )
  select jsonb_build_object(
    'evaluations', (select count(*) from per),
    'totalVoters', coalesce((select sum(voters) from per), 0),
    'items', coalesce((select jsonb_agg(jsonb_build_object('postId', post_id, 'martialArt', martial_art,
               'techniqueName', technique_name, 'voters', voters, 'avg', case when voters > 0 then avg end))
             from (select * from per order by voters desc limit 20) x), '[]'::jsonb)
  );
$$;
revoke all on function public.get_user_evaluation_summary(uuid) from public;
grant execute on function public.get_user_evaluation_summary(uuid) to anon, authenticated;
