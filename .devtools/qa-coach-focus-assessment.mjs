// QA (real app + real Gemini): AI 코치 수업 방향 (배운 기술만 복습 / 새 기술만) and the
// end-of-lesson 이해도·숙련도 rating that sets mastery. Requires the Vite dev server on :5173.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = '/Users/swcho/Documents/MARTIALDEX';
const results = [];
const check = (n, p, d = '') => {
  results.push(p);
  console.log(`${p ? 'PASS' : 'FAIL'} — ${n}${d !== '' ? ' :: ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 500) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-focus-'))}`], env, timeout: 30000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await sleep(800);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tid = (id) => page.locator(`[data-testid="${id}"]`);
const go = async (hash) => {
  await page.evaluate(() => (location.hash = '#/'));
  await sleep(200);
  await page.evaluate((h) => (location.hash = h), hash);
  await sleep(600);
};

// learned: Jab, Cross (boxing) and Hook — via the real training-history service
const LEARNED = await page.evaluate(async () => {
  const h = await import('/src/lib/trainingHistory/service.ts');
  const { getTechniquesByMartialArt } = await import('/src/lib/loadData.ts');
  const box = getTechniquesByMartialArt('boxing');
  const ids = ['Jab', 'Cross', 'Hook'].map((n) => box.find((t) => t.name === n)?.id).filter(Boolean);
  h.recordTrainingSession({ curriculumId: null, dayNumber: null, techniqueIds: ids, completed: true, estimatedMinutes: 20, source: 'free_training' });
  const l = await import('/src/lib/learnedTechniques/service.ts');
  return l.listLearnedTechniques().map((e) => ({ id: e.technique.id, name: e.technique.name, ko: e.technique.koreanName ?? '' }));
});
check('[준비] 배운 기술 3개 (Jab · Cross · Hook)', LEARNED.length === 3, LEARNED);

async function makeClass(focus, art = 'boxing') {
  await go('#/coach/class');
  await tid('coach-location-home').click();
  await tid('coach-location-confirm').click();
  await tid('coach-class-art').selectOption(art);
  await sleep(200);
  if (focus) await tid(`coach-class-focus-${focus}`).click();
  await tid('coach-class-days').count(); // (no-op)
  await page.locator('button.chip', { hasText: '3일' }).click();
  await tid('coach-class-generate').click();
  await tid('coach-class-result').waitFor({ timeout: 240000 });
  return page.evaluate(async () => {
    const el = document.querySelector('[data-testid="coach-class-result"]');
    const { getCurriculum } = await import('/src/lib/curriculum/curriculumService.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    const c = getCurriculum(el.dataset.curriculumId);
    const steps = c.days.flatMap((d) => (d.coachPlan ?? []).map((i) => ({ day: d.day, role: i.role, id: i.techniqueId, name: resolveTechnique(i.techniqueId)?.name ?? '', text: `${i.instruction} ${i.soloAlternative ?? ''}` })));
    const texts = [c.title, c.aiCoachMeta.summary, ...c.days.map((d) => `${d.title} ${d.coachNotes ?? ''}`), ...steps.map((s) => s.text)].join(' \n ');
    return { source: el.dataset.source, focus: c.aiCoachMeta.focus, focusLabel: document.querySelector('[data-testid="coach-class-result-focus"]')?.textContent, steps, texts, snapshot: c.aiCoachMeta.learnedSnapshot, notices: [...el.querySelectorAll('.ai-inline-warning')].map((n) => n.textContent) };
  });
}

// ---- 1. 수업 방향 선택 UI
await go('#/coach/class');
await tid('coach-location-home').click();
await tid('coach-location-confirm').click();
await tid('coach-class-art').selectOption('boxing');
check('[UI] 수업 방향 3가지 (복습+새 기술 기본 / 배운 기술만 복습 / 새 기술만)', (await tid('coach-class-focus').getAttribute('data-focus')) === 'mixed' && (await tid('coach-class-focus-review').count()) === 1 && (await tid('coach-class-focus-new').count()) === 1);
await tid('coach-class-art').selectOption('judo');
await sleep(200);
check('[UI] 배운 기술이 없는 무술(유도)에서는 "배운 기술만 복습" 비활성', await tid('coach-class-focus-review').isDisabled());

// ---- 2. 새 기술만
const learnedIds = new Set(LEARNED.map((l) => l.id));
const nameHits = (text, steps) => {
  // a planned technique's own name may contain a learned name ("Jab Feint" ⊃ "Jab") — strip those first
  let t = text.toLowerCase();
  for (const n of [...new Set(steps.map((s) => s.name))].filter((n) => n.length >= 2).sort((a, b) => b.length - a.length)) t = t.split(n.toLowerCase()).join(' ');
  return LEARNED.flatMap((l) => [l.name, l.ko]).filter((n) => n.length >= 2 && t.includes(n.toLowerCase()));
};
const nw = await makeClass('new');
check('[새 기술] 결과에 수업 방향 표시', nw.focus === 'new' && /새 기술만/.test(nw.focusLabel ?? ''), nw.focusLabel);
check('[새 기술] 배운 기술(Jab·Cross·Hook)이 어느 단계에도 없음', nw.steps.length > 0 && !nw.steps.some((s) => learnedIds.has(s.id)), nw.steps.map((s) => `${s.day}:${s.role}:${s.name}`));
check('[새 기술] 복습·연결 단계 없음, 새 기술 단계 있음', !nw.steps.some((s) => s.role === 'review' || s.role === 'connection') && nw.steps.some((s) => s.role === 'new'));
check('[새 기술] 제목·요약·안내 문장 어디에도 배운 기술 이름이 없음', nameHits(nw.texts, nw.steps).length === 0, nameHits(nw.texts, nw.steps));
check('[새 기술] 배운 기술 스냅샷도 저장하지 않음', nw.snapshot.length === 0);
console.log(`   (새 기술 수업 생성: ${nw.source === 'ai' ? 'AI가 구성' : '기본 구성 — ' + nw.notices.join(' / ')})`);

// ---- 3. 배운 기술만 복습
const rv = await makeClass('review');
check('[복습만] 결과에 수업 방향 표시', rv.focus === 'review' && /배운 기술만 복습/.test(rv.focusLabel ?? ''));
check('[복습만] 새 기술 단계 없음', !rv.steps.some((s) => s.role === 'new'), rv.steps.map((s) => `${s.day}:${s.role}:${s.name}`));
check('[복습만] 복습·연결·응용은 모두 배운 기술', rv.steps.filter((s) => ['review', 'connection', 'application'].includes(s.role)).every((s) => learnedIds.has(s.id)) && rv.steps.some((s) => s.role === 'review'));
console.log(`   (복습 수업 생성: ${rv.source === 'ai' ? 'AI가 구성' : '기본 구성 — ' + rv.notices.join(' / ')})`);

// ---- 4. 수업 마지막 숙련도 평가 (Gemini 코치 수업 기록 → AI 평가 → 숙련도 반영)
const hook = LEARNED.find((l) => l.name === 'Hook');
await page.evaluate(async (hookId) => {
  const L = await import('/src/lib/coachLesson/lessonLog.ts');
  const now = new Date().toISOString();
  L.saveLessonLog({
    id: 'lesson_qa_focus', kind: 'curriculum_day', title: 'QA 수업 · 훅', date: now.slice(0, 10), startedAt: now, finishedAt: now, curriculumId: null, day: 1, historyEntryId: null, coachKind: 'gemini',
    techniques: [{ techniqueId: hookId, name: 'Hook', overall: 'partial', practiced: true, concepts: [
      { id: 'c1', label: '팔꿈치 높이', explain: '팔꿈치를 어깨 높이로 들어 옆에서 친다', reference: '팔꿈치를 어깨 높이, 팔은 90도', status: 'understood', evidence: '팔꿈치를 어깨 높이로 들고 90도로 굽혀요' },
      { id: 'c2', label: '앞발 회전', explain: '앞발과 허리를 함께 돌린다', reference: '앞발 뒤꿈치를 돌리며 허리 회전', status: 'weak', evidence: '팔로만 세게 휘두르면 돼요' },
    ] }],
    qa: [{ question: '훅 칠 때 발은 그대로 둬도 되나요?', answer: '아닙니다. 앞발 뒤꿈치를 돌려 허리 회전을 실어야 합니다.' }],
    recap: null, updatedAt: now,
  });
}, hook.id);
await go('#/review/lessons/lesson_qa_focus');
check('[평가/복습 화면] 지난 수업은 자동으로 평가하지 않고 버튼으로', (await tid('lesson-assessment').getAttribute('data-state')) === 'idle');
await tid('lesson-assessment-start').click();
await page.waitForFunction(() => document.querySelector('[data-testid="lesson-assessment"]')?.getAttribute('data-state') !== 'busy', null, { timeout: 120000 });
const card = await page.evaluate(() => {
  const el = document.querySelector('[data-testid="lesson-assessment"]');
  const it = el.querySelector('[data-testid="lesson-assessment-item"]');
  return { state: el.dataset.state, method: el.dataset.method, proficiency: it?.dataset.proficiency, understanding: it?.dataset.understanding, text: el.textContent };
});
check('[평가] 기술마다 이해도·숙련도·이유가 표시됨', card.state === 'done' && !!card.proficiency && !!card.understanding && /이해도/.test(card.text) && /숙련도/.test(card.text), card.text.slice(0, 300));
check(`[평가] Gemini 코치 수업은 AI가 평가 (method=${card.method})`, card.method === 'ai', card.text.slice(0, 200));
check('[평가] 근거를 넘는 숙련도는 매기지 않음 (첫 수업 → 숙련 불가)', card.proficiency !== 'proficient', card.proficiency);
check('[평가] 앞발 회전을 틀리게 답함 → 이해도 "잘 이해함"이 아님', card.understanding !== 'high', card.understanding);
const applied = await page.evaluate(async (hookId) => {
  const sp = await import('/src/lib/skillProgress/weaknessEngine.ts');
  const L = await import('/src/lib/coachLesson/lessonLog.ts');
  const all = sp.computeAllSkillProgress();
  const e = all.find((x) => x.technique.id === hookId);
  return { status: e?.progress.status, saved: L.getLessonLog('lesson_qa_focus').assessment?.items[0]?.proficiency };
}, hook.id);
check('[반영] 평가한 숙련도가 기술 숙련도로 저장·반영됨', !!applied.saved && applied.status === applied.saved, applied);
await go('#/review/lessons/lesson_qa_focus');
check('[재방문] 저장된 평가를 다시 보여 줌 (다시 평가하지 않음)', (await tid('lesson-assessment').getAttribute('data-state')) === 'done');

check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
