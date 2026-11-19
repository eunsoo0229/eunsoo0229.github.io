-- 장비 중고거래 택배 거래 결제 (TossPayments — 테스트 모드). 직거래는 기존처럼 DM 으로만 하고,
-- "택배 가능" 상품을 택배로 살 때만 결제를 거친다.
--
-- 흐름: 구매자 주문 생성(배송지) → Toss 결제창 → payment-verify Edge Function 이 Toss 승인 API 로
-- 확인한 뒤 service_role 로만 'paid' 확정 → 상품 판매 완료 → 판매자 발송(택배사·송장) → 구매자 수령 확인.
-- 발송 전에는 구매자·판매자가 결제 취소(환불)를 요청할 수 있고, Edge Function 이 Toss 취소 API 를 부른다.
--
-- 금액은 서버가 상품 가격 + 판매자가 정한 배송비로 계산한다(클라이언트가 보낸 금액을 쓰지 않음).
-- 결제 대금은 플랫폼의 Toss 가맹점으로 들어온다. 판매자 정산(지급)은 이 마이그레이션 범위 밖이다.
-- 배송지(개인정보)는 그 주문의 구매자·판매자(와 플랫폼 관리자)만 읽을 수 있다.

alter table public.gear_listings add column if not exists shipping_fee int not null default 0;
do $$ begin
  alter table public.gear_listings add constraint gear_listings_shipping_fee_check check (shipping_fee between 0 and 1000000);
exception when duplicate_object then null; end $$;

create table if not exists public.gear_orders (
  id text primary key check (id ~ '^[A-Za-z0-9_-]{6,64}$'),
  listing_id uuid not null references public.gear_listings (id) on delete restrict,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  seller_id uuid not null references auth.users (id) on delete cascade,
  item_title text not null,
  item_price int not null check (item_price >= 0),
  shipping_fee int not null check (shipping_fee >= 0),
  amount int not null,
  status text not null default 'pending' check (status in ('pending', 'paid', 'shipped', 'delivered', 'cancelled', 'failed', 'refunded')),
  recipient_name text not null check (char_length(recipient_name) between 1 and 40),
  recipient_phone text not null check (recipient_phone ~ '^[0-9+\- ]{8,20}$'),
  address text not null check (char_length(address) between 5 and 200),
  delivery_memo text not null default '' check (char_length(delivery_memo) <= 200),
  courier text,
  tracking_number text,
  payment_key text,
  status_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz,
  shipped_at timestamptz,
  delivered_at timestamptz,
  refunded_at timestamptz,
  check (amount = item_price + shipping_fee and amount >= 100)
);
create index if not exists gear_orders_buyer_idx on public.gear_orders (buyer_id, created_at desc);
create index if not exists gear_orders_seller_idx on public.gear_orders (seller_id, created_at desc);
create index if not exists gear_orders_listing_idx on public.gear_orders (listing_id);
create unique index if not exists gear_orders_payment_key_unique on public.gear_orders (payment_key) where payment_key is not null;
-- 한 상품에 결제된(진행 중·완료) 주문은 하나만
create unique index if not exists gear_orders_one_paid_per_listing on public.gear_orders (listing_id) where status in ('paid', 'shipped', 'delivered');

alter table public.gear_orders enable row level security;
drop policy if exists "gear_orders_select_party" on public.gear_orders;
create policy "gear_orders_select_party" on public.gear_orders for select
  using (buyer_id = auth.uid() or seller_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.gear_orders to authenticated;
-- 쓰기 정책 없음 — 아래 RPC(와 Edge Function 의 service_role)만 바꾼다

-- 주문 생성 (구매자). 같은 상품에 내 미결제 주문이 있으면 다시 쓴다.
create or replace function public.create_gear_order(p_listing uuid, p_name text, p_phone text, p_address text, p_memo text default '')
returns setof public.gear_orders language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  l public.gear_listings;
  oid text;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  select * into l from public.gear_listings where id = p_listing for update;
  if not found or l.moderation <> 'ok' or l.status <> 'active' then raise exception 'LISTING_UNAVAILABLE'; end if;
  if not l.shipping_available then raise exception 'SHIPPING_NOT_AVAILABLE'; end if;
  if l.seller_id = me then raise exception 'OWN_LISTING'; end if;
  if public.is_blocked_between(l.seller_id, me) then raise exception 'BLOCKED'; end if;
  if l.price + l.shipping_fee < 100 then raise exception 'AMOUNT_TOO_SMALL'; end if;
  if exists (select 1 from public.gear_orders o where o.listing_id = p_listing and o.status in ('paid', 'shipped', 'delivered')) then
    raise exception 'LISTING_UNAVAILABLE';
  end if;

  -- the buyer counts as an inquirer (the listing guard only lets inquirers become the buyer)
  insert into public.gear_inquiries (listing_id, buyer_id, buyer_nickname)
  values (p_listing, me, coalesce((select nickname from public.profiles where user_id = me), ''))
  on conflict (listing_id, buyer_id) do nothing;

  select o.id into oid from public.gear_orders o where o.listing_id = p_listing and o.buyer_id = me and o.status = 'pending' limit 1;
  if oid is null then
    oid := 'gear_' || replace(gen_random_uuid()::text, '-', '');
    insert into public.gear_orders (id, listing_id, buyer_id, seller_id, item_title, item_price, shipping_fee, amount, recipient_name, recipient_phone, address, delivery_memo)
    values (oid, p_listing, me, l.seller_id, l.title, l.price, l.shipping_fee, l.price + l.shipping_fee, trim(p_name), trim(p_phone), trim(p_address), left(coalesce(p_memo, ''), 200));
  else
    update public.gear_orders set item_title = l.title, item_price = l.price, shipping_fee = l.shipping_fee, amount = l.price + l.shipping_fee,
           recipient_name = trim(p_name), recipient_phone = trim(p_phone), address = trim(p_address), delivery_memo = left(coalesce(p_memo, ''), 200), updated_at = now()
     where id = oid;
  end if;
  return query select * from public.gear_orders where id = oid;
end;
$$;
revoke all on function public.create_gear_order(uuid, text, text, text, text) from public;
grant execute on function public.create_gear_order(uuid, text, text, text, text) to authenticated;

-- 상태 확정. 'paid'·'refunded' 는 service_role(= Toss 승인/취소를 확인한 Edge Function)만.
-- 'failed'·'cancelled' 는 미결제 주문의 구매자 본인도 가능.
create or replace function public.finalize_gear_order(p_order text, p_new_status text, p_reason text default null, p_payment_key text default null)
returns setof public.gear_orders language plpgsql security definer set search_path = public as $$
declare
  o public.gear_orders;
  is_service boolean := auth.role() = 'service_role';
begin
  select * into o from public.gear_orders where id = p_order for update;
  if not found then raise exception 'ORDER_NOT_FOUND'; end if;

  if p_new_status = 'paid' then
    if not is_service then raise exception 'FORBIDDEN_DIRECT_PAID_TRANSITION'; end if;
    if o.status in ('paid', 'shipped', 'delivered') and o.payment_key is not distinct from p_payment_key then
      return query select * from public.gear_orders where id = p_order; return;  -- idempotent
    end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    if not exists (select 1 from public.gear_listings l where l.id = o.listing_id and l.status in ('active', 'reserved') and l.moderation = 'ok')
       or exists (select 1 from public.gear_orders x where x.listing_id = o.listing_id and x.status in ('paid', 'shipped', 'delivered')) then
      raise exception 'LISTING_UNAVAILABLE';
    end if;
    update public.gear_orders set status = 'paid', payment_key = p_payment_key, paid_at = now(), updated_at = now() where id = p_order;
    update public.gear_listings set status = 'sold', buyer_id = o.buyer_id where id = o.listing_id;
    update public.gear_orders set status = 'cancelled', status_reason = '다른 구매자에게 판매됨', updated_at = now()
     where listing_id = o.listing_id and status = 'pending' and id <> p_order;
  elsif p_new_status = 'refunded' then
    if not is_service then raise exception 'FORBIDDEN'; end if;
    if o.status = 'refunded' then return query select * from public.gear_orders where id = p_order; return; end if;
    if o.status <> 'paid' then raise exception 'ORDER_NOT_REFUNDABLE'; end if;
    update public.gear_orders set status = 'refunded', status_reason = p_reason, refunded_at = now(), updated_at = now() where id = p_order;
    update public.gear_listings set status = 'active' where id = o.listing_id and status = 'sold' and buyer_id = o.buyer_id;
  elsif p_new_status in ('failed', 'cancelled') then
    if not is_service and o.buyer_id is distinct from auth.uid() then raise exception 'NOT_YOUR_ORDER'; end if;
    if o.status <> 'pending' then raise exception 'ORDER_NOT_PENDING'; end if;
    update public.gear_orders set status = p_new_status, status_reason = p_reason, updated_at = now() where id = p_order;
  else
    raise exception 'INVALID_STATUS';
  end if;
  return query select * from public.gear_orders where id = p_order;
end;
$$;
revoke all on function public.finalize_gear_order(text, text, text, text) from public;
grant execute on function public.finalize_gear_order(text, text, text, text) to authenticated, service_role;

create or replace function public.mark_gear_order_shipped(p_order text, p_courier text, p_tracking text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if char_length(coalesce(trim(p_courier), '')) = 0 or char_length(coalesce(trim(p_tracking), '')) < 4 then raise exception 'TRACKING_REQUIRED'; end if;
  update public.gear_orders set status = 'shipped', courier = left(trim(p_courier), 40), tracking_number = left(trim(p_tracking), 40), shipped_at = now(), updated_at = now()
   where id = p_order and seller_id = auth.uid() and status = 'paid';
  if not found then raise exception 'ORDER_NOT_SHIPPABLE'; end if;
end;
$$;
revoke all on function public.mark_gear_order_shipped(text, text, text) from public;
grant execute on function public.mark_gear_order_shipped(text, text, text) to authenticated;

create or replace function public.confirm_gear_order_received(p_order text)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.gear_orders set status = 'delivered', delivered_at = now(), updated_at = now()
   where id = p_order and buyer_id = auth.uid() and status = 'shipped';
  if not found then raise exception 'ORDER_NOT_RECEIVABLE'; end if;
end;
$$;
revoke all on function public.confirm_gear_order_received(text) from public;
grant execute on function public.confirm_gear_order_received(text) to authenticated;

-- 결제된 택배 주문이 있는 상품은 판매자가 상태·구매자를 직접 바꿀 수 없다(환불은 Edge Function 경유).
-- 0057 의 보호 트리거를 같은 규칙 + 이 조건으로 교체한다.
create or replace function public.trg_gear_listing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if public.is_platform_admin(auth.uid()) and auth.uid() <> old.seller_id then
    new.updated_at := now();
    return new;
  end if;
  if new.seller_id is distinct from old.seller_id then raise exception 'seller cannot change'; end if;
  if new.favorite_count is distinct from old.favorite_count and current_setting('martialdex.gear_fav', true) is distinct from 'on' then
    raise exception 'favorite_count is maintained by the server';
  end if;
  if new.moderation is distinct from old.moderation then raise exception 'moderation is set by platform admins'; end if;
  if old.moderation = 'removed' and new.status is distinct from old.status and new.status <> 'hidden' then
    raise exception 'a removed listing cannot be reactivated';
  end if;
  if auth.role() is distinct from 'service_role'
     and (new.status is distinct from old.status or new.buyer_id is distinct from old.buyer_id)
     and exists (select 1 from public.gear_orders o where o.listing_id = old.id and o.status in ('paid', 'shipped', 'delivered')) then
    raise exception 'listing has a paid order';
  end if;
  if new.buyer_id is not null and new.buyer_id is distinct from old.buyer_id
     and not exists (select 1 from public.gear_inquiries i where i.listing_id = old.id and i.buyer_id = new.buyer_id) then
    raise exception 'buyer must be someone who inquired';
  end if;
  if new.status = 'sold' and old.status <> 'sold' then new.sold_at := now(); end if;
  if new.status <> 'sold' and old.status = 'sold' then new.sold_at := null; new.buyer_id := null; end if;
  new.updated_at := now();
  return new;
end;
$$;
