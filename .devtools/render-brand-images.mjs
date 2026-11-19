// 브랜드 이미지 생성 — .devtools/render/brandRender.ts 를 개발 서버(localhost:5173)에서 헤드리스 Chrome 으로 실행해
// src/assets/brand/redesign/*.webp 로 저장한다. 외부 서비스·유료 API 호출 없음(로컬 3D 모델·모션캡처만 사용).
//   node .devtools/render-brand-images.mjs [shotId…]
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright-core';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const OUT = path.join(APP, 'src/assets/brand/redesign');
fs.mkdirSync(OUT, { recursive: true });

// id → shot. Wide heroes keep the figure off-centre so type can sit in the open side.
export const SHOTS = {
  'hero-strike': { techniqueId: 'boxing__cross', t: 0.62, azimuth: 70, elevation: 4, distance: 0.8, offsetX: 0.55, width: 2400, height: 1350, rim: 'gold', targetY: 1 },
  'hero-guard': { techniqueId: 'boxing__jab', t: 0.05, azimuth: -35, elevation: 2, distance: 0.6, offsetX: -0.5, width: 2400, height: 1350, rim: 'gold', targetY: 1 },
  'art-boxing': { techniqueId: 'boxing__hook', t: 0.55, azimuth: 40, elevation: 6, distance: 0.9, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'art-striking': { techniqueId: 'boxing__jab', clip: 2, t: 0.8, azimuth: -65, elevation: 3, distance: 0.95, offsetX: 0, width: 1200, height: 1500, rim: 'steel', targetY: 1 },
  'art-wrestling': { techniqueId: 'wrestling__basic-double-leg', t: 1.6, azimuth: 80, elevation: 10, distance: 1.05, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'art-grappling': { techniqueId: 'bjj__rear-naked-choke', t: 1.8, azimuth: 120, elevation: 18, distance: 1.0, offsetX: 0, width: 1200, height: 1500, rim: 'steel', targetY: 1 },
  'art-kickboxing': { techniqueId: 'boxing__cross', clip: 1, t: 0.55, azimuth: 120, elevation: 6, distance: 0.9, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'art-muaythai': { techniqueId: 'boxing__hook', clip: 1, t: 0.5, azimuth: -110, elevation: 4, distance: 0.88, offsetX: 0, width: 1200, height: 1500, rim: 'steel', targetY: 1 },
  'art-taekwondo': { techniqueId: 'boxing__jab', clip: 1, t: 0.4, azimuth: 150, elevation: 14, distance: 0.95, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'art-karate': { techniqueId: 'boxing__cross', t: 0.05, azimuth: 20, elevation: -4, distance: 0.82, offsetX: 0, width: 1200, height: 1500, rim: 'steel', targetY: 1 },
  'art-judo': { techniqueId: 'wrestling__basic-double-leg', clip: 1, t: 2.4, azimuth: -60, elevation: 16, distance: 1.0, offsetX: 0, width: 1200, height: 1500, rim: 'steel', targetY: 1 },
  'art-sambo': { techniqueId: 'wrestling__basic-double-leg', t: 2.0, azimuth: 150, elevation: 20, distance: 1.0, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'art-mma': { techniqueId: 'bjj__rear-naked-choke', t: 2.6, azimuth: -30, elevation: 24, distance: 1.0, offsetX: 0, width: 1200, height: 1500, rim: 'gold', targetY: 1 },
  'coach-study': { techniqueId: 'boxing__jab', t: 0.45, azimuth: 0, elevation: 8, distance: 0.62, offsetX: 0.4, width: 2000, height: 1125, rim: 'steel', targetY: 1 },
  'gym-floor': { techniqueId: 'wrestling__basic-double-leg', t: 0.9, azimuth: 30, elevation: 22, distance: 0.72, offsetX: -0.35, width: 2000, height: 1125, rim: 'gold', targetY: 1 },
  'auth-portrait': { techniqueId: 'boxing__cross', t: 0.1, azimuth: -20, elevation: 0, distance: 0.62, offsetX: 0, width: 1200, height: 1600, rim: 'gold', targetY: 1 },
  'community-clinch': { techniqueId: 'bjj__rear-naked-choke', t: 1.1, azimuth: 60, elevation: 12, distance: 0.68, offsetX: 0.3, width: 2000, height: 1125, rim: 'gold', targetY: 1 },
};

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 400, height: 300 } });
await page.route(/supabase\.co|generativelanguage|functions\/v1/, (r) => r.abort());
await page.goto('http://localhost:5173/');
for (const [id, shot] of Object.entries(SHOTS)) {
  if (only.length && !only.includes(id)) continue;
  const t0 = Date.now();
  try {
    const dataUrl = await page.evaluate(async (s) => (await import('/.devtools/render/brandRender.ts')).renderShot(s), shot);
    fs.writeFileSync(path.join(OUT, `${id}.webp`), Buffer.from(dataUrl.split(',')[1], 'base64'));
    console.log(`✓ ${id} (${Math.round((Date.now() - t0) / 100) / 10}s)`);
  } catch (e) {
    console.log(`✗ ${id}: ${String(e).slice(0, 200)}`);
  }
}
await browser.close();
