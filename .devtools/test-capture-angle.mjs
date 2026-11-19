// Unit tests — Phase 6 reference angle / filming-direction check (no browser, no network).
//   node .devtools/test-capture-angle.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));

const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const A = await server.ssrLoadModule('/src/lib/formCompare/captureAngle.ts');
  const ai = await server.ssrLoadModule('/src/lib/formCompare/ai.ts');
  const { scoreComparison } = await server.ssrLoadModule('/src/lib/formCompare/scoring.ts');
  const { parseJudgement } = ai.__judgementParsingForTests;

  const m3d = (angle, cameraView = 'front', profileView = 'unknown') => ({ id: 'r', source: { kind: 'motion3d', angle }, cameraView, profile: { cameraView: profileView } });
  console.log('\n[1] 기준 각도 — 3D는 사용자가 고른 각도가 확정값');
  for (const a of ['front', 'diagonal', 'side', 'back']) {
    const r = A.referenceAngle(m3d(a, 'front', 'front'));
    check(`3D ${a} 기준 → 안내 각도 ${a} (Gemini 프로필 값보다 우선)`, r.view === a && r.source === 'motion3d', r);
  }
  check('파일 기준 → Gemini가 본 방향', A.referenceAngle({ source: { kind: 'file' }, cameraView: 'front', profile: { cameraView: 'side' } }).view === 'side');
  check('파일 기준, 프로필 방향 unknown → 사용자가 입력한 방향', A.referenceAngle({ source: { kind: 'file' }, cameraView: 'diagonal', profile: { cameraView: 'unknown' } }).source === 'stated');
  for (const a of ['front', 'diagonal', 'side', 'back']) check(`각도별 배치 안내 문구 존재: ${a}`, !!A.ANGLE_GUIDE[a]?.placement && !!A.ANGLE_GUIDE[a]?.onScreen);

  console.log('\n[2] 로컬 방향 비교 (같은 추정기끼리)');
  const L = A.localViewRelation;
  check('같음 → consistent', L('side', 'side') === 'consistent');
  check('정면 ↔ 측면 → mismatch', L('front', 'side') === 'mismatch' && L('side', 'front') === 'mismatch');
  check('인접(대각선) → unclear (추정기로 구분 불가)', L('diagonal', 'front') === 'unclear' && L('side', 'diagonal') === 'unclear');
  check('후면 포함 → unknown (어깨 너비로 앞뒤 구분 불가)', L('back', 'front') === 'unknown' && L('front', 'back') === 'unknown');
  check('추정 실패 → unknown', L('front', 'unknown') === 'unknown');
  // Phase 5 실측 상황: 3D 대각선 녹화의 로컬 추정값은 'side', 정면 촬영 사용자는 'front'
  check('Phase 5 상황(3D 대각선 기준 추정=side, 사용자 정면) → mismatch', L('side', 'front') === 'mismatch');

  console.log('\n[3] 종합 판정');
  const base = { referenceView: 'diagonal', referenceViewSource: 'motion3d', userViewLocal: 'front', userViewAi: null, aiNote: null };
  const C = (local, ai, extra = {}) => A.combineViewCheck({ ...base, local, ai, ...extra });
  check('Gemini different → mismatch + 재촬영 안내', C('consistent', 'different').status === 'mismatch' && /다시 배치하고 촬영/.test(C('consistent', 'different').message));
  check('로컬 mismatch → Gemini가 same이라 해도 mismatch(의심되면 경고)', C('mismatch', 'same').status === 'mismatch');
  check('Gemini same + 로컬 consistent → match, 메시지 없음', C('consistent', 'same').status === 'match' && C('consistent', 'same').message === null);
  check('Gemini same + 로컬 unclear → match', C('unclear', 'same').status === 'match');
  check('Gemini uncertain + 로컬 unclear → unknown(확인 불가)', C('unclear', 'uncertain').status === 'unknown' && /확인할 수 없습니다/.test(C('unclear', 'uncertain').message));
  check('Gemini 응답 없음 + 로컬 consistent → match', C('consistent', null).status === 'match');
  check('Gemini 응답 없음 + 로컬 unknown → unknown', C('unknown', null).status === 'unknown');
  check('경고 문구에 기준 각도 이름 포함', C('consistent', 'different').message.includes('45° 대각선'));

  console.log('\n[4] Gemini viewCheck 파싱');
  check('정상 응답 파싱', A.parseAiViewCheck({ relation: 'different', userView: 'front', note: '정면' })?.relation === 'different');
  check('relation 이상값 → null(답하지 않은 것으로)', A.parseAiViewCheck({ relation: 'maybe' }) === null && A.parseAiViewCheck(null) === null && A.parseAiViewCheck('x') === null);
  check('userView 이상값 → unknown', A.parseAiViewCheck({ relation: 'same', userView: 'top' }).userView === 'unknown');

  console.log('\n[5] 시점 때문에 안 보인 기준은 틀림이 아님');
  const criteria = [
    { id: 'C1', phaseId: 'P1', aspect: 'start_posture', importance: 'core', description: '가드' },
    { id: 'C2', phaseId: 'P2', aspect: 'limb_motion', importance: 'core', description: '뻗기' },
    { id: 'C3', phaseId: 'P2', aspect: 'body_position', importance: 'core', description: '뒷손' },
  ];
  const phases = [{ id: 'P1', name: '준비' }, { id: 'P2', name: '뻗기' }];
  const profile = { criteria, phases };
  const crit = (id, verdict, extra = {}) => ({ criterionId: id, verdict, confidence: 'high', observation: 'x', referenceObservation: '', ...extra });
  const j = parseJudgement({ viewCheck: { relation: 'different', userView: 'front', note: '정면' }, criteria: [crit('C1', 'match'), crit('C2', 'mismatch', { viewLimited: true }), crit('C3', 'partial', { viewLimited: true })] }, profile);
  check('viewLimited mismatch → not_observable', j.criteria[1].verdict === 'not_observable', j.criteria[1]);
  check('viewLimited partial → not_observable', j.criteria[2].verdict === 'not_observable');
  check('viewLimited 기준 목록 기록', JSON.stringify(j.viewLimitedCriteria) === '["C2","C3"]');
  check('viewCheck 보존', j.viewCheck?.relation === 'different');
  const jm = parseJudgement({ criteria: [crit('C1', 'match', { viewLimited: true }), crit('C2', 'mismatch')] }, profile);
  check('viewLimited match → 판정 유지, 확신도만 low', jm.criteria[0].verdict === 'match' && jm.criteria[0].confidence === 'low');
  check('viewLimited 없는 mismatch → 그대로 mismatch (실제로 다르게 수행)', jm.criteria[1].verdict === 'mismatch');

  console.log('\n[6] 신뢰도 처리 — 점수 계산식은 그대로, viewMatches 입력만');
  const signals = { visibleRatio: 1 };
  const judgement = parseJudgement({ criteria: [crit('C1', 'match'), crit('C2', 'match'), crit('C3', 'partial')] }, profile);
  const sMatch = scoreComparison({ criteria, phases, judgement, signals, viewMatches: true });
  const sOther = scoreComparison({ criteria, phases, judgement, signals, viewMatches: false });
  check('같은 판정이면 점수는 방향 확인 결과와 무관하게 동일', sMatch.score === sOther.score && sMatch.score !== null, [sMatch.score, sOther.score]);
  check('방향 일치 확인 → 신뢰도 높음 가능', sMatch.reliability === 'high', sMatch.reliabilityValue);
  check('방향 불일치/확인 불가 → 신뢰도 높음 아님', sOther.reliability !== 'high', sOther.reliabilityValue);
  for (const st of [['mismatch', C('consistent', 'different')], ['unknown', C('unclear', 'uncertain')], ['match', C('consistent', 'same')]]) {
    const b = scoreComparison({ criteria, phases, judgement, signals, viewMatches: st[1].status === 'match' });
    check(`종합 ${st[0]} → 신뢰도 ${st[0] === 'match' ? '높음' : '높음 아님'}`, st[0] === 'match' ? b.reliability === 'high' : b.reliability !== 'high', b.reliability);
  }

  console.log('\n[7] 3D 녹화 기준의 동작 구간 (자세 추정이 마네킹에서 실패할 때)');
  const S = await server.ssrLoadModule('/src/lib/formCompare/service.ts');
  const phases3d = [{ name: 'prepare', startSec: 0, endSec: 0.2667 }, { name: 'execute', startSec: 0.2667, endSec: 0.5333 }, { name: 'recover', startSec: 0.5333, endSec: 0.8 }];
  const seg = S.motion3dSegment(1.636, 1.2, phases3d);
  check('파일 1636ms / 동작 1200ms → 구간 436~1636ms', seg.startMs === 436 && seg.endMs === 1636, seg);
  check('정점 = lead-in + execute 끝(533ms) → 969ms (실측 뻗기 0.78~0.97s)', seg.peakMs === 969, seg);
  check('lead-in이 음수가 되지 않음', S.motion3dSegment(1.1, 1.2, phases3d).startMs === 0);
  check('파일 길이를 모르면 null (추정하지 않음)', S.motion3dSegment(0, 1.2, phases3d) === null);
  check('execute 단계가 없으면 동작 중간을 정점으로', S.motion3dSegment(1.7, 1.2, []).peakMs === 1100);
} finally {
  await server.close();
}
const passed = results.filter(Boolean).length;
console.log(`\n=== SUMMARY: ${passed}/${results.length} passed ===`);
process.exit(passed === results.length ? 0 : 1);
