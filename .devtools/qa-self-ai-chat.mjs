// 자체 AI 코치 — real Electron screen QA (hidden + muted, separate user-data-dir).
// Types into /coach/chat and the lesson screen like a user and checks what is shown:
//   video cards + in-app player, paper list with DOI links, fighter analysis, lesson plan →
//   lesson engine, a question and an addition DURING the lesson (lesson state unchanged),
//   curriculum hand-off, technique answer, and Ollama / SearXNG going down and coming back.
// Outages are simulated with local TCP proxies in front of the user's own Ollama and
// SearXNG (the app is pointed at the proxies) — the user's servers are never stopped.
// Times are end to end in the UI (send → message rendered).
// Requires: Vite dev server :5173, SearXNG :8888, Ollama :11434.
// Run: node .devtools/qa-self-ai-chat.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
const timings = {};
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d && !pass ? ' :: ' + d.slice(0, 500) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A TCP pass-through that can be switched off (connections refused) and on again. */
function proxy(targetPort) {
  let server = null;
  const sockets = new Set();
  let port = 0;
  const start = () =>
    new Promise((resolve) => {
      server = net.createServer((client) => {
        const up = net.connect(targetPort, '127.0.0.1');
        sockets.add(client);
        sockets.add(up);
        client.pipe(up).pipe(client);
        const done = () => { client.destroy(); up.destroy(); sockets.delete(client); sockets.delete(up); };
        client.on('error', done); up.on('error', done); client.on('close', done); up.on('close', done);
      });
      server.listen(port, '127.0.0.1', () => { port = server.address().port; resolve(port); });
    });
  const stop = () => new Promise((resolve) => { for (const s of sockets) s.destroy(); sockets.clear(); server.close(() => resolve()); });
  return { start, stop, get port() { return port; } };
}

const ollama = proxy(11434);
const searx = proxy(8888);
await ollama.start();
await searx.start();

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-selfai-chat-'));
const env = { ...process.env, OLLAMA_HOST_URL: `http://127.0.0.1:${ollama.port}`, SEARXNG_URL: `http://127.0.0.1:${searx.port}` };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.waitForLoadState('load');
  // lessons run with the 자체(MARTIALDEX) coach — no Gemini
  await page.evaluate(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })));
  const go = async (hash) => {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(800);
  };
  const ANSWERS = '[data-testid="self-ai-chat"] .ai-msg--model:not(.ai-msg--pending)';
  const lastAssistant = () => page.evaluate((sel) => { const all = [...document.querySelectorAll(sel)]; return all.length ? all[all.length - 1].innerText : ''; }, ANSWERS);
  const assistantCount = () => page.evaluate((sel) => document.querySelectorAll(sel).length, ANSWERS);
  async function ask(id, text, timeout = 240000) {
    const n = await assistantCount();
    await page.fill('[data-testid="self-ai-input"]', text);
    const t0 = Date.now();
    await page.click('[data-testid="self-ai-send"]');
    // a finished answer: one more assistant message and the composer is free again
    await page.waitForFunction(([n, sel]) => document.querySelectorAll(sel).length > n && !document.querySelector('[data-testid="self-ai-busy"]'), [n, ANSWERS], { timeout });
    timings[id] = Date.now() - t0;
    return lastAssistant();
  }

  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 20000 });
  await page.waitForFunction(() => !/확인 중/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? '확인 중'), null, { timeout: 15000 });
  const st0 = await page.textContent('[data-testid="self-ai-status"]');
  check('[S1] 상태 표시: 로컬 AI·자체 검색 연결', /qwen2\.5:3b|켜짐|사용 가능|연결/.test(st0) && !/꺼짐|미지원/.test(st0), st0);

  // ---- C: video cards + in-app player
  const c = await ask('C_video', '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.');
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="self-ai-videos"]')].pop()?.querySelectorAll('.video-card').length ?? 0);
  const thumbs = await page.evaluate(() => [...[...document.querySelectorAll('[data-testid="self-ai-videos"]')].pop()?.querySelectorAll('.video-card__thumb img') ?? []].map((i) => i.getAttribute('src')));
  check('[C1] 영상 결과가 카드로 표시 (썸네일·제목·채널·상태)', cards >= 3 && thumbs.length >= 3 && thumbs.every((s) => /^https:\/\/i\.ytimg\.com\/vi\//.test(s)), { cards, thumbs: thumbs.slice(0, 2), text: c.slice(0, 200) });
  check('[C2] 영상 내용은 확인하지 않았다고 명시', /영상 내용 자체는 확인하지 않았습니다/.test(c));
  const playable = await page.locator('[data-testid="self-ai-videos"] .video-card[data-embed="embeddable"] [data-testid="video-card-play"]').count();
  if (playable) {
    await page.locator('[data-testid="self-ai-videos"] .video-card[data-embed="embeddable"] [data-testid="video-card-play"]').first().click();
    await page.waitForSelector('[data-testid="video-results-player"] iframe', { timeout: 10000 });
    const src = await page.getAttribute('[data-testid="video-results-player"] iframe', 'src');
    // inside YouTube's player: a <video> element and no error panel (embedding refused / removed)
    let player = null;
    for (let i = 0; i < 30 && !player?.video; i++) {
      await sleep(500);
      const frame = page.frames().find((f) => /youtube\.com\/embed\//.test(f.url()));
      player = frame ? await frame.evaluate(() => ({ video: !!document.querySelector('video'), error: document.querySelector('.ytp-error')?.textContent?.trim() || null, ready: document.readyState })).catch((e) => ({ video: false, error: String(e) })) : null;
    }
    check('[C3] 카드를 누르면 앱 안 플레이어(YouTube embed)가 열리고 영상 요소 로드, 오류 없음', /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}\?autoplay=1/.test(src ?? '') && !!player?.video && !player.error, { src, player });
    check('[C4] 플레이어에 원본 출처·원본 링크 표시', await page.locator('[data-testid="video-results-player"] a', { hasText: '원본에서 보기' }).count() === 1);
  } else check('[C3] 앱에서 재생 가능한 영상이 있음', false, c);
  // mobile width: no horizontal scroll, cards reflow
  await page.setViewportSize({ width: 380, height: 800 });
  await sleep(500);
  const mobile = await page.evaluate(() => { const g = [...document.querySelectorAll('.video-results__grid')].pop(); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1 }; });
  check('[C5] 모바일 폭(380px): 가로 스크롤 없음, 카드 2열', mobile.sw <= mobile.cw + 1 && mobile.cols >= 1 && mobile.cols <= 2, mobile);
  await page.setViewportSize({ width: 1200, height: 900 });

  // ---- B: papers
  const b = await ask('B_paper', '최근 그래플링 관련 스포츠 과학 논문을 찾아 줘. 제목, 연도, 핵심 내용, 원문 링크를 정리해 줘.');
  const doiLinks = await page.evaluate(() => [...[...document.querySelectorAll('[data-testid="self-ai-sources"]')].pop()?.querySelectorAll('a') ?? []].filter((a) => /doi\.org/.test(a.href)).length);
  check('[B1] 논문 목록: 제목(연도)·저자·학술지·DOI·초록·확인 수준', /찾은 논문·연구 자료 \d+건/.test(b) && /\(\d{4}\)/.test(b) && /DOI/.test(b) && /확인 수준/.test(b), b.slice(0, 400));
  check('[B2] 출처 목록에 DOI 링크 보존', doiLinks >= 1, doiLinks);
  check('[B3] 결과가 있는데 "찾지 못했습니다"라고 하지 않음', !/찾지 못했습니다/.test(b));

  // ---- A: technique answer
  const a = await ask('A_technique', 'BJJ의 암바를 설명해 줘. 기술의 원리, 주요 포인트, 흔한 실수와 대응 방법을 알려 줘.');
  check('[A1] 기술 답변: 구역별, 같은 문장 반복 없음', /■ 기술 설명/.test(a) && /■ 핵심 포인트/.test(a) && /■ 흔한 실수와 대응/.test(a) && (a.match(/다리를 상대 머리 위로 완전히 넘기기\./g) ?? []).length === 1, a.slice(0, 300));

  // ---- F: fighter
  const f = await ask('F_fighter', '코너 맥그리거의 타격 스타일을 분석해 줘. 대표적인 셋업, 콤비네이션, 카운터와 근거 자료를 구분해서 정리해 줘.', 300000);
  check('[F1] 선수 분석: 이름 확인·항목별 구역(근거 수준 표시)·요청 항목 요약 (3차 보고서 구성)', /Conor McGregor/.test(f) && /■ 주요 타격 기술\n- .* · (여러 자료에서 공통 확인|출처 1곳의 분석)/.test(f) && /■ 요청하신 항목/.test(f), f.slice(0, 500));
  check('[F2] 논문 검색 실패 문구 없음', !/논문/.test(f));

  // ---- curriculum hand-off
  await ask('curriculum', '8주 동안 무에타이 커리큘럼 짜줘');
  await page.locator('[data-testid="self-ai-action"]').last().click();
  await sleep(1500);
  const cur = await page.evaluate(() => ({ hash: location.hash, text: [...document.querySelectorAll('textarea')].map((t) => t.value).join(' | ') }));
  check('[R1] 커리큘럼 요청 → AI 맞춤 커리큘럼 화면, 요청이 입력됨', cur.hash.startsWith('#/ai-curriculum') && /무에타이 커리큘럼/.test(cur.text), cur);
  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]');

  // ---- D: lesson plan → lesson engine
  const d = await ask('D_lesson', '레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.');
  check('[D1] 수업 계획(코드 작성): 학습 목표·선수 지식·순서·셋업/콤보·상황·복습·자료 부족', ['학습 목표', '선수 지식', '진행 순서', '셋업·콤보', '상황별 적용', '복습', '자료 부족'].every((k) => d.includes(k)) && /레슬링/.test(d), d.slice(0, 600));
  check('[D2] 다른 무술 기록으로 수업하지 않음', !/삼보|Choku/.test(d.split('자료 부족')[0]), d.slice(0, 400));
  await page.locator('[data-testid="self-ai-start-lesson"]').last().click();
  await page.waitForFunction(() => /#\/learning\/wrestling\/chatlesson-[^/]+\/coach\/1/.test(location.hash), null, { timeout: 15000 });
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid="coach-location-home"]').count()) {
      await page.locator('[data-testid="coach-location-home"]').click();
      await page.locator('[data-testid="coach-location-confirm"]').click();
    }
    if (await page.locator('button', { hasText: '입력으로 대화' }).count()) await page.locator('button', { hasText: '입력으로 대화' }).first().click();
    if (await page.locator('[data-testid="coach-chat"]').count()) break;
    await sleep(1500);
  }
  await page.waitForSelector('[data-testid="coach-chat"] [data-kind="explain"]', { timeout: 30000 });
  const lessonText = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].map((e) => e.innerText).join('\n'));
  check('[D3] 수업 엔진이 실제 기록으로 시작 (분류 이름뿐인 설명·빈 인용 없음)', /Single-Leg/.test(lessonText) && !/분류의 기술입니다/.test(lessonText) && !/""/.test(lessonText), lessonText.slice(0, 400));

  // ---- E: a question during the lesson — the lesson state must not change
  const runState = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'); return r && { index: r.index, step: r.step, techniqueIds: r.techniqueIds, outcomes: r.outcomes, lessonState: r.lessonState ?? null, messages: r.messages.length }; });
  const before = await runState();
  const lessonMsgs = () => page.evaluate(() => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length);
  const n0 = await lessonMsgs();
  await page.fill('[data-testid="coach-text-input"]', '지금 배우는 기술에서 상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.');
  const tE = Date.now();
  await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
  await page.waitForFunction((n) => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].slice(n).some((e) => /■ MARTIALDEX 기록/.test(e.innerText)), n0, { timeout: 240000 }).catch(async (e) => {
    console.log('E timeout — messages shown:', JSON.stringify(await page.evaluate((n) => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].slice(n - 2).map((x) => x.innerText.slice(0, 300)), n0)), 'step:', JSON.stringify(await runState()));
    throw e;
  });
  timings.E_lessonQuestion = Date.now() - tE;
  await sleep(800);
  const after = await runState();
  const eText = await page.evaluate((n) => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].slice(n).map((e) => e.innerText).join('\n'), n0);
  check('[E1] 수업 중 질문: 수업 기술의 기록 + 검색 자료(또는 못 읽은 이유) + 복귀 안내', /수업 기술: .*Single-Leg/.test(eText) && /■ 검색 자료/.test(eText) && /수업은 하던 단계에서 그대로 이어집니다/.test(eText), eText.slice(0, 600));
  check('[E2] 수업 단계·진행·결과·엔진 상태 그대로 (메시지만 추가)', before && after && before.index === after.index && before.step === after.step && JSON.stringify(before.outcomes) === JSON.stringify(after.outcomes) && JSON.stringify(before.lessonState) === JSON.stringify(after.lessonState) && after.messages > before.messages, { before, after });
  // ---- adding to the running lesson
  const n1 = await lessonMsgs();
  await page.fill('[data-testid="coach-text-input"]', '이것도 수업에 추가해 줘');
  await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n, n1, { timeout: 60000 });
  await sleep(800);
  // additions are proposed first (3차): nothing changes until the learner presses "수업에 추가"
  const proposed = await runState();
  const addText = await page.evaluate((n) => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].slice(n).map((e) => e.innerText).join('\n'), n1);
  if (await page.locator('[data-testid="lesson-proposal-accept"]').count()) await page.locator('[data-testid="lesson-proposal-accept"]').last().click();
  await sleep(800);
  const added = await runState();
  check('[E3] 수업 중 추가: 제안 → 동의 후 기존 항목 뒤에만 추가(또는 없다고 안내), 진행 위치 유지', proposed.techniqueIds.join() === after.techniqueIds.join() && added.index === after.index && added.step === after.step && added.techniqueIds.slice(0, after.techniqueIds.length).join() === after.techniqueIds.join() && /(추가할까요|찾지 못했습니다)/.test(addText), { addText: addText.slice(0, 200), ids: added.techniqueIds });

  // ---- outages: SearXNG down → honest failure → back up → works
  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]');
  await searx.stop();
  const down = await ask('video_search_down', '로마첸코 풋워크 영상 보여줘', 60000);
  await page.waitForFunction(() => /자체 검색: 꺼짐/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const stDown = await page.textContent('[data-testid="self-ai-status"]');
  check('[O1] SearXNG 꺼짐: 검색 실패를 그대로 안내, 지어낸 영상 없음, 상태 표시 갱신', /검색을 시도했지만 실패했습니다/.test(down) && !/찾은 영상/.test(down) && /자체 검색: (꺼짐|연결 안 됨|사용 불가|off)/.test(stDown.replace(/\s+/g, ' ')) , { down: down.slice(0, 200), stDown });
  await searx.start();
  const up = await ask('video_search_up', '로마첸코 풋워크 영상 보여줘', 60000);
  await page.waitForFunction(() => /자체 검색: 사용 가능/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  check('[O2] SearXNG 다시 켜짐: 같은 화면에서 바로 검색 성공 + 상태 복구', /찾은 영상 \d+개/.test(up) && /자체 검색: 사용 가능/.test(await page.textContent('[data-testid="self-ai-status"]')), up.slice(0, 200));
  // Ollama down → data-only reply, no Gemini → back up → model reply
  await ollama.stop();
  const off = await ask('model_down', '요즘 훈련이 너무 힘들어서 그만두고 싶어', 60000);
  await page.waitForFunction(() => /로컬 AI: 꺼짐/.test(document.querySelector('[data-testid="self-ai-status"]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const stOff = await page.textContent('[data-testid="self-ai-status"]');
  check('[O3] Ollama 꺼짐: 로컬 AI 사용 불가 안내 (다른 모델로 대체하지 않음), 상태 갱신', /로컬 AI 모델을 사용할 수 없어/.test(off) && /로컬 AI: (꺼짐|연결 안 됨|사용 불가|off)/.test(stOff.replace(/\s+/g, ' ')), { off: off.slice(0, 200), stOff });
  await ollama.start();
  const on = await ask('model_up', '안녕하세요', 120000);
  check('[O4] Ollama 다시 켜짐: 같은 화면에서 모델 답변', !/사용할 수 없어/.test(on) && on.trim().length > 0, on.slice(0, 200));

  check('[Z1] 전체 진행 중 페이지 에러 없음', pageErrors.length === 0, pageErrors);
} finally {
  await app.close().catch(() => {});
  await ollama.stop().catch(() => {});
  await searx.stop().catch(() => {});
}
const passed = results.filter((r) => r.pass).length;
console.log('\nUI timings (send → rendered, ms):', JSON.stringify(timings));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-self-ai-chat.json'), JSON.stringify({ at: new Date().toISOString(), results, timings }, null, 2));
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
