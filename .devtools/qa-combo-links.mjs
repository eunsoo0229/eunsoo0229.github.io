// 사용자 콤보·셋업 연결 — real Electron app, real shared_combos (live Supabase),
// real sign-up. The shared_combo_links REST endpoint is served by an
// in-memory stand-in (Playwright route) when LINKS_MOCK=1 — use it until
// migration 0040 is applied; without it the test runs against the live table.
//   LINKS_MOCK=1 env -u ELECTRON_RUN_AS_NODE node .devtools/qa-combo-links.mjs
// Requires the Vite dev server on :5173.
import { _electron as electron } from 'playwright-core';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { requireAccountQaTarget } from './lib/prodGuard.mjs';

// Creates / signs in Supabase accounts — blocked against the production project unless separately approved.
requireAccountQaTarget('qa-combo-links');

const APP_DIR = '/Users/swcho/Documents/MARTIALDEX';
const MOCK = process.env.LINKS_MOCK === '1';
const results = [];
function check(name, pass, detail = '') {
  results.push({ name, pass });
  const d = typeof detail === 'string' ? detail : JSON.stringify(detail);
  console.log((pass ? 'PASS' : 'FAIL') + ' — ' + name + (d ? ' :: ' + d.slice(0, 600) : ''));
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: path.join(APP_DIR, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), args: [APP_DIR, `--user-data-dir=${fs.mkdtempSync(path.join(os.tmpdir(), 'mdex-links-'))}`], env, timeout: 120000 });
  const page = app.windows().find((w) => w.url().startsWith('http://localhost:5173')) ?? (await app.firstWindow());
  await page.waitForLoadState('load');
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sleep(1500);
  const goto = async (hash, wait = 2500) => {
    await page.evaluate((h) => (window.location.hash = h), hash);
    await sleep(wait);
  };

  // ---------- 0. the table is not there yet → the pages still work and say so ----------
  if (MOCK) {
    const combos0 = await page.evaluate(async () => {
      const { listSharedCombos } = await import('/src/lib/sharedCombo/service.ts');
      const r = await listSharedCombos(null);
      return r.ok ? r.data.slice(0, 3).map((c) => c.id) : [];
    });
    await goto('#/user-combos');
    const listOk = await page.locator('[data-testid="shared-combo-card"]').count();
    await goto(`#/user-combos/${combos0[0]}`, 4000);
    const notReady = await page.evaluate(() => ({ err: document.querySelector('[data-testid="combo-links-error"]')?.textContent ?? '', steps: document.querySelectorAll('[data-testid="combo-step"]').length }));
    check('[0] 연결 테이블(0040)이 아직 없으면: 목록·상세는 정상, 연결 영역에 "마이그레이션 0040 적용 필요" 안내', listOk > 0 && notReady.steps > 0 && /0040/.test(notReady.err), { listOk, ...notReady });
  }

  // ---------- 1. pure helpers ----------
  const pure = await page.evaluate(async () => {
    const L = await import('/src/lib/sharedCombo/links.ts');
    const mk = (ids) => ({ steps: ids.map((id) => ({ techniqueId: id, name: id.split('__')[1], martialArt: id.split('__')[0] })) });
    const links = [
      { id: '1', authorId: 'u1', authorNickname: 'a', fromId: 'A', toId: 'B', relation: 'opens', note: '', createdAt: '2026-10-01' },
      { id: '2', authorId: 'u2', authorNickname: 'b', fromId: 'A', toId: 'B', relation: 'opens', note: '', createdAt: '2026-10-02' },
      { id: '3', authorId: 'u1', authorNickname: 'a', fromId: 'A', toId: 'C', relation: 'follow_up', note: '', createdAt: '2026-10-03' },
      { id: '4', authorId: 'u1', authorNickname: 'a', fromId: 'B', toId: 'D', relation: 'follow_up', note: '', createdAt: '2026-10-04' },
      { id: '5', authorId: 'u1', authorNickname: 'a', fromId: 'D', toId: 'A', relation: 'follow_up', note: '', createdAt: '2026-10-05' },
      { id: '6', authorId: 'u1', authorNickname: 'a', fromId: 'A', toId: 'E', relation: 'if_blocked', note: '', createdAt: '2026-10-06' },
    ];
    return {
      groups: L.groupLinks(links).map((g) => `${g.fromId}>${g.toId}:${g.relation}:${g.support}`),
      counts: Object.fromEntries(L.linkCounts(links)),
      flow: L.bestFlow('A', links),
      merged: L.mergedSteps([mk(['boxing__jab', 'boxing__cross']), mk(['boxing__cross', 'boxing__lead-hook'])]).map((s) => s.techniqueId),
      same: L.transitionNotes(mk(['boxing__jab', 'boxing__cross']), mk(['boxing__cross', 'boxing__lead-hook']), 'follow_up'),
      blocked: L.transitionNotes(mk(['boxing__jab', 'boxing__cross']), mk(['boxing__cross']), 'if_blocked'),
      invalid: [L.validateLink({ fromId: 'A', toId: 'A', relation: 'opens', note: '' }), L.validateLink({ fromId: 'A', toId: 'B', relation: 'opens', note: 'x'.repeat(301) }), L.validateLink({ fromId: 'A', toId: 'B', relation: 'opens', note: '' })],
    };
  });
  check('[1] 같은 A→B·관계를 여러 명이 만들면 하나로 묶고 지지 수(2명) 순 정렬', pure.groups[0] === 'A>B:opens:2', pure.groups);
  check('[1] 연결 수 배지: 콤보마다 서로 다른 연결 상대 수', pure.counts.A === 4 && pure.counts.B === 2, pure.counts);
  check('[1] 추천 흐름: 가장 지지받은 연결을 따라가고, 되돌아가는 순환·"막히면 전환"은 제외', JSON.stringify(pure.flow) === JSON.stringify(['A', 'B', 'D']), pure.flow);
  check('[1] 흐름 합치기: 넘어가는 기술이 같으면 한 번만 (잽 → 크로스 → 훅)', JSON.stringify(pure.merged) === JSON.stringify(['boxing__jab', 'boxing__cross', 'boxing__lead-hook']), pure.merged);
  check('[1] 연결 검사: 마지막·첫 기술이 같으면 참고 안내, "막히면 전환"은 연속 동작이 아니라 검사 안 함', pure.same.some((n) => /같은/.test(n)) && pure.blocked.length === 0, { same: pure.same, blocked: pure.blocked });
  check('[1] 입력 검사: 자기 자신 연결·300자 초과 메모 거부, 정상 입력 통과', pure.invalid[0].length > 0 && pure.invalid[1].length > 0 && pure.invalid[2].length === 0, pure.invalid);

  // ---------- 2. UI flow (signed in) ----------
  const store = [];
  if (MOCK) {
    await page.route('**/rest/v1/shared_combo_links**', async (route) => {
      const req = route.request();
      const url = new URL(req.url());
      const method = req.method();
      if (method === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(store) });
      if (method === 'POST') {
        const body = JSON.parse(req.postData() || '{}');
        if (store.some((l) => l.author_id === body.author_id && l.from_id === body.from_id && l.to_id === body.to_id && l.relation === body.relation)) {
          return route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ code: '23505', message: 'duplicate key value violates unique constraint' }) });
        }
        const row = { ...body, created_at: new Date().toISOString() };
        store.unshift(row);
        const single = /vnd\.pgrst\.object/.test(req.headers()['accept'] ?? '');
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) });
      }
      if (method === 'DELETE') {
        const id = (url.searchParams.get('id') ?? '').replace(/^eq\./, '');
        const i = store.findIndex((l) => l.id === id);
        if (i >= 0) store.splice(i, 1);
        return route.fulfill({ status: 204, body: '' });
      }
      return route.continue();
    });
  }
  const signup = await page.evaluate(async () => {
    const { supabase } = await import('/src/lib/supabase/client.ts');
    const { data, error } = await supabase.auth.signUp({ email: `qa-links-${Date.now()}@martialdex-test.local`, password: 'QaLinks!2026x', options: { data: { nickname: 'QA연결' } } });
    return { ok: !error && !!data.session, id: data?.user?.id, error: error?.message };
  });
  check('[2] 테스트 계정 가입·로그인', signup.ok, signup);
  await sleep(2500);
  // a fresh account gets the login-time prompt (local data / device) — answer it the way a user would
  for (let i = 0; i < 3 && (await page.locator('.modal-overlay').count()); i++) {
    const info = await page.evaluate(() => ({ text: document.querySelector('.modal-overlay')?.textContent?.slice(0, 160) ?? '', buttons: [...document.querySelectorAll('.modal-overlay button')].map((b) => b.textContent?.trim()) }));
    console.log('  · login prompt:', JSON.stringify(info));
    const btn = page.locator('.modal-overlay button', { hasText: /나중에|건너뛰기|닫기|취소|아니요|확인/ }).first();
    if (await btn.count()) await btn.click();
    else break;
    await sleep(800);
  }
  const pick = await page.evaluate(async () => {
    const { listSharedCombos } = await import('/src/lib/sharedCombo/service.ts');
    const r = await listSharedCombos(null);
    if (!r.ok) return null;
    const setup = r.data.find((c) => c.kind === 'setup' && c.martialArt === 'boxing') ?? r.data.find((c) => c.kind === 'setup');
    const combo = r.data.find((c) => c.kind === 'combo' && c.id !== setup?.id && c.martialArt === setup?.martialArt) ?? r.data.find((c) => c.kind === 'combo');
    return setup && combo ? { a: { id: setup.id, name: setup.name, steps: setup.steps.map((s) => s.techniqueId) }, b: { id: combo.id, name: combo.name, steps: combo.steps.map((s) => s.techniqueId) } } : null;
  });
  check('[2] 실제 공유된 셋업·콤보 선택', !!pick, pick);
  if (!pick) throw new Error('no shared combos');

  await goto(`#/user-combos/${pick.a.id}`, 4000);
  const empty = await page.locator('[data-testid="combo-links-empty"]').count();
  check('[2] 연결이 없으면 안내 + "다른 콤보·셋업과 연결하기" 버튼', empty === 1 && (await page.locator('[data-testid="combo-link-add"]').count()) === 1);
  await page.locator('[data-testid="combo-link-add"]').click();
  await page.locator('[data-testid="combo-link-rel-opens"]').click();
  await page.fill('[data-testid="combo-link-search"]', pick.b.name.slice(0, 12));
  await sleep(400);
  const cand = page.locator(`[data-testid="combo-link-candidate"][data-id="${pick.b.id}"]`);
  check('[2] 이름으로 검색해 연결할 콤보 찾기', (await cand.count()) === 1, await page.locator('[data-testid="combo-link-candidate"]').count());
  await cand.click();
  const preview = await page.textContent('[data-testid="combo-link-preview"]');
  check('[2] 미리보기: A → 셋업으로 열어줌 → B, 이어서 할 때의 기술 순서', preview.includes(pick.a.name) && preview.includes(pick.b.name) && /셋업으로 열어줌/.test(preview) && /이어서 하면/.test(preview), preview);
  await page.fill('[data-testid="combo-link-memo"]', '상대가 가드를 올리면 바로 이어서');
  await page.locator('[data-testid="combo-link-save"]').click();
  await page.locator('[data-testid="combo-links-out"] [data-testid="combo-link"]').first().waitFor({ timeout: 15000 });
  const out = await page.evaluate(() => {
    const li = document.querySelector('[data-testid="combo-links-out"] [data-testid="combo-link"]');
    return { rel: li?.dataset.relation, other: li?.dataset.other, support: li?.querySelector('[data-testid="combo-link-support"]')?.textContent, text: li?.textContent ?? '', del: !!li?.querySelector('[data-testid="combo-link-delete"]') };
  });
  check('[2] 연결하기 → "이 셋업 다음에" 목록에 표시 (관계·지지 1명·메모·내 연결 삭제 버튼)', out.rel === 'opens' && out.other === pick.b.id && /1명/.test(out.support ?? '') && /가드를 올리면/.test(out.text) && out.del, out);
  const flow = await page.evaluate(() => ({ ids: document.querySelector('[data-testid="combo-flow"]')?.dataset.ids ?? '', steps: document.querySelector('[data-testid="combo-flow-steps"]')?.textContent ?? '' }));
  check('[2] 추천 연결 흐름: A → B, 두 동작의 기술을 이어 붙인 순서', flow.ids === `${pick.a.id},${pick.b.id}` && flow.steps.length > 0, flow);
  await page.locator('[data-testid="combo-flow-save"]').click();
  const saved = await page.evaluate(async ({ a, b }) => {
    const { listMyCombos: listCombos } = await import("/src/lib/combo/service.ts");
    const list = listCombos();
    const c = list.find((x) => x.description?.startsWith('사용자 콤보·셋업 연결 흐름'));
    const expected = [...a];
    for (const [i, id] of b.entries()) if (!(i === 0 && expected.at(-1) === id)) expected.push(id);
    return { found: !!c, ids: c?.techniqueIds ?? [], expected: expected.slice(0, 12), link: !!document.querySelector('[data-testid="combo-flow-saved"] a') };
  }, { a: pick.a.steps, b: pick.b.steps });
  const { resolvedExpected } = await page.evaluate(async (ids) => {
    const { resolveTechnique } = await import('/src/lib/userTechniques/service.ts');
    return { resolvedExpected: ids.filter((id) => !!resolveTechnique(id)) };
  }, saved.expected);
  check('[2] 흐름을 내 콤보 북에 담기 → A·B 기술이 순서대로 합쳐진 콤보 + 바로 훈련 링크', saved.found && JSON.stringify(saved.ids.map((x) => x.split('__')[1])) === JSON.stringify(resolvedExpected.map((x) => x.split('__')[1])) && saved.link, saved);

  // duplicate
  await page.locator('[data-testid="combo-link-add"]').click();
  await page.locator('[data-testid="combo-link-rel-opens"]').click();
  await page.fill('[data-testid="combo-link-search"]', pick.b.name.slice(0, 12));
  await sleep(300);
  await page.locator(`[data-testid="combo-link-candidate"][data-id="${pick.b.id}"]`).click();
  await page.locator('[data-testid="combo-link-save"]').click();
  await page.locator('[data-testid="combo-links-error"]').waitFor({ timeout: 10000 });
  check('[2] 같은 연결을 다시 만들면 "이미 같은 연결" 안내', /이미 같은 연결/.test((await page.textContent('[data-testid="combo-links-error"]')) ?? ''));

  // the other side shows the incoming link
  await goto(`#/user-combos/${pick.b.id}`, 4000);
  const inc = await page.evaluate(() => ({ other: document.querySelector('[data-testid="combo-links-in"] [data-testid="combo-link"]')?.dataset.other ?? null }));
  check('[3] B 상세: "이 콤보로 이어지는 앞 동작"에 A 표시 (양방향)', inc.other === pick.a.id, inc);

  // list badge
  await goto('#/user-combos?sort=latest', 4000);
  await page.fill('input[placeholder*="검색"]', pick.a.name.slice(0, 12)).catch(() => {});
  await sleep(800);
  const badge = await page.evaluate((id) => document.querySelector(`[data-testid="shared-combo-card"][data-id="${id}"] [data-testid="combo-link-count"]`)?.textContent ?? null, pick.a.id);
  check('[3] 목록 카드에 🔗 연결 수', /🔗\s*1/.test(badge ?? ''), badge);

  // delete
  await goto(`#/user-combos/${pick.a.id}`, 4000);
  page.once('dialog', (d) => void d.accept());
  await page.locator('[data-testid="combo-links-out"] [data-testid="combo-link-delete"]').click();
  await page.locator('[data-testid="combo-links-empty"]').waitFor({ timeout: 10000 });
  check('[3] 내 연결 삭제 → 목록에서 사라짐', (await page.locator('[data-testid="combo-link"]').count()) === 0);

  // signed out: read-only
  await page.evaluate(async () => (await import('/src/lib/supabase/client.ts')).supabase.auth.signOut());
  await goto(`#/user-combos/${pick.a.id}`, 4000);
  check('[4] 로그아웃 상태: 연결은 볼 수 있고 만들기 대신 로그인 안내', (await page.locator('[data-testid="combo-link-add"]').count()) === 0 && /로그인/.test((await page.textContent('[data-testid="combo-links"]')) ?? ''));

  check('[Z] 페이지 에러 없음', errors.length === 0, errors);
  await app.close();
  const passed = results.filter((x) => x.pass).length;
  console.log(`=== SUMMARY: ${passed}/${results.length} PASSED ===`);
  if (passed !== results.length) console.log('FAILURES:', results.filter((x) => !x.pass).map((x) => x.name));
  process.exit(passed === results.length ? 0 : 1);
}
main().catch((e) => {
  console.error('DRIVER FAILED:', e);
  process.exit(1);
});
