// LIVE check (real Gemini via the existing gemini-ask Edge Function — no new API):
// the same AI-coach lesson explanation with and without a fighter profile, for the 4
// required scenarios, plus 3 real interview turns. ~11 AI calls.
//   ADMIN_ID=... ADMIN_PASSWORD=... node .devtools/live-fighter-profile-coach.mjs
// The password is read from the environment only — never written anywhere. No Electron.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const { ADMIN_ID: id, ADMIN_PASSWORD: password } = process.env;
if (!id || !password) {
  console.log('NOT TESTED — ADMIN_ID / ADMIN_PASSWORD required');
  process.exit(2);
}
const store = new Map();
globalThis.window = globalThis;
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const { supabase } = await server.ssrLoadModule('/src/lib/supabase/client.ts');
const auth = await server.ssrLoadModule('/src/lib/auth/authService.ts');
const S = await server.ssrLoadModule('/src/lib/fighterProfile/store.ts');
const I = await server.ssrLoadModule('/src/lib/fighterProfile/interview.ts');
const P = await server.ssrLoadModule('/src/lib/ai/provider.ts');
const DAY = await server.ssrLoadModule('/src/lib/aiCoachDay/service.ts');
const LD = await server.ssrLoadModule('/src/lib/loadData.ts');
const GJ = await server.ssrLoadModule('/src/lib/fighterStyle/geminiJson.ts');

const results = [];
const report = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 300) : '')));
let calls = 0;
const realAsk = P.aiProvider.ask.bind(P.aiProvider);
const sent = [];
P.aiProvider.ask = async (req) => {
  calls++;
  sent.push(req);
  return realAsk(req);
};
const build = (entries) => {
  let x = S.emptyProfile();
  for (const [k, v, extra] of entries) x = S.withItem(x, k, { value: v, ...(extra ?? {}) }, 'user').profile;
  return x;
};
try {
  const si = await supabase.auth.signInWithPassword({ email: auth.loginEmailFor(id), password });
  if (si.error) throw new Error(`signIn: ${si.error.message}`);
  const tech = (art, re) => LD.getTechniquesByMartialArt(art).find((t) => re.test(t.name));
  const scenarios = [
    { name: '복싱 · 사우스포 + 스탠스 전환 자주', t: tech('boxing', /^jab$/i), p: build([['train.arts', ['boxing']], ['body.stance', 'southpaw'], ['body.stanceSwitch', 'often'], ['body.switchPurpose', ['angle', 'confuse']], ['box.favoritePunches', ['jab', 'straight']], ['box.preferredRange', 'long']]), expect: /사우스포|오른손|오른발|스탠스/, invented: /\d+\s?cm/ },
    { name: '킥복싱 · 앞발 킥 자주', t: tech('kickboxing', /round kick|body kick|roundhouse/i), p: build([['train.arts', ['kickboxing']], ['body.stance', 'orthodox'], ['kick.favorite', ['leadRound', 'teep']], ['kick.switchKick', 'often']]), expect: /앞발|스위치|티프|프론트/, invented: /\d+\s?cm/ },
    { name: '레슬링 · 상대 오른다리 싱글렉', t: tech('wrestling', /single/i), p: build([['train.arts', ['wrestling']], ['wr.single', 'favorite'], ['wr.direction', 'oppRight'], ['wr.finish', 'runPipe']]), expect: /오른다리|오른쪽 다리|런 더 파이프|파이프/, invented: /\d+\s?cm/ },
    { name: '주짓수 · 하프가드 바텀에서 전환 선호', t: LD.getTechniquesByMartialArt('bjj').find((t) => /half/i.test(`${t.name} ${t.category}`)), p: build([['train.arts', ['bjj']], ['bjj.topBottom', 'bottom'], ['pos.uncomfortable', ['halfBottom']], ['pos.halfBottom.exit', 'transition'], ['pos.halfBottom.mistakes', '언더훅을 늦게 잡는다']]), expect: /하프|전환|언더훅/, invented: /\d+\s?cm/ },
  ];
  for (const sc of scenarios) {
    if (!sc.t) {
      check(`[${sc.name}] 기술 찾기`, false);
      continue;
    }
    S.replaceProfile(S.emptyProfile());
    sent.length = 0;
    const plain = await DAY.explainTechnique(sc.t, `Day 1 · ${sc.t.name}`, '');
    S.replaceProfile(sc.p);
    sent.length = 0;
    const personal = await DAY.explainTechnique(sc.t, `Day 1 · ${sc.t.name}`, '');
    const req = sent[0];
    report.push({ scenario: sc.name, technique: sc.t.name, withoutProfile: plain.text, withProfile: personal.text, profileBlock: req?.contextText.split('[개인 파이터 프로필')[1]?.slice(0, 900) ?? null });
    check(`[${sc.name}] 실제 요청에 프로필 포함`, !!req?.contextText.includes('[개인 파이터 프로필'));
    check(`[${sc.name}] 두 응답 모두 AI가 생성`, plain.fromAi && personal.fromAi, { plain: plain.fromAi, personal: personal.fromAi });
    check(`[${sc.name}] 프로필 반영 시 수업 내용이 달라짐`, plain.text !== personal.text && sc.expect.test(personal.text), personal.text.slice(0, 220));
    check(`[${sc.name}] 프로필에 없는 수치(사거리 cm)를 지어내지 않음`, !sc.invented.test(personal.text), personal.text.match(sc.invented)?.[0] ?? '');
  }
  // real interview turns (Gemini reads the answer, the app validates)
  const askJson = (p) => GJ.askGeminiForJson(p);
  let p = I.startInterview(S.emptyProfile());
  p = (await I.answerInterview(p, '복싱 2년 했고 요즘 주짓수도 시작했어', { askJson })).profile;
  check('[인터뷰 LIVE] 자유 답변 → 종목 저장', JSON.stringify(S.liveItem(p, 'train.arts')?.value ?? []).includes('boxing'), S.liveItem(p, 'train.arts')?.value);
  check('[인터뷰 LIVE] 기간 언급은 확인 전 제안으로만 (자동 저장 안 함)', !S.liveItem(p, 'train.years') || S.liveItem(p, 'train.years').status === 'confirmed', p.interview.pending);
  const q2 = p.interview.messages.at(-1).text;
  p = (await I.answerInterview(p, '복싱은 2년, 주짓수는 3개월', { askJson })).profile;
  p = (await I.answerInterview(p, '일주일에 세 번 정도', { askJson })).profile;
  check('[인터뷰 LIVE] 숫자 답변 (주 3회)', S.liveItem(p, 'train.frequency')?.value === 3, S.liveItem(p, 'train.frequency'));
  report.push({ interview: p.interview.messages.map((m) => `${m.role === 'coach' ? '코치' : '사용자'}: ${m.text}`), secondQuestion: q2 });
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await supabase.auth.signOut().catch(() => {});
  await server.close();
}
const out = path.join(APP, 'data/audit/fighter-profile-live-check.json');
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), aiCalls: calls, report }, null, 1) + '\n');
const failed = results.filter((x) => !x).length;
console.log(`\nAI 호출 ${calls}회 · ${results.length - failed}/${results.length} passed · ${path.relative(APP, out)}`);
process.exit(failed ? 1 : 0);
