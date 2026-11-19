// 자체 AI 코치 vs Gemini 코치 — the SAME questions, each coach through its real app path
// (coachProvider/backend.ts geminiCoach.answerQuestion / martialdexCoach.answerQuestion), in the real
// Electron app (hidden + muted by electron/main.cjs). Gemini is called only here, ≤ 10 questions.
// Writes the answers + simple measures to the file given as argv[2] (JSON) for the comparison table.
// Requires the Vite dev server on :5173 and Gemini configured in .env.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP_DIR = '/Users/swcho/Documents/MARTIALDEX';
const OUT = process.argv[2] ?? path.join(os.tmpdir(), 'coach-compare.json');
// QSET=validation: questions from the 5th-round validation set (test-coach-validation.mjs), lesson technique as context
const VALIDATION = [
  { id: 'kickboxing__cross', q: '크로스 칠 때 젤 중요한 게 뭐임', aspect: '구어 질문' },
  { id: 'kickboxing__low-kick', q: '로우킥 차는 법 좀 ㅠ', aspect: '구어 수행 방법' },
  { id: 'boxing__hook', q: '훅 어떻게 쳐?', aspect: '수행 방법 완성도' },
  { id: 'wrestling__sprawl', q: '스프롤 하면 무릎에 안 좋아?', aspect: '안전·자료 없음' },
  { id: 'bjj__kimura', q: '기무라는 왜 이름이 기무라야?', aspect: '자료 없음' },
  { id: 'kickboxing__jab', q: '니킥 계속 맞는데 어떡하지', aspect: '상황 추천' },
  { id: 'bjj__armbar', q: '백 마운트 당했어 빠져나가는 방법', aspect: '탈출 상황' },
  { id: 'kickboxing__teep', q: '그거랑 프론트킥은 뭐가 달라?', aspect: '문맥 비교' },
];
const QUESTIONS = process.env.QSET === 'validation' ? VALIDATION : [
  { id: 'kickboxing__jab', q: '잽 칠 때 발은 어떻게 둬?', aspect: '의도 이해(세부 부위)' },
  { id: 'kickboxing__jab', q: '왜 자꾸 균형이 무너지지?', aspect: '의도 이해(문제 진단)' },
  { id: 'bjj__armbar', q: '암바 어떻게 해?', aspect: '답변 완성도' },
  { id: 'bjj__armbar', q: '흔한 실수는?', aspect: '문맥 유지(기술명 생략)' },
  { id: 'wrestling__basic-double-leg', q: '상대가 계속 태클 들어오면 어떻게 막아?', aspect: '상황 코칭' },
  { id: 'kickboxing__jab', q: '이 기술 다음엔 뭘 배우는 게 좋아?', aspect: '다음 학습 추천' },
  { id: 'kickboxing__jab', q: '이거 미트로 연습할 수 있어?', aspect: '미트 선택' },
  { id: 'bjj__rear-naked-choke', q: '리어 네이키드 초크 할 때 발은 어떻게 해?', aspect: '자료 부족 처리' },
  { id: 'kickboxing__jab', q: '잽 칠 때 심박수는 얼마나 올라가?', aspect: '자료 밖 질문' },
  { id: 'judo__osoto-gari', q: '오소토가리랑 오우치가리 차이는?', aspect: '기술 비교' },
];

const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-compare-'))}`], env, timeout: 120000 });
const page = await app.firstWindow();
await page.waitForLoadState('load');
await new Promise((r) => setTimeout(r, 2500));
const rows = [];
for (const item of QUESTIONS) {
  const r = await page.evaluate(async ({ id, q }) => {
    const b = await import('/src/lib/coachProvider/backend.ts');
    const s = await import('/src/lib/userTechniques/service.ts');
    const t = s.resolveTechnique(id);
    const input = { technique: t, question: q, dayContext: '', history: [], place: '' };
    const t0 = performance.now();
    const own = await b.martialdexCoach.answerQuestion(input);
    const t1 = performance.now();
    let gem;
    try {
      gem = await b.geminiCoach.answerQuestion(input);
    } catch (e) {
      gem = { ok: false, message: String(e) };
    }
    const t2 = performance.now();
    const data = [t.name, t.koreanName ?? '', t.description, t.purpose ?? '', ...(t.positions ?? []), t.posture?.overview ?? '', ...(t.posture?.steps ?? []), ...(t.posture?.keyPoints ?? []), ...(t.posture?.commonMistakes ?? []), ...Object.values(t.posture?.bodyPosition ?? {})].join(' ');
    return { own: own.ok ? own.text : `실패: ${own.message}`, ownMs: Math.round(t1 - t0), gemini: gem.ok ? gem.text : `실패: ${gem.message}`, geminiOk: !!gem.ok, geminiMs: Math.round(t2 - t1), data };
  }, item);
  const tok = (s) => [...new Set((s.toLowerCase().match(/[가-힣]{2,}|[a-z]{3,}/g) ?? []))];
  const dataTok = tok(r.data);
  const outside = (s) => tok(s).filter((w) => !dataTok.some((d) => d.includes(w) || w.includes(d))).length;
  rows.push({ ...item, own: r.own, gemini: r.gemini, geminiOk: r.geminiOk, ownMs: r.ownMs, geminiMs: r.geminiMs, ownOutsideWords: outside(r.own), geminiOutsideWords: outside(r.gemini) });
  console.log(`— [${item.aspect}] ${item.q}\n  자체(${r.ownMs}ms): ${r.own.slice(0, 220)}\n  Gemini(${r.geminiMs}ms): ${r.gemini.slice(0, 220)}`);
}
fs.writeFileSync(OUT, JSON.stringify(rows, null, 2));
console.log(`\nwrote ${OUT} · Gemini answered ${rows.filter((r) => r.geminiOk).length}/${rows.length}`);
await app.close();
