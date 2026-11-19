// Before/after frame sheet for a 3D demo clip: the same keys rendered from the clip's current GLB ("fixed") and
// from a reference GLB served in its place ("v2"), side + front, arm region cropped. Headless Chrome, no window.
//   npm run build && node .devtools/compare-motion3d-frames.mjs <outDir> [referenceGlb=public/motion3d/boxing-jab-nw-v2.glb] [candidateGlb=clip file]
// env: KEYS=10,13,... CAMS=side,front,back MODE=skeleton (optional)
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
const OUT = process.argv[2] ?? 'compare-frames';
const REF = process.argv[3] ?? 'public/motion3d/boxing-jab-nw-v2.glb';
const CAND = process.argv[4] ?? null;
fs.mkdirSync(OUT, { recursive: true });
const preview = spawn('npx', ['vite','preview','--port','4800','--strictPort'], { cwd: process.cwd(), stdio: 'ignore' });
const b = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--enable-unsafe-swiftshader'] });
const KEYS = (process.env.KEYS ?? '10,13,15,16,17,20,27,33,37').split(',').map(Number);
const CAMS = (process.env.CAMS ?? 'side,front').split(',');
const [LA, LB] = (process.env.LABELS ?? 'V2,fixed').split(',');
const CROP = process.env.CROP !== '0';
try {
  for (let i=0;i<40;i++){ try{ if((await fetch('http://localhost:4800/')).ok) break;}catch{} await new Promise(r=>setTimeout(r,250)); }
  const shots = {};
  for (const ver of ['v2','fixed']) {
    const ctx = await b.newContext({ viewport: { width: 1400, height: 1200 } }); const p = await ctx.newPage();
    const file = ver === 'v2' ? REF : CAND;
    if (file) await p.route('**/motion3d/*.glb', (r) => r.fulfill({ status: 200, contentType: 'model/gltf-binary', body: fs.readFileSync(file) }));
    await p.goto('http://localhost:4800/#/arts/boxing/techniques/boxing__jab');
    await p.getByTestId('motion3d-open').click(); await p.locator('[data-testid="motion3d-stage"][data-loaded="true"]').waitFor();
    await p.getByTestId('motion3d-play').click();
    if (process.env.MODE === 'skeleton') await p.getByTestId('motion3d-mode').click();
    for (const cam of CAMS) {
      await p.getByTestId('motion3d-camera-'+cam).click(); 
      for (const k of KEYS) {
        await p.getByTestId('motion3d-timeline').evaluate((el, v) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(v)); el.dispatchEvent(new Event('input', { bubbles: true })); }, (k+1)/30); await p.waitForTimeout(120);
        await p.getByTestId('motion3d-canvas').evaluate(el => el.scrollIntoView({block:'center'}));
        const buf = await p.getByTestId('motion3d-canvas').screenshot();
        shots[ver+'-'+cam+'-'+k] = buf.toString('base64'); fs.writeFileSync(OUT+'/'+ver+'-'+cam+'-'+k+'.png', buf);
      }
    }
    await ctx.close();
  }
  for (const cam of CAMS) {
    const ctx = await b.newContext({ viewport: { width: 1800, height: 460 } }); const p = await ctx.newPage();
    const cell = (ver,k) => CROP ? '<td><div style="width:190px;height:190px;overflow:hidden;position:relative"><img src="data:image/png;base64,'+shots[ver+'-'+cam+'-'+k]+'" style="position:absolute;width:'+(cam==='side'?520:560)+'px;left:'+(cam==='side'?-40:-230)+'px;top:'+(cam==='side'?-60:-60)+'px"></div></td>' : '<td><img src="data:image/png;base64,'+shots[ver+'-'+cam+'-'+k]+'" width="190"></td>';
    await p.setContent('<style>body{margin:4px;font:13px sans-serif}td{padding:1px;text-align:center}</style><table><tr><td></td>'+KEYS.map(k=>'<td>key '+k+' ('+((k+1)/30).toFixed(3)+'s)</td>').join('')+'</tr><tr><td>'+LA+'</td>'+KEYS.map(k=>cell('v2',k)).join('')+'</tr><tr><td>'+LB+'</td>'+KEYS.map(k=>cell('fixed',k)).join('')+'</tr></table>');
    await p.screenshot({ path: OUT+'/compare-'+cam+'.png', fullPage: true }); await ctx.close();
  }
} finally { await b.close(); preview.kill(); }
