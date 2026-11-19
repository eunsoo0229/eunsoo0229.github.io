// 4차 real-screen QA (hidden + muted Electron, separate user-data-dir, real IPC → the user's SearXNG).
//   - seeded learning records (lesson logs written the way the app writes them)
//   - /coach/chat: "레슬링 솔로 드릴 훈련을 하고 싶어." → plan of wrestling records + start → the lesson
//     runs wrestling records only; personal questions; the failing Topuria question; pose check →
//     the pose-check page (guide, references) → a video with NO person → retake, no record saved
//   - header "AI에게 묻기" (MARTIALDEX engine) → the same coach
//   - lesson pose suggestion → "나중에 하기" → gone, lesson state unchanged, not shown again
// No real person video was used (none available): the successful-measurement path is covered by
// the offline test with synthetic joints, not here.
// Requires: Vite dev server :5173, SearXNG :8888.  Run: node .devtools/qa-self-ai-personal.mjs
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
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-personal-'));
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
  // seeded records: High Single learned on 3 days, Sprawl weak in the latest lesson
  await page.evaluate(() => {
    const day = (n) => new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
    const lesson = (id, d, techs) => ({ id, kind: 'one_off', title: `수업 ${id}`, date: d, startedAt: `${d}T10:00:00Z`, finishedAt: `${d}T10:30:00Z`, curriculumId: null, day: null, historyEntryId: null, techniques: techs.map(([techniqueId, overall, practiced]) => ({ techniqueId, name: techniqueId, overall, practiced, concepts: [] })), qa: [], recap: null, updatedAt: `${d}T10:30:00Z` });
    localStorage.setItem('martialdex:coach-lesson-log', JSON.stringify([lesson('a3', day(2), [['wrestling__high-single', 'understood', true], ['wrestling__sprawl', 'weak', false]]), lesson('a2', day(10), [['wrestling__high-single', 'understood', true]]), lesson('a1', day(20), [['wrestling__high-single', 'understood', true], ['wrestling__sprawl', 'understood', true]])]));
    localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true }));
  });
  const go = async (hash) => {
    await page.evaluate((h) => { window.location.hash = h; }, hash);
    await sleep(900);
  };
  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 20000 });
  const ANSWERS = '[data-testid="self-ai-chat"] .ai-msg--model:not(.ai-msg--pending)';
  async function ask(id, text, timeout = 240000) {
    const n = await page.evaluate((sel) => document.querySelectorAll(sel).length, ANSWERS);
    await page.fill('[data-testid="self-ai-input"]', text);
    const t0 = Date.now();
    await page.click('[data-testid="self-ai-send"]');
    await page.waitForFunction(([n, sel]) => document.querySelectorAll(sel).length > n && !document.querySelector('[data-testid="self-ai-busy"]'), [n, ANSWERS], { timeout });
    timings[id] = Date.now() - t0;
    return page.evaluate((sel) => [...document.querySelectorAll(sel)].pop()?.innerText ?? '', ANSWERS);
  }

  // ---- 시나리오 B: solo drill → lesson
  const solo = await ask('solo', '레슬링 솔로 드릴 훈련을 하고 싶어.');
  check('[B1] 레슬링 솔로 드릴 → 레슬링 수업 계획(다른 무술 기술 없음) + 시작·솔로 드릴 화면 버튼', /레슬링 솔로 드릴 수업 계획/.test(solo) && !/Guillotine|Armbar|Gyaku|Round Kick|Long Guard/.test(solo) && (await page.locator('[data-testid="self-ai-start-lesson"]').count()) > 0 && (await page.locator('[data-testid="self-ai-action"]', { hasText: '솔로 드릴 화면' }).count()) > 0, solo.slice(0, 500));
  check('[B2] 개인화: 배운 기술 복습·부족 기술 보강·다음 준비 표시', /\[복습\]|\[보강\]|\[준비\]/.test(solo), solo.slice(0, 600));
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
  const run = await page.evaluate(() => JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'));
  const arts = await page.evaluate(async (ids) => { const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts'); return ids.map((id) => { const t = resolveTechnique(id); return t ? (t.martialArts ?? [t.martialArt]) : []; }); }, run.techniqueIds);
  check('[B3] 시작한 수업의 기술이 모두 레슬링 기록', run.techniqueIds.length >= 3 && arts.every((a) => a.includes('wrestling')), { ids: run.techniqueIds, arts });

  // ---- 시나리오 A + personal questions
  await go('#/coach/chat');
  await page.waitForSelector('[data-testid="self-ai-input"]');
  const an = await ask('analysis', '내 레슬링 실력에서 부족한 부분을 분석해 줘.');
  check('[A1] 실력 분석: 현황·부족(Sprawl, 근거)·자세 측정·다음 수업 추천', /■ 현황/.test(an) && /Sprawl/.test(an) && /■ 자세 측정/.test(an) && /■ 다음 수업 추천/.test(an), an.slice(0, 600));
  const learned = await ask('learned', '내가 지금까지 배운 레슬링 기술은?');
  check('[A2] 배운 기술: 기록된 High Single', /High Single/.test(learned) && /학습 완료/.test(learned), learned.slice(0, 300));

  // ---- 시나리오 F: the failing Topuria question
  const tf = await ask('topuria', '토푸리아의 타격 스타일과 대표적인 셋업, 콤비네이션을 분석해 줘.', 300000);
  check('[F1] 토푸리아 → Ilia Topuria 확인, 검색 과정·근거 수준·확인 못한 항목 구분', /Ilia Topuria/.test(tf) && /검색 과정: \d회 검색/.test(tf) && /■ (주요 타격 기술|확인할 수 없는 항목)/.test(tf) && /본문을 읽은 분석 자료 [1-9]/.test(tf), tf.slice(0, 700));

  // ---- 시나리오 D: pose check → page → no-person video → retake, nothing saved
  const pc = await ask('pose', '내 잽 자세가 맞는지 확인하고 싶어.');
  const hasStart = (await page.locator('[data-testid="self-ai-action"]', { hasText: '자세 측정 시작' }).count()) > 0;
  check('[D1] 자세 확인 요청 → 기준 영상(제목·설명 판단 명시)·촬영 안내·측정 시작(또는 기준 영상 없음 → 시작 안 함)', (/촬영 안내/.test(pc) && hasStart && /영상 속 자세는 앱이 확인하지 않았습니다/.test(pc)) || (/기준 영상을 찾지 못해 자세 측정을 시작하지 않았습니다/.test(pc) && !hasStart), pc.slice(0, 500));
  const single = await ask('pose_unsupported', '싱글렉 자세를 영상으로 평가해 줘.');
  check('[D2] 측정 기준 없는 기술(싱글렉) → 측정하지 않음 안내', /기준이 없는 기술/.test(single) && /측정할 수 있는 기술/.test(single), single.slice(0, 300));
  if (hasStart) {
    await page.locator('[data-testid="self-ai-action"]', { hasText: '자세 측정 시작' }).last().click();
    await page.waitForSelector('[data-testid="pose-check-guide"]', { timeout: 15000 });
    const refCards = await page.locator('[data-testid="pose-check-references"] .video-card').count();
    check('[D3] 자세 확인 화면: 촬영 안내 + 기준 영상 카드 + 측정 버튼 활성', refCards >= 1 && (await page.isEnabled('[data-testid="pose-check-file"]')), refCards);
    const before = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
    // a 3-second video with no person (a moving coloured box), made in the page
    const b64 = await page.evaluate(async () => {
      const c = document.createElement('canvas');
      c.width = 320;
      c.height = 240;
      const g = c.getContext('2d');
      const rec = new MediaRecorder(c.captureStream(15), { mimeType: 'video/webm' });
      const chunks = [];
      rec.ondataavailable = (e) => chunks.push(e.data);
      rec.start();
      const t0 = performance.now();
      await new Promise((resolve) => {
        const draw = () => {
          const t = performance.now() - t0;
          g.fillStyle = '#8899aa';
          g.fillRect(0, 0, 320, 240);
          g.fillStyle = '#223';
          g.fillRect(40 + (t / 20) % 200, 80, 40, 40);
          if (t < 3000) requestAnimationFrame(draw);
          else resolve();
        };
        draw();
      });
      rec.stop();
      await new Promise((r) => (rec.onstop = r));
      const buf = await new Blob(chunks, { type: 'video/webm' }).arrayBuffer();
      let s = '';
      new Uint8Array(buf).forEach((b) => (s += String.fromCharCode(b)));
      return btoa(s);
    });
    const tD = Date.now();
    await page.setInputFiles('[data-testid="pose-check-file-input"]', { name: 'no-person.webm', mimeType: 'video/webm', buffer: Buffer.from(b64, 'base64') });
    await page.waitForSelector('[data-testid="pose-check-result"]', { timeout: 120000 });
    timings.pose_file = Date.now() - tD;
    const res = await page.evaluate(() => ({ ok: document.querySelector('[data-testid="pose-check-result"]')?.getAttribute('data-ok'), text: document.querySelector('[data-testid="pose-check-result"]')?.innerText ?? '' }));
    const after = await page.evaluate(() => localStorage.getItem('martialdex:pose-records'));
    check('[D4] 사람 없는 영상 → 관절 감지 실패: 점수 없이 재촬영 안내, 자세 기록 변화 없음', res.ok === 'false' && /(다시 촬영|인식하지 못|열지 못)/.test(res.text) && before === after, { res, before, after });
  }

  // ---- header "AI에게 묻기" → MARTIALDEX engine = the same coach
  await go('#/');
  await page.click('button[title="AI에게 질문"]');
  await page.click('[data-testid="ai-engine-martialdex"]');
  const nModal = await page.evaluate(() => document.querySelectorAll('.ai-msg--model').length);
  await page.locator('textarea').last().fill('레슬링 솔로 드릴 훈련을 하고 싶어.');
  await page.keyboard.press('Enter');
  await page.waitForFunction((n) => [...document.querySelectorAll('.ai-msg--model')].filter((e) => !e.querySelector('.ai-msg__bubble--loading')).length > n, nModal, { timeout: 120000 });
  const modalText = await page.evaluate(() => [...document.querySelectorAll('.ai-msg--model')].pop()?.innerText ?? '');
  check('[H1] 헤더 "AI에게 묻기"(MARTIALDEX) → 같은 코치: 레슬링 솔로 드릴 계획, 다른 무술 기술 없음', /레슬링 솔로 드릴 수업 계획/.test(modalText) && !/Guillotine|Armbar|Gyaku|Round Kick|Long Guard/.test(modalText), modalText.slice(0, 400));
  await page.reload();
  await sleep(1500);

  // ---- 시나리오 C: lesson pose suggestion → "나중에 하기"
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    const C = await import('/src/lib/curriculum/curriculumService.ts');
    const L = await import('/src/lib/coachLesson/service.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    const now = new Date().toISOString();
    C.saveCustomCurriculum({ id: 'qa-jab', martialArt: 'boxing', title: 'QA 잽 수업', description: '', level: 'beginner', source: 'custom', authorName: 'qa', createdAt: now, updatedAt: now, days: [{ day: 1, title: '잽', description: '', learningGoals: [], techniqueIds: ['boxing__jab', 'boxing__cross'], reviewTechniqueIds: [], difficulty: null, estimatedMinutes: 20 }] });
    S.startCoachDayRun('qa-jab', 1, 'text', ['boxing__jab', 'boxing__cross'], null, [], 'martialdex');
    const st = L.startLesson(resolveTechnique('boxing__jab')).state;
    S.updateCoachDayRun((r) => ({ ...r, step: 'practiced', lessons: { boxing__jab: { ...st, practiceDone: true } } }));
  });
  await go('#/learning/boxing/qa-jab/coach/1?mode=text');
  for (let i = 0; i < 3; i++) {
    if (await page.locator('[data-testid="coach-location-home"]').count()) {
      await page.locator('[data-testid="coach-location-home"]').click();
      await page.locator('[data-testid="coach-location-confirm"]').click();
    }
    if (await page.locator('[data-testid="lesson-pose-suggest"]').count()) break;
    await sleep(1200);
  }
  // the lesson screen (re)starts its run when the place is chosen: mark the CURRENT technique's practice done now
  await page.waitForSelector('[data-testid="coach-chat"]', { timeout: 20000 });
  await page.evaluate(async () => {
    const S = await import('/src/lib/aiCoachDay/sessionStore.ts');
    const L = await import('/src/lib/coachLesson/service.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    S.updateCoachDayRun((r) => {
      const id = r.techniqueIds[r.index];
      const st = r.lessons?.[id] ?? L.startLesson(resolveTechnique(id)).state;
      return { ...r, step: 'practiced', lessons: { ...(r.lessons ?? {}), [id]: { ...st, practiceDone: true } } };
    });
  });
  await page.reload();
  for (let i = 0; i < 5 && !(await page.locator('[data-testid="lesson-pose-suggest"]').count()); i++) await sleep(1000);
  const shown = (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 1;
  check('[C1] 측정 가능한 기술(잽) 실습 후 → 자세 측정 제안(선택 사항 명시)', shown && /선택 사항/.test(await page.textContent('[data-testid="lesson-pose-suggest"]').catch(() => '')), await page.evaluate(() => ({ hash: location.hash, testids: [...new Set([...document.querySelectorAll('[data-testid]')].map((e) => e.getAttribute('data-testid')))].slice(0, 40), run: (() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'); return r && { step: r.step, coachKind: r.coachKind, idx: r.index, ids: r.techniqueIds, pd: r.lessons?.boxing__jab?.practiceDone }; })(), text: document.body.innerText.slice(0, 300) })));
  const key = () => page.evaluate(() => { const r = JSON.parse(localStorage.getItem('martialdex:ai-coach-day-run') || 'null'); if (!r) return null; const { messages, ...rest } = r; return JSON.stringify(rest); });
  const k0 = await key();
  if (shown) await page.click('[data-testid="lesson-pose-decline"]');
  await sleep(600);
  const goneNow = (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 0;
  await page.reload();
  await sleep(2500);
  const goneAfterReload = (await page.locator('[data-testid="lesson-pose-suggest"]').count()) === 0;
  check('[C2] "나중에 하기" → 제안 사라짐, 같은 수업에서 다시 안 뜸, 수업 상태 그대로(점수·숙련도 변화 없음)', goneNow && goneAfterReload && k0 === (await key()), { goneNow, goneAfterReload });

  check('[Z1] 진행 중 페이지 에러 없음', pageErrors.length === 0, pageErrors);
} finally {
  await app.close().catch(() => {});
}
const passed = results.filter((r) => r.pass).length;
console.log('\nUI timings (ms):', JSON.stringify(timings));
fs.writeFileSync(path.join(APP_DIR, 'data/audit/self-ai/qa-self-ai-personal.json'), JSON.stringify({ at: new Date().toISOString(), results, timings }, null, 2));
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
