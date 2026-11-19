// Unit test — 3D-reference pose measurement: capture length from the reference (timedCapture/reference.ts), the
// monotonic window (clock.ts), reference joints sampled from the real GLBs (motion3d/referencePose.ts) and the
// comparison (poseCompare3d/compare.ts). "Learner" frames are synthesised from the reference itself (projected,
// shifted, mirrored, noised, occluded) — no camera; the live camera path is covered by qa-pose-capture.mjs.
//   node .devtools/test-pose-compare3d.mjs
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 260) : '')));
globalThis.performance ??= { now: () => Date.now() };

// Node has no image decoder: characters are parsed from a copy whose JSON drops texture references
const glbNoTextures = (file) => {
  const b = fs.readFileSync(file);
  const jl = b.readUInt32LE(12);
  const j = JSON.parse(b.subarray(20, 20 + jl).toString());
  delete j.images;
  delete j.textures;
  delete j.samplers;
  for (const m of j.materials || []) if (m.pbrMetallicRoughness) delete m.pbrMetallicRoughness.baseColorTexture;
  let js = Buffer.from(JSON.stringify(j));
  js = Buffer.concat([js, Buffer.alloc((4 - (js.length % 4)) % 4, 0x20)]);
  const rest = b.subarray(20 + jl);
  const head = Buffer.alloc(20);
  head.write('glTF', 0, 'ascii');
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(20 + js.length + rest.length, 8);
  head.writeUInt32LE(js.length, 12);
  head.writeUInt32LE(0x4e4f534a, 16);
  const out = Buffer.concat([head, js, rest]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
};

const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const { AnimationMixer } = await import('three');
  const RP = await server.ssrLoadModule('/src/lib/motion3d/referencePose.ts');
  const C = await server.ssrLoadModule('/src/lib/poseCompare3d/compare.ts');
  const R = await server.ssrLoadModule('/src/lib/timedCapture/reference.ts');
  const K = await server.ssrLoadModule('/src/lib/timedCapture/clock.ts');
  const catalog = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/motion3d.json'), 'utf8'));
  const clip = (id) => catalog.clips.find((c) => c.clipId === id);

  // ---------------------------------------------------------------- capture length = reference length
  const jab = R.referenceFromClip(clip('boxing-jab-nw-v2'), 'boxing__jab');
  const cross = R.referenceFromClip(clip('boxing-cross-m2m-v3'), 'boxing__cross');
  check('[길이] 3D 잽 = 55프레임 / 30fps = 1833 ms (1.0배속 1회 재생)', jab.ok && jab.reference.durationMs === 1833 && jab.reference.fps === 30 && jab.reference.frameCount === 55, jab);
  check('[길이] 3D 크로스 = 40 / 30 = 1333 ms', cross.ok && cross.reference.durationMs === 1333, cross);
  check('[길이] fps·프레임 수와 durationSec가 안 맞으면 오류 (임의 길이 없음)', R.referenceFromClip({ ...clip('boxing-cross-m2m-v3'), durationSec: 3 }, 'x').problem === 'unknown_duration');
  check('[길이] fps 없음 → 오류', R.referenceFromClip({ ...clip('boxing-cross-m2m-v3'), fps: 0 }, 'x').problem === 'unknown_duration');
  const vid = (start, end, extra = {}) => ({ id: 'v1', techniqueId: 'boxing__cross', martialArt: 'boxing', source: { kind: 'youtube', videoId: 'abcdefghijk', url: '', title: 'Cross', channel: 'c', lengthSeconds: 600 }, startSeconds: start, endSeconds: end, cameraView: 'side', createdAt: '', updatedAt: '', profile: null, hasLocalMedia: false, ...extra });
  const v1 = R.referenceFromVideo(vid(12.5, 14.0));
  check('[길이] 기준 영상 = 지정 구간 길이 (12.5–14.0 s → 1500 ms), 촬영 각도 = 영상 방향', v1.ok && v1.reference.durationMs === 1500 && v1.reference.segmentStartSec === 12.5 && v1.reference.angles.join() === 'side', v1);
  check('[거부] 30초 구간(강의·여러 기술) → segment_too_long', R.referenceFromVideo(vid(0, 30)).problem === 'segment_too_long');
  check('[거부] 구간 없음/역순 → unknown_duration', R.referenceFromVideo(vid(10, 10)).problem === 'unknown_duration' && R.referenceFromVideo(vid(10, NaN)).problem === 'unknown_duration');
  check('[거부] 기준 분석상 다른 기술 → not_this_technique', R.referenceFromVideo(vid(1, 2, { profile: { matchesTechnique: false, techniqueVisible: true, observedTechnique: 'Hook', cameraView: 'side' } })).problem === 'not_this_technique');
  const pick = R.chooseCaptureReference('boxing__cross', { clips: [clip('boxing-cross-m2m-v3')], videos: [vid(0, 40)] });
  check('[대체] 부적합 영상 → 3D 기준으로 (영상 필수 아님), 거부 사유 기록', pick.outcome.ok && pick.outcome.reference.kind === 'motion3d' && pick.rejected.length === 1 && pick.rejected[0].problem === 'segment_too_long', pick);
  const pickV = R.chooseCaptureReference('boxing__cross', { clips: [clip('boxing-cross-m2m-v3')], videos: [vid(3, 4.2)] });
  check('[선택] 적합한 지정 구간 영상이 있으면 그 영상 기준', pickV.outcome.ok && pickV.outcome.reference.kind === 'video' && pickV.outcome.reference.durationMs === 1200);
  const none = R.chooseCaptureReference('boxing__uppercut', { clips: [], videos: [] });
  check('[없음] 3D도 지정 영상도 없으면 오류 (고정 시간으로 촬영 안 함)', !none.outcome.ok && none.outcome.problem === 'no_reference');

  // ---------------------------------------------------------------- monotonic window
  const c0 = K.startClock(1333, 1000);
  check('[시계] 끝 시각은 시작 때 고정 (start + 길이)', c0.endAt === 2333 && K.remainingMs(c0, 1500) === 833 && K.remainingMs(c0, 9999) === 0 && K.remainingMs(c0, 0) === 1333);
  check('[시계] 게이지: 시작 1 → 끝 0 으로 감소', K.drainFraction(c0, 1000) === 1 && Math.abs(K.drainFraction(c0, 1666.5) - 0.5) < 1e-9 && K.drainFraction(c0, 2400) === 0);
  const late = K.clipToWindow(c0, [{ timestampMs: 990 }, { timestampMs: 1000 }, { timestampMs: 2333 }, { timestampMs: 2340 }]);
  check('[시계] 늦게 멈춰도 끝 시각 이후 프레임은 제외', late.length === 2 && late.at(-1).timestampMs === 2333);
  let threw = false;
  try { K.startClock(NaN); } catch { threw = true; }
  check('[시계] 길이를 모르면 시작 불가', threw);

  // ---------------------------------------------------------------- reference joints from the GLBs
  const charBuf = glbNoTextures(path.join(APP, 'public', catalog.characters['m2m-human-base-v1'].file));
  const loadM2M = async (id) => {
    const ch = await new GLTFLoader().parseAsync(charBuf.slice(0), '');
    const ab = fs.readFileSync(path.join(APP, 'public', clip(id).file));
    const an = await new GLTFLoader().parseAsync(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength), '');
    ch.scene.updateMatrixWorld(true);
    return { root: ch.scene, anim: an.animations.find((a) => a.name === clip(id).animation) };
  };
  const loadEmbedded = async (id) => {
    const g = await new GLTFLoader().parseAsync(glbNoTextures(path.join(APP, 'public', clip(id).file)), '');
    g.scene.updateMatrixWorld(true);
    return { root: g.scene, anim: g.animations.find((a) => a.name === clip(id).animation) ?? g.animations[0] };
  };
  const models = { 'boxing-cross-m2m-v3': await loadM2M('boxing-cross-m2m-v3'), 'boxing-hook-m2m-v4': await loadM2M('boxing-hook-m2m-v4'), 'boxing-jab-nw-v2': await loadEmbedded('boxing-jab-nw-v2') };
  const front = {};
  for (const [id, m] of Object.entries(models)) front[id] = clip(id).cameraFront === 'rest' ? RP.facingAzimuth(RP.collectBones(m.root)) : null;
  const track = (id, angle, fps = 30) => {
    const m = models[id];
    let az = front[id];
    if (az === null) {
      // 'pose' front: the chest at frame 0 (engine.ts does the same)
      const mx = new AnimationMixer(m.root);
      mx.clipAction(m.anim).play();
      mx.setTime(0);
      m.root.updateMatrixWorld(true);
      az = front[id] = RP.facingAzimuth(RP.collectBones(m.root));
      mx.stopAllAction();
      mx.uncacheRoot(m.root);
    }
    return RP.samplePoseTrack(m.root, m.anim, { durationSec: clip(id).durationSec, sampleFps: fps, angle, frontAzimuthDeg: az });
  };
  const crossFront = track('boxing-cross-m2m-v3', 'front');
  check('[기준 관절] 크로스: 0 → 1.333 s를 30fps로 41프레임, 12개 관절 모두 리그에 있음', crossFront.frames.length === 41 && crossFront.missing.length === 0 && Math.abs(crossFront.frames.at(-1).t - 1.3333) < 1e-6, { n: crossFront.frames.length, missing: crossFront.missing });
  const jabFront = track('boxing-jab-nw-v2', 'front');
  check('[기준 관절] 잽(Mixamo 리그)도 같은 12개 관절 추출', jabFront.missing.length === 0 && jabFront.frames.length === 56, { n: jabFront.frames.length, missing: jabFront.missing });
  const f0 = crossFront.frames[0].points;
  check('[투영] 정면: 시연자의 왼어깨가 화면 오른쪽(카메라를 마주 봄), 머리 쪽이 위(y 작음)', f0.leftShoulder.x > f0.rightShoulder.x && f0.leftShoulder.y < f0.leftHip.y, { L: f0.leftShoulder, R: f0.rightShoulder });
  const b0 = track('boxing-cross-m2m-v3', 'back').frames[0].points;
  check('[투영] 후면: 좌우가 정면과 반대', b0.leftShoulder.x < b0.rightShoulder.x);
  const s0 = track('boxing-cross-m2m-v3', 'side').frames[0].points;
  check('[투영] 측면: 어깨 폭이 정면보다 좁게 보임', Math.abs(s0.leftShoulder.x - s0.rightShoulder.x) < Math.abs(f0.leftShoulder.x - f0.rightShoulder.x));
  // the rear (right) wrist travels forward in the cross — seen from the side, its screen x changes most
  const sideTrack = track('boxing-cross-m2m-v3', 'side');
  const travel = (tr, k) => Math.max(...tr.frames.map((f) => Math.hypot(f.points[k].x - tr.frames[0].points[k].x, f.points[k].y - tr.frames[0].points[k].y)));
  check('[기준 관절] 크로스: 뒷손(오른손목) 이동 > 앞손(왼손목) 이동', travel(sideTrack, 'rightWrist') > 1.5 * travel(sideTrack, 'leftWrist'), { right: +travel(sideTrack, 'rightWrist').toFixed(3), left: +travel(sideTrack, 'leftWrist').toFixed(3) });

  // ---------------------------------------------------------------- learner frames synthesised from a track
  const ASPECT = 640 / 480;
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 2;
  const learner = (tr, o = {}) => {
    const { fps = 24, durationMs = tr.durationSec * 1000, startMs = 5000, shift = 0, noise = 0.004, hide = [], mirror = false, freeze = false, scale = 0.28, count } = o;
    const n = count ?? Math.round((durationMs / 1000) * fps);
    const frames = [];
    for (let i = 0; i < n; i++) {
      const u = i / Math.max(1, n - 1);
      const tt = Math.min(1, Math.max(0, u - shift)) * tr.durationSec;
      const k = freeze ? 0 : Math.min(tr.frames.length - 1, Math.round(tt * tr.sampleFps));
      let pts = tr.frames[k].points;
      if (mirror) pts = C.mirrorPoints(pts);
      const f = { timestampMs: startMs + u * durationMs };
      for (const [name, p] of Object.entries(pts)) f[name] = { x: (0.5 + p.x * scale + rnd() * noise) / ASPECT, y: 0.62 + p.y * scale + rnd() * noise, z: 0, visibility: hide.includes(name) ? 0.1 : 0.95 };
      frames.push(f);
    }
    return { frames, startMs, durationMs };
  };
  const run = (id, tr, l, mirror = false) => C.compareToReference({ frames: l.frames, aspect: ASPECT, windowStartMs: l.startMs, durationMs: l.durationMs, reference: tr, phases: clip(id).phases, measure: clip(id).measure, clipLead: clip(id).leadHand, mirror });

  const self = run('boxing-cross-m2m-v3', crossFront, learner(crossFront));
  check('[비교] 기준과 같은 동작(잡음 포함) → 성공, 95점 이상, 신뢰도 높음', self.ok && self.score >= 95 && self.reliability === 'high', { score: self.score, rel: self.reliability, reasons: self.reliabilityReasons, groups: self.groups.map((g) => [g.id, g.score]) });
  const shifted = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { shift: 0.12 }));
  check('[시간 정렬] 0.16초 늦게 시작해도 DTW로 정렬 → 90점 이상', shifted.ok && shifted.score >= 90, { score: shifted.score, timing: shifted.timingOffset });
  const slow = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { shift: 0.3 }));
  check('[시간 정렬] 크게(0.4초) 늦으면 타이밍 피드백 "늦게 시작"', slow.ok && slow.feedback.some((f) => /늦게/.test(f)), { score: slow.score, timing: slow.timingOffset, fb: slow.feedback });
  const hookFront = track('boxing-hook-m2m-v4', 'front');
  const wrong = run('boxing-cross-m2m-v3', crossFront, learner(hookFront));
  check('[구분] 크로스 기준에 훅을 하면 점수가 크게 낮음 (정면)', wrong.score === null || wrong.score <= self.score - 25, { cross: self.score, hookAsCross: wrong.score, groups: wrong.groups.map((g) => [g.id, g.score]) });
  check('[피드백] 훅을 크로스로 했을 때: 가장 다른 부위·구간 안내', wrong.feedback.some((f) => /구간에서 .*(앞손|뒷손)/.test(f)), wrong.feedback);
  for (const ang of ['diagonal', 'side']) {
    const tc = track('boxing-cross-m2m-v3', ang);
    const a = run('boxing-cross-m2m-v3', tc, learner(tc));
    const b = run('boxing-cross-m2m-v3', tc, learner(track('boxing-hook-m2m-v4', ang)));
    check(`[구분] ${ang}: 크로스 ≥ 95, 크로스 기준에 훅 ≤ 크로스 − 25`, a.ok && a.score >= 95 && (b.score === null || b.score <= a.score - 25), { cross: a.score, hook: b.score });
  }
  const jabAsCross = run('boxing-cross-m2m-v3', crossFront, learner(track('boxing-jab-nw-v2', 'front')));
  check('[구분] 크로스 기준에 잽(다른 캐릭터·리그) → 점수 낮음', jabAsCross.score === null || jabAsCross.score <= self.score - 20, { score: jabAsCross.score, retake: jabAsCross.retake });
  const southpaw = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { mirror: true }), true);
  check('[사우스포] 거울 동작 + mirror 기준 → 95점 이상, 앞손 = 오른손', southpaw.ok && southpaw.score >= 95 && southpaw.lead === 'right' && southpaw.groups.find((g) => g.id === 'leadArm').label.includes('오른'), { score: southpaw.score, lead: southpaw.lead });
  const southpawNoMirror = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { mirror: true }), false);
  check('[사우스포] 스탠스를 반영 안 하면 "반대 스탠스에 더 가까움" → 재촬영 안내', !southpawNoMirror.ok && southpawNoMirror.retake.includes('stance_mismatch'), southpawNoMirror.retake);
  const orthodoxAsSouthpaw = run('boxing-cross-m2m-v3', crossFront, learner(crossFront), true);
  check('[사우스포] 프로필은 사우스포인데 오소독스로 섬 → stance_mismatch', !orthodoxAsSouthpaw.ok && orthodoxAsSouthpaw.retake.includes('stance_mismatch'), orthodoxAsSouthpaw.retake);
  const sideAsFront = run('boxing-cross-m2m-v3', crossFront, learner(sideTrack));
  check('[각도] 측면으로 서서 정면 기준과 비교 → 각도 불일치 재촬영', !sideAsFront.ok && sideAsFront.retake.includes('angle_mismatch'), { retake: sideAsFront.retake, score: sideAsFront.score });
  const sideOk = run('boxing-cross-m2m-v3', sideTrack, learner(sideTrack));
  check('[각도] 측면 기준 + 측면 촬영 → 정상', sideOk.ok && sideOk.score >= 95, sideOk.score);
  const noLegs = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { hide: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] }));
  check('[신뢰도] 다리 미인식 → 다리 "측정 안 됨"(점수에 안 넣음), 신뢰도 낮아짐, 다리 안내', noLegs.ok && !noLegs.groups.find((g) => g.id === 'legs').measured && noLegs.reliability !== 'high' && noLegs.retake.includes('body_cut_off'), { ok: noLegs.ok, rel: noLegs.reliability, retake: noLegs.retake });
  const jabNoLegs = run('boxing-jab-nw-v2', jabFront, learner(jabFront, { hide: ['leftKnee', 'rightKnee', 'leftAnkle', 'rightAnkle'] }));
  check('[신뢰도] 잽은 다리 가중치 0.2 — 다리 미인식이어도 점수(낮은 신뢰도)', jabNoLegs.ok && jabNoLegs.reliability !== 'high', { ok: jabNoLegs.ok, retake: jabNoLegs.retake });
  const armsHidden = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { hide: ['rightElbow', 'rightWrist', 'leftElbow', 'leftWrist'] }));
  check('[재촬영] 팔을 거의 못 보면 점수 없음 (추측 점수 없음)', !armsHidden.ok && armsHidden.score === null && armsHidden.retake.includes('insufficient'), armsHidden.retake);
  const few = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { count: 5 }));
  check('[재촬영] 프레임 5개 → few_frames', !few.ok && few.retake.includes('few_frames'));
  const frozen = run('boxing-cross-m2m-v3', crossFront, learner(crossFront, { freeze: true }));
  check('[재촬영] 가드만 하고 기술을 안 함 → no_movement', !frozen.ok && frozen.retake.includes('no_movement'), frozen.retake);
  const noPerson = C.compareToReference({ frames: Array.from({ length: 30 }, (_, i) => ({ timestampMs: 5000 + i * 40 })), aspect: ASPECT, windowStartMs: 5000, durationMs: 1333, reference: crossFront, phases: clip('boxing-cross-m2m-v3').phases, measure: clip('boxing-cross-m2m-v3').measure, clipLead: 'left', mirror: false });
  check('[재촬영] 사람 없음 → no_person, 점수 없음', !noPerson.ok && noPerson.retake.includes('no_person') && noPerson.score === null);
  // a short punch: the elbow stays bent (80 %) and the fist reaches 60 % of the reference distance from the shoulder
  const toward = (o, p, k) => ({ x: o.x + (p.x - o.x) * k, y: o.y + (p.y - o.y) * k });
  const shortArm = (p) => ({ ...p, rightElbow: toward(p.rightShoulder, p.rightElbow, 0.8), rightWrist: toward(p.rightShoulder, p.rightWrist, 0.6) });
  const lessReach = (() => {
    const tr = { ...crossFront, frames: crossFront.frames.map((f) => ({ ...f, points: shortArm(f.points) })) };
    return { front: run('boxing-cross-m2m-v3', crossFront, learner(tr)), side: run('boxing-cross-m2m-v3', sideTrack, learner({ ...sideTrack, frames: sideTrack.frames.map((f) => ({ ...f, points: shortArm(f.points) })) })) };
  })();
  check('[피드백] 측면: 뒷손을 60%만 뻗음 → "덜 뻗었습니다", 점수 하락', lessReach.side.ok && lessReach.side.feedback.some((f) => /오른손을 기준보다 덜 뻗었습니다/.test(f)) && lessReach.side.score <= sideOk.score - 10 && lessReach.side.groups.find((g) => g.id === 'rearArm').score < 80, { score: lessReach.side.score, groups: lessReach.side.groups.map((g) => [g.id, g.score]), fb: lessReach.side.feedback });
  check('[피드백] 정면에서는 뻗은 길이를 판단하지 않음 (카메라 쪽으로 뻗어 안 보임)', !lessReach.front.feedback.some((f) => /덜 뻗었습니다/.test(f)), lessReach.front.feedback);
} finally {
  await server.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
