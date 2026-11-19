-- 수익화 2/4 — MARTIAL COIN 지갑 · 거래 원장 · 코인 상품/주문 · 보상 · 무결성 점검.
--
-- 원칙
--   - 잔액은 원장(wallet_ledger)으로만 바뀐다. 클라이언트에는 wallets/ledger 쓰기 권한이 없다.
--   - 원장은 추가 전용: UPDATE/DELETE 는 트리거가 막는다(관리자 포함). 오류는 보정 거래로 남긴다.
--   - 모든 원장 행은 고유 idempotency_key 를 가진다 → 같은 결제·보상이 두 번 지급되지 않는다.
--   - 잔액 변경은 지갑 행 잠금(for update) 안에서 한다 → 동시 거래에도 before/after 가 이어진다.
--   - 운영자·개발자 계정(privileged_accounts)은 무제한: 지출은 0코인으로 기록하고 원 가격은 note 에 남긴다.
--   - 확률형 아이템·베팅·코인 현금 환전은 없다.

-- ============ 1. 지갑 ============
create table if not exists public.wallets (
  user_id uuid primary key references auth.users (id) on delete cascade,
  balance bigint not null default 0 check (balance >= 0),
  purchased_total bigint not null default 0,
  earned_total bigint not null default 0,
  spent_total bigint not null default 0,
  refunded_total bigint not null default 0,
  clawback_total bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table public.wallets enable row level security;
drop policy if exists "wallets_select_own" on public.wallets;
create policy "wallets_select_own" on public.wallets for select using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.wallets to authenticated;

-- ============ 2. 원장 ============
create table if not exists public.wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  seq bigserial not null unique,
  user_id uuid not null references auth.users (id) on delete cascade,
  entry_type text not null check (entry_type in (
    'coin_purchase', 'event_reward', 'promo_grant', 'activity_reward', 'content_purchase',
    'creator_earning', 'refund', 'clawback', 'admin_adjustment', 'test')),
  amount bigint not null,
  balance_before bigint not null,
  balance_after bigint not null,
  ref_type text,
  ref_id text,
  idempotency_key text not null unique,
  note text not null default '',
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint wallet_ledger_balance_math check (balance_after = balance_before + amount and balance_after >= 0)
);
create index if not exists wallet_ledger_user_idx on public.wallet_ledger (user_id, seq desc);
create index if not exists wallet_ledger_ref_idx on public.wallet_ledger (ref_type, ref_id);
alter table public.wallet_ledger enable row level security;
drop policy if exists "wallet_ledger_select_own" on public.wallet_ledger;
create policy "wallet_ledger_select_own" on public.wallet_ledger for select using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.wallet_ledger to authenticated;

create or replace function public.wallet_ledger_immutable()
returns trigger language plpgsql as $$
begin
  -- 유일한 예외: 회원 탈퇴(auth.users 삭제)의 FK cascade — 그때는 트리거 깊이가 2 이상이다.
  -- 직접 실행한 UPDATE/DELETE 는 깊이 1 → 항상 거부.
  if tg_op = 'DELETE' and pg_trigger_depth() > 1 then return old; end if;
  raise exception 'LEDGER_IMMUTABLE';
end;
$$;
drop trigger if exists wallet_ledger_no_update on public.wallet_ledger;
create trigger wallet_ledger_no_update before update or delete on public.wallet_ledger
  for each row execute function public.wallet_ledger_immutable();

-- 유일한 잔액 변경 경로. 클라이언트에 노출하지 않는다(권한 없음) — 아래 RPC 들이 검증 후 호출.
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
  insert into public.wallet_ledger (user_id, entry_type, amount, balance_before, balance_after, ref_type, ref_id, idempotency_key, note, created_by)
  values (p_user, p_type, p_amount, w.balance, w.balance + p_amount, p_ref_type, p_ref_id, p_key, left(coalesce(p_note, ''), 500), coalesce(p_actor, auth.uid()))
  returning * into e;
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

-- ============ 3. 코인 상품 · 주문 ============
create table if not exists public.coin_packages (
  id text primary key check (id ~ '^[a-z0-9_-]{2,32}$'),
  name text not null,
  coins int not null check (coins > 0),
  bonus_coins int not null default 0 check (bonus_coins >= 0),
  price_krw int not null check (price_krw >= 100),
  active boolean not null default true,
  sort int not null default 0,
  updated_at timestamptz not null default now()
);
alter table public.coin_packages enable row level security;
drop policy if exists "coin_packages_read" on public.coin_packages;
create policy "coin_packages_read" on public.coin_packages for select using (true);
grant select on public.coin_packages to anon, authenticated;
-- 예시 구성 (원화 가격·보너스는 관리자 설정) — 총량은 기획서 표: 1,000 / 5,500 / 12,000 / 25,000
insert into public.coin_packages (id, name, coins, bonus_coins, price_krw, sort) values
  ('starter', 'Starter', 1000, 0, 1000, 0),
  ('standard', 'Standard', 5000, 500, 5000, 1),
  ('premium', 'Premium', 10000, 2000, 10000, 2),
  ('ultimate', 'Ultimate', 20000, 5000, 20000, 3)
on conflict (id) do nothing;

create table if not exists public.coin_orders (
  id text primary key,
  user_id uuid not null references auth.users (id) on delete cascade,
  package_id text not null references public.coin_packages (id),
  coins int not null,
  bonus_coins int not null default 0,
  amount_krw int not null check (amount_krw >= 100),
  status text not null default 'pending' check (status in ('pending', 'paid', 'failed', 'cancelled', 'refunded')),
  payment_key text,
  is_test boolean not null default true,
  failure_reason text,
  refund_shortfall int not null default 0,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  refunded_at timestamptz
);
create unique index if not exists coin_orders_payment_key_unique on public.coin_orders (payment_key) where payment_key is not null;
create index if not exists coin_orders_user_idx on public.coin_orders (user_id, created_at desc);
alter table public.coin_orders enable row level security;
drop policy if exists "coin_orders_select_own" on public.coin_orders;
create policy "coin_orders_select_own" on public.coin_orders for select using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.coin_orders to authenticated;

create or replace function public.create_coin_order(p_package text)
returns setof public.coin_orders language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  pk public.coin_packages;
  oid text;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into pk from public.coin_packages where id = p_package and active;
  if not found then raise exception 'PACKAGE_UNAVAILABLE'; end if;
  select id into oid from public.coin_orders where user_id = me and package_id = p_package and status = 'pending'
     and created_at > now() - interval '1 hour' order by created_at desc limit 1;
  if oid is null then
    oid := 'coin_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.coin_orders (id, user_id, package_id, coins, bonus_coins, amount_krw)
    values (oid, me, pk.id, pk.coins, pk.bonus_coins, pk.price_krw);
  else
    -- 가격은 항상 서버의 현재 상품 정의로 다시 계산
    update public.coin_orders set coins = pk.coins, bonus_coins = pk.bonus_coins, amount_krw = pk.price_krw where id = oid;
  end if;
  return query select * from public.coin_orders where id = oid;
end;
$$;
revoke all on function public.create_coin_order(text) from public;
grant execute on function public.create_coin_order(text) to authenticated;

-- 환불 가능 여부(코인 미사용) — Edge Function 이 Toss 취소 전에 확인한다.
create or replace function public.coin_order_refundable(p_order text)
returns boolean language plpgsql security definer set search_path = public stable as $$
declare
  o public.coin_orders;
  bal bigint;
begin
  select * into o from public.coin_orders where id = p_order;
  if not found or o.status <> 'paid' then return false; end if;
  if auth.role() <> 'service_role' and o.user_id is distinct from auth.uid() and not public.is_platform_admin(auth.uid()) then return false; end if;
  select balance into bal from public.wallets where user_id = o.user_id;
  return coalesce(bal, 0) >= o.coins + o.bonus_coins and o.paid_at > now() - interval '7 days';
end;
$$;
revoke all on function public.coin_order_refundable(text) from public;
grant execute on function public.coin_order_refundable(text) to authenticated, service_role;

create or replace function public.finalize_coin_order(p_order text, p_status text, p_payment_key text default null, p_reason text default null, p_is_test boolean default true)
returns setof public.coin_orders language plpgsql security definer set search_path = public as $$
declare
  is_service boolean := auth.role() = 'service_role';
  o public.coin_orders;
  bal bigint;
  take bigint;
begin
  select * into o from public.coin_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;
  if p_status = 'paid' then
    if not is_service then raise exception 'FORBIDDEN_DIRECT_PAID_TRANSITION'; end if;
    if o.status = 'paid' then
      if o.payment_key is not distinct from p_payment_key then return query select * from public.coin_orders where id = p_order; return; end if;
      raise exception 'ORDER_ALREADY_PAID';
    end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    update public.coin_orders set status = 'paid', payment_key = p_payment_key, paid_at = now(), is_test = p_is_test where id = p_order;
    perform public.post_ledger(o.user_id, 'coin_purchase', (o.coins + o.bonus_coins)::bigint, 'coin_order', o.id, 'coin_order:' || o.id,
      o.coins || ' + 보너스 ' || o.bonus_coins || case when p_is_test then ' (테스트 결제)' else '' end, o.user_id);
  elsif p_status = 'refunded' then
    if not is_service then raise exception 'FORBIDDEN'; end if;
    if o.status = 'refunded' then return query select * from public.coin_orders where id = p_order; return; end if;
    if o.status <> 'paid' then raise exception 'ORDER_NOT_REFUNDABLE'; end if;
    -- 결제사 취소가 끝난 뒤 호출된다: 남은 코인 안에서 회수하고, 모자라면 부족분을 기록(관리자 검토)
    select balance into bal from public.wallets where user_id = o.user_id for update;
    take := least(coalesce(bal, 0), (o.coins + o.bonus_coins)::bigint);
    if take > 0 then
      perform public.post_ledger(o.user_id, 'clawback', -take, 'coin_order', o.id, 'coin_refund:' || o.id, '코인 구매 환불 회수', o.user_id);
    end if;
    update public.coin_orders set status = 'refunded', refunded_at = now(), failure_reason = p_reason,
           refund_shortfall = (o.coins + o.bonus_coins) - take
     where id = p_order;
  elsif p_status in ('failed', 'cancelled') then
    if not is_service and o.user_id is distinct from auth.uid() then raise exception 'NOT_YOUR_ORDER'; end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    update public.coin_orders set status = p_status, failure_reason = left(coalesce(p_reason, ''), 300) where id = p_order;
  else
    raise exception 'INVALID_STATUS';
  end if;
  return query select * from public.coin_orders where id = p_order;
end;
$$;
revoke all on function public.finalize_coin_order(text, text, text, text, boolean) from public;
grant execute on function public.finalize_coin_order(text, text, text, text, boolean) to authenticated, service_role;

-- ============ 4. 보상 ============
-- 학습 활동 보상: 하루 1회 출석 (서울 날짜 기준) — 키가 날짜에 묶여 있어 반복 호출해도 1회.
create or replace function public.claim_daily_checkin()
returns public.wallet_ledger language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  coins int := (select daily_checkin_coins from public.monetization_config);
  d date := (now() at time zone 'Asia/Seoul')::date;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if coins <= 0 then raise exception 'REWARD_DISABLED'; end if;
  return public.post_ledger(me, 'activity_reward', coins, 'daily_checkin', d::text, 'checkin:' || me || ':' || d, '출석 보상', me);
end;
$$;
revoke all on function public.claim_daily_checkin() from public;
grant execute on function public.claim_daily_checkin() to authenticated;

-- 이벤트·프로모션 지급 (관리자). p_key 로 같은 캠페인 중복 지급을 막는다.
create or replace function public.admin_grant_coins(p_user uuid, p_amount int, p_type text, p_campaign text, p_key text)
returns public.wallet_ledger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_type not in ('event_reward', 'promo_grant') then raise exception 'INVALID_TYPE'; end if;
  if p_amount is null or p_amount <= 0 or p_amount > 100000 then raise exception 'INVALID_AMOUNT'; end if;
  if coalesce(trim(p_campaign), '') = '' then raise exception 'CAMPAIGN_REQUIRED'; end if;
  return public.post_ledger(p_user, p_type, p_amount, 'campaign', trim(p_campaign), 'grant:' || trim(p_campaign) || ':' || p_user || ':' || coalesce(p_key, ''), trim(p_campaign), auth.uid());
end;
$$;
revoke all on function public.admin_grant_coins(uuid, int, text, text, text) from public;
grant execute on function public.admin_grant_coins(uuid, int, text, text, text) to authenticated;

-- 관리자 보정 거래 (원장 수정 대신). 사유 필수.
create or replace function public.admin_adjust_wallet(p_user uuid, p_amount int, p_reason text)
returns public.wallet_ledger language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  if p_amount is null or p_amount = 0 or abs(p_amount) > 1000000 then raise exception 'INVALID_AMOUNT'; end if;
  if length(coalesce(trim(p_reason), '')) < 4 then raise exception 'REASON_REQUIRED'; end if;
  return public.post_ledger(p_user, 'admin_adjustment', p_amount, 'admin', null, 'adjust:' || gen_random_uuid(), trim(p_reason), auth.uid());
end;
$$;
revoke all on function public.admin_adjust_wallet(uuid, int, text) from public;
grant execute on function public.admin_adjust_wallet(uuid, int, text) to authenticated;

create or replace function public.admin_upsert_coin_package(p jsonb)
returns setof public.coin_packages language plpgsql security definer set search_path = public as $$
declare pid text := p->>'id';
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'FORBIDDEN'; end if;
  insert into public.coin_packages (id, name, coins, bonus_coins, price_krw, active, sort)
  values (pid, coalesce(p->>'name', pid), (p->>'coins')::int, coalesce((p->>'bonus_coins')::int, 0), (p->>'price_krw')::int,
          coalesce((p->>'active')::boolean, true), coalesce((p->>'sort')::int, 0))
  on conflict (id) do update set name = excluded.name, coins = excluded.coins, bonus_coins = excluded.bonus_coins,
    price_krw = excluded.price_krw, active = excluded.active, sort = excluded.sort, updated_at = now();
  return query select * from public.coin_packages where id = pid;
end;
$$;
revoke all on function public.admin_upsert_coin_package(jsonb) from public;
grant execute on function public.admin_upsert_coin_package(jsonb) to authenticated;

-- ============ 5. 무결성 점검 (관리자) ============
create or replace function public.wallet_integrity_report()
returns table (check_name text, user_id uuid, ref text, detail text) language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) and auth.role() <> 'service_role' then raise exception 'FORBIDDEN'; end if;
  -- 1) 지갑 잔액 ≠ 원장 합계
  return query
    select 'balance_mismatch', w.user_id, null::text, 'wallet=' || w.balance || ' ledger=' || coalesce(sum(l.amount), 0)
      from public.wallets w left join public.wallet_ledger l on l.user_id = w.user_id
     group by w.user_id, w.balance having w.balance <> coalesce(sum(l.amount), 0);
  -- 2) 원장 연쇄 끊김 (이전 행 balance_after ≠ 다음 행 balance_before)
  return query
    select 'chain_break', x.user_id, x.id::text, 'prev_after=' || x.prev_after || ' before=' || x.balance_before
      from (select l.*, lag(l.balance_after) over (partition by l.user_id order by l.seq) as prev_after from public.wallet_ledger l) x
     where x.prev_after is not null and x.prev_after <> x.balance_before;
  -- 3) 결제 완료 코인 주문인데 지급 원장이 없음 / 지급 원장인데 결제 완료 주문이 없음
  return query
    select 'paid_without_credit', o.user_id, o.id, o.amount_krw || '원'
      from public.coin_orders o where o.status in ('paid', 'refunded')
       and not exists (select 1 from public.wallet_ledger l where l.idempotency_key = 'coin_order:' || o.id);
  return query
    select 'credit_without_paid_order', l.user_id, l.ref_id, l.amount || '코인'
      from public.wallet_ledger l where l.entry_type = 'coin_purchase'
       and not exists (select 1 from public.coin_orders o where o.id = l.ref_id and o.status in ('paid', 'refunded'));
  -- 4) 같은 대상에 같은 유형 거래가 중복
  return query
    select 'duplicate_reference', l.user_id, l.ref_type || ':' || l.ref_id, l.entry_type || ' x' || count(*)
      from public.wallet_ledger l where l.ref_id is not null and l.entry_type in ('coin_purchase', 'content_purchase', 'refund', 'clawback')
     group by l.user_id, l.ref_type, l.ref_id, l.entry_type having count(*) > 1;
  -- 5) 비정상 지급: 최근 30일 단일 지급 50,000코인 이상(구매 제외)
  return query
    select 'large_grant', l.user_id, l.id::text, l.entry_type || ' ' || l.amount
      from public.wallet_ledger l where l.amount >= 50000 and l.entry_type <> 'coin_purchase' and l.created_at > now() - interval '30 days';
  -- 6) 환불 회수 부족분 (이미 쓴 코인)
  return query
    select 'refund_shortfall', o.user_id, o.id, o.refund_shortfall || '코인 미회수'
      from public.coin_orders o where o.refund_shortfall > 0;
end;
$$;
revoke all on function public.wallet_integrity_report() from public;
grant execute on function public.wallet_integrity_report() to authenticated, service_role;
