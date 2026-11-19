-- 통합 플랫폼 3/4 — 격투기 장비 중고거래
--
-- 결제·에스크로는 만들지 않는다(기존 결제 인프라는 커리큘럼 판매 전용 Toss 연동이며 중고 실물 거래용이 아님).
-- 이 버전은 문의(기존 DM 재사용) + 거래 상태 관리 + 후기 + 신고·차단에 집중한다.
-- 기존 커리큘럼 마켓(marketplace_*)과 테이블을 공유하지 않는다 — 판매 대상이 디지털 콘텐츠 vs 실물이라 규칙이 다르다.
-- 차단은 기존 user_blocks / is_blocked_between, 신고는 기존 user_reports(0055 에서 대상 추가)를 그대로 쓴다.

create table if not exists public.gear_listings (
  id uuid primary key default gen_random_uuid(),
  seller_id uuid not null references auth.users (id) on delete cascade,
  seller_nickname text not null,
  title text not null check (char_length(title) between 2 and 80),
  category text not null check (category in ('boxing_gloves', 'mma_gloves', 'bjj_gi', 'wrestling', 'shin_guards',
                                             'headgear', 'mouthguard', 'protective', 'apparel', 'other')),
  martial_art text,
  brand text not null default '' check (char_length(brand) <= 60),
  size text not null default '' check (char_length(size) <= 40),
  usage_months int check (usage_months is null or usage_months between 0 and 600),
  condition text not null check (condition in ('new', 'like_new', 'good', 'fair', 'worn')),
  price int not null check (price between 0 and 100000000),
  description text not null default '' check (char_length(description) <= 3000),
  images text[] not null default '{}' check (cardinality(images) <= 8),
  region text not null default '' check (char_length(region) <= 60),
  shipping_available boolean not null default false,
  meetup_available boolean not null default true,
  status text not null default 'active' check (status in ('active', 'reserved', 'sold', 'hidden')),
  buyer_id uuid references auth.users (id) on delete set null,
  sold_at timestamptz,
  favorite_count int not null default 0,
  moderation text not null default 'ok' check (moderation in ('ok', 'removed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gear_listings_feed_idx on public.gear_listings (status, created_at desc);
create index if not exists gear_listings_seller_idx on public.gear_listings (seller_id, created_at desc);
alter table public.gear_listings enable row level security;

drop policy if exists "gear_listings_select" on public.gear_listings;
create policy "gear_listings_select" on public.gear_listings for select using (
  seller_id = auth.uid()
  or buyer_id = auth.uid()
  or public.is_platform_admin(auth.uid())
  or (status <> 'hidden' and moderation = 'ok' and not public.is_blocked_between(seller_id, auth.uid()))
);
drop policy if exists "gear_listings_insert_own" on public.gear_listings;
create policy "gear_listings_insert_own" on public.gear_listings for insert with check (
  seller_id = auth.uid() and status = 'active' and buyer_id is null and moderation = 'ok' and favorite_count = 0
);
drop policy if exists "gear_listings_update_own" on public.gear_listings;
create policy "gear_listings_update_own" on public.gear_listings for update using (seller_id = auth.uid()) with check (seller_id = auth.uid());
drop policy if exists "gear_listings_delete_own" on public.gear_listings;
create policy "gear_listings_delete_own" on public.gear_listings for delete using (seller_id = auth.uid());
grant select on public.gear_listings to anon, authenticated;
grant insert, update, delete on public.gear_listings to authenticated;

-- 문의 기록 (구매자 1명당 1행; 대화는 기존 DM conversations)
create table if not exists public.gear_inquiries (
  listing_id uuid not null references public.gear_listings (id) on delete cascade,
  buyer_id uuid not null references auth.users (id) on delete cascade,
  buyer_nickname text not null default '',
  conversation_id uuid references public.conversations (id) on delete set null,
  created_at timestamptz not null default now(),
  primary key (listing_id, buyer_id)
);
alter table public.gear_inquiries enable row level security;
drop policy if exists "gear_inquiries_select_party" on public.gear_inquiries;
create policy "gear_inquiries_select_party" on public.gear_inquiries for select using (
  buyer_id = auth.uid()
  or exists (select 1 from public.gear_listings l where l.id = listing_id and l.seller_id = auth.uid())
);
grant select on public.gear_inquiries to authenticated;

-- 판매자 보호 컬럼: 찜 수·관리 상태는 판매자가 바꿀 수 없고, 구매자는 실제 문의한 사람만 지정할 수 있다.
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
drop trigger if exists gear_listings_guard on public.gear_listings;
create trigger gear_listings_guard before update on public.gear_listings
  for each row execute function public.trg_gear_listing_guard();

-- 찜
create table if not exists public.gear_favorites (
  listing_id uuid not null references public.gear_listings (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (listing_id, user_id)
);
alter table public.gear_favorites enable row level security;
drop policy if exists "gear_favorites_select_own" on public.gear_favorites;
create policy "gear_favorites_select_own" on public.gear_favorites for select using (user_id = auth.uid());
drop policy if exists "gear_favorites_insert_own" on public.gear_favorites;
create policy "gear_favorites_insert_own" on public.gear_favorites for insert with check (
  user_id = auth.uid() and exists (select 1 from public.gear_listings l where l.id = listing_id and l.seller_id <> auth.uid())
);
drop policy if exists "gear_favorites_delete_own" on public.gear_favorites;
create policy "gear_favorites_delete_own" on public.gear_favorites for delete using (user_id = auth.uid());
grant select, insert, delete on public.gear_favorites to authenticated;

create or replace function public.trg_gear_favorite_count()
returns trigger language plpgsql security definer set search_path = public as $$
declare lid uuid := coalesce(new.listing_id, old.listing_id);
begin
  perform set_config('martialdex.gear_fav', 'on', true);
  update public.gear_listings set favorite_count = (select count(*) from public.gear_favorites f where f.listing_id = lid) where id = lid;
  perform set_config('martialdex.gear_fav', 'off', true);
  return null;
end;
$$;
drop trigger if exists gear_favorites_count on public.gear_favorites;
create trigger gear_favorites_count after insert or delete on public.gear_favorites
  for each row execute function public.trg_gear_favorite_count();

-- 문의 시작: 차단·본인 상품·판매 종료를 서버에서 막고, 기존 DM(start_conversation)을 연다.
create or replace function public.start_gear_inquiry(p_listing uuid)
returns uuid language plpgsql security definer set search_path = public as $$
declare l public.gear_listings; me uuid := auth.uid(); conv uuid; nick text;
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into l from public.gear_listings where id = p_listing;
  if not found or l.moderation <> 'ok' or l.status = 'hidden' then raise exception 'listing not available'; end if;
  if l.seller_id = me then raise exception 'cannot inquire on your own listing'; end if;
  if l.status = 'sold' then raise exception 'listing already sold'; end if;
  if public.is_blocked_between(l.seller_id, me) then raise exception 'blocked'; end if;
  conv := public.start_conversation(l.seller_id);
  select coalesce(nickname, '') into nick from public.profiles where user_id = me;
  insert into public.gear_inquiries (listing_id, buyer_id, buyer_nickname, conversation_id)
  values (p_listing, me, coalesce(nick, ''), conv)
  on conflict (listing_id, buyer_id) do update set conversation_id = excluded.conversation_id;
  return conv;
end;
$$;
revoke all on function public.start_gear_inquiry(uuid) from public;
grant execute on function public.start_gear_inquiry(uuid) to authenticated;

-- 거래 후기: 판매 완료된 거래의 판매자 ↔ 지정 구매자만, 서로 1회
create table if not exists public.gear_reviews (
  listing_id uuid not null references public.gear_listings (id) on delete cascade,
  reviewer_id uuid not null references auth.users (id) on delete cascade,
  reviewee_id uuid not null references auth.users (id) on delete cascade,
  rating int not null check (rating between 1 and 5),
  body text not null default '' check (char_length(body) <= 1000),
  created_at timestamptz not null default now(),
  primary key (listing_id, reviewer_id)
);
create index if not exists gear_reviews_reviewee_idx on public.gear_reviews (reviewee_id, created_at desc);
alter table public.gear_reviews enable row level security;
drop policy if exists "gear_reviews_select_all" on public.gear_reviews;
create policy "gear_reviews_select_all" on public.gear_reviews for select using (true);
drop policy if exists "gear_reviews_insert_party" on public.gear_reviews;
create policy "gear_reviews_insert_party" on public.gear_reviews for insert with check (
  reviewer_id = auth.uid()
  and exists (
    select 1 from public.gear_listings l
    where l.id = listing_id and l.status = 'sold' and l.buyer_id is not null
      and ((l.seller_id = auth.uid() and reviewee_id = l.buyer_id) or (l.buyer_id = auth.uid() and reviewee_id = l.seller_id))
  )
);
drop policy if exists "gear_reviews_delete_own" on public.gear_reviews;
create policy "gear_reviews_delete_own" on public.gear_reviews for delete using (reviewer_id = auth.uid());
grant select on public.gear_reviews to anon, authenticated;
grant insert, delete on public.gear_reviews to authenticated;

-- 신고된 상품 내리기 (플랫폼 관리자)
create or replace function public.moderate_gear_listing(p_listing uuid, p_remove boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  update public.gear_listings set moderation = case when p_remove then 'removed' else 'ok' end where id = p_listing;
end;
$$;
revoke all on function public.moderate_gear_listing(uuid, boolean) from public;
grant execute on function public.moderate_gear_listing(uuid, boolean) to authenticated;

-- DM 첨부에 '장비 상품' 추가 (기존 종류 유지)
alter table public.messages drop constraint if exists messages_attachment_shape;
alter table public.messages add constraint messages_attachment_shape check (
  attachment is null or (
    jsonb_typeof(attachment) = 'object'
    and attachment ->> 'kind' in ('post', 'combo', 'technique', 'curriculum', 'gear')
    and pg_column_size(attachment) < 262144
  )
);

-- 상품 이미지 저장소: 공개 읽기, 본인 폴더에만 쓰기, 이미지 형식·크기 제한(서버 측)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('gear-media', 'gear-media', true, 8388608, array['image/jpeg', 'image/png', 'image/webp', 'image/gif'])
on conflict (id) do nothing;
drop policy if exists "gear_media_public_read" on storage.objects;
create policy "gear_media_public_read" on storage.objects for select using (bucket_id = 'gear-media');
drop policy if exists "gear_media_insert_own_folder" on storage.objects;
create policy "gear_media_insert_own_folder" on storage.objects for insert
  with check (bucket_id = 'gear-media' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "gear_media_delete_own_folder" on storage.objects;
create policy "gear_media_delete_own_folder" on storage.objects for delete
  using (bucket_id = 'gear-media' and (storage.foldername(name))[1] = auth.uid()::text);
