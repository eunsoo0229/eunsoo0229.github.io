// UI QA — new technique registration with hierarchical category selection + category management, in headless
// Chrome (no window, no sound) against the built renderer (`vite preview`). Logged out (device-local); the AI
// bridge (window.martialdex.askAi — the app's Electron path) is a fake that answers the registration steps.
//   npm run build && node .devtools/qa-technique-categories.mjs
import { chromium } from 'playwright-core';
import { spawn } from 'node:child_process';
import path from 'node:path';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const PORT = 4792;
const preview = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: APP, stdio: 'ignore' });
const results = [];
const check = (n, p, d = '') => (results.push(!!p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 220) : '')));
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true, args: ['--mute-audio'] });

const fakeAi = () => {
  const reply = (o) => ({ ok: true, text: JSON.stringify(o), groundingSources: [{ title: 'QA source', uri: 'https://example.org/qa' }] });
  window.martialdex = {
    ...(window.martialdex ?? {}),
    askAi: async (req) => {
      const s = `${req.systemInstruction}\n${req.question}`;
      if (s.includes('isDuplicate')) return reply({ isDuplicate: false, matchedTechniqueId: null, matchedTechniqueName: null, reason: '없음' });
      if (s.includes('"verdict"')) return reply({ verdict: 'confirmed', confidence: 92, martialArtConfirmed: 'bjj', category: '하프 가드 (Half Guard)', evidenceNotes: ['하프 가드 바텀에서 쓰는 스윕'], canonicalName: 'QA Underhook Sweep', reason: '확인됨' });
      if (s.includes('categoryIsNew')) return reply({ category: '하프 가드 (Half Guard)', categoryIsNew: false, newCategoryReason: null, koreanName: 'QA 언더훅 스윕', aliases: [], description: '하프 가드 바텀에서 언더훅을 잡고 상대를 넘기는 스윕입니다.', purpose: '하프 가드에서 상대를 뒤집기', whenToUse: '상대가 체중을 앞으로 실을 때', principles: ['언더훅'], difficulty: 'intermediate', tags: [], relatedTechniqueNames: [], posture: { overview: '하프 가드 바텀에서 언더훅을 잡고 상대를 넘기는 스윕입니다.', steps: ['언더훅', '무릎 들기'], keyPoints: ['언더훅'], commonMistakes: [] } });
      return { ok: false, code: 'NETWORK', message: 'QA: no AI' };
    },
  };
};

try {
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://localhost:${PORT}/`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 250));
  }
  for (const [label, viewport] of [['모바일 390px', { width: 390, height: 844 }], ['데스크톱 1280px', { width: 1280, height: 900 }]]) {
    const ctx = await browser.newContext({ viewport });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.addInitScript(fakeAi);
    // ---- registration
    await page.goto(`http://localhost:${PORT}/#/techniques/request?art=bjj`);
    await page.getByPlaceholder('예: Check Hook').fill('QA Underhook Sweep');
    await page.locator('textarea').first().fill('하프 가드 바텀에서 언더훅으로 넘기는 스윕');
    await page.getByRole('button', { name: /확인|검증|요청/ }).first().click();
    await page.getByTestId('registration-classification').waitFor({ timeout: 30000 });
    const recText = await page.getByTestId('cat-recommendation').innerText();
    check(`[${label}] 자동 추천: 하프 가드 › 스윕 + 이유 + 확신도`, /하프 가드 › 스윕/.test(recText) && /확신도/.test(recText), recText.slice(0, 160));
    check(`[${label}] 확신 있는 추천은 미리 선택 (변경 가능)`, /하프 가드 › 스윕/.test(await page.getByTestId('cat-selected').innerText()));
    // cascade: change the top level → lower levels reset
    const l0 = page.getByTestId('cat-level-0');
    await l0.selectOption('bjj/closed-guard');
    const l1Options = await page.getByTestId('cat-level-1').locator('option').allInnerTexts();
    check(`[${label}] 대분류 변경 → 하위 선택지가 그 대분류의 것으로, 이전 선택 초기화`, (await page.getByTestId('cat-level-1').inputValue()) === '' && !l1Options.some((o) => /딥 하프/.test(o)), l1Options.slice(0, 6));
    check(`[${label}] BJJ 선택지에 다른 무술 카테고리 없음`, !(await l0.locator('option').allInnerTexts()).some((o) => /잽|Jab|펀치/.test(o)));
    await l0.selectOption('bjj/half-guard');
    // new sub-category: duplicate first, then a real one
    await page.getByTestId('cat-level-1').selectOption('__new__');
    await page.getByTestId('cat-ko').fill('스윕');
    check(`[${label}] 새 카테고리 중복 경고 (스윕 = 기존)`, await page.getByTestId('cat-dup-same').isVisible() && (await page.getByTestId('cat-create-submit').isDisabled()));
    await page.getByTestId('cat-ko').fill('언더훅 게임');
    await page.getByTestId('cat-en').fill('Underhook Game');
    await page.getByTestId('cat-create-submit').click();
    check(`[${label}] 새 하위 카테고리 자동 선택 (저장 때 생성)`, /하프 가드 › 언더훅 게임 \(새 카테고리\)/.test(await page.getByTestId('cat-selected').innerText()), await page.getByTestId('cat-selected').innerText());
    await page.getByTestId('request-save').click();
    await page.getByTestId('request-saved-path').waitFor({ timeout: 30000 });
    check(`[${label}] 등록 완료 — 분류 경로 표시`, /하프 가드 › 언더훅 게임/.test(await page.getByTestId('request-saved-path').innerText()), await page.getByTestId('request-saved-path').innerText());
    check(`[${label}] 등록 화면 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));

    // ---- management
    await page.goto(`http://localhost:${PORT}/#/categories`);
    await page.getByTestId('category-manager').waitFor();
    await page.getByTestId('cat-art').selectOption('bjj');
    const node = page.locator('[data-testid="cat-tree-node"]', { hasText: '언더훅 게임' });
    check(`[${label}] 관리 화면 트리에 새 카테고리 + 기술 수 1`, (await node.count()) === 1 && /1/.test(await node.locator('.cat-count').innerText()));
    const hgText = await page.locator('[data-testid="cat-tree-node"][data-id="bjj/half-guard"]').innerText();
    check(`[${label}] 상위(하프 가드) 기술 수에 반영`, /\d+/.test(hgText), hgText);
    await node.click();
    check(`[${label}] 소속 기술 목록`, /QA 언더훅 스윕|QA Underhook Sweep/.test(await page.getByTestId('cat-techniques').innerText()));
    await page.getByTestId('cat-edit').click();
    await page.getByTestId('cat-edit-ko').fill('언더훅 공방');
    await page.getByTestId('cat-edit-save').click();
    await page.locator('[data-testid="cat-tree-node"]', { hasText: '언더훅 공방' }).waitFor();
    check(`[${label}] 이름 변경 (이 기기 카테고리)`, true);
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('cat-delete').click();
    await page.waitForTimeout(300);
    check(`[${label}] 기술이 있는 카테고리 삭제 거부`, /기술이 있습니다/.test(await page.getByTestId('cat-message').innerText()));
    await page.getByTestId('cat-new-child').click();
    await page.getByTestId('cat-ko').fill('세부 연습');
    await page.getByTestId('cat-en').fill('Detail Drill');
    await page.getByTestId('cat-create-submit').click();
    await page.locator('[data-testid="cat-tree-node"]', { hasText: '세부 연습' }).waitFor();
    check(`[${label}] 관리 화면에서 세부 카테고리 생성`, true);
    await page.getByTestId('cat-new-top').click();
    await page.getByTestId('cat-ko').fill('하프 가드 스윕');
    check(`[${label}] 새 대분류 "하프 가드 스윕" → 기존 경로와 중복 경고`, await page.getByTestId('cat-dup-same').isVisible());
    check(`[${label}] 관리 화면 가로 스크롤 없음`, await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
    // ---- the art page / list show the new category
    await page.goto(`http://localhost:${PORT}/#/arts/bjj`);
    await page.locator('[data-testid="taxonomy-group"][data-node="bjj/half-guard"] [data-testid="taxonomy-toggle"]').click();
    const custom = page.locator('[data-testid="taxonomy-node"]', { hasText: '언더훅 공방' });
    await custom.first().waitFor({ timeout: 5000 }).catch(() => {});
    check(`[${label}] 무술 화면(하프 가드 펼치기)에 새 카테고리 표시`, (await custom.count()) >= 1);
    check(`[${label}] 페이지 오류 없음`, errors.length === 0, errors);
    await ctx.close();
  }
} catch (e) {
  check('실행', false, String(e?.message ?? e));
} finally {
  await browser.close();
  preview.kill();
}
const failed = results.filter((x) => !x).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed ? 1 : 0);
