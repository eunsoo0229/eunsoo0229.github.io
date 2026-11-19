// AI 코치 선택 — real Electron app. Verifies that the coach chosen before a
// lesson really decides the call path: the main-process IPC handlers for
// Gemini ('ai:ask'), Tavily ('websearch:search') and the local model
// ('localai:ask') are wrapped with COUNTERS that forward to the real modules,
// so "자체 AI 코치 → Gemini 0 calls" is measured on the real transport.
// Real Gemini/Tavily are called only in the Gemini-coach scenarios.
// Requires the Vite dev server on :5173.  Run: node .devtools/qa-coach-select.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = '/Users/swcho/Documents/MARTIALDEX';
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d ? ' :: ' + d.slice(0, 600) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-coachsel-'))}`], env, timeout: 120000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.waitForLoadState('load');
await sleep(1500);

// ---- counting wrappers around the real IPC handlers (main process)
await app.evaluate(({ ipcMain }) => {
  // Electron keeps ipcMain.handle() handlers in an internal map: wrap the ORIGINAL handlers
  // (real Gemini / Tavily / Ollama) with counters — the real call still happens.
  const map = ipcMain._invokeHandlers;
  if (!map || typeof map.get !== 'function') throw new Error('ipcMain._invokeHandlers not available');
  globalThis.__calls = { 'ai:ask': [], 'websearch:search': [], 'localai:ask': [] };
  for (const ch of Object.keys(globalThis.__calls)) {
    const original = map.get(ch);
    if (!original) throw new Error(`no handler for ${ch}`);
    map.set(ch, async (e, arg) => {
      globalThis.__calls[ch].push(typeof arg === 'object' ? String(arg?.question ?? arg?.prompt ?? '').slice(0, 80) : String(arg).slice(0, 80));
      return original(e, arg);
    });
  }
});
const calls = () => app.evaluate(() => JSON.parse(JSON.stringify(globalThis.__calls)));
const resetCalls = () => app.evaluate(() => { for (const k of Object.keys(globalThis.__calls)) globalThis.__calls[k] = []; });
const goto = async (hash) => {
  await page.evaluate(() => { window.location.hash = '#/'; });
  await sleep(300);
  await page.evaluate((h) => { window.location.hash = h; }, hash);
  await sleep(1800);
};
const run = () => page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') ?? 'null'));
/** Coach lines on either lesson screen (curriculum: .ai-msg--model, one-off: .oneoff-msg[data-role=coach]). */
const COACH_LINE = '.ai-msg--model, .oneoff-msg[data-role="coach"]';
const coachLines = () => page.evaluate((sel) => document.querySelectorAll(sel).length, COACH_LINE);
/** Types + Enter, then waits until the coach has replied (input enabled again, nothing loading, a new coach line). */
const send = async (text, input = '[data-testid="coach-text-input"]') => {
  const box = page.locator(input);
  await box.waitFor({ timeout: 30000 });
  await page.waitForFunction((sel) => !document.querySelector(sel)?.disabled, input, { timeout: 300000 });
  const n = await coachLines();
  await box.fill(text);
  await box.press('Enter');
  await page.waitForFunction(
    ({ sel, n, line }) => !document.querySelector(sel)?.disabled && !document.querySelector('.ai-msg__bubble--loading') && document.querySelectorAll(line).length > n,
    { sel: input, n, line: COACH_LINE },
    { timeout: 300000 }
  );
  await sleep(600);
};
const lastCoach = (sel) => page.evaluate((s) => [...document.querySelectorAll(`${s} .ai-msg--model .ai-msg__bubble`)].map((x) => x.textContent).slice(-3), sel);

const DAY = '#/learning/bjj/official__bjj/coach/6?mode=text&place=home';

// ================================================================ A. picker before the lesson
await page.evaluate(() => { localStorage.removeItem('martialdex:coach-kind-pref'); localStorage.removeItem('martialdex:ai-coach-day-run'); });
await goto(DAY);
const pickerShown = await page.locator('[data-testid="coach-picker"]').count();
const status = await page.locator('[data-testid="coach-pick-martialdex"]').getAttribute('data-local-status');
check('[A1] 수업 시작 전 코치 선택 화면, 선택 전에는 수업 세션이 만들어지지 않음', pickerShown === 1 && (await run()) === null, { pickerShown });
check('[A2] 두 코치 카드 표시 + 자체 코치 카드에 이 기기의 로컬 모델 상태 표시', (await page.locator('[data-testid="coach-pick-gemini"]').count()) === 1 && !!status && status !== 'checking', { status });

// ================================================================ B. 자체 AI 코치 → no Gemini, no web search
await resetCalls();
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await sleep(2500);
let r = await run();
check('[B1] 자체 코치 선택이 세션에 저장되고 화면에 표시', r?.coachKind === 'martialdex' && (await page.locator('[data-testid="coach-kind"]').getAttribute('data-coach')) === 'martialdex' && page.url().includes('coach=martialdex'), { coachKind: r?.coachKind, url: page.url() });
const techId = r?.techniqueIds?.[r.index];
await send('발은 어떻게 해요?');
const qa1 = await lastCoach('[data-testid="coach-chat"]');
await send('상대를 잡고 넘기는 기술 같아요');
const qa2 = await lastCoach('[data-testid="coach-chat"]');
let c = await calls();
check('[B2] 자체 코치: 질문 답변·답변 채점 동안 Gemini(ai:ask) 0회, 웹 검색 0회', c['ai:ask'].length === 0 && c['websearch:search'].length === 0, { calls: { ai: c['ai:ask'].length, web: c['websearch:search'].length, local: c['localai:ask'].length }, techId });
check('[B3] 자료에 근거한 답(또는 "자료에 없음" 안내)이고, 로컬 모델이 없으면 그 사실을 알림', qa1.some((t) => /MARTIALDEX/.test(t) && (/자료에 따르면|내용이 없습니다|확인되지 않/.test(t))), qa1);
check('[B4] 답변 채점은 결정론적 판정 문구로 진행 (Gemini 피드백 아님)', qa2.some((t) => /짚으셨습니다|한 가지가 더|다르게 생각|흔히 하는 실수|자료가 부족/.test(t)), qa2);

// ================================================================ C. switch mid-lesson → Gemini, explicit, progress kept
const before = await run();
await page.locator('[data-testid="coach-switch-open"]').click();
await page.locator('[data-testid="coach-switch"] [data-testid="coach-pick-gemini"]').click();
await page.locator('[data-testid="coach-switch"] [data-testid="coach-pick-confirm"]').click();
await page.locator('[data-testid="coach-switch-confirm"]').waitFor();
const confirmText = await page.locator('[data-testid="coach-switch-confirm"]').textContent();
await page.locator('[data-testid="coach-switch-keep"]').click();
await sleep(1500);
r = await run();
check('[C1] 수업 중 전환은 어떻게 할지 묻고(진행 유지/처음부터), 진행 유지 시 같은 세션에 전환 기록', /진행 유지/.test(confirmText) && /처음부터/.test(confirmText) && r.id === before.id && r.coachKind === 'gemini' && r.coachSwitches?.length === 1 && r.coachSwitches[0].from === 'martialdex' && r.messages.length >= before.messages.length, { id: r.id === before.id, coachKind: r.coachKind, switches: r.coachSwitches });
await resetCalls();
await send('이 기술은 언제 쓰나요?');
c = await calls();
const gemAnswer = await lastCoach('[data-testid="coach-chat"]');
check('[C2] Gemini 코치로 바꾼 뒤 질문은 기존 Gemini 경로(ai:ask)로 감', c['ai:ask'].length >= 1 && c['localai:ask'].length === 0, { ai: c['ai:ask'], answer: gemAnswer.slice(-1) });

// ================================================================ D. legacy run (no coach) is resumed, not guessed
const legacy = { ...(await run()) };
delete legacy.coachKind;
delete legacy.coachSwitches;
await page.evaluate((x) => localStorage.setItem('martialdex:ai-coach-day-run', JSON.stringify(x)), legacy);
await goto(DAY);
check('[D1] 코치 정보 없는 이전 세션: 코치를 묻고(Gemini로 추정 안 함)', (await page.locator('[data-testid="coach-picker"]').count()) === 1, '');
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await sleep(2000);
r = await run();
check('[D2] 고른 코치로 같은 세션을 이어가고 "이전 세션" 안내 + 전환 기록(from unknown)', r.id === legacy.id && r.coachKind === 'martialdex' && r.coachSwitches?.[0]?.from === 'unknown' && r.messages.some((m) => m.text.includes('코치 정보가 없던 이전 세션')), { id: r.id === legacy.id, coachKind: r.coachKind, sw: r.coachSwitches });

// ================================================================ E. one-off lesson: separate session, own coach
await resetCalls();
await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
await goto('#/coach/lesson');
await page.locator('[data-testid="oneoff-request"]').fill('오늘 잽을 배우고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="coach-picker"]').waitFor({ timeout: 10000 });
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
const oneoff = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null'));
c = await calls();
check('[E1] 1회성 수업도 만들기 전에 코치 선택 → 자체 코치는 DB 기술로 수업 생성, Gemini·웹 검색 0회', oneoff?.coachKind === 'martialdex' && !!oneoff.lesson.techniqueId && oneoff.lesson.webSearch.called === false && c['ai:ask'].length === 0 && c['websearch:search'].length === 0, { kind: oneoff?.coachKind, tech: oneoff?.lesson.techniqueId, calls: { ai: c['ai:ask'].length, web: c['websearch:search'].length } });
check('[E2] 커리큘럼 세션의 코치(자체)와 1회성 세션의 코치가 각자 저장 — 섞이지 않음', (await run()).coachKind === 'martialdex' && oneoff.coachKind === 'martialdex' && (await run()).id === legacy.id, '');
const oneoffSend = '[data-testid="oneoff-answer"]';
await send('잽 칠 때 발은 어떻게 해요?', oneoffSend);
const oneoffAnswer = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null')?.messages.filter((m) => m.role === 'coach').map((m) => m.text).slice(-2));
c = await calls();
check('[E3] 1회성 자체 코치 질문 답변도 Gemini 없이 기술 자료로 (잽의 발 위치는 자료에 있음)', c['ai:ask'].length === 0 && (oneoffAnswer ?? []).some((t) => /발 위치|MARTIALDEX 자료/.test(t)), { ai: c['ai:ask'].length, oneoffAnswer, sendFound: !!oneoffSend });

// not in DB → refused, Gemini only offered, never auto-used
await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
await goto('#/coach/lesson');
await resetCalls();
await page.locator('[data-testid="oneoff-request"]').fill('오늘은 거리 조절 전략을 배우고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await sleep(1500);
const err = await page.locator('[data-testid="oneoff-error"]').textContent().catch(() => '');
c = await calls();
check('[E4] DB에 없는 주제: 자체 코치는 거절하고 Gemini는 버튼으로만 제안 (자동 전환·호출 없음)', /DB에 있는 기술만/.test(err) && (await page.locator('[data-testid="oneoff-use-gemini"]').count()) === 1 && c['ai:ask'].length === 0 && c['websearch:search'].length === 0, { err, ai: c['ai:ask'].length });

// ================================================================ F. remember the choice
await page.evaluate(() => localStorage.removeItem('martialdex:ai-coach-day-run'));
await goto(DAY);
await page.locator('[data-testid="coach-pick-gemini"]').click();
await page.locator('[data-testid="coach-pick-remember"]').check();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await sleep(1500);
await page.evaluate(() => localStorage.removeItem('martialdex:ai-coach-day-run'));
await goto('#/learning/bjj/official__bjj/coach/6?mode=text&place=home');
r = await run();
check('[F1] "다음부터 묻지 않기"를 고르면 다음 수업은 그 코치로 바로 시작 (화면에서 바꿀 수 있음)', (await page.locator('[data-testid="coach-picker"]').count()) === 0 && r?.coachKind === 'gemini' && (await page.locator('[data-testid="coach-switch-open"]').count()) === 1, { coachKind: r?.coachKind });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));

// ================================================================ G. local model path (only when Ollama is running)
// The local model is OFF by default since 2026-10-25 (localModelEnabled); G / H3 run only when this device switched it on.
const localOn = await page.evaluate(() => localStorage.getItem('martialdex:coach-local-model') === 'on');
const localStatus = await page.evaluate(() => window.martialdex?.localAi?.status());
if (localOn && localStatus?.ok) {
  await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
  await goto('#/coach/lesson');
  await resetCalls();
  await page.locator('[data-testid="oneoff-request"]').fill('오늘 잽을 배우고 싶어');
  await page.locator('[data-testid="oneoff-build"]').click();
  await page.locator('[data-testid="coach-pick-martialdex"]').click();
  await page.locator('[data-testid="coach-pick-confirm"]').click();
  await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
  const t0 = Date.now();
  await send('잽의 핵심 포인트가 뭐예요?', '[data-testid="oneoff-answer"]');
  const ms = Date.now() - t0;
  c = await calls();
  const ans = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null')?.messages.filter((m) => m.role === 'coach' && m.kind === 'answer').map((m) => m.text).slice(-1)[0] ?? '');
  const usedModel = !/기술 자료의 내용을 그대로 안내합니다/.test(ans);
  check('[G1] 로컬 모델 사용 가능 시: 자체 코치 질문은 로컬 모델(localai:ask)로, Gemini 0회', c['localai:ask'].length >= 1 && c['ai:ask'].length === 0, { local: c['localai:ask'].length, ai: c['ai:ask'].length, ms });
  check('[G2] 로컬 모델 답은 검사 통과 시에만 사용, 통과 못 하면 자료 원문 + 이유 안내', usedModel ? ans.length > 8 && !/kỹ|다리를 가슴에 올려서 다리를/.test(ans) : /확인되지 않아|기술 자료의 내용을 그대로/.test(ans), { usedModel, ans: ans.slice(0, 300) });
  const before = c['localai:ask'].length;
  await send('잽 칠 때 골반은 어떻게 해요?', '[data-testid="oneoff-answer"]');
  c = await calls();
  const ans2 = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null')?.messages.filter((m) => m.role === 'coach' && m.kind === 'answer').map((m) => m.text).slice(-1)[0] ?? '');
  check('[G3] 근거가 없는 질문(잽의 골반)은 로컬 모델도 호출하지 않고 "자료에 없음"', c['localai:ask'].length === before && /내용이 없습니다/.test(ans2), { calls: c['localai:ask'].length - before, ans2: ans2.slice(0, 200) });
} else {
  console.log('SKIP — [G] 로컬 모델 경로: 로컬 모델이 꺼져 있음(기본값) 또는 Ollama 미실행', JSON.stringify({ localOn, status: localStatus?.reason ?? (localStatus?.ok ? 'ready' : null) }));
}

// ================================================================ H. one-off: Korean names, choosing among same-named techniques, waiting on the local model
await page.evaluate(() => { localStorage.removeItem('martialdex:coach-oneoff-session'); localStorage.removeItem('martialdex:coach-kind-pref'); });
await goto('#/coach/lesson');
await resetCalls();
await page.locator('[data-testid="oneoff-request"]').fill('오늘 암바 배우고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
let h = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null'));
c = await calls();
check('[H1] 자체 코치 1회성 수업: "암바"(한국어 이름) 요청 → Armbar 수업, Gemini·웹 검색 0회', h?.lesson.techniqueId === 'bjj__armbar' && c['ai:ask'].length === 0 && c['websearch:search'].length === 0, { tech: h?.lesson.techniqueId, ai: c['ai:ask'].length });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
await goto('#/coach/lesson');
await page.locator('[data-testid="oneoff-request"]').fill('페인트 배우고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await page.locator('[data-testid="oneoff-technique-choices"]').waitFor({ timeout: 10000 });
const choiceIds = await page.locator('[data-testid="oneoff-technique-choice"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-technique-id')));
const lessonBeforePick = await page.evaluate(() => localStorage.getItem('martialdex:coach-oneoff-session'));
await page.locator('[data-testid="oneoff-technique-choice"]').nth(1).click();
await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
h = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null'));
c = await calls();
check('[H2] 같은 이름의 기술이 여러 개("페인트")면 자동으로 고르지 않고 후보 버튼 → 고른 기술로 수업', choiceIds.length >= 2 && lessonBeforePick === null && h?.lesson.techniqueId === choiceIds[1] && c['ai:ask'].length === 0, { choiceIds, picked: h?.lesson.techniqueId });

if (localOn && (await page.evaluate(() => window.martialdex?.localAi?.status()))?.ok) {
  // fresh renderer state (the model back-off of earlier sections is per app session)
  await page.reload();
  await page.waitForLoadState('load');
  await sleep(1500);
  await page.evaluate(() => { localStorage.removeItem('martialdex:coach-oneoff-session'); localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })); });
  await goto('#/coach/lesson');
  await page.locator('[data-testid="oneoff-request"]').fill('오늘 잽을 배우고 싶어');
  await page.locator('[data-testid="oneoff-build"]').click();
  await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
  await page.waitForFunction(() => !document.querySelector('[data-testid="oneoff-answer"]')?.disabled, null, { timeout: 60000 });
  await page.locator('[data-testid="oneoff-answer"]').fill('잽의 핵심 포인트가 뭐예요?');
  await page.locator('[data-testid="oneoff-answer"]').press('Enter');
  const waitShown = await page.locator('[data-testid="local-model-wait"]').waitFor({ timeout: 15000 }).then(() => true).catch(() => false);
  const waitText = waitShown ? await page.locator('[data-testid="local-model-wait"]').textContent() : '';
  await sleep(2500);
  const t0 = Date.now();
  if (waitShown) await page.locator('[data-testid="local-model-wait-cancel"]').click().catch(() => {});
  await page.waitForFunction(() => !document.querySelector('[data-testid="oneoff-answer"]')?.disabled, null, { timeout: 60000 });
  const afterCancelMs = Date.now() - t0;
  const ansH = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null')?.messages.filter((m) => m.role === 'coach' && m.kind === 'answer').map((m) => m.text).slice(-1)[0] ?? '');
  check('[H3] 로컬 모델 대기 중 경과 시간·제한(45초) 표시, "자료 원문으로 보기"로 바로 취소 → 자료 문장으로 수업 계속', waitShown && /최대 45초/.test(waitText) && afterCancelMs < 5000 && /기다리지 않고/.test(ansH) && (await page.locator('[data-testid="local-model-wait"]').count()) === 0, { waitText, afterCancelMs, ansH: ansH.slice(0, 200) });
  await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));
} else {
  console.log('SKIP — [H3] 로컬 모델 대기·취소: 로컬 모델이 꺼져 있음(기본값) 또는 Ollama 미실행');
}

// ================================================================ I. a whole lesson with the 자체 AI 코치 (curriculum)
// explain → question → "모르겠어요" → re-explanation → the student says the key point → graded → feedback → next concept → … → video
await page.evaluate(() => { localStorage.removeItem('martialdex:ai-coach-day-run'); localStorage.removeItem('martialdex:coach-kind-pref'); });
await goto(DAY);
await page.locator('[data-testid="coach-pick-martialdex"]').click();
await page.locator('[data-testid="coach-pick-confirm"]').click();
await sleep(2500);
await resetCalls();
const lessonOf = async () => {
  const x = await run();
  return { run: x, lesson: x?.lessons?.[x.techniqueIds[x.index]] ?? null };
};
let saidDontKnow = false;
const trace = [];
for (let turn = 0; turn < 24; turn++) {
  const { run: x, lesson } = await lessonOf();
  if (!lesson?.pending || ['VIDEO', 'PRACTICE', 'PRE_PRACTICE_CHECK', 'COMPLETE'].includes(lesson.currentStage)) break;
  const p = lesson.pending;
  const coachTexts = x.messages.filter((m) => m.role === 'coach').map((m) => m.text);
  let answer;
  if (p.choice) answer = String.fromCharCode(65 + p.choice.answerIndex);
  else if (p.type === 'confirm') answer = '네 이해했어요';
  else if (!saidDontKnow && p.conceptId?.startsWith('kp-')) {
    answer = '모르겠어요';
    saidDontKnow = true;
  } else {
    // the student repeats what the coach taught, in their words: the quoted key point / the technique description
    const lastExplain = [...coachTexts].reverse().find((t) => /핵심은|정리하면|기술입니다|동작입니다|입니다\./.test(t)) ?? '';
    const quoted = lastExplain.match(/"([^"]{6,})"/)?.[1] ?? lastExplain.match(/핵심은 (.{6,}?)(?:하는 것)?입니다/)?.[1] ?? lastExplain.split(/[.!?]/)[0];
    answer = `${quoted.replace(/[“”"]/g, '').trim()}요`;
  }
  await send(answer);
  const after = await lessonOf();
  trace.push({ q: p.type, concept: p.conceptId, answer: answer.slice(0, 40), stage: after.lesson?.currentStage, done: after.lesson?.completedConcepts });
}
const fin = await lessonOf();
const msgs = fin.run.messages;
c = await calls();
const dontKnowAt = msgs.findIndex((m) => m.role === 'user' && m.text === '모르겠어요');
const reexplained = dontKnowAt >= 0 && msgs.slice(dontKnowAt + 1, dontKnowAt + 4).some((m) => m.role === 'coach' && (m.kind === 'explain' || m.kind === 'feedback'));
const understoodFeedback = msgs.some((m) => m.role === 'coach' && m.kind === 'feedback' && /짚으셨습니다|맞습니다|좋습니다/.test(m.text));
check('[I1] 자체 코치 수업: 설명 → 질문 → "모르겠어요" → 재설명 → 핵심을 말한 답 → 이해 판정 → 다음 개념, 영상/실습 단계까지 진행', reexplained && understoodFeedback && (fin.lesson?.completedConcepts?.length ?? 0) >= 2 && ['VIDEO', 'PRACTICE', 'PRE_PRACTICE_CHECK', 'COMPLETE'].includes(fin.lesson?.currentStage ?? fin.run.step?.toUpperCase()), { stage: fin.lesson?.currentStage, step: fin.run.step, done: fin.lesson?.completedConcepts, trace });
check('[I2] 수업 전체에서 Gemini 0회 · 웹 검색 0회 (채점은 결정론적)', c['ai:ask'].length === 0 && c['websearch:search'].length === 0, { ai: c['ai:ask'].length, web: c['websearch:search'].length, local: c['localai:ask'].length });
console.log('    수업 기록 (자체 코치):');
for (const m of msgs.slice(-40)) console.log(`      ${m.role === 'user' ? '학생' : `코치[${m.kind ?? ''}]`}: ${m.text.slice(0, 160)}`);

// ================================================================ J. 자체 코치: 기술 질문 + MARTIALDEX 기능 실행 (실제 화면)
await page.evaluate(() => { localStorage.removeItem('martialdex:ai-coach-day-run'); localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })); });
await goto(DAY);
await sleep(1500);
await resetCalls();
const lessonUrl = page.url();
const runBefore = await run();
await send('이 기술에서 흔히 하는 실수는?');
const jAnswer = (await run()).messages.filter((m) => m.role === 'coach').map((m) => m.text).slice(-3).join(' | ');
check('[J1] 수업 중 기술 질문 → 지금 기술의 자료로 답(또는 자료 없음 안내), 추측 없음', /MARTIALDEX 자료에 따르면|내용이 없습니다/.test(jAnswer), jAnswer.slice(0, 300));
const nBefore = await coachLines();
await page.locator('[data-testid="coach-text-input"]').fill('이제 레슬링 솔로 드릴을 해볼래');
await page.locator('[data-testid="coach-text-input"]').press('Enter');
await page.locator('[data-testid="coach-action"]').waitFor({ timeout: 10000 });
const card = { feature: await page.locator('[data-testid="coach-action"]').getAttribute('data-feature'), text: await page.locator('[data-testid="coach-action-message"]').textContent() };
check('[J2] 수업 중 "레슬링 솔로 드릴을 해볼래" → 기존 미트(레슬링 공격 지시) 열기 전 확인 + 수업 저장·복귀 안내', card.feature === 'mitt_command' && /레슬링 솔로 드릴/.test(card.text) && /돌아오면 이어서/.test(card.text) && (await coachLines()) > nBefore, card);
await page.locator('[data-testid="coach-action-open"]').click();
await page.waitForFunction(() => location.hash.startsWith('#/coach/mitt'), null, { timeout: 10000 });
await sleep(1500);
const mitt = await page.evaluate(() => ({
  hash: location.hash,
  tab: document.querySelector('[data-testid="mitt-tab-command"]')?.getAttribute('aria-selected'),
  art: document.querySelector('[data-testid="mitt-art-filter"]')?.value,
  start: !!document.querySelector('[data-testid="command-start"]'),
}));
check('[J3] 실제 기존 미트 화면이 "공격 지시" 탭·레슬링으로 열림 (시작 버튼 존재)', mitt.tab === 'true' && mitt.art === 'wrestling' && mitt.start, mitt);
await page.goBack();
await sleep(2000);
const runAfter = await run();
check('[J4] 뒤로 가기 → 같은 수업 세션으로 복귀 (진행 상황 보존)', page.url() === lessonUrl && runAfter?.id === runBefore?.id && (runAfter.messages.length >= runBefore.messages.length) && (await page.locator('[data-testid="coach-chat"]').count()) === 1, { url: page.url(), same: runAfter?.id === runBefore?.id });
// entry box of the one-off lesson (no lesson yet)
await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
await goto('#/coach/lesson');
await page.locator('[data-testid="oneoff-request"]').fill('잽은 어떻게 해?');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="oneoff-entry-answer"]').waitFor({ timeout: 10000 });
const entryAns = await page.locator('[data-testid="oneoff-entry-answer"]').textContent();
check('[J5] 1회성 입력창의 기술 질문 → 수업을 만들지 않고 그 자리에서 자료로 답함', /MARTIALDEX 자료에 따르면/.test(entryAns) && /동작 단계/.test(entryAns) && (await page.evaluate(() => localStorage.getItem('martialdex:coach-oneoff-session'))) === null, entryAns.slice(0, 200));
await page.locator('[data-testid="oneoff-request"]').fill('3분 훈련하고 1분 쉬고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.waitForFunction(() => location.hash.startsWith('#/free-training/sparring'), null, { timeout: 10000 });
await sleep(1500);
const timer = await page.evaluate(() => ({ hash: location.hash, roundTime: document.querySelector('[data-testid="sparring-round-time"]')?.value, rounds: document.querySelector('[data-testid="sparring-rounds"]')?.value }));
check('[J6] 1회성 입력창 "3분 훈련하고 1분 쉬고 싶어" → 기존 라운드 타이머 화면이 그 설정으로 열림', /mode=timer/.test(timer.hash) && /round=180/.test(timer.hash) && /rest=60/.test(timer.hash) && timer.roundTime === '180' && timer.rounds === '3', timer);
c = await calls();
check('[J7] J 구간 전체: Gemini 0회 · 웹 검색 0회 · 로컬 모델 0회 (기본값 꺼짐)', c['ai:ask'].length === 0 && c['websearch:search'].length === 0 && c['localai:ask'].length === 0, { ai: c['ai:ask'].length, web: c['websearch:search'].length, local: c['localai:ask'].length });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));

// ================================================================ K. 자체 코치 품질: 후속 질문 문맥 · 개인 맞춤 타격 수업 → 기존 미트
await page.evaluate(() => { localStorage.removeItem('martialdex:coach-oneoff-session'); localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })); });
await goto('#/coach/lesson');
await resetCalls();
const entryAsk = async (q) => {
  const before = await page.locator('[data-testid="oneoff-entry-answer"]').textContent().catch(() => '');
  await page.locator('[data-testid="oneoff-request"]').fill(q);
  await page.locator('[data-testid="oneoff-build"]').click();
  await page.waitForFunction((b) => { const el = document.querySelector('[data-testid="oneoff-entry-answer"]'); return !!el && el.textContent !== b; }, before, { timeout: 10000 });
  return page.locator('[data-testid="oneoff-entry-answer"]').textContent();
};
const k1 = await entryAsk('잽 어떻게 해?');
const k2 = await entryAsk('칠 때 발은?');
check('[K1] 입력창: "잽 어떻게 해?"(개요·단계·핵심·실수) → "칠 때 발은?"은 같은 기술(잽)의 발 자료로 이어서 답함', /수행 방법/.test(k1) && /핵심 포인트/.test(k1) && /잽/.test(k2) && /발/.test(k2) && !/어떤 기술에 대한 질문인지/.test(k2), { k1: k1.slice(0, 120), k2: k2.slice(0, 160) });
await page.locator('[data-testid="oneoff-request"]').fill('MMA 타격 수업 하고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.locator('[data-testid="oneoff-lesson"]').waitFor({ timeout: 30000 });
const kl = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null'));
const chip = await page.locator('[data-testid="oneoff-personalized"]').textContent().catch(() => '');
check('[K2] "MMA 타격 수업 하고 싶어" → 자체 코치가 DB 기술로 수업 생성(개선 전: 거절), 계획·기록 반영 표시 (기록 없음을 그대로 밝힘)', !!kl?.lesson.techniqueId && /오늘 계획/.test(kl.lesson.intro) && /학습 기록 없음/.test(chip), { tech: kl?.lesson.techniqueId, chip });
// drive the lesson to its practice step (skip questions, finish the video) → the existing posture → mitt flow
for (let i = 0; i < 30; i++) {
  if (await page.locator('[data-testid="oneoff-posture"]').count()) break;
  if (await page.locator('[data-testid="oneoff-video-done"]').count()) {
    await page.locator('[data-testid="oneoff-video-done"]').click();
    await sleep(800);
    continue;
  }
  const disabled = await page.evaluate(() => document.querySelector('[data-testid="oneoff-answer"]')?.disabled ?? true);
  if (disabled) { await sleep(800); continue; }
  await page.locator('[data-testid="oneoff-answer"]').fill('건너뛰기');
  await page.locator('[data-testid="oneoff-answer"]').press('Enter');
  await sleep(900);
}
const postureShown = (await page.locator('[data-testid="oneoff-posture"]').count()) === 1;
if (postureShown) await page.locator('[data-testid="oneoff-posture-start"]').click();
await sleep(1500);
const kMitt = await page.evaluate(() => ({ ids: document.querySelector('[data-testid="oneoff-mitt"]')?.getAttribute('data-ids') ?? null, runner: !!document.querySelector('[data-testid="mitt-runner"]') }));
check('[K3] 계획한 타격 수업의 실습 단계 → 기존 Visualizing Mitt가 그 기술로 열림', postureShown && kMitt.runner && !!kMitt.ids && kMitt.ids.split(',').includes(kl.lesson.techniqueId), { postureShown, ...kMitt, tech: kl?.lesson.techniqueId });
c = await calls();
check('[K4] K 구간 전체: Gemini 0 · 웹 검색 0 · 로컬 모델 0', c['ai:ask'].length === 0 && c['websearch:search'].length === 0 && c['localai:ask'].length === 0, { ai: c['ai:ask'].length, web: c['websearch:search'].length, local: c['localai:ask'].length });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));

// ================================================================ L. 자체 코치 세션 대화: 잽 연습 → (미트) → 왜? → 끝났어 → 다음 뭐 하지?
await page.evaluate(() => { localStorage.removeItem('martialdex:coach-oneoff-session'); sessionStorage.removeItem('martialdex:coach-dialog'); localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })); });
await goto('#/coach/lesson');
await resetCalls();
await page.locator('[data-testid="oneoff-request"]').fill('잽 연습하고 싶어');
await page.locator('[data-testid="oneoff-build"]').click();
await page.waitForFunction(() => location.hash.startsWith('#/coach/mitt'), null, { timeout: 10000 });
const lMitt = await page.evaluate(() => location.hash);
await page.goBack();
await sleep(1800);
const lWhy = await entryAsk('왜?');
const lDone = await entryAsk('끝났어');
const lNext = await entryAsk('다음 뭐 하지?');
check('[L1] "잽 연습하고 싶어" → 미트(잽) → 돌아와서 "왜?"는 그 미트를 고른 이유 + 자료 핵심 포인트', /single(%3A|:)kickboxing__jab/.test(lMitt) && /미트/.test(lWhy) && /핵심 포인트/.test(lWhy), { lMitt, lWhy: lWhy.slice(0, 160) });
check('[L2] "끝났어" → 저장된 기록이 없으면 완료라고 단정하지 않음 · "다음 뭐 하지?" → 잽의 다음 기술', /확인되지 않습니다/.test(lDone) && /잽|Jab/.test(lNext) && /다음|연결/.test(lNext), { lDone: lDone.slice(0, 120), lNext: lNext.slice(0, 140) });
c = await calls();
check('[L3] L 구간: Gemini 0 · 웹 검색 0 · 로컬 모델 0', c['ai:ask'].length === 0 && c['websearch:search'].length === 0 && c['localai:ask'].length === 0, { ai: c['ai:ask'].length });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));

// ================================================================ M. 실제 앱: 저장된 목표 기반 수업 · 미트 선택 (이전 라운드 미확인 항목)
await page.evaluate(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })));
const goalLesson = async (goal, request) => {
  await page.evaluate((g) => {
    localStorage.removeItem('martialdex:coach-oneoff-session');
    if (g) localStorage.setItem('martialdex:curricula:custom', JSON.stringify([{ id: 'qa-goal', title: 'QA 목표', martialArt: 'mixed-martial-arts', days: [], totalDays: 0, createdAt: '2026-10-01', updatedAt: new Date().toISOString(), aiGoalMeta: { goalText: g } }]));
    else localStorage.removeItem('martialdex:curricula:custom');
  }, goal);
  await page.reload();
  await page.waitForLoadState('load');
  await sleep(1500);
  await goto('#/coach/lesson');
  await page.locator('[data-testid="oneoff-request"]').fill(request);
  await page.locator('[data-testid="oneoff-build"]').click();
  await page.waitForFunction(() => document.querySelector('[data-testid="oneoff-lesson"]') || document.querySelector('[data-testid="oneoff-error"]'), null, { timeout: 15000 });
  return page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem('martialdex:coach-oneoff-session') ?? 'null');
    return { tech: s?.lesson.techniqueId ?? null, art: s?.lesson.martialArt ?? null, intro: s?.lesson.intro ?? '', error: document.querySelector('[data-testid="oneoff-error"]')?.textContent ?? null };
  });
};
await resetCalls();
let g = await goalLesson(null, '오늘 수업 해줘');
check('[M1] 저장된 목표 없음 + "오늘 수업 해줘" → 종목을 물음 (수업을 지어내지 않음)', !g.tech && /어느 무술/.test(g.error ?? ''), g);
g = await goalLesson('타격 위주로 실력 늘리기', '오늘 수업 해줘');
check('[M2] 목표 "타격 위주" → 스탠딩 타격 기술 수업, 목표 반영 표시', !!g.tech && /boxing|kickboxing|muay-thai|mixed-martial-arts/.test(g.tech) && /저장된 목표/.test(g.intro), { tech: g.tech, intro: g.intro.slice(60, 220) });
g = await goalLesson('MMA 시합 레슬링 대비', '오늘 수업 해줘');
check('[M3] 목표 "MMA 레슬링 대비" → 테이크다운 방어 기술', !!g.tech && /방어|defen|sprawl|스프롤/i.test(`${g.tech} ${g.intro}`), { tech: g.tech });
g = await goalLesson('BJJ 위주로 배우고 싶어', '오늘 수업 해줘');
check('[M4] 목표 "BJJ 위주" → BJJ 그라운드 기술 수업', g.art === 'bjj', { tech: g.tech, art: g.art });
g = await goalLesson('BJJ 위주로 배우고 싶어', '복싱 타격 수업 해줘');
check('[M5] 목표가 BJJ여도 "복싱 타격 수업" 요청이 우선', !!g.tech && /boxing|kickboxing/.test(g.tech), { tech: g.tech });
await page.evaluate(() => localStorage.removeItem('martialdex:curricula:custom'));
// mitt choices from the entry box
const entryOpen = async (text) => {
  await page.evaluate(() => localStorage.removeItem('martialdex:coach-oneoff-session'));
  await goto('#/coach/lesson');
  await page.locator('[data-testid="oneoff-request"]').fill(text);
  await page.locator('[data-testid="oneoff-build"]').click();
  await sleep(2000);
  return page.evaluate(() => ({ hash: location.hash, card: document.querySelector('[data-testid="coach-action"]')?.getAttribute('data-ok') ?? null, cardText: document.querySelector('[data-testid="coach-action-message"]')?.textContent ?? '', answer: document.querySelector('[data-testid="oneoff-entry-answer"]')?.textContent ?? '', tab: document.querySelector('[role="tab"][aria-selected="true"]')?.getAttribute('data-testid') ?? null, art: document.querySelector('[data-testid="mitt-art-filter"]')?.value ?? null }));
};
let m = await entryOpen('잽 미트로 연습할 수 있어?');
check('[M6] "잽 미트로 연습할 수 있어?" → 실제 연습 가능한 기능(Visualizing Mitt 포함)을 답함, 화면 이동 없음', /#\/coach\/lesson/.test(m.hash) && /Visualizing Mitt/.test(m.answer), { hash: m.hash, answer: m.answer.slice(0, 120) });
m = await entryOpen('복싱 콤보 미트 하고 싶어');
check('[M7] "복싱 콤보 미트 하고 싶어" → 기존 미트 추천 콤보 탭(복싱)', /tab=db&art=boxing/.test(m.hash) && m.tab === 'mitt-tab-db' && m.art === 'boxing', m);
m = await entryOpen('더블렉 연습하고 싶어');
check('[M8] "더블렉 연습하고 싶어" → 미트의 실제 테이크다운 진입 동작(단일 기술)', /combo=single(%3A|:)wrestling__basic-double-leg/.test(m.hash) && (await page.locator('[data-testid="mitt-runner"], [data-testid="mitt-session"], .mitt-stage').count()) >= 0, m.hash);
m = await entryOpen('암바 미트로 연습하고 싶어');
check('[M9] "암바 미트로 연습하고 싶어" → 미트로 열지 않고 이유 안내 (그라운드)', /#\/coach\/lesson/.test(m.hash) && m.card === '0' && /미트|솔로 드릴/.test(m.cardText), m);
c = await calls();
check('[M10] M 구간: Gemini 0 · 웹 검색 0 · 로컬 모델 0', c['ai:ask'].length === 0 && c['websearch:search'].length === 0 && c['localai:ask'].length === 0, { ai: c['ai:ask'].length });
await page.evaluate(() => localStorage.removeItem('martialdex:coach-kind-pref'));

check('[Z] 페이지 오류 없음', errors.length === 0, errors);
await app.close();
const failed = results.filter((x) => !x.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
