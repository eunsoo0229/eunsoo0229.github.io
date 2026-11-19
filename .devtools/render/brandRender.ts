// 브랜드 이미지 렌더러 (개발 도구) — 프로젝트의 3D 파이터 모델 + 모션캡처 클립을 기존 MotionEngine 으로 불러와
// 조명·재질·카메라만 바꿔 시네마틱 스틸 이미지를 만든다. 결과는 .devtools/render-brand-images.mjs 가 파일로 저장한다.
// 앱 런타임에서는 쓰지 않는다.
import {
  AmbientLight,
  CanvasTexture,
  CircleGeometry,
  Color,
  DirectionalLight,
  Light,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PerspectiveCamera,
  Scene,
  SpotLight,
  Vector3,
  Box3,
  WebGLRenderer,
  AdditiveBlending,
} from 'three';
import { MotionEngine } from '../../src/lib/motion3d/engine';
import { characterFileFor, motionClipsFor } from '../../src/lib/motion3d/catalog';

export interface Shot {
  techniqueId: string;
  clip?: number;
  /** seconds into the clip */
  t: number;
  /** camera azimuth around the subject (deg, 0 = engine front) */
  azimuth: number;
  /** camera elevation (deg) */
  elevation: number;
  /** distance multiplier (smaller = tighter) */
  distance: number;
  /** horizontal subject offset in frame (-1..1, positive = subject to the left so text can sit right) */
  offsetX: number;
  width: number;
  height: number;
  /** rim colour emphasis */
  rim: 'gold' | 'steel';
  /** lift the look target (m) */
  targetY?: number;
}

const INK = new Color('#0a0a0b');

function floorGlow(): Mesh {
  const c = document.createElement('canvas');
  c.width = c.height = 512;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(256, 256, 0, 256, 256, 256);
  grad.addColorStop(0, 'rgba(244,241,234,0.22)');
  grad.addColorStop(0.45, 'rgba(196,173,124,0.06)');
  grad.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 512, 512);
  const m = new Mesh(new CircleGeometry(2.4, 64), new MeshBasicMaterial({ map: new CanvasTexture(c), transparent: true, blending: AdditiveBlending, depthWrite: false }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = 0.002;
  return m;
}

/** film look: vignette + fine grain + slight lift of blacks, done in 2D after the WebGL frame */
function finish(src: HTMLCanvasElement, w: number, h: number): string {
  const out = document.createElement('canvas');
  out.width = w;
  out.height = h;
  const g = out.getContext('2d')!;
  g.drawImage(src, 0, 0, w, h);
  const v = g.createRadialGradient(w * 0.5, h * 0.45, Math.min(w, h) * 0.2, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
  v.addColorStop(0, 'rgba(0,0,0,0)');
  v.addColorStop(1, 'rgba(0,0,0,0.78)');
  g.fillStyle = v;
  g.fillRect(0, 0, w, h);
  const img = g.getImageData(0, 0, w, h);
  let seed = 1337;
  for (let i = 0; i < img.data.length; i += 4) {
    seed = (seed * 16807) % 2147483647;
    const n = ((seed / 2147483647) - 0.5) * 14;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] + n + 2));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] + n + 2));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] + n + 3));
  }
  g.putImageData(img, 0, 0);
  return out.toDataURL('image/webp', 0.86);
}

export async function renderShot(shot: Shot): Promise<string> {
  const host = document.createElement('div');
  host.style.cssText = `position:fixed;left:0;top:0;width:${shot.width}px;height:${shot.height}px;`;
  document.body.appendChild(host);
  const engine = new MotionEngine(host, () => {}, { lowEnd: false });
  try {
    const clip = motionClipsFor(shot.techniqueId)[shot.clip ?? 0];
    if (!clip) throw new Error(`no clip for ${shot.techniqueId}`);
    await engine.load(clip, characterFileFor(clip));
    // reach the engine's three.js objects (TS-private only) — dev tool, not app code
    const e = engine as unknown as { scene: Scene; renderer: WebGLRenderer; camera: PerspectiveCamera; target: Vector3; controls: { enabled: boolean; update: () => void } };
    e.renderer.setPixelRatio(1);
    e.renderer.setSize(shot.width, shot.height, false);
    e.camera.aspect = shot.width / shot.height;
    e.scene.background = INK;
    // strip the engine's studio light + grid
    const drop: Object3D[] = [];
    e.scene.traverse((o) => {
      if (o instanceof Light || o.type === 'GridHelper' || o.type === 'Line' || o.type === 'LineSegments') drop.push(o);
    });
    for (const o of drop) o.parent?.remove(o);
    // graphite satin bodies; the second actor a shade darker so the pair reads as two figures
    let actor = 0;
    e.scene.traverse((o) => {
      if (o.name.startsWith('actor-')) actor++;
      const m = o as Mesh;
      if (m.isMesh && (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) {
        m.material = new MeshStandardMaterial({ color: actor >= 2 ? '#1c1d21' : '#2b2c31', roughness: 0.42, metalness: 0.35 });
      } else if (m.isMesh && m.geometry && !(m.material as MeshBasicMaterial).map) {
        m.visible = false; // joints / helpers
      }
    });
    e.scene.add(new AmbientLight('#3a3c41', 0.35));
    const key = new SpotLight('#f4f1ea', 60, 16, Math.PI / 6, 0.75, 1.5);
    key.position.set(2.2, 4.2, 2.8);
    key.target.position.set(0, 0.9, 0);
    e.scene.add(key, key.target);
    const rimA = new DirectionalLight(shot.rim === 'gold' ? '#d9bf88' : '#aab4c4', 7.5);
    rimA.position.set(-3.5, 2.6, -3.2);
    const rimB = new DirectionalLight(shot.rim === 'gold' ? '#c4ad7c' : '#7d8796', 3.2);
    rimB.position.set(3.4, 1.4, -3.6);
    e.scene.add(rimA, rimB);
    e.scene.add(floorGlow());

    engine.renderAt(shot.t);
    // auto-frame on the posed bodies (skinned, so measure the deformed vertices)
    const box = new Box3();
    e.scene.traverse((o) => {
      const m = o as Mesh;
      if (m.isMesh && m.visible && (m as unknown as { isSkinnedMesh?: boolean }).isSkinnedMesh) box.expandByObject(m, true);
    });
    const size = box.getSize(new Vector3());
    const target = box.getCenter(new Vector3());
    if (shot.targetY !== undefined) target.y += shot.targetY - 1;
    const vfov = (e.camera.fov * Math.PI) / 180;
    const fitH = size.y / 2 / Math.tan(vfov / 2);
    const fitW = Math.max(size.x, size.z) / 2 / Math.tan(vfov / 2) / e.camera.aspect;
    const base = Math.max(fitH, fitW) * 1.25 * shot.distance;
    const az = (shot.azimuth * Math.PI) / 180;
    const el = (shot.elevation * Math.PI) / 180;
    e.controls.enabled = false;
    e.camera.near = 0.05;
    e.camera.far = 60;
    e.camera.position.set(target.x + base * Math.sin(az) * Math.cos(el), target.y + base * Math.sin(el), target.z + base * Math.cos(az) * Math.cos(el));
    e.camera.lookAt(target);
    // shift the subject sideways in frame (lens shift) so editorial text can sit beside it
    e.camera.setViewOffset(shot.width, shot.height, (shot.offsetX * shot.width) / 2.6, 0, shot.width, shot.height);
    e.camera.updateProjectionMatrix();
    e.renderer.render(e.scene, e.camera);
    return finish(e.renderer.domElement, shot.width, shot.height);
  } finally {
    engine.dispose();
    host.remove();
  }
}
