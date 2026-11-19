// Visualizing Mitt — 종목별 미트 형식 (offline, real technique DB).
// Run: node .devtools/test-mitt-art-drills.mjs
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
globalThis.window = globalThis;
const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k), key: () => null, length: 0 };
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
const A = await server.ssrLoadModule('/src/lib/visualMitt/archetypes.ts');
const D = await server.ssrLoadModule('/src/lib/visualMitt/artDrills.ts');
const R = await server.ssrLoadModule('/src/lib/visualMitt/reaction.ts');
const K = await server.ssrLoadModule('/src/lib/visualMitt/commandDrill.ts');
const S = await server.ssrLoadModule('/src/lib/visualMitt/sharedMitt.ts');
const MS = await server.ssrLoadModule('/src/components/visualMitt/MittStage.tsx');
const ld = await server.ssrLoadModule('/src/lib/loadData.ts');
await server.close();
const React = await import('react');
const RS = await import('react-dom/server');

const results = [];
const check = (n, p, d = '') => (results.push(p), console.log((p ? 'PASS' : 'FAIL') + ' — ' + n + (d !== '' ? ' :: ' + JSON.stringify(d).slice(0, 400) : '')));
const byName = (art, name) => ld.allTechniques.find((t) => t.martialArt === art && t.name === name);
const keyOf = (t) => (t ? A.motionForTechnique(t)?.archetype.key ?? null : 'missing');
const keys = (pool) => new Set(pool.flatMap((c) => c.steps.map((s) => s.motion.archetype.key)));
const limbs = (pool) => new Set(pool.flatMap((c) => c.steps.map((s) => s.motion.archetype.limb)));
const kinds = (pool) => new Set(pool.flatMap((c) => c.steps.map((s) => s.motion.archetype.kind)));
const calls = (pool) => pool.map((c) => K.commandCallout(c));
const opts = (o = {}) => ({ range: 'basic', withKicks: true, withDefense: false, ...o });

// 1. wrestling defenses are drawable
const wr = { Sprawl: 'sprawl', 'Down Block': 'downBlock', Whizzer: 'whizzer', 'Level Change': 'levelFeint' };
const wrong = Object.entries(wr).filter(([n, k]) => keyOf(byName('wrestling', n)) !== k).map(([n, k]) => `${n}: ${keyOf(byName('wrestling', n))} (기대 ${k})`);
check('[레슬링 방어] Sprawl / Down Block / Whizzer / Level Change → 맞는 동작', !wrong.length, wrong);
check('[레슬링 방어] Jump Sprawl 이름 → 점프 스프롤 동작', A.motionForTechnique({ name: 'Jump Sprawl', aliases: [] })?.archetype.key === 'jumpSprawl');
check('[매칭] "Sprawl to Front Headlock" 같은 조합 기록은 한 동작으로 잡지 않음', A.motionForTechnique(byName('wrestling', 'Sprawl to Front Headlock') ?? { name: 'Sprawl to Front Headlock', aliases: [] }) === null);
for (const k of ['sprawl', 'downBlock', 'jumpSprawl', 'whizzer']) {
  const a = A.ARCHETYPES[k];
  const html = RS.renderToStaticMarkup(React.createElement(MS.FrontView, { archetype: a, target: a.target, stance: 'orthodox', p: 1, back: 0 }));
  check(`[그림] ${a.label}: 상대가 슛 → 내 대응 결과 표시`, /data-path="shot"/.test(html) && /data-hit="true"/.test(html) && /mitt-defense-result/.test(html) && html.includes(a.label), html.slice(0, 160));
}
const mid = RS.renderToStaticMarkup(React.createElement(MS.FrontView, { archetype: A.ARCHETYPES.sprawl, target: 'hips', stance: 'southpaw', p: 0.4, back: 0 }));
check('[그림] 슛 진행 중에는 아직 결과 없음 (사우스포 렌더 OK)', !/mitt-defense-result/.test(mid) && /data-hit="false"/.test(mid));

// 2. profiles by art
const P = (a) => D.drillProfile(a);
check('[종목] 전체("") = 입식 타격, 복싱/킥복싱/무에타이/MMA/레슬링 각각 전용', P('').id === 'striking' && P('boxing').id === 'boxing' && P('kickboxing').id === 'kickboxing' && P('muay-thai').id === 'muay-thai' && P('mixed-martial-arts').id === 'mma' && P('wrestling').id === 'wrestling');
check('[종목] 그 외 무술(태권도)은 그 무술 기술로 만든 프로필', P('taekwondo').id === 'art' && P('taekwondo').art === 'taekwondo');

// 3. 공격 지시 pools
const box = K.commandPool('mixed', { profile: P('boxing'), ...opts() });
check('[복싱] 펀치만 (킥·니·태클 없음)', box.length > 5 && [...limbs(box)].every((l) => l === 'hand'), [...keys(box)]);
const boxD = K.commandPool('mixed', { profile: P('boxing'), ...opts({ withDefense: true }) });
check('[복싱] 방어 포함 → 슬립·롤·패리 등 복싱 방어, 킥 방어(체크) 없음', keys(boxD).has('slip') && keys(boxD).has('roll') && !keys(boxD).has('check') && !keys(boxD).has('sprawl'), [...keys(boxD)]);
const mt = K.commandPool('single', { profile: P('muay-thai'), ...opts() });
check('[무에타이] 단타에 니킥·엘보 포함', keys(mt).has('rearKnee') && keys(mt).has('hElbow'), [...keys(mt)]);
const mma = K.commandPool('mixed', { profile: P('mixed-martial-arts'), ...opts({ withDefense: true }) });
check('[MMA] 타격 + 테이크다운 진입 + 스프롤/다운블락', keys(mma).has('jab') && keys(mma).has('doubleLeg') && keys(mma).has('sprawl') && keys(mma).has('downBlock'), [...keys(mma)]);
const wres = K.commandPool('single', { profile: P('wrestling'), ...opts({ withDefense: true }) });
const wc = calls(wres);
check('[레슬링] 타격 없이 레슬링 동작만', ![...kinds(wres)].includes('strike'), [...keys(wres)]);
// Jump Sprawl is not an official DB record — it comes from the shared technique library (published by the operator account), synced in the app only.
const hasJump = ld.allTechniques.some((x) => A.motionForTechnique(x)?.archetype.key === 'jumpSprawl');
check(`[레슬링] 태클·스프롤·다운블락·위저${hasJump ? '·점프 스프롤' : ''} 지시`, ['태클', '스프롤', '다운블락', '위저', ...(hasJump ? ['점프 스프롤'] : [])].every((w) => wc.includes(w)), wc);
const libJump = { id: 'lib__jump-sprawl', name: 'Jump Sprawl', aliases: [], martialArt: 'wrestling', martialArts: ['wrestling'], category: 'defense' };
check('[레슬링] 공유 라이브러리에 Jump Sprawl 기록이 있으면 "점프 스프롤" 지시로 쓰임', D.techniqueForPick('jumpSprawl', P('wrestling'), [libJump])?.id === 'lib__jump-sprawl');
check('[레슬링] 레벨 체인지·스냅 다운·하이 크로치·싱글렉', ['레벨 체인지', '스냅 다운', '하이 크로치', '싱글렉'].every((w) => wc.includes(w)), wc);
check('[레슬링] 지시는 실제 레슬링 기록 (태클 = Penetration Step)', wres.find((c) => K.commandCallout(c) === '태클')?.steps[0].technique.name === 'Penetration Step');
const st = K.commandPool('single', { profile: P(''), ...opts({ withKicks: false }) });
check('[입식] 킥 끄면 펀치만', [...limbs(st)].every((l) => l === 'hand'));

// 4. wider technique range
for (const a of ['', 'boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts', 'wrestling']) {
  const b = K.commandPool('single', { profile: P(a), ...opts({ withDefense: true }) });
  const w = K.commandPool('single', { profile: P(a), ...opts({ withDefense: true, range: 'wide' }) });
  check(`[범위] ${a || '입식'}: 확장 기술이 기본보다 많음 (${b.length} → ${w.length})`, w.length > b.length + 3);
}
const wideMma = K.commandPool('single', { profile: P('mixed-martial-arts'), ...opts({ range: 'wide' }) });
check('[범위] MMA 확장: 슈퍼맨·스피닝 백피스트·플라잉 니·바디락 등', ['superman', 'spinBackfist', 'flyingKnee', 'bodyLock'].every((k) => keys(wideMma).has(k)), [...keys(wideMma)]);
const allCalls = ['', 'boxing', 'kickboxing', 'muay-thai', 'mixed-martial-arts', 'wrestling'].flatMap((a) => calls(K.commandPool('mixed', { profile: P(a), ...opts({ withDefense: true, range: 'wide' }) })));
const english = allCalls.filter((c) => /[A-Za-z]/.test(c));
check('[콜] 모든 지시가 한국어 구호 (영어 기술명 그대로 읽지 않음)', !english.length, [...new Set(english)].slice(0, 20));

// 5. reaction pools
const rBox = R.reactionPoolFor(P('boxing'), opts());
check('[반응/복싱] 펀치 콤보만', rBox.length > 3 && rBox.every((c) => c.steps.every((s) => s.motion.archetype.limb === 'hand')));
const rW = R.reactionPoolFor(P('wrestling'), opts({ withDefense: true }));
check('[반응/레슬링] 코치 슛 → 스프롤 같은 단일 반응 포함', rW.some((c) => c.steps.length === 1 && c.steps[0].motion.archetype.key === 'sprawl') && rW.every((c) => c.steps.every((s) => s.motion.archetype.kind !== 'strike')));
const rM = R.reactionPoolFor(P('mixed-martial-arts'), opts());
check('[반응/MMA] 기본 풀이 비어 있지 않음', rM.length > 3, rM.length);
check('[반응] 기존 기본 풀(reactionPool) 유지', R.reactionPool().length > 3);

// 6. shared combos → mitt
const t = (art, n) => byName(art, n);
const fake = (steps) => ({ id: 'x1', authorId: 'a', authorNickname: 'MARTIALDEX', kind: 'combo', name: 'test', purpose: '', purposeTags: [], description: '', martialArt: 'mixed-martial-arts', steps, techniqueIds: steps.map((s) => s.techniqueId), sourceRef: null, likeCount: 0, createdAt: '', updatedAt: '' });
const any = (n) => ld.allTechniques.find((x) => x.name === n);
const j = any('Jab'), c = any('Cross'), dl = t('wrestling', 'Basic Double Leg');
const ok = S.sharedToMitt(fake([j, c, dl].map((x) => ({ techniqueId: x.id, name: x.name, martialArt: x.martialArt }))));
check('[공유] 모든 단계가 그릴 수 있는 공유 콤보 → 미트 콤보', ok?.steps.length === 3 && ok.id === 'shared:x1', ok?.steps.map((s) => s.technique.name));
const bad = S.sharedToMitt(fake([{ techniqueId: j.id, name: 'Jab', martialArt: 'boxing' }, { techniqueId: 'nope', name: '???', martialArt: null }]));
check('[공유] 없는/그릴 수 없는 단계가 있으면 그대로 재생하지 않음', bad === null);
const mmaWithShared = K.commandPool('combo', { profile: P('mixed-martial-arts'), ...opts(), extra: [ok] });
check('[공유] MMA 콤보 지시 풀에 공유 콤보 포함', mmaWithShared.some((x) => x.id === 'shared:x1'));
const boxWithShared = K.commandPool('combo', { profile: P('boxing'), ...opts(), extra: [ok] });
check('[공유] 복싱 풀에는 태클이 든 공유 콤보가 들어가지 않음', !boxWithShared.some((x) => x.id === 'shared:x1'));

const passed = results.filter(Boolean).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
