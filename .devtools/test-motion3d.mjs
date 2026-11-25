// Unit tests — 3D technique demo data + clip-time math (no browser, no Electron).
//   node .devtools/test-motion3d.mjs
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const cat = await server.ssrLoadModule('/src/lib/motion3d/catalog.ts');
  const tl = await server.ssrLoadModule('/src/lib/motion3d/timeline.ts');
  const data = JSON.parse(fs.readFileSync(path.join(APP, 'data/curated/motion3d.json'), 'utf8'));

  // ---- catalog
  const idx = cat.buildIndex(data);
  check('[데이터] motion3d.json 모든 클립 유효', idx.rejected.length === 0 && idx.clips.length === data.clips.length, idx.rejected);
  const jab = cat.motionClipsFor('boxing__jab');
  check('[데이터] boxing__jab → 자체 제작 잽(오소독스) 기본, 사우스포, 이전 모캡 잽 유지', jab.map((c) => c.clipId).join() === 'boxing-jab-m2m-v2,boxing-jab-m2m-v2-southpaw,boxing-jab-nw-v2', jab.map((c) => c.clipId));
  check('[데이터] 모션 없는 기술은 빈 목록 (bjj__armbar, judo__o-goshi, boxing__uppercut, boxing__body-hook, 없는 id)', ['bjj__armbar', 'judo__o-goshi', 'boxing__uppercut', 'boxing__body-hook', 'nope__x'].every((id) => !cat.hasMotion3d(id)));
  check('[데이터] boxing__cross / boxing__hook → Phase 5 v3 (오소독스 기본 + 사우스포), 이전 버전은 retiredClips·파일 보존', cat.motionClipsFor('boxing__cross').map((c) => c.clipId).join() === 'boxing-cross-m2m-v3,boxing-cross-m2m-v3-southpaw' && cat.motionClipsFor('boxing__hook').map((c) => c.clipId).join() === 'boxing-hook-m2m-v4,boxing-hook-m2m-v4-southpaw' && ['boxing-cross-m2m-v1', 'boxing-hook-m2m-v1', 'boxing-jab-m2m-v1', 'boxing-cross-m2m-v2', 'boxing-hook-m2m-v2', 'boxing-jab-m2m-v1-southpaw', 'boxing-cross-m2m-v2-southpaw', 'boxing-hook-m2m-v2-southpaw'].every((id) => data.retiredClips.some((r) => r.clipId === id && r.retired?.reason) && fs.existsSync(path.join(APP, 'public/motion3d/anims', `${id}.glb`))));
  // technique-canonical.json merges boxing__jab + kickboxing__jab + karate__kizami-zuki into ONE technique (canonical
  // kickboxing__jab) with one detail page — the clip follows that merge (same lookup as poseAnalysis.json), no copy.
  check('[데이터] 정규 병합된 같은 기술(canonical kickboxing__jab)도 같은 클립', cat.motionClipsFor('kickboxing__jab')[0]?.clipId === 'boxing-jab-m2m-v2');
  const required = ['clipId', 'techniqueIds', 'actors', 'file', 'fps', 'durationSec', 'phases', 'source', 'license', 'pipeline', 'quality'];
  check('[데이터] 필수 필드 전부 (rig는 actors[].rig)', data.clips.every((c) => required.every((k) => k in c) && c.actors.every((a) => a.rig && data.rigs[a.rig])));
  // each clip is its own motion for exactly one technique id (no motion copied onto other techniques)
  const ids = data.clips.flatMap((c) => c.techniqueIds);
  // several versions of one technique are allowed only as different stances / variants of the SAME technique
  const versions = new Map();
  for (const c of data.clips) versions.set(c.techniqueIds[0], [...(versions.get(c.techniqueIds[0]) ?? []), c]);
  check('[데이터] 클립마다 기술 1개, 한 기술의 여러 클립은 스탠스·버전이 서로 다름 (잽·크로스·훅 + Phase 7 신규 10종)', data.clips.length === 20 && data.clips.every((c) => c.techniqueIds.length === 1) && [...versions.values()].every((cs) => new Set(cs.map((c) => `${c.stance}|${c.variant}`)).size === cs.length) && versions.size === 15, ids);
  const sp = data.clips.filter((c) => c.stance === 'southpaw' && c.actors.length === 1);
  check('[스탠스] 사우스포 클립 3개: 앞손 = 오른손, 같은 기술의 오소독스 클립이 있음, 별도 GLB', sp.length === 3 && sp.every((c) => c.leadHand === 'right' && c.rearHand === 'left' && data.clips.some((o) => o.stance === 'orthodox' && o.techniqueIds[0] === c.techniqueIds[0] && o.file !== c.file && o.frameCount === c.frameCount)));
  // Phase 7 clips are demonstrations only (no `measure`: not used as a pose-measurement reference)
  const solo = data.clips.filter((c) => c.actors.length === 1 && c.pipeline.version !== '4 (Phase 7)');
  check('[데이터] 1인 측정 기준 클립: 측정·스탠스 필드 (stance, leadHand, rearHand, captureAngles, measure, version)', solo.length === 7 && solo.every((c) => ['stance', 'leadHand', 'rearHand', 'captureAngles', 'measure', 'version'].every((k) => k in c)));
  const duo = data.clips.filter((c) => c.actors.length === 2);
  check('[2인] 더블렉·리어 네이키드 초크: 배우 2명(A_/B_ 접두사, 흰색 시연자 / 빨간색 상대), 측정 기준 아님(measure 없음)', duo.map((c) => c.techniqueIds[0]).sort().join() === 'bjj__rear-naked-choke,wrestling__basic-double-leg,wrestling__basic-double-leg' && duo.every((c) => c.actors[0].nodePrefix === 'A_' && c.actors[1].nodePrefix === 'B_' && c.actors[0].role === 'performer' && c.actors[1].role === 'partner' && /흰색/.test(c.actors[0].label) && /빨간색/.test(c.actors[1].label) && c.actors[0].color && c.actors[1].color && !c.measure && cat.validateClip(c, data).clip));
  const base = data.clips.find((c) => c.clipId === 'boxing-jab-nw-v2'); // the mocap clip: embedded character, Mixamo rig
  const bad = (patch) => cat.validateClip({ ...base, ...patch }, data);
  check('[검증] 경로 탈출/다른 확장자 거부', !bad({ file: '../secret.glb' }).clip && !bad({ file: 'motion3d/x.fbx' }).clip && !bad({ file: 'https://x/y.glb' }).clip);
  check('[검증] 구간 범위 밖·겹침·모르는 이름 거부', !bad({ phases: [{ name: 'prepare', label: '', startSec: 0, endSec: 9 }] }).clip && !bad({ phases: [{ name: 'prepare', label: '', startSec: 0, endSec: 1 }, { name: 'execute', label: '', startSec: 0.5, endSec: 1.5 }] }).clip && !bad({ phases: [{ name: 'windup', label: '', startSec: 0, endSec: 1 }] }).clip);
  check('[검증] fps/길이/배우 오류 거부', !bad({ fps: 0 }).clip && !bad({ durationSec: -1 }).clip && !bad({ actors: [] }).clip && !bad({ actors: [{ ...base.actors[0], rig: 'unknown' }] }).clip);
  check('[검증] 2인 클립은 배우별 nodePrefix 필요 (향후 그래플링 대비)', !bad({ actors: [base.actors[0], { ...base.actors[0], id: 'B' }] }).clip && !!bad({ actors: [{ ...base.actors[0], nodePrefix: 'A_' }, { ...base.actors[0], id: 'B', role: 'partner', nodePrefix: 'B_' }] }).clip);
  const broken = cat.buildIndex({ ...data, clips: [base, { clipId: 'x' }, null, 'junk'] });
  check('[검증] 잘못된 항목이 섞여도 유효한 클립만 사용 (앱 오류 없음)', broken.clips.length === 1 && broken.rejected.length === 3);

  // ---- timeline
  const D = 1.8333, F = 30, N = 55;
  check('[시간] 속도가 바뀌어도 클립 길이·프레임 수 불변, 실제 재생 시간만 변함', tl.realDuration(D, 0.25).toFixed(3) === (D * 4).toFixed(3) && tl.realDuration(D, 2).toFixed(3) === (D / 2).toFixed(3));
  check('[시간] 2x로 0.5초 = 클립 1초, 0.25x로 1초 = 클립 0.25초', Math.abs(tl.advance(0, 0.5, 2, D) - 1) < 1e-9 && Math.abs(tl.advance(0, 1, 0.25, D) - 0.25) < 1e-9);
  check('[시간] 끝에서 처음으로 반복', Math.abs(tl.advance(1.8, 0.1, 1, D) - (1.9 % D)) < 1e-9);
  check('[프레임] 시간 ↔ 프레임 (30fps)', tl.frameAt(1.0, F, N) === 30 && tl.timeOfFrame(16, F, D) === 16 / 30 && tl.frameAt(D, F, N) === 55);
  check('[프레임] 한 프레임 앞/뒤, 처음·끝에서 멈춤', Math.abs(tl.stepFrame(1.0, 1, F, N, D) - 31 / 30) < 1e-9 && tl.stepFrame(0, -1, F, N, D) === 0 && tl.stepFrame(D, 1, F, N, D) === D);
  check('[구간] 경계 판정', tl.phaseAt(0, base.phases).name === 'prepare' && tl.phaseAt(0.533, base.phases).name === 'execute' && tl.phaseAt(D, base.phases).name === 'finish');
  check('[속도] 0.25x~2x 7단계', JSON.stringify(tl.PLAYBACK_SPEEDS) === JSON.stringify([0.25, 0.5, 0.75, 1, 1.25, 1.5, 2]));

  // ---- the GLB file itself vs the catalog (parse the glTF JSON chunk; no three.js needed)
  const glbPath = path.join(APP, 'public', base.file);
  const buf = fs.readFileSync(glbPath);
  const json = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString());
  const anim = json.animations.find((a) => a.name === base.animation);
  const input = anim && json.accessors[anim.samplers[anim.channels[0].sampler].input];
  check('[GLB] glTF 2.0, 지정한 애니메이션 존재', buf.toString('ascii', 0, 4) === 'glTF' && json.asset.version === '2.0' && !!anim);
  check('[GLB] 길이·키프레임 수가 motion3d.json과 일치 (1프레임 이내)', Math.abs(input.max[0] - base.durationSec) <= 1 / base.fps && input.count === base.frameCount, { dur: input.max[0], keys: input.count });
  check('[GLB] 조인트 수 = 리그 정의 (56 = 54 + DEF 2)', json.skins[0].joints.length === data.rigs[base.actors[0].rig].jointCount);
  check('[GLB] 뼈대 이름 원본 그대로 (mixamorig:*)', json.skins[0].joints.map((i) => json.nodes[i].name).filter((n) => !n.startsWith('DEF_')).every((n) => n.startsWith('mixamorig:')));
  // ---- originals preserved (Phase 1.1 plays a derived GLB; the V2 output is never edited)
  const V2_SHA = 'aea1d42cbee432b66104b983b5eebbc9dd63dbb1b665c61a3d6686b31abeb07b';
  const sha256 = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  const v2Copy = path.join(APP, 'public/motion3d/boxing-jab-nw-v2.glb');
  check('[보존] public V2 사본 해시 그대로', sha256(v2Copy) === V2_SHA && base.source.mocapOutput.includes(V2_SHA));
  const src = path.join(APP, 'mma-mocap/output/MMA-Fighter_human_NW_JAB_deform_v2.glb');
  if (fs.existsSync(src)) check('[보존] 원본 mma-mocap V2 GLB 해시 그대로', sha256(src) === V2_SHA);
  check('[GLB] 라이선스 미확인이 데이터에 기록됨', base.license.motion === '미확인' && base.quality.verified === false);

  // ---- animation data quality (spec Phase 1.1 §6 items 1–8) on the GLB the clip plays
  const A = await import(path.join(APP, '.devtools/analyze-motion3d-glb.mjs'));
  const glb = A.readGlb(glbPath);
  const names = glb.json.nodes.map((n) => n.name);
  const requiredJoints = ['Hips', 'Spine', 'Spine1', 'Spine2', 'Neck', 'Head', ...['Left', 'Right'].flatMap((s) => ['Shoulder', 'Arm', 'ForeArm', 'Hand', 'UpLeg', 'Leg', 'Foot'].map((b) => s + b))];
  check('[관절] 필수 관절 존재 (1)', requiredJoints.every((b) => names.includes(`mixamorig:${b}`)), requiredJoints.filter((b) => !names.includes(`mixamorig:${b}`)));
  const tracked = new Set(anim.channels.filter((c) => c.target.path === 'rotation').map((c) => names[c.target.node]));
  check('[트랙] 양손(손목) 회전 트랙 존재 (2)', tracked.has('mixamorig:LeftHand') && tracked.has('mixamorig:RightHand'));
  check('[트랙] 양쪽 전완 회전 트랙 존재 (3)', tracked.has('mixamorig:LeftForeArm') && tracked.has('mixamorig:RightForeArm'));
  let nonFinite = 0;
  let norms = 0;
  for (const ch of anim.channels)
    for (const v of glb.accessor(anim.samplers[ch.sampler].output)) {
      const arr = [].concat(v);
      if (arr.some((x) => !Number.isFinite(x))) nonFinite++;
      if (ch.target.path === 'rotation' && Math.abs(Math.hypot(...arr) - 1) > 1e-3) norms++;
    }
  check('[값] NaN/Infinity 없음 (5)', nonFinite === 0, nonFinite);
  check('[값] 쿼터니언 단위 길이 (4)', norms === 0, norms);
  const lead = A.analyze(glbPath, { side: 'Left' });
  const rear = A.analyze(glbPath, { side: 'Right' });
  check('[값] 인접 키 쿼터니언 부호 뒤집힘 없음 (4)', lead.problems.length === 0 && rear.problems.length === 0, [...lead.problems, ...rear.problems].slice(0, 3));
  // Thresholds from the measured data (data/audit/motion3d-jab-wrist.json "thresholds"): fixed clip max 12.1°/key
  // and 14.6° bend (both measured, triangulated); the V2 defect was 40–47°/key and 25–83°; the forearm itself
  // legitimately turns up to 29.8°/key in this punch, so the hand gets 20°/key and 30° bend.
  const maxDelta = (r, s) => Math.max(...r.frames.slice(1).map((f) => f.delta[`${s}Hand`]));
  const maxBend = (r) => Math.max(...r.frames.map((f) => f.wristBendDeg));
  check('[연속] 손목 로컬 회전 변화 ≤ 20°/키 — 양손 (6)', maxDelta(lead, 'Left') <= 20 && maxDelta(rear, 'Right') <= 20, { lead: maxDelta(lead, 'Left'), rear: maxDelta(rear, 'Right') });
  check('[연속] 전완-손 꺾임 ≤ 30° 전 구간 — 양손 (7)', maxBend(lead) <= 30 && maxBend(rear) <= 30, { lead: maxBend(lead), rear: maxBend(rear) });
  const exec = base.phases.find((p) => p.name === 'execute');
  const execFrames = lead.frames.filter((f) => f.time >= exec.startSec - 1e-6 && f.time <= exec.endSec + 1e-6);
  check('[안정] 실행 구간 잽 손목 꺾임 ≤ 10°, 변화 ≤ 5°/키 (8)', execFrames.length > 5 && execFrames.every((f) => f.wristBendDeg <= 10 && (f.wristBendChangeDeg ?? 0) <= 5), execFrames.map((f) => f.wristBendDeg));
  // the detector really catches the defect: same checks on the V2 GLB must fail
  const v2 = A.analyze(v2Copy, { side: 'Left' });
  check('[검출력] 같은 기준이 V2 GLB의 손목 꺾임은 잡아냄', maxDelta(v2, 'Left') > 20 && maxBend(v2) > 30, { delta: maxDelta(v2, 'Left'), bend: maxBend(v2) });
  const tracksOf = (g) => {
    const an = g.json.animations[0];
    return new Map(an.channels.map((c) => [`${g.json.nodes[c.target.node].name}.${c.target.path}`, g.accessor(an.samplers[c.sampler].output)]));
  };
  const changedTracks = (a, b) => {
    const ta = tracksOf(a);
    const out = [];
    for (const [k, vals] of tracksOf(b)) {
      const ref = ta.get(k);
      const diff = Math.max(...vals.map((v, i) => Math.max(...[].concat(v).map((x, c) => Math.abs(x - [].concat(ref[i])[c])))));
      if (diff > 1e-4) out.push(k.replace('mixamorig:', ''));
    }
    return out;
  };
  // Phase 1.1 file (kept): only the hand tracks differ from V2
  const p11Path = path.join(APP, 'public/motion3d/boxing-jab-nw-v2-hand-observed.glb');
  const p11 = A.readGlb(p11Path);
  const c11 = changedTracks(A.readGlb(v2Copy), p11);
  check('[보존] Phase 1.1 GLB: V2 대비 바뀐 트랙은 양손 회전뿐', c11.length === 2 && c11.includes('LeftHand.rotation') && c11.includes('RightHand.rotation'), c11);
  // Phase 1.2 (the clip): head/neck + arms (and the DEF shoulder helpers that follow them) only; hips, spine, legs,
  // root translation unchanged from Phase 1.1
  const c12 = changedTracks(p11, glb);
  const allowed = /^(Head|Neck|(Left|Right)(Arm|ForeArm|Hand)|DEF_(Left|Right)Shoulder)\.rotation$/;
  check('[범위] Phase 1.2: 바뀐 트랙은 머리·목·양팔(+어깨 보조 본)뿐, 골반·척추·다리·루트 그대로', c12.length > 0 && c12.every((k) => allowed.test(k)) && !c12.some((k) => /Hips|Spine|Leg|Foot|Toe/.test(k)), c12);

  // ---- Phase 1.2 whole-body checks. Thresholds from data/audit/motion3d-jab-fullbody.json (measured):
  //   head Δ/key: 1.2 7.7° vs 1.1 82.3°; head vs chest per-key change 5.8° vs 66.6°; neck ≤ 2.5° in both
  //   fist path/straight 1.38 vs 1.89 (V2 1.77); turn while fast (≥1.5 m/s) 63° vs 140°; lateral sign flips 0 vs 2
  const fb = A.fullBodyReport(glbPath);
  const fb11 = A.fullBodyReport(p11Path);
  const headChestStep = (r) => Math.max(...r.frames.slice(1).map((f, i) => Math.abs(f.headVsChestDeg - r.frames[i].headVsChestDeg)));
  check('[머리] 머리 회전 변화 ≤ 15°/키, 목 ≤ 5°/키', fb.head.maxHeadDeltaDeg <= 15 && fb.head.maxNeckDeltaDeg <= 5, fb.head);
  check('[머리] 가슴 대비 머리 방향: 키 간 변화 ≤ 15°, 전체 범위 ≤ 45°', headChestStep(fb) <= 15 && fb.head.headVsChestRangeDeg[1] <= 45, { step: headChestStep(fb), range: fb.head.headVsChestRangeDeg });
  check('[검출력] 같은 머리 기준이 Phase 1.1의 꺾임은 잡아냄', fb11.head.maxHeadDeltaDeg > 15 && headChestStep(fb11) > 15, { delta: fb11.head.maxHeadDeltaDeg, step: headChestStep(fb11) });
  const fastTurn = (r) => Math.max(...r.frames.slice(r.guardKey, r.extensionKey + 1).filter((f) => (f.fistSpeed ?? 0) >= 1.5 && f.fistTurnDeg !== null).map((f) => f.fistTurnDeg));
  check('[궤도] 주먹 경로/직선 ≤ 1.5, 옆 이탈 부호 뒤집힘 없음', fb.punch.pathOverStraight <= 1.5 && fb.punch.lateralSignChanges === 0, fb.punch);
  check('[궤도] 빠르게 움직이는 동안 방향 변화 ≤ 90°/키', fastTurn(fb) <= 90, fastTurn(fb));
  check('[궤도] 진행 방향이 몸 정면에서 ±45° 이내 (비스듬한 자세)', Math.abs(fb.punch.punchYawVsFacingDeg) <= 45, fb.punch.punchYawVsFacingDeg);
  check('[검출력] 같은 궤도 기준이 Phase 1.1의 곡선은 잡아냄', fb11.punch.pathOverStraight > 1.5 && fastTurn(fb11) > 90, { ratio: fb11.punch.pathOverStraight, turn: fastTurn(fb11) });
  {
    const fr = fb.frames;
    const ext12 = fb.extensionKey;
    const d = [fr[ext12].fist[0] - fr[10].fist[0], fr[ext12].fist[2] - fr[10].fist[2]];
    const l = Math.hypot(...d);
    const along = (p, q) => (((p[0] - q[0]) * d[0] + (p[2] - q[2]) * d[1]) / l) * 100;
    const el = fr.slice(15, ext12 + 1).map((f) => along(f.leadElbow, fr[15].leadElbow));
    const fi = fr.slice(15, ext12 + 1).map((f) => along(f.fist, fr[15].fist));
    const back = Math.max(0, ...el.slice(1).map((x, i) => el[i] - x));
    check('[궤도] 주먹이 팔꿈치보다 앞서 나가고 팔꿈치가 뒤로 물러나지 않음 (≤ 1 cm)', fi.at(-1) > el.at(-1) && el.at(-1) > 0 && back <= 1, { fist: +fi.at(-1).toFixed(1), elbow: +el.at(-1).toFixed(1), elbowBack: +back.toFixed(2) });
    const gStep = Math.max(...fr.slice(1).map((f, i) => Math.abs(f.rearFistFrontOfChestCm - fr[i].rearFistFrontOfChestCm)));
    check('[가드] 가드 주먹이 항상 가슴 앞(≥ 20 cm, Spine2 기준), 키 간 변화 ≤ 3 cm', fb.guard.rearFistFrontOfChestCm[0] >= 20 && gStep <= 3, { range: fb.guard.rearFistFrontOfChestCm, step: +gStep.toFixed(2) });
    check('[가드] 가드 팔꿈치가 주먹보다 아래 (팔이 몸 뒤로 넘어가지 않음)', fr.every((f) => f.rearElbow[1] < f.rearFist[1]));
  }
  // mesh contacts come from Blender (scripts/motion3d/mesh_contact_audit.py) → the audit file must match this GLB
  const audit = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-jab-fullbody.json'), 'utf8'));
  check('[가드] 메시 교차 감사가 현재 GLB 기준 (sha256 일치)', audit.sha256.p12 === crypto.createHash('sha256').update(buf).digest('hex'));
  const mc = audit.meshContacts;
  check('[가드] 가드 손–몸통 메시 교차: Phase 1.1 55/55 키 → ≤ 1 키·≤ 10 삼각형 쌍', mc.phase11['rightHand~torso'].keysWithIntersection === 55 && mc.phase12['rightHand~torso'].keysWithIntersection <= 1 && mc.phase12['rightHand~torso'].maxTriPairs <= 10, { p11: mc.phase11['rightHand~torso'].keysWithIntersection, p12: mc.phase12['rightHand~torso'] && { keys: mc.phase12['rightHand~torso'].keysWithIntersection, max: mc.phase12['rightHand~torso'].maxTriPairs } });
  check('[가드] 잽 손·전완–몸통 교차 없음', mc.phase12['leftHand~torso'].keysWithIntersection === 0 && mc.phase12['leftForearm~torso'].keysWithIntersection === 0);
  check('[손목 보존] Phase 1.1 기준 유지: 잽 손목 꺾임 최대 ≤ Phase 1.1 (14.6°), 손 변화 ≤ Phase 1.1 (12.1°/키)', audit.wrist.phase12.left.maxBendDeg <= audit.wrist.phase11.left.maxBendDeg + 0.5 && audit.wrist.phase12.left.maxHandDeltaDegPerKey <= audit.wrist.phase11.left.maxHandDeltaDegPerKey + 0.5, { p11: audit.wrist.phase11.left.maxBendDeg, p12: audit.wrist.phase12.left.maxBendDeg });
  // three.js playback = independent forward kinematics (GLTFLoader + AnimationMixer change nothing)
  const { AnimationMixer, Vector3 } = await import('three');
  const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().parseAsync(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), '');
  const mixer = new AnimationMixer(gltf.scene);
  mixer.clipAction(gltf.animations.find((a) => a.name === base.animation)).play();
  let maxPos = 0;
  let maxDir = 0;
  for (const f of lead.frames) {
    mixer.setTime(f.time);
    gltf.scene.updateMatrixWorld(true);
    const p = (n) => gltf.scene.getObjectByName(n).getWorldPosition(new Vector3());
    const hand = p('mixamorigLeftHand');
    maxPos = Math.max(maxPos, hand.distanceTo(new Vector3(...f.wristPos)));
    maxDir = Math.max(maxDir, (p('mixamorigLeftHandMiddle1').sub(hand).angleTo(new Vector3(...f.handDir)) * 180) / Math.PI);
  }
  check('[재생] three.js 재생값 = 독립 정기구학 (손목 < 1 mm, 손 방향 < 0.5°)', maxPos < 1e-3 && maxDir < 0.5, { mm: +(maxPos * 1000).toFixed(3), deg: +maxDir.toFixed(3) });
  // phases agree with the motion: execute starts right before the fast extension, ends at full extension
  // speed ALONG the punch (guard wrist → fully extended wrist, horizontal), as data/curated/motion3d.json phaseMethod
  const ext = lead.frames.reduce((b, f) => (f.elbowDeg < b.elbowDeg ? f : b));
  const g0 = lead.frames[0].wristPos;
  const dir = [ext.wristPos[0] - g0[0], 0, ext.wristPos[2] - g0[2]];
  const dl = Math.hypot(...dir);
  const fwd = (p) => ((p[0] - g0[0]) * dir[0] + (p[2] - g0[2]) * dir[2]) / dl;
  const v = lead.frames.map((f, i) => (i ? (fwd(f.wristPos) - fwd(lead.frames[i - 1].wristPos)) * base.fps : 0));
  const firstFast = v.findIndex((x) => x > 1.5);
  check('[구간] 실행 시작 = 빠른 뻗기 직전 키, 실행 끝 = 팔꿈치 최대 신전', Math.abs(exec.startSec - lead.frames[firstFast - 1].time) < 1e-3 && Math.abs(exec.endSec - ext.time) < 1e-3, { firstFastKey: firstFast, start: exec.startSec, extKey: ext.frame, end: exec.endSec });

  // ---- Phase 1.3: separate character + authored animations (Mesh2Motion human rig)
  const charEntry = data.characters['m2m-human-base-v1'];
  const charPath = path.join(APP, 'public', charEntry.file);
  check('[캐릭터] Mesh2Motion 기본 모델: 원본 그대로 (sha256 기록과 일치), CC0', charEntry.license.note.includes(crypto.createHash('sha256').update(fs.readFileSync(charPath)).digest('hex')) && charEntry.license.id === 'CC0-1.0');
  const charGlb = A.readGlb(charPath);
  const charJoints = new Set(charGlb.json.skins[0].joints.map((i) => charGlb.json.nodes[i].name));
  check('[캐릭터] 리그 조인트 수 = 리그 정의 (66)', charJoints.size === data.rigs['m2m-human-v1'].jointCount);
  const { AnimationMixer: Mixer, PropertyBinding } = await import('three');
  // Node has no image decoder: bind the animation to a copy of the character whose JSON drops the texture
  // references (skeleton, skin and mesh are untouched; the app file is not modified)
  const charBuf = (() => {
    const b = fs.readFileSync(charPath);
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
    return Buffer.concat([head, js, rest]);
  })();
  const NEW_M2M = ['boxing-jab-m2m-v1', 'boxing-cross-m2m-v2', 'boxing-hook-m2m-v2'].flatMap((id) => [id, `${id}-southpaw`]); // Phase 4 (retired, files kept)
  const P5 = ['boxing-jab-m2m-v2', 'boxing-cross-m2m-v3', 'boxing-hook-m2m-v3'].flatMap((id) => [id, `${id}-southpaw`]);
  for (const id of ['boxing-cross-m2m-v1', 'boxing-hook-m2m-v1', ...NEW_M2M, ...P5]) {
    const c = [...data.clips, ...data.retiredClips].find((x) => x.clipId === id);
    const f = path.join(APP, 'public', c.file);
    const g = A.readGlb(f);
    const an = g.json.animations.find((a) => a.name === c.animation);
    const names = g.json.nodes.map((n) => n.name);
    const chans = an.channels.map((ch) => ({ node: names[ch.target.node], path: ch.target.path, s: an.samplers[ch.sampler] }));
    check(`[${id}] 애니메이션 전용 (메시 없음), 캐릭터 분리 (embedsCharacter=false)`, !(g.json.meshes || []).length && c.embedsCharacter === false && c.actors[0].character === 'm2m-human-base-v1');
    check(`[${id}] 모든 트랙 대상 본이 캐릭터 스킨에 존재`, chans.every((x) => charJoints.has(x.node)), chans.filter((x) => !charJoints.has(x.node)).map((x) => x.node));
    check(`[${id}] 회전 키만 + 골반 위치 (루트 모션 없음, Mesh2Motion 규칙)`, chans.filter((x) => x.path !== 'rotation').every((x) => x.node === 'pelvis' && x.path === 'translation') && !chans.some((x) => x.node === 'root' && x.path === 'translation'));
    const tIn = g.accessor(an.samplers[0].input);
    check(`[${id}] 키 0 = 0초, 길이·키 수가 motion3d.json과 일치`, Math.abs(tIn[0]) < 1e-6 && Math.abs(tIn.at(-1) - c.durationSec) < 1e-3 && tIn.length === c.frameCount + 1, { first: tIn[0], last: tIn.at(-1), keys: tIn.length });
    const ph = c.phases.map((p) => p.name).join(',');
    check(`[${id}] 4단계 구간 (준비·실행·회수·가드 복귀), 키 구간과 초 일치`, ph === 'prepare,execute,recover,guard_return' && c.phases.every((p) => Math.abs(p.startSec - c.phaseKeys[p.name][0] / c.fps) < 1e-3 && Math.abs(p.endSec - c.phaseKeys[p.name][1] / c.fps) < 1e-3), ph);
    let bad = 0;
    for (const x of chans) for (const v of g.accessor(x.s.output)) { const a = [].concat(v); if (a.some((y) => !Number.isFinite(y)) || (x.path === 'rotation' && Math.abs(Math.hypot(...a) - 1) > 1e-3)) bad++; }
    check(`[${id}] 쿼터니언 단위 길이·NaN 없음`, bad === 0, bad);
    // wrist = hand relative to forearm (local rotation of hand_*); data: cross max ~? / hook max ~? per key (see audit)
    const rot = (n) => g.accessor(chans.find((x) => x.node === n && x.path === 'rotation').s.output);
    const maxStep = (n) => { const q = rot(n); let m = 0; for (let i = 1; i < q.length; i++) m = Math.max(m, A.qangle(q[i - 1], q[i])); return m; };
    const wrist = Math.max(maxStep('hand_l'), maxStep('hand_r'));
    const ankle = Math.max(maxStep('foot_l'), maxStep('foot_r'));
    const neck = Math.max(maxStep('neck_01'), maxStep('head'));
    check(`[${id}] 손목(전완 대비 손)·발목·목/머리 키당 회전 ≤ 20°`, wrist <= 20 && ankle <= 20 && neck <= 20, { wrist: +wrist.toFixed(1), ankle: +ankle.toFixed(1), neck: +neck.toFixed(1) });
    // forward kinematics on the character's rest skeleton + this animation: planted balls stay put, nothing under the floor
    const WP = A.worldPose(f);
    const ball = (k, s) => WP[k].joint(`ball_${s}`).p;
    const drift = Math.max(...['l', 'r'].map((s) => Math.max(...WP.map((_, k) => Math.hypot(...ball(k, s).map((v, i) => v - ball(0, s)[i]))))));
    const lowBall = Math.min(...WP.flatMap((_, k) => ['l', 'r'].map((s) => ball(k, s)[1])));
    check(`[${id}] 발볼 고정 (피벗은 발볼에서), 미끄러짐 < 2 mm, 발볼이 바닥 위`, drift < 0.002 && lowBall > 0.005, { driftMm: +(drift * 1000).toFixed(2), lowestBallY: +lowBall.toFixed(4) });
    // three.js: the character GLB + this animation GLB bind and move the skeleton
    const { GLTFLoader: Loader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const ab = fs.readFileSync(f);
    const ch = await new Loader().parseAsync(charBuf.buffer.slice(charBuf.byteOffset, charBuf.byteOffset + charBuf.byteLength), '');
    const am = await new Loader().parseAsync(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength), '');
    const clipObj = am.animations.find((a) => a.name === c.animation);
    const unbound = clipObj.tracks.filter((t) => !ch.scene.getObjectByName(PropertyBinding.parseTrackName(t.name).nodeName));
    const mixer = new Mixer(ch.scene);
    mixer.clipAction(clipObj).play();
    const hand = ch.scene.getObjectByName((c.measure?.strikeHand === 'rear' ? c.rearHand : c.leadHand) === 'right' ? 'hand_r' : 'hand_l');
    const at = (t) => { mixer.setTime(t); ch.scene.updateMatrixWorld(true); return hand.getWorldPosition(hand.position.clone()); };
    const p0 = at(0).clone();
    const pHit = at(c.contactKey / c.fps).clone();
    check(`[${id}] three.js: 캐릭터+애니메이션 분리 로드, 모든 트랙 바인딩, 타격 손이 움직임`, unbound.length === 0 && p0.distanceTo(pHit) > 0.25, { unbound: unbound.length, handMoveM: +p0.distanceTo(pHit).toFixed(3) });
  }
  // mesh checks run in Blender (scripts/motion3d/strike_review.py) → audit must belong to these exact files
  const sa = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-strikes-m2m.json'), 'utf8'));
  for (const [k, id] of [['cross', 'boxing-cross-m2m-v1'], ['hook', 'boxing-hook-m2m-v1']]) {
    const r = sa.clips[k];
    check(`[${id}] 메시 검수 감사가 현재 GLB 기준 (sha256)`, r.sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, 'public/motion3d/anims', `${id}.glb`))).digest('hex'));
    check(`[${id}] 메시: 손·전완·팔꿈치–몸통/머리, 양팔끼리, 다리 교차 0 (분절 이음매 제외)`, r.automatic.nonSeamIntersections.length === 0, r.automatic.nonSeamIntersections.slice(0, 3));
    check(`[${id}] 메시: 바닥 아래로 내려가는 피부 없음, 발볼 미끄러짐 0`, r.automatic.lowestSkin.z >= -0.002 && r.automatic.plantedBallDriftCm.l < 0.2 && r.automatic.plantedBallDriftCm.r < 0.2, r.automatic.lowestSkin);
  }
  // Phase 4: the same mesh rules on the re-authored clips, and the centre-of-mass audit
  const s4 = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-strikes-m2m-v2.json'), 'utf8'));
  const com = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-phase4-com.json'), 'utf8'));
  for (const id of NEW_M2M) {
    const r = s4.clips[id];
    check(`[${id}] 메시 감사 = 현재 GLB, 이음매 외 교차 0, 바닥 아래 없음, 발볼 고정`, r.sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, 'public/motion3d/anims', `${id}.glb`))).digest('hex') && r.automatic.nonSeamIntersections.length === 0 && r.automatic.lowestSkin.z >= -0.002 && r.automatic.plantedBallDriftCm.l < 0.2 && r.automatic.plantedBallDriftCm.r < 0.2, r.automatic.nonSeamIntersections.slice(0, 3));
    const m = com.after[id];
    const contact = id.includes('cross') ? [0.62, 0.78] : id.includes('hook') ? [0.42, 0.55] : [0.55, 0.72];
    check(`[${id}] 무게중심: 가드 ~50/50, 타격 시 기술별 범위, 머리가 골반 뒤로 가지 않음, 지지면 안`, m.guard.leadFraction >= 0.45 && m.guard.leadFraction <= 0.58 && m.contact.leadFraction >= contact[0] && m.contact.leadFraction <= contact[1] && m.headBehindHipsKeys.length === 0 && m.outsideSupportKeys.length === 0, m);
  }
  check('[무게중심] v1 크로스·훅은 머리가 골반 뒤(수정 전 기록) → v2는 0 키', com.before['boxing-cross-m2m-v1'].headBehindHipsKeys.length > 0 && com.before['boxing-hook-m2m-v1'].headBehindHipsKeys.length > 0);
  // Phase 5: straight arm, wider hook, balance and mesh — measured at 30 fps
  const p5 = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-phase5-strikes.json'), 'utf8'));
  const st = p5.straight;
  check('[Phase 5 스트레이트] 타격 순간 팔이 펴짐: 크로스·잽 팔꿈치 ≥ 160° (이전 97°·101°), 잠기지 않음(≤ 175°)', ['boxing-cross-m2m-v3', 'boxing-jab-m2m-v2'].every((id) => st.after[id].elbowDegAtContact >= 160 && st.after[id].maxElbowDeg <= 175) && st.before['boxing-cross-m2m-v2'].elbowDegAtContact < 130 && st.before['boxing-jab-m2m-v1'].elbowDegAtContact < 130, Object.fromEntries(Object.entries({ ...st.before, ...st.after }).map(([k, v]) => [k, v.elbowDegAtContact])));
  const hk = p5.hook;
  check('[Phase 5 훅] 이동 범위 확장 (수평 경로 +10% 이상, 몸 회전 증가), 팔꿈치는 훅 범위(100–140°), 같은 키 타이밍', hk.after.executeHorizontalPathM >= hk.before.executeHorizontalPathM * 1.1 && hk.after.executeSweepDeg > hk.before.executeSweepDeg && hk.after.elbowDegAtContact >= 100 && hk.after.elbowDegAtContact <= 140 && [...data.clips, ...data.retiredClips].find((c) => c.clipId === 'boxing-hook-m2m-v3').frameCount === 40, hk);
  for (const id of P5) {
    const m = p5.mesh[id];
    const c = p5.com[id];
    const contact = id.includes('cross') ? [0.62, 0.8] : id.includes('hook') ? [0.42, 0.56] : [0.55, 0.72];
    check(`[${id}] Phase 5 감사 = 현재 GLB, 이음매 외 교차 0, 바닥 아래 없음, 무게중심 범위·머리 골반 앞·지지면 안`, m.sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, 'public/motion3d/anims', `${id}.glb`))).digest('hex') && m.nonSeamIntersections.length === 0 && m.lowestSkinZ >= -0.002 && m.bonesMissingOnCharacter.length === 0 && c.guard >= 0.45 && c.guard <= 0.58 && c.contact.leadFraction >= contact[0] && c.contact.leadFraction <= contact[1] && c.headBehindHipsKeys.length === 0 && c.outsideSupportKeys.length === 0, { m: { ...m, sha256: undefined }, c: { ...c, perKey: undefined } });
  }
  // ---- Phase 5: two-person clips — one animation, both copies of the character bound by prefix, no jumps
  for (const c of duo) {
    const f = path.join(APP, 'public', c.file);
    const g = A.readGlb(f);
    check(`[${c.clipId}] 애니메이션 하나(한 타임라인), A_·B_ 두 뼈대의 트랙, 메시 없음, 길이·키 수 = 카탈로그`, g.json.animations.length === 1 && g.json.animations[0].name === c.animation && !(g.json.meshes || []).length && ['A_', 'B_'].every((pre) => g.json.animations[0].channels.some((ch) => g.json.nodes[ch.target.node].name === `${pre}pelvis`)) && Math.abs(g.accessor(g.json.animations[0].samplers[0].input).at(-1) - c.durationSec) < 1e-3);
    const { GLTFLoader: Loader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const copies = [];
    for (const a of c.actors) {
      const ch = await new Loader().parseAsync(charBuf.buffer.slice(charBuf.byteOffset, charBuf.byteOffset + charBuf.byteLength), '');
      ch.scene.traverse((o) => (o.name = `${a.nodePrefix}${o.name}`)); // what engine.ts does
      copies.push(ch.scene);
    }
    const { Group } = await import('three');
    const group = new Group();
    copies.forEach((x) => group.add(x));
    const ab = fs.readFileSync(f);
    const am = await new Loader().parseAsync(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength), '');
    const clipObj = am.animations[0];
    const unbound = clipObj.tracks.filter((t) => !group.getObjectByName(PropertyBinding.parseTrackName(t.name).nodeName));
    const mixer = new Mixer(group);
    mixer.clipAction(clipObj).play();
    const pel = (pre) => group.getObjectByName(`${pre}pelvis`);
    let maxStep = 0;
    let prev = null;
    let minY = Infinity;
    for (let i = 0; i <= c.frameCount * 2; i++) {
      mixer.setTime(Math.min(i / (c.fps * 2), c.durationSec - 1e-4));
      group.updateMatrixWorld(true);
      const pts = ['A_', 'B_'].map((pre) => pel(pre).getWorldPosition(pel(pre).position.clone()));
      if (prev) maxStep = Math.max(maxStep, ...pts.map((p, k) => p.distanceTo(prev[k])));
      minY = Math.min(minY, ...pts.map((p) => p.y));
      prev = pts.map((p) => p.clone());
    }
    check(`[${c.clipId}] three.js: 두 캐릭터 사본에 모든 트랙 바인딩, 골반이 1/60초에 5 cm 넘게 튀지 않음(순간이동 없음 — 폭발적인 페네트레이션 스텝 약 2.5 m/s 허용), 골반이 바닥 위`, unbound.length === 0 && maxStep < 0.05 && minY > 0.05, { unbound: unbound.length, maxStepM: +maxStep.toFixed(3), minPelvisY: +minY.toFixed(3) });
    const rv = JSON.parse(fs.readFileSync(path.join(APP, c.source.review.split(' ')[0]), 'utf8'));
    check(`[${c.clipId}] 2인 검수: 바닥 아래로 들어가는 피부 없음(≥ -2 mm), 골반 키당 이동 < 10 cm`, rv.keys.every((k) => Math.min(...Object.values(k.lowestSkin)) >= -0.002 && Math.max(...Object.values(k.pelvisStepM)) < 0.1));
  }
  // Phase 6 (second visual review): hook gaze, double-leg steps + southpaw, RNC upper body — new versions, old files kept
  const p6 = JSON.parse(fs.readFileSync(path.join(APP, 'data/audit/motion3d-phase6.json'), 'utf8'));
  check('[Phase 6 훅] 타격 순간 시선 = 실제 타격 지점 (수평 ≤ 5°, v3 134°), 오소독스·사우스포 같은 값, 주먹 궤적·팔꿈치 v3와 동일', p6.hook['boxing-hook-m2m-v4'].faceToFistYawDegAtKeys['18'] <= 5 && p6.hook['boxing-hook-m2m-v3'].faceToFistYawDegAtKeys['18'] > 90 && p6.hook['boxing-hook-m2m-v4-southpaw'].faceToFistYawDegAtKeys['18'] === p6.hook['boxing-hook-m2m-v4'].faceToFistYawDegAtKeys['18'] && p6.hook.unchangedFromV3.hookingFistMaxChangeM === 0 && p6.hook.unchangedFromV3.elbowMaxChangeDeg === 0, p6.hook.unchangedFromV3);
  check('[Phase 6 훅] 가드 시선으로 시작·복귀 (키 0·30 = v3), 머리 회전이 몸통과 함께 (키당 ≤ 25°), 교차 0, 무게중심 지지면 안', ['0', '30'].every((k) => p6.hook['boxing-hook-m2m-v4'].faceToFistYawDegAtKeys[k] === p6.hook['boxing-hook-m2m-v3'].faceToFistYawDegAtKeys[k]) && p6.hook['boxing-hook-m2m-v4'].maxHeadTurnPerKeyDeg <= 25 && ['boxing-hook-m2m-v4', 'boxing-hook-m2m-v4-southpaw'].every((n) => p6.hook[n].nonSeamIntersections.length === 0 && p6.hook[n].com.outsideSupportKeys.length === 0 && p6.hook[n].sha256 === crypto.createHash('sha256').update(fs.readFileSync(path.join(APP, 'public/motion3d/anims', `${n}.glb`))).digest('hex')));
  const dlv = p6.doubleLeg;
  check('[Phase 6 더블렉] 발이 미끄러지지 않고 디딤 (전체 미끄러짐 v1 2.52 m → < 0.3 m, 키당 < 5 cm), 바닥 아래 없음, 순간이동 없음', dlv.before.plantedSlideTotalM > 2 && dlv.after.plantedSlideTotalM < 0.3 && dlv.after.plantedSlideMaxM < 0.05 && dlv.after.lowestSkin >= -0.002 && dlv.after.pelvisStepMaxM < 0.1, dlv.after);
  check('[Phase 6 더블렉] 사우스포 = 오소독스의 좌우 대응 (같은 수치), 별도 선택 가능한 클립, 진입·드라이브 구간 분리', JSON.stringify(dlv.afterSouthpaw) === JSON.stringify(dlv.after) && cat.motionClipsFor('wrestling__basic-double-leg').map((c) => c.stance).join() === 'orthodox,southpaw' && cat.motionClipsFor('wrestling__basic-double-leg')[0].phases.map((p) => p.name).join() === 'prepare,execute,drive,finish');
  const rv2 = p6.rearNakedChoke;
  check('[Phase 6 RNC] 팔이 서로 교차하지 않음(뼈 간격 ≥ 8 cm), 손이 얼굴과 겹치지 않음(0), 안전 간격 유지(목 ≥ 0.11 m), 하체 유지', rv2.safetyMinimaM.armsApartM >= 0.08 && rv2.after.handToFaceMax === 0 && rv2.safetyMinimaM.chokeArmToNeckM >= 0.11 && rv2.safetyMinimaM.supportArmToNeckM >= 0.11 && rv2.safetyMinimaM.handsToHeadsM >= 0.15 && rv2.after.plantedSlideTotalM === 0 && rv2.after.lowestSkin >= -0.002, { ...rv2.safetyMinimaM, handToFace: rv2.after.handToFaceMax });
  const rnc = JSON.parse(fs.readFileSync(path.join(APP, 'assets/3d/motion-library/bjj/bjj-rear-naked-choke-m2m-v2.json'), 'utf8'));
  check('[RNC 안전] 모든 키에서 조르는 팔 뼈 ↔ 목·머리 뼈 ≥ 0.11 m, 뒤 손 ↔ 머리 ≥ 0.15 m (압박·접촉 없음)', rnc.keys.length === 91 && rnc.keys.every((k) => k.chokeArmToNeckM >= 0.11 && k.backHandToHeadM >= 0.15), { minArm: Math.min(...rnc.keys.map((k) => k.chokeArmToNeckM)), minHand: Math.min(...rnc.keys.map((k) => k.backHandToHeadM)) });
  check('[사우스포] 사우스포 = 오소독스의 좌우 대칭 (무게중심 비율 동일, 측면 오프셋 반대)', ['boxing-jab-m2m-v1', 'boxing-cross-m2m-v2', 'boxing-hook-m2m-v2'].every((id) => com.perKey[id].every((k, i) => { const s = com.perKey[`${id}-southpaw`][i]; return Math.abs(k.leadFraction - s.leadFraction) < 0.005 && Math.abs(k.lateralCm + s.lateralCm) < 0.5; })));

  // ---- Phase 7: RNC rebuilt (v3) + 10 new technique clips (one GLB each, played on the shared character)
  const P7 = {
    'bjj-rear-naked-choke-m2m-v3': ['bjj__rear-naked-choke'],
    'boxing-rear-uppercut-m2m-v1': ['boxing__rear-uppercut', 'kickboxing__rear-uppercut'],
    'boxing-slip-m2m-v1': ['boxing__slip', 'kickboxing__slip'],
    'kickboxing-body-kick-m2m-v1': ['kickboxing__body-kick'],
    'kickboxing-straight-knee-m2m-v1': ['kickboxing__straight-knee'],
    'kickboxing-horizontal-elbow-m2m-v1': ['kickboxing__horizontal-elbow'],
    'muaythai-push-teep-m2m-v1': ['muay-thai__push-teep'],
    'mma-overhand-m2m-v1': ['mixed-martial-arts__overhand'],
    'wrestling-sprawl-m2m-v1': ['wrestling__sprawl'],
    'bjj-hip-escape-m2m-v1': ['bjj__hip-escape', 'judo__shrimp'],
    'bjj-technical-stand-up-m2m-v1': ['bjj__technical-stand-up'],
  };
  const processed = new Set(fs.readdirSync(path.join(APP, 'data/processed')).filter((f) => !f.startsWith('_')).flatMap((f) => JSON.parse(fs.readFileSync(path.join(APP, 'data/processed', f), 'utf8')).techniques.map((t) => t.id)));
  check('[Phase 7] 11개 클립 등록, 연결 기술 ID는 모두 기술 DB(data/processed)에 있는 기술', Object.keys(P7).every((id) => data.clips.some((c) => c.clipId === id)) && Object.keys(P7).every((id) => data.clips.find((c) => c.clipId === id).techniqueIds.every((t) => processed.has(t))));
  check('[Phase 7] 이전 RNC v2는 retiredClips로 이동, 파일 보존 (기술 상세는 v3만)', data.retiredClips.some((r) => r.clipId === 'bjj-rear-naked-choke-m2m-v2' && r.retired?.replacedBy === 'bjj-rear-naked-choke-m2m-v3') && fs.existsSync(path.join(APP, 'public/motion3d/anims/bjj-rear-naked-choke-m2m-v2.glb')) && cat.motionClipsFor('bjj__rear-naked-choke').map((c) => c.clipId).join() === 'bjj-rear-naked-choke-m2m-v3');
  for (const [id, techs] of Object.entries(P7)) {
    const c = data.clips.find((x) => x.clipId === id);
    const f = path.join(APP, 'public', c.file);
    check(`[${id}] 기술 상세 연결: ${techs.join(' / ')} (정규 병합 포함)`, techs.every((t) => cat.motionClipsFor(t).some((x) => x.clipId === id)), techs.map((t) => cat.motionClipsFor(t).map((x) => x.clipId)));
    check(`[${id}] 카탈로그 검증 통과, GLB 존재·해시 = 카탈로그`, !!cat.validateClip(c, data).clip && fs.existsSync(f) && crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex') === c.source.glbSha256);
    const g = A.readGlb(f);
    const an = g.json.animations[0];
    const names = g.json.nodes.map((n) => n.name);
    const chans = an.channels.map((ch) => ({ node: names[ch.target.node], path: ch.target.path, s: an.samplers[ch.sampler] }));
    const duoClip = c.actors.length > 1;
    const bare = (n) => (duoClip ? n.replace(/^[AB]_/, '') : n);
    check(`[${id}] 애니메이션 하나(이름 = clipId), 메시 없음, 모든 트랙 본이 캐릭터에 있음${duoClip ? ' (A_/B_ 접두사)' : ''}`, g.json.animations.length === 1 && an.name === c.animation && !(g.json.meshes || []).length && chans.every((x) => charJoints.has(bare(x.node))) && (!duoClip || ['A_', 'B_'].every((pre) => chans.some((x) => x.node.startsWith(pre)))));
    check(`[${id}] 회전 키 + 골반 위치만${duoClip ? ' (+ 배치 root)' : ', 루트 이동 없음'}`, chans.filter((x) => x.path !== 'rotation').every((x) => bare(x.node) === 'pelvis' || (duoClip && bare(x.node) === 'root')) && !chans.some((x) => x.path === 'scale'));
    const tIn = g.accessor(an.samplers[0].input);
    check(`[${id}] 키 0 = 0초, 길이·키 수 = 카탈로그, 학습용 속도 (1.5초 이상)`, Math.abs(tIn[0]) < 1e-6 && Math.abs(tIn.at(-1) - c.durationSec) < 1e-3 && tIn.length === c.frameCount + 1 && c.durationSec >= 1.5, { last: tIn.at(-1), keys: tIn.length });
    let bad = 0;
    let seamRot = 0;
    let seamPos = 0;
    let maxStepDeg = 0;
    for (const x of chans) {
      const out = g.accessor(x.s.output);
      for (const v of out) { const a = [].concat(v); if (a.some((y) => !Number.isFinite(y)) || (x.path === 'rotation' && Math.abs(Math.hypot(...a) - 1) > 1e-3)) bad++; }
      if (x.path === 'rotation') {
        seamRot = Math.max(seamRot, A.qangle(out[0], out.at(-1)));
        if (!/thumb|index|middle|ring|pinky/.test(x.node)) for (let i = 1; i < out.length; i++) maxStepDeg = Math.max(maxStepDeg, A.qangle(out[i - 1], out[i]));
      } else seamPos = Math.max(seamPos, Math.hypot(...[0, 1, 2].map((k) => out[0][k] - out.at(-1)[k])));
    }
    check(`[${id}] 쿼터니언 단위 길이·NaN 없음`, bad === 0, bad);
    check(`[${id}] 반복 재생: 마지막 키 = 첫 키 (회전 < 0.5°, 골반 < 1 mm) — 끝에서 처음으로 끊김 없이 이어짐`, seamRot < 0.5 && seamPos < 0.001, { deg: +seamRot.toFixed(3), mm: +(seamPos * 1000).toFixed(2) });
    // the solver keeps elbow / knee bend planes and forearm roll continuous (rig_kit continuity + hinge); the largest remaining
    // steps are fast but continuous moves (a kick swing, a hand leaving the mat) — a flip would be 90-180 deg
    check(`[${id}] 관절 회전이 키마다 튀지 않음 (손가락 제외 키당 ≤ 70°, 뒤집힘 없음)`, maxStepDeg <= 70, +maxStepDeg.toFixed(1));
    // the app's binding (engine.ts): one character copy per actor, renamed with the actor's prefix
    const { GLTFLoader: Loader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { Group, Box3, Vector3 } = await import('three');
    const group = new Group();
    for (const a of c.actors) {
      const ch = await new Loader().parseAsync(charBuf.buffer.slice(charBuf.byteOffset, charBuf.byteOffset + charBuf.byteLength), '');
      if (duoClip) ch.scene.traverse((o) => (o.name = `${a.nodePrefix}${o.name}`));
      group.add(ch.scene);
    }
    const ab = fs.readFileSync(f);
    const am = await new Loader().parseAsync(ab.buffer.slice(ab.byteOffset, ab.byteOffset + ab.byteLength), '');
    const clipObj = am.animations[0];
    const unbound = clipObj.tracks.filter((t) => !group.getObjectByName(PropertyBinding.parseTrackName(t.name).nodeName));
    const mixer = new Mixer(group);
    mixer.clipAction(clipObj).play();
    const pels = c.actors.map((a) => group.getObjectByName(`${duoClip ? a.nodePrefix : ''}pelvis`));
    let jump = 0;
    let prev = null;
    let minY = Infinity;
    for (let i = 0; i <= c.frameCount * 2; i++) {
      mixer.setTime(Math.min(i / (c.fps * 2), c.durationSec - 1e-4));
      group.updateMatrixWorld(true);
      const pts = pels.map((p) => p.getWorldPosition(new Vector3()));
      if (prev) jump = Math.max(jump, ...pts.map((p, k) => p.distanceTo(prev[k])));
      minY = Math.min(minY, ...pts.map((p) => p.y));
      prev = pts;
    }
    mixer.setTime(0);
    group.updateMatrixWorld(true);
    const box = new Box3().setFromObject(group);
    check(`[${id}] three.js: 분리 로드·모든 트랙 바인딩, 골반 1/60초 이동 < 6 cm (순간이동 없음), 골반이 바닥 위`, unbound.length === 0 && jump < 0.06 && minY > 0.05, { unbound: unbound.length, jumpCm: +(jump * 100).toFixed(1), minPelvisY: +minY.toFixed(3) });
    const rv = JSON.parse(fs.readFileSync(path.join(APP, c.source.review.split(' ')[0]), 'utf8'));
    const lowest = Math.min(...rv.keys.map((k) => Math.min(...Object.values(k.lowestSkin))));
    const slide = Math.max(0, ...rv.keys.slice(1).flatMap((k) => Object.values(k.plantedSlideM || {})));
    check(`[${id}] 메시 검수 (Blender, 매 키): 바닥 아래 피부 ≤ 15 mm, 디딘 발 미끄러짐 키당 < 6 cm, 골반 키당 < 12 cm — 수치는 knownIssues에 기록`, rv.keys.length === c.frameCount + 1 && lowest >= -0.015 && slide < 0.06 && Math.max(...rv.keys.map((k) => Math.max(...Object.values(k.pelvisStepM)))) < 0.12 && JSON.stringify(c.source.reviewStats.lowestSkinM) === JSON.stringify(+lowest.toFixed(4)), { lowest, slide });
    check(`[${id}] 검수 이미지(정면·45°·측면·후면) 존재`, fs.existsSync(path.join(APP, c.source.reviewImage)));
    if (!duoClip) check(`[${id}] 1인: 자기 몸 관통(인접하지 않은 부위) 최대 ≤ 150 삼각형 쌍`, Math.max(...rv.keys.map((k) => Object.values(k.selfContact?.A ?? {}).reduce((s, v) => s + v, 0))) <= 150);
  }
  // RNC v3 safety + shape, from the authoring log (bone distances measured every key on the solved skeletons)
  const rnc3 = JSON.parse(fs.readFileSync(path.join(APP, 'assets/3d/motion-library/bjj/bjj-rear-naked-choke-m2m-v3.json'), 'utf8'));
  const hold = rnc3.keys.filter((k) => k.key >= 72 && k.key <= 102);
  check('[RNC v3 안전] 모든 키: 조르는 팔 뼈 ↔ B 목·머리 뼈 ≥ 0.11 m, 뒤 손 ↔ 머리 ≥ 0.15 m (압박·접촉 없음)', rnc3.keys.length === 133 && rnc3.keys.every((k) => k.chokeArmToNeckM >= 0.11 && k.backHandToHeadM >= 0.15), { arm: Math.min(...rnc3.keys.map((k) => k.chokeArmToNeckM)), hand: Math.min(...rnc3.keys.map((k) => k.backHandToHeadM)) });
  check('[RNC v3 형태] 유지 구간: 팔꿈치가 B 목 앞(≥ 15 cm), 오른손이 왼쪽 이두 근처(≤ 8 cm), 왼손이 B 머리 뒤, 머리끼리 떨어짐(≥ 14 cm)', hold.length === 31 && hold.every((k) => k.joints['A.elbow_r'][1] - k.joints['B.neck'][1] >= 0.15 && k.gripGapM <= 0.08 && k.joints['A.hand_l'][1] < k.joints['B.head'][1] - 0.1 && k.headToHeadM >= 0.14));
  check('[RNC v3 구간] 5단계: 시작 자세 → 위치 관계 전환 → 형태 → 유지(1초) → 복귀, 마지막 키 = 첫 키', data.clips.find((c) => c.clipId === 'bjj-rear-naked-choke-m2m-v3').phases.map((p) => p.name).join() === 'prepare,transition,execute,hold,recover' && JSON.stringify(rnc3.keys[0].joints) === JSON.stringify(rnc3.keys.at(-1).joints));
  // B's neck and head keep their own neutral posture: their rotation relative to B's chest never changes
  {
    const g3 = A.readGlb(path.join(APP, 'public/motion3d/anims/bjj-rear-naked-choke-m2m-v3.glb'));
    const an3 = g3.json.animations[0];
    const names3 = g3.json.nodes.map((n) => n.name);
    const rotOf = (n) => g3.accessor(an3.samplers[an3.channels.find((ch) => names3[ch.target.node] === n && ch.target.path === 'rotation').sampler].output);
    const neckDev = Math.max(...['B_neck_01', 'B_head'].map((n) => { const q = rotOf(n); return Math.max(...q.map((x) => A.qangle(q[0], x))); }));
    check('[RNC v3 안전] B의 목·머리 관절 회전 변화 ≤ 3° (머리를 당기거나 꺾지 않음, 중립 유지)', neckDev <= 3, +neckDev.toFixed(2));
  }
} finally {
  await server.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
