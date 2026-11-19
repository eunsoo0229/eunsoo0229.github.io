// The six real user tests of the 자체 AI 코치, run in the real Electron renderer
// (real IPC → real SearXNG + real Ollama) with each stage timed separately:
// knowledge index, search, data answer, model (first token / total), and the
// whole turn. Hidden + muted (Playwright → isAutomation in electron/main.cjs),
// separate user-data-dir. Prints the answers so they can be read, and writes
// data/audit/self-ai/six-tests-<label>.json.
// Requires the Vite dev server on :5173, SearXNG on :8888 and Ollama.
// Run: node .devtools/qa-self-ai-six.mjs [label]
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const label = process.argv[2] || 'run';
export const SIX = {
  A: 'BJJ의 암바를 설명해 줘. 기술의 원리, 주요 포인트, 흔한 실수와 대응 방법을 알려 줘.',
  B: '최근 그래플링 관련 스포츠 과학 논문을 찾아 줘. 제목, 연도, 핵심 내용, 원문 링크를 정리해 줘.',
  C: '레슬링 싱글렉을 배울 수 있는 교육 영상을 찾아 줘.',
  D: '레슬링 싱글렉을 기초부터 실전 응용까지 체계적으로 배우고 싶어.',
  F: '코너 맥그리거의 타격 스타일을 분석해 줘. 대표적인 셋업, 콤비네이션, 카운터와 근거 자료를 구분해서 정리해 줘.',
};
// E runs inside a lesson (the technique being taught is given); the rest are turns that use the model.
const LESSON = { E: { text: '지금 배우는 기술에서 상대가 방어하면 어떻게 대응해야 해? 관련 자료도 찾아서 설명해 줘.', techniqueId: 'wrestling__single-leg-position', art: 'wrestling' } };
const MODEL_TURNS = { G: '안녕하세요', H: '요즘 훈련이 너무 힘들어서 그만두고 싶어', I: '복싱 잽으로 시작하는 콤비네이션 연구해 줘' };
const only = (process.argv[3] || '').split(',').filter(Boolean);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-six-'));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${dir}`], env, timeout: 60000 });
const out = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  await page.waitForLoadState('load');
  await page.waitForFunction(() => !!window.martialdex?.research, null, { timeout: 20000 });
  const all = [...Object.entries(SIX).map(([id, text]) => [id, { text }]), ...Object.entries(LESSON), ...Object.entries(MODEL_TURNS).map(([id, text]) => [id, { text }])].filter(([id]) => !only.length || only.includes(id));
  for (const [id, { text, techniqueId, art }] of all) {
    const r = await page.evaluate(async ({ text, techniqueId, art }) => {
      const { runCoachTurn } = await import('/src/lib/selfAi/coachAgent.ts');
      const { appCoachDeps } = await import('/src/lib/selfAi/deps.ts');
      const real = appCoachDeps();
      const t = {};
      const timed = (name, fn) => async (...a) => {
        const s = performance.now();
        try {
          return await fn(...a);
        } finally {
          t[name] = Math.round(performance.now() - s);
        }
      };
      let first = null;
      const s0 = performance.now();
      const deps = {
        ...real,
        knowledgeIndex: timed('index', real.knowledgeIndex),
        research: timed('search', real.research),
        dataAnswer: real.dataAnswer && timed('dataAnswer', real.dataAnswer),
        lessonAnswer: real.lessonAnswer && timed('lessonAnswer', real.lessonAnswer),
        fighterStyle: real.fighterStyle && timed('fighterStyle', real.fighterStyle),
        chat: timed('model', async (req, onDelta) => {
          promptChars = req.messages.reduce((n, m) => n + m.content.length, 0);
          const res = await real.chat(req, (d) => { first ??= Math.round(performance.now() - s0); onDelta?.(d); });
          if (res.ok) evalCount = res.evalCount;
          return res;
        }),
      };
      let promptChars = 0;
      let evalCount = 0;
      const phases = [];
      const o = await runCoachTurn({ text, history: [], martialArt: art ?? null, inLesson: !!techniqueId, lessonTechniqueId: techniqueId, requestId: `six-${Date.now()}`, onStatus: (p) => phases.push([Math.round(performance.now() - s0), p]) }, deps);
      const m = o.message;
      return {
        totalMs: Math.round(performance.now() - s0), stages: t, firstTokenMs: first, phases, promptChars, evalCount,
        intent: o.plan.intent, research: o.plan.research, techniques: o.plan.techniques.map((x) => x.id),
        model: m.model ?? null, text: m.text, sources: m.sources ?? [], videos: m.videos ?? [], papers: m.papers ?? [],
        guardNotes: m.guardNotes ?? [], researchInfo: m.research, lessonProposal: m.lessonProposal ?? null, style: m.style ?? null,
      };
    }, { text, techniqueId: techniqueId ?? null, art: art ?? null });
    out.push({ id, text, ...r });
    console.log(`\n### ${id} intent=${r.intent} total=${r.totalMs}ms stages=${JSON.stringify(r.stages)} firstToken=${r.firstTokenMs} promptChars=${r.promptChars} evalTokens=${r.evalCount} model=${r.model}`);
    console.log(`queries=${JSON.stringify(r.research.queries)} techniques=${r.techniques.join(',')}`);
    console.log(r.text);
    if (r.guardNotes.length) console.log('guard:', r.guardNotes.join(' | '));
  }
} finally {
  await app.close().catch(() => {});
}
// model memory as Ollama reports it
const ps = await fetch('http://127.0.0.1:11434/api/ps').then((x) => x.json()).catch(() => null);
const loaded = ps?.models?.map((m) => ({ name: m.name, sizeGB: +(m.size / 1e9).toFixed(2), vramGB: +((m.size_vram ?? 0) / 1e9).toFixed(2) })) ?? [];
console.log('\nOllama loaded:', JSON.stringify(loaded));
const file = path.join(APP_DIR, 'data/audit/self-ai', `six-tests-${label}.json`);
fs.writeFileSync(file, JSON.stringify({ at: new Date().toISOString(), label, ollama: loaded, results: out }, null, 2));
console.log(`\nsaved ${path.relative(APP_DIR, file)}`);
