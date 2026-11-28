// TACTICAL FINDER 2차 — SETUP & COMBO FINDER (앱 DB 전체 검색) + WEB SEARCH (mocked Gemini) checks.
//   node .devtools/test-tactical-finder-2.mjs        (writes data/audit/tactical-finder-2-test.json)
// No browser, no network, no real AI call: localStorage is an in-memory Map holding only the [TEST] fixture below
// (never the user's data), and the web search gets a mock `ask` that returns canned Gemini-shaped answers.
// A case passes only if every expectation holds.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };

const OWNER = 'test-owner-0001';
const OTHER = 'test-other-9999';
const now = '2026-11-28T00:00:00.000Z';
const combo = (id, name, ids, extra = {}) => ({ id, userId: null, name: `[TEST] ${name}`, description: extra.description ?? '', techniqueIds: ids, createdAt: now, updatedAt: now, ...extra.meta });
const tactic = (id, name, situation, ids, userId = null) => ({ id, userId, name: `[TEST] ${name}`, situation, techniqueIds: ids, feedback: null, feedbackGeneratedAt: null, createdAt: now, updatedAt: now });
const setupMeta = (purpose) => ({ visualMittMeta: { createdAt: now, stance: 'orthodox', type: 'setup', purpose } });

// ---- fixture: every name starts with [TEST]; keys are short for the expectations
const COMBOS = [
  combo('C1', '원투 훅', ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__lead-hook']),
  combo('C2', '크로스 훅', ['kickboxing__cross', 'kickboxing__lead-hook']),
  combo('C3', '바디 훅 → 헤드 훅', ['boxing__body-hook', 'kickboxing__lead-hook']),
  combo('C4', '헤드 훅 → 바디 훅', ['kickboxing__lead-hook', 'boxing__body-hook']),
  combo('C5', '원투 로우킥', ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__low-kick']),
  combo('C6', '잽 더블렉', ['kickboxing__jab', 'wrestling__basic-double-leg'], { description: '타격으로 시선을 위로 올리고 더블렉' }),
  combo('C7', '암바 트라이앵글 체인', ['bjj__armbar', 'bjj__triangle-choke']),
  combo('C8', '스프롤 프론트 헤드락', ['wrestling__sprawl-to-front-headlock', 'wrestling__front-headlock'], { description: '상대 태클을 스프롤로 막고 프론트 헤드락' }),
  combo('C9', '바디킥 마무리', ['kickboxing__jab', 'kickboxing__body-kick']),
  combo('S2', '원투 레벨 체인지 더블렉', ['kickboxing__jab', 'kickboxing__cross', 'mixed-martial-arts__level-change-double-leg'], { meta: setupMeta('테이크다운 진입') }),
  combo('S4', '바디 잽으로 가드 내리기', ['boxing__body-jab', 'kickboxing__lead-hook'], { meta: setupMeta('상대 가드를 여는 셋업 — 몸통을 먼저 쳐서 가드를 내리게 한다') }),
  combo('S7', '페인트 로우킥', ['boxing__feint', 'kickboxing__low-kick'], { meta: setupMeta('페인트로 반응을 끌어낸 뒤 로우킥') }),
  combo('X1', '1스텝', ['kickboxing__teep']),
  // marked as another account's record — must never be searched
  { ...combo('O1', '다른 계정 더블렉', ['kickboxing__jab', 'wrestling__basic-double-leg']), userId: OTHER },
];
const TACTICS = [
  tactic('S1', '잽 페인트 더블렉', '상대가 잽에 가드를 올릴 때 레벨 체인지로 더블렉 진입', ['kickboxing__jab', 'wrestling__basic-double-leg']),
  tactic('S3', '오버핸드 싱글렉', '오버핸드를 던져 상대가 막는 순간 싱글렉', ['mixed-martial-arts__overhand', 'sambo__single-leg']),
  tactic('S5', '클린치 진입', '칼라 타이로 클린치를 잡고 니킥', ['kickboxing__jab', 'wrestling__collar-tie', 'kickboxing__collar-tie-short-knee']),
  tactic('S6', '압박으로 후퇴 유도', '상대를 압박해서 뒤로 물러나게 만든다', ['kickboxing__jab', 'kickboxing__low-kick', 'kickboxing__cross']),
  tactic('O2', '다른 계정 클린치', '클린치 진입', ['wrestling__collar-tie', 'kickboxing__collar-tie-short-knee'], OTHER),
];
const ALL_KEYS = [...COMBOS, ...TACTICS].map((x) => x.id);

function loadFixture() {
  store.clear();
  store.set('mdx:last-auth-user-id', OWNER);
  store.set('martialdex:combos', JSON.stringify(COMBOS));
  store.set('martialdex:tactics', JSON.stringify(TACTICS));
}

// must: in MY SETUPS / MY COMBOS (tier 1–3) · tier1: tier 1 · never: not in MY SETUPS / MY COMBOS (may be 관련 항목)
// none: MY sections empty + the exact no-result sentence
const G = [
  { g: '더블렉 셋업', must: ['S1', 'S2', 'C6'], tier1: ['S1', 'C6'], never: ['C7', 'C2', 'C3', 'C4'], qs: ['더블렉을 위한 셋업', '더블렉 셋업', '더블 렉 들어가는 셋업', 'Double Leg setup', 'double leg 셋업', '더블랙 셋업', '더블렉 진입을 위한 셋업', '레벨 체인지로 더블렉 들어가기', '더블렉 테이크다운 셋업 알려줘', 'setup for double leg', '더블렉 넣기 위한 셋업', '더블렉으로 끝나는 셋업'] },
  { g: '잽 이후 콤보', must: ['C1', 'C5'], tier1: ['C1', 'C5'], never: ['C2', 'C7', 'C4', 'C3'], qs: ['잽 이후 연결할 수 있는 콤보', '잽 다음 콤보', '잽 후에 이어지는 콤비네이션', 'jab 이후 콤보', 'combo after the jab', '잽으로 시작하는 콤보', '잽 뒤에 연결 콤보', '잽이후 콤보', '쨉 이후 콤보', '잽 부터 시작하는 연타', 'jab then combo', '잽 다음에 뭐 이어'] },
  { g: '가드 여는 셋업', must: ['S4'], tier1: [], never: ['C7', 'C8'], qs: ['상대 가드를 여는 셋업', '가드를 깨는 셋업', '가드 브레이크 셋업', '하이가드 상대 가드 열기', '가드 무너뜨리는 셋업', '가드 뚫는 셋업', '가드를 내리게 만드는 셋업', '단단한 가드를 여는 셋업'] },
  { g: '바디→헤드', must: ['C3'], tier1: ['C3'], never: ['C7', 'C8'], notTier1: ['C4'], qs: ['바디 공격 이후 헤드 공격으로 이어지는 콤보', '몸통 공격 후 얼굴 공격 콤보', '바디 다음 헤드 콤보', '바디 후 머리 공격', 'body then head combo', '바디 치고 다음 헤드 콤보', '몸통 이후 턱 공격', 'body to head combination'] },
  { g: '헤드→바디', must: ['C4'], tier1: ['C4'], never: ['C7'], notTier1: ['C3'], qs: ['헤드 공격 이후 바디로 이어지는 콤보', '얼굴 공격 후 몸통 공격 콤보', 'head then body combo'] },
  { g: '클린치 진입', must: ['S5'], tier1: [], never: ['C7', 'C3', 'C1'], qs: ['클린치 진입을 위한 셋업', '클린치로 들어가는 셋업', '칼라 타이 잡는 셋업', 'clinch entry setup', '클린치 셋업', '클린치 잡기 위한 셋업', '클린치 들어가기', '클린치 진입 방법'] },
  { g: '후퇴 유도', must: ['S6'], tier1: [], never: ['C7', 'C8'], qs: ['상대의 후퇴를 유도하는 셋업', '상대를 뒤로 물러나게 만드는 셋업', '압박해서 뒤로 빠지게 만들기', '후퇴 유도 셋업', '상대를 뒤로 물러나게 하는 압박'] },
  { g: '테이크다운', must: ['S1', 'S2', 'S3', 'C6'], tier1: [], never: ['C7', 'C1', 'C3'], qs: ['테이크다운을 위한 셋업', '테이크다운 진입 셋업', 'takedown setup', '테이크다운 들어가는 셋업', '테이크 다운 셋업', '태클 들어가는 셋업'] },
  { g: '싱글렉', must: ['S3'], tier1: ['S3'], never: ['C7', 'C1'], qs: ['싱글렉을 위한 셋업', 'single leg setup', '싱글 렉 셋업', '싱글렉으로 끝나는 셋업'] },
  { g: '로우킥 마무리', must: ['C5'], tier1: ['C5', 'S7'], never: ['C7', 'C3'], qs: ['로우킥으로 끝나는 콤보', '로우킥 마무리 콤보', 'low kick finish combo', '로우킥으로 마무리하는 연타', '로우킥 넣기 위한 셋업'] },
  { g: '바디킥', must: ['C9'], tier1: ['C9'], never: ['C7'], qs: ['바디킥으로 끝나는 콤보', '바디킥을 위한 셋업', 'body kick setup'] },
  { g: '서브미션 마무리·시작', must: ['C7'], tier1: ['C7'], never: ['C1', 'C5', 'S4'], qs: ['트라이앵글로 끝나는 콤보', '암바 이후 연결', '트라이앵글 초크 셋업', '암바로 시작하는 콤보'] },
  // C7 = 암바 → 트라이앵글: armbar is its FIRST step, so "암바를 위한(=암바로 끝나는) 셋업" is a strong but not direct match
  { g: '서브미션 위치 불일치', must: ['C7'], tier1: [], notTier1: ['C7'], never: ['C1', 'C5', 'S4'], qs: ['암바를 위한 셋업', 'armbar setup', '암바로 끝나는 셋업'] },
  { g: '스프롤', must: ['C8'], tier1: ['C8'], never: ['C7', 'C1'], qs: ['스프롤 이후 연결할 콤보', '스프롤 다음 연결', '프론트 헤드락으로 끝나는 콤보', '프론트 헤드락 셋업'] },
  { g: '페인트', must: ['S7'], tier1: [], never: ['C7'], qs: ['페인트로 반응을 끌어내는 셋업', '페인트 셋업', 'feint setup', '속임 동작으로 들어가는 셋업'] },
  { g: '클린치 니', must: ['S5'], tier1: [], never: ['C7', 'C9'], qs: ['클린치에서 니킥으로 이어지는 셋업', '칼라 타이 이후 니킥', '목 잡고 니킥 셋업'] },
  { g: '저장 안 된 목적', none: true, never: ALL_KEYS, qs: ['힐훅을 위한 셋업', '리어 네이키드 초크로 끝나는 콤보', '앵클 픽을 위한 셋업', 'heel hook setup'] },
  { g: '영어·한글 혼합', must: ['S1', 'C6'], tier1: ['S1', 'C6'], never: ['C7'], qs: ['double leg를 위한 셋업', 'Double Leg 진입 셋업', '더블렉 setup'] },
  { g: '잽+더블렉 복합', must: ['S1', 'C6'], tier1: ['S1', 'C6'], never: ['C7', 'C4'], qs: ['잽 이후 더블렉으로 끝나는 셋업', '잽 다음 더블렉', 'jab then double leg'] },
];

// HOLDOUT — written before the first run, never used for tuning; the first run is kept in
// data/audit/tactical-finder-2-holdout-first-run.json
const HOLDOUT = [
  { q: '더블렉 들어가기 전에 쓸 셋업', must: ['S1', 'S2', 'C6'], never: ['C7'] },
  { q: '잽으로 시작해서 훅으로 끝나는 콤보', must: ['C1'], never: ['C7'] },
  { q: '원투 다음에 로우킥', must: ['C5'], never: ['C7'] },
  { q: '상대 가드를 내리게 하는 바디 공격 셋업', must: ['S4'], never: ['C7'] },
  { q: '몸통 치고 얼굴 치는 콤보', must: ['C3'], tier1: ['C3'], never: ['C7'] },
  { q: '클린치 잡고 무릎', must: ['S5'], never: ['C7'] },
  { q: '상대를 코너로 모는 셋업', must: ['S6'], never: ['C7'] },
  { q: 'feint into low kick', must: ['S7'], never: ['C7'] },
  { q: 'level change double leg setup', must: ['S1', 'S2'], never: ['C7'] },
  { q: '태클 셋업 추천', must: ['S1', 'S2', 'S3', 'C6'], never: ['C7'] },
  { q: '싱글렉 들어가는 셋업', must: ['S3'], never: ['C7'] },
  { q: '트라이앵글 초크로 마무리', must: ['C7'], tier1: ['C7'], never: ['C1'] },
  { q: '프론트 헤드락 잡는 콤보', must: ['C8'], never: ['C7'] },
  { q: '바디킥 넣는 콤보', must: ['C9'], never: ['C7'] },
  { q: '훅으로 끝나는 콤보', must: ['C1', 'C2', 'C3'], never: ['C7'] },
  { q: '오버핸드 이후 테이크다운', must: ['S3'], never: ['C7'] },
  { q: '기무라를 위한 셋업', none: true, never: ALL_KEYS },
  { q: '스피닝 엘보 셋업', none: true, never: ALL_KEYS },
  { q: '잽 후 더블렉 셋업', must: ['S1', 'C6'], never: ['C7'] },
  { q: '압박해서 후퇴시키는 셋업', must: ['S6'], never: ['C7'] },
  { q: 'clinch knee setup', must: ['S5'], never: ['C7'] },
  { q: '가드 여는 콤보', must: ['S4'], never: ['C7'] },
  { q: '하이로우 콤보 바디에서 헤드', must: ['C3'], never: ['C7'] },
  { q: '크로스 이후 연결 콤보', must: ['C2'], tier1: ['C2'], never: ['C7'] },
  { q: '로우킥 셋업', must: ['S7'], never: ['C7'] },
];

const results = [];
const failures = [];
const timings = [];
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const L = await server.ssrLoadModule('/src/lib/tacticalFinder/libraryFinder.ts');
  const W = await server.ssrLoadModule('/src/lib/tacticalFinder/webSearch.ts');
  const R = await server.ssrLoadModule('/src/lib/tacticalFinder/recommend.ts');
  const UT = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
  // fixture sanity: every fixture id is a real DB technique
  const missing = [...COMBOS, ...TACTICS].flatMap((x) => x.techniqueIds).filter((id) => !UT.resolveTechnique(id));
  if (missing.length) throw new Error(`fixture ids not in DB: ${missing.join(', ')}`);

  loadFixture();
  const before = JSON.stringify([...store.entries()]);
  const NO_RESULT = '현재 저장된 콤보와 셋업 중 이 목적에 직접적으로 부합하는 항목을 찾지 못했습니다.';
  let falsePos = 0;
  let mustTotal = 0;
  let mustHit = 0;
  for (const grp of G) {
    for (const q of grp.qs) {
      const t0 = performance.now();
      const r = L.searchLibrary(q);
      const ms = performance.now() - t0;
      timings.push(ms);
      const mine = [...r.mySetups, ...r.myCombos];
      const idOf = (h) => h.id;
      const got = new Map(mine.map((h) => [idOf(h), h]));
      const errs = [];
      for (const k of grp.must ?? []) {
        mustTotal++;
        if (got.has(k)) mustHit++;
        else errs.push(`missing ${k}`);
      }
      for (const k of grp.tier1 ?? []) if (got.get(k)?.tier !== 1) errs.push(`${k} not tier1 (${got.get(k)?.tier ?? 'absent'})`);
      for (const k of grp.notTier1 ?? []) if (got.get(k)?.tier === 1) errs.push(`${k} wrongly tier1`);
      for (const k of grp.never ?? []) if (got.has(k)) (errs.push(`false positive ${k} (tier ${got.get(k).tier})`), falsePos++);
      if (mine.some((h) => /^O\d/.test(h.id)) || r.related.some((h) => /^O\d/.test(h.id ?? ''))) errs.push('OTHER-ACCOUNT ITEM EXPOSED');
      if (grp.none && (mine.length || !r.notices.some((n) => n.text === NO_RESULT))) errs.push('no-result sentence missing / items shown');
      // ordering: tiers ascending, and reasons present for every hit
      const tiers = r.mySetups.map((h) => h.tier);
      if (tiers.some((t, i) => i && t < tiers[i - 1])) errs.push('MY SETUPS not sorted by tier');
      if (mine.some((h) => !h.reasons.length)) errs.push('hit without reason');
      results.push({ group: grp.g, query: q, ok: !errs.length, ms: Math.round(ms * 10) / 10, mySetups: r.mySetups.map((h) => `${h.id}:t${h.tier}:${h.relevance}`), myCombos: r.myCombos.map((h) => `${h.id}:t${h.tier}:${h.relevance}`), related: r.related.filter((h) => h.id).map((h) => `${h.id}:t${h.tier}`), library: r.library.length, errors: errs });
      if (errs.length) failures.push({ q, errs });
    }
  }

  const holdout = [];
  for (const c of HOLDOUT) {
    const r = L.searchLibrary(c.q);
    const mine = [...r.mySetups, ...r.myCombos];
    const got = new Map(mine.map((h) => [h.id, h]));
    const errs = [];
    for (const k of c.must ?? []) if (!got.has(k)) errs.push(`missing ${k}`);
    for (const k of c.tier1 ?? []) if (got.get(k)?.tier !== 1) errs.push(`${k} not tier1 (${got.get(k)?.tier ?? 'absent'})`);
    for (const k of c.never ?? []) if (got.has(k)) errs.push(`false positive ${k}`);
    if (c.none && !r.notices.some((n) => n.text === NO_RESULT)) errs.push('no-result sentence missing');
    holdout.push({ query: c.q, ok: !errs.length, mySetups: r.mySetups.map((h) => `${h.id}:t${h.tier}`), myCombos: r.myCombos.map((h) => `${h.id}:t${h.tier}`), errors: errs });
  }
  const firstRun = path.join(APP, 'data/audit/tactical-finder-2-holdout-first-run.json');
  if (!fs.existsSync(firstRun)) fs.writeFileSync(firstRun, JSON.stringify({ at: new Date().toISOString(), passed: holdout.filter((h) => h.ok).length, total: holdout.length, holdout }, null, 1) + '\n');

  // ---- special cases
  const special = [];
  const sp = (name, ok, detail = '') => special.push({ name, ok: !!ok, detail });
  const noSig = L.searchLibrary('안녕하세요');
  sp('목적 없는 입력 → 안내, 결과 없음', noSig.notices.some((n) => /목적을 찾지 못했습니다/.test(n.text)) && !noSig.mySetups.length && !noSig.myCombos.length);
  const noise = L.searchLibrary('ㅋㅋㅋ');
  sp('의미 없는 입력 → 결과 없음', !noise.mySetups.length && !noise.myCombos.length);
  const harm = L.searchLibrary('상대를 다치게 하는 콤보');
  sp('위해 목적 → 차단', harm.notices.some((n) => /다치게/.test(n.text)) && !harm.mySetups.length && !harm.myCombos.length);
  const all = L.searchLibrary('더블렉을 위한 셋업');
  sp('다른 계정 항목은 검색 대상에서 제외(개수 표시)', all.searched.otherAccount === 2 && all.searched.combos === COMBOS.length - 1 && all.searched.tactics === TACTICS.length - 1, JSON.stringify(all.searched));
  sp('개수 제한 없음 (해당 항목 모두 반환)', ['S1', 'S2', 'C6'].every((k) => [...all.mySetups, ...all.myCombos].some((h) => h.id === k)));
  sp('MY SETUPS에는 셋업만 / MY COMBOS에는 콤보만', all.mySetups.every((h) => h.kind === 'setup') && all.myCombos.every((h) => h.kind === 'combo'));
  sp('MARTIALDEX 라이브러리는 별도 섹션', all.library.every((h) => h.source === 'curated-library') && all.library.length > 0, `library ${all.library.length}`);
  sp('검색은 저장 데이터를 바꾸지 않음', JSON.stringify([...store.entries()]) === before);
  // signed out: records stamped with any account are skipped, local (null-owner) records still searched
  store.delete('mdx:last-auth-user-id');
  const out = L.searchLibrary('클린치 진입을 위한 셋업');
  sp('로그아웃 상태 → 계정 표시 항목 검색 안 함', ![...out.mySetups, ...out.myCombos].some((h) => /^O/.test(h.id)) && out.searched.otherAccount === 2);
  // another account signed in on this device → the fixture's OTHER items become theirs, ours are null-owner (local)
  store.set('mdx:last-auth-user-id', OTHER);
  const asOther = L.searchLibrary('클린치 진입을 위한 셋업');
  sp('계정 전환 → 그 계정 항목만(이 계정 표시 항목 제외)', asOther.searched.otherAccount === 0);
  loadFixture();
  // empty data
  store.set('martialdex:combos', '[]');
  store.set('martialdex:tactics', '[]');
  const empty = L.searchLibrary('더블렉을 위한 셋업');
  sp('저장 데이터 없음 → 안내 + 라이브러리만', empty.notices.some((n) => /저장된 콤보·셋업이 없습니다/.test(n.text)) && !empty.mySetups.length && empty.library.length > 0);
  store.set('martialdex:combos', '{broken');
  let threw = false;
  try {
    L.searchLibrary('더블렉을 위한 셋업');
  } catch {
    threw = true;
  }
  sp('손상된 저장 데이터 → 오류 없이 빈 목록', !threw);
  // large data: 2,000 combos + 500 tactics
  const ids = ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__lead-hook', 'kickboxing__low-kick', 'boxing__body-hook', 'wrestling__basic-double-leg', 'bjj__armbar', 'wrestling__collar-tie', 'kickboxing__body-kick', 'mixed-martial-arts__overhand'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const big = Array.from({ length: 2000 }, (_, i) => combo(`B${i}`, `대량 ${i}`, Array.from({ length: 2 + Math.floor(rnd() * 3) }, () => ids[Math.floor(rnd() * ids.length)])));
  const bigT = Array.from({ length: 500 }, (_, i) => tactic(`BT${i}`, `대량 셋업 ${i}`, i % 3 ? '상대가 압박할 때' : '테이크다운 진입', Array.from({ length: 2 + Math.floor(rnd() * 2) }, () => ids[Math.floor(rnd() * ids.length)])));
  store.set('martialdex:combos', JSON.stringify(big));
  store.set('martialdex:tactics', JSON.stringify(bigT));
  const bt = [];
  let bigRes;
  for (const q of ['더블렉을 위한 셋업', '잽 이후 연결할 수 있는 콤보', '바디 공격 이후 헤드 공격으로 이어지는 콤보']) {
    const t0 = performance.now();
    bigRes = L.searchLibrary(q);
    bt.push(performance.now() - t0);
  }
  const expectDl = big.filter((c) => c.techniqueIds.includes('wrestling__basic-double-leg')).length;
  sp('대량 데이터(콤보 2,000 + 셋업 500) 검색 시간', Math.max(...bt) < 1500, `${bt.map((x) => Math.round(x)).join('/')} ms`);
  const dl = L.searchLibrary('더블렉을 위한 셋업');
  const dlFound = [...dl.mySetups, ...dl.myCombos].filter((h) => h.id?.startsWith('B') && !h.id.startsWith('BT')).length;
  sp('대량 데이터에서 더블렉 포함 콤보를 빠짐없이 반환', dlFound === expectDl, `${dlFound}/${expectDl}`);
  loadFixture();

  // ---- account switch on this device (local-only guard; no network): A's records are stashed, B never sees them
  const GUARD = await server.ssrLoadModule('/src/lib/auth/deviceAccountGuard.ts');
  loadFixture();
  store.set('martialdex:tactical-prefs', JSON.stringify({ personal: true, ai: false, mode: 'web', tab: 'combo' }));
  GUARD.guardAccountSwitch('test-account-B');
  const asB = L.searchLibrary('더블렉을 위한 셋업');
  sp('계정 전환(A→B) → A의 콤보·셋업이 B의 검색에 나오지 않음', asB.searched.combos === 0 && asB.searched.tactics === 0 && ![...asB.mySetups, ...asB.myCombos].length, JSON.stringify(asB.searched));
  GUARD.guardAccountSwitch(OWNER);
  const backA = L.searchLibrary('더블렉을 위한 셋업');
  const prefsBack = JSON.parse(store.get('martialdex:tactical-prefs') ?? '{}');
  sp('A로 복귀 → A의 기록·파인더 설정(mode/tab) 복원 후 다시 검색됨', ['S1', 'S2', 'C6'].every((k) => [...backA.mySetups, ...backA.myCombos].some((h) => h.id === k)) && prefsBack.mode === 'web' && prefsBack.tab === 'combo');
  loadFixture();

  // ---- APP technique finder cache vs web cache
  const a1 = R.findTactics('상대가 압박할 때 카운터', { personal: false, count: 5 });
  W.clearWebCache();
  sp('앱 DB 캐시와 웹 캐시 분리 (웹 캐시 초기화 후에도 앱 결과는 캐시)', R.findTactics('상대가 압박할 때 카운터', { personal: false, count: 5 }).cached && !!a1);

  // ---- WEB SEARCH (mocked Gemini)
  const web = [];
  const wp = (name, ok, detail = '') => web.push({ name, ok: !!ok, detail });
  const G1 = { title: 'bjjfanatics.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/AAA' };
  const G2 = { title: 'evolve-mma.com', uri: 'https://vertexaisearch.cloud.google.com/grounding-api-redirect/BBB' };
  const answer = {
    items: [
      { kind: 'setup', name: 'Jab to Double Leg', purpose: '잽으로 가드를 올리게 한 뒤 더블렉', steps: [{ name: 'Jab', role: '시선 끌기' }, { name: 'Double Leg', role: '테이크다운' }], reason: '잽에 반응해 가드가 올라가면 하체가 빔', sourceUrls: ['https://www.evolve-mma.com/blog/double-leg-setups/'], composed: false },
      { kind: 'setup', name: 'Jab → Double Leg (duplicate)', purpose: '같은 구성', steps: [{ name: 'Jab', role: '' }, { name: 'Double Leg', role: '' }], reason: '', sourceUrls: ['https://bjjfanatics.com/blogs/news/double-leg'], composed: false },
      { kind: 'combo', name: 'Fake Overhand Level Change', purpose: '오버핸드 페인트 후 레벨 체인지', steps: [{ name: 'Overhand', role: '페인트' }, { name: 'Made Up Shot 3000', role: '진입' }], reason: '', sourceUrls: ['https://fake-site.example/xyz'], composed: false },
      { kind: 'combo', name: 'AI Mix', purpose: '조합', steps: [{ name: 'Cross', role: '' }, { name: 'Double Leg', role: '' }], reason: '자료를 조합', sourceUrls: [], composed: true },
    ],
  };
  let calls = 0;
  const okAsk = async (req) => {
    calls++;
    if (!req.useSearchGrounding || req.engine !== 'gemini') return { ok: false, code: 'UNKNOWN', message: 'grounding not requested' };
    return { ok: true, text: 'Here you go:\n```json\n' + JSON.stringify(answer) + '\n```', groundingSources: [G1, G2], webSearchQueries: ['double leg setup jab', 'double leg setups mma'] };
  };
  W.clearWebCache();
  const w1 = await W.webSearch('더블렉을 위한 셋업', 'combo', { ask: okAsk });
  wp('웹: 성공 → status ok, 실제 검색어·출처 보존', w1.status === 'ok' && w1.searchQueries.length === 2 && w1.groundingSources.length === 2);
  wp('웹: Gemini 요청에 Google 검색 그라운딩 + gemini 엔진 지정', calls === 1);
  const jd = w1.items.find((i) => i.name === 'Jab to Double Leg');
  wp('웹: 같은 구성(잽→더블렉) 중복 제거 + 출처 병합', w1.items.filter((i) => i.steps.map((s) => s.techniqueId).join() === jd?.steps.map((s) => s.techniqueId).join() && i.kind !== 'technique').length === 1 && jd.sources.filter((s) => s.grounded).length === 2, JSON.stringify(jd?.sources));
  wp('웹: 인용 URL의 사이트가 검색 출처와 일치 → verified + web-confirmed', jd?.verification === 'verified' && jd?.origin === 'web-confirmed');
  const fake = w1.items.find((i) => i.name === 'Fake Overhand Level Change');
  wp('웹: 검색 출처에 없는 URL → 표시 안 함, AI 조합(출처 미확인)', fake && fake.origin === 'ai-composed' && fake.verification === 'unverified' && !fake.sources.some((s) => s.url.includes('fake-site')));
  wp('웹: DB에 없는 기술 이름은 techniqueId 없음 (지어내지 않음)', fake && fake.steps[1].techniqueId === null && fake.steps[0].techniqueId);
  const mix = w1.items.find((i) => i.name === 'AI Mix');
  wp('웹: composed:true → AI GENERATED', mix?.origin === 'ai-composed');
  const w1b = await W.webSearch('더블렉을 위한 셋업', 'combo', { ask: okAsk });
  wp('웹: 같은 검색 반복 → 캐시, Gemini 재호출 없음', w1b.cached && calls === 1);
  const w1t = await W.webSearch('더블렉을 위한 셋업', 'technique', { ask: okAsk });
  wp('웹: 탭별 캐시 분리 (TECHNIQUE 탭은 새로 검색)', !w1t.cached && calls === 2);
  W.clearWebCache();
  calls = 0;
  const [p1, p2] = await Promise.all([W.webSearch('잽 이후 콤보', 'combo', { ask: okAsk }), W.webSearch('잽 이후 콤보', 'combo', { ask: okAsk })]);
  wp('웹: 동시에 두 번 눌러도 Gemini 1회', calls === 1 && p1.status === 'ok' && p2.status === 'ok');
  const noG = await W.webSearch('x 셋업', 'combo', { ask: async () => ({ ok: true, text: JSON.stringify(answer) }) });
  wp('웹: 그라운딩 출처 없음 → no-grounding, 결과 표시 안 함', noG.status === 'no-grounding' && noG.items.length === 0);
  const quota = await W.webSearch('y 셋업', 'combo', { ask: async () => ({ ok: false, code: 'QUOTA_EXCEEDED', message: 'q' }) });
  wp('웹: 사용 한도 초과 → error + 안내 문구', quota.status === 'error' && /한도/.test(quota.error.message) && !quota.items.length);
  const nokey = await W.webSearch('z 셋업', 'combo', { ask: async () => ({ ok: false, code: 'NO_API_KEY', message: 'k' }) });
  wp('웹: API 키 없음 → error', nokey.status === 'error' && /API 키/.test(nokey.error.message));
  const unsup = await W.webSearch('u 셋업', 'combo', { ask: async () => ({ ok: false, code: 'LOCAL_UNSUPPORTED_INPUT', message: '로컬 엔진은 웹 검색을 할 수 없습니다.' }) });
  wp('웹: 그라운딩 미지원 응답 → error, 원문 메시지', unsup.status === 'error' && /웹 검색/.test(unsup.error.message));
  const thrown = await W.webSearch('t 셋업', 'combo', { ask: async () => { throw new Error('boom'); } });
  wp('웹: 예외 → error (앱 결과로 대체 안 함)', thrown.status === 'error' && /boom/.test(thrown.error.message));
  const errAgain = await W.webSearch('y 셋업', 'combo', { ask: okAsk });
  wp('웹: 실패한 검색은 캐시하지 않음 (다시 시도 가능)', !errAgain.cached && errAgain.status === 'ok');
  const bad = await W.webSearch('p 셋업', 'combo', { ask: async () => ({ ok: true, text: '죄송합니다, 찾지 못했습니다.', groundingSources: [G1] }) });
  wp('웹: JSON 아님 → PARSE_ERROR', bad.status === 'error' && bad.error.code === 'PARSE_ERROR');
  const emp = await W.webSearch('e 셋업', 'combo', { ask: async () => ({ ok: true, text: '{"items":[]}', groundingSources: [G1] }) });
  wp('웹: 검색은 됐지만 항목 없음 → empty', emp.status === 'empty');
  const techOnly = await W.webSearch('q 셋업', 'combo', { ask: async () => ({ ok: true, text: JSON.stringify({ items: [{ kind: 'technique', name: 'Double Leg', steps: [{ name: 'Double Leg' }], sourceUrls: [G1.uri] }] }), groundingSources: [G1] }) });
  wp('웹: SETUP & COMBO 탭은 단일 기술을 넣지 않음', techOnly.items.length === 0);
  const exact = await W.webSearch('r 셋업', 'technique', { ask: async () => ({ ok: true, text: JSON.stringify({ items: [{ kind: 'technique', name: 'Double Leg', steps: [{ name: 'Double Leg' }], sourceUrls: [G1.uri] }] }), groundingSources: [G1] }) });
  wp('웹: 그라운딩 URL 그대로 인용 → verified, TECHNIQUE 탭은 단일 기술 허용', exact.items[0]?.verification === 'verified' && exact.items[0]?.kind === 'technique');
  sp('웹 검색은 저장 데이터를 바꾸지 않음 (자동 저장 없음)', JSON.stringify([...store.entries()]) === before);

  const sorted = [...timings].sort((x, y) => x - y);
  const report = {
    generatedBy: '.devtools/test-tactical-finder-2.mjs',
    at: new Date().toISOString(),
    fixture: { combos: COMBOS.length, tactics: TACTICS.length, otherAccount: 2, note: '[TEST] in-memory fixture only — never written to real storage' },
    libraryInputs: results.length,
    libraryPassed: results.filter((r) => r.ok).length,
    recall: `${mustHit}/${mustTotal}`,
    falsePositives: falsePos,
    timing: { medianMs: Math.round(sorted[Math.floor(sorted.length / 2)] * 10) / 10, p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 10) / 10, maxMs: Math.round(sorted.at(-1) * 10) / 10 },
    special,
    web,
    holdout: { passed: holdout.filter((h) => h.ok).length, total: holdout.length, results: holdout },
    results,
  };
  fs.writeFileSync(path.join(APP, 'data/audit/tactical-finder-2-test.json'), JSON.stringify(report, null, 1) + '\n');
  for (const f of failures) console.log('FAIL —', f.q, '::', f.errs.join(' | '));
  for (const s of [...special, ...web]) if (!s.ok) console.log('FAIL —', s.name, s.detail);
  for (const s of special) if (s.detail) console.log('  ·', s.name, s.detail);
  console.log(`\nlibrary ${report.libraryPassed}/${report.libraryInputs} · recall ${report.recall} · false positives ${falsePos} · timing ${JSON.stringify(report.timing)}`);
  for (const h of holdout) if (!h.ok) console.log('HOLDOUT FAIL —', h.query, '::', h.errors.join(' | '), JSON.stringify([h.mySetups, h.myCombos]));
  console.log(`holdout ${holdout.filter((h) => h.ok).length}/${holdout.length} (not used for tuning)`);
  console.log(`special ${special.filter((s) => s.ok).length}/${special.length} · web ${web.filter((s) => s.ok).length}/${web.length}`);
  process.exitCode = failures.length || special.some((s) => !s.ok) || web.some((s) => !s.ok) ? 1 : 0;
} finally {
  await server.close();
}
