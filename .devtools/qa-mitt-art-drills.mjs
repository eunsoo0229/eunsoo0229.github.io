// QA: 종목별 미트 형식 (공격 지시 · 반응 훈련), 기술 범위, 사용자 콤보·셋업 tab in Visualizing Mitt.
// Runs the real app (logged out). Requires the Vite dev server on :5173.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const APP = '/Users/swcho/Documents/MARTIALDEX';
const results = [];
const check = (n, p, d = '') => {
  results.push(p);
  console.log(`${p ? 'PASS' : 'FAIL'} — ${n}${d !== '' ? ' :: ' + String(typeof d === 'string' ? d : JSON.stringify(d)).slice(0, 400) : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ executablePath: path.join(APP, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdx-artdrill-'))}`], env, timeout: 30000 });
const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
await page.waitForLoadState('load');
await sleep(800);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const tid = (id) => page.locator(`[data-testid="${id}"]`);

async function openMitt(art, tab) {
  await page.evaluate(() => (location.hash = '#/coach/mitt'));
  await tid('mitt-art-filter').waitFor({ timeout: 15000 });
  await tid('mitt-art-filter').selectOption(art);
  await tid(`mitt-tab-${tab}`).click();
  await sleep(300);
}
/** Watches the shown call / mitt for `ms`: call texts and which kinds of mitt views appeared. */
async function watch(callId, ms) {
  return page.evaluate(
    async ({ callId, ms }) => {
      const calls = new Set();
      const paths = new Set();
      const t0 = performance.now();
      await new Promise((res) => {
        const tick = () => {
          const c = document.querySelector(`[data-testid="${callId}"]`);
          const txt = c?.querySelector('.reaction-drill__words')?.textContent ?? c?.textContent;
          if (txt && txt.trim()) calls.add(txt.trim().replace(/!$/, ''));
          document.querySelectorAll('[data-testid="mitt-front"]').forEach((f) => paths.add(`${f.getAttribute('data-kind')}:${f.getAttribute('data-path')}`));
          if (performance.now() - t0 > ms) res();
          else requestAnimationFrame(tick);
        };
        tick();
      });
      return { calls: [...calls], paths: [...paths] };
    },
    { callId, ms },
  );
}
const num = async (id) => Number(await tid(id).textContent());

// ---- 1. 레슬링: 공격 지시 = 레슬링 드릴
await openMitt('wrestling', 'command');
check('[레슬링] 종목 형식이 레슬링으로 표시', (await tid('command-style').getAttribute('data-style')) === 'wrestling', await tid('command-style').textContent());
check('[레슬링] 킥 스위치 없음, 태클 방어 기본 켜짐', (await tid('command-kicks').count()) === 0 && (await tid('command-defense').isChecked()));
await tid('command-level-single').click();
const wPool = await num('command-pool-size');
await tid('command-range-wide').click();
const wPoolWide = await num('command-pool-size');
check(`[레슬링] 확장 기술 → 지시 풀 증가 (${wPool} → ${wPoolWide})`, wPoolWide > wPool);
await tid('command-range-basic').click();
await tid('command-start').click();
const w = await watch('command-call', 26000);
await tid('command-stop').click().catch(() => {});
const WRESTLING_WORDS = /^(태클|더블렉|블래스트 더블|싱글렉|하이 크로치|스냅 다운|레벨 체인지|페이크 슛|스프롤|다운블락|점프 스프롤|위저|앵클 픽|고 비하인드|니 탭|덕 언더|암 드래그|바디락|아웃사이드 트립|인사이드 트립|래터럴 드롭|파이어맨 캐리)$/;
check('[레슬링] 실제로 부른 지시가 모두 레슬링 동작', w.calls.length >= 3 && w.calls.every((c) => WRESTLING_WORDS.test(c)), w.calls);
check('[레슬링] 코치가 슛 → 방어 그림(data-path=shot) 또는 진입 그림이 나옴', w.paths.some((p) => p === 'defense:shot' || p.startsWith('entry')), w.paths);

// ---- 2. 복싱: 펀치만
await openMitt('boxing', 'command');
check('[복싱] 종목 형식 = 복싱, 킥 스위치 없음', (await tid('command-style').getAttribute('data-style')) === 'boxing' && (await tid('command-kicks').count()) === 0);
await tid('command-start').click();
const b = await watch('command-call', 16000);
await tid('command-stop').click().catch(() => {});
check('[복싱] 부른 지시에 킥·니·태클 없음', b.calls.length >= 2 && b.calls.every((c) => !/킥|팁|니|태클|더블렉|싱글렉|스프롤/.test(c)), b.calls);

// ---- 3. MMA: 반응 훈련 + 사용자 콤보 포함
await openMitt('mixed-martial-arts', 'react');
check('[MMA/반응] 종목 형식 = MMA', (await tid('reaction-style').getAttribute('data-style')) === 'mma');
await page.waitForFunction(() => !document.querySelector('[data-testid="reaction-style"]')?.parentElement?.textContent?.includes('불러오는 중'), null, { timeout: 15000 }).catch(() => {});
await sleep(500);
const withShared = await num('reaction-pool-size');
await tid('reaction-shared').uncheck();
await sleep(200);
const noShared = await num('reaction-pool-size');
check(`[MMA/반응] 사용자 공유 콤보가 반응 풀에 들어감 (${noShared} → ${withShared})`, withShared > noShared);
await tid('reaction-shared').check();
await sleep(300);
await tid('reaction-start').click();
const r = await watch('reaction-call', 14000);
await tid('reaction-stop').click().catch(() => {});
check('[MMA/반응] 콤보를 실제로 불러 줌', r.calls.length >= 2, r.calls);

// ---- 4. 입식(전체) 기본 = 기존 입식 타격
await openMitt('', 'command');
check('[전체] 종목 형식 = 입식 타격', (await tid('command-style').getAttribute('data-style')) === 'striking');

// ---- 5. 사용자 콤보·셋업 탭
await openMitt('mixed-martial-arts', 'shared');
await page.waitForFunction(() => document.querySelector('[data-testid="mitt-shared"]')?.getAttribute('data-state') !== 'loading', null, { timeout: 20000 });
const count = Number(await tid('mitt-shared').getAttribute('data-count'));
check(`[공유 탭] MMA 공유 콤보·셋업 목록 (${count}개)`, count >= 20, await tid('mitt-shared').getAttribute('data-state'));
await tid('mitt-shared-search').fill('Superman Punch');
await sleep(300);
const opt = tid('mitt-shared-option').filter({ hasText: 'Check → Superman Punch' }).first();
check('[공유 탭] 새로 올린 MMA 콤보 검색됨 (Check → Superman Punch)', (await opt.count()) === 1);
await opt.locator('[data-testid="mitt-shared-start"]').click();
await page.waitForFunction(() => document.querySelector('[data-testid="mitt-interpret"]') || document.querySelector('[data-testid="mitt-run-mode"]'), null, { timeout: 20000 });
if (await tid('mitt-interpret').count()) {
  check('[공유 탭] 설명 있는 공유 콤보 → AI 단계 정리 화면', true);
  await tid('mitt-interpret-use-original').click();
}
await tid('mitt-run-mode').waitFor({ timeout: 10000 });
const names = await page.locator('body').innerText();
check('[공유 탭] 원래 단계로 미트 세션 시작 (체크 → 슈퍼맨)', /Superman/i.test(names) && /Check/.test(names));

check('페이지 오류 없음', errors.length === 0, errors);
await app.close();
const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
