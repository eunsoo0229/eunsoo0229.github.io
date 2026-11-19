// Unit test — an incomplete / malformed AI judgement must never become a wrong score.
// No network, no Gemini: feeds crafted responses through the SAME validator, parser and
// scorer the live judgeAttempt → finishComparison path uses.
//   node .devtools/test-form-judgement-robustness.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));

const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const ai = await server.ssrLoadModule('/src/lib/formCompare/ai.ts');
  const { scoreComparison } = await server.ssrLoadModule('/src/lib/formCompare/scoring.ts');
  const { isRawJudgement, parseJudgement } = ai.__judgementParsingForTests;

  const phases = [{ id: 'P1', name: '준비' }, { id: 'P2', name: '뻗기' }, { id: 'P3', name: '회수' }];
  const criteria = [
    { id: 'C1', phaseId: 'P1', aspect: 'start_posture', description: '가드', importance: 'core', evidence: '' },
    { id: 'C2', phaseId: 'P2', aspect: 'limb_motion', description: '뻗기', importance: 'core', evidence: '' },
    { id: 'C3', phaseId: 'P2', aspect: 'body_position', description: '뒷손', importance: 'core', evidence: '' },
    { id: 'C4', phaseId: 'P3', aspect: 'trajectory', description: '회수', importance: 'core', evidence: '' },
    { id: 'C5', phaseId: 'P3', aspect: 'finish', description: '복귀', importance: 'support', evidence: '' },
  ];
  const profile = { criteria, phases };
  const signals = { visibleRatio: 1, fullBodyRatio: 1 };
  const score = (raw) => scoreComparison({ criteria, phases, judgement: parseJudgement(raw, profile), signals, viewMatches: true });
  const crit = (id, verdict, confidence = 'high') => ({ criterionId: id, verdict, confidence, observation: '', referenceObservation: '' });

  // 1. Validator rejects shapes that cannot be judged (the call then fails → no score).
  for (const [name, v] of [['null', null], ['문자열', 'ok'], ['criteria 없음', { sameTechnique: true }], ['criteria가 객체', { criteria: {} }], ['잘린 JSON 파싱 결과(undefined)', undefined]]) {
    check(`검증기가 거부: ${name}`, isRawJudgement(v) === false);
  }

  // 2. Empty criteria → nothing observed → insufficient, no number.
  const empty = score({ criteria: [] });
  check('기준 판정이 비어 있으면 점수 없음(insufficient)', empty.status === 'insufficient' && empty.score === null, empty);

  // 3. Only one criterion answered → the rest are NOT assumed correct.
  const one = score({ criteria: [crit('C1', 'match')] });
  check('빠진 기준은 정답으로 간주하지 않음 → 점수 없음', one.status === 'insufficient' && one.score === null, one);
  check('빠진 기준은 not_observable로 기록', parseJudgement({ criteria: [crit('C1', 'match')] }, profile).criteria.filter((c) => c.verdict === 'not_observable').length === 4);

  // 4. Unknown verdict / confidence values degrade, never upgrade.
  const junk = parseJudgement({ criteria: [crit('C1', 'perfect', 'very'), crit('C2', 'MATCH')] }, profile);
  check('알 수 없는 verdict는 not_observable', junk.criteria[0].verdict === 'not_observable' && junk.criteria[1].verdict === 'not_observable', junk.criteria.slice(0, 2));
  check('알 수 없는 confidence는 low', junk.criteria[0].confidence === 'low');

  // 5. Unknown / duplicate criterion ids are ignored (no padding the score).
  const dup = parseJudgement({ criteria: [crit('C9', 'match'), crit('C2', 'mismatch'), crit('C2', 'match')] }, profile);
  check('없는 기준 id는 무시', !dup.criteria.some((c) => c.criterionId === 'C9'));
  check('중복 id는 첫 판정만 채택', dup.criteria.find((c) => c.criterionId === 'C2').verdict === 'mismatch');

  // 6. Explicit "not performed" / "different technique" → no number.
  const all = criteria.map((c) => crit(c.id, 'match'));
  const np = score({ techniquePerformed: false, criteria: all });
  check('techniquePerformed=false → 점수 없음', np.status === 'not_performed' && np.score === null, np);
  const dt = score({ sameTechnique: false, criteria: all });
  check('sameTechnique=false → 점수 없음', dt.status === 'different_technique' && dt.score === null, dt);

  // 7. The Phase 5 live judgement, replayed: core mismatch caps the score.
  const live = score({ sameTechnique: true, techniquePerformed: true, criteria: [crit('C1', 'match'), crit('C2', 'mismatch'), crit('C3', 'partial', 'medium'), crit('C4', 'partial', 'medium'), crit('C5', 'match')] });
  check('Phase 5 실호출 판정 재현 → 50점(원점수 57, 핵심 불일치 상한)', live.status === 'scored' && live.score === 50 && live.rawScore === 57 && live.cap?.value === 50, live);
  check('모두 일치 → 100점', score({ criteria: all }).score === 100);
} finally {
  await server.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
