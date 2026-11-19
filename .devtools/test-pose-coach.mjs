// 4차 — pose check through the existing measurement (spec 10-4), offline. Synthetic pose frames
// (no real person video): the existing rule engine (analyzeTechnique) scores them. Checks support,
// capture guide, single-technique reference choice, blocked captures, joints not seen (no made-up
// score), unsupported techniques, the in-lesson suggestion rule, and the coach's pose requests.
// Run: node .devtools/test-pose-coach.mjs
import { build } from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pose-coach-'));
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(path.join(dir, 'e.ts'), [
  `export * as PC from ${mod('src/lib/poseCoach/poseCoach.ts')};`,
  `export { analyzeTechnique } from ${mod('src/lib/poseAnalysis/analyzeTechnique.ts')};`,
  `export { planTurn } from ${mod('src/lib/selfAi/router.ts')};`,
  `export { runCoachTurn } from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export { resolveTechnique } from ${mod('src/lib/userTechniques/service.ts')};`,
  `export { buildKnowledgeIndex } from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
].join('\n'));
const mem = new Map();
const st = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k), key: () => null, get length() { return 0; } };
globalThis.window = { localStorage: st, sessionStorage: st, dispatchEvent: () => true, addEventListener() {}, removeEventListener() {}, setTimeout: () => 0, clearTimeout() {}, location: { href: 'http://localhost/', search: '', hash: '' }, matchMedia: () => ({ matches: false, addEventListener() {} }), martialdex: {} };
globalThis.localStorage = st;
globalThis.CustomEvent ??= class {};
await build({ entryPoints: [path.join(dir, 'e.ts')], bundle: true, format: 'esm', platform: 'node', outfile: path.join(dir, 'r.mjs'), logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
const M = await import(pathToFileURL(path.join(dir, 'r.mjs')).href);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  cond ? pass++ : fail++;
  console.log(`${cond ? 'PASS' : 'FAIL'} — ${name}${cond ? '' : ` :: ${JSON.stringify(detail)?.slice(0, 600)}`}`);
}
const T = (id) => M.resolveTechnique(id);
const jab = T('boxing__jab');
const single = T('wrestling__high-single');

// ---- support + guide
check('[S1] 측정 가능(잽) / 불가(하이 싱글) 구분, 불가면 같은 무술의 측정 가능 기술 안내', M.PC.poseSupport(jab).supported && !M.PC.poseSupport(single).supported && M.PC.poseSupport(single).alternatives.some((a) => /stance|level|penetration/i.test(a.id)), M.PC.poseSupport(single));
const gj = M.PC.captureGuide(jab);
const gw = M.PC.captureGuide(T('wrestling__level-change'));
check('[S2] 촬영 안내는 측정 설정에서: 잽(무릎 지표 있음)·레벨 체인지 → 범위·높이·거리·동작·방향(비교 안 함 명시)', !!gj && !!gw && /몸 전체/.test(gw.bodyRange) && /비교하지 않습니다/.test(gj.direction) && gj.measures.includes('팔 위치'), { gj, gw });
check('[S3] 측정 불가 기술은 촬영 안내 없음', M.PC.captureGuide(single) === null);

// ---- reference videos: single technique, playable, not compilations
const v = (title, embed = 'embeddable', duration = '3:20') => ({ n: 1, title, url: `https://www.youtube.com/watch?v=${Buffer.from(title).toString('base64').slice(0, 11)}`, sourceType: 'video', sourceTypeLabel: '영상', reliability: { level: 'medium', label: '보통', reasons: [] }, contentRead: false, video: { videoId: 'x', embed, duration } });
const refs = M.PC.pickReferenceVideos([v('How to Throw a Perfect Jab'), v('Top 10 Jab Knockouts'), v('Jab Cross Hook Combo Drill'), v('Jab tutorial', 'not_embeddable'), v('Boxing basics for beginners'), v('The Jab - full breakdown', 'embeddable', '15:20'), v('잽 기본 강좌')], jab);
check('[S4] 기준 영상: 단일 기술·앱 재생 가능·10분 미만만, 하이라이트·콤보·재생 불가·이름 없는 영상 제외', refs.picked.map((p) => p.title).join('|') === 'How to Throw a Perfect Jab|잽 기본 강좌' || refs.picked.map((p) => p.title).sort().join('|') === ['How to Throw a Perfect Jab', '잽 기본 강좌'].sort().join('|'), refs);
check('[S5] 제외 이유가 기록됨', refs.rejected.length === 5 && refs.rejected.some((r) => r.why === '여러 기술·하이라이트 영상') && refs.rejected.some((r) => r.why === '앱에서 재생 불가') && refs.rejected.some((r) => r.why === '10분 이상'), refs.rejected);

// ---- synthetic jab frames: stance, the right arm extends then returns
const P = (x, y) => ({ x, y, z: 0, visibility: 0.99 });
function frame(i, ext, opts = {}) {
  const f = { timestampMs: i * 100, nose: P(0.5, 0.2), leftShoulder: P(0.44, 0.32), rightShoulder: P(0.56, 0.32), leftHip: P(0.46, 0.58), rightHip: P(0.54, 0.58), leftKnee: P(0.45, 0.74), rightKnee: P(0.56, 0.74), leftAnkle: P(0.44, 0.9), rightAnkle: P(0.58, 0.9), leftElbow: P(0.42, 0.42), leftWrist: P(0.45, 0.3) };
  // right arm: bent guard (ext 0) → straight forward-right (ext 1)
  f.rightElbow = P(0.6 + 0.08 * ext, 0.4 - 0.06 * ext);
  f.rightWrist = P(0.58 + 0.2 * ext, 0.3 - 0.0 * ext);
  if (opts.noArms) { delete f.leftElbow; delete f.leftWrist; delete f.rightElbow; delete f.rightWrist; }
  return f;
}
const ext = (i) => (i < 8 ? 0 : i < 13 ? (i - 8) / 5 : i < 18 ? 1 - (i - 13) / 5 : 0);
const frames = Array.from({ length: 30 }, (_, i) => frame(i, ext(i)));
const sig = { visibleRatio: 1, fullBodyRatio: 1, issues: [], cameraView: 'front', segment: { startMs: 800, endMs: 1800 } };
const ok = M.PC.evaluatePoseFrames(jab, frames, sig);
check('[S6] 정상 촬영(합성 관절) → 기존 규칙 엔진으로 점수·측정 항목·신뢰도·다음 훈련', ok.ok && typeof ok.result.overallScore === 'number' && ok.measured.length >= 2 && ['높음', '보통', '낮음'].includes(ok.reliability.label) && ok.nextTraining.length > 0, ok);
const scoreFromMeasured = Math.round(ok.measured.reduce((n, m) => n + m.score, 0) / ok.measured.length);
check('[S7] 종합 점수 = 측정된 항목만의 평균(측정 불가 항목 제외)', ok.result.overallScore === scoreFromMeasured, [ok.result.overallScore, scoreFromMeasured, ok.unmeasured]);
const noArm = M.PC.evaluatePoseFrames(jab, Array.from({ length: 30 }, (_, i) => frame(i, ext(i), { noArms: true })), sig);
check('[S8] 팔 관절을 못 찾음 → 팔 지표는 측정 불가로 빠지고 점수에 50점이 섞이지 않음(또는 점수 없음)', (!noArm.ok && /관절|인식/.test(noArm.failure)) || (noArm.ok && noArm.unmeasured.some((u) => /팔|회전/.test(u.name)) && noArm.result.overallScore === Math.round(noArm.measured.reduce((n, m) => n + m.score, 0) / noArm.measured.length)), noArm);
const raw = M.analyzeTechnique('boxing__jab', Array.from({ length: 30 }, (_, i) => frame(i, ext(i), { noArms: true })));
check('[S9] 기존 엔진도 측정 불가 지표를 평균에 넣지 않음', !raw.ok ? raw.reason === 'insufficient_metrics' : raw.result.metricScores.filter((m) => m.measured === false).length > 0 && raw.result.overallScore === Math.round(raw.result.metricScores.filter((m) => m.measured !== false).reduce((n, m) => n + m.score, 0) / raw.result.metricScores.filter((m) => m.measured !== false).length), raw);
const blocked = M.PC.evaluatePoseFrames(jab, frames, { ...sig, issues: ['no_person'], visibleRatio: 0.2 });
check('[S10] 사람 안 보임 → 점수 없이 재촬영 안내', !blocked.ok && /다시 촬영/.test(blocked.failure) && blocked.result === null, blocked);
const cut = M.PC.evaluatePoseFrames(T('wrestling__level-change'), frames, { ...sig, issues: ['body_cut_off'], fullBodyRatio: 0.3 });
check('[S11] 몸 전체가 필요한 기술인데 잘림 → 재촬영', !cut.ok && /몸 일부가 화면 밖/.test(cut.failure), cut);
const un = M.PC.evaluatePoseFrames(single, frames, sig);
check('[S12] 측정 불가 기술 → 측정하지 않음, 점수 없음', !un.ok && un.result === null && /기준이 없는 기술/.test(un.failure), un);

// ---- lesson suggestion rule
check('[S13] 수업 제안 조건: 측정 가능 + 실습 끝 + 거절·제안 이력 없음일 때만', M.PC.shouldSuggestPose(jab, { practiced: true, declined: false, alreadySuggested: false }) && !M.PC.shouldSuggestPose(jab, { practiced: false, declined: false, alreadySuggested: false }) && !M.PC.shouldSuggestPose(jab, { practiced: true, declined: true, alreadySuggested: false }) && !M.PC.shouldSuggestPose(jab, { practiced: true, declined: false, alreadySuggested: true }) && !M.PC.shouldSuggestPose(single, { practiced: true, declined: false, alreadySuggested: false }));

// ---- coach requests
const phrases = ['내 잽 자세가 맞는지 확인하고 싶어.', '싱글렉 자세를 영상으로 평가해 줘.', '내가 하는 스프롤 자세가 정확한지 확인하고 싶어.', '이 기술을 제대로 수행하는지 측정해 줘.'];
const intents = phrases.map((p) => M.planTurn(p, { inLesson: p.startsWith('이 기술'), lessonTechnique: jab }).intent);
check('[S14] 자세 확인 요청 4문장 → pose_check', intents.every((i) => i === 'pose_check'), intents);
const index = M.buildKnowledgeIndex({ sharedCombos: [], comboLinks: [] });
const searches = [];
const deps = (results) => ({ research: async (r) => (searches.push(r), { ok: true, kind: 'video', results, diagnostics: {} }), chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'off' }), knowledgeIndex: async () => index, learnerContext: () => '', artName: (a) => a });
const vr = (title) => ({ title, url: `https://www.youtube.com/watch?v=${Buffer.from(title).toString('base64').slice(0, 11)}`, source: 'youtube.com', sourceType: 'video', sourceTypeLabel: '영상', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'skipped' }, video: { videoId: Buffer.from(title).toString('base64').slice(0, 11), embed: 'embeddable', duration: '4:10' } });
const a1 = await M.runCoachTurn({ text: phrases[0], history: [], martialArt: null, requestId: 'p1' }, deps([vr('How to Throw a Perfect Jab'), vr('Top 10 Jab Knockouts')]));
check('[S15] "내 잽 자세 확인" → 기준 영상(단일 기술만)·촬영 안내·측정 시작 버튼, 영상 자세 미확인 명시', /^\/pose-check\/(boxing|kickboxing)__jab$/.test(a1.message.action?.to ?? '') && a1.message.videos?.length === 1 && /촬영 안내/.test(a1.message.text) && /영상 속 자세는 앱이 확인하지 않았습니다/.test(a1.message.text), a1.message);
searches.length = 0;
const a2 = await M.runCoachTurn({ text: phrases[1], history: [], martialArt: null, requestId: 'p2' }, deps([vr('x')]));
check('[S16] "싱글렉 자세 평가" → 측정 기준 없음 안내, 검색·측정 시작 안 함, 대안 기술', !a2.message.action && searches.length === 0 && /기준이 없는 기술/.test(a2.message.text) && /측정할 수 있는 기술/.test(a2.message.text), a2.message.text);
const a3 = await M.runCoachTurn({ text: phrases[0], history: [], martialArt: null, requestId: 'p3' }, deps([vr('Top 10 Jab Knockouts'), vr('Jab Cross Hook Combo')]));
check('[S17] 적절한 기준 영상 없음 → 측정을 시작하지 않고 이유', !a3.message.action && /기준 영상을 찾지 못해 자세 측정을 시작하지 않았습니다/.test(a3.message.text), a3.message.text);

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
process.exit(fail ? 1 : 0);
