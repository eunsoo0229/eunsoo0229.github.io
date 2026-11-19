// 종목에 맞춘 수업 미트 — every official curriculum lesson item is planned
// through the real lesson planner (aiCoachDay/practicePlan.ts) and the
// result checked per art: how many practices use the Visualizing Mitt, and
// whether the pads fit the art (복싱 no kicks/shots, 레슬링 no strikes …).
// Then the real lesson screen and a one-off lesson.
//   env -u ELECTRON_RUN_AS_NODE node .devtools/qa-lesson-mitt-coverage.mjs
// Requires the Vite dev server on :5173.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = '/Users/swcho/Documents/MARTIALDEX';
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d ? ' :: ' + d.slice(0, 700) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-lmc-'))}`], env, timeout: 120000 });
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  await page.waitForLoadState('load');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sleep(1500);

  const cov = await page.evaluate(async () => {
    const off = await import('/src/lib/curriculum/officialData.ts');
    const coach = await import('/src/lib/aiCoachDay/service.ts');
    const pp = await import('/src/lib/aiCoachDay/practicePlan.ts');
    const am = await import('/src/lib/aiCoachDay/artMitt.ts');
    const a = await import('/src/lib/visualMitt/archetypes.ts');
    const ld = await import('/src/lib/loadData.ts');
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    const tc = await import('/src/lib/techniqueCanonical/index.ts');
    const motions = (ids) => ids.map((id) => a.motionForTechnique(resolveTechnique(id))?.archetype).filter(Boolean);
    const per = {};
    const plan = (t, art) => pp.planPractice(t, { location: 'home', mma: pp.isMmaContext(art, t), submissionGoal: false, seconds: 180, art });
    for (const art of ['boxing', 'kickboxing', 'muay-thai', 'wrestling', 'taekwondo', 'karate']) {
      const c = off.getOfficialCurriculum(art);
      let total = 0;
      let mitt = 0;
      const off_ = [];
      const noMitt = [];
      const samples = { defense: [], clinch: [], record: [] };
      for (const day of c.days)
        for (const t of coach.coachTechniquesForDay(day)) {
          total++;
          const p = plan(t, art);
          if (!p.mitt) {
            noMitt.push(`${t.name} [${t.category}]`);
            continue;
          }
          mitt++;
          const ms = motions(p.mitt.techniqueIds);
          const strike = ms.filter((m) => m.kind === 'strike' || m.kind === 'feint');
          if (art === 'boxing' && ms.some((m) => (m.limb !== 'hand' && m.kind !== 'defense' && m.kind !== 'trap') || m.kind === 'entry')) off_.push(`${t.name} ⇒ ${p.mitt.name}`);
          // an entry is off-art unless it is the lesson's own technique (무에타이 클린치 다리 걸기 등)
          if ((art === 'kickboxing' || art === 'muay-thai') && p.mitt.techniqueIds.some((id) => id !== t.id && a.motionForTechnique(resolveTechnique(id))?.archetype.kind === 'entry')) off_.push(`${t.name} ⇒ ${p.mitt.name}`);
          if (art === 'wrestling' && strike.some((m) => m.kind === 'strike')) off_.push(`${t.name} ⇒ ${p.mitt.name}`);
          if (p.mode === 'art_mitt') {
            const topic = am.lessonTopic(`${t.category} ${t.name}`, art);
            if (topic === 'defense' && samples.defense.length < 3) samples.defense.push({ t: t.name, mitt: p.mitt.name, hasDefense: ms.some((m) => m.kind === 'defense') });
            if (topic === 'clinch' && samples.clinch.length < 3) samples.clinch.push({ t: t.name, mitt: p.mitt.name, close: ms.some((m) => m.limb === 'knee' || m.limb === 'elbow') });
          }
        }
      per[art] = { total, pct: Math.round((mitt / total) * 100), off: off_.slice(0, 5), offCount: off_.length, noMitt, samples };
    }
    // MMA: no official curriculum — every MMA technique as an MMA lesson item
    const mmaTs = ld.getTechniquesByMartialArt ? ld.getTechniquesByMartialArt('mixed-martial-arts') : [];
    let mmaMitt = 0;
    let mmaMixed = 0;
    const mmaNo = [];
    for (const t of mmaTs) {
      const p = plan(t, 'mma');
      if (!p.mitt) {
        mmaNo.push(`${t.name} [${t.category}]`);
        continue;
      }
      mmaMitt++;
      const ms = motions(p.mitt.techniqueIds);
      if (ms.some((m) => m.kind === 'strike') && ms.some((m) => m.kind === 'entry')) mmaMixed++;
    }
    const stance = resolveTechnique('boxing__orthodox');
    const stancePlan = plan(stance, 'boxing');
    return { per, mma: { total: mmaTs.length, pct: mmaTs.length ? Math.round((mmaMitt / mmaTs.length) * 100) : 0, mixedPct: mmaMitt ? Math.round((mmaMixed / mmaMitt) * 100) : 0, no: mmaNo.slice(0, 8) }, stancePlan: { mode: stancePlan.mode, mitt: stancePlan.mitt?.name, intro: stancePlan.intro, briefing: stancePlan.briefing.length } };
  });

  for (const art of ['boxing', 'kickboxing', 'muay-thai', 'taekwondo', 'karate']) {
    const r = cov.per[art];
    check(`[1] ${art}: 수업 실습의 90% 이상이 미트 (${r.pct}%)`, r.pct >= 90, { total: r.total, noMitt: r.noMitt.slice(0, 6) });
  }
  const w = cov.per.wrestling;
  const groundOnly = w.noMitt.every((x) => /탑|바텀|리버설|reversal|top|bottom|가드|guard|bridge|브릿지|switch|sit|stand-?up|granby|roll|escape|탈출|hip|ride|breakdown|tilt|cradle|half|nelson|pin|turn|mat|그라운드/i.test(x));
  check(`[1] wrestling: 서서 하는 수업은 미트 (${w.pct}%), 미트가 없는 건 그라운드(탑·바텀·리버설) 동작뿐`, groundOnly, w.noMitt.filter((x) => !/탑|바텀|리버설|reversal|top|bottom|가드|guard|bridge|브릿지|switch|sit|stand-?up|granby|roll|escape|탈출|hip|ride|breakdown|tilt|cradle|half|nelson|pin|turn|mat|그라운드/i.test(x)).slice(0, 8));
  check('[2] 종목에 맞는 미트: 복싱엔 킥·태클 없음, 킥복싱·무에타이엔 태클 없음, 레슬링엔 타격 없음', ['boxing', 'kickboxing', 'muay-thai', 'wrestling'].every((a) => cov.per[a].offCount === 0), Object.fromEntries(['boxing', 'kickboxing', 'muay-thai', 'wrestling'].map((a) => [a, cov.per[a].off])));
  check(`[2] MMA 수업: MMA 기술의 90% 이상 미트 (${cov.mma.pct}%), 그중 타격+테이크다운을 섞은 미트 ${cov.mma.mixedPct}%`, cov.mma.total > 0 && cov.mma.pct >= 90 && cov.mma.mixedPct >= 50, cov.mma);
  const defs = ['boxing', 'kickboxing', 'muay-thai'].flatMap((a) => cov.per[a].samples.defense);
  check('[3] 카운터·방어 수업 → 코치 공격을 막고 반격하는 미트(방어 동작 포함)', defs.length > 0 && defs.every((d) => d.hasDefense), defs);
  const cl = ['kickboxing', 'muay-thai'].flatMap((a) => cov.per[a].samples.clinch);
  check('[3] 클린치·근거리 수업 → 니킥·엘보 미트', cl.length > 0 && cl.every((d) => d.close), cl);
  check('[3] 스탠스 수업(복싱 오소독스) → 자세에 집중하며 복싱 기본 조합 미트 + 자세 설명', cov.stancePlan.mode === 'art_mitt' && !!cov.stancePlan.mitt && cov.stancePlan.briefing >= 2, cov.stancePlan);

  // ---------- 레슬링 연속 드릴 (wrestlingChains.ts) ----------
  const chains = await page.evaluate(async () => {
    const ad = await import('/src/lib/visualMitt/artDrills.ts');
    const wc = await import('/src/lib/visualMitt/wrestlingChains.ts');
    const rc = await import('/src/lib/visualMitt/reaction.ts');
    const cd = await import('/src/lib/visualMitt/commandDrill.ts');
    const p = ad.drillProfile('wrestling');
    const o = { range: 'basic', withKicks: false, withDefense: true };
    const list = wc.wrestlingChains(p, o);
    const bad = [];
    for (const c of list) {
      const k = c.steps.map((s) => s.motion.archetype.kind);
      if (c.steps.some((s, i) => i && s.techniqueId === c.steps[i - 1].techniqueId)) bad.push(`repeat: ${c.name}`);
      if (k.at(-1) !== 'entry') bad.push(`not ending on a shot: ${c.name}`);
      if (k.some((x, i) => x === 'defense' && k[i - 1] === 'defense' && k[i - 2] === 'defense')) bad.push(`3 defenses: ${c.name}`);
      if (k.includes('strike')) bad.push(`strike: ${c.name}`);
      if (!k.includes('defense')) bad.push(`no defense: ${c.name}`);
    }
    return { n: list.length, maxLen: Math.max(...list.map((c) => c.steps.length)), long: list.filter((c) => c.steps.length >= 4).length, bad, sample: list.slice(0, 3).map((c) => rc.comboCallout(c)), inReaction: rc.reactionPoolFor(p, o).some((c) => c.id.startsWith('wchain:')), inCommand: cd.commandPool('mixed', { profile: p, ...o }).some((c) => c.id.startsWith('wchain:')), boxing: wc.wrestlingChains(ad.drillProfile('boxing'), o).length };
  });
  check('[6] 레슬링 연속 드릴: 태클·스프롤·다운블락처럼 공격과 방어를 섞은 긴 연결(최대 6동작), 반응 훈련·공격 지시 모두에 포함', chains.n >= 20 && chains.maxLen === 6 && chains.long >= 10 && chains.inReaction && chains.inCommand, chains);
  check('[6] 연결 규칙: 같은 동작 연속 없음, 방어는 최대 2번 연속, 마지막은 공격, 타격 없음 · 다른 종목엔 안 섞임', chains.bad.length === 0 && chains.boxing === 0, chains.bad.slice(0, 5));

  // ---------- UI: AI coach lesson on a boxing stance day ----------
  const dayInfo = await page.evaluate(async () => {
    const off = await import('/src/lib/curriculum/officialData.ts');
    const coach = await import('/src/lib/aiCoachDay/service.ts');
    const a = await import('/src/lib/visualMitt/archetypes.ts');
    const c = off.getOfficialCurriculum('boxing');
    for (const d of c.days) {
      const t = coach.coachTechniquesForDay(d)[0];
      if (t && !a.motionForTechnique(t)) return { id: c.id, day: d.day, name: t.name };
    }
    return null;
  });
  await page.evaluate(async () => (await import('/src/lib/aiCoachDay/sessionStore.ts')).clearCoachDayRun());
  await page.evaluate(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'gemini', remember: true })));
  await page.evaluate((h) => (window.location.hash = h), `#/learning/boxing/${dayInfo.id}/coach/${dayInfo.day}?mode=text&place=home`);
  await page.waitForFunction(() => !!document.querySelector('[data-testid="coach-step"]'), null, { timeout: 60000 });
  await sleep(1500);
  await page.evaluate(async () => (await import('/src/lib/aiCoachDay/sessionStore.ts')).updateCoachDayRun((r) => ({ ...r, step: 'ready' })));
  await page.locator('[data-testid="coach-ready"] button').first().click();
  await page.locator('[data-testid="coach-posture"]').waitFor({ timeout: 15000 });
  const pst = await page.evaluate(() => ({ mode: document.querySelector('[data-testid="coach-posture"]')?.dataset.mode, intro: document.querySelector('[data-testid="coach-posture-intro"]')?.textContent ?? '', mitt: document.querySelector('[data-testid="coach-posture-mitt"]')?.textContent ?? '' }));
  check(`[4] AI 코치 수업 화면: 미트 동작이 없는 복싱 항목(${dayInfo.name})도 자세 설명 뒤 복싱 미트 예고`, pst.mode === 'art_mitt' && /복싱 미트/.test(pst.intro) && /Visualizing Mitt/.test(pst.mitt), pst);
  await page.locator('[data-testid="coach-posture-start"]').click();
  await page.locator('[data-testid="coach-mitt"] [data-testid="mitt-runner"]').waitFor({ timeout: 15000 });
  check('[4] 자세 확인 → 미트 실행', (await page.locator('[data-testid="mitt-runner"]').count()) === 1);
  await page.locator('[data-testid="mitt-runner-stop"]').click().catch(() => {});
  await page.evaluate(async () => (await import('/src/lib/aiCoachDay/sessionStore.ts')).clearCoachDayRun());

  // ---------- one-off lesson that names no drawable technique ----------
  const oneOff = await page.evaluate(async () => {
    const om = await import('/src/lib/coachLesson/oneOffMitt.ts');
    const wp = await import('/src/lib/coachLesson/workoutPlan.ts');
    const mk = (request, martialArt) => ({ id: 'qa', request, mode: 'topic', title: request, martialArt, techniqueId: null, intro: '', context: { name: request, concepts: [{ id: 'c1', label: '거리를 유지하며 들어갈 타이밍 잡기', importance: 'core', explain: '', variants: [], reference: '', keywords: [], questions: {}, choice: null }], scenarios: [], keyPointsReference: '' }, sources: [], webSearch: { called: true, queries: [], resultCount: 0, used: true, note: null }, linkedLearned: [], practice: '', workout: { spec: wp.parseWorkoutSpec(''), ai: null, mismatch: false }, videoQueries: [], videoTerms: [], personalization: [], material: '', createdAt: new Date().toISOString() });
    const r = (req, art) => {
      const p = om.oneOffPractice(mk(req, art));
      return p ? { mode: p.mode, mitt: p.mitt?.name, intro: p.intro } : null;
    };
    return { boxing: r('오늘 복싱 거리 조절을 배우고 싶어', 'boxing'), wrestling: r('레슬링 핸드파이팅을 배우고 싶어', 'wrestling'), bjjGround: r('주짓수 마운트 탈출을 배우고 싶어', 'bjj') };
  });
  check('[5] 「수업하고 싶은 거 입력하기」: 그릴 기술이 안 나온 주제(복싱 거리 조절)도 복싱 미트', oneOff.boxing?.mode === 'art_mitt' && !!oneOff.boxing.mitt, oneOff.boxing);
  check('[5] 레슬링 주제 → 레슬링 미트(진입 동작), 주짓수 그라운드 주제 → 미트 없음(억지로 만들지 않음)', oneOff.wrestling?.mode === 'art_mitt' && oneOff.bjjGround === null, oneOff);

  check('[Z] 페이지 에러 없음', errors.length === 0, errors);
  await app.close();
  const passed = results.filter((x) => x.pass).length;
  console.log(`=== SUMMARY: ${passed}/${results.length} PASSED ===`);
  if (passed !== results.length) console.log('FAILURES:', results.filter((x) => !x.pass).map((x) => x.name));
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => {
  console.error('DRIVER FAILED:', e);
  process.exit(1);
});
