-- 수익화 검증(2026-11-17)에서 찾은 문제 수정: 운영자·개발자 계정(privileged_accounts)의 거래가
-- 일반 매출·판매 통계에 섞였다.
--   - admin_revenue_overview: 구독·코인 매출, 코인 발행·사용, 미사용 잔액, 유효 구독, 콘텐츠 판매 건수에서
--     특권 계정을 제외하고 'privileged_excluded' 에 따로 표시한다.
--   - purchase_product: 특권 계정의 무상 이용은 상품 판매 수(sales_count)를 올리지 않는다.
--   - my_creator_summary: 창작자 판매 건수에서 무상 이용 제외.
--   - 기존 sales_count 재계산(무상 이용 제외).
--   - post_ledger: 같은 멱등 키 요청이 정확히 동시에 오면 고유 키 충돌 오류 대신 먼저 기록된 거래를 돌려준다
--     (실제 Postgres 동시성 테스트에서 확인 — 이중 지급은 원래 없었고, 호출자가 오류를 받던 것만 바뀐다).
-- 테이블·데이터 구조는 바꾸지 않는다(함수 교체 + 판매 수 재계산만).

create or replace function public.post_ledger(
  p_user uuid, p_type text, p_amount bigint, p_ref_type text, p_ref_id text, p_key text, p_note text default '', p_actor uuid default null)
returns public.wallet_ledger language plpgsql security definer set search_path = public as $$
declare
  w public.wallets;
  e public.wallet_ledger;
begin
  if p_key is null or length(p_key) < 4 then raise exception 'IDEMPOTENCY_KEY_REQUIRED'; end if;
  select * into e from public.wallet_ledger where idempotency_key = p_key;
  if found then
    if e.user_id <> p_user or e.entry_type <> p_type or e.amount <> p_amount then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return e;  -- 같은 요청의 재시도: 다시 지급하지 않는다
  end if;
  insert into public.wallets (user_id) values (p_user) on conflict (user_id) do nothing;
  select * into w from public.wallets where user_id = p_user for update;
  if w.balance + p_amount < 0 then raise exception 'INSUFFICIENT_COINS'; end if;
  begin
    insert into public.wallet_ledger (user_id, entry_type, amount, balance_before, balance_after, ref_type, ref_id, idempotency_key, note, created_by)
    values (p_user, p_type, p_amount, w.balance, w.balance + p_amount, p_ref_type, p_ref_id, p_key, left(coalesce(p_note, ''), 500), coalesce(p_actor, auth.uid()))
    returning * into e;
  exception when unique_violation then
    -- 같은 키의 요청이 정확히 동시에 들어와 다른 트랜잭션이 먼저 기록했다 → 그 거래를 돌려준다(재지급 없음)
    select * into e from public.wallet_ledger where idempotency_key = p_key;
    if e.user_id <> p_user or e.entry_type <> p_type or e.amount <> p_amount then raise exception 'IDEMPOTENCY_KEY_REUSED'; end if;
    return e;
  end;
  update public.wallets set
    balance = e.balance_after,
    purchased_total = purchased_total + case when p_type = 'coin_purchase' then p_amount else 0 end,
    earned_total = earned_total + case when p_type in ('event_reward', 'promo_grant', 'activity_reward', 'creator_earning') then p_amount else 0 end,
    spent_total = spent_total + case when p_type = 'content_purchase' then -p_amount else 0 end,
    refunded_total = refunded_total + case when p_type = 'refund' then p_amount else 0 end,
    clawback_total = clawback_total + case when p_type = 'clawback' then -p_amount else 0 end,
    updated_at = now()
  where user_id = p_user;
  return e;
end;
$$;
revoke all on function public.post_ledger(uuid, text, bigint, text, text, text, text, uuid) from public;

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
  -- 운영자·개발자 계정의 무상 이용은 판매가 아니다
  if not priv then update public.creator_products set sales_count = sales_count + 1 where id = p_product; end if;
  return query select * from public.content_purchases where id = pid;
end;
$$;
revoke all on function public.purchase_product(uuid) from public;
grant execute on function public.purchase_product(uuid) to authenticated;

create or replace function public.my_creator_summary()
returns jsonb language plpgsql security definer set search_path = public as $$
declare me uuid := auth.uid();
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  perform public.release_matured_earnings(me);
  return jsonb_build_object(
    'gross_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where creator_id = me and status = 'completed' and not privileged_comp),
    'sales_count', (select count(*) from public.content_purchases where creator_id = me and status = 'completed' and not privileged_comp),
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
    -- 운영자·개발자 계정(privileged_accounts)의 거래는 위 모든 매출·발행·사용 통계에서 빠지고 여기서만 보인다
    'privileged_excluded', jsonb_build_object(
      'subscription_paid_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status in ('paid', 'refunded') and public.is_privileged_account(user_id) and paid_at >= p_from and paid_at < p_to),
      'coin_sales_krw', (select coalesce(sum(amount_krw), 0) from public.coin_orders where status in ('paid', 'refunded') and public.is_privileged_account(user_id) and paid_at >= p_from and paid_at < p_to),
      'ledger_entries', (select count(*) from public.wallet_ledger where public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to),
      'issued_free_coins', (select coalesce(sum(amount), 0) from public.wallet_ledger where entry_type in ('event_reward', 'promo_grant', 'activity_reward') and public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to),
      'content_comps', (select count(*) from public.content_purchases where privileged_comp and created_at >= p_from and created_at < p_to)),
    'subscriptions', jsonb_build_object(
      'personal_paid_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status in ('paid', 'refunded') and gym_id is null and not public.is_privileged_account(user_id) and paid_at >= p_from and paid_at < p_to),
      'business_paid_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status in ('paid', 'refunded') and gym_id is not null and not public.is_privileged_account(user_id) and paid_at >= p_from and paid_at < p_to),
      'refunded_krw', (select coalesce(sum(amount_krw), 0) from public.subscription_payments where status = 'refunded' and not public.is_privileged_account(user_id) and refunded_at >= p_from and refunded_at < p_to),
      'active_personal', (select count(*) from public.user_subscriptions s where s.gym_id is null and public.subscription_is_live(s) and not public.is_privileged_account(s.user_id)),
      'active_business', (select count(*) from public.user_subscriptions s where s.gym_id is not null and public.subscription_is_live(s) and not public.is_privileged_account(s.user_id)),
      'failed_payments', (select count(*) from public.subscription_payments where status = 'failed' and not public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to)),
    'coins', jsonb_build_object(
      -- 코인 충전액: 현금 매출이지만 아직 '선수금'(사용 전 코인) — 플랫폼 수익과 구분
      'sales_krw', (select coalesce(sum(amount_krw), 0) from public.coin_orders where status in ('paid', 'refunded') and not public.is_privileged_account(user_id) and paid_at >= p_from and paid_at < p_to),
      'refunded_krw', (select coalesce(sum(amount_krw), 0) from public.coin_orders where status = 'refunded' and not public.is_privileged_account(user_id) and refunded_at >= p_from and refunded_at < p_to),
      'issued_paid_coins', (select coalesce(sum(amount), 0) from public.wallet_ledger where entry_type = 'coin_purchase' and not public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to),
      'issued_free_coins', (select coalesce(sum(amount), 0) from public.wallet_ledger where entry_type in ('event_reward', 'promo_grant', 'activity_reward') and not public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to),
      'spent_coins', (select coalesce(-sum(amount), 0) from public.wallet_ledger where entry_type = 'content_purchase' and not public.is_privileged_account(user_id) and created_at >= p_from and created_at < p_to),
      'outstanding_coins', (select coalesce(sum(balance), 0) from public.wallets where not public.is_privileged_account(user_id))),
    'content', jsonb_build_object(
      'gross_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where status = 'completed' and not privileged_comp and created_at >= p_from and created_at < p_to),
      'platform_fee_coins', (select coalesce(sum(platform_fee_coins), 0) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'creator_share_coins', (select coalesce(sum(creator_earning_coins), 0) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'refunded_coins', (select coalesce(sum(price_coins), 0) from public.content_purchases where status = 'refunded' and not privileged_comp and refunded_at >= p_from and refunded_at < p_to),
      'platform_fee_krw_estimate', (select floor(coalesce(sum(platform_fee_coins), 0) * rate) from public.content_purchases where status = 'completed' and created_at >= p_from and created_at < p_to),
      'sales_count', (select count(*) from public.content_purchases where status = 'completed' and not privileged_comp and created_at >= p_from and created_at < p_to)),
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

update public.creator_products p set sales_count = (
  select count(*) from public.content_purchases c where c.product_id = p.id and c.status = 'completed' and not c.privileged_comp)
where sales_count is distinct from (
  select count(*) from public.content_purchases c where c.product_id = p.id and c.status = 'completed' and not c.privileged_comp);
