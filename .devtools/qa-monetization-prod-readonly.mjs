// 운영 DB 읽기 전용 점검 (수익화 0061–0064). 모든 검사는 BEGIN … ROLLBACK 안에서 실행된다.
// 쓰기를 "시도"하는 검사는 잠금·권한 때문에 실패해야 정상인 것뿐이며, 성공하더라도 롤백된다.
// 시퀀스를 소모하는 경로(원장 기록 등)는 호출하지 않는다. 비밀키·이메일 전체는 출력하지 않는다.
//   node .devtools/qa-monetization-prod-readonly.mjs        (supabase CLI 가 운영 프로젝트에 link 돼 있어야 함)
import { execFileSync } from 'node:child_process';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const RANDOM_USER = '00000000-0000-4000-8000-00000000abcd'; // 존재하지 않는 일반 사용자
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));

function q(sql, { as } = {}) {
  const pre = as ? `set local role authenticated; select set_config('request.jwt.claims', '{"sub":"${as}","role":"authenticated"}', true); select set_config('request.jwt.claim.sub', '${as}', true);` : '';
  const out = execFileSync('supabase', ['db', 'query', '--linked', '-o', 'json', `begin; ${pre} ${sql}; rollback;`], { cwd: APP, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  const j = JSON.parse(out.slice(out.indexOf('{')));
  if (j.error || j._tag === 'Error') throw new Error(JSON.stringify(j.error ?? j).slice(0, 300));
  return j.rows ?? [];
}
function err(sql, opts) {
  try {
    q(sql, opts);
    return 'NO_ERROR';
  } catch (e) {
    return e.message;
  }
}
const ids = Object.fromEntries(q(`select p.label, p.user_id::text id from public.privileged_accounts p`).map((r) => [r.label, r.id]));

console.log('\n## 1. 결제 잠금 (DB 제약 — 서버에서 강제)');
const cfg = q(`select live_payments_enabled l, cash_payout_enabled c, minor_paid_enabled m from public.monetization_config`)[0];
check('현재 설정: 실결제·현금지급·미성년 유료결제 모두 꺼짐', cfg.l === false && cfg.c === false && cfg.m === false, cfg);
for (const [col, con] of [['live_payments_enabled', 'monetization_live_payments_locked'], ['cash_payout_enabled', 'monetization_cash_payout_locked'], ['minor_paid_enabled', 'monetization_minor_paid_locked']]) {
  const e = err(`update public.monetization_config set ${col} = true`);
  check(`최고 권한(postgres)으로도 ${col}=true 불가 (${con})`, e.includes(con), e.slice(0, 120));
}
check('정산 모드는 simulation 만 (CHECK 존재)', q(`select count(*)::int n from pg_constraint where conrelid = 'public.settlement_requests'::regclass and pg_get_constraintdef(oid) like '%simulation%'`)[0].n === 1);
check('관리자 설정 RPC 도 잠금 거부 (운영자 계정으로 호출)', err(`select public.admin_update_monetization_config('{"live_payments_enabled":true}'::jsonb)`, { as: ids.operator }).includes('LOCKED_BY_POLICY'));

console.log('\n## 2. 운영 계정');
check('특권 계정 2개 (operator·developer)', !!ids.operator && !!ids.developer);
const adm = q(`select public.is_platform_admin('${ids.operator}') a, public.is_platform_admin('${ids.developer}') b, public.is_platform_admin('${RANDOM_USER}') c`)[0];
check('두 계정 플랫폼 관리자 / 일반 사용자 아님', adm.a === true && adm.b === true && adm.c === false, adm);
const domains = q(`select split_part(u.email, '@', 2) d, p.label from public.privileged_accounts p join auth.users u on u.id = p.user_id order by p.label`);
check('지정된 계정의 도메인: developer=gmail.com, operator=martialdex.local', domains.find((r) => r.label === 'developer')?.d === 'gmail.com' && domains.find((r) => r.label === 'operator')?.d === 'martialdex.local');
const ent = q(`select public.has_entitlement('${ids.developer}', 'gym_business_reports') d, public.has_entitlement('${ids.operator}', 'coach_advanced') o, public.has_entitlement('${RANDOM_USER}', 'coach_advanced') u, public.has_entitlement('${RANDOM_USER}', 'encyclopedia') f`)[0];
check('특권 계정은 모든 유료 기능, 일반 사용자는 무료 기능만', ent.d && ent.o && ent.u === false && ent.f === true, ent);
const mm = q(`select public.my_membership() m`, { as: RANDOM_USER })[0].m;
check('일반 사용자 my_membership: privileged=false, is_admin=false, FREE', mm.privileged === false && mm.is_admin === false && mm.plan_id === 'free', mm);
const mmDev = q(`select public.my_membership() m`, { as: ids.developer })[0].m;
check('개발자 계정 my_membership: privileged=true, is_admin=true', mmDev.privileged === true && mmDev.is_admin === true);
check('일반 사용자에게 특권 계정 목록 비공개', q(`select count(*)::int n from public.privileged_accounts`, { as: RANDOM_USER })[0].n === 0);
check('일반 사용자에게 관리자 목록 비공개', q(`select count(*)::int n from public.platform_admins`, { as: RANDOM_USER })[0].n === 0);

console.log('\n## 3. 관리자 권한 제한 (일반 사용자로 호출 → FORBIDDEN, 쓰기 전 거부)');
for (const [name, sql] of [
  ['수익 분석', `select public.admin_revenue_overview()`],
  ['원장 무결성', `select * from public.wallet_integrity_report()`],
  ['설정 변경', `select public.admin_update_monetization_config('{"gear_fee_bp":1}'::jsonb)`],
  ['요금제 변경', `select public.admin_upsert_plan('{"id":"pro","price_monthly_krw":1}'::jsonb)`],
  ['코인 지급', `select public.admin_grant_coins('${RANDOM_USER}', 100, 'event_reward', 'x', 'y')`],
  ['지갑 보정', `select public.admin_adjust_wallet('${RANDOM_USER}', 100, '테스트 보정')`],
  ['정산 결정', `select public.admin_decide_settlement(gen_random_uuid(), 'approved')`],
  ['콘텐츠 검수', `select public.admin_review_product(gen_random_uuid(), 'approved')`],
  ['창작자 심사', `select public.admin_review_creator('${RANDOM_USER}', 'approved')`],
  ['구독 만료 처리', `select public.expire_due_subscriptions()`],
]) check(`일반 사용자 ${name} 거부`, /FORBIDDEN/.test(err(sql, { as: RANDOM_USER })));

console.log('\n## 4. 돈이 걸린 상태 전이 · 직접 쓰기');
check('일반 사용자가 구독 결제 paid 처리 불가', /FORBIDDEN_DIRECT_PAID_TRANSITION|ORDER_NOT_FOUND/.test(err(`select public.finalize_subscription_payment('sub_x', 'paid', 'k')`, { as: RANDOM_USER })));
check('일반 사용자가 코인 주문 paid 처리 불가', /FORBIDDEN_DIRECT_PAID_TRANSITION|ORDER_NOT_FOUND/.test(err(`select public.finalize_coin_order('coin_x', 'paid', 'k')`, { as: RANDOM_USER })));
check('원장 기록 함수(post_ledger) 클라이언트 호출 불가', /permission denied/.test(err(`select public.post_ledger('${RANDOM_USER}', 'test', 100, null, null, 'probe-key-1')`, { as: RANDOM_USER })));
const priv = q(`select t, has_table_privilege('authenticated', 'public.' || t, 'INSERT') i, has_table_privilege('authenticated', 'public.' || t, 'UPDATE') u, has_table_privilege('authenticated', 'public.' || t, 'DELETE') d, has_table_privilege('anon', 'public.' || t, 'SELECT') a
  from unnest(array['wallets','wallet_ledger','coin_orders','subscription_payments','user_subscriptions','content_purchases','creator_earnings','settlement_requests','privileged_accounts','monetization_config','membership_plans','coin_packages','creator_product_content']) t`);
const writable = priv.filter((r) => r.i || r.u || r.d).map((r) => r.t);
check('돈·권한 테이블 13종: 로그인 사용자 INSERT/UPDATE/DELETE 권한 없음', writable.length === 0, writable);
const anonRead = priv.filter((r) => r.a).map((r) => r.t).sort();
check('비로그인 SELECT 허용은 공개 테이블만 (설정·요금제·코인상품)', JSON.stringify(anonRead) === JSON.stringify(['coin_packages', 'membership_plans', 'monetization_config']), anonRead);
check('원장 UPDATE/DELETE 차단 트리거 (최고 권한도)', err(`update public.wallet_ledger set amount = amount`).includes('LEDGER_IMMUTABLE') || q(`select count(*)::int n from public.wallet_ledger`)[0].n === 0);
check('원장 불변 트리거 활성', q(`select tgenabled e from pg_trigger where tgname = 'wallet_ledger_no_update'`)[0]?.e === 'O');

console.log('\n## 5. RLS (정책·활성화)');
const rlsOff = q(`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  and c.relname in ('monetization_config','privileged_accounts','membership_plans','user_subscriptions','subscription_payments','wallets','wallet_ledger','coin_packages','coin_orders','creator_profiles','commission_rules','creator_products','creator_product_content','content_purchases','settlement_requests','creator_earnings','product_reviews','content_reports','gear_order_disputes','partner_campaigns','partner_contracts')`);
check('신규 21개 테이블 RLS 전부 켜짐', rlsOff.length === 0, rlsOff);
const pol = q(`select tablename, qual from pg_policies where schemaname = 'public' and tablename in ('wallets','wallet_ledger','coin_orders','subscription_payments','content_purchases','creator_earnings','settlement_requests')`);
check('개인 돈 테이블 7종 SELECT 정책 = 본인(+관리자)만', pol.length >= 7 && pol.every((p) => /auth\.uid\(\)/.test(p.qual)), pol.map((p) => p.tablename));
check('본문(creator_product_content)은 구매권한 함수로만', /owns_product_access/.test(q(`select qual from pg_policies where tablename = 'creator_product_content'`)[0]?.qual ?? ''));
check('일반 사용자: 남의 지갑·원장·구매 0건 조회', ['wallets', 'wallet_ledger', 'content_purchases', 'coin_orders', 'subscription_payments'].every((t) => q(`select count(*)::int n from public.${t} where user_id is distinct from '${RANDOM_USER}'`.replace('content_purchases where user_id', 'content_purchases where buyer_id'), { as: RANDOM_USER })[0].n === 0));

console.log('\n## 6. 운영 데이터 현황 (변경 없음 확인용)');
const counts = q(`select (select count(*) from public.wallets)::int w, (select count(*) from public.wallet_ledger)::int l, (select count(*) from public.coin_orders)::int co, (select count(*) from public.subscription_payments)::int sp, (select count(*) from public.content_purchases)::int cp, (select count(*) from public.creator_products)::int pr`)[0];
console.log('   ', JSON.stringify(counts));

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
