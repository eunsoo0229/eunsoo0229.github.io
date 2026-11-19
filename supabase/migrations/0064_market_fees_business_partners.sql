-- 수익화 4/4 — 기존 장비 마켓 거래 수수료 · 거래 분쟁 · 체육관 사업자 리포트 · 제휴/광고 · 관리자 수익 분석.
--
-- 원칙
--   - 기존 장비 마켓을 새로 만들지 않는다: gear_orders 에 수수료 컬럼만 추가하고, 새 주문에서만 계산한다
--     (기존 주문은 소급하지 않음). 수수료는 '배송 완료(delivered)'된 거래에서만 실현 수익으로 집계한다.
--   - 체육관 관리 기능은 그대로 두고, 사업자 요금제가 있는 체육관에만 사업자 리포트 RPC 를 연다.
--   - 제휴/광고는 관리자 승인형만. 광고주에게 사용자 데이터를 주지 않는다(노출·클릭은 개인 식별 없는 합계만).
--   - 수익 분석은 매출 / 코인 충전액 / 플랫폼 수익 / 창작자 몫 / 정산 예정액을 각각 따로 낸다.

-- ============ 1. 장비 마켓 거래 수수료 ============
alter table public.gear_orders add column if not exists fee_bp int;
alter table public.gear_orders add column if not exists platform_fee_krw int;
alter table public.gear_orders add column if not exists seller_net_krw int;

-- 수수료는 상품가(배송비 제외) 기준. 주문 생성 시(구매자가 금액을 확인한 시점) 현재 설정으로 계산하고,
-- 결제 대기 중 금액이 바뀔 때만 다시 계산한다 → 결제 확정·배송 등 상태 변경에는 고정.
create or replace function public.gear_orders_compute_fee()
returns trigger language plpgsql security definer set search_path = public as $$
declare bp int;
begin
  if tg_op = 'UPDATE' and not (old.status = 'pending' and new.status = 'pending'
                               and (new.item_price, new.shipping_fee) is distinct from (old.item_price, old.shipping_fee)) then
    new.fee_bp := old.fee_bp; new.platform_fee_krw := old.platform_fee_krw; new.seller_net_krw := old.seller_net_krw;
    return new;
  end if;
  bp := (select gear_fee_bp from public.monetization_config);
  new.fee_bp := bp;
  new.platform_fee_krw := round(new.item_price * bp / 10000.0)::int;
  new.seller_net_krw := new.item_price + new.shipping_fee - new.platform_fee_krw;
  return new;
end;
$$;
drop trigger if exists gear_orders_fee on public.gear_orders;
create trigger gear_orders_fee before insert or update on public.gear_orders
  for each row execute function public.gear_orders_compute_fee();

-- ============ 2. 거래 분쟁 ============
create table if not exists public.gear_order_disputes (
  id uuid primary key default gen_random_uuid(),
  order_id text not null references public.gear_orders (id) on delete cascade,
  opened_by uuid not null references auth.users (id) on delete cascade,
  reason text not null check (reason in ('not_received', 'not_as_described', 'damaged', 'seller_unresponsive', 'buyer_unresponsive', 'other')),
  detail text not null default '' check (length(detail) <= 2000),
  status text not null default 'open' check (status in ('open', 'resolved_refund', 'resolved_no_refund', 'withdrawn')),
  resolution_note text,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create unique index if not exists gear_order_disputes_one_open on public.gear_order_disputes (order_id) where status = 'open';
alter table public.gear_order_disputes enable row level security;
drop policy if exists "gear_order_disputes_select" on public.gear_order_disputes;
create policy "gear_order_disputes_select" on public.gear_order_disputes for select
  using (public.is_platform_admin(auth.uid()) or exists (select 1 from public.gear_orders o where o.id = order_id and auth.uid() in (o.buyer_id, o.seller_id)));
grant select on public.gear_order_disputes to authenticated;

create or replace function public.open_gear_dispute(p_order text, p_reason text, p_detail text)
returns setof public.gear_order_disputes language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  o public.gear_orders;
  did uuid;
begin
  select * into o from public.gear_orders where id = p_order;
  if not found or me is null or me not in (o.buyer_id, o.seller_id) then raise exception 'NOT_YOUR_ORDER'; end if;
  if o.status not in ('paid', 'shipped', 'delivered') then raise exception 'ORDER_NOT_DISPUTABLE'; end if;
  if o.status = 'delivered' and coalesce(o.updated_at, o.created_at) < now() - interval '14 days' then raise exception 'DISPUTE_WINDOW_CLOSED'; end if;
  insert into public.gear_order_disputes (order_id, opened_by, reason, detail)
  values (p_order, me, p_reason, left(coalesce(p_detail, ''), 2000)) returning id into did;
  return query select * from public.gear_order_disputes where id = did;
end;
$$;
revoke all on function public.open_gear_dispute(text, text, text) from public;
grant execute on function public.open_gear_dispute(text, text, text) to authenticated;

-- 관리자 판정 기록. 실제 결제 취소(환불)는 결제사 승인이 필요하므로 payment-verify(gear_refund)로 따로 한다.
create or replace function public.admin_resolve_gear_dispute(p_dispute uuid, p_status text, p_note text)
returns setof public.gear_order_disputes language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_status not in ('resolved_refund', 'resolved_no_refund', 'withdrawn') then raise exception 'INVALID_STATUS'; end if;
  update public.gear_order_disputes set status = p_status, resolution_note = p_note, resolved_by = auth.uid(), resolved_at = now()
   where id = p_dispute and status = 'open';
  if not found then raise exception 'DISPUTE_NOT_OPEN'; end if;
  return query select * from public.gear_order_disputes where id = p_dispute;
end;
$$;
revoke all on function public.admin_resolve_gear_dispute(uuid, text, text) from public;
grant execute on function public.admin_resolve_gear_dispute(uuid, text, text) to authenticated;

-- ============ 3. 체육관 사업자 리포트 (사업자 요금제 기능) ============
create or replace function public.gym_business_report(p_gym text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if public.gym_owner_of(p_gym) is distinct from me and not public.is_gym_instructor(p_gym, me) and not public.is_privileged_account(me) then
    raise exception 'NOT_GYM_STAFF';
  end if;
  if not public.has_entitlement(me, 'gym_business_reports') or not public.gym_has_business_plan(p_gym) then
    raise exception 'BUSINESS_PLAN_REQUIRED';
  end if;
  return jsonb_build_object(
    'members', (select count(*) from public.gym_members where gym_id = p_gym),
    'students', (select count(*) from public.gym_members where gym_id = p_gym and role = 'student'),
    'instructors', (select count(*) from public.gym_members where gym_id = p_gym and role = 'instructor'),
    'new_members_30d', (select count(*) from public.gym_members where gym_id = p_gym and joined_at > now() - interval '30 days'),
    'active_learners_30d', (select count(*) from public.gym_member_progress where gym_id = p_gym and updated_at > now() - interval '30 days'),
    'assignments_open', (select count(*) from public.gym_assignments where gym_id = p_gym and status = 'open'),
    'assignments_done_30d', (select count(*) from public.gym_assignments where gym_id = p_gym and status = 'done' and updated_at > now() - interval '30 days'),
    'join_requests_pending', (select count(*) from public.gym_join_requests where gym_id = p_gym and status = 'pending'),
    'announcements_30d', (select count(*) from public.gym_announcements where gym_id = p_gym and created_at > now() - interval '30 days'),
    'leads_30d', (select count(*) from public.gym_leads l join public.gym_listings g on g.id = l.listing_id where g.gym_id = p_gym and l.created_at > now() - interval '30 days'),
    'review_avg', (select round(avg(r.rating)::numeric, 2) from public.gym_reviews r join public.gym_listings g on g.id = r.listing_id where g.gym_id = p_gym),
    'review_count', (select count(*) from public.gym_reviews r join public.gym_listings g on g.id = r.listing_id where g.gym_id = p_gym),
    'generated_at', now()
  );
end;
$$;
revoke all on function public.gym_business_report(text) from public;
grant execute on function public.gym_business_report(text) to authenticated;

-- ============ 4. 제휴 · 광고 (관리자 승인형) ============
create table if not exists public.partner_campaigns (
  id uuid primary key default gen_random_uuid(),
  partner_name text not null check (length(trim(partner_name)) between 1 and 60),
  kind text not null check (kind in ('brand', 'gym_promo', 'content', 'official_promo', 'product')),
  -- 광고와 일반 콘텐츠 구분 표시 (화면에 항상 노출)
  label text not null default '광고' check (label in ('광고', '제휴', '프로모션')),
  title text not null check (length(trim(title)) between 2 and 80),
  body text not null default '' check (length(body) <= 500),
  image_url text,
  link_url text check (link_url is null or link_url ~ '^https://'),
  placement text not null check (placement in ('home', 'gear', 'content', 'learning')),
  -- 미성년 보호: 성인 대상 상품은 노출 금지 플래그 (연령 타깃팅은 하지 않는다)
  adult_only boolean not null default false check (not adult_only),
  starts_at timestamptz not null default now(),
  ends_at timestamptz,
  status text not null default 'draft' check (status in ('draft', 'approved', 'paused', 'ended')),
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.partner_campaigns enable row level security;
drop policy if exists "partner_campaigns_select" on public.partner_campaigns;
create policy "partner_campaigns_select" on public.partner_campaigns for select
  using ((status = 'approved' and now() >= starts_at and (ends_at is null or now() < ends_at)) or public.is_platform_admin(auth.uid()));
grant select on public.partner_campaigns to anon, authenticated;

-- 계약 금액은 별도 테이블 (관리자만)
create table if not exists public.partner_contracts (
  campaign_id uuid primary key references public.partner_campaigns (id) on delete cascade,
  fee_krw bigint not null default 0 check (fee_krw >= 0),
  billing text not null default 'flat' check (billing in ('flat', 'monthly')),
  contract_reference text not null default '',
  invoiced boolean not null default false,
  updated_at timestamptz not null default now()
);
alter table public.partner_contracts enable row level security;
drop policy if exists "partner_contracts_admin" on public.partner_contracts;
create policy "partner_contracts_admin" on public.partner_contracts for select using (public.is_platform_admin(auth.uid()));
grant select on public.partner_contracts to authenticated;

create or replace function public.admin_save_partner_campaign(p jsonb)
returns setof public.partner_campaigns language plpgsql security definer set search_path = public as $$
declare cid uuid := nullif(p->>'id', '')::uuid;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if cid is null then
    insert into public.partner_campaigns (partner_name, kind, label, title, body, image_url, link_url, placement, starts_at, ends_at, status, created_by)
    values (trim(p->>'partner_name'), p->>'kind', coalesce(p->>'label', '광고'), trim(p->>'title'), coalesce(p->>'body', ''),
            nullif(p->>'image_url', ''), nullif(p->>'link_url', ''), p->>'placement',
            coalesce((p->>'starts_at')::timestamptz, now()), (p->>'ends_at')::timestamptz, coalesce(p->>'status', 'draft'), auth.uid())
    returning id into cid;
  else
    update public.partner_campaigns set
      partner_name = coalesce(trim(p->>'partner_name'), partner_name), kind = coalesce(p->>'kind', kind), label = coalesce(p->>'label', label),
      title = coalesce(trim(p->>'title'), title), body = coalesce(p->>'body', body), image_url = coalesce(nullif(p->>'image_url', ''), image_url),
      link_url = coalesce(nullif(p->>'link_url', ''), link_url), placement = coalesce(p->>'placement', placement),
      starts_at = coalesce((p->>'starts_at')::timestamptz, starts_at), ends_at = coalesce((p->>'ends_at')::timestamptz, ends_at),
      status = coalesce(p->>'status', status), updated_at = now()
    where id = cid;
  end if;
  if p ? 'fee_krw' then
    insert into public.partner_contracts (campaign_id, fee_krw, billing, contract_reference)
    values (cid, (p->>'fee_krw')::bigint, coalesce(p->>'billing', 'flat'), coalesce(p->>'contract_reference', ''))
    on conflict (campaign_id) do update set fee_krw = excluded.fee_krw, billing = excluded.billing,
      contract_reference = excluded.contract_reference, updated_at = now();
  end if;
  return query select * from public.partner_campaigns where id = cid;
end;
$$;
revoke all on function public.admin_save_partner_campaign(jsonb) from public;
grant execute on function public.admin_save_partner_campaign(jsonb) to authenticated;

-- 노출·클릭은 합계만 (누가 봤는지 기록하지 않는다)
create or replace function public.record_campaign_event(p_campaign uuid, p_event text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_event = 'impression' then
    update public.partner_campaigns set impressions = impressions + 1 where id = p_campaign and status = 'approved';
  elsif p_event = 'click' then
    update public.partner_campaigns set clicks = clicks + 1 where id = p_campaign and status = 'approved';
  end if;
end;
$$;
revoke all on function public.record_campaign_event(uuid, text) from public;
grant execute on function public.record_campaign_event(uuid, text) to anon, authenticated;

-- ============ 5. 관리자 수익 분석 ============
-- 단위를 섞지 않는다: *_krw 는 원, *_coins 는 코인. "플랫폼 수익"과 "매출(거래액)"을 구분.
create or replace function public.admin_revenue_overview(p_from timestamptz default now() - interval '30 days', p_to timestamptz default now())
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare rate numeric := (select coin_krw_rate from public.monetization_config);
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  return jsonb_build_object(
    'period', jsonb_build_object('from', p_from, 'to', p_to),
    'all_test_payments', not exists (
      select 1 from public.subscription_payments where status in ('paid', 'refunded') and not is_test
      union all select 1 from public.coin_orders where status in ('paid', 'refunded') and not is_test),
    'subscriptions', jsonb_build_object(
      'personal_paid_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status in ('paid', 'refunded') and gym_id is null and paid_at >= p_from and paid_at < p_to),
      'business_paid_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status in ('paid', 'refunded') and gym_id is not null and paid_at >= p_from and paid_at < p_to),
      'refunded_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to),
      'active_personal', (select count(*) from public.user_subscriptions s where s.gym_id is null and public.subscription_is_live(s)),
      'active_business', (select count(*) from public.user_subscriptions s where s.gym_id is not null and public.subscription_is_live(s)),
      'failed_payments', (select count(*) from public.subscription_payments where status = 'failed' and created_at >= p_from and created_at < p_to)),
    'coins', jsonb_build_object(
      -- 코인 충전액: 현금 매출이지만 아직 '선수금'(사용 전 코인) — 플랫폼 수익과 구분
      'sales_krw', (select coalesce(sum(amount_krw), 0) from public.coin_orders where status in ('paid', 'refunded') and paid_at >= p_from and paid_at < p_to),
      'refunded_krw', (select coalesce(sum(amount_krw), 0) from public.coin_orders where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to),
      'issued_paid_coins', (select coalesce(sum(amount), 0) from public.wallet_ledger where entry_type = 'coin_purchase' and created_at >= p_from and created_at < p_to),
      'issued_free_coins', (select coalesce(sum(amount), 0) from public.wallet_ledger where entry_type in ('event_reward', 'promo_grant', 'activity_reward') and created_at >= p_from and created_at < p_to),
      'spent_coins', (select coalesce(-sum(amount), 0) from public.wallet_ledger where entry_type = 'content_purchase' and created_at >= p_from and created_at < p_to),
      'outstanding_coins', (select coalesce(sum(balance), 0) from public.wallets)),
    'content', jsonb_build_object(
      'gross_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where status = 'completed' and not privileged_comp and created_at >= p_from and created_at < p_to),
      'platform_fee_coins', (select coalesce(sum(platform_fee_coins), 0) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'creator_share_coins', (select coalesce(sum(creator_earning_coins), 0) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'refunded_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where status = 'refunded' and not privileged_comp and refunded_at >= p_from and refunded_at < p_to),
      'platform_fee_krw_estimate', (select floor(coalesce(sum(platform_fee_coins), 0) * rate) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'sales_count', (select count(*) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to)),
    'gear', jsonb_build_object(
      'gmv_delivered_krw', (select coalesce(sum(amount), 0) from public.gear_orders where status = 'delivered' and updated_at >= p_from and updated_at < p_to),
      'fee_realized_krw', (select coalesce(sum(platform_fee_krw), 0) from public.gear_orders where status = 'delivered' and updated_at >= p_from and updated_at < p_to),
      'fee_pending_krw', (select coalesce(sum(platform_fee_krw), 0) from public.gear_orders where status in ('paid', 'shipped')),
      'refunded_krw', (select coalesce(sum(amount), 0) from public.gear_orders where status = 'refunded' and refunded_at >= p_from and refunded_at < p_to),
      'open_disputes', (select count(*) from public.gear_order_disputes where status = 'open')),
    'curriculum_market', jsonb_build_object(
      'gmv_krw', (select coalesce(sum(price_krw), 0) from public.marketplace_orders where status in ('paid', 'completed') and created_at >= p_from and created_at < p_to),
      'fee_krw', (select coalesce(sum(platform_fee_krw), 0) from public.marketplace_orders where status in ('paid', 'completed') and created_at >= p_from and created_at < p_to)),
    'partners', jsonb_build_object(
      'active_campaigns', (select count(*) from public.partner_campaigns where status = 'approved' and now() >= starts_at and (ends_at is null or now() < ends_at)),
      'contract_fee_krw', (select coalesce(sum(c.fee_krw), 0) from public.partner_contracts c join public.partner_campaigns p on p.id = c.campaign_id where p.created_at < p_to and (p.ends_at is null or p.ends_at >= p_from))),
    'settlements', jsonb_build_object(
      'pending_coins', (select coalesce(sum(amount_coins), 0) from public.settlement_requests where status in ('requested', 'approved', 'on_hold')),
      'pending_krw_estimate', (select coalesce(sum(amount_krw_estimate), 0) from public.settlement_requests where status in ('requested', 'approved', 'on_hold')),
      'paid_simulated_krw_estimate', (select coalesce(sum(amount_krw_estimate), 0) from public.settlement_requests where status = 'paid_simulated'),
      'creator_held_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where status = 'held'),
      'creator_available_coins', (select coalesce(sum(amount_coins), 0) from public.creator_earnings where status = 'available'))
  );
end;
$$;
revoke all on function public.admin_revenue_overview(timestamptz, timestamptz) from public;
grant execute on function public.admin_revenue_overview(timestamptz, timestamptz) to authenticated;
