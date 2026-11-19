// payment-webhook 의 순수 로직(서명 검증·주문 종류·상태 매핑)을 Node 에서 검증한다. 네트워크·Toss 호출 없음.
//   node .devtools/test-payment-webhook.mjs
// 실제 Toss 웹훅 수신(배포 + HTTPS 공개 URL + 보안 키)은 이 테스트로 확인되지 않는다.
import { build } from 'esbuild';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'webhook-')), 'v.mjs');
await build({ entryPoints: [path.join(APP, 'supabase/functions/payment-webhook/verify.ts')], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error' });
const V = await import(pathToFileURL(out).href);
const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d) : '')));

const key = 'test-security-key';
const body = JSON.stringify({ eventType: 'PAYMENT_STATUS_CHANGED', createdAt: '2026-11-16T10:00:00.000000', data: { paymentKey: 'pk_1', orderId: 'coin_abc', status: 'DONE' } });
const time = '2026-11-16T10:00:01.000+09:00';
const sig = (b, t, k) => 'v1:' + createHmac('sha256', k).update(`${b}:${t}`).digest('base64');

check('올바른 서명 → 통과', await V.verifyTossSignature(body, time, sig(body, time, key), key));
check('서명 여러 개 중 하나만 맞아도 통과', await V.verifyTossSignature(body, time, `v1:AAAA,${sig(body, time, key)}`, key));
check('본문이 바뀌면 실패', !(await V.verifyTossSignature(body.replace('DONE', 'CANCELED'), time, sig(body, time, key), key)));
check('전송 시각이 바뀌면 실패', !(await V.verifyTossSignature(body, '2026-11-16T10:00:02.000+09:00', sig(body, time, key), key)));
check('다른 키로 만든 서명 실패', !(await V.verifyTossSignature(body, time, sig(body, time, 'other'), key)));
check('v1: 접두어 없는 서명 실패', !(await V.verifyTossSignature(body, time, sig(body, time, key).slice(3), key)));
check('헤더 없음 → 실패', !(await V.verifyTossSignature(body, null, null, key)));
check('주문 종류: sub_/coin_/gear_/uuid', V.orderKind('sub_x') === 'subscription' && V.orderKind('coin_x') === 'coin' && V.orderKind('gear_x') === 'gear'
  && V.orderKind('0b8f1c2e-1111-2222-3333-444455556666') === 'curriculum' && V.orderKind('evil') === 'unknown');
check('상태 매핑: DONE→paid, CANCELED→refunded, 나머지는 자동 처리 안 함', V.targetStatus('DONE') === 'paid' && V.targetStatus('CANCELED') === 'refunded'
  && V.targetStatus('PARTIAL_CANCELED') === null && V.targetStatus('WAITING_FOR_DEPOSIT') === null && V.targetStatus('EXPIRED') === null);
const src = fs.readFileSync(path.join(APP, 'supabase/functions/payment-webhook/index.ts'), 'utf8');
check('본문만으로 처리하지 않음: Toss 결제 조회로 재검증 + 금액 대조', /api\.tosspayments\.com\/v1\/payments\//.test(src) && /totalAmount !== order\.amount_krw/.test(src));
check('PAYMENT_SECRET_KEY 없으면 변경 없이 503', /if \(!secretKey \|\| !supabaseUrl \|\| !serviceRoleKey\) return fail\(503/.test(src));

const failed = results.filter((p) => !p).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
