-- 통합 플랫폼 4/4 — 체육관 검색 · 가격 비교 · 제휴 할인 · 쿠폰
--
-- 실제 업체·가격 데이터는 이 마이그레이션에 하나도 넣지 않는다(시드 없음).
-- 체육관은 관리자가 직접 등록 → 플랫폼 관리자 승인 후에만 공개된다.
-- 가격은 등록자가 입력한 값과 "최종 확인일"을 그대로 보여 주고, 플랫폼 검증 여부를 따로 기록한다.
-- 가격을 바꾸면 검증 표시는 자동으로 풀린다.
-- 제휴(할인 계약)는 플랫폼 관리자가 계약을 확인하고 'active' 로 바꿔야만 존재한다.
-- 할인 상품은 활성 제휴 + 플랫폼 검증된 원래 가격이 있을 때만 공개·발급되며,
-- 할인가는 서버가 검증된 원래 가격에서 계산한다(클라이언트가 보낸 금액을 쓰지 않음).
-- 기존 gyms(0022, 비공개 수업용 체육관)는 그대로 두고, 공개 목록은 선택적으로 gym_id 로 연결한다.

create table if not exists public.gym_listings (
  id uuid primary key default gen_random_uuid(),
  owner_user_id uuid not null references auth.users (id) on delete cascade,
  gym_id text references public.gyms (id) on delete set null,
  name text not null check (char_length(name) between 2 and 80),
  arts text[] not null check (
    cardinality(arts) between 1 and 11
    and arts <@ array['mma', 'boxing', 'kickboxing', 'muay_thai', 'bjj', 'wrestling', 'judo', 'taekwondo', 'karate', 'sambo', 'mixed']::text[]
  ),
  description text not null default '' check (char_length(description) <= 3000),
  cover_image_url text,
  address text not null check (char_length(address) between 4 and 200),
  region text not null check (char_length(region) between 1 and 60),
  lat double precision check (lat is null or lat between -90 and 90),
  lng double precision check (lng is null or lng between -180 and 180),
  phone text not null default '' check (char_length(phone) <= 40),
  website text not null default '' check (char_length(website) <= 300),
  sns jsonb not null default '{}'::jsonb check (jsonb_typeof(sns) = 'object' and pg_column_size(sns) < 4096),
  hours text not null default '' check (char_length(hours) <= 600),
  facilities text[] not null default '{}' check (cardinality(facilities) <= 30),
  instructors jsonb not null default '[]'::jsonb check (jsonb_typeof(instructors) = 'array' and pg_column_size(instructors) < 16384),
  schedule jsonb not null default '[]'::jsonb check (jsonb_typeof(schedule) = 'array' and pg_column_size(schedule) < 32768),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'suspended')),
  review_note text not null default '',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gym_listings_status_idx on public.gym_listings (status, region);
create index if not exists gym_listings_owner_idx on public.gym_listings (owner_user_id);
alter table public.gym_listings enable row level security;
drop policy if exists "gym_listings_select" on public.gym_listings;
create policy "gym_listings_select" on public.gym_listings for select
  using (status = 'approved' or owner_user_id = auth.uid() or public.is_platform_admin(auth.uid()));
drop policy if exists "gym_listings_insert_own" on public.gym_listings;
create policy "gym_listings_insert_own" on public.gym_listings for insert with check (
  owner_user_id = auth.uid() and status = 'pending' and reviewed_by is null
  and (gym_id is null or public.gym_owner_of(gym_id) = auth.uid())
);
drop policy if exists "gym_listings_update_own" on public.gym_listings;
create policy "gym_listings_update_own" on public.gym_listings for update using (owner_user_id = auth.uid()) with check (owner_user_id = auth.uid());
drop policy if exists "gym_listings_delete_own" on public.gym_listings;
create policy "gym_listings_delete_own" on public.gym_listings for delete using (owner_user_id = auth.uid());
grant select on public.gym_listings to anon, authenticated;
grant insert, update, delete on public.gym_listings to authenticated;

create or replace function public.trg_gym_listing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('martialdex.platform_review', true) = 'on' and public.is_platform_admin(auth.uid()) then
    new.updated_at := now();
    return new;
  end if;
  if new.owner_user_id is distinct from old.owner_user_id then raise exception 'owner cannot change'; end if;
  if new.status is distinct from old.status or new.reviewed_by is distinct from old.reviewed_by
     or new.reviewed_at is distinct from old.reviewed_at or new.review_note is distinct from old.review_note then
    raise exception 'listing status is set by platform review';
  end if;
  if new.gym_id is distinct from old.gym_id and new.gym_id is not null and public.gym_owner_of(new.gym_id) is distinct from auth.uid() then
    raise exception 'can only link a gym you own';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists gym_listings_guard on public.gym_listings;
create trigger gym_listings_guard before update on public.gym_listings
  for each row execute function public.trg_gym_listing_guard();

create or replace function public.review_gym_listing(p_listing uuid, p_status text, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  if p_status not in ('approved', 'rejected', 'suspended', 'pending') then raise exception 'invalid status'; end if;
  perform set_config('martialdex.platform_review', 'on', true);
  update public.gym_listings set status = p_status, review_note = coalesce(p_note, ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_listing;
  perform set_config('martialdex.platform_review', 'off', true);
  if not found then raise exception 'listing not found'; end if;
end;
$$;
revoke all on function public.review_gym_listing(uuid, text, text) from public;
grant execute on function public.review_gym_listing(uuid, text, text) to authenticated;

create or replace function public.owns_gym_listing(p_listing uuid, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.gym_listings where id = p_listing and owner_user_id = p_user);
$$;
create or replace function public.gym_listing_public(p_listing uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.gym_listings where id = p_listing and status = 'approved');
$$;

-- ============ 가격 (원 단위 정수, 모르면 null — 절대 추정값을 넣지 않는다) ============
create table if not exists public.gym_pricing (
  listing_id uuid primary key references public.gym_listings (id) on delete cascade,
  monthly int check (monthly is null or monthly between 0 and 100000000),
  three_month int check (three_month is null or three_month between 0 and 100000000),
  six_month int check (six_month is null or six_month between 0 and 100000000),
  yearly int check (yearly is null or yearly between 0 and 100000000),
  initiation_fee int check (initiation_fee is null or initiation_fee between 0 and 100000000),
  registration_fee int check (registration_fee is null or registration_fee between 0 and 100000000),
  gear_cost int check (gear_cost is null or gear_cost between 0 and 100000000),
  sessions_per_week numeric(4, 1) check (sessions_per_week is null or sessions_per_week between 0 and 21),
  minutes_per_session int check (minutes_per_session is null or minutes_per_session between 0 and 600),
  open_mat boolean,
  multi_art boolean,
  trial_available boolean,
  trial_price int check (trial_price is null or trial_price between 0 and 10000000),
  notes text not null default '' check (char_length(notes) <= 1000),
  owner_confirmed_at timestamptz not null default now(),
  verified_at timestamptz,
  verified_by uuid references auth.users (id) on delete set null
);
alter table public.gym_pricing enable row level security;
drop policy if exists "gym_pricing_select" on public.gym_pricing;
create policy "gym_pricing_select" on public.gym_pricing for select using (
  public.gym_listing_public(listing_id) or public.owns_gym_listing(listing_id, auth.uid()) or public.is_platform_admin(auth.uid())
);
drop policy if exists "gym_pricing_insert_owner" on public.gym_pricing;
create policy "gym_pricing_insert_owner" on public.gym_pricing for insert
  with check (public.owns_gym_listing(listing_id, auth.uid()) and verified_at is null and verified_by is null);
drop policy if exists "gym_pricing_update_owner" on public.gym_pricing;
create policy "gym_pricing_update_owner" on public.gym_pricing for update using (public.owns_gym_listing(listing_id, auth.uid()));
grant select on public.gym_pricing to anon, authenticated;
grant insert, update on public.gym_pricing to authenticated;

-- 등록자가 가격을 바꾸면 최종 확인일 갱신 + 플랫폼 검증 해제
create or replace function public.trg_gym_pricing_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if current_setting('martialdex.platform_review', true) = 'on' and public.is_platform_admin(auth.uid()) then return new; end if;
  new.listing_id := old.listing_id;
  new.owner_confirmed_at := now();
  new.verified_at := null;
  new.verified_by := null;
  return new;
end;
$$;
drop trigger if exists gym_pricing_guard on public.gym_pricing;
create trigger gym_pricing_guard before update on public.gym_pricing
  for each row execute function public.trg_gym_pricing_guard();

create or replace function public.verify_gym_pricing(p_listing uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  perform set_config('martialdex.platform_review', 'on', true);
  update public.gym_pricing set verified_at = now(), verified_by = auth.uid() where listing_id = p_listing;
  perform set_config('martialdex.platform_review', 'off', true);
  if not found then raise exception 'pricing not found'; end if;
end;
$$;
revoke all on function public.verify_gym_pricing(uuid) from public;
grant execute on function public.verify_gym_pricing(uuid) to authenticated;

-- ============ 제휴 ============
create table if not exists public.gym_partnerships (
  listing_id uuid primary key references public.gym_listings (id) on delete cascade,
  status text not null default 'applied' check (status in ('applied', 'active', 'rejected', 'ended')),
  applicant_note text not null default '' check (char_length(applicant_note) <= 2000),
  plan text not null default 'basic' check (plan in ('basic', 'premium')),
  -- 계약 조건 (플랫폼 관리자만 기록; 공개되지 않음)
  contract_reference text not null default '',
  commission_rate numeric(5, 2) check (commission_rate is null or commission_rate between 0 and 100),
  monthly_fee int check (monthly_fee is null or monthly_fee >= 0),
  starts_on date,
  ends_on date,
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,
  applied_at timestamptz not null default now()
);
alter table public.gym_partnerships enable row level security;
drop policy if exists "gym_partnerships_select" on public.gym_partnerships;
create policy "gym_partnerships_select" on public.gym_partnerships for select
  using (public.owns_gym_listing(listing_id, auth.uid()) or public.is_platform_admin(auth.uid()));
drop policy if exists "gym_partnerships_apply" on public.gym_partnerships;
create policy "gym_partnerships_apply" on public.gym_partnerships for insert with check (
  public.owns_gym_listing(listing_id, auth.uid()) and status = 'applied' and decided_by is null
  and contract_reference = '' and commission_rate is null and monthly_fee is null and starts_on is null and ends_on is null
);
grant select, insert on public.gym_partnerships to authenticated;

-- 다시 신청 (거절·종료된 뒤)
create or replace function public.reapply_gym_partnership(p_listing uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.owns_gym_listing(p_listing, auth.uid()) then raise exception 'owner only'; end if;
  update public.gym_partnerships set status = 'applied', applicant_note = left(coalesce(p_note, ''), 2000), applied_at = now(),
         decided_by = null, decided_at = null
   where listing_id = p_listing and status in ('rejected', 'ended');
  if not found then raise exception 'nothing to reapply'; end if;
end;
$$;
revoke all on function public.reapply_gym_partnership(uuid, text) from public;
grant execute on function public.reapply_gym_partnership(uuid, text) to authenticated;

create or replace function public.decide_gym_partnership(
  p_listing uuid, p_status text, p_contract_reference text default '', p_commission numeric default null,
  p_monthly_fee int default null, p_starts date default null, p_ends date default null, p_plan text default 'basic')
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  if p_status not in ('active', 'rejected', 'ended') then raise exception 'invalid status'; end if;
  if p_status = 'active' and (coalesce(trim(p_contract_reference), '') = '' or p_starts is null) then
    raise exception 'an active partnership needs a contract reference and a start date';
  end if;
  if p_status = 'active' and not public.gym_listing_public(p_listing) then raise exception 'listing must be approved first'; end if;
  update public.gym_partnerships
     set status = p_status, contract_reference = coalesce(p_contract_reference, ''), commission_rate = p_commission,
         monthly_fee = p_monthly_fee, starts_on = p_starts, ends_on = p_ends, plan = coalesce(p_plan, 'basic'),
         decided_by = auth.uid(), decided_at = now()
   where listing_id = p_listing;
  if not found then raise exception 'no application'; end if;
end;
$$;
revoke all on function public.decide_gym_partnership(uuid, text, text, numeric, int, date, date, text) from public;
grant execute on function public.decide_gym_partnership(uuid, text, text, numeric, int, date, date, text) to authenticated;

-- 공개용: 지금 유효한 제휴인가 (계약 조건은 노출하지 않음)
create or replace function public.is_active_gym_partner(p_listing uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.gym_partnerships p join public.gym_listings l on l.id = p.listing_id
    where p.listing_id = p_listing and p.status = 'active' and l.status = 'approved'
      and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date)
  );
$$;
revoke all on function public.is_active_gym_partner(uuid) from public;
grant execute on function public.is_active_gym_partner(uuid) to anon, authenticated;

create or replace function public.active_gym_partner_ids()
returns setof uuid language sql security definer set search_path = public stable as $$
  select p.listing_id from public.gym_partnerships p join public.gym_listings l on l.id = p.listing_id
  where p.status = 'active' and l.status = 'approved'
    and p.starts_on <= current_date and (p.ends_on is null or p.ends_on >= current_date);
$$;
revoke all on function public.active_gym_partner_ids() from public;
grant execute on function public.active_gym_partner_ids() to anon, authenticated;

-- ============ 할인 상품 ============
create table if not exists public.gym_offers (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.gym_listings (id) on delete cascade,
  title text not null check (char_length(title) between 2 and 80),
  plan text not null check (plan in ('monthly', 'three_month', 'six_month', 'yearly', 'initiation_fee', 'registration_fee', 'trial_price')),
  discount_type text not null check (discount_type in ('percent', 'amount')),
  discount_value int not null check (discount_value > 0),
  target text not null default 'new_members' check (target in ('new_members', 'everyone')),
  max_redemptions int check (max_redemptions is null or max_redemptions > 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  terms text not null default '' check (char_length(terms) <= 2000),
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'ended')),
  created_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (discount_type <> 'percent' or discount_value <= 90)
);
create index if not exists gym_offers_listing_idx on public.gym_offers (listing_id, status);
alter table public.gym_offers enable row level security;
drop policy if exists "gym_offers_select" on public.gym_offers;
create policy "gym_offers_select" on public.gym_offers for select using (
  public.owns_gym_listing(listing_id, auth.uid()) or public.is_platform_admin(auth.uid())
  or (status = 'active' and now() between starts_at and ends_at and public.is_active_gym_partner(listing_id))
);
drop policy if exists "gym_offers_insert_owner" on public.gym_offers;
create policy "gym_offers_insert_owner" on public.gym_offers for insert with check (public.owns_gym_listing(listing_id, auth.uid()));
drop policy if exists "gym_offers_update_owner" on public.gym_offers;
create policy "gym_offers_update_owner" on public.gym_offers for update using (public.owns_gym_listing(listing_id, auth.uid()));
grant select on public.gym_offers to anon, authenticated;
grant insert, update, delete on public.gym_offers to authenticated;

-- 활성 제휴가 없으면 할인을 'active' 로 둘 수 없다
create or replace function public.trg_gym_offer_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and new.listing_id is distinct from old.listing_id then raise exception 'listing cannot change'; end if;
  if new.status = 'active' and not public.is_active_gym_partner(new.listing_id) then
    raise exception 'an offer can only be activated under an active partnership';
  end if;
  return new;
end;
$$;

-- 원래 가격(플랫폼 검증된 값만)과 할인가 계산 — 서버가 유일한 계산 주체
create or replace function public.gym_offer_prices(p_offer uuid)
returns table (original_price int, discounted_price int, price_verified boolean)
language plpgsql security definer set search_path = public stable as $$
declare o public.gym_offers; pr public.gym_pricing; base int;
begin
  select * into o from public.gym_offers where id = p_offer;
  if not found then return; end if;
  select * into pr from public.gym_pricing where listing_id = o.listing_id;
  if not found then return query select null::int, null::int, false; return; end if;
  base := case o.plan when 'monthly' then pr.monthly when 'three_month' then pr.three_month when 'six_month' then pr.six_month
                      when 'yearly' then pr.yearly when 'initiation_fee' then pr.initiation_fee
                      when 'registration_fee' then pr.registration_fee when 'trial_price' then pr.trial_price end;
  if base is null or pr.verified_at is null then return query select base, null::int, false; return; end if;
  return query select base,
    greatest(0, case when o.discount_type = 'percent' then (base * (100 - o.discount_value) / 100) else base - o.discount_value end)::int,
    true;
end;
$$;
revoke all on function public.gym_offer_prices(uuid) from public;
grant execute on function public.gym_offer_prices(uuid) to anon, authenticated;

-- ============ 쿠폰 ============
create table if not exists public.gym_coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  offer_id uuid not null references public.gym_offers (id) on delete restrict,
  listing_id uuid not null references public.gym_listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_nickname text not null default '',
  original_price int not null,
  discounted_price int not null,
  status text not null default 'issued' check (status in ('issued', 'redeemed', 'cancelled')),
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  redeemed_by uuid references auth.users (id) on delete set null,
  unique (offer_id, user_id)
);
create index if not exists gym_coupons_listing_idx on public.gym_coupons (listing_id, issued_at desc);
alter table public.gym_coupons enable row level security;
drop policy if exists "gym_coupons_select" on public.gym_coupons;
create policy "gym_coupons_select" on public.gym_coupons for select using (
  user_id = auth.uid() or public.owns_gym_listing(listing_id, auth.uid()) or public.is_platform_admin(auth.uid())
);
grant select on public.gym_coupons to authenticated;
-- 쓰기 정책 없음 — 발급·사용·취소는 RPC 전용

drop policy if exists "gym_offers_delete_owner" on public.gym_offers;
create policy "gym_offers_delete_owner" on public.gym_offers for delete
  using (public.owns_gym_listing(listing_id, auth.uid()) and not exists (select 1 from public.gym_coupons c where c.offer_id = gym_offers.id));
drop trigger if exists gym_offers_guard on public.gym_offers;
create trigger gym_offers_guard before insert or update on public.gym_offers
  for each row execute function public.trg_gym_offer_guard();

create or replace function public.claim_gym_offer(p_offer uuid)
returns table (coupon_id uuid, code text) language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid(); o public.gym_offers; l public.gym_listings; used int; pr record; c text; nick text; new_id uuid;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into o from public.gym_offers where id = p_offer for update;
  if not found then raise exception 'offer not found'; end if;
  select * into l from public.gym_listings where id = o.listing_id;
  if o.status <> 'active' or now() < o.starts_at or now() > o.ends_at then raise exception 'offer not active'; end if;
  if not public.is_active_gym_partner(o.listing_id) then raise exception 'no active partnership'; end if;
  if l.owner_user_id = me then raise exception 'owners cannot claim their own offer'; end if;
  if o.target = 'new_members' and l.gym_id is not null and public.is_gym_member(l.gym_id, me) then
    raise exception 'offer is for new members only';
  end if;
  if exists (select 1 from public.gym_coupons gc where gc.offer_id = p_offer and gc.user_id = me) then
    raise exception 'already claimed';
  end if;
  if o.max_redemptions is not null then
    select count(*) into used from public.gym_coupons gc where gc.offer_id = p_offer and gc.status <> 'cancelled';
    if used >= o.max_redemptions then raise exception 'offer limit reached'; end if;
  end if;
  select * into pr from public.gym_offer_prices(p_offer);
  if pr.price_verified is not true then raise exception 'original price is not verified'; end if;
  c := upper(substr(md5(gen_random_uuid()::text), 1, 4) || '-' || substr(md5(gen_random_uuid()::text), 1, 4));
  select coalesce(nickname, '') into nick from public.profiles where user_id = me;
  insert into public.gym_coupons (code, offer_id, listing_id, user_id, user_nickname, original_price, discounted_price, expires_at)
  values (c, p_offer, o.listing_id, me, coalesce(nick, ''), pr.original_price, pr.discounted_price, o.ends_at)
  returning id into new_id;
  return query select new_id, c;
end;
$$;
revoke all on function public.claim_gym_offer(uuid) from public;
grant execute on function public.claim_gym_offer(uuid) to authenticated;

-- 체육관이 실제 등록 시 쿠폰 사용 처리 → 사용자 화면에 "등록 확인" 으로 보인다
create or replace function public.redeem_gym_coupon(p_code text)
returns uuid language plpgsql security definer set search_path = public as $$
declare cp public.gym_coupons;
begin
  select * into cp from public.gym_coupons where code = upper(trim(p_code)) for update;
  if not found then raise exception 'coupon not found'; end if;
  if not public.owns_gym_listing(cp.listing_id, auth.uid()) then raise exception 'only the gym can redeem'; end if;
  if cp.status <> 'issued' then raise exception 'coupon is %', cp.status; end if;
  if now() > cp.expires_at then raise exception 'coupon expired'; end if;
  update public.gym_coupons set status = 'redeemed', redeemed_at = now(), redeemed_by = auth.uid() where id = cp.id;
  return cp.id;
end;
$$;
revoke all on function public.redeem_gym_coupon(text) from public;
grant execute on function public.redeem_gym_coupon(text) to authenticated;

create or replace function public.cancel_gym_coupon(p_coupon uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  update public.gym_coupons set status = 'cancelled' where id = p_coupon and user_id = auth.uid() and status = 'issued';
  if not found then raise exception 'cannot cancel'; end if;
end;
$$;
revoke all on function public.cancel_gym_coupon(uuid) from public;
grant execute on function public.cancel_gym_coupon(uuid) to authenticated;

-- ============ 문의 · 유입 기록 ============
create table if not exists public.gym_leads (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.gym_listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('inquiry')),
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  unique (listing_id, user_id, kind)
);
alter table public.gym_leads enable row level security;
drop policy if exists "gym_leads_select" on public.gym_leads;
create policy "gym_leads_select" on public.gym_leads for select
  using (user_id = auth.uid() or public.owns_gym_listing(listing_id, auth.uid()) or public.is_platform_admin(auth.uid()));
grant select on public.gym_leads to authenticated;

create or replace function public.start_gym_inquiry(p_listing uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.gym_listings; conv uuid; me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into l from public.gym_listings where id = p_listing and status = 'approved';
  if not found then raise exception 'listing not available'; end if;
  if l.owner_user_id = me then raise exception 'this is your gym'; end if;
  conv := public.start_conversation(l.owner_user_id);
  insert into public.gym_leads (listing_id, user_id, kind, conversation_id) values (p_listing, me, 'inquiry', conv)
  on conflict (listing_id, user_id, kind) do update set conversation_id = excluded.conversation_id;
  return conv;
end;
$$;
revoke all on function public.start_gym_inquiry(uuid) from public;
grant execute on function public.start_gym_inquiry(uuid) to authenticated;

-- ============ 후기 ============
create table if not exists public.gym_reviews (
  listing_id uuid not null references public.gym_listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  user_nickname text not null default '',
  rating int not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1500),
  verified_member boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
alter table public.gym_reviews enable row level security;
drop policy if exists "gym_reviews_select" on public.gym_reviews;
create policy "gym_reviews_select" on public.gym_reviews for select using (public.gym_listing_public(listing_id) or user_id = auth.uid());
drop policy if exists "gym_reviews_insert_own" on public.gym_reviews;
create policy "gym_reviews_insert_own" on public.gym_reviews for insert
  with check (user_id = auth.uid() and public.gym_listing_public(listing_id) and not public.owns_gym_listing(listing_id, auth.uid()));
drop policy if exists "gym_reviews_update_own" on public.gym_reviews;
create policy "gym_reviews_update_own" on public.gym_reviews for update using (user_id = auth.uid());
drop policy if exists "gym_reviews_delete_own" on public.gym_reviews;
create policy "gym_reviews_delete_own" on public.gym_reviews for delete using (user_id = auth.uid());
grant select on public.gym_reviews to anon, authenticated;
grant insert, update, delete on public.gym_reviews to authenticated;

-- "실제 회원" 표시는 서버가 판정: 이 체육관 쿠폰을 사용(등록)했거나 연결된 체육관의 회원
create or replace function public.trg_gym_review_verify()
returns trigger language plpgsql security definer set search_path = public as $$
declare l public.gym_listings;
begin
  select * into l from public.gym_listings where id = new.listing_id;
  new.verified_member := exists (select 1 from public.gym_coupons c where c.listing_id = new.listing_id and c.user_id = new.user_id and c.status = 'redeemed')
    or (l.gym_id is not null and public.is_gym_member(l.gym_id, new.user_id));
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists gym_reviews_verify on public.gym_reviews;
create trigger gym_reviews_verify before insert or update on public.gym_reviews
  for each row execute function public.trg_gym_review_verify();

-- 체육관 대표 이미지: gear-media 와 같은 규칙의 별도 버킷
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gym-media', 'gym-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
drop policy if exists "gym_media_public_read" on storage.objects;
create policy "gym_media_public_read" on storage.objects for select using (bucket_id = 'gym-media');
drop policy if exists "gym_media_insert_own_folder" on storage.objects;
create policy "gym_media_insert_own_folder" on storage.objects for insert
  with check (bucket_id = 'gym-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "gym_media_delete_own_folder" on storage.objects;
create policy "gym_media_delete_own_folder" on storage.objects for delete
  using (bucket_id = 'gym-media' and (storage.foldername(name))[1] = auth.uid()::text);
