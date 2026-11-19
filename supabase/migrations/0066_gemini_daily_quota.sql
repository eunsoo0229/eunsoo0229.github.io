-- Gemini 코치 사용 한도: FREE 하루 N회(기본 5), PRO·운영자/개발자 계정은 무제한.
--
-- "1회" = 사용자가 Gemini 에게 시킨 작업 1건. 한 작업이 내부적으로 Gemini 를 여러 번 부르는 경우
-- (수업 생성, 검증 재시도 …) 클라이언트가 같은 use_id 로 묶어 보낸다. 묶음은 서버가 제한한다:
-- 시작 후 gemini_use_window_seconds(기본 600초) 안, 최대 gemini_calls_per_use(기본 15)번까지.
-- 그 밖의 호출은 새 1회로 센다 → use_id 를 재사용해 한도를 우회할 수 없다.
-- 날짜는 서울 기준. 판정은 consume_gemini_use() 한 곳(로그인 사용자의 auth.uid() 기준).

alter table public.monetization_config add column if not exists free_gemini_daily_uses int not null default 5 check (free_gemini_daily_uses between 0 and 1000);
alter table public.monetization_config add column if not exists gemini_use_window_seconds int not null default 600 check (gemini_use_window_seconds between 30 and 3600);
alter table public.monetization_config add column if not exists gemini_calls_per_use int not null default 15 check (gemini_calls_per_use between 1 and 100);

-- PRO 요금제에 무제한 기능 키 추가 (관리자 화면에서 기능 구성 변경 가능)
update public.membership_plans set features = array_append(features, 'gemini_unlimited'), updated_at = now()
 where id = 'pro' and not ('gemini_unlimited' = any (features));

create table if not exists public.gemini_usage (
  user_id uuid not null references auth.users (id) on delete cascade,
  use_id text not null check (length(use_id) between 8 and 64),
  day date not null,
  started_at timestamptz not null default now(),
  last_at timestamptz not null default now(),
  calls int not null default 1,
  unlimited boolean not null default false,
  primary key (user_id, use_id)
);
create index if not exists gemini_usage_user_day_idx on public.gemini_usage (user_id, day);
alter table public.gemini_usage enable row level security;
drop policy if exists "gemini_usage_select_own" on public.gemini_usage;
create policy "gemini_usage_select_own" on public.gemini_usage for select using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
grant select on public.gemini_usage to authenticated;  -- 쓰기는 consume_gemini_use() 만

create or replace function public.gemini_quota_of(p_user uuid)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare
  cfg public.monetization_config;
  d date := (now() at time zone 'Asia/Seoul')::date;
  used int;
  unl boolean;
begin
  select * into cfg from public.monetization_config;
  unl := public.has_entitlement(p_user, 'gemini_unlimited');
  select count(*) into used from public.gemini_usage where user_id = p_user and day = d and not unlimited;
  return jsonb_build_object(
    'unlimited', unl,
    'used', used,
    'limit', cfg.free_gemini_daily_uses,
    'remaining', case when unl then null else greatest(cfg.free_gemini_daily_uses - used, 0) end,
    'resets_at', ((d + 1)::timestamp at time zone 'Asia/Seoul')
  );
end;
$$;
revoke all on function public.gemini_quota_of(uuid) from public;

create or replace function public.my_gemini_quota()
returns jsonb language sql security definer set search_path = public stable as $$
  select case when auth.uid() is null then null else public.gemini_quota_of(auth.uid()) end;
$$;
revoke all on function public.my_gemini_quota() from public;
grant execute on function public.my_gemini_quota() to authenticated;

-- Gemini 호출 직전에 부른다. 같은 묶음(use_id)의 후속 호출이면 횟수를 늘리지 않는다.
create or replace function public.consume_gemini_use(p_use_id text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  cfg public.monetization_config;
  d date := (now() at time zone 'Asia/Seoul')::date;
  u public.gemini_usage;
  unl boolean;
  used int;
begin
  if me is null then raise exception 'AUTH_REQUIRED'; end if;
  if p_use_id is null or length(p_use_id) not between 8 and 64 then raise exception 'INVALID_USE_ID'; end if;
  -- 같은 사용자의 동시 요청은 순서대로 판정 (한도 경계에서 초과 방지)
  perform pg_advisory_xact_lock(hashtext('gemini_quota:' || me::text));
  select * into cfg from public.monetization_config;
  unl := public.has_entitlement(me, 'gemini_unlimited');

  select * into u from public.gemini_usage where user_id = me and use_id = p_use_id for update;
  if found then
    if u.day = d and u.started_at > now() - make_interval(secs => cfg.gemini_use_window_seconds) and u.calls < cfg.gemini_calls_per_use then
      update public.gemini_usage set calls = calls + 1, last_at = now() where user_id = me and use_id = p_use_id;
      return public.gemini_quota_of(me) || jsonb_build_object('allowed', true, 'new_use', false);
    end if;
    -- 묶음이 끝났다(시간·횟수 초과, 날짜 변경) → 클라이언트가 새 use_id 로 다시 요청
    return public.gemini_quota_of(me) || jsonb_build_object('allowed', false, 'reason', 'USE_EXPIRED');
  end if;

  if not unl then
    select count(*) into used from public.gemini_usage where user_id = me and day = d and not unlimited;
    if used >= cfg.free_gemini_daily_uses then
      return public.gemini_quota_of(me) || jsonb_build_object('allowed', false, 'reason', 'QUOTA_EXCEEDED');
    end if;
  end if;
  insert into public.gemini_usage (user_id, use_id, day, unlimited) values (me, p_use_id, d, unl);
  return public.gemini_quota_of(me) || jsonb_build_object('allowed', true, 'new_use', true);
end;
$$;
revoke all on function public.consume_gemini_use(text) from public;
grant execute on function public.consume_gemini_use(text) to authenticated;

-- 관리자 설정: 무료 Gemini 횟수·묶음 규칙도 변경 가능 (실결제·현금지급 잠금은 그대로)
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
    free_gemini_daily_uses = coalesce((p->>'free_gemini_daily_uses')::int, free_gemini_daily_uses),
    gemini_use_window_seconds = coalesce((p->>'gemini_use_window_seconds')::int, gemini_use_window_seconds),
    gemini_calls_per_use = coalesce((p->>'gemini_calls_per_use')::int, gemini_calls_per_use),
    updated_at = now(), updated_by = auth.uid()
  where id;
  return query select * from public.monetization_config;
end;
$$;
revoke all on function public.admin_update_monetization_config(jsonb) from public;
grant execute on function public.admin_update_monetization_config(jsonb) to authenticated;
