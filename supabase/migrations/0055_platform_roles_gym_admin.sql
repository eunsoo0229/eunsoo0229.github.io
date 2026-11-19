-- 통합 플랫폼 1/4 — 플랫폼 관리자 · 검증된 자격 · 체육관 운영(가입 승인·과제·공지·진도 공유)
--
-- 역할 구조 (새 "역할 테이블"을 만들지 않고 기존 구조를 그대로 쓴다)
--   일반 회원        : auth.users + profiles (기존)
--   체육관 회원      : gym_members.role = 'student' (기존 0022)
--   지도자           : gym_members.role = 'instructor' (기존 0022)
--   체육관 관리자    : gyms.owner_user_id (기존 0022) / gym_listings.owner_user_id (0058)
--   플랫폼 관리자    : platform_admins (이 파일) — SQL/서비스 역할로만 부여, 클라이언트 INSERT 정책 없음
--   검증된 지도자·숙련자 : verified_credentials (이 파일) — 플랫폼 관리자만 기록
--
-- 보안 수정 (기존 0022/0025의 빈틈):
--   * gym_members_insert_self 는 user_id 만 검사해서, 가입 코드를 아는 누구나 자신을
--     role='instructor' 로 넣을 수 있었다 → 이제 instructor 는 체육관 owner 만.
--   * gym_members_update_self(0025) 는 자기 행의 role 을 바꿀 수 있었다 → 트리거로 차단.
--   기존 행/데이터는 건드리지 않는다.

-- ============ 1. 플랫폼 관리자 ============
create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note text not null default '',
  granted_at timestamptz not null default now()
);
alter table public.platform_admins enable row level security;
drop policy if exists "platform_admins_select_self" on public.platform_admins;
create policy "platform_admins_select_self" on public.platform_admins for select using (user_id = auth.uid());
grant select on public.platform_admins to authenticated;

create or replace function public.is_platform_admin(p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select p_user is not null and exists (select 1 from public.platform_admins where user_id = p_user);
$$;
revoke all on function public.is_platform_admin(uuid) from public;
grant execute on function public.is_platform_admin(uuid) to anon, authenticated;

-- ============ 2. 검증된 자격 (평가자 그룹 · 지도자 표시) ============
-- 자기 신고(profiles.years_training 등)는 여기에 절대 들어오지 않는다.
create table if not exists public.verified_credentials (
  user_id uuid not null references auth.users (id) on delete cascade,
  -- 기술 DB 의 무술 id, 또는 '*' (전 종목)
  martial_art text not null default '*',
  tier text not null check (tier in ('beginner', 'intermediate', 'advanced', 'instructor')),
  evidence text not null default '',
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz not null default now(),
  revoked_at timestamptz,
  primary key (user_id, martial_art)
);
alter table public.verified_credentials enable row level security;
-- 배지는 공개 정보(검증 여부·등급)라 누구나 읽을 수 있다. 근거(evidence)는 본인·관리자만 보도록 뷰 대신 RPC 로 노출하지 않는다.
drop policy if exists "verified_credentials_select_all" on public.verified_credentials;
create policy "verified_credentials_select_all" on public.verified_credentials for select using (true);
grant select (user_id, martial_art, tier, verified_at, revoked_at) on public.verified_credentials to anon, authenticated;

create table if not exists public.credential_applications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  martial_art text not null default '*',
  requested_tier text not null check (requested_tier in ('beginner', 'intermediate', 'advanced', 'instructor')),
  evidence text not null check (char_length(evidence) between 10 and 2000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  review_note text not null default '',
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
alter table public.credential_applications enable row level security;
drop policy if exists "credential_applications_select" on public.credential_applications;
create policy "credential_applications_select" on public.credential_applications for select
  using (user_id = auth.uid() or public.is_platform_admin(auth.uid()));
drop policy if exists "credential_applications_insert_own" on public.credential_applications;
create policy "credential_applications_insert_own" on public.credential_applications for insert
  with check (user_id = auth.uid() and status = 'pending' and reviewed_by is null);
grant select, insert on public.credential_applications to authenticated;

create or replace function public.review_credential_application(p_id uuid, p_approve boolean, p_note text default '')
returns void language plpgsql security definer set search_path = public as $$
declare a public.credential_applications;
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  select * into a from public.credential_applications where id = p_id for update;
  if not found then raise exception 'application not found'; end if;
  if a.status <> 'pending' then raise exception 'already reviewed'; end if;
  update public.credential_applications
     set status = case when p_approve then 'approved' else 'rejected' end,
         review_note = coalesce(p_note, ''), reviewed_by = auth.uid(), reviewed_at = now()
   where id = p_id;
  if p_approve then
    insert into public.verified_credentials (user_id, martial_art, tier, evidence, verified_by, verified_at, revoked_at)
    values (a.user_id, a.martial_art, a.requested_tier, a.evidence, auth.uid(), now(), null)
    on conflict (user_id, martial_art) do update
      set tier = excluded.tier, evidence = excluded.evidence, verified_by = excluded.verified_by,
          verified_at = excluded.verified_at, revoked_at = null;
  end if;
end;
$$;
revoke all on function public.review_credential_application(uuid, boolean, text) from public;
grant execute on function public.review_credential_application(uuid, boolean, text) to authenticated;

create or replace function public.revoke_verified_credential(p_user uuid, p_art text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  update public.verified_credentials set revoked_at = now() where user_id = p_user and martial_art = p_art;
end;
$$;
revoke all on function public.revoke_verified_credential(uuid, text) from public;
grant execute on function public.revoke_verified_credential(uuid, text) to authenticated;

-- 신고함: 플랫폼 관리자는 모든 신고를 볼 수 있다 (기존 정책은 본인 신고만).
drop policy if exists "user_reports_select_platform_admin" on public.user_reports;
create policy "user_reports_select_platform_admin" on public.user_reports for select using (public.is_platform_admin(auth.uid()));

-- 새 기능의 신고 대상 추가 (기존 값은 그대로 유지)
alter table public.user_reports drop constraint if exists user_reports_target_type_check;
alter table public.user_reports add constraint user_reports_target_type_check check (
  target_type in ('user', 'post', 'comment', 'message', 'clan',
                  'technique_vote', 'technique_feedback', 'gear_listing', 'gym_listing', 'gym_review')
);
alter table public.user_reports add column if not exists resolved_at timestamptz;
alter table public.user_reports add column if not exists resolution text not null default '';

create or replace function public.resolve_user_report(p_id uuid, p_resolution text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_platform_admin(auth.uid()) then raise exception 'platform admin only'; end if;
  update public.user_reports set resolved_at = now(), resolution = coalesce(p_resolution, '') where id = p_id;
end;
$$;
revoke all on function public.resolve_user_report(uuid, text) from public;
grant execute on function public.resolve_user_report(uuid, text) to authenticated;

-- ============ 3. 체육관 멤버십 권한 수정 ============
alter table public.gyms add column if not exists join_approval boolean not null default false;

create or replace function public.gym_owner_of(p_gym text)
returns uuid language sql security definer set search_path = public stable as $$
  select owner_user_id from public.gyms where id = p_gym;
$$;
revoke all on function public.gym_owner_of(text) from public;
grant execute on function public.gym_owner_of(text) to authenticated;

create or replace function public.is_gym_member(p_gym text, p_user uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (select 1 from public.gym_members where gym_id = p_gym and user_id = p_user);
$$;
revoke all on function public.is_gym_member(text, uuid) from public;
grant execute on function public.is_gym_member(text, uuid) to authenticated;

-- 승인 없이 코드만으로 참가할 수 있는 체육관인가 (gyms RLS 는 비회원에게 행을 숨기므로 SECURITY DEFINER 로 읽는다;
-- 체육관이 없으면 false)
create or replace function public.gym_open_join(p_gym text)
returns boolean language sql security definer set search_path = public stable as $$
  select coalesce((select not join_approval from public.gyms where id = p_gym), false);
$$;
revoke all on function public.gym_open_join(text) from public;
grant execute on function public.gym_open_join(text) to authenticated;

drop policy if exists "gym_members_insert_self" on public.gym_members;
create policy "gym_members_insert_self" on public.gym_members for insert with check (
  user_id = auth.uid()
  and (
    public.gym_owner_of(gym_id) = auth.uid()
    or (role = 'student' and public.gym_open_join(gym_id))
  )
);

-- 역할 변경은 체육관 owner 만 (자기 행 update 정책이 role 을 바꾸게 두지 않는다)
create or replace function public.trg_protect_gym_member_role()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gym_id is distinct from old.gym_id or new.user_id is distinct from old.user_id then
    raise exception 'gym membership keys are immutable';
  end if;
  if new.role is distinct from old.role and public.gym_owner_of(new.gym_id) is distinct from auth.uid() then
    raise exception 'only the gym owner can change roles';
  end if;
  return new;
end;
$$;
drop trigger if exists gym_members_protect_role on public.gym_members;
create trigger gym_members_protect_role before update on public.gym_members
  for each row execute function public.trg_protect_gym_member_role();

create or replace function public.set_gym_member_role(p_gym text, p_user uuid, p_role text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.gym_owner_of(p_gym) is distinct from auth.uid() then raise exception 'only the gym owner can change roles'; end if;
  if p_role not in ('instructor', 'student') then raise exception 'invalid role'; end if;
  if p_user = auth.uid() and p_role <> 'instructor' then raise exception 'owner stays instructor'; end if;
  update public.gym_members set role = p_role where gym_id = p_gym and user_id = p_user;
  if not found then raise exception 'not a member'; end if;
end;
$$;
revoke all on function public.set_gym_member_role(text, uuid, text) from public;
grant execute on function public.set_gym_member_role(text, uuid, text) to authenticated;

create or replace function public.remove_gym_member(p_gym text, p_user uuid)
returns void language plpgsql security definer set search_path = public as $$
declare target_role text;
begin
  if not public.is_gym_instructor(p_gym, auth.uid()) then raise exception 'instructor only'; end if;
  if p_user = public.gym_owner_of(p_gym) then raise exception 'cannot remove the owner'; end if;
  select role into target_role from public.gym_members where gym_id = p_gym and user_id = p_user;
  if target_role = 'instructor' and public.gym_owner_of(p_gym) is distinct from auth.uid() then
    raise exception 'only the owner can remove an instructor';
  end if;
  delete from public.gym_members where gym_id = p_gym and user_id = p_user;
end;
$$;
revoke all on function public.remove_gym_member(text, uuid) from public;
grant execute on function public.remove_gym_member(text, uuid) to authenticated;

create or replace function public.set_gym_join_approval(p_gym text, p_required boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if public.gym_owner_of(p_gym) is distinct from auth.uid() then raise exception 'owner only'; end if;
  update public.gyms set join_approval = p_required where id = p_gym;
end;
$$;
revoke all on function public.set_gym_join_approval(text, boolean) from public;
grant execute on function public.set_gym_join_approval(text, boolean) to authenticated;

-- ============ 4. 가입 신청 · 승인 ============
create table if not exists public.gym_join_requests (
  gym_id text not null references public.gyms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  nickname text not null,
  message text not null default '' check (char_length(message) <= 300),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decided_by uuid references auth.users (id) on delete set null,
  primary key (gym_id, user_id)
);
alter table public.gym_join_requests enable row level security;
drop policy if exists "gym_join_requests_select" on public.gym_join_requests;
create policy "gym_join_requests_select" on public.gym_join_requests for select
  using (user_id = auth.uid() or public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_join_requests_delete_self" on public.gym_join_requests;
create policy "gym_join_requests_delete_self" on public.gym_join_requests for delete using (user_id = auth.uid() and status = 'pending');
grant select, delete on public.gym_join_requests to authenticated;

-- 코드로 참가: 승인제가 아니면 바로 학생으로, 승인제면 신청서를 남긴다. 반환: 'joined' | 'requested' | 'already'
create or replace function public.join_gym_with_code(p_code text, p_nickname text, p_message text default '')
returns table (gym_id text, gym_name text, outcome text)
language plpgsql security definer set search_path = public as $$
declare g public.gyms; me uuid := auth.uid();
begin
  if me is null then raise exception 'not authenticated'; end if;
  select * into g from public.gyms where join_code = upper(trim(p_code));
  if not found then raise exception 'gym not found'; end if;
  if exists (select 1 from public.gym_members m where m.gym_id = g.id and m.user_id = me) then
    return query select g.id, g.name, 'already'::text; return;
  end if;
  if not g.join_approval then
    insert into public.gym_members (gym_id, user_id, role, nickname) values (g.id, me, 'student', coalesce(nullif(trim(p_nickname), ''), '회원'));
    return query select g.id, g.name, 'joined'::text; return;
  end if;
  insert into public.gym_join_requests (gym_id, user_id, nickname, message)
  values (g.id, me, coalesce(nullif(trim(p_nickname), ''), '회원'), left(coalesce(p_message, ''), 300))
  on conflict on constraint gym_join_requests_pkey do update
    set status = 'pending', message = excluded.message, created_at = now(), decided_at = null, decided_by = null
    where public.gym_join_requests.status <> 'approved';
  return query select g.id, g.name, 'requested'::text;
end;
$$;
revoke all on function public.join_gym_with_code(text, text, text) from public;
grant execute on function public.join_gym_with_code(text, text, text) to authenticated;

create or replace function public.decide_gym_join(p_gym text, p_user uuid, p_approve boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.gym_join_requests;
begin
  if not public.is_gym_instructor(p_gym, auth.uid()) then raise exception 'instructor only'; end if;
  select * into r from public.gym_join_requests where gym_id = p_gym and user_id = p_user for update;
  if not found or r.status <> 'pending' then raise exception 'no pending request'; end if;
  update public.gym_join_requests set status = case when p_approve then 'approved' else 'rejected' end,
         decided_at = now(), decided_by = auth.uid()
   where gym_id = p_gym and user_id = p_user;
  if p_approve then
    insert into public.gym_members (gym_id, user_id, role, nickname) values (p_gym, p_user, 'student', r.nickname)
    on conflict do nothing;
  end if;
end;
$$;
revoke all on function public.decide_gym_join(text, uuid, boolean) from public;
grant execute on function public.decide_gym_join(text, uuid, boolean) to authenticated;

-- ============ 5. 회원 진도 공유 (회원 동의 기반 요약본) ============
-- 학습·자세·훈련 원본은 각 회원 기기(local-first)와 본인 전용 테이블에 그대로 있다.
-- 이 테이블은 회원이 "체육관에 진도 공유"를 켰을 때만 회원 본인이 올리는 요약본이며,
-- 원본을 대체하지 않는다. 공유를 끄면 회원이 행을 지운다(지도자는 지울 수도 쓸 수도 없음).
create table if not exists public.gym_member_progress (
  gym_id text not null,
  user_id uuid not null,
  summary jsonb not null check (jsonb_typeof(summary) = 'object' and pg_column_size(summary) < 204800),
  updated_at timestamptz not null default now(),
  primary key (gym_id, user_id),
  foreign key (gym_id, user_id) references public.gym_members (gym_id, user_id) on delete cascade
);
alter table public.gym_member_progress enable row level security;
drop policy if exists "gym_member_progress_select" on public.gym_member_progress;
create policy "gym_member_progress_select" on public.gym_member_progress for select
  using (user_id = auth.uid() or public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_member_progress_insert_self" on public.gym_member_progress;
create policy "gym_member_progress_insert_self" on public.gym_member_progress for insert with check (user_id = auth.uid());
drop policy if exists "gym_member_progress_update_self" on public.gym_member_progress;
create policy "gym_member_progress_update_self" on public.gym_member_progress for update using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists "gym_member_progress_delete_self" on public.gym_member_progress;
create policy "gym_member_progress_delete_self" on public.gym_member_progress for delete using (user_id = auth.uid());
grant select, insert, update, delete on public.gym_member_progress to authenticated;

-- ============ 6. 지도자 → 회원 과제 · 기술 권장 · 피드백 · AI 분석 검토 ============
create table if not exists public.gym_assignments (
  id uuid primary key default gen_random_uuid(),
  gym_id text not null references public.gyms (id) on delete cascade,
  member_id uuid not null references auth.users (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('task', 'technique', 'feedback', 'ai_review')),
  technique_id text,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 3000),
  due_date date,
  status text not null default 'open' check (status in ('open', 'done', 'dismissed')),
  member_note text not null default '' check (char_length(member_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists gym_assignments_member_idx on public.gym_assignments (member_id, created_at desc);
create index if not exists gym_assignments_gym_idx on public.gym_assignments (gym_id, created_at desc);
alter table public.gym_assignments enable row level security;
drop policy if exists "gym_assignments_select" on public.gym_assignments;
create policy "gym_assignments_select" on public.gym_assignments for select
  using (member_id = auth.uid() or public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_assignments_insert_instructor" on public.gym_assignments;
create policy "gym_assignments_insert_instructor" on public.gym_assignments for insert with check (
  author_id = auth.uid() and public.is_gym_instructor(gym_id, auth.uid()) and public.is_gym_member(gym_id, member_id)
);
drop policy if exists "gym_assignments_update" on public.gym_assignments;
create policy "gym_assignments_update" on public.gym_assignments for update
  using (member_id = auth.uid() or public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_assignments_delete_instructor" on public.gym_assignments;
create policy "gym_assignments_delete_instructor" on public.gym_assignments for delete using (public.is_gym_instructor(gym_id, auth.uid()));
grant select, insert, update, delete on public.gym_assignments to authenticated;

-- 회원은 상태·메모만 바꿀 수 있다 (지도자가 쓴 내용은 회원이 고칠 수 없음)
create or replace function public.trg_gym_assignment_update()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.gym_id is distinct from old.gym_id or new.member_id is distinct from old.member_id or new.author_id is distinct from old.author_id then
    raise exception 'assignment keys are immutable';
  end if;
  if not public.is_gym_instructor(old.gym_id, auth.uid()) then
    if new.kind is distinct from old.kind or new.title is distinct from old.title or new.body is distinct from old.body
       or new.technique_id is distinct from old.technique_id or new.due_date is distinct from old.due_date then
      raise exception 'members can only update status and their note';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists gym_assignments_guard on public.gym_assignments;
create trigger gym_assignments_guard before update on public.gym_assignments
  for each row execute function public.trg_gym_assignment_update();

-- ============ 7. 체육관 공지 ============
create table if not exists public.gym_announcements (
  id uuid primary key default gen_random_uuid(),
  gym_id text not null references public.gyms (id) on delete cascade,
  author_id uuid not null references auth.users (id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  body text not null default '' check (char_length(body) <= 3000),
  pinned boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists gym_announcements_gym_idx on public.gym_announcements (gym_id, created_at desc);
alter table public.gym_announcements enable row level security;
drop policy if exists "gym_announcements_select_member" on public.gym_announcements;
create policy "gym_announcements_select_member" on public.gym_announcements for select using (public.is_gym_member(gym_id, auth.uid()));
drop policy if exists "gym_announcements_write_instructor" on public.gym_announcements;
create policy "gym_announcements_write_instructor" on public.gym_announcements for insert
  with check (author_id = auth.uid() and public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_announcements_update_instructor" on public.gym_announcements;
create policy "gym_announcements_update_instructor" on public.gym_announcements for update using (public.is_gym_instructor(gym_id, auth.uid()));
drop policy if exists "gym_announcements_delete_instructor" on public.gym_announcements;
create policy "gym_announcements_delete_instructor" on public.gym_announcements for delete using (public.is_gym_instructor(gym_id, auth.uid()));
grant select, insert, update, delete on public.gym_announcements to authenticated;
