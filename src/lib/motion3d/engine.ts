import {
  AnimationMixer,
  Box3,
  Color,
  Group,
  DirectionalLight,
  GridHelper,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  PropertyBinding,
  PerspectiveCamera,
  Scene,
  SkeletonHelper,
  SphereGeometry,
  Spherical,
  Vector3,
  WebGLRenderer,
  type AnimationAction,
  type AnimationClip,
  type Bone,
  type Material,
  type Mesh,
  type Object3D,
} from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { advance, clampTime } from './timeline';
import type { MotionClip } from './types';
import { ANGLE_OFFSET_DEG, facingAzimuth, samplePoseTrack, type ReferencePoseTrack } from './referencePose';
import type { CaptureAngle } from '../timedCapture/reference';

// The three.js side of the 3D technique viewer. Imported ONLY by the lazily-loaded viewer component, so
// three.js never reaches the technique detail page until the user opens a demo.
//
// Resources: the GLB *bytes* are cached (a re-open does not re-download/re-read the file); everything built
// from them (geometries, materials, renderer, WebGL context) belongs to one engine and is released by dispose().

export type MotionLoadErrorKind = 'network' | 'parse' | 'animation' | 'rig' | 'webgl';
export class MotionLoadError extends Error {
  constructor(readonly kind: MotionLoadErrorKind, message: string) {
    super(message);
  }
}

export type ViewMode = 'character' | 'skeleton';
// the pose-measurement capture angles (referencePose.ts) — one table, so the preview and the reference joints agree
export type CameraPreset = CaptureAngle;
// offsets from the measured front; side = the character's LEFT (an orthodox lead-hand side), diagonal = 45° towards it
const PRESET_OFFSET: Record<CameraPreset, number> = ANGLE_OFFSET_DEG;

export interface EngineSnapshot {
  time: number;
  playing: boolean;
  /** 반복 재생: wrap to the start at the end, or stop on the last frame (two-person clips default to stopping —
   * the partner on the floor never snaps back to standing in the middle of playback). */
  loop: boolean;
  speed: number;
  mode: ViewMode;
  azimuthDeg: number;
  distance: number;
}

export interface LoadedInfo {
  durationSec: number;
  durationFromFile: number;
  jointCount: number;
  triangles: number;
  animation: string;
}

// ---- GLB byte cache (shared across viewer opens) ----
const MAX_CACHED = 4;
const byteCache = new Map<string, Promise<ArrayBuffer>>();

function readBytes(url: string): Promise<ArrayBuffer> {
  // fetch() first; XHR as the fallback for file:// pages (Electron production loads index.html from disk).
  return fetch(url)
    .then((r) => {
      if (!r.ok) throw new MotionLoadError('network', `HTTP ${r.status}`);
      return r.arrayBuffer();
    })
    .catch(
      (e) =>
        new Promise<ArrayBuffer>((resolve, reject) => {
          if (e instanceof MotionLoadError) return reject(e);
          const xhr = new XMLHttpRequest();
          xhr.open('GET', url);
          xhr.responseType = 'arraybuffer';
          xhr.onload = () => (xhr.response && (xhr.status === 200 || xhr.status === 0) ? resolve(xhr.response) : reject(new MotionLoadError('network', `load failed (${xhr.status})`)));
          xhr.onerror = () => reject(new MotionLoadError('network', 'load failed'));
          xhr.send();
        }),
    );
}

export function loadGlbBytes(url: string): Promise<ArrayBuffer> {
  const hit = byteCache.get(url);
  if (hit) {
    byteCache.delete(url);
    byteCache.set(url, hit); // LRU touch
    return hit;
  }
  const p = readBytes(url);
  byteCache.set(url, p);
  p.catch(() => byteCache.delete(url)); // a failed load is retried next time
  while (byteCache.size > MAX_CACHED) byteCache.delete(byteCache.keys().next().value as string);
  return p;
}

export function cachedGlbUrls(): string[] {
  return [...byteCache.keys()];
}

/** Low-end heuristic: few cores or little memory → no MSAA, pixel ratio 1. */
export function isLowEndDevice(): boolean {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return (nav.hardwareConcurrency ?? 8) <= 4 || (nav.deviceMemory ?? 8) <= 4;
}

declare global {
  interface Window {
    __motion3dStats?: { created: number; disposed: number };
  }
}

export class MotionEngine {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera(35, 1, 0.05, 50);
  private controls: OrbitControls;
  private lastTs = 0;
  /** Azimuth (deg) of the character's chest at frame 0 — the 정면 preset; measured from the pose, not assumed. */
  private frontAzimuth = 0;
  private mixer: AnimationMixer | null = null;
  private action: AnimationAction | null = null;
  private model: Object3D | null = null;
  private meshes: Mesh[] = [];
  private bones: Bone[] = [];
  private skeleton: SkeletonHelper | null = null;
  private joints: InstancedMesh | null = null;
  private target = new Vector3(0, 0.9, 0);
  private baseDistance = 3.4;
  private raf = 0;
  private suspended = { hidden: false, offscreen: false };
  private dirty = true;
  private disposed = false;
  private lastNotify = 0;
  private ro: ResizeObserver;
  private io: IntersectionObserver | null = null;
  private onVisibility = () => this.setSuspended('hidden', document.hidden);
  private state: EngineSnapshot = { time: 0, playing: false, loop: true, speed: 1, mode: 'character', azimuthDeg: 0, distance: 0 };
  duration = 0;
  renders = 0;

  constructor(
    private container: HTMLElement,
    private onChange: (s: EngineSnapshot) => void,
    opts: { lowEnd: boolean },
  ) {
    try {
      this.renderer = new WebGLRenderer({ antialias: !opts.lowEnd, alpha: false, powerPreference: 'low-power' });
    } catch (e) {
      throw new MotionLoadError('webgl', String((e as Error)?.message ?? e));
    }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, opts.lowEnd ? 1 : 1.5));
    this.renderer.shadowMap.enabled = false;
    this.renderer.domElement.setAttribute('data-testid', 'motion3d-canvas');
    container.appendChild(this.renderer.domElement);
    const bg = getComputedStyle(container).getPropertyValue('--bg-subtle').trim();
    this.scene.background = new Color(bg || '#edeae4');
    this.scene.add(new HemisphereLight(0xffffff, 0x8a8070, 1.6));
    const sun = new DirectionalLight(0xffffff, 1.8);
    sun.position.set(2, 4, 3);
    this.scene.add(sun);
    const grid = new GridHelper(4, 8, 0x9a907f, 0xc9c0b0);
    this.scene.add(grid);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enablePan = false;
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 1.2;
    this.controls.maxDistance = 8;
    this.controls.addEventListener('change', this.markDirty);
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    if ('IntersectionObserver' in window) {
      this.io = new IntersectionObserver((entries) => this.setSuspended('offscreen', !entries.some((e) => e.isIntersecting)));
      this.io.observe(container);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.suspended.hidden = document.hidden;
    const stats = (window.__motion3dStats ??= { created: 0, disposed: 0 });
    stats.created++;
    this.resize();
  }

  // OrbitControls applies drag/pinch/wheel inside its own handlers and fires 'change' there — a later
  // controls.update() in the loop can return false (e.g. an undamped pinch zoom while paused), so report here.
  private markDirty = () => {
    this.dirty = true;
    if (this.mixer) this.notify(false);
  };

  /**
   * clip.file holds the animation. With `characterFile` (clip.embedsCharacter === false) the character comes from
   * that separate GLB and the animation's tracks are bound to it by bone name (both files are byte-cached).
   */
  async load(clip: MotionClip, characterFile: string | null = null): Promise<LoadedInfo> {
    const multi = !!characterFile && clip.actors.length > 1;
    this.state.loop = clip.actors.length <= 1;
    const parse = async (file: string) => {
      const bytes = await loadGlbBytes(file);
      if (this.disposed) throw new MotionLoadError('parse', 'viewer closed');
      try {
        return (await new GLTFLoader().parseAsync(bytes.slice(0), '')) as { scene: Object3D; animations: AnimationClip[] };
      } catch (e) {
        byteCache.delete(file); // a damaged file is fetched again on retry, not re-parsed from the cache
        throw new MotionLoadError('parse', String((e as Error)?.message ?? e));
      }
    };
    const animGltf = await parse(clip.file);
    let gltf = animGltf;
    if (characterFile) {
      try {
        gltf = await parse(characterFile);
        if (multi) {
          // two-person demo: one copy of the character per actor, its nodes renamed with the actor's prefix
          // ("A_pelvis") so the single shared animation drives each copy; each copy gets its own tinted material
          const group = new Group();
          for (const [i, actor] of clip.actors.entries()) {
            const copy = i === 0 ? gltf.scene : (await parse(characterFile)).scene;
            copy.traverse((o) => (o.name = `${actor.nodePrefix ?? ''}${o.name}`));
            copy.name = `actor-${actor.id}`;
            if (actor.color) tint(copy, actor.color);
            group.add(copy);
          }
          gltf = { scene: group, animations: [] };
        }
      } catch (e) {
        disposeObject(animGltf.scene);
        throw e;
      }
    }
    // a file that loaded but turned out unusable (no animation, wrong skeleton) must not stay cached: "다시 시도"
    // would otherwise re-use it — both files go, the character included
    const forget = () => {
      byteCache.delete(clip.file);
      if (characterFile) byteCache.delete(characterFile);
    };
    const drop = () => {
      disposeObject(gltf.scene);
      if (gltf !== animGltf) disposeObject(animGltf.scene);
    };
    if (this.disposed) {
      drop();
      throw new MotionLoadError('parse', 'viewer closed');
    }
    const anim = (clip.animation ? animGltf.animations.find((a) => a.name === clip.animation) : null) ?? animGltf.animations[0];
    if (!anim || !(anim.duration > 0) || !anim.tracks.length) {
      forget();
      drop();
      throw new MotionLoadError('animation', '애니메이션 정보가 없습니다');
    }
    if (gltf !== animGltf) {
      // every track must find its bone on the character (same rig), or the motion would silently not play
      const missing = anim.tracks.map((t) => PropertyBinding.parseTrackName(t.name).nodeName).filter((n) => !gltf.scene.getObjectByName(n));
      disposeObject(animGltf.scene);
      if (missing.length) {
        forget();
        disposeObject(gltf.scene);
        throw new MotionLoadError('rig', `캐릭터에 없는 뼈대: ${[...new Set(missing)].slice(0, 5).join(', ')}`);
      }
    }
    this.model = gltf.scene;
    this.model.traverse((o) => {
      const m = o as Mesh & { isSkinnedMesh?: boolean; isBone?: boolean };
      if ((o as Mesh).isMesh) {
        m.frustumCulled = false; // skinned bounds don't follow the animation
        // own materials, so the skeleton-mode fade never leaks into another instance
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone();
        this.meshes.push(m);
      }
      if (m.isBone) this.bones.push(o as Bone);
    });
    this.scene.add(this.model);
    this.model.updateMatrixWorld(true);
    const front = multi ? clip.actors[0].nodePrefix ?? '' : '';
    const restFacing = facingAzimuth(this.bones, front); // bind pose, before any animation is applied
    this.mixer = new AnimationMixer(this.model);
    this.action = this.mixer.clipAction(anim);
    this.action.play();
    // the file decides the real length; a catalog value off by more than one frame is reported, not trusted
    this.duration = Math.abs(anim.duration - clip.durationSec) <= 1 / clip.fps ? clip.durationSec : anim.duration;
    this.mixer.setTime(0);
    this.model.updateMatrixWorld(true);
    const box = new Box3().setFromObject(this.model);
    const size = box.getSize(new Vector3());
    this.target.set((box.min.x + box.max.x) / 2, box.min.y + size.y * 0.52, (box.min.z + box.max.z) / 2);
    const vFov = (this.camera.fov * Math.PI) / 180;
    // two people side by side / on the floor: frame the wider of the height and the floor extent
    const extent = multi ? Math.max(size.y * 0.62, Math.hypot(size.x, size.z) * 0.42) : size.y * 0.62;
    this.baseDistance = Math.min(7, Math.max(2, extent / Math.tan(vFov / 2)));
    // 정면 = the rig's rest forward for authored clips (their forward IS the opponent), else the chest at frame 0
    this.frontAzimuth = clip.cameraFront === 'rest' ? restFacing : facingAzimuth(this.bones, front);
    this.controls.target.copy(this.target);
    this.setCamera('front');
    this.skeleton = new SkeletonHelper(this.model);
    const sm = this.skeleton.material as Material & { depthTest: boolean; toneMapped: boolean };
    sm.depthTest = false;
    sm.toneMapped = false;
    this.skeleton.visible = false;
    this.scene.add(this.skeleton);
    this.joints = new InstancedMesh(new SphereGeometry(0.018, 8, 6), new MeshBasicMaterial({ color: 0xd8432f, depthTest: false }), this.bones.length);
    this.joints.renderOrder = 2;
    this.joints.visible = false;
    this.scene.add(this.joints);
    this.dirty = true;
    this.startLoop();
    let triangles = 0;
    for (const m of this.meshes) triangles += (m.geometry.index ? m.geometry.index.count : m.geometry.attributes.position.count) / 3;
    return { durationSec: this.duration, durationFromFile: anim.duration, jointCount: this.bones.length, triangles: Math.round(triangles), animation: anim.name };
  }

  // ---- playback ----
  play() {
    if (!this.mixer) return;
    if (this.state.time >= this.duration - 1e-4) this.state.time = 0;
    this.state.playing = true;
    this.lastTs = 0;
    this.notify(true);
  }
  pause() {
    this.state.playing = false;
    this.notify(true);
  }
  restart() {
    this.seek(0);
    this.play();
  }
  seek(t: number) {
    this.state.time = clampTime(t, this.duration);
    this.applyTime();
    this.notify(true);
  }
  /**
   * The real rendering surface. Recording the preview (motion3d/recorder.ts)
   * captures THIS canvas — the same pixels the user sees — rather than
   * re-deriving joint coordinates, which is what the reference video has to be.
   */
  get canvas(): HTMLCanvasElement {
    return this.renderer.domElement;
  }

  /**
   * Renders ONE frame at an absolute clip time, bypassing the rAF loop.
   *
   * The loop refuses to run while the tab is hidden or the viewer is scrolled
   * offscreen (startLoop checks `suspended`), which is right for a preview but
   * fatal for a recording: a suspended loop renders nothing and MediaRecorder
   * captures an empty video. Recording therefore drives the frames itself
   * through here, so a capture cannot be silently truncated by the app losing
   * focus mid-record.
   */
  renderAt(timeSec: number) {
    if (this.disposed) return;
    this.state.time = clampTime(timeSec, this.duration);
    this.mixer?.setTime(Math.min(this.state.time, Math.max(0, this.duration - 1e-4)));
    if (this.state.mode === 'skeleton') this.updateJoints();
    this.renderer.render(this.scene, this.camera);
    this.renders++;
    this.dirty = false;
  }

  /** Playback state, so a recorder can stop exactly when the clip ends. */
  get isPlaying(): boolean {
    return this.state.playing;
  }

  get currentTime(): number {
    return this.state.time;
  }

  setLoop(loop: boolean) {
    this.state.loop = loop;
    this.notify(true);
  }
  setSpeed(speed: number) {
    if (!(speed > 0)) return;
    this.state.speed = speed;
    this.notify(true);
  }
  setMode(mode: ViewMode) {
    this.state.mode = mode;
    const skeleton = mode === 'skeleton';
    for (const m of this.meshes)
      for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
        mat.transparent = skeleton;
        mat.opacity = skeleton ? 0.12 : 1;
        mat.depthWrite = !skeleton;
        mat.needsUpdate = true;
      }
    if (this.skeleton) this.skeleton.visible = skeleton;
    if (this.joints) this.joints.visible = skeleton;
    this.dirty = true;
    this.notify(true);
  }

  // ---- camera ----
  setCamera(preset: CameraPreset) {
    this.orbitTo(this.frontAzimuth + PRESET_OFFSET[preset], this.baseDistance);
  }
  /** The clip's joints on one playback at 1.0x, projected to a capture angle (pose measurement reference). */
  referencePose(angle: CaptureAngle, sampleFps: number): ReferencePoseTrack | null {
    if (!this.model || !this.action || !this.mixer) return null;
    const track = samplePoseTrack(this.model, this.action.getClip(), { durationSec: this.duration, sampleFps, angle, frontAzimuthDeg: this.frontAzimuth });
    this.mixer.setTime(this.state.time);
    this.model.updateMatrixWorld(true);
    this.dirty = true;
    return track;
  }
  /** Rotate around the character by `deltaDeg` (keyboard/QA path; drag/touch goes through OrbitControls). */
  rotateBy(deltaDeg: number) {
    this.orbitTo(this.state.azimuthDeg + deltaDeg, this.controls.getDistance());
  }
  zoomBy(factor: number) {
    this.orbitTo(this.state.azimuthDeg, this.controls.getDistance() * factor);
  }
  private orbitTo(azimuthDeg: number, distance: number) {
    const d = Math.min(this.controls.maxDistance, Math.max(this.controls.minDistance, distance));
    const s = new Spherical(d, Math.PI / 2 - (8 * Math.PI) / 180, (azimuthDeg * Math.PI) / 180);
    this.camera.position.copy(this.target).add(new Vector3().setFromSpherical(s));
    this.camera.lookAt(this.target);
    this.controls.update();
    this.dirty = true;
    this.notify(true);
  }

  // ---- loop ----
  private setSuspended(key: 'hidden' | 'offscreen', value: boolean) {
    this.suspended[key] = value;
    if (value) this.stopLoop();
    else {
      this.lastTs = 0; // don't jump by the time spent hidden
      this.dirty = true;
      this.startLoop();
    }
    this.container.dataset.rendering = this.raf ? 'on' : 'off';
  }
  private startLoop() {
    if (this.raf || this.disposed || this.suspended.hidden || this.suspended.offscreen) return;
    this.lastTs = 0;
    const tick = (ts: number) => {
      this.raf = requestAnimationFrame(tick);
      const dt = this.lastTs ? Math.min((ts - this.lastTs) / 1000, 0.1) : 0;
      this.lastTs = ts;
      if (this.state.playing && this.duration > 0) {
        const next = this.state.time + dt * this.state.speed;
        if (!this.state.loop && next >= this.duration) {
          // stop on the last frame
          this.state.time = this.duration;
          this.state.playing = false;
          this.applyTime();
          this.notify(true);
        } else {
          this.state.time = advance(this.state.time, dt, this.state.speed, this.duration);
          this.applyTime();
          this.notify(false);
        }
      }
      const moved = this.controls.update();
      if (moved) this.notify(false);
      if (this.state.playing || moved || this.dirty) {
        if (this.state.mode === 'skeleton') this.updateJoints();
        this.renderer.render(this.scene, this.camera);
        this.renders++;
        this.dirty = false;
      }
    };
    this.raf = requestAnimationFrame(tick);
    this.container.dataset.rendering = 'on';
  }
  private stopLoop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.container.dataset.rendering = 'off';
  }
  private applyTime() {
    // just under the end: at exactly `duration` a looping action wraps to frame 0
    this.mixer?.setTime(Math.min(this.state.time, Math.max(0, this.duration - 1e-4)));
    this.dirty = true;
  }
  private updateJoints() {
    if (!this.joints) return;
    const m = new Matrix4();
    const p = new Vector3();
    this.bones.forEach((b, i) => {
      b.getWorldPosition(p);
      this.joints!.setMatrixAt(i, m.makeTranslation(p.x, p.y, p.z));
    });
    this.joints.instanceMatrix.needsUpdate = true;
  }
  private resize() {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, true);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.dirty = true;
  }
  private notify(force: boolean) {
    const now = performance.now();
    this.state.azimuthDeg = ((((this.controls.getAzimuthalAngle() * 180) / Math.PI) % 360) + 360) % 360;
    this.state.distance = this.controls.getDistance();
    const d = this.container.dataset;
    d.time = this.state.time.toFixed(4);
    d.playing = String(this.state.playing);
    d.loop = String(this.state.loop);
    d.speed = String(this.state.speed);
    d.mode = this.state.mode;
    d.azimuth = this.state.azimuthDeg.toFixed(1);
    d.distance = this.state.distance.toFixed(3);
    if (!force && now - this.lastNotify < 66) return; // ~15 Hz to React while playing
    this.lastNotify = now;
    this.onChange({ ...this.state });
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.stopLoop();
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.ro.disconnect();
    this.io?.disconnect();
    this.controls.removeEventListener('change', this.markDirty);
    this.controls.dispose();
    this.action?.stop();
    if (this.mixer && this.model) {
      this.mixer.stopAllAction();
      this.mixer.uncacheRoot(this.model);
    }
    this.skeleton?.dispose();
    if (this.joints) {
      this.joints.geometry.dispose();
      (this.joints.material as Material).dispose();
      this.joints.dispose();
    }
    this.scene.traverse((o) => {
      const g = o as GridHelper;
      if (g.type === 'GridHelper') {
        g.geometry.dispose();
        (g.material as Material).dispose();
      }
    });
    if (this.model) disposeObject(this.model);
    this.scene.clear();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.renderer.domElement.remove();
    this.container.dataset.rendering = 'off';
    this.container.dataset.disposed = 'true';
    window.__motion3dStats!.disposed++;
  }
}

/** Actor colour on every mesh of one character copy (the texture is dropped so white reads as white). */
function tint(root: Object3D, color: string) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    const mats = (Array.isArray(m.material) ? m.material : [m.material]).map((mat) => {
      const c = mat.clone() as Material & { map?: unknown; color?: Color; roughness?: number };
      if ('map' in c) c.map = null;
      c.color?.set(color);
      if (typeof c.roughness === 'number') c.roughness = 0.7;
      c.needsUpdate = true;
      return c;
    });
    m.material = Array.isArray(m.material) ? mats : mats[0];
  });
}

function disposeObject(root: Object3D) {
  root.traverse((o) => {
    const m = o as Mesh;
    if (!m.isMesh) return;
    m.geometry?.dispose();
    for (const mat of Array.isArray(m.material) ? m.material : [m.material]) {
      for (const v of Object.values(mat)) if (v && typeof v === 'object' && 'isTexture' in v) (v as { dispose(): void }).dispose();
      mat.dispose();
    }
  });
}
