// 자체 검색 실제 검색 → AI 코치 답변 통합 검증 (8차). Real Electron app (hidden + muted automation launch),
// real SearXNG started by the app's own switch, real local model (Ollama started by the app's engine control).
//
//   사용자 질문 → 스위치 ON 확인 → SearXNG /search (응답 원문을 여기서 가로채 기록) → 정규화(research)
//   → IPC → 코치 출처 목록 / [검색 자료] 프롬프트 → 로컬 모델 답변 → 출처 검사(guardAnswer)
//
// Safety: Gemini · Tavily · Supabase hosts are BLOCKED and logged in the main process (fetch) and the
// renderer (network routes); GEMINI_API_KEY is emptied and TAVILY_API_KEY is a dummy, so a fallback
// attempt would show up in the log instead of reaching a service. Nothing is signed in, nothing is
// written to any server. Outbound traffic is only SearXNG's own engine requests (services/searxng/
// settings.yml) and the app's public-page extraction of the found results.
// Requires this folder's Vite dev server on :5173, nothing on :8888 or :11434, qwen2.5:3b in ~/.ollama.
// Run: node .devtools/qa-self-search-integration.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..'); // this checkout (original or a dev copy)
const OUT = process.env.QA_OUT || path.join(os.tmpdir(), 'mdex-self-search-integration.json');
const BLOCKED = /generativelanguage\.googleapis\.com|api\.tavily\.com|supabase\.co/i;
let pass = 0;
let fail = 0;
const report = { checks: [], turns: {} };
const check = (name, ok, info) => {
  ok ? pass++ : fail++;
  const d = info === undefined ? '' : typeof info === 'string' ? info : JSON.stringify(info);
  report.checks.push({ name, ok, info });
  console.log(`${ok ? 'PASS' : 'FAIL'} — ${name}${d ? ` :: ${d.slice(0, 400)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// node:http, not fetch — Node 24's fetch threw an uncatchable setTypeOfService EINVAL probing a just-killed port
const answers = (url) =>
  new Promise((resolve) => {
    const req = http.get(url, { timeout: 1500 }, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 300);
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
const searxUp = () => answers('http://127.0.0.1:8888/healthz');
if ((await searxUp()) || (await answers('http://127.0.0.1:11434/api/version'))) {
  console.log('SKIP — something already answers on :8888 or :11434 (not ours; left untouched).');
  process.exit(0);
}

const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-selfsearch-int-'));
const env = { ...process.env, MARTIALDEX_HEADLESS: '1', GEMINI_API_KEY: '', TAVILY_API_KEY: 'qa-dummy-not-a-key' };
delete env.ELECTRON_RUN_AS_NODE;
delete env.MARTIALDEX_SEARCH_BACKEND;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${userData}`], env, timeout: 120000 });

// main process: log every fetch, block paid / production hosts, keep SearXNG's raw /search answers
await app.evaluate(() => {
  const orig = globalThis.fetch;
  globalThis.__qa = { calls: [], blocked: [], searx: [] };
  globalThis.fetch = async (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    globalThis.__qa.calls.push(url);
    if (/generativelanguage\.googleapis\.com|api\.tavily\.com|supabase\.co/i.test(url)) {
      globalThis.__qa.blocked.push(url);
      throw new TypeError('blocked by QA');
    }
    const res = await orig(input, init);
    if (/^http:\/\/127\.0\.0\.1:8888\/search\?/.test(url)) {
      try {
        const j = await res.clone().json();
        globalThis.__qa.searx.push({ q: new URL(url).searchParams.get('q'), urls: (j.results || []).map((r) => r.url), titles: (j.results || []).map((r) => r.title) });
      } catch {
        globalThis.__qa.searx.push({ q: new URL(url).searchParams.get('q'), urls: [], titles: [], bad: true });
      }
    }
    return res;
  };
});
const qa = () => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__qa)));
const resetQa = () => app.evaluate(() => Object.assign(globalThis.__qa, { calls: [], blocked: [], searx: [] }));

const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
const errors = [];
const rendererBlocked = [];
page.on('pageerror', (e) => errors.push(String(e)));
await page.route(BLOCKED, (route) => {
  rendererBlocked.push(route.request().url());
  return route.abort();
});
await page.goto('http://localhost:5173/#/coach/chat');
await page.waitForSelector('[data-testid="self-ai-status"]', { timeout: 60000 });

// local AI engine — started the way the 설정 > AI 엔진 button does (app-owned; stopped when the app quits)
let t0 = Date.now();
const eng = await page.evaluate(() => window.martialdex.localEngine.start({}));
const engSt = await page.evaluate(() => window.martialdex.localEngine.status());
check('준비: 로컬 AI 엔진 시작 (앱이 실행·소유)', eng.ok === true && engSt.phase === 'running', { eng, phase: engSt.phase, model: engSt.model, owned: engSt.owned, ms: Date.now() - t0 });

const WEB_Q = '요즘 격투기 선수 급격한 체중 감량 위험성에 대한 최신 자료 찾아줘';
const DOWN_Q = '최근 격투기 계체량 규정 변경에 대한 자료 찾아줘'; // a question not searched before (no cached result)
const EMPTY_Q ='zqxjvbw kpfmtrlq vvxzq 자료 찾아줘';
const CHAT_Q = '오늘 훈련 전에 컨디션 관리 팁 한 가지만 알려줘';

/** One coach turn through the app's real dependencies; the prompt the model received is captured. */
const turn = (text) =>
  page.evaluate(async (text) => {
    const { runCoachTurn } = await import('/src/lib/selfAi/coachAgent.ts');
    const { appCoachDeps } = await import('/src/lib/selfAi/deps.ts');
    const { planTurn } = await import('/src/lib/selfAi/router.ts');
    const deps = appCoachDeps();
    const prompts = [];
    const researched = [];
    const chat = deps.chat;
    const research = deps.research;
    deps.chat = (req, onDelta) => {
      prompts.push(req.messages.map((m) => `<<${m.role}>>\n${m.content}`).join('\n'));
      return chat(req, onDelta);
    };
    deps.research = async (req) => {
      const r = await research(req);
      researched.push({ req, ok: r.ok, code: r.ok ? null : r.code, urls: r.ok ? r.results.map((x) => x.url) : [], titles: r.ok ? r.results.map((x) => x.title) : [] });
      return r;
    };
    const t = Date.now();
    const out = await runCoachTurn({ text, history: [], requestId: `qa-${Date.now()}` }, deps);
    const m = out.message;
    return {
      plan: { intent: planTurn(text).intent, needed: planTurn(text).research.needed, queries: planTurn(text).research.queries },
      ms: Date.now() - t,
      research: m.research,
      model: m.model,
      text: m.text,
      sources: (m.sources || []).map((s) => ({ n: s.n, title: s.title, url: s.url, contentRead: s.contentRead })),
      guardNotes: m.guardNotes || [],
      claims: m.claims || [],
      dataOnly: m.dataOnly || null,
      techniqueIds: m.techniqueIds || [],
      researched,
      prompts,
    };
  }, text);
const citations = (s) => [...s.matchAll(/\[(\d+)\]/g)].map((x) => Number(x[1]));

// ---------- 1. OFF: no search request at all ----------
check('1. 기본 OFF', (await page.evaluate(() => window.martialdex.selfSearch.status())).enabled === false);
await resetQa();
let r = await turn(WEB_Q);
report.turns.off = r;
let log = await qa();
check('1. OFF: 라우터는 검색이 필요한 질문으로 분류', r.plan.needed && r.research?.kind === 'web', r.plan);
check('1. OFF: SearXNG 검색 요청 0건 (앱이 :8888에 아무것도 보내지 않음)', !log.calls.some((u) => u.includes(':8888')), log.calls.filter((u) => u.includes(':8888')));
check('1. OFF: 연구 결과 DISABLED · searched=false · 출처 없음', r.research?.status === 'disabled' && r.research.searched === false && r.sources.length === 0, r.research);
check('1. OFF: 답변 첫머리에 "자체 검색이 꺼져 있어 검색하지 않았습니다" 표시', r.text.startsWith('🔎 자체 검색이 꺼져 있어 검색하지 않았습니다'), r.text.slice(0, 120));
check('1. OFF: 모델 프롬프트의 [검색 자료]는 "(없음 — …꺼져…)"', r.prompts.length === 1 && /\[검색 자료\]\n\(없음 — 🔎 자체 검색이 꺼져/.test(r.prompts[0]), r.prompts[0]?.slice(-300));
check('1·5. OFF: 로컬 AI 답변은 그대로 생성됨', r.model && !/^martialdex-/.test(r.model) && !r.dataOnly && r.text.length > 80, { model: r.model, ms: r.ms });
check('1. OFF: 답변에 출처 번호 없음 (검색 안 한 내용을 검색한 것처럼 표시 안 함)', citations(r.text).length === 0, citations(r.text));

// ---------- 2. ON: real results from SearXNG ----------
t0 = Date.now();
const on = await page.evaluate(() => window.martialdex.selfSearch.setEnabled(true));
const ss = await page.evaluate(() => window.martialdex.selfSearch.status());
check('2. ON: 앱이 SearXNG 실행 (owned)', on.ok && ss.phase === 'running' && ss.owned, { on, phase: ss.phase, owned: ss.owned, ms: Date.now() - t0 });
await resetQa();
const direct = await page.evaluate(() => window.martialdex.research.search({ query: 'weight cutting dangers combat sports', kind: 'web', maxResults: 8 }));
log = await qa();
const rawUrls = new Set(log.searx.flatMap((s) => s.urls));
check(
  '2. ON: SearXNG가 실제 결과를 돌려줌 (응답 원문 기록)',
  log.searx.length >= 1 && rawUrls.size > 0,
  log.searx.map((s) => ({ q: s.q, n: s.urls.length }))
);
check(
  '2. ON: 정규화된 결과 = SearXNG 원문 안의 URL·제목 (만들어진 출처 없음)',
  direct.ok && direct.results.length > 0 && direct.results.every((x) => rawUrls.has(x.url) && x.title && /^https?:/.test(x.url)),
  direct.ok ? { n: direct.results.length, first: direct.results.slice(0, 3).map((x) => [x.title, x.url, x.extraction.status]) } : direct
);
report.direct = direct.ok ? { n: direct.results.length, results: direct.results.map((x) => ({ title: x.title, url: x.url, extraction: x.extraction.status, reliability: x.reliability.label })), diagnostics: direct.diagnostics } : direct;

// ---------- 7. coach answer grounded on the search ----------
await resetQa();
r = await turn(WEB_Q);
report.turns.on = r;
log = await qa();
const raw7 = new Set(log.searx.flatMap((s) => s.urls));
const res7 = r.researched[0];
check('7. ON: 코치 턴에서 실제 검색 실행 · 결과 수신', r.research?.searched === true && r.research.status === 'ok' && res7?.ok && res7.urls.length > 0, { research: r.research, n: res7?.urls.length });
check('7. 출처 목록(제목·URL) = 검색 결과 그대로, 모두 SearXNG 원문에 있음', r.sources.length > 0 && r.sources.every((s, i) => s.url === res7.urls[i] && s.title === res7.titles[i] && raw7.has(s.url)), r.sources.map((s) => [s.n, s.title.slice(0, 60), s.url]));
const prompt7 = r.prompts.at(-1) ?? '';
const srcBlock = prompt7.slice(prompt7.lastIndexOf('\n[검색 자료]\n')); // the rules above also name the block
check('7. 모델 프롬프트에 [검색 자료]로 검색 결과가 번호와 함께 전달됨', r.sources.some((s) => srcBlock.includes(`] ${s.title}`)) && /\[1\] /.test(srcBlock), srcBlock.slice(0, 500));
check('7. MARTIALDEX 데이터와 검색 자료가 별도 블록으로 구분됨', prompt7.indexOf('\n[MARTIALDEX 데이터]\n') > -1 && prompt7.indexOf('\n[MARTIALDEX 데이터]\n') < prompt7.lastIndexOf('\n[검색 자료]\n'));
check('7. 답변 첫머리에 실제 검색 건수 표시', /^🔎 웹 검색 결과 \d+건 \(본문 확인 \d+건\)/.test(r.text), r.text.split('\n')[0]);
const cites7 = citations(r.text);
check('7. 답변의 출처 번호는 모두 실제 출처 범위 안 (없는 번호는 guard가 제거)', cites7.every((n) => n >= 1 && n <= r.sources.length), { cites: cites7, sources: r.sources.length, guardNotes: r.guardNotes });
const urlsInText = [...r.text.matchAll(/https?:\/\/\S+/g)].map((m) => m[0]);
check('7. 답변 본문에 검색 결과에 없는 링크 없음', urlsInText.every((u) => r.sources.some((s) => u.startsWith(s.url))), urlsInText);
check('7. 근거 대조: 답변 문장별로 출처 연결 결과가 메시지에 붙음', Array.isArray(r.claims) && r.claims.length > 0, (r.claims || []).map((c) => [c.status, c.source, c.problems.join('+'), c.sentence.slice(0, 50)]));
check('7. 로컬 AI가 검색 자료로 답변 생성', r.model && !/^martialdex-/.test(r.model) && !r.dataOnly, { model: r.model, ms: r.ms, cites: cites7 });

// ---------- 6. no results ----------
await resetQa();
r = await turn(EMPTY_Q);
report.turns.empty = r;
check('6. 결과 없음: 검색은 실행됨 · status=empty · 출처 0', r.research?.searched === true && r.research.status === 'empty' && r.sources.length === 0, r.research);
check('6. 결과 없음: "0건"을 명확히 표시', /^🔎 (검색했지만 검색 엔진이 찾은 결과가 0건|검색 엔진이 \d+건을 찾았지만 질문 주제와 맞지 않아 모두 제외)/.test(r.text), r.text.split('\n')[0]);
check('6. 결과 없음: 답변에 출처 번호 없음', citations(r.text).length === 0, citations(r.text));

// ---------- 3. search server stops while ON ----------
const pid = JSON.parse(fs.readFileSync(path.join(userData, 'self-search.pid.json'), 'utf8')).pid;
process.kill(pid, 'SIGKILL'); // the test's own app-started SearXNG
for (let i = 0; i < 20 && (await searxUp()); i++) await sleep(250);
await sleep(800);
const down = await page.evaluate(() => window.martialdex.selfSearch.status());
check('3. 서버 중단: 상태 = 오류 · "MARTIALDEX가 실행한 자체 검색 서버가 종료되었습니다"', down.enabled && down.phase === 'error' && down.error?.code === 'EXITED', { phase: down.phase, error: down.error });
const rs = await page.evaluate(() => window.martialdex.research.status());
check('3. 서버 중단: research:status ok=false', rs.ok === false, rs);
await page.goto('http://localhost:5173/#/profile');
await page.waitForSelector('[data-testid="self-search-phase"]', { timeout: 30000 });
const phaseUi = { phase: await page.getAttribute('[data-testid="self-search-phase"]', 'data-phase'), text: await page.textContent('[data-testid="self-search-switch"]') };
check('3. 서버 중단: 설정 화면 표시 "오류" + 종료 사유', phaseUi.phase === 'error' && /오류/.test(phaseUi.text) && /종료되었습니다/.test(phaseUi.text), phaseUi);
await page.goto('http://localhost:5173/#/coach/chat');
await page.waitForSelector('[data-testid="self-ai-status"]', { timeout: 30000 });
await page.waitForFunction(() => !/확인 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 20000 });
const statusLine = await page.textContent('[data-testid="self-ai-status"]');
check('3. 서버 중단: 대화 화면 상태 줄이 "응답 없음"', /자체 검색:\s*응답 없음/.test(statusLine), statusLine);

// ---------- 4 · 5. failure → no Tavily / Gemini, local AI keeps answering ----------
// observation (not pass/fail): the renderer keeps a successful search for 10 minutes (selfResearch/provider.ts)
const cached = await page.evaluate(async (q) => {
  const { selfResearchProvider } = await import('/src/lib/selfResearch/provider.ts');
  const { planTurn } = await import('/src/lib/selfAi/router.ts');
  const p = planTurn(q);
  const o = await selfResearchProvider.search({ query: p.research.queries[0], queries: p.research.queries.slice(1), kind: p.research.kind, maxResults: 8, ...(p.recent ? { recent: true } : {}) });
  return { ok: o.ok, n: o.ok ? o.results.length : 0, code: o.ok ? null : o.code, cache: o.ok ? o.cache ?? null : null };
}, WEB_Q);
report.cacheWhileDown = cached;
check('6-1. 서버 중단 후 같은 질문: 캐시 결과에 실제 검색 시각·만료·현재 서버 상태(응답 없음) 표시', cached.ok && cached.cache && cached.cache.serverUp === false, cached);
r = await turn(WEB_Q);
report.turns.cached = r;
check('6-1. 코치 답변: "이전 검색 결과 사용 중 … 새로 검색한 결과가 아닙니다"', /^🔎 이전 검색 결과 사용 중/.test(r.text) && /검색 서버 현재 상태: 응답 없음/.test(r.text), r.text.split('\n')[0]);
await resetQa();
r = await turn(DOWN_Q);
report.turns.down = r;
log = await qa();
check('4. 검색 실패: status=failed · 실패 사유 표시', r.research?.status === 'failed' && r.text.startsWith('🔎 검색을 시도했지만 실패했습니다'), r.text.split('\n')[0]);
const ws = await page.evaluate(() => window.martialdex.webSearch('weight cutting'));
log = await qa();
check('4. 검색 실패: 레거시 웹 검색(websearch:search)도 실패로 돌려줌', ws.ok === false, ws);
// fallback = Tavily, Gemini, or a Supabase Edge Function (web-search / gemini-ask). The app's ordinary
// Supabase REST reads (공유 콤보 목록 등, not search) are counted separately — blocked here as well.
const FALLBACK = /api\.tavily\.com|generativelanguage\.googleapis\.com|supabase\.co\/functions\//i;
const fallbacks = [...log.blocked, ...rendererBlocked].filter((u) => FALLBACK.test(u));
check('4. 검색 실패: Tavily·Gemini·Edge Function(web-search·gemini-ask) 요청 0건 (메인·렌더러, 테스트 전체)', fallbacks.length === 0 && log.blocked.length === 0, { fallbacks, mainBlocked: log.blocked });
report.rendererSupabaseReads = [...new Set(rendererBlocked.map((u) => u.replace(/\?.*$/, '')))];
console.log(`INFO — 렌더러의 일반 Supabase REST 조회(검색과 무관, 테스트에서 차단): ${rendererBlocked.length}건 ${JSON.stringify(report.rendererSupabaseReads)}`);
check('5. 검색 실패 상태에서도 로컬 AI 답변 생성', r.model && !/^martialdex-/.test(r.model) && !r.dataOnly && r.sources.length === 0, { model: r.model, ms: r.ms });
r = await turn(CHAT_Q);
report.turns.chatWhileDown = r;
check('5. 검색 실패 상태에서 검색 없는 일반 대화도 정상', r.model && !/^martialdex-/.test(r.model) && r.text.length > 30 && r.research?.searched !== true, { intent: r.plan.intent, model: r.model, research: r.research?.status, ms: r.ms });
const tq = await page.evaluate(async () => {
  const { searchTechniques } = await import('/src/lib/search.ts').catch(() => ({}));
  return typeof searchTechniques === 'function' ? searchTechniques('잽').length : null;
});
if (tq !== null) check('5. 검색 실패 상태에서 앱 내부 기술 DB 검색 정상', tq > 0, { hits: tq });

check('Z. 페이지 오류 없음', errors.length === 0, errors);
await page.evaluate(() => window.martialdex.selfSearch.setEnabled(false));
await app.close();
await sleep(2500);
check('Z. 종료 후 앱이 띄운 SearXNG·Ollama 남지 않음', !(await searxUp()) && !(await answers('http://127.0.0.1:11434/api/version')));

fs.writeFileSync(OUT, JSON.stringify(report, null, 2));
console.log(`\nreport: ${OUT}\n${pass}/${pass + fail} passed`);
process.exit(fail ? 1 : 0);
