// 3D preview in AI chat and AI lessons — real Electron screen QA (hidden + muted, separate user-data-dir).
//   chat: "보여줘" → 3D card for the DB technique; no clip → stated, not substituted; closing the viewer keeps the chat
//   lesson: the technique being taught gets its own 3D card; a side question "보여줘" in the lesson → that technique
// Requires: Vite dev server :5173, SearXNG :8888, Ollama :11434.   Run: node .devtools/qa-motion-preview.mjs
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const APP_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const electronBin = path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron');
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' && !p ? ' :: ' + JSON.stringify(d).slice(0, 400) : '')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: electronBin, args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-m3d-chat-'))}`], env, timeout: 60000 });
const pageErrors = [];
try {
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  page.on('pageerror', (e) => pageErrors.push(e.message));
  page.on('dialog', (d) => d.accept());
  await page.waitForLoadState('load');
  await page.evaluate(() => localStorage.setItem('martialdex:coach-kind-pref', JSON.stringify({ last: 'martialdex', remember: true })));
  await page.evaluate(() => (location.hash = '#/coach/chat'));
  await page.waitForSelector('[data-testid="self-ai-input"]', { timeout: 20000 });
  const ANSWERS = '[data-testid="self-ai-chat"] .ai-msg--model:not(.ai-msg--pending)';
  const count = () => page.evaluate((s) => document.querySelectorAll(s).length, ANSWERS);
  async function ask(text) {
    const n = await count();
    await page.fill('[data-testid="self-ai-input"]', text);
    await page.click('[data-testid="self-ai-send"]');
    await page.waitForFunction(([n, s]) => document.querySelectorAll(s).length > n && !document.querySelector('[data-testid="self-ai-busy"]'), [n, ANSWERS], { timeout: 240000 });
    return page.locator(ANSWERS).last();
  }

  let last = await ask('복싱 크로스 동작 보여줘');
  const card = last.locator('[data-testid="chat-motion3d-card"]');
  check('[P1] "크로스 동작 보여줘" → 답변 안에 크로스 3D 카드', (await card.count()) === 1 && /cross/.test(await card.getAttribute('data-technique')) && (await card.getAttribute('data-clip')) === 'boxing-cross-m2m-v3', await last.innerText());
  await last.locator('[data-testid="motion3d-stage"][data-loaded="true"], [data-testid="motion3d-error"]').first().waitFor({ timeout: 60000 });
  check('[P2] "보여줘" 요청은 바로 열려 GLB 로딩·재생', (await last.locator('[data-testid="motion3d-error"]').count()) === 0 && (await last.locator('canvas').count()) === 1);
  const before = await page.locator('[data-testid="self-ai-chat"] .ai-msg').count();
  await last.locator('[data-testid="motion3d-close"]').click();
  const stats = await page.evaluate(() => window.__motion3dStats);
  check('[P3] 3D 닫기 → canvas 해제, 대화 그대로', (await page.locator('canvas').count()) === 0 && stats.created === stats.disposed && (await page.locator('[data-testid="self-ai-chat"] .ai-msg').count()) === before, stats);

  last = await ask('복싱 어퍼컷 동작 보여줘');
  const miss = await last.locator('[data-testid="chat-motion3d-missing"]').innerText().catch(() => '');
  check('[P4] 3D 없는 기술(어퍼컷) → "아직 3D 시연이 없습니다", 다른 기술 3D 없음', /어퍼컷|Uppercut/i.test(miss) && /3D 시연이 없습니다/.test(miss) && (await last.locator('[data-testid="chat-motion3d-card"]').count()) === 0, miss);

  last = await ask('잽은 언제 쓰는 기술이야?');
  check('[P5] 시각 요청이 없는 질문 → 3D 카드 없음', (await last.locator('[data-testid^="chat-motion3d"]').count()) === 0);

  last = await ask('훅은 어떻게 치는 거야?');
  const hook = last.locator('[data-testid="chat-motion3d-card"]');
  check('[P6] "훅은 어떻게 치는 거야?" → 훅 3D 카드(닫힌 상태, 열기 버튼)', (await hook.count()) === 1 && (await hook.getAttribute('data-clip')) === 'boxing-hook-m2m-v4' && (await hook.locator('[data-testid="motion3d-open"]').count()) === 1, (await last.innerText()).slice(0, 400));
  check('[P7] 대화 기록 유지 (이전 3D 카드들이 그대로)', (await page.locator('[data-testid="chat-motion3d-card"]').count()) === 2 && (await page.locator('[data-testid="chat-motion3d-missing"]').count()) === 1);

  // ---- lesson: technique being taught
  await ask('복싱 크로스를 기초부터 배우고 싶어. 수업 만들어 줘.');
  const start = page.locator('[data-testid="self-ai-start-lesson"]').last();
  if (await start.count()) {
    await start.click();
    for (let i = 0; i < 10; i++) {
      if (await page.locator('[data-testid="coach-location-home"]').count()) {
        await page.locator('[data-testid="coach-location-home"]').click();
        await page.locator('[data-testid="coach-location-confirm"]').click();
      }
      if (await page.locator('button', { hasText: '입력으로 대화' }).count()) await page.locator('button', { hasText: '입력으로 대화' }).first().click();
      if (await page.locator('[data-testid="coach-chat"] [data-kind="explain"]').count()) break;
      await sleep(1500);
    }
    await page.waitForSelector('[data-testid="lesson-motion3d-card"], [data-testid="lesson-motion3d-missing"]', { timeout: 30000 });
    // whatever the lesson teaches first: its own 3D card, or a "no 3D yet" line naming it — never another technique's clip
    const lessonShown = async () => {
      const card = page.locator('[data-testid="lesson-motion3d-card"]');
      if (await card.count()) return { id: await card.getAttribute('data-technique'), missing: null };
      return { id: null, missing: (await page.locator('[data-testid="lesson-motion3d-missing"]').innerText()).split(':')[0].replace(/^\W+/, '').trim() };
    };
    const shown = await lessonShown();
    const both = (await page.locator('[data-testid="lesson-motion3d-card"]').count()) + (await page.locator('[data-testid="lesson-motion3d-missing"]').count());
    check('[L1] 수업 화면: 지금 배우는 기술 하나에 대한 3D 카드 또는 "3D 없음" 안내', both === 1 && (shown.id || shown.missing), shown);
    const n0 = await page.locator('[data-testid="coach-chat"] .ai-msg').count();
    await page.fill('[data-testid="coach-text-input"]', '보여줘');
    await page.locator('[data-testid="coach-input"] button', { hasText: '보내기' }).click();
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid="coach-chat"] .ai-msg').length > n + 1 && !document.querySelector('[data-testid="coach-chat"] .ai-msg--pending'), n0, { timeout: 240000 }).catch(() => {});
    // the answer may be followed by a system line ("이어서 아까 질문에 답해 주세요") — look at every new message
    const side = await page.evaluate((n) => {
      const added = [...document.querySelectorAll('[data-testid="coach-chat"] .ai-msg')].slice(n);
      const card = added.map((m) => m.querySelector('[data-testid="chat-motion3d-card"]')).find(Boolean);
      const miss = added.map((m) => m.querySelector('[data-testid="chat-motion3d-missing"]')).find(Boolean);
      return { card: card?.getAttribute('data-technique') ?? null, miss: miss?.textContent ?? '', texts: added.map((m) => m.innerText.slice(0, 160)) };
    }, n0);
    check('[L2] 수업 중 "보여줘" → 지금 배우는 기술의 3D(또는 없음 안내) — 다른 기술로 대체 안 함', shown.id ? side.card === shown.id : !side.card && side.miss.includes(shown.missing), { side, shown });
    const after = await lessonShown();
    check('[L3] 수업 단계 유지 (수업 3D 카드가 같은 기술)', JSON.stringify(after) === JSON.stringify(shown), { after, shown });
  } else check('[L1] 수업 시작 버튼', false, await (await page.locator(ANSWERS).last()).innerText());
  check('페이지 오류 없음', pageErrors.length === 0, pageErrors);
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await app.close();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
