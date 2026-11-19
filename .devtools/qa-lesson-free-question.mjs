// 자체 AI 코치 수업 — real Electron screen QA of free questions and video cards DURING a
// lesson (spec 9-B, 9-C). Hidden + muted Electron, separate user-data-dir, real IPC → the
// user's SearXNG + Ollama (not stopped). Types into the lesson screen like a user and checks:
//   questions of several kinds → answers in the lesson (sources / video cards), the lesson
//   state byte-identical after every question, 3+ questions in a row, the return bar and the
//   question history, in-app playback and switching videos, embed-refused / removed states,
//   additions only after "수업에 추가", the engine continuing afterwards, mobile width, and
//   the shared video cards on the technique detail page.
// Requires: Vite dev server :5173, SearXNG :8888, Ollama :11434.
// Run: node .devtools/qa-lesson-free-question.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
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
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d && !pass ? ' :: ' + d.slice(0, 600) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-lesson-q-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const pageErrors = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.waitForLoadState('load');
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.evaluate(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })));
  const go = async (hash) => {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(800);
  };

  // ---- a lesson started the way a user starts one: chat plan → "이 주제로 수업 시작"
  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 20000 });
  await page.fill('[data-testid="self-ai-input"]', '레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.');
  await page.click('[data-testid="self-ai-send"]');
  await page.waitForSelector('[data-testid="self-ai-start-lesson"]', { timeout: 120000 });
  await page.locator('[data-testid="self-ai-start-lesson"]').last().click();
  await page.waitForFunction(() => /#\/learning\/wrestling\/chatlesson-[^/]+\/coach\/1/.test(location.hash), null, { timeout: 15000 });
  for (let i = 0; i < 4; i++) {
    if (await page.locator('[data-testid="coach-location-home"]').count()) {
      await page.locator('[data-testid="coach-location-home"]').click();
      await page.locator('[data-testid="coach-location-confirm"]').click();
    }
    if (await page.locator('button', { hasText: '입력으로 대화' }).count()) await page.locator('button', { hasText: '입력으로 대화' }).first().click();
    if (await page.locator('[data-testid="coach-chat"]').count()) break;
    await sleep(1500);
  }
  await page.waitForSelector('[data-testid="coach-chat"] [data-kind="explain"]', { timeout: 30000 });

  // everything about the run except its messages (what a question must never change)
  const stateKey = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'); if (!r) return null; const { messages, ...rest } = r; return JSON.stringify(rest); });
  const run = () => page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'));
  const sideCount = () => page.evaluate(() => document.querySelectorAll('[data-testid="lesson-side-answer"]').length);
  async function askInLesson(id, text, timeout = 240000) {
    const n = await sideCount();
    const before = await stateKey();
    await page.fill('[data-testid="coach-text-input"]', text);
    const t0 = Date.now();
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="lesson-side-answer"]').length > n, n, { timeout });
    timings[id] = Date.now() - t0;
    await sleep(600);
    const answer = await page.evaluate(() => [...document.querySelectorAll('[data-testid="lesson-side-answer"]')].pop()?.innerText ?? '');
    return { answer, same: before === (await stateKey()), before };
  }
  const startRun = await run();
  const current = startRun.techniqueIds[startRun.index];

  const q1 = await askInLesson('Q1_principle', '이 기술이 정확히 어떤 원리로 작동해?');
  check('[Q1] 원리 질문 → 수업 안에서 답변(지금 기술 기록), 수업 상태 동일', q1.answer.length > 30 && !/^관련 기술은/.test(q1.answer) && /그대로 이어집니다/.test(q1.answer) && q1.same, q1.answer.slice(0, 300));

  const q2 = await askInLesson('Q2_video', '관련 교육 영상을 찾아 줘.');
  const cards = await page.evaluate(() => [...document.querySelectorAll('[data-testid="lesson-side-answer"]')].pop()?.querySelectorAll('[data-testid="lesson-videos"] .video-card').length ?? 0);
  check('[V1] 수업 중 영상 요청 → 답변 아래 영상 카드(썸네일·제목·상태), 상태 동일', cards >= 2 && /찾은 영상 \d+개/.test(q2.answer) && q2.same, { cards, a: q2.answer.slice(0, 200) });
  const cardInfo = await page.evaluate(() => [...[...document.querySelectorAll('[data-testid="lesson-videos"]')].pop()?.querySelectorAll('.video-card') ?? []].map((c) => ({ embed: c.getAttribute('data-embed'), text: c.innerText.slice(0, 120), thumb: c.querySelector('img')?.getAttribute('src') ?? null, link: !!c.querySelector('a[href]') })));
  check('[V2] 카드마다 재생 상태 배지·원본 링크, 썸네일은 i.ytimg.com', cardInfo.length >= 2 && cardInfo.every((c) => c.embed && c.link) && cardInfo.filter((c) => c.thumb).every((c) => /^https:\/\/i\.ytimg\.com\//.test(c.thumb)), cardInfo.slice(0, 3));
  const playBtns = page.locator('[data-testid="lesson-videos"] .video-card[data-embed="embeddable"] [data-testid="video-card-play"]');
  const nPlay = await playBtns.count();
  if (nPlay >= 1) {
    const s0 = await stateKey();
    await playBtns.first().click();
    await page.waitForSelector('[data-testid="lesson-videos"] [data-testid="video-results-player"] iframe', { timeout: 10000 });
    const src1 = await page.getAttribute('[data-testid="lesson-videos"] [data-testid="video-results-player"] iframe', 'src');
    let player = null;
    for (let i = 0; i < 30 && !player?.video; i++) {
      await sleep(500);
      const frame = page.frames().find((f) => /youtube\.com\/embed\//.test(f.url()));
      player = frame ? await frame.evaluate(() => ({ video: !!document.querySelector('video'), error: document.querySelector('.ytp-error')?.textContent?.trim() || null })).catch((e) => ({ video: false, error: String(e) })) : null;
    }
    check('[V3] 수업 화면 안 플레이어로 재생(영상 요소 로드, 오류 없음), 수업 상태 동일', /^https:\/\/www\.youtube\.com\/embed\/[\w-]{11}\?autoplay=1/.test(src1 ?? '') && !!player?.video && !player.error && s0 === (await stateKey()), { src1, player });
    if (nPlay >= 2) {
      await playBtns.nth(1).click();
      await sleep(1200);
      const src2 = await page.getAttribute('[data-testid="lesson-videos"] [data-testid="video-results-player"] iframe', 'src');
      const players = await page.locator('[data-testid="lesson-videos"] [data-testid="video-results-player"] iframe').count();
      check('[V4] 다른 영상으로 전환: 플레이어 1개, 영상 id 변경', players === 1 && !!src2 && src2 !== src1, { src1, src2, players });
    } else check('[V4] 다른 영상으로 전환 (재생 가능 영상 2개 이상 필요)', false, `재생 가능 ${nPlay}개`);
  } else check('[V3] 앱에서 재생 가능한 영상이 있음', false, cardInfo);

  const q3 = await askInLesson('Q3_defense', '상대가 방어하면 어떻게 대응해야 해?');
  check('[Q3] 상대 방어 질문 → 수업 기술 기록 + 검색 자료 처리, 상태 동일', /MARTIALDEX 기록/.test(q3.answer) && /■ 검색 자료/.test(q3.answer) && q3.same, q3.answer.slice(0, 400));
  const q4 = await askInLesson('Q4_prereq', '이 기술을 배우기 전에 알아야 하는 내용이 있어?');
  check('[Q4] 선행 지식 질문 → 기록 기반 답변, 상태 동일', /배우기 전에/.test(q4.answer) && q4.same, q4.answer.slice(0, 300));
  const q5 = await askInLesson('Q5_review', '지금까지 배운 내용을 복습시켜 줘.');
  check('[Q5] 복습 요청 → 핵심 포인트 정리 + 진도 영향 없음, 상태 동일', /지금까지 배운 내용/.test(q5.answer) && /진도에 영향을 주지 않습니다/.test(q5.answer) && q5.same, q5.answer.slice(0, 300));

  // return bar + question history
  const ret = await page.evaluate(() => ({ bar: document.querySelector('[data-testid="lesson-return"]')?.innerText ?? '', items: document.querySelectorAll('[data-testid="lesson-qa-history"] li').length }));
  check('[R1] 수업 위치 표시 + "이 수업에서 한 질문" 5개', /수업 위치/.test(ret.bar) && /질문은 수업 진행에 영향을 주지 않았습니다/.test(ret.bar) && ret.items === 5, ret);
  const sBefore = await stateKey();
  await page.click('[data-testid="lesson-return-continue"]');
  await sleep(700);
  const backMsg = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].pop()?.innerText ?? '');
  const awaitingShown = await page.locator('[data-testid="coach-awaiting"], [data-testid="coach-quiz-wait"]').count();
  check('[R2] "수업 이어서 하기" → 대기 중이던 질문으로 돌아감, 상태 동일', sBefore === (await stateKey()) && (awaitingShown > 0 ? /수업으로 돌아갑니다/.test(backMsg) : true), { backMsg: backMsg.slice(0, 160), awaitingShown });

  // addition: proposal → nothing changes → accept → appended at the end
  const beforeAdd = await run();
  const q6 = await askInLesson('Q6_add', '이 기술의 방어와 대응도 같이 공부하고 싶어.');
  const hasProposal = await page.locator('[data-testid="lesson-proposal"][data-status="pending"]').count();
  check('[A1] 추가 요청 → 제안만(근거 포함), 아직 수업 변경 없음', hasProposal === 1 && /추가할까요/.test(q6.answer) && q6.same, q6.answer.slice(0, 300));
  if (hasProposal) {
    await page.locator('[data-testid="lesson-proposal-accept"]').last().click();
    await sleep(800);
    const afterAdd = await run();
    const ackMsg = await page.evaluate(() => [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].pop()?.innerText ?? '');
    check('[A2] "수업에 추가" → 수업 끝에만 추가, 현재 위치·단계·엔진 상태·결과 그대로', afterAdd.techniqueIds.length > beforeAdd.techniqueIds.length && afterAdd.techniqueIds.slice(0, beforeAdd.techniqueIds.length).join() === beforeAdd.techniqueIds.join() && afterAdd.index === beforeAdd.index && afterAdd.step === beforeAdd.step && JSON.stringify(afterAdd.lessons) === JSON.stringify(beforeAdd.lessons) && /추가했습니다/.test(ackMsg), { before: beforeAdd.techniqueIds, after: afterAdd.techniqueIds, ackMsg });
  }

  // the engine still runs the lesson afterwards
  const lessonBefore = JSON.stringify((await run()).lessons?.[current] ?? null);
  const nAll = await page.evaluate(() => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length);
  if (await page.locator('[data-testid="coach-quick-dont-know"]').count()) {
    await page.click('[data-testid="coach-quick-dont-know"]');
  } else {
    await page.fill('[data-testid="coach-text-input"]', '모르겠어요');
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
  }
  await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n + 1, nAll, { timeout: 60000 }).catch(() => {});
  await sleep(800);
  const lessonAfter = JSON.stringify((await run()).lessons?.[current] ?? null);
  check('[E1] 질문 후 "모르겠어요" → 수업 엔진이 이어서 진행(엔진 상태 갱신)', lessonAfter !== lessonBefore, null);

  // embed refused / removed — the shared card component in this renderer
  const states = await page.evaluate(async () => {
    const React = (await import('/node_modules/.vite/deps/react.js')).default;
    const rdc = await import('/node_modules/.vite/deps/react-dom_client.js');
    const createRoot = rdc.createRoot ?? rdc.default?.createRoot;
    const Cards = (await import('/src/components/video/VideoResultCards.tsx')).default;
    const host = document.createElement('div');
    host.id = 'qa-embed-states';
    document.body.appendChild(host);
    const v = (id, embed) => ({ title: `영상 ${embed}`, url: `https://www.youtube.com/watch?v=${id}`, source: 'youtube.com', video: { videoId: id, embed, thumbnail: `https://i.ytimg.com/vi/${id}/hqdefault.jpg`, channel: '채널' } });
    createRoot(host).render(React.createElement(Cards, { videos: [v('aaaaaaaaaaa', 'not_embeddable'), v('bbbbbbbbbbb', 'unavailable'), v('ccccccccccc', 'embeddable')], testId: 'qa-cards' }));
    await new Promise((r) => setTimeout(r, 400));
    const cs = [...host.querySelectorAll('.video-card')];
    // in-app play = the ▶ overlay + a thumbnail button labelled "앱에서 재생"; otherwise the thumbnail opens the original
    const out = cs.map((c) => ({ embed: c.getAttribute('data-embed'), text: c.innerText, play: !!c.querySelector('.video-card__play') || /앱에서 재생/.test(c.querySelector('[data-testid="video-card-play"]')?.getAttribute('aria-label') ?? ''), opensOriginal: /원본에서 보기/.test(c.querySelector('[data-testid="video-card-play"]')?.getAttribute('aria-label') ?? ''), link: c.querySelector('a[href]')?.getAttribute('href') ?? null }));
    // (not clicked: on a refused video the thumbnail opens the original in the system browser — not done in QA)
    host.remove();
    return out;
  });
  const ne = states.find((s) => s.embed === 'not_embeddable');
  const un = states.find((s) => s.embed === 'unavailable');
  check('[V5] 임베드 금지 영상: "외부 재생 불가" 표시, 앱 재생 없음(썸네일은 원본 열기), 원본 링크', !!ne && /외부 재생 불가/.test(ne.text) && !ne.play && ne.opensOriginal && /youtube\.com\/watch/.test(ne.link ?? ''), ne);
  check('[V6] 삭제·비공개 영상: "재생 불가" 표시, 앱 재생 없음', !!un && /재생 불가/.test(un.text) && !un.play && un.opensOriginal, un);

  // mobile width on the lesson screen
  await page.setViewportSize({ width: 380, height: 800 });
  await sleep(600);
  const mobile = await page.evaluate(() => { const g = [...document.querySelectorAll('[data-testid="lesson-videos"] .video-results__grid')].pop(); return { sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, cols: g ? getComputedStyle(g).gridTemplateColumns.split(' ').length : -1, input: !!document.querySelector('[data-testid="coach-text-input"]') }; });
  check('[M1] 모바일 폭(380px) 수업 화면: 가로 스크롤 없음, 영상 카드 1–2열, 입력창 표시', mobile.sw <= mobile.cw + 1 && mobile.cols >= 1 && mobile.cols <= 2 && mobile.input, mobile);
  await page.setViewportSize({ width: 1200, height: 900 });

  // the same cards on the technique detail page
  await go('#/arts/wrestling/techniques/wrestling__high-single');
  await page.waitForSelector('[data-testid="self-video-search-run"]', { timeout: 20000 });
  const tD = Date.now();
  await page.click('[data-testid="self-video-search-run"]');
  await page.waitForSelector('[data-testid="self-video-search-note"], [data-testid="self-video-search-error"]', { timeout: 60000 });
  timings.detail_video = Date.now() - tD;
  const detail = await page.evaluate(() => ({ note: document.querySelector('[data-testid="self-video-search-note"]')?.textContent ?? document.querySelector('[data-testid="self-video-search-error"]')?.textContent, cards: document.querySelectorAll('[data-testid="self-video-search-results"] .video-card').length }));
  check('[T1] 기술 상세 화면: 같은 영상 카드(자체 검색 + 재생 가능 확인)', detail.cards >= 1 && /찾은 영상 \d+개/.test(detail.note ?? ''), detail);

  check('[Z1] 전체 진행 중 페이지 에러 없음', pageErrors.length === 0, pageErrors);
} finally {
  await app.close().catch(() => {});
}
const passed = results.filter((r) => r.pass).length;
console.log('\nUI timings (send → rendered, ms):', JSON.stringify(timings));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-lesson-free-question.json'), JSON.stringify({ at: new Date().toISOString(), results, timings }, null, 2));
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
