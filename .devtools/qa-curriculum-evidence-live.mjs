// LIVE verification of the per-learning-part web-evidence pipeline (real Gemini + real Tavily) through the
// real generateGoalCurriculumPreview path, in the real Electron app (hidden + muted by electron/main.cjs).
// Counts every Tavily / Gemini call. Cases: the two reported failures (A, B) and two requests that already
// generated normally before the change (regression). If a run stops at the partial-scope question, it is
// accepted once to verify that continuing makes NO new Tavily/Gemini research calls.
// Requires the Vite dev server on :5173 and GEMINI/TAVILY keys in .env. Writes JSON to argv[2].
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = '/Users/swcho/Documents/MARTIALDEX';
const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'curriculum-evidence-live.json');
const ONLY = process.env.CASES ? process.env.CASES.split(',') : null;
const CASES = [
  { key: 'A', freeText: '스탠딩 백 포지션에서 탈출한 뒤 테이크다운으로 이어지는 학습', martialArt: 'wrestling', durationDays: 30 },
  { key: 'B', freeText: '앉은 상태에서 바디 트라이앵글이 걸린 상황에 대응하고 이후 서브미션 관련 학습으로 이어지는 내용', martialArt: 'bjj', durationDays: 30 },
  { key: 'A14', freeText: '스탠딩 백 포지션에서 탈출한 뒤 테이크다운으로 이어지는 학습', martialArt: 'wrestling', durationDays: 14 },
  { key: 'R1', freeText: '테이크다운의 다양성을 알고 싶어', martialArt: 'wrestling', durationDays: 14 },
  { key: 'R2', freeText: '싱글렉 테이크다운만 집중적으로 배우고 싶어', martialArt: 'wrestling', durationDays: 14 },
].filter((c) => !ONLY || ONLY.includes(c.key));

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-ev-live-'))}`], env, timeout: 120000 });
const page = await app.firstWindow();
await page.waitForLoadState('load');
await new Promise((r) => setTimeout(r, 2500));
const logs = [];
page.on('console', (m) => { const t = m.text(); if (/CURRICULUM_|CurriculumResearch/.test(t)) logs.push(t.slice(0, 600)); });

const rows = [];
for (const c of CASES) {
  logs.length = 0;
  const r = await page.evaluate(async (c) => {
    const ws = (await import('/src/lib/webSearch/provider.ts')).webSearchProvider;
    const ai = (await import('/src/lib/ai/provider.ts')).aiProvider;
    const svc = await import('/src/lib/aiCurriculum/service.ts');
    const counts = { tavily: 0, gemini: 0 };
    const os = ws.search, oa = ai.ask;
    ws.search = async (q) => (counts.tavily++, os.call(ws, q));
    ai.ask = async (req) => (counts.gemini++, oa.call(ai, req));
    const summarize = (o) => {
      if (o.ok) {
        const p = o.preview;
        const ids = [...new Set(p.days.flatMap((d) => d.techniqueIds))];
        const names = ids.map((id) => p.matchedTechniques.find((m) => m.techniqueId === id)?.techniqueName ?? id);
        return { ok: true, researchMode: p.research.researchMode, status: p.research.status, partialScope: p.partialScope ?? null, totalDays: p.totalDays, scheduledTechniqueCount: ids.length, scheduled: names.slice(0, 25), found: p.research.foundTechniques.map((t) => `${t.name}${t.matchedToDatabase ? '✓' : '?'}`), diagnostics: p.research.diagnostics ?? null, review: (p.research.review ?? []).map((x) => `${x.name} [${x.partLabel}] ${x.reasons.join('/')}`), excluded: p.research.excludedTechniques, subGoals: p.analysis.subGoals ?? null, insufficientContent: !!p.insufficientContent, evidence: p.evidence ?? null, grades: p.matchedTechniques.filter((m) => ids.includes(m.techniqueId)).map((m) => `${m.evidenceGrade ?? '-'}:${m.techniqueName}`), dayTitles: p.days.map((d) => d.title).slice(0, 12) };
      }
      if (o.code === 'INSUFFICIENT_WEB_EVIDENCE') return { ok: false, code: o.code, research: { ...o.research, review: o.research.review.map((x) => `${x.name} [${x.partLabel}] ${x.reasons.join('/')}`) } };
      if (o.code === 'PARTIAL_EVIDENCE') return { ok: false, code: o.code, partial: o.partial };
      return { ok: false, code: o.code, message: o.message ?? o.errors ?? o.question };
    };
    try {
      const t0 = performance.now();
      const first = await svc.generateGoalCurriculumPreview({ freeText: c.freeText, martialArt: c.martialArt, durationDays: c.durationDays, dailyMinutes: 30, skipClarifying: true });
      const firstCounts = { ...counts };
      const out = { first: summarize(first), firstCalls: firstCounts, ms: Math.round(performance.now() - t0) };
      if (!first.ok && first.code === 'PARTIAL_EVIDENCE') {
        const before = { ...counts };
        const resumed = await svc.generateGoalCurriculumPreview({ freeText: c.freeText, martialArt: c.martialArt, durationDays: c.durationDays, dailyMinutes: 30, skipClarifying: true, partialToken: first.partial.token });
        out.resumed = summarize(resumed);
        out.resumeCalls = { tavily: counts.tavily - before.tavily, gemini: counts.gemini - before.gemini };
      }
      return out;
    } finally {
      ws.search = os;
      ai.ask = oa;
    }
  }, c);
  rows.push({ case: c, ...r, logs: [...logs] });
  const f = r.first;
  console.log(`== ${c.key}: ${f.ok ? `OK mode=${f.researchMode} scheduled=${f.scheduledTechniqueCount}` : `${f.code} ${f.research?.diagnostics?.stopReason ?? ''}`} · tavily=${r.firstCalls.tavily} gemini=${r.firstCalls.gemini}${r.resumed ? ` · resumed: ${r.resumed.ok ? 'OK' : r.resumed.code} (+tavily ${r.resumeCalls.tavily}, +gemini ${r.resumeCalls.gemini})` : ''}`);
  await new Promise((res) => setTimeout(res, 8000));
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
await app.close();
