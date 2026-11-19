// 통합 플랫폼 마이그레이션 0055–0058 — 전체 마이그레이션(0001~0058)을 PGlite 에 순서대로 적용한 뒤
// 실제 RLS·RPC 를 역할별 사용자로 실행해 권한과 집계를 검증한다. 운영 DB 와 무관(메모리 DB).
//   PGLITE_DIR=/path/to/node_modules node .devtools/test-ecosystem-sql.mjs
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = process.env.PGLITE_DIR;
if (!dir) {
  console.log('NOT TESTED — set PGLITE_DIR');
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(path.join(dir, '@electric-sql/pglite/dist/index.js')).href);
const db = new PGlite();
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (!p && d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 300) : '')));

const U = (n) => `00000000-0000-0000-0000-0000000000${String(n).padStart(2, '0')}`;
const OWNER = U(1), STUDENT = U(2), STRANGER = U(3), ADMIN = U(4), INSTR = U(5), BUYER = U(6);
const VOTERS = [U(11), U(12), U(13), U(14), U(15)];
const ALL = [OWNER, STUDENT, STRANGER, ADMIN, INSTR, BUYER, ...VOTERS];
await db.exec(`
  create role anon nologin; create role authenticated nologin; create role service_role nologin bypassrls;
  create schema auth; create table auth.users (id uuid primary key, email text);  -- email: as in Supabase (0043/0061 look accounts up by it)
  create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), current_user::text) $$;
  grant usage on schema public to anon, authenticated; grant usage on schema auth to anon, authenticated; grant execute on function auth.uid() to anon, authenticated;
  insert into auth.users values ${ALL.map((u) => `('${u}')`).join(',')};
  create publication supabase_realtime;
  create schema storage;
  create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text, owner uuid);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language sql immutable as $$ select string_to_array(name, '/') $$;
  grant usage on schema storage to anon, authenticated; grant select, insert, delete on storage.objects to authenticated;
`);
const files = fs.readdirSync(path.join(APP, 'supabase/migrations')).filter((f) => /^\d{4}_.*\.sql$/.test(f)).sort();
const failed = [];
for (const f of files) {
  try {
    await db.exec(fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8'));
  } catch (e) {
    failed.push(`${f}: ${e.message}`);
  }
}
check('[0] 0055–0059 적용', !failed.some((m) => /^005[5-9]_/.test(m)), failed);
if (failed.length) console.log('   (참고: 적용 실패한 기존 마이그레이션)', failed.filter((m) => !/^005[5-9]_/.test(m)));
await db.exec(`grant usage on schema public to service_role; grant all on all tables in schema public to service_role; grant execute on all functions in schema public to service_role;`);
for (const f of files.filter((x) => /^005[5-9]_/.test(x))) {
  try {
    await db.exec(fs.readFileSync(path.join(APP, 'supabase/migrations', f), 'utf8'));
    check(`[0] ${f.slice(0, 4)} 재실행 안전`, true);
  } catch (e) {
    check(`[0] ${f.slice(0, 4)} 재실행 안전`, false, e.message);
  }
}

async function as(uid, q, params) {
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '${uid ?? ''}', false); select set_config('request.jwt.claim.role', '${uid ? 'authenticated' : 'anon'}', false); set role ${uid ? 'authenticated' : 'anon'};`);
  try {
    return (await db.query(q, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
// expect an error; with `why`, the error message must match it (so a check can't pass for the wrong reason)
async function fails(uid, q, params, why) {
  try {
    await as(uid, q, params);
    return false;
  } catch (e) {
    return why ? why.test(e.message) : true;
  }
}
for (const [u, n] of [[OWNER, '관장'], [STUDENT, '학생'], [STRANGER, '외부인'], [ADMIN, '운영자'], [INSTR, '사범'], [BUYER, '구매자'], ...VOTERS.map((v, i) => [v, `투표자${i}`])]) {
  await as(u, `insert into public.profiles (user_id, nickname) values ($1, $2)`, [u, n]);
}
await db.query(`insert into public.platform_admins (user_id) values ($1)`, [ADMIN]);

// ================= A. 체육관 권한 =================
console.log('\n[A] 체육관 운영');
await as(OWNER, `insert into public.gyms (id, name, owner_user_id, join_code) values ('gym1', '테스트 체육관', $1, 'ABC234')`, [OWNER]);
await as(OWNER, `insert into public.gym_members (gym_id, user_id, role, nickname) values ('gym1', $1, 'instructor', '관장')`, [OWNER]);
check('A1 가입 코드를 알아도 스스로 instructor 로 가입 불가 (기존 빈틈 수정)', await fails(STRANGER, `insert into public.gym_members (gym_id, user_id, role, nickname) values ('gym1', $1, 'instructor', 'x')`, [STRANGER]));
const j1 = await as(STUDENT, `select * from public.join_gym_with_code('abc234', '학생', '')`);
check('A2 승인제가 아니면 코드로 바로 학생 가입', j1[0]?.outcome === 'joined', j1);
check('A3 학생이 자기 role 을 instructor 로 바꿀 수 없음 (기존 빈틈 수정)', await fails(STUDENT, `update public.gym_members set role = 'instructor' where gym_id = 'gym1' and user_id = $1`, [STUDENT], /owner can change roles/));
await as(OWNER, `select public.set_gym_join_approval('gym1', true)`);
check('A4 승인제 체육관: 직접 insert 로 우회 가입 불가', await fails(STRANGER, `insert into public.gym_members (gym_id, user_id, role, nickname) values ('gym1', $1, 'student', 'x')`, [STRANGER]));
const j2 = await as(STRANGER, `select * from public.join_gym_with_code('ABC234', '외부인', '복싱 배우고 싶어요')`);
check('A5 승인제: 코드 입력 → 가입 신청으로 남음', j2[0]?.outcome === 'requested', j2);
check('A6 학생은 다른 사람 가입 신청을 승인할 수 없음', await fails(STUDENT, `select public.decide_gym_join('gym1', $1, true)`, [STRANGER]));
await as(OWNER, `select public.decide_gym_join('gym1', $1, true)`, [STRANGER]);
check('A7 관장 승인 → 회원 등록', (await as(STRANGER, `select role from public.gym_members where gym_id = 'gym1' and user_id = $1`, [STRANGER]))[0]?.role === 'student');
await as(OWNER, `select public.set_gym_member_role('gym1', $1, 'instructor')`, [INSTR]).catch(() => null);
await as(INSTR, `select * from public.join_gym_with_code('ABC234', '사범', '')`);
await as(OWNER, `select public.decide_gym_join('gym1', $1, true)`, [INSTR]);
await as(OWNER, `select public.set_gym_member_role('gym1', $1, 'instructor')`, [INSTR]);
check('A8 owner 만 역할 변경 (사범 지정)', (await as(INSTR, `select role from public.gym_members where gym_id='gym1' and user_id=$1`, [INSTR]))[0]?.role === 'instructor');
check('A9 사범이 다른 회원을 사범으로 올릴 수 없음', await fails(INSTR, `select public.set_gym_member_role('gym1', $1, 'instructor')`, [STUDENT]));
// progress share (member consent)
await as(STUDENT, `insert into public.gym_member_progress (gym_id, user_id, summary) values ('gym1', $1, '{"learned": 3}')`, [STUDENT]);
check('A10 지도자는 동의한 회원의 진도 요약을 볼 수 있음', (await as(INSTR, `select summary from public.gym_member_progress where user_id = $1`, [STUDENT]))[0]?.summary?.learned === 3);
check('A11 다른 회원은 남의 진도 요약을 못 봄', (await as(STRANGER, `select 1 from public.gym_member_progress where user_id = $1`, [STUDENT])).length === 0);
check('A12 지도자도 회원 진도 요약을 고칠 수 없음', (await as(INSTR, `update public.gym_member_progress set summary = '{"learned": 99}' where user_id = $1 returning 1`, [STUDENT])).length === 0);
check('A13 비회원은 진도 공유 행을 만들 수 없음', await fails(BUYER, `insert into public.gym_member_progress (gym_id, user_id, summary) values ('gym1', $1, '{}')`, [BUYER]));
// assignments
await as(INSTR, `insert into public.gym_assignments (gym_id, member_id, author_id, kind, technique_id, title, body) values ('gym1', $1, $2, 'technique', 'boxing__jab', '잽 복습', '거리 유지')`, [STUDENT, INSTR]);
check('A14 회원은 자기 과제를 봄', (await as(STUDENT, `select title from public.gym_assignments`)).length === 1);
check('A15 다른 회원은 남의 과제를 못 봄', (await as(STRANGER, `select title from public.gym_assignments`)).length === 0);
check('A16 학생은 과제를 만들 수 없음', await fails(STUDENT, `insert into public.gym_assignments (gym_id, member_id, author_id, kind, title) values ('gym1', $1, $1, 'task', 'x')`, [STUDENT]));
check('A17 회원은 과제 내용을 고칠 수 없음 (상태·메모만)', await fails(STUDENT, `update public.gym_assignments set title = '바꿈' where member_id = $1`, [STUDENT]));
await as(STUDENT, `update public.gym_assignments set status = 'done', member_note = '완료' where member_id = $1`, [STUDENT]);
check('A18 회원은 완료 표시 가능', (await as(INSTR, `select status from public.gym_assignments`))[0]?.status === 'done');
check('A19 비회원에게 과제 지정 불가', await fails(INSTR, `insert into public.gym_assignments (gym_id, member_id, author_id, kind, title) values ('gym1', $1, $2, 'task', 'x')`, [BUYER, INSTR]));
await as(OWNER, `insert into public.gym_announcements (gym_id, author_id, title) values ('gym1', $1, '휴관 안내')`, [OWNER]);
check('A20 공지는 회원만 봄', (await as(STUDENT, `select 1 from public.gym_announcements`)).length === 1 && (await as(BUYER, `select 1 from public.gym_announcements`)).length === 0);

// ================= D. 기술 평가 =================
console.log('\n[D] 숏폼·게시물 기술 평가');
await as(OWNER, `insert into public.community_posts (id, author_id, author_nickname, content, post_type) values ('post1', $1, '관장', '잽 평가 부탁', 'media')`, [OWNER]);
await as(STUDENT, `insert into public.community_posts (id, author_id, author_nickname, content, post_type) values ('post2', $1, '학생', '남의 글', 'text')`, [STUDENT]);
check('D1 남의 게시물에 평가 설정 불가', await fails(OWNER, `insert into public.technique_evaluations (post_id, author_id, martial_art, technique_name, criteria) values ('post2', $1, 'boxing', '잽', '{stance}')`, [OWNER]));
check('D2 허용되지 않은 평가 항목 거절', await fails(OWNER, `insert into public.technique_evaluations (post_id, author_id, martial_art, technique_name, criteria) values ('post1', $1, 'boxing', '잽', '{looks}')`, [OWNER]));
await as(OWNER, `insert into public.technique_evaluations (post_id, author_id, martial_art, technique_id, technique_name, criteria) values ('post1', $1, 'boxing', 'boxing__jab', '잽', '{stance,balance,timing}')`, [OWNER]);
check('D3 투표 테이블에 직접 insert 불가 (RPC 전용)', await fails(VOTERS[0], `insert into public.technique_votes (post_id, voter_id, scores) values ('post1', $1, '{"stance": 100}')`, [VOTERS[0]]));
check('D4 자기 콘텐츠 자기 투표 제한', await fails(OWNER, `select public.cast_technique_vote('post1', '{"stance": 100}')`, [], /self vote/));
check('D5 0~100 밖 점수 거절', await fails(VOTERS[0], `select public.cast_technique_vote('post1', '{"stance": 140}')`));
check('D6 소수점 점수 거절', await fails(VOTERS[0], `select public.cast_technique_vote('post1', '{"stance": 50.5}')`));
check('D7 평가 항목이 아닌 키 거절', await fails(VOTERS[0], `select public.cast_technique_vote('post1', '{"speed": 50}')`));
const scores = [[80, 70, 60], [90, 80, 70], [70, 60, 50], [60, 50, 40]];
for (let i = 0; i < 4; i++) {
  await as(VOTERS[i], `select public.cast_technique_vote('post1', $1::jsonb, $2::jsonb, '')`, [JSON.stringify({ stance: scores[i][0], balance: scores[i][1], timing: scores[i][2] }), JSON.stringify(i === 0 ? { stance: '앞발 각도 좋음' } : {})]);
}
await as(VOTERS[0], `select public.cast_technique_vote('post1', '{"stance": 100, "balance": 70, "timing": 60}', '{"stance": "앞발 각도 좋음"}', '')`);
check('D8 같은 사람이 다시 투표하면 1표로 유지 (변경)', (await db.query(`select count(*)::int n from public.technique_votes where post_id='post1' and voter_id=$1`, [VOTERS[0]])).rows[0].n === 1);
check('D9 다른 사람의 개별 투표는 못 봄', (await as(VOTERS[1], `select voter_id from public.technique_votes`)).length === 1);
let st = (await as(STRANGER, `select public.get_technique_evaluation_stats('post1') s`))[0].s;
check('D10 참여자 수 4 (변경 후에도 중복 없음)', st.participants === 4, st);
check('D11 최신 점수만 집계: 자세 평균 (100+90+70+60)/4 = 80', Number(st.overall.stance.avg) === 80, st.overall);
check('D12 점수 분포 5구간', JSON.stringify(st.overall.stance.dist) === '[0,0,0,2,2]', st.overall.stance.dist);
check('D13 미검증 그룹 4명 (자기 신고 없음)', st.groups.unverified?.voters === 4 && st.groups.unverified.suppressed === false, st.groups);
// verified instructor via application → admin review
await as(INSTR, `insert into public.credential_applications (user_id, martial_art, requested_tier, evidence) values ($1, 'boxing', 'instructor', '복싱 지도자 자격증 2급 사본')`, [INSTR]);
check('D14 스스로 검증 등급을 만들 수 없음', await fails(INSTR, `insert into public.verified_credentials (user_id, martial_art, tier) values ($1, 'boxing', 'instructor')`, [INSTR]));
const appId = (await as(ADMIN, `select id from public.credential_applications`))[0].id;
check('D15 일반 사용자는 신청을 승인할 수 없음', await fails(INSTR, `select public.review_credential_application($1, true)`, [appId]));
await as(ADMIN, `select public.review_credential_application($1, true, '확인')`, [appId]);
await as(INSTR, `select public.cast_technique_vote('post1', '{"stance": 40, "balance": 40, "timing": 40}')`);
st = (await as(STRANGER, `select public.get_technique_evaluation_stats('post1') s`))[0].s;
check('D16 검증된 지도자 그룹 1명 → 표본 부족으로 평균 숨김', st.groups.instructor?.voters === 1 && st.groups.instructor.suppressed === true && !('avg' in st.groups.instructor), st.groups);
check('D17 같은 체육관 회원 표 분리 (사범은 관장과 같은 체육관)', st.sameGymVoters === 1 && st.outsideGym.voters === 4 && Number(st.outsideGym.avg.stance) === 80, st);
const fb = await as(OWNER, `select * from public.list_technique_feedback('post1')`);
check('D18 작성자는 익명 피드백을 받음 (투표자 id 없음)', fb.length === 1 && fb[0].feedback.stance === '앞발 각도 좋음' && !('voter_id' in fb[0]), fb);
await as(OWNER, `select public.mark_technique_feedback_helpful('post1', $1, true)`, [fb[0].feedback_id]);
check('D19 작성자 "유용함" 표시', (await as(OWNER, `select helpful from public.list_technique_feedback('post1')`))[0]?.helpful === true);
check('D20 작성자가 아니면 유용함 표시 불가', await fails(STRANGER, `select public.mark_technique_feedback_helpful('post1', $1, false)`, [fb[0].feedback_id]));
// report + invalidate
await as(STRANGER, `insert into public.user_reports (reporter_id, target_type, target_id, reason) values ($1, 'technique_vote', $2, '부정 투표')`, [STRANGER, `post1:${fb[0].feedback_id}`]);
check('D21 신고는 플랫폼 관리자에게 보임', (await as(ADMIN, `select 1 from public.user_reports where target_type = 'technique_vote'`)).length === 1);
check('D22 일반 사용자는 투표 무효화 불가', await fails(OWNER, `select public.invalidate_technique_vote('post1', $1, 'x')`, [fb[0].feedback_id]));
await as(ADMIN, `select public.invalidate_technique_vote('post1', $1, '부정 투표')`, [fb[0].feedback_id]);
st = (await as(STRANGER, `select public.get_technique_evaluation_stats('post1') s`))[0].s;
check('D23 무효 투표는 통계에서 제외 (참여자 5→4)', st.participants === 4, st.participants);
check('D24 무효화된 투표자는 다시 투표해 되살릴 수 없음', await fails(VOTERS[0], `select public.cast_technique_vote('post1', '{"stance": 90}')`));
// withdraw
await as(VOTERS[3], `select public.withdraw_technique_vote('post1')`);
check('D25 투표 철회 → 집계 제외', (await as(STRANGER, `select public.get_technique_evaluation_stats('post1') s`))[0].s.participants === 3);
// visibility setting
await as(OWNER, `update public.technique_evaluations set results_visibility = 'author_only' where post_id = 'post1'`);
const hidden = (await as(STRANGER, `select public.get_technique_evaluation_stats('post1') s`))[0].s;
check('D26 결과 비공개: 다른 사람에게 점수 없음', hidden.hidden === true && !hidden.overall, hidden);
check('D27 결과 비공개여도 작성자는 결과를 봄', (await as(OWNER, `select public.get_technique_evaluation_stats('post1') s`))[0].s.hidden === false);
check('D28 결과 비공개: 다른 사람은 피드백 목록도 못 봄', (await as(STRANGER, `select * from public.list_technique_feedback('post1')`)).length === 0);
check('D29 투표 시작 후 평가 항목 변경 불가', await fails(OWNER, `update public.technique_evaluations set criteria = '{stance}' where post_id = 'post1'`));
await as(OWNER, `update public.technique_evaluations set closed_at = now() where post_id = 'post1'`);
check('D30 평가 종료 후 투표 불가', await fails(VOTERS[4], `select public.cast_technique_vote('post1', '{"stance": 50}')`, [], /closed/));
check('D31 종료 후 결과 보존 (작성자 조회)', (await as(OWNER, `select public.get_technique_evaluation_stats('post1') s`))[0].s.participants === 3);
check('D32 종료된 평가 다시 열기 불가', await fails(OWNER, `update public.technique_evaluations set closed_at = null where post_id = 'post1'`));
// block + private post
await as(STUDENT, `insert into public.technique_evaluations (post_id, author_id, martial_art, technique_name, criteria) values ('post2', $1, 'boxing', '훅', '{stance}')`, [STUDENT]);
await as(STUDENT, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [STUDENT, BUYER]);
check('D33 차단된 사용자는 투표 불가 (게시물 자체가 안 보임)', await fails(BUYER, `select public.cast_technique_vote('post2', '{"stance": 10}')`, [], /not visible|blocked/));
await as(STUDENT, `update public.community_posts set visibility = 'private' where id = 'post2'`);
check('D34 비공개 게시물: 통계·투표 모두 차단', (await as(VOTERS[4], `select public.get_technique_evaluation_stats('post2') s`))[0].s === null && (await fails(VOTERS[4], `select public.cast_technique_vote('post2', '{"stance": 10}')`)));
const sum = (await as(STRANGER, `select public.get_user_evaluation_summary($1) s`, [OWNER]))[0].s;
check('D35 프로필 요약: 결과 비공개 평가는 남에게 안 나옴', sum.evaluations === 0, sum);
check('D36 프로필 요약: 본인에게는 나옴', (await as(OWNER, `select public.get_user_evaluation_summary($1) s`, [OWNER]))[0].s.evaluations === 1);

// ================= E. 장비 중고거래 =================
console.log('\n[E] 장비 중고거래');
const [{ id: L1 }] = await as(OWNER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price) values ($1, '관장', '16oz 복싱 글러브', 'boxing_gloves', 'good', 50000) returning id`, [OWNER]);
check('E1 판매 완료 상태로 바로 등록 불가', await fails(OWNER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, status) values ($1, 'x', '글러브', 'other', 'good', 1, 'sold')`, [OWNER]));
check('E2 남의 상품 수정 불가', (await as(STRANGER, `update public.gear_listings set price = 1 where id = $1 returning 1`, [L1])).length === 0);
await as(STRANGER, `insert into public.gear_favorites (listing_id, user_id) values ($1, $2)`, [L1, STRANGER]);
check('E3 찜 수는 서버가 계산', (await as(OWNER, `select favorite_count from public.gear_listings where id = $1`, [L1]))[0].favorite_count === 1);
check('E4 판매자가 찜 수를 조작할 수 없음', await fails(OWNER, `update public.gear_listings set favorite_count = 999 where id = $1`, [L1]));
check('E5 문의하지 않은 사람을 구매자로 지정 불가', await fails(OWNER, `update public.gear_listings set status = 'sold', buyer_id = $2 where id = $1`, [L1, STRANGER]));
const conv = (await as(STRANGER, `select public.start_gear_inquiry($1) c`, [L1]))[0].c;
check('E6 문의 → 기존 DM 대화방 생성', !!conv && (await as(OWNER, `select 1 from public.conversation_members where conversation_id = $1`, [conv])).length === 2);
check('E7 본인 상품 문의 불가', await fails(OWNER, `select public.start_gear_inquiry($1)`, [L1]));
await as(STUDENT, `insert into public.user_blocks (blocker_id, blocked_id) values ($1, $2)`, [STUDENT, OWNER]).catch(() => null);
check('E8 차단 관계면 상품이 안 보이고 문의 불가', (await as(STUDENT, `select 1 from public.gear_listings where id = $1`, [L1])).length === 0 && (await fails(STUDENT, `select public.start_gear_inquiry($1)`, [L1])));
check('E9 DM 첨부에 장비 상품 허용', !(await fails(STRANGER, `insert into public.messages (conversation_id, sender_id, body, attachment) values ($1, $2, '문의합니다', '{"kind":"gear","id":"x","title":"글러브","price":50000}')`, [conv, STRANGER])));
check('E10 리뷰는 거래 전에 쓸 수 없음', await fails(STRANGER, `insert into public.gear_reviews (listing_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)`, [L1, STRANGER, OWNER]));
await as(OWNER, `update public.gear_listings set status = 'sold', buyer_id = $2 where id = $1`, [L1, STRANGER]);
check('E11 판매 완료 처리 (sold_at 자동)', !!(await as(OWNER, `select sold_at from public.gear_listings where id = $1`, [L1]))[0].sold_at);
check('E12 구매자 → 판매자 후기 가능', !(await fails(STRANGER, `insert into public.gear_reviews (listing_id, reviewer_id, reviewee_id, rating, body) values ($1, $2, $3, 5, '친절')`, [L1, STRANGER, OWNER])));
check('E13 거래 당사자가 아니면 후기 불가', await fails(BUYER, `insert into public.gear_reviews (listing_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 1)`, [L1, BUYER, OWNER]));
check('E14 판매 완료 상품은 새 문의 불가', await fails(BUYER, `select public.start_gear_inquiry($1)`, [L1]));
await as(STRANGER, `insert into public.user_reports (reporter_id, target_type, target_id, reason) values ($1, 'gear_listing', $2, '사기 의심')`, [STRANGER, L1]);
await as(ADMIN, `select public.moderate_gear_listing($1, true)`, [L1]);
check('E15 관리자가 내린 상품은 다른 사람에게 안 보임', (await as(BUYER, `select 1 from public.gear_listings where id = $1`, [L1])).length === 0);
check('E16 판매자는 관리 조치를 되돌릴 수 없음', await fails(OWNER, `update public.gear_listings set moderation = 'ok' where id = $1`, [L1]));
check('E17 이미지 버킷: 남의 폴더에 업로드 불가', await fails(STRANGER, `insert into storage.objects (bucket_id, name) values ('gear-media', $1)`, [`${OWNER}/a.png`]));
check('E18 이미지 버킷: 내 폴더 업로드 가능', !(await fails(STRANGER, `insert into storage.objects (bucket_id, name) values ('gear-media', $1)`, [`${STRANGER}/a.png`])));
const bucket = (await db.query(`select file_size_limit, allowed_mime_types from storage.buckets where id = 'gear-media'`)).rows[0];
check('E19 이미지 버킷 서버측 형식·크기 제한', bucket.file_size_limit === 8388608 && bucket.allowed_mime_types.includes('image/png') && !bucket.allowed_mime_types.some((m) => m.startsWith('video')), bucket);

// ================= F. 체육관 검색·제휴 =================
console.log('\n[F] 체육관 검색·가격·제휴');
check('F1 승인 상태로 바로 등록 불가', await fails(OWNER, `insert into public.gym_listings (owner_user_id, name, arts, address, region, status) values ($1, '체육관', '{boxing}', '서울시 강남구 1', '서울 강남구', 'approved')`, [OWNER]));
check('F2 남의 비공개 체육관(gyms) 연결 불가', await fails(STRANGER, `insert into public.gym_listings (owner_user_id, gym_id, name, arts, address, region) values ($1, 'gym1', '사칭', '{boxing}', '서울시 강남구 1', '서울 강남구')`, [STRANGER]));
const [{ id: G1 }] = await as(OWNER, `insert into public.gym_listings (owner_user_id, gym_id, name, arts, address, region) values ($1, 'gym1', '테스트 복싱', '{boxing,mma}', '서울시 강남구 1', '서울 강남구') returning id`, [OWNER]);
check('F3 승인 전에는 다른 사람에게 안 보임', (await as(STRANGER, `select 1 from public.gym_listings where id = $1`, [G1])).length === 0);
check('F4 등록자가 스스로 승인 불가', await fails(OWNER, `update public.gym_listings set status = 'approved' where id = $1`, [G1]));
await as(OWNER, `insert into public.gym_pricing (listing_id, monthly, three_month) values ($1, 150000, 400000)`, [G1]);
await as(ADMIN, `select public.review_gym_listing($1, 'approved', '사업자 확인')`, [G1]);
check('F5 승인 후 비로그인 사용자에게도 공개', (await as(null, `select name from public.gym_listings where id = $1`, [G1])).length === 1);
check('F6 가격은 미검증으로 공개 (최종 확인일 존재)', (await as(STRANGER, `select verified_at, owner_confirmed_at from public.gym_pricing where listing_id = $1`, [G1]))[0]?.verified_at === null);
check('F7 제휴 없이 할인 활성화 불가', await fails(OWNER, `insert into public.gym_offers (listing_id, title, plan, discount_type, discount_value, ends_at, status) values ($1, '신규 할인', 'monthly', 'amount', 30000, now() + interval '30 days', 'active')`, [G1]));
check('F8 제휴 신청 시 계약 조건을 스스로 넣을 수 없음', await fails(OWNER, `insert into public.gym_partnerships (listing_id, status) values ($1, 'active')`, [G1]));
await as(OWNER, `insert into public.gym_partnerships (listing_id, applicant_note) values ($1, '제휴 희망')`, [G1]);
check('F9 계약 정보 없이 제휴 활성화 불가', await fails(ADMIN, `select public.decide_gym_partnership($1, 'active')`, [G1]));
await as(ADMIN, `select public.decide_gym_partnership($1, 'active', 'CT-2026-001', 10, 50000, current_date, null, 'basic')`, [G1]);
check('F10 제휴 계약 조건은 외부인에게 비공개', (await as(STRANGER, `select 1 from public.gym_partnerships`)).length === 0 && (await as(STRANGER, `select public.is_active_gym_partner($1) p`, [G1]))[0].p === true);
const [{ id: O1 }] = await as(OWNER, `insert into public.gym_offers (listing_id, title, plan, discount_type, discount_value, max_redemptions, ends_at, status) values ($1, '신규 회원 월회비 할인', 'monthly', 'amount', 30000, 2, now() + interval '30 days', 'active') returning id`, [G1]);
check('F11 가격 미검증이면 쿠폰 발급 불가', await fails(BUYER, `select * from public.claim_gym_offer($1)`, [O1], /not verified/));
await as(ADMIN, `select public.verify_gym_pricing($1)`, [G1]);
const prices = (await as(BUYER, `select * from public.gym_offer_prices($1)`, [O1]))[0];
check('F12 할인가는 검증된 원래 가격에서 서버가 계산 (150,000 → 120,000)', prices.original_price === 150000 && prices.discounted_price === 120000 && prices.price_verified === true, prices);
check('F13 기존 회원은 신규 회원 할인 불가', await fails(STUDENT, `select * from public.claim_gym_offer($1)`, [O1]));
const cp = (await as(BUYER, `select * from public.claim_gym_offer($1)`, [O1]))[0];
check('F14 쿠폰 발급 (코드)', /^[0-9A-F]{4}-[0-9A-F]{4}$/.test(cp.code), cp);
check('F15 같은 할인 중복 발급 불가', await fails(BUYER, `select * from public.claim_gym_offer($1)`, [O1]));
await as(VOTERS[0], `select * from public.claim_gym_offer($1)`, [O1]);
check('F16 발급 인원 제한 (2명)', await fails(VOTERS[1], `select * from public.claim_gym_offer($1)`, [O1], /limit reached/));
check('F17 쿠폰을 사용자가 직접 수정 불가', (await as(BUYER, `update public.gym_coupons set status = 'redeemed' where user_id = $1 returning 1`, [BUYER]).catch(() => [])).length === 0);
check('F18 다른 체육관이 쿠폰 사용 처리 불가', await fails(STRANGER, `select public.redeem_gym_coupon($1)`, [cp.code]));
await as(OWNER, `select public.redeem_gym_coupon($1)`, [cp.code]);
check('F19 체육관이 사용 처리 → 사용자에게 등록 확인', (await as(BUYER, `select status from public.gym_coupons`))[0]?.status === 'redeemed');
await as(OWNER, `update public.gym_pricing set monthly = 160000 where listing_id = $1`, [G1]);
check('F20 가격을 바꾸면 검증 표시 자동 해제', (await as(STRANGER, `select verified_at from public.gym_pricing where listing_id = $1`, [G1]))[0].verified_at === null);
await as(OWNER, `update public.gym_offers set max_redemptions = 10 where id = $1`, [O1]);
check('F21 가격 재검증 전에는 새 쿠폰 발급 불가', await fails(VOTERS[2], `select * from public.claim_gym_offer($1)`, [O1], /not verified/));
await as(BUYER, `insert into public.gym_reviews (listing_id, user_id, rating, body) values ($1, $2, 5, '좋아요')`, [G1, BUYER]);
await as(VOTERS[3], `insert into public.gym_reviews (listing_id, user_id, rating, body) values ($1, $2, 4, '괜찮아요')`, [G1, VOTERS[3]]);
const rv = await as(null, `select user_id, verified_member from public.gym_reviews order by rating desc`);
check('F22 후기 "실제 회원" 표시는 서버 판정 (쿠폰 사용자만)', rv[0].verified_member === true && rv[1].verified_member === false, rv);
check('F23 체육관 주인은 자기 체육관 후기 불가', await fails(OWNER, `insert into public.gym_reviews (listing_id, user_id, rating) values ($1, $2, 5)`, [G1, OWNER]));
check('F24 후기의 실제 회원 표시를 스스로 바꿀 수 없음', (await as(VOTERS[3], `update public.gym_reviews set verified_member = true where user_id = $1 returning verified_member`, [VOTERS[3]]))[0].verified_member === false);
const lead = (await as(STRANGER, `select public.start_gym_inquiry($1) c`, [G1]))[0].c;
check('F25 등록 문의 → DM + 유입 기록', !!lead && (await as(OWNER, `select kind from public.gym_leads where listing_id = $1`, [G1])).length === 1);
await as(ADMIN, `select public.review_gym_listing($1, 'suspended', '민원')`, [G1]);
check('F26 정지되면 제휴 표시·할인 노출 중단', (await as(STRANGER, `select public.is_active_gym_partner($1) p`, [G1]))[0].p === false && (await as(STRANGER, `select 1 from public.gym_offers where listing_id = $1`, [G1])).length === 0);


// ================= G. 택배 거래 결제 (0059) =================
console.log('\n[G] 택배 거래 결제');
const svcFails = async (q, params, why) => { try { await asService(q, params); return false; } catch (e) { return why.test(e.message); } };
async function asService(q, params) {
  // the payment-verify Edge Function's service_role client (after Toss approved the payment)
  await db.exec(`reset role; select set_config('request.jwt.claim.sub', '', false); select set_config('request.jwt.claim.role', 'service_role', false); set role service_role;`);
  try {
    return (await db.query(q, params)).rows;
  } finally {
    await db.exec('reset role;');
  }
}
const [{ id: L2 }] = await as(STRANGER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available, shipping_fee) values ($1, '외부인', 'MMA 글러브', 'mma_gloves', 'good', 40000, true, 3500) returning id`, [STRANGER]);
const [{ id: L3 }] = await as(STRANGER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available, meetup_available) values ($1, '외부인', '직거래 전용', 'other', 'good', 10000, false, true) returning id`, [STRANGER]);
const ship = [`홍길동`, `010-1234-5678`, `서울시 강남구 테스트로 1`, `문 앞`];
check('G1 직거래 전용 상품은 택배 주문 불가', await fails(VOTERS[0], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L3, ...ship], /SHIPPING_NOT_AVAILABLE/));
check('G2 내 상품은 주문 불가', await fails(STRANGER, `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, ...ship], /OWN_LISTING/));
const [o1] = await as(VOTERS[0], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, ...ship]);
check('G3 주문 금액은 서버 계산 (40,000 + 배송비 3,500)', o1.amount === 43500 && o1.status === 'pending' && /^gear_[0-9a-f]{32}$/.test(o1.id), o1);
const [o1b] = await as(VOTERS[0], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, '홍길동', '010-1111-2222', '서울시 마포구 2', '']);
check('G4 같은 상품 재주문은 기존 미결제 주문 재사용', o1b.id === o1.id && o1b.recipient_phone === '010-1111-2222');
check('G5 주문 테이블 직접 수정 불가', (await as(VOTERS[0], `update public.gear_orders set amount = 100 where id = $1 returning 1`, [o1.id]).catch(() => [])).length === 0);
check('G6 구매자가 직접 결제 완료 처리 불가 (Edge Function 만)', await fails(VOTERS[0], `select * from public.finalize_gear_order($1, 'paid', null, 'pk_fake')`, [o1.id], /FORBIDDEN_DIRECT_PAID_TRANSITION/));
check('G7 판매자도 결제 완료 처리 불가', await fails(STRANGER, `select * from public.finalize_gear_order($1, 'paid', null, 'pk_fake')`, [o1.id], /FORBIDDEN/));
check('G8 배송지는 구매자·판매자만 (제3자 불가)', (await as(VOTERS[2], `select address from public.gear_orders where id = $1`, [o1.id])).length === 0 && (await as(STRANGER, `select address from public.gear_orders where id = $1`, [o1.id]))[0]?.address === '서울시 마포구 2');
const [o2] = await as(VOTERS[1], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, ...ship]);
await asService(`select * from public.finalize_gear_order($1, 'paid', null, 'pk_test_1')`, [o1.id]);
const after1 = (await as(STRANGER, `select status, buyer_id from public.gear_listings where id = $1`, [L2]))[0];
check('G9 결제 승인 → 주문 paid · 상품 판매 완료 · 구매자 지정', after1.status === 'sold' && after1.buyer_id === VOTERS[0]);
check('G10 같은 상품의 다른 미결제 주문은 자동 취소', (await as(VOTERS[1], `select status from public.gear_orders where id = $1`, [o2.id]))[0].status === 'cancelled');
check('G11 이미 팔린 상품의 다른 주문은 결제 확정 불가', await svcFails(`select * from public.finalize_gear_order($1, 'paid', null, 'pk_other')`, [o2.id], /ORDER_NOT_PENDING|LISTING_UNAVAILABLE/));
check('G12 같은 결제키 재확정은 멱등', (await asService(`select status from public.finalize_gear_order($1, 'paid', null, 'pk_test_1')`, [o1.id]))[0].status === 'paid');
check('G13 판매 완료 후 새 주문 불가', await fails(VOTERS[2], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, ...ship], /LISTING_UNAVAILABLE/));
check('G14 판매자가 결제된 상품을 판매 중으로 되돌릴 수 없음', await fails(STRANGER, `update public.gear_listings set status = 'active' where id = $1`, [L2], /paid order/));
check('G15 송장 없이 발송 처리 불가', await fails(STRANGER, `select public.mark_gear_order_shipped($1, '', '')`, [o1.id], /TRACKING_REQUIRED/));
check('G16 구매자는 발송 처리 불가', await fails(VOTERS[0], `select public.mark_gear_order_shipped($1, 'CJ대한통운', '123456789')`, [o1.id], /NOT_SHIPPABLE/));
check('G17 발송 전 수령 확인 불가', await fails(VOTERS[0], `select public.confirm_gear_order_received($1)`, [o1.id], /NOT_RECEIVABLE/));
// refund before shipping (service role after Toss cancel)
await asService(`select * from public.finalize_gear_order($1, 'refunded', '구매자 요청', null)`, [o1.id]);
const afterRefund = (await as(STRANGER, `select status, buyer_id from public.gear_listings where id = $1`, [L2]))[0];
check('G18 발송 전 환불 → 주문 refunded · 상품 다시 판매 중', (await as(VOTERS[0], `select status from public.gear_orders where id = $1`, [o1.id]))[0].status === 'refunded' && afterRefund.status === 'active' && afterRefund.buyer_id === null, afterRefund);
check('G19 구매자는 직접 환불 처리 불가', await fails(VOTERS[0], `select * from public.finalize_gear_order($1, 'refunded', null, null)`, [o1.id], /FORBIDDEN/));
// second purchase → ship → receive
const [o3] = await as(VOTERS[2], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L2, ...ship]);
await asService(`select * from public.finalize_gear_order($1, 'paid', null, 'pk_test_2')`, [o3.id]);
const [{ id: L5 }] = await as(STRANGER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available) values ($1, '외부인', '정강이 보호대', 'shin_guards', 'good', 15000, true) returning id`, [STRANGER]);
const [o5] = await as(VOTERS[4], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L5, ...ship]);
check('G20 다른 주문에 같은 결제키 재사용 불가 (재생 공격 방지)', await svcFails(`select * from public.finalize_gear_order($1, 'paid', null, 'pk_test_2')`, [o5.id], /duplicate key|unique/));
await as(STRANGER, `select public.mark_gear_order_shipped($1, 'CJ대한통운', '1234-5678-9012')`, [o3.id]);
check('G21 판매자 발송 처리 (택배사·송장)', (await as(VOTERS[2], `select status, tracking_number from public.gear_orders where id = $1`, [o3.id]))[0].tracking_number === '1234-5678-9012');
check('G22 발송 후에는 환불 확정 불가 (분쟁은 별도 처리)', await svcFails(`select * from public.finalize_gear_order($1, 'refunded', null, null)`, [o3.id], /NOT_REFUNDABLE/));
await as(VOTERS[2], `select public.confirm_gear_order_received($1)`, [o3.id]);
check('G23 구매자 수령 확인 → 거래 완료', (await as(STRANGER, `select status from public.gear_orders where id = $1`, [o3.id]))[0].status === 'delivered');
check('G24 거래 완료 후 구매자 후기 가능', !(await fails(VOTERS[2], `insert into public.gear_reviews (listing_id, reviewer_id, reviewee_id, rating) values ($1, $2, $3, 5)`, [L2, VOTERS[2], STRANGER])));
const [{ id: L4 }] = await as(STRANGER, `insert into public.gear_listings (seller_id, seller_nickname, title, category, condition, price, shipping_available) values ($1, '외부인', '헤드기어', 'headgear', 'good', 20000, true) returning id`, [STRANGER]);
const [o4] = await as(VOTERS[3], `select * from public.create_gear_order($1, $2, $3, $4, $5)`, [L4, ...ship]);
await as(VOTERS[3], `select * from public.finalize_gear_order($1, 'cancelled', '결제창 닫음', null)`, [o4.id]);
check('G25 구매자 결제 취소 → cancelled (상품은 그대로 판매 중)', (await as(VOTERS[3], `select status from public.gear_orders where id = $1`, [o4.id]))[0].status === 'cancelled');
check('G26 남의 주문은 취소 불가', await fails(VOTERS[4], `select * from public.finalize_gear_order($1, 'cancelled', null, null)`, [o4.id], /NOT_YOUR_ORDER|ORDER_NOT_PENDING/));

const bad = results.filter((p) => !p).length;
console.log(`\n${results.length - bad}/${results.length} passed`);
process.exit(bad ? 1 : 0);
