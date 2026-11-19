-- 수익화 3/4 — 디지털 콘텐츠 마켓 · 창작자 · 수수료 · 창작자 수익 · 환불 · 후기 · 신고 · 정산(시뮬레이션).
--
-- 원칙
--   - 콘텐츠 본문(creator_product_content)은 구매자·PRO 포함 대상·창작자·관리자만 읽는다(RLS).
--   - 구매는 purchase_product() 한 곳: 원장 차감 + 구매 기록 + 수수료/창작자 몫 계산이 한 트랜잭션.
--   - 수수료율은 구매 시점 값이 구매 행에 저장된다 → 이후 수수료 변경은 소급되지 않는다.
--   - 자격·경력은 자기 신고(credentials)와 관리자 검증(verified_credentials)을 분리한다.
--   - 정산은 시뮬레이션만: settlement_requests.mode 는 'simulation' 으로 잠겨 있다(CHECK). 실제 지급 없음.

-- ============ 1. 창작자 ============
create table if not exists public.creator_profiles (
  user_id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null check (length(trim(display_name)) between 1 and 40),
  bio text not null default '' check (length(bio) <= 2000),
  specialties text[] not null default '{}',
  years_training int check (years_training between 0 and 80),
  avatar_url text,
  -- 자기 신고: 화면에 "본인 입력"으로 표시. 검증된 사실처럼 보이지 않게.
  credentials jsonb not null default '[]'::jsonb,
  -- 관리자 검증 결과만
  verified_credentials jsonb not null default '[]'::jsonb,
  is_minor boolean not null default false,
  guardian_consent boolean not null default false,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'restricted')),
  commission_bp_override int check (commission_bp_override between 0 and 5000),
  review_note text,
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.creator_profiles enable row level security;
drop policy if exists "creator_profiles_select" on public.creator_profiles;
create policy "creator_profiles_select" on public.creator_profiles for select
  using (status = 'approved' or user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.creator_profiles to anon, authenticated;

create or replace function public.upsert_my_creator_profile(p jsonb)
returns setof public.creator_profiles language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if jsonb_typeof(coalesce(p->'credentials', '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p->'credentials', '[]'::jsonb)) > 20 then raise exception 'INVALID_CREDENTIALS'; end if;
  insert into public.creator_profiles (user_id, display_name, bio, specialties, years_training, avatar_url, credentials, is_minor, guardian_consent)
  values (me, trim(p->>'display_name'), left(coalesce(p->>'bio', ''), 2000),
          coalesce(array(select jsonb_array_elements_text(p->'specialties')), '{}'),
          nullif(p->>'years_training', '')::int, nullif(p->>'avatar_url', ''),
          coalesce(p->'credentials', '[]'::jsonb), coalesce((p->>'is_minor')::boolean, false), coalesce((p->>'guardian_consent')::boolean, false))
  on conflict (user_id) do update set
    display_name = excluded.display_name, bio = excluded.bio, specialties = excluded.specialties,
    years_training = excluded.years_training, avatar_url = excluded.avatar_url, credentials = excluded.credentials,
    is_minor = excluded.is_minor, guardian_consent = excluded.guardian_consent,
    -- 거절된 신청은 수정하면 다시 검토 대기
    status = case when creator_profiles.status = 'rejected' then 'pending' else creator_profiles.status end,
    updated_at = now();
  return query select * from public.creator_profiles where user_id = me;
end;
$$;
revoke all on function public.upsert_my_creator_profile(jsonb) from public;
grant execute on function public.upsert_my_creator_profile(jsonb) to authenticated;

create or replace function public.admin_review_creator(p_user uuid, p_decision text, p_note text default null, p_commission_bp int default null, p_verified jsonb default null)
returns setof public.creator_profiles language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved', 'rejected', 'restricted', 'pending') then raise exception 'INVALID_DECISION'; end if;
  update public.creator_profiles set status = p_decision, review_note = p_note, commission_bp_override = p_commission_bp,
         verified_credentials = coalesce(p_verified, verified_credentials), reviewed_by = auth.uid(), reviewed_at = now(), updated_at = now()
   where user_id = p_user;
  if not found then raise exception 'CREATOR_NOT_FOUND'; end if;
  -- 제한된 창작자의 상품은 판매 중지(기존 구매자 열람은 유지)
  if p_decision = 'restricted' then
    update public.creator_products set status = 'unlisted', updated_at = now() where creator_id = p_user and status in ('approved', 'pending_review');
  end if;
  return query select * from public.creator_profiles where user_id = p_user;
end;
$$;
revoke all on function public.admin_review_creator(uuid, text, text, int, jsonb) from public;
grant execute on function public.admin_review_creator(uuid, text, text, int, jsonb) to authenticated;

-- ============ 2. 수수료 규칙 ============
create table if not exists public.commission_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('product_type', 'event')),
  scope_key text not null default '*',
  commission_bp int not null check (commission_bp between 0 and 5000),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  active boolean not null default true,
  note text not null default '',
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.commission_rules enable row level security;
drop policy if exists "commission_rules_admin" on public.commission_rules;
create policy "commission_rules_admin" on public.commission_rules for select using (public.is_platform_admin(auth.uid()));
grant select on public.commission_rules to authenticated;

-- 우선순위: 창작자 특별 수수료 > 진행 중 이벤트 > 상품 유형별 > 기본
create or replace function public.resolve_commission_bp(p_creator uuid, p_type text)
returns int language sql security definer set search_path = public stable as $$
  select coalesce(
    (select commission_bp_override from public.creator_profiles where user_id = p_creator),
    (select commission_bp from public.commission_rules where scope = 'event' and active and now() >= starts_at and (ends_at is null or now() < ends_at)
       and scope_key in ('*', p_type) order by commission_bp asc limit 1),
    (select commission_bp from public.commission_rules where scope = 'product_type' and active and scope_key = p_type
       and now() >= starts_at and (ends_at is null or now() < ends_at) order by created_at desc limit 1),
    (select default_commission_bp from public.monetization_config)
  );
$$;
revoke all on function public.resolve_commission_bp(uuid, text) from public;
grant execute on function public.resolve_commission_bp(uuid, text) to authenticated;

create or replace function public.admin_save_commission_rule(p jsonb)
returns setof public.commission_rules language plpgsql security definer set search_path = public as $$
declare rid uuid;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p ? 'id' then
    -- 규칙은 비활성화만 (과거 규칙 기록 보존)
    update public.commission_rules set active = coalesce((p->>'active')::boolean, active), ends_at = coalesce((p->>'ends_at')::timestamptz, ends_at)
     where id = (p->>'id')::uuid returning id into rid;
  else
    insert into public.commission_rules (scope, scope_key, commission_bp, starts_at, ends_at, note, created_by)
    values (p->>'scope', coalesce(nullif(p->>'scope_key', ''), '*'), (p->>'commission_bp')::int,
            coalesce((p->>'starts_at')::timestamptz, now()), (p->>'ends_at')::timestamptz, coalesce(p->>'note', ''), auth.uid())
    returning id into rid;
  end if;
  return query select * from public.commission_rules where id = rid;
end;
$$;
revoke all on function public.admin_save_commission_rule(jsonb) from public;
grant execute on function public.admin_save_commission_rule(jsonb) to authenticated;

-- ============ 3. 상품 · 본문 ============
create table if not exists public.creator_products (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  product_type text not null check (product_type in ('curriculum', 'course', 'lecture', 'technique_guide', 'training_program', 'tactics', 'video_lecture', 'document', 'other')),
  title text not null check (length(trim(title)) between 2 and 80),
  summary text not null default '' check (length(summary) <= 300),
  description text not null default '' check (length(description) <= 8000),
  target_audience text not null default '' check (length(target_audience) <= 500),
  martial_art text,
  difficulty text not null default 'all' check (difficulty in ('beginner', 'intermediate', 'advanced', 'all')),
  est_minutes int check (est_minutes between 1 and 100000),
  price_coins int not null default 0 check (price_coins between 0 and 1000000),
  pro_included boolean not null default false,
  thumbnail_url text,
  -- 공개 목차와 무료 미리보기 (본문 전체는 creator_product_content)
  outline jsonb not null default '[]'::jsonb,
  preview jsonb not null default '{}'::jsonb,
  technique_ids text[] not null default '{}',
  rights_confirmed boolean not null default false,
  status text not null default 'draft' check (status in ('draft', 'pending_review', 'approved', 'rejected', 'suspended', 'unlisted')),
  review_note text,
  version int not null default 1,
  approved_version int,
  sales_count int not null default 0,
  rating_avg numeric(3, 2) not null default 0,
  rating_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  published_at timestamptz
);
create index if not exists creator_products_listing_idx on public.creator_products (status, created_at desc);
create index if not exists creator_products_creator_idx on public.creator_products (creator_id);

create table if not exists public.creator_product_content (
  product_id uuid primary key references public.creator_products (id) on delete cascade,
  body jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.content_purchases (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references public.creator_products (id) on delete restrict,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  creator_id uuid not null references auth.users (id) on delete cascade,
  price_coins int not null check (price_coins >= 0),
  commission_bp int not null,
  platform_fee_coins int not null check (platform_fee_coins >= 0),
  creator_earning_coins int not null check (creator_earning_coins >= 0),
  product_version int not null,
  privileged_comp boolean not null default false,
  ledger_entry_id uuid,
  status text not null default 'completed' check (status in ('completed', 'refunded')),
  refund_status text not null default 'none' check (refund_status in ('none', 'requested', 'approved', 'rejected')),
  refund_reason text,
  refund_requested_at timestamptz,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_purchases_split check (price_coins = platform_fee_coins + creator_earning_coins or privileged_comp)
);
create unique index if not exists content_purchases_one_active on public.content_purchases (product_id, buyer_id) where status = 'completed';
create index if not exists content_purchases_buyer_idx on public.content_purchases (buyer_id, created_at desc);
create index if not exists content_purchases_creator_idx on public.content_purchases (creator_id, created_at desc);

create or replace function public.owns_product_access(p_product uuid, p_user uuid)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare pr public.creator_products;
begin
  if p_user is null then return false; end if;
  select * into pr from public.creator_products where id = p_product;
  if not found then return false; end if;
  if pr.creator_id = p_user or public.is_platform_admin(p_user) or public.is_privileged_account(p_user) then return true; end if;
  -- 저작권 등으로 판매 중지(suspended)된 상품은 구매자도 열람 불가 (환불 대상)
  if pr.status = 'suspended' then return false; end if;
  if exists (select 1 from public.content_purchases where product_id = p_product and buyer_id = p_user and status = 'completed') then return true; end if;
  return pr.pro_included and pr.status = 'approved' and public.has_entitlement(p_user, 'pro_content');
end;
$$;
revoke all on function public.owns_product_access(uuid, uuid) from public;
grant execute on function public.owns_product_access(uuid, uuid) to authenticated;

-- 정책 안에서 구매 테이블을 직접 읽으면 비로그인 목록 조회가 권한 오류로 실패한다 → definer 도우미
create or replace function public.has_purchased_product(p_product uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_user is not null and exists (select 1 from public.content_purchases where product_id = p_product and buyer_id = p_user);
$$;
revoke all on function public.has_purchased_product(uuid, uuid) from public;
grant execute on function public.has_purchased_product(uuid, uuid) to anon, authenticated;

alter table public.creator_products enable row level security;
drop policy if exists "creator_products_select" on public.creator_products;
create policy "creator_products_select" on public.creator_products for select
  using (status = 'approved' or creator_id = auth.uid() or public.is_platform_admin(auth.uid())
         or public.has_purchased_product(id, auth.uid()));
grant select on public.creator_products to anon, authenticated;

alter table public.creator_product_content enable row level security;
drop policy if exists "creator_product_content_select" on public.creator_product_content;
create policy "creator_product_content_select" on public.creator_product_content for select
  using (public.owns_product_access(product_id, auth.uid()));
grant select on public.creator_product_content to authenticated;

alter table public.content_purchases enable row level security;
drop policy if exists "content_purchases_select" on public.content_purchases;
create policy "content_purchases_select" on public.content_purchases for select
  using (buyer_id = auth.uid() or creator_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.content_purchases to authenticated;

-- 저장(생성·수정). 판매 중이던 상품을 고치면 버전이 올라가고 재검수 대기(기존 구매자 열람은 유지).
create or replace function public.save_creator_product(p jsonb)
returns setof public.creator_products language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pid uuid := nullif(p->>'id', '')::uuid;
  pr public.creator_products;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if not exists (select 1 from public.creator_profiles where user_id = me and status in ('pending', 'approved')) then raise exception 'CREATOR_PROFILE_REQUIRED'; end if;
  if pid is null then
    insert into public.creator_products (creator_id, product_type, title, summary, description, target_audience, martial_art, difficulty, est_minutes,
                                         price_coins, pro_included, thumbnail_url, outline, preview, technique_ids, rights_confirmed)
    values (me, p->>'product_type', trim(p->>'title'), coalesce(p->>'summary', ''), coalesce(p->>'description', ''), coalesce(p->>'target_audience', ''),
            nullif(p->>'martial_art', ''), coalesce(p->>'difficulty', 'all'), nullif(p->>'est_minutes', '')::int,
            coalesce((p->>'price_coins')::int, 0), coalesce((p->>'pro_included')::boolean, false), nullif(p->>'thumbnail_url', ''),
            coalesce(p->'outline', '[]'::jsonb), coalesce(p->'preview', '{}'::jsonb),
            coalesce(array(select jsonb_array_elements_text(p->'technique_ids')), '{}'), coalesce((p->>'rights_confirmed')::boolean, false))
    returning id into pid;
    insert into public.creator_product_content (product_id, body) values (pid, coalesce(p->'content', '{}'::jsonb));
  else
    select * into pr from public.creator_products where id = pid for update;
    if not found or pr.creator_id <> me then raise exception 'NOT_YOUR_PRODUCT'; end if;
    if pr.status = 'suspended' then raise exception 'PRODUCT_SUSPENDED'; end if;
    update public.creator_products set
      product_type = coalesce(p->>'product_type', product_type), title = coalesce(trim(p->>'title'), title),
      summary = coalesce(p->>'summary', summary), description = coalesce(p->>'description', description),
      target_audience = coalesce(p->>'target_audience', target_audience), martial_art = coalesce(nullif(p->>'martial_art', ''), martial_art),
      difficulty = coalesce(p->>'difficulty', difficulty), est_minutes = coalesce(nullif(p->>'est_minutes', '')::int, est_minutes),
      price_coins = coalesce((p->>'price_coins')::int, price_coins), pro_included = coalesce((p->>'pro_included')::boolean, pro_included),
      thumbnail_url = coalesce(nullif(p->>'thumbnail_url', ''), thumbnail_url),
      outline = coalesce(p->'outline', outline), preview = coalesce(p->'preview', preview),
      technique_ids = case when p ? 'technique_ids' then array(select jsonb_array_elements_text(p->'technique_ids')) else technique_ids end,
      rights_confirmed = coalesce((p->>'rights_confirmed')::boolean, rights_confirmed),
      version = version + 1,
      status = case when status in ('approved', 'rejected') then 'pending_review' else status end,
      updated_at = now()
    where id = pid;
    if p ? 'content' then
      update public.creator_product_content set body = p->'content', updated_at = now() where product_id = pid;
    end if;
  end if;
  return query select * from public.creator_products where id = pid;
end;
$$;
revoke all on function public.save_creator_product(jsonb) from public;
grant execute on function public.save_creator_product(jsonb) to authenticated;

create or replace function public.submit_product_for_review(p_product uuid)
returns setof public.creator_products language plpgsql security definer set search_path = public as $$
declare pr public.creator_products;
begin
  select * into pr from public.creator_products where id = p_product for update;
  if not found or pr.creator_id <> auth.uid() then raise exception 'NOT_YOUR_PRODUCT'; end if;
  if not pr.rights_confirmed then raise exception 'RIGHTS_NOT_CONFIRMED'; end if;
  if pr.status not in ('draft', 'rejected', 'pending_review') then raise exception 'INVALID_STATE'; end if;
  update public.creator_products set status = 'pending_review', updated_at = now() where id = p_product;
  return query select * from public.creator_products where id = p_product;
end;
$$;
revoke all on function public.submit_product_for_review(uuid) from public;
grant execute on function public.submit_product_for_review(uuid) to authenticated;

-- 창작자: 판매 중지 / 재개(이미 승인된 버전 그대로일 때만 검수 없이 재개)
create or replace function public.set_product_on_sale(p_product uuid, p_on_sale boolean)
returns setof public.creator_products language plpgsql security definer set search_path = public as $$
declare pr public.creator_products;
begin
  select * into pr from public.creator_products where id = p_product for update;
  if not found or pr.creator_id <> auth.uid() then raise exception 'NOT_YOUR_PRODUCT'; end if;
  if p_on_sale then
    if pr.status <> 'unlisted' or pr.approved_version is distinct from pr.version then raise exception 'REVIEW_REQUIRED'; end if;
    if not exists (select 1 from public.creator_profiles where user_id = auth.uid() and status = 'approved') then raise exception 'CREATOR_NOT_APPROVED'; end if;
    update public.creator_products set status = 'approved', updated_at = now() where id = p_product;
  else
    if pr.status not in ('approved', 'pending_review') then raise exception 'INVALID_STATE'; end if;
    update public.creator_products set status = 'unlisted', updated_at = now() where id = p_product;
  end if;
  return query select * from public.creator_products where id = p_product;
end;
$$;
revoke all on function public.set_product_on_sale(uuid, boolean) from public;
grant execute on function public.set_product_on_sale(uuid, boolean) to authenticated;

-- 삭제는 판매 이력이 없을 때만 (구매자가 있으면 판매 중지만)
create or replace function public.delete_creator_product(p_product uuid)
returns void language plpgsql security definer set search_path = public as $$
declare pr public.creator_products;
begin
  select * into pr from public.creator_products where id = p_product for update;
  if not found or pr.creator_id <> auth.uid() then raise exception 'NOT_YOUR_PRODUCT'; end if;
  if exists (select 1 from public.content_purchases where product_id = p_product) then raise exception 'HAS_PURCHASES_UNLIST_INSTEAD'; end if;
  delete from public.creator_products where id = p_product;
end;
$$;
revoke all on function public.delete_creator_product(uuid) from public;
grant execute on function public.delete_creator_product(uuid) to authenticated;

-- ============ 4. 창작자 수익 ============
create table if not exists public.settlement_requests (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  amount_coins bigint not null check (amount_coins > 0),
  coin_krw_rate numeric(10, 4) not null,
  amount_krw_estimate bigint not null,
  -- 실제 지급 경로 없음. 풀려면 법률·세무·지급대행 검토 후 마이그레이션으로.
  mode text not null default 'simulation' check (mode = 'simulation'),
  status text not null default 'requested' check (status in ('requested', 'approved', 'rejected', 'paid_simulated', 'on_hold')),
  hold_reason text,
  reject_reason text,
  requested_at timestamptz not null default now(),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  paid_simulated_at timestamptz
);
alter table public.settlement_requests enable row level security;
drop policy if exists "settlement_requests_select" on public.settlement_requests;
create policy "settlement_requests_select" on public.settlement_requests for select
  using (creator_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.settlement_requests to authenticated;

create table if not exists public.creator_earnings (
  id uuid primary key default gen_random_uuid(),
  creator_id uuid not null references auth.users (id) on delete cascade,
  purchase_id uuid not null unique references public.content_purchases (id) on delete restrict,
  amount_coins int not null check (amount_coins >= 0),
  status text not null default 'held' check (status in ('held', 'available', 'in_settlement', 'settled', 'reversed', 'converted')),
  available_at timestamptz not null,
  settlement_id uuid references public.settlement_requests (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists creator_earnings_creator_idx on public.creator_earnings (creator_id, status);
alter table public.creator_earnings enable row level security;
drop policy if exists "creator_earnings_select" on public.creator_earnings;
create policy "creator_earnings_select" on public.creator_earnings for select
  using (creator_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.creator_earnings to authenticated;

create or replace function public.release_matured_earnings(p_creator uuid)
returns void language sql security definer set search_path = public as $$
  update public.creator_earnings set status = 'available', updated_at = now()
   where creator_id = p_creator and status = 'held' and available_at <= now()
     and not exists (select 1 from public.content_purchases c where c.id = purchase_id and c.refund_status = 'requested');
$$;
revoke all on function public.release_matured_earnings(uuid) from public;

-- ============ 5. 구매 ============
create or replace function public.purchase_product(p_product uuid)
returns setof public.content_purchases language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pr public.creator_products;
  existing uuid;
  priv boolean;
  bp int;
  fee int;
  e public.wallet_ledger;
  pid uuid;
  hold int := (select earnings_hold_days from public.monetization_config);
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into pr from public.creator_products where id = p_product for update;
  if not found or pr.status <> 'approved' then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if pr.creator_id = me then raise exception 'OWN_PRODUCT'; end if;
  if not exists (select 1 from public.creator_profiles where user_id = pr.creator_id and status = 'approved') then raise exception 'PRODUCT_UNAVAILABLE'; end if;
  if public.is_blocked_between(pr.creator_id, me) then raise exception 'BLOCKED'; end if;
  select id into existing from public.content_purchases where product_id = p_product and buyer_id = me and status = 'completed';
  if existing is not null then return query select * from public.content_purchases where id = existing; return; end if;

  priv := public.is_privileged_account(me);
  if priv or pr.price_coins = 0 then
    -- 운영자·개발자 계정(무제한) 또는 무료 상품: 코인 이동·창작자 수익 없음
    insert into public.content_purchases (product_id, buyer_id, creator_id, price_coins, commission_bp, platform_fee_coins, creator_earning_coins, product_version, privileged_comp)
    values (p_product, me, pr.creator_id, case when priv then pr.price_coins else 0 end, 0, 0, 0, pr.version, priv)
    returning id into pid;
    if priv and pr.price_coins > 0 then
      e := public.post_ledger(me, 'content_purchase', 0, 'content_purchase', pid::text, 'purchase:' || pid,
                              '무제한 계정 · 정가 ' || pr.price_coins || '코인 · ' || pr.title, me);
      update public.content_purchases set ledger_entry_id = e.id where id = pid;
    end if;
  else
    bp := public.resolve_commission_bp(pr.creator_id, pr.product_type);
    fee := round(pr.price_coins * bp / 10000.0)::int;
    insert into public.content_purchases (product_id, buyer_id, creator_id, price_coins, commission_bp, platform_fee_coins, creator_earning_coins, product_version)
    values (p_product, me, pr.creator_id, pr.price_coins, bp, fee, pr.price_coins - fee, pr.version)
    returning id into pid;
    e := public.post_ledger(me, 'content_purchase', -pr.price_coins::bigint, 'content_purchase', pid::text, 'purchase:' || pid, pr.title, me);
    update public.content_purchases set ledger_entry_id = e.id where id = pid;
    insert into public.creator_earnings (creator_id, purchase_id, amount_coins, available_at)
    values (pr.creator_id, pid, pr.price_coins - fee, now() + make_interval(days => hold));
  end if;
  update public.creator_products set sales_count = sales_count + 1 where id = p_product;
  return query select * from public.content_purchases where id = pid;
end;
$$;
revoke all on function public.purchase_product(uuid) from public;
grant execute on function public.purchase_product(uuid) to authenticated;

-- ============ 6. 환불 ============
create or replace function public.request_content_refund(p_purchase uuid, p_reason text)
returns setof public.content_purchases language plpgsql security definer set search_path = public as $$
declare c public.content_purchases;
begin
  select * into c from public.content_purchases where id = p_purchase for update;
  if not found or c.buyer_id <> auth.uid() then raise exception 'NOT_YOUR_PURCHASE'; end if;
  if c.status <> 'completed' or c.refund_status <> 'none' then raise exception 'NOT_REFUNDABLE'; end if;
  if c.price_coins = 0 or c.privileged_comp then raise exception 'NOT_REFUNDABLE'; end if;
  if c.created_at < now() - make_interval(days => (select content_refund_days from public.monetization_config)) then raise exception 'REFUND_WINDOW_CLOSED'; end if;
  if length(coalesce(trim(p_reason), '')) < 2 then raise exception 'REASON_REQUIRED'; end if;
  update public.content_purchases set refund_status = 'requested', refund_reason = left(trim(p_reason), 500), refund_requested_at = now() where id = p_purchase;
  return query select * from public.content_purchases where id = p_purchase;
end;
$$;
revoke all on function public.request_content_refund(uuid, text) from public;
grant execute on function public.request_content_refund(uuid, text) to authenticated;

-- 승인(관리자): 구매자에게 코인 반환, 창작자 수익 회수(정산 전이면 취소, 지갑 전환분은 회수), 열람 권한 해제
create or replace function public.admin_resolve_content_refund(p_purchase uuid, p_approve boolean, p_note text default null)
returns setof public.content_purchases language plpgsql security definer set search_path = public as $$
declare
  c public.content_purchases;
  er public.creator_earnings;
  cbal bigint;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  select * into c from public.content_purchases where id = p_purchase for update;
  if not found then raise exception 'PURCHASE_NOT_FOUND'; end if;
  if c.status <> 'completed' then raise exception 'NOT_REFUNDABLE'; end if;
  if not p_approve then
    update public.content_purchases set refund_status = 'rejected', refund_reason = coalesce(p_note, refund_reason) where id = p_purchase;
    return query select * from public.content_purchases where id = p_purchase; return;
  end if;
  if c.price_coins > 0 and not c.privileged_comp then
    perform public.post_ledger(c.buyer_id, 'refund', c.price_coins::bigint, 'content_purchase', c.id::text, 'content_refund:' || c.id, '콘텐츠 환불', auth.uid());
  end if;
  select * into er from public.creator_earnings where purchase_id = c.id for update;
  if found then
    if er.status = 'converted' then
      -- 이미 지갑 코인으로 전환됨 → 남은 잔액 안에서 회수
      select balance into cbal from public.wallets where user_id = er.creator_id for update;
      if least(coalesce(cbal, 0), er.amount_coins) > 0 then
        perform public.post_ledger(er.creator_id, 'clawback', -least(coalesce(cbal, 0), er.amount_coins::bigint), 'creator_earning', er.id::text,
                                   'earning_clawback:' || er.id, '환불로 인한 수익 회수', auth.uid());
      end if;
    elsif er.status = 'in_settlement' then
      update public.settlement_requests set status = 'on_hold', hold_reason = '환불 처리로 금액 재계산 필요' where id = er.settlement_id and status in ('requested', 'approved');
    end if;
    update public.creator_earnings set status = 'reversed', updated_at = now() where id = er.id and status <> 'settled';
  end if;
  update public.content_purchases set status = 'refunded', refund_status = 'approved', refunded_at = now(), refund_reason = coalesce(p_note, refund_reason) where id = p_purchase;
  update public.creator_products set sales_count = greatest(sales_count - 1, 0) where id = c.product_id;
  return query select * from public.content_purchases where id = p_purchase;
end;
$$;
revoke all on function public.admin_resolve_content_refund(uuid, boolean, text) from public;
grant execute on function public.admin_resolve_content_refund(uuid, boolean, text) to authenticated;

-- ============ 7. 검수 (관리자) ============
create or replace function public.admin_review_product(p_product uuid, p_decision text, p_note text default null, p_refund_buyers boolean default false)
returns setof public.creator_products language plpgsql security definer set search_path = public as $$
declare c record;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_decision not in ('approved', 'rejected', 'suspended') then raise exception 'INVALID_DECISION'; end if;
  if p_decision = 'approved' and not exists (
    select 1 from public.creator_products pr join public.creator_profiles cp on cp.user_id = pr.creator_id
     where pr.id = p_product and cp.status = 'approved' and pr.rights_confirmed) then
    raise exception 'CREATOR_NOT_APPROVED_OR_RIGHTS';
  end if;
  update public.creator_products set status = p_decision, review_note = p_note, updated_at = now(),
         approved_version = case when p_decision = 'approved' then version else approved_version end,
         published_at = case when p_decision = 'approved' then coalesce(published_at, now()) else published_at end
   where id = p_product;
  if not found then raise exception 'PRODUCT_NOT_FOUND'; end if;
  -- 저작권 침해 등으로 판매 중지 + 환불 선택 시: 모든 유효 구매 환불
  if p_decision = 'suspended' and p_refund_buyers then
    for c in select id from public.content_purchases where product_id = p_product and status = 'completed' loop
      perform public.admin_resolve_content_refund(c.id, true, coalesce(p_note, '판매 중지에 따른 환불'));
    end loop;
  end if;
  return query select * from public.creator_products where id = p_product;
end;
$$;
revoke all on function public.admin_review_product(uuid, text, text, boolean) from public;
grant execute on function public.admin_review_product(uuid, text, text, boolean) to authenticated;

-- ============ 8. 후기 · 신고 ============
create table if not exists public.product_reviews (
  product_id uuid not null references public.creator_products (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  rating smallint not null check (rating between 1 and 5),
  body text not null default '' check (length(body) <= 2000),
  created_at timestamptz not null default now(),
  primary key (product_id, user_id)
);
alter table public.product_reviews enable row level security;
drop policy if exists "product_reviews_read" on public.product_reviews;
create policy "product_reviews_read" on public.product_reviews for select using (true);
drop policy if exists "product_reviews_insert_buyer" on public.product_reviews;
create policy "product_reviews_insert_buyer" on public.product_reviews for insert
  with check (user_id = auth.uid() and exists (select 1 from public.content_purchases c where c.product_id = product_reviews.product_id and c.buyer_id = auth.uid() and c.status = 'completed'));
drop policy if exists "product_reviews_delete_own" on public.product_reviews;
create policy "product_reviews_delete_own" on public.product_reviews for delete using (user_id = auth.uid());
grant select on public.product_reviews to anon, authenticated;
grant insert, delete on public.product_reviews to authenticated;

create or replace function public.refresh_product_rating()
returns trigger language plpgsql security definer set search_path = public as $$
declare pid uuid := coalesce(new.product_id, old.product_id);
begin
  update public.creator_products set
    rating_count = (select count(*) from public.product_reviews where product_id = pid),
    rating_avg = coalesce((select round(avg(rating)::numeric, 2) from public.product_reviews where product_id = pid), 0)
  where id = pid;
  return null;
end;
$$;
drop trigger if exists product_reviews_rating on public.product_reviews;
create trigger product_reviews_rating after insert or delete on public.product_reviews
  for each row execute function public.refresh_product_rating();

create table if not exists public.content_reports (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references public.creator_products (id) on delete cascade,
  creator_id uuid references auth.users (id) on delete cascade,
  reporter_id uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('copyright', 'unauthorized_media', 'false_credentials', 'inappropriate', 'fraud', 'other')),
  detail text not null default '' check (length(detail) <= 2000),
  status text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  constraint content_reports_target check (product_id is not null or creator_id is not null)
);
alter table public.content_reports enable row level security;
drop policy if exists "content_reports_select" on public.content_reports;
create policy "content_reports_select" on public.content_reports for select using (reporter_id = auth.uid() or public.is_platform_admin(auth.uid()));
drop policy if exists "content_reports_insert_own" on public.content_reports;
create policy "content_reports_insert_own" on public.content_reports for insert with check (reporter_id = auth.uid() and status = 'open');
grant select, insert on public.content_reports to authenticated;

create or replace function public.admin_resolve_content_report(p_report uuid, p_status text, p_note text default null)
returns setof public.content_reports language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('dismissed', 'actioned') then raise exception 'INVALID_STATUS'; end if;
  update public.content_reports set status = p_status, resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now() where id = p_report;
  return query select * from public.content_reports where id = p_report;
end;
$$;
revoke all on function public.admin_resolve_content_report(uuid, text, text) from public;
grant execute on function public.admin_resolve_content_report(uuid, text, text) to authenticated;

-- ============ 9. 수익 → 코인 전환 · 정산(시뮬레이션) ============
-- 정산 가능 수익을 MARTIAL COIN 으로 전환 (Robux식 재사용). 수익 1건 = 원장 1행(멱등).
create or replace function public.convert_earnings_to_coins()
returns bigint language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  er record;
  total bigint := 0;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.release_matured_earnings(me);
  for er in select * from public.creator_earnings where creator_id = me and status = 'available' and amount_coins > 0 for update loop
    perform public.post_ledger(me, 'creator_earning', er.amount_coins::bigint, 'creator_earning', er.id::text, 'earning:' || er.id, '판매 수익 전환', me);
    update public.creator_earnings set status = 'converted', updated_at = now() where id = er.id;
    total := total + er.amount_coins;
  end loop;
  return total;
end;
$$;
revoke all on function public.convert_earnings_to_coins() from public;
grant execute on function public.convert_earnings_to_coins() to authenticated;

create or replace function public.request_settlement()
returns setof public.settlement_requests language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cp public.creator_profiles;
  cfg public.monetization_config;
  amt bigint;
  sid uuid;
  st text := 'requested';
  why text;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into cp from public.creator_profiles where user_id = me;
  if not found or cp.status <> 'approved' then raise exception 'CREATOR_NOT_APPROVED'; end if;
  select * into cfg from public.monetization_config;
  perform public.release_matured_earnings(me);
  select coalesce(sum(amount_coins), 0) into amt from public.creator_earnings where creator_id = me and status = 'available';
  if amt <= 0 or amt < cfg.settlement_min_coins then raise exception 'BELOW_SETTLEMENT_MINIMUM'; end if;
  if exists (select 1 from public.settlement_requests where creator_id = me and status in ('requested', 'approved', 'on_hold')) then raise exception 'SETTLEMENT_IN_PROGRESS'; end if;
  if cp.is_minor and not cp.guardian_consent then st := 'on_hold'; why := '미성년 창작자: 보호자 동의·계약 확인 전 지급 불가'; end if;
  if exists (select 1 from public.content_purchases where creator_id = me and refund_status = 'requested') then st := 'on_hold'; why := coalesce(why, '처리 중인 환불 요청이 있음'); end if;
  insert into public.settlement_requests (creator_id, amount_coins, coin_krw_rate, amount_krw_estimate, status, hold_reason)
  values (me, amt, cfg.coin_krw_rate, floor(amt * cfg.coin_krw_rate)::bigint, st, why)
  returning id into sid;
  update public.creator_earnings set status = 'in_settlement', settlement_id = sid, updated_at = now() where creator_id = me and status = 'available';
  return query select * from public.settlement_requests where id = sid;
end;
$$;
revoke all on function public.request_settlement() from public;
grant execute on function public.request_settlement() to authenticated;

create or replace function public.admin_decide_settlement(p_settlement uuid, p_decision text, p_reason text default null)
returns setof public.settlement_requests language plpgsql security definer set search_path = public as $$
declare s public.settlement_requests;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  select * into s from public.settlement_requests where id = p_settlement for update;
  if not found then raise exception 'SETTLEMENT_NOT_FOUND'; end if;
  if p_decision = 'approved' then
    if s.status not in ('requested', 'on_hold') then raise exception 'INVALID_STATE'; end if;
    if exists (select 1 from public.creator_profiles where user_id = s.creator_id and is_minor and not guardian_consent) then raise exception 'MINOR_GUARDIAN_REQUIRED'; end if;
    update public.settlement_requests set status = 'approved', hold_reason = null, reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  elsif p_decision = 'on_hold' then
    if s.status not in ('requested', 'approved') then raise exception 'INVALID_STATE'; end if;
    update public.settlement_requests set status = 'on_hold', hold_reason = p_reason, reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
  elsif p_decision = 'rejected' then
    if s.status not in ('requested', 'approved', 'on_hold') then raise exception 'INVALID_STATE'; end if;
    update public.settlement_requests set status = 'rejected', reject_reason = coalesce(p_reason, '사유 미기재'), reviewed_by = auth.uid(), reviewed_at = now() where id = s.id;
    update public.creator_earnings set status = 'available', settlement_id = null, updated_at = now() where settlement_id = s.id and status = 'in_settlement';
  elsif p_decision = 'paid_simulated' then
    -- 지급 "완료" 상태만 기록. 돈은 움직이지 않는다(mode=simulation).
    if s.status <> 'approved' then raise exception 'NOT_APPROVED'; end if;
    update public.settlement_requests set status = 'paid_simulated', paid_simulated_at = now() where id = s.id;
    update public.creator_earnings set status = 'settled', updated_at = now() where settlement_id = s.id and status = 'in_settlement';
  else
    raise exception 'INVALID_DECISION';
  end if;
  return query select * from public.settlement_requests where id = p_settlement;
end;
$$;
revoke all on function public.admin_decide_settlement(uuid, text, text) from public;
grant execute on function public.admin_decide_settlement(uuid, text, text) to authenticated;

-- 창작자 수익 요약 (대시보드)
create or replace function public.my_creator_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.release_matured_earnings(me);
  return jsonb_build_object(
    'gross_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where creator_id = me and status = 'completed' and not privileged_comp),
    'sales_count', (select count(*) from public.content_purchases where creator_id = me and status = 'completed'),
    'platform_fee_coins', (select coalesce(sum(platform_fee_coins), 0) from public.content_purchases where creator_id = me and status = 'completed'),
    'refunded_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where creator_id = me and status = 'refunded' and not privileged_comp),
    'held_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where creator_id = me and status = 'held'),
    'available_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where creator_id = me and status = 'available'),
    'in_settlement_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where creator_id = me and status = 'in_settlement'),
    'settled_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where creator_id = me and status = 'settled'),
    'converted_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where creator_id = me and status = 'converted'),
    'coin_krw_rate', (select coin_krw_rate from public.monetization_config),
    'settlement_min_coins', (select settlement_min_coins from public.monetization_config),
    'cash_payout_enabled', (select cash_payout_enabled from public.monetization_config)
  );
end;
$$;
revoke all on function public.my_creator_summary() from public;
grant execute on function public.my_creator_summary() to authenticated;
