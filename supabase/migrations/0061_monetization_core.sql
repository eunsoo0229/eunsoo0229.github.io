-- 수익화 1/4 — 공통 설정 · 운영자(개발자) 계정 · 멤버십 요금제 · 구독 · 권한(엔타이틀먼트).
--
-- 원칙
--   - 가격·기능 구성은 코드가 아니라 membership_plans 행으로 관리한다(관리자 RPC로 변경).
--   - 'paid'/'refunded' 같은 돈이 걸린 상태 전이는 service_role(= Toss 승인을 확인한
--     payment-verify Edge Function)만 한다. 클라이언트는 주문(pending)만 만들 수 있다.
--   - 유료 기능 권한은 has_entitlement() 로 서버에서 판정한다. 버튼 숨김에 의존하지 않는다.
--   - 실결제(live 키)·현금 지급은 아래 CHECK 제약으로 잠가 둔다. 관리자 화면에서 켤 수 없고,
--     법률·결제사 검토 후 별도 마이그레이션으로만 풀 수 있다.
--   - 기존 테이블·데이터는 건드리지 않는다(추가만).

-- ============ 1. 공통 설정 (단일 행) ============
create table if not exists public.monetization_config (
  id boolean primary key default true check (id),
  coin_name text not null default 'MARTIAL COIN',
  coin_symbol text not null default 'MC',
  -- 디지털 콘텐츠 기본 플랫폼 수수료 (basis point, 1500 = 15%)
  default_commission_bp int not null default 1500 check (default_commission_bp between 0 and 5000),
  -- 기존 장비 마켓(택배 결제) 거래 수수료
  gear_fee_bp int not null default 300 check (gear_fee_bp between 0 and 2000),
  -- 정산 '예상액' 계산용 환산율 (1코인 = n원). 실제 환전이 아니다.
  coin_krw_rate numeric(10, 4) not null default 1 check (coin_krw_rate > 0),
  earnings_hold_days int not null default 7 check (earnings_hold_days between 0 and 90),
  settlement_min_coins int not null default 10000 check (settlement_min_coins >= 0),
  -- 학습 활동 보상 (하루 1회 출석 보상 등) — 남용 방지를 위해 일일 상한
  daily_checkin_coins int not null default 10 check (daily_checkin_coins between 0 and 1000),
  past_due_grace_days int not null default 3 check (past_due_grace_days between 0 and 30),
  content_refund_days int not null default 7 check (content_refund_days between 0 and 60),
  live_payments_enabled boolean not null default false,
  cash_payout_enabled boolean not null default false,
  minor_paid_enabled boolean not null default false,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint monetization_live_payments_locked check (not live_payments_enabled),
  constraint monetization_cash_payout_locked check (not cash_payout_enabled),
  constraint monetization_minor_paid_locked check (not minor_paid_enabled)
);
insert into public.monetization_config (id) values (true) on conflict (id) do nothing;
alter table public.monetization_config enable row level security;
drop policy if exists "monetization_config_read" on public.monetization_config;
create policy "monetization_config_read" on public.monetization_config for select using (true);
grant select on public.monetization_config to anon, authenticated;

-- ============ 2. 운영자·개발자 계정 (모든 기능 + 무제한 크레딧) ============
-- 이메일 문자열이 아니라 user_id 로 고정한다 — 가입 경로가 이메일 도메인을 막지 않으므로
-- "같은 이메일로 먼저 가입"하는 방식으로 특권을 가로챌 수 없게.
create table if not exists public.privileged_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  label text not null default '',
  granted_at timestamptz not null default now()
);
alter table public.privileged_accounts enable row level security;
drop policy if exists "privileged_accounts_select_self" on public.privileged_accounts;
create policy "privileged_accounts_select_self" on public.privileged_accounts for select
  using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.privileged_accounts to authenticated;

-- 사용자 지시(2026-11-16): martialdex(운영자)와 joeunsu232@gmail.com(개발자). 이미 가입된 계정만.
insert into public.privileged_accounts (user_id, label)
select id, case when lower(email) = 'martialdex@martialdex.local' then 'operator' else 'developer' end
  from auth.users where lower(email) in ('martialdex@martialdex.local', 'joeunsu232@gmail.com')
on conflict (user_id) do nothing;
-- "앱 내 모든 기능" = 관리자 화면 포함
insert into public.platform_admins (user_id, note)
select user_id, 'privileged account (0061)' from public.privileged_accounts
on conflict (user_id) do nothing;
insert into public.category_admins (user_id)
select user_id from public.privileged_accounts
on conflict (user_id) do nothing;

create or replace function public.is_privileged_account(p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_user is not null and exists (select 1 from public.privileged_accounts where user_id = p_user);
$$;
revoke all on function public.is_privileged_account(uuid) from public;
grant execute on function public.is_privileged_account(uuid) to anon, authenticated;

-- ============ 3. 요금제 ============
create table if not exists public.membership_plans (
  id text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  audience text not null check (audience in ('personal', 'business')),
  name text not null,
  tagline text not null default '',
  tier smallint not null default 0,
  features text[] not null default '{}',
  price_monthly_krw int not null default 0 check (price_monthly_krw >= 0),
  price_yearly_krw int not null default 0 check (price_yearly_krw >= 0),
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.membership_plans enable row level security;
drop policy if exists "membership_plans_read" on public.membership_plans;
create policy "membership_plans_read" on public.membership_plans for select using (true);
grant select on public.membership_plans to anon, authenticated;

-- 초기 가격은 테스트용 가설 (확정 가격 아님) — 관리자 화면에서 변경.
insert into public.membership_plans (id, audience, name, tagline, tier, features, price_monthly_krw, price_yearly_krw, sort) values
  ('free', 'personal', 'FREE', '기본 기능을 무료로', 0,
   array['encyclopedia', 'learning_log', 'community', 'coach_basic', 'curriculum_basic', 'gear_market', 'profile'], 0, 0, 0),
  ('pro', 'personal', 'PRO', '개인 학습자를 위한 프리미엄', 1,
   array['encyclopedia', 'learning_log', 'community', 'coach_basic', 'curriculum_basic', 'gear_market', 'profile',
         'coach_advanced', 'curriculum_personal', 'analytics_advanced', 'learning_report', 'ai_extended', 'pro_content'], 9900, 99000, 1),
  ('gym', 'business', 'GYM / BUSINESS', '체육관·지도자 사업자 요금제', 2,
   array['gym_management', 'gym_progress', 'gym_business_reports', 'gym_content_sales'], 49000, 490000, 2)
on conflict (id) do nothing;

-- ============ 4. 구독 ============
create table if not exists public.user_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.membership_plans (id),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  -- 사업자 요금제는 체육관 단위 (개인 요금제는 null)
  gym_id text references public.gyms (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'past_due', 'canceled', 'expired')),
  current_period_start timestamptz not null default now(),
  current_period_end timestamptz not null,
  cancel_at_period_end boolean not null default false,
  canceled_at timestamptz,
  ended_reason text,
  is_test boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists user_subscriptions_one_personal on public.user_subscriptions (user_id)
  where gym_id is null and status in ('active', 'past_due');
create unique index if not exists user_subscriptions_one_per_gym on public.user_subscriptions (gym_id)
  where gym_id is not null and status in ('active', 'past_due');
create index if not exists user_subscriptions_user_idx on public.user_subscriptions (user_id, created_at desc);
alter table public.user_subscriptions enable row level security;
drop policy if exists "user_subscriptions_select" on public.user_subscriptions;
create policy "user_subscriptions_select" on public.user_subscriptions for select
  using (user_id = auth.uid() or (gym_id is not null and public.gym_owner_of(gym_id) = auth.uid()) or public.is_platform_admin(auth.uid()));
grant select on public.user_subscriptions to authenticated;  -- 쓰기는 RPC 만

-- 구독 결제 (Toss orderId = id)
create table if not exists public.subscription_payments (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  plan_id text not null references public.membership_plans (id),
  cycle text not null check (cycle in ('monthly', 'yearly')),
  gym_id text references public.gyms (id) on delete set null,
  kind text not null check (kind in ('new', 'renewal', 'change')),
  subscription_id uuid references public.user_subscriptions (id) on delete set null,
  amount_krw int not null check (amount_krw >= 100),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  payment_key text,
  is_test boolean not null default true,
  failure_reason text,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz
);
create unique index if not exists subscription_payments_payment_key_unique on public.subscription_payments (payment_key) where payment_key is not null;
create index if not exists subscription_payments_user_idx on public.subscription_payments (user_id, created_at desc);
alter table public.subscription_payments enable row level security;
drop policy if exists "subscription_payments_select" on public.subscription_payments;
create policy "subscription_payments_select" on public.subscription_payments for select
  using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.subscription_payments to authenticated;

-- ============ 5. 권한 판정 ============
-- 유효 구독: active/past_due 이면서 기간 안. 유예기간(결제 실패 대비)은 자동 갱신 대상에만 —
-- 사용자가 취소 예약한 구독은 기간 종료 즉시 끝난다.
create or replace function public.subscription_is_live(s public.user_subscriptions)
returns boolean language sql stable set search_path = public as $$
  select s.status in ('active', 'past_due')
     and now() < s.current_period_end + case when s.cancel_at_period_end then interval '0'
                                             else make_interval(days => (select past_due_grace_days from public.monetization_config)) end;
$$;

create or replace function public.has_entitlement(p_user uuid, p_feature text)
returns boolean language plpgsql security definer set search_path = public stable as $$
begin
  if p_user is null then return false; end if;
  if public.is_privileged_account(p_user) then return true; end if;
  -- 무료 요금제 기능은 로그인 사용자 모두
  if exists (select 1 from public.membership_plans where id = 'free' and p_feature = any (features)) then return true; end if;
  -- 개인 구독
  if exists (
    select 1 from public.user_subscriptions s join public.membership_plans p on p.id = s.plan_id
     where s.user_id = p_user and s.gym_id is null and public.subscription_is_live(s) and p_feature = any (p.features)
  ) then return true; end if;
  -- 사업자 구독: 그 체육관의 관장 또는 지도자
  return exists (
    select 1 from public.user_subscriptions s join public.membership_plans p on p.id = s.plan_id
     where s.gym_id is not null and public.subscription_is_live(s) and p_feature = any (p.features)
       and (public.gym_owner_of(s.gym_id) = p_user or public.is_gym_instructor(s.gym_id, p_user))
  );
end;
$$;
revoke all on function public.has_entitlement(uuid, text) from public;
grant execute on function public.has_entitlement(uuid, text) to authenticated;

create or replace function public.gym_has_business_plan(p_gym text)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.user_subscriptions s where s.gym_id = p_gym and public.subscription_is_live(s))
      or public.is_privileged_account(public.gym_owner_of(p_gym));
$$;
revoke all on function public.gym_has_business_plan(text) from public;
grant execute on function public.gym_has_business_plan(text) to authenticated;

-- 화면 표시용 요약: 내 요금제·기능 목록·특권 여부. (판정은 항상 has_entitlement 로 다시 한다)
create or replace function public.my_membership()
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  me uuid := auth.uid();
  s public.user_subscriptions;
  priv boolean;
  feats text[];
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  priv := public.is_privileged_account(me);
  select * into s from public.user_subscriptions x
   where x.user_id = me and x.gym_id is null and public.subscription_is_live(x)
   order by x.current_period_end desc limit 1;
  if priv then
    select array_agg(distinct f) into feats from public.membership_plans, unnest(features) f;
  else
    select features into feats from public.membership_plans where id = coalesce(s.plan_id, 'free');
  end if;
  return jsonb_build_object(
    'plan_id', case when priv then 'privileged' else coalesce(s.plan_id, 'free') end,
    'privileged', priv,
    'is_admin', public.is_platform_admin(me),
    'features', coalesce(to_jsonb(feats), '[]'::jsonb),
    'subscription', case when s.id is null then null else to_jsonb(s) end
  );
end;
$$;
revoke all on function public.my_membership() from public;
grant execute on function public.my_membership() to authenticated;

-- ============ 6. 구독 주문·확정·취소 ============
create or replace function public.create_subscription_order(p_plan text, p_cycle text, p_gym text default null)
returns setof public.subscription_payments language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pl public.membership_plans;
  cur public.user_subscriptions;
  amt int;
  k text;
  oid text;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_cycle not in ('monthly', 'yearly') then raise exception 'INVALID_CYCLE'; end if;
  select * into pl from public.membership_plans where id = p_plan and active;
  if not found then raise exception 'PLAN_UNAVAILABLE'; end if;
  amt := case when p_cycle = 'monthly' then pl.price_monthly_krw else pl.price_yearly_krw end;
  if amt < 100 then raise exception 'PLAN_NOT_PURCHASABLE'; end if;
  if pl.audience = 'business' then
    if p_gym is null or public.gym_owner_of(p_gym) is distinct from me then raise exception 'NOT_GYM_OWNER'; end if;
    select * into cur from public.user_subscriptions where gym_id = p_gym and status in ('active', 'past_due') limit 1;
  else
    if p_gym is not null then raise exception 'PERSONAL_PLAN_NO_GYM'; end if;
    select * into cur from public.user_subscriptions where user_id = me and gym_id is null and status in ('active', 'past_due') limit 1;
  end if;
  k := case when cur.id is null then 'new' when cur.plan_id = p_plan and cur.cycle = p_cycle then 'renewal' else 'change' end;

  select id into oid from public.subscription_payments
   where user_id = me and plan_id = p_plan and cycle = p_cycle and gym_id is not distinct from p_gym and status = 'pending'
     and created_at > now() - interval '1 hour'
   order by created_at desc limit 1;
  if oid is null then
    oid := 'sub_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.subscription_payments (id, user_id, plan_id, cycle, gym_id, kind, subscription_id, amount_krw)
    values (oid, me, p_plan, p_cycle, p_gym, k, cur.id, amt);
  else
    update public.subscription_payments set kind = k, subscription_id = cur.id, amount_krw = amt where id = oid;
  end if;
  return query select * from public.subscription_payments where id = oid;
end;
$$;
revoke all on function public.create_subscription_order(text, text, text) from public;
grant execute on function public.create_subscription_order(text, text, text) to authenticated;

-- 'paid'·'refunded' 는 service_role 만. 'failed'·'cancelled' 는 주문자 본인도 가능.
create or replace function public.finalize_subscription_payment(p_order text, p_status text, p_payment_key text default null, p_reason text default null, p_is_test boolean default true)
returns setof public.subscription_payments language plpgsql security definer set search_path = public as $$
declare
  is_service boolean := auth.role() = 'service_role';
  o public.subscription_payments;
  cur public.user_subscriptions;
  span interval;
  sid uuid;
begin
  select * into o from public.subscription_payments where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if p_status = 'paid' then
    if not is_service then raise exception 'FORBIDDEN_DIRECT_PAID_TRANSITION'; end if;
    if o.status = 'paid' then
      if o.payment_key is not distinct from p_payment_key then return query select * from public.subscription_payments where id = p_order; return; end if;
      raise exception 'ORDER_ALREADY_PAID';
    end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    span := case when o.cycle = 'monthly' then interval '1 month' else interval '1 year' end;
    if o.gym_id is null then
      select * into cur from public.user_subscriptions where user_id = o.user_id and gym_id is null and status in ('active', 'past_due') for update;
    else
      select * into cur from public.user_subscriptions where gym_id = o.gym_id and status in ('active', 'past_due') for update;
    end if;
    if cur.id is not null and cur.plan_id = o.plan_id and cur.cycle = o.cycle then
      -- 갱신: 남은 기간 뒤에 이어 붙인다
      update public.user_subscriptions
         set current_period_end = greatest(current_period_end, now()) + span, status = 'active',
             cancel_at_period_end = false, canceled_at = null, is_test = p_is_test, updated_at = now()
       where id = cur.id;
      sid := cur.id;
    else
      if cur.id is not null then
        -- 요금제 변경: 이전 구독은 교체로 종료 (차액 정산은 하지 않음 — 보고서에 명시)
        update public.user_subscriptions set status = 'canceled', canceled_at = now(), ended_reason = 'replaced',
               current_period_end = least(current_period_end, now()), updated_at = now()
         where id = cur.id;
      end if;
      insert into public.user_subscriptions (user_id, plan_id, cycle, gym_id, status, current_period_start, current_period_end, is_test)
      values (o.user_id, o.plan_id, o.cycle, o.gym_id, 'active', now(), now() + span, p_is_test)
      returning id into sid;
    end if;
    update public.subscription_payments set status = 'paid', payment_key = p_payment_key, paid_at = now(), is_test = p_is_test, subscription_id = sid
     where id = p_order;
  elsif p_status = 'refunded' then
    if not is_service then raise exception 'FORBIDDEN'; end if;
    if o.status = 'refunded' then return query select * from public.subscription_payments where id = p_order; return; end if;
    if o.status <> 'paid' then raise exception 'ORDER_NOT_REFUNDABLE'; end if;
    update public.subscription_payments set status = 'refunded', refunded_at = now(), failure_reason = p_reason where id = p_order;
    update public.user_subscriptions set status = 'expired', ended_reason = 'refunded', current_period_end = least(current_period_end, now()), updated_at = now()
     where id = o.subscription_id and status in ('active', 'past_due');
  elsif p_status in ('failed', 'cancelled') then
    if not is_service and o.user_id is distinct from auth.uid() then raise exception 'NOT_YOUR_ORDER'; end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    update public.subscription_payments set status = p_status, failure_reason = left(coalesce(p_reason, ''), 300) where id = p_order;
    -- 갱신 결제 실패: 기간이 끝난 구독은 past_due (유예기간 동안만 기능 유지)
    if p_status = 'failed' and o.subscription_id is not null then
      update public.user_subscriptions set status = 'past_due', updated_at = now()
       where id = o.subscription_id and status = 'active' and current_period_end <= now();
    end if;
  else
    raise exception 'INVALID_STATUS';
  end if;
  return query select * from public.subscription_payments where id = p_order;
end;
$$;
revoke all on function public.finalize_subscription_payment(text, text, text, text, boolean) from public;
grant execute on function public.finalize_subscription_payment(text, text, text, text, boolean) to authenticated, service_role;

create or replace function public.set_subscription_cancel(p_sub uuid, p_cancel boolean)
returns setof public.user_subscriptions language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  s public.user_subscriptions;
begin
  select * into s from public.user_subscriptions where id = p_sub for update;
  if not found then raise exception 'SUBSCRIPTION_NOT_FOUND'; end if;
  if s.user_id is distinct from me then raise exception 'NOT_YOUR_SUBSCRIPTION'; end if;
  if s.status not in ('active', 'past_due') then raise exception 'SUBSCRIPTION_NOT_ACTIVE'; end if;
  update public.user_subscriptions
     set cancel_at_period_end = p_cancel, canceled_at = case when p_cancel then now() else null end, updated_at = now()
   where id = p_sub;
  return query select * from public.user_subscriptions where id = p_sub;
end;
$$;
revoke all on function public.set_subscription_cancel(uuid, boolean) from public;
grant execute on function public.set_subscription_cancel(uuid, boolean) to authenticated;

-- 만료 처리 (pg_cron 또는 관리자 화면에서 호출). 시간 기반 판정(subscription_is_live)이라
-- 이 함수가 늦게 돌아도 권한은 이미 정확하다 — 상태 표시만 맞춘다.
create or replace function public.expire_due_subscriptions()
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
  grace int := (select past_due_grace_days from public.monetization_config);
begin
  if auth.role() <> 'service_role' and not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  update public.user_subscriptions set status = 'expired', ended_reason = coalesce(ended_reason, case when cancel_at_period_end then 'canceled' else 'not_renewed' end), updated_at = now()
   where status in ('active', 'past_due')
     and ((cancel_at_period_end and current_period_end <= now()) or current_period_end + make_interval(days => grace) <= now());
  get diagnostics n = row_count;
  update public.user_subscriptions set status = 'past_due', updated_at = now()
   where status = 'active' and not cancel_at_period_end and current_period_end <= now();
  return n;
end;
$$;
revoke all on function public.expire_due_subscriptions() from public;
grant execute on function public.expire_due_subscriptions() to authenticated, service_role;

-- ============ 7. 관리자: 설정 · 요금제 ============
create or replace function public.admin_update_monetization_config(p jsonb)
returns setof public.monetization_config language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p ? 'live_payments_enabled' or p ? 'cash_payout_enabled' or p ? 'minor_paid_enabled' then
    raise exception 'LOCKED_BY_POLICY';  -- 실결제·현금 지급은 마이그레이션으로만
  end if;
  update public.monetization_config set
    coin_name = coalesce(nullif(trim(p->>'coin_name'), ''), coin_name),
    coin_symbol = coalesce(nullif(trim(p->>'coin_symbol'), ''), coin_symbol),
    default_commission_bp = coalesce((p->>'default_commission_bp')::int, default_commission_bp),
    gear_fee_bp = coalesce((p->>'gear_fee_bp')::int, gear_fee_bp),
    coin_krw_rate = coalesce((p->>'coin_krw_rate')::numeric, coin_krw_rate),
    earnings_hold_days = coalesce((p->>'earnings_hold_days')::int, earnings_hold_days),
    settlement_min_coins = coalesce((p->>'settlement_min_coins')::int, settlement_min_coins),
    daily_checkin_coins = coalesce((p->>'daily_checkin_coins')::int, daily_checkin_coins),
    past_due_grace_days = coalesce((p->>'past_due_grace_days')::int, past_due_grace_days),
    content_refund_days = coalesce((p->>'content_refund_days')::int, content_refund_days),
    updated_at = now(), updated_by = auth.uid()
  where id;
  return query select * from public.monetization_config;
end;
$$;
revoke all on function public.admin_update_monetization_config(jsonb) from public;
grant execute on function public.admin_update_monetization_config(jsonb) to authenticated;

create or replace function public.admin_upsert_plan(p jsonb)
returns setof public.membership_plans language plpgsql security definer set search_path = public as $$
declare pid text := p->>'id';
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if pid = 'free' and (coalesce((p->>'price_monthly_krw')::int, 0) > 0 or coalesce((p->>'price_yearly_krw')::int, 0) > 0) then
    raise exception 'FREE_PLAN_MUST_BE_FREE';
  end if;
  insert into public.membership_plans (id, audience, name, tagline, tier, features, price_monthly_krw, price_yearly_krw, active, sort)
  values (pid, coalesce(p->>'audience', 'personal'), coalesce(p->>'name', pid), coalesce(p->>'tagline', ''),
          coalesce((p->>'tier')::smallint, 0),
          coalesce(array(select jsonb_array_elements_text(p->'features')), '{}'),
          coalesce((p->>'price_monthly_krw')::int, 0), coalesce((p->>'price_yearly_krw')::int, 0),
          coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set
    name = excluded.name, tagline = excluded.tagline, tier = excluded.tier,
    features = case when p ? 'features' then excluded.features else membership_plans.features end,
    price_monthly_krw = excluded.price_monthly_krw, price_yearly_krw = excluded.price_yearly_krw,
    active = excluded.active, sort = excluded.sort, updated_at = now();
  return query select * from public.membership_plans where id = pid;
end;
$$;
revoke all on function public.admin_upsert_plan(jsonb) from public;
grant execute on function public.admin_upsert_plan(jsonb) to authenticated;
