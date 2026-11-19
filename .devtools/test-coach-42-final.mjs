// AI 코치 42개 문제 — 최종 통합 테스트 (대화 경로 1–24, 31–42).
// 실제 runCoachTurn 을 오프라인 deps 로 돌린다: 검색·모델·소셜·선수 분석은 호출을 기록하는 가짜로 바꾸고,
// 기술 DB · 지식 인덱스 · 의도 분류 · 실행 경로 · 수업 저장소는 실제 코드를 쓴다.
// LLM 문장을 비교하지 않는다 — 어느 경로가 실행됐는지(검색·모델 호출 여부, 액션, 3D, 수업 제안,
// 수업 상태)와 코드가 쓴 구조화 결과를 본다. J25–30(3D 자세 측정)은 Electron QA 스크립트가 따로 검증한다.
//   node .devtools/test-coach-42-final.mjs
import { build } from 'esbuild';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { viteGlobPlugin } from './lib/viteGlobPlugin.mjs';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c42-'));
const out = path.join(dir, 'r.mjs'); const entry = path.join(dir, 'e.ts');
const mod = (p) => JSON.stringify(path.join(APP, p));
fs.writeFileSync(entry, [
  `export * as A from ${mod('src/lib/selfAi/coachAgent.ts')};`,
  `export * as I from ${mod('src/lib/selfAi/intents.ts')};`,
  `export * as K from ${mod('src/lib/martialdexKnowledge/index.ts')};`,
  `export * as CT from ${mod('src/lib/selfAi/combatTerms.ts')};`,
  `export * as ST from ${mod('src/lib/selfAi/skillTurn.ts')};`,
  `export * as TA from ${mod('src/lib/selfAi/tactics.ts')};`,
  `export * as CL from ${mod('src/lib/selfAi/chatLesson.ts')};`,
  `export * as SS from ${mod('src/lib/aiCoachDay/sessionStore.ts')};`,
  `export * as LD from ${mod('src/lib/loadData.ts')};`,
  `export * as LS from ${mod('src/lib/selfAi/lessonSession.ts')};`,
].join('\n'));
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'node', outfile: out, logLevel: 'error', define: { 'import.meta.env': '{}' }, plugins: [viteGlobPlugin] });
globalThis.localStorage ??= { _d: new Map(), getItem(k) { return this._d.get(k) ?? null; }, setItem(k, v) { this._d.set(k, String(v)); }, removeItem(k) { this._d.delete(k); }, clear() { this._d.clear(); }, key() { return null; }, get length() { return this._d.size; } };
globalThis.window ??= { addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; }, setTimeout: () => 0, clearTimeout() {}, localStorage: globalThis.localStorage };
globalThis.CustomEvent ??= class { constructor(t, o) { this.type = t; this.detail = o?.detail; } };
const { A, I, K, CT, ST, TA, CL, SS, LD, LS } = await import(pathToFileURL(out).href);
const index = K.buildKnowledgeIndex({});

const results = [];
let pass = 0, fail = 0;
const check = (id, name, ok, detail) => { results.push({ id, name, ok }); if (ok) { pass++; console.log(`  PASS  [${id}] ${name}`); } else { fail++; console.log(`  FAIL  [${id}] ${name} :: ${JSON.stringify(detail)?.slice(0, 260)}`); } };

const page = (title, url, content) => ({ title, url, content, snippet: content.slice(0, 120), source: new URL(url).hostname, engines: ['test'], relevance: 1, sourceType: 'article', sourceTypeLabel: '기사', reliability: { level: 'medium', label: '보통', reasons: [] }, extraction: { status: 'ok' } });
let log;
const reset = () => { log = { research: [], chat: [], social: [], fighter: [] }; };
const okOutcome = (results) => ({ ok: true, kind: 'web', results, diagnostics: { failedEngines: [], engines: ['test'], rawCount: results.length, duplicatesRemoved: 0, irrelevantRemoved: 0 } });
const baseDeps = (over = {}) => ({
  research: async (req) => { log.research.push(req); return okOutcome([]); },
  chat: async (req) => { log.chat.push(req); return { ok: true, text: '제 판단으로는 먼저 기본기를 점검해 보시면 좋겠습니다.', model: 'fake-local', evalCount: 1, ms: 1 }; },
  knowledgeIndex: async () => index,
  learnerContext: () => '',
  socialTrending: async (p) => { log.social.push(p); return { ok: true, items: [] }; },
  learner: () => [],
  bodyProfile: () => ({ heightCm: 178, reachCm: 180, weightKg: 72, stance: 'orthodox' }),
  activeLesson: () => null,
  activeLessonTechniqueIds: () => null,
  ...over,
});
const turn = async (text, history = [], over = {}, extra = {}) => {
  reset();
  const o = await A.runCoachTurn({ text, history, martialArt: null, requestId: `t${Date.now()}`, ...extra }, baseDeps(over));
  return o;
};
const asHistory = (pairs) => pairs.flatMap(([q, o], i) => [{ id: `u${i}`, role: 'user', text: q, createdAt: '' }, { id: `a${i}`, createdAt: '', ...o.message }]);
const intents = (o) => o.message.turn?.intents ?? [];

console.log('\n[A] 셋업 및 기술 검색');
let o1 = await turn('더블렉 셋업 알려줘.');
check(1, '더블렉 → 레슬링 Basic Double Leg 기록 조회 + 셋업 웹 조사', o1.message.techniqueIds?.includes('wrestling__basic-double-leg') && log.research.length >= 1, o1.message.techniqueIds);
check(1, '기록 항목에 셋업/콤보 종류를 구분해 표시', /\[(셋업|콤보)\]/.test(o1.message.text));

const o2 = await turn('MMA에서 싱글렉 셋업 알려줘.');
check(2, 'MMA 싱글렉: 대표 기록의 종목(삼보)과 레슬링 싱글 레그 계열을 구분해 밝힘', /sambo/.test(o2.message.text) && /싱글 레그」 계열/.test(o2.message.text), o2.message.text.slice(0, 200));
check(2, 'MMA 실전 조사 의도 포함', intents(o2).includes('MMA_STRATEGY_RESEARCH'));

const o3 = await turn('내가 학습하지 않은 기술 중 하체 태클 알려줘.');
check(3, '의도 = UNLEARNED_TECHNIQUE_SEARCH', intents(o3)[0] === 'UNLEARNED_TECHNIQUE_SEARCH', intents(o3));
check(3, '웹 검색·모델 호출 없음 (기술 DB × 학습 기록)', log.research.length === 0 && log.chat.length === 0);
check(3, '하체 태클만 나열 (싱글·더블 레그 계열 + 다른 종목의 다리 잡기, 방어/포지션/가드 제외)', /싱글 레그/.test(o3.message.text) && /더블 레그/.test(o3.message.text) && /Knee Tap/.test(o3.message.text) && !/Defense/.test(o3.message.text) && !/Position/.test(o3.message.text) && !/Single Leg X/.test(o3.message.text), o3.message.text.slice(0, 300));
const legIds = LD.allTechniques.filter((t) => ST.topicFilterOf('하체 태클').test(t)).map((t) => t.name);
check(3, '분류 정확성: Ankle Pick 포함, 스프롤·가드 진입·방어 미포함', legIds.includes('Ankle Pick') && !legIds.some((n) => /sprawl|defense|single leg x|position/i.test(n)), legIds.filter((n) => /sprawl|defense|x$|position/i.test(n)));
check(3, '기록이 없다고 "미학습 기술 없음"이라 하지 않음', /모두 미학습으로 표시/.test(o3.message.text));

const o4 = await turn('투를 맞추기 위한 셋업 알려줘.');
check(4, "'투' → 크로스(복싱 번호 2) — 가라테 마와시즈키 오해석 수정", o4.message.techniqueIds?.includes('kickboxing__cross') && !o4.message.techniqueIds?.includes('karate__mawashi-zuki'), o4.message.techniqueIds);
check(4, '해석을 사용자에게 밝힘', /크로스\(뒷손 스트레이트\)로 이해/.test(o4.message.text));

const o5 = await turn('이거 말고 다른 셋업 알려줘.', asHistory([['투를 맞추기 위한 셋업 알려줘.', o4]]));
check(5, '의도 = TOPIC_CONTINUATION (직전 주제 유지)', intents(o5)[0] === 'TOPIC_CONTINUATION', intents(o5));
check(5, '직전 주제(크로스)를 이어 감', o5.message.turn?.topicKey === 'tech:kickboxing__cross', o5.message.turn);
const shownBefore = o4.message.text.split('\n').filter((l) => /^- \[(셋업|콤보)\]/.test(l.trim()));
check(5, '이전 답변의 셋업·콤보 항목을 반복하지 않음', shownBefore.every((l) => !o5.message.text.split('\n').some((x) => x.trim() === l.trim())), shownBefore.slice(0, 2));

const o6 = await turn('내가 만든 원투 이후 더블렉 셋업 평가해줘.');
check(6, '의도 = COMBO_EVALUATION (자세 측정으로 가지 않음)', intents(o6)[0] === 'COMBO_EVALUATION' && !/자세 측정/.test(o6.message.text.slice(0, 80)), intents(o6));
check(6, '순서 = 잽 → 크로스 → 더블 레그', /잽\(Jab\) → Cross → Basic Double Leg/.test(o6.message.text), o6.message.text.slice(0, 160));
check(6, '셋업 판정: 노리는 상대 반응을 설명 (레벨 체인지)', /셋업으로 볼 수 있습니다/.test(o6.message.text) && /레벨 체인지/.test(o6.message.text));
check(6, '성공 조건·위험·개선점·규칙 적합성 섹션', ['성공 조건', '상대의 대응', '개선점', '종목·규칙 적합성'].every((x) => o6.message.text.includes(x)));
check(6, '기록(사실)·앱의 판단·AI 해석을 구분 표시', /MARTIALDEX 기록 \(사실\)/.test(o6.message.text) && /앱의 판단/.test(o6.message.text) && /AI 해석/.test(o6.message.text));
check(6, '웹 검색 없음', log.research.length === 0);
const plain = TA.evaluateSequence([LD.allTechniques.find((t) => t.id === 'kickboxing__cross'), LD.allTechniques.find((t) => t.id === 'kickboxing__lead-hook')].filter(Boolean), index);
check(6, '반응이 정해지지 않은 타격 연결은 셋업으로 부르지 않음', plain.isSetup === false, plain.rule?.logic);

const o7 = await turn('슬립 어퍼를 자주 쓰는 상대에 대한 대처법 알려줘.');
check(7, '의도 = COUNTER_STRATEGY', intents(o7)[0] === 'COUNTER_STRATEGY', intents(o7));
check(7, '슬립 어퍼를 하나의 패턴(슬립 → 어퍼컷)으로 이해', /슬립 → 어퍼컷로 이어지는 하나의 공격 패턴/.test(o7.message.text));
check(7, '선택지마다 장점·단점', (o7.message.text.match(/장점:/g) ?? []).length >= 3 && (o7.message.text.match(/단점:/g) ?? []).length >= 3);
check(7, '프로필(스탠스)과 연결', /오소독스/.test(o7.message.text));

const o8 = await turn('허리후리기를 시도하는데 상대 중심이 뒤로 빠질 때 상황을 분석해줘.');
check(8, '허리후리기 = 유도 하라이고시로 해석', o8.message.techniqueIds?.includes('judo__harai-goshi'), o8.message.techniqueIds);
check(8, '의도 = OPPONENT_PATTERN_ANALYSIS, 뒤로 던지는 기술(오우치·오소토) 연결 선택지', intents(o8)[0] === 'OPPONENT_PATTERN_ANALYSIS' && o8.message.techniqueIds?.includes('judo__ouchi-gari'), intents(o8));

console.log('\n[B] 대화 기억');
const h9 = asHistory([['더블렉 셋업 알려줘.', o1], ['잽 다음에 뭐 치면 좋아?', await turn('잽 다음에 뭐 치면 좋아?')]]);
const o9 = await turn('아까 내가 처음에 무슨 셋업을 물어봤지?', h9);
check(9, '대화 기록으로 답함 (검색·모델 없음)', intents(o9)[0] === 'CONVERSATION_RECALL' && log.research.length === 0 && log.chat.length === 0);
check(9, '처음 물은 것 = 더블렉', /처음 물어보신 것은 「Basic Double Leg」/.test(o9.message.text), o9.message.text.slice(0, 100));
const o10 = await turn('아까 말한 더블렉 셋업 기억해?', h9);
check(10, '그 주제에 대해 물은 말과 답변 요지를 꺼냄', /네, 기억합니다/.test(o10.message.text) && /더블렉 셋업 알려줘/.test(o10.message.text) && /답변 요지/.test(o10.message.text));
check(10, '검색 없음', log.research.length === 0);
const o11 = await turn('방금 찾은 내용을 수업에 추가해줘.', h9);
check(11, '진행 중인 수업이 없으면 새 수업을 제안하고 그렇다고 밝힘', intents(o11)[0] === 'LESSON_CONTINUATION' && !!o11.message.lessonProposal && /진행 중인 수업이 없어/.test(o11.message.text));
const o11b = await turn('방금 찾은 내용을 수업에 추가해줘.', h9, { activeLesson: () => ({ title: '킥복싱 기초', route: '/learning/x', current: 'Cross', stepLabel: '설명' }), activeLessonTechniqueIds: () => ['kickboxing__cross'] });
check(11, '진행 중인 수업이 있으면 그 수업에 추가 제안 (동의 후 추가)', !!o11b.message.lessonAdd && o11b.message.lessonAdd.status === 'pending' && o11b.message.lessonAdd.techniqueIds.includes('kickboxing__jab'), o11b.message.lessonAdd);

console.log('\n[C] 개인 파이터 프로필');
const o12 = await turn('내 스타일과 비슷한 선수 찾아줘.', [], { styleProfile: () => ({ traits: [], confirmed: 0, physical: [], styleTraits: [], empty: true, stance: null }) });
check(12, '프로필 기준이 없으면 추측하지 않고 그렇다고 답함 (빈 답 아님)', intents(o12)[0] === 'FIGHTER_COMPARISON' && o12.message.text.length > 40 && !/\d+\s*%/.test(o12.message.text), o12.message.text.slice(0, 150));
const o12n = await turn('내 스타일과 비슷한 선수 찾아줘.', [], { styleProfile: undefined });
check(12, '프로필을 못 읽으면 명시 (빈 답 아님)', /프로필을 불러오지 못해/.test(o12n.message.text), o12n.message.text.slice(0, 150));
const o13 = await turn('내 스타일이 얼마나 희귀해?', [], { styleProfile: undefined });
check(13, '희귀성: 근거 없는 퍼센트 없음', intents(o13)[0] === 'STYLE_RARITY' && !/\d+\s*%/.test(o13.message.text));
const o14 = await turn('내 리치는 체급 내에서 긴 편이야?');
check(14, '의도 = PHYSICAL_ATTRIBUTE_COMPARISON', intents(o14)[0] === 'PHYSICAL_ATTRIBUTE_COMPARISON', intents(o14));
check(14, '체급 없으면 묻고, 체중으로 추정하지 않으며, 검색·순위 없음', /체급을 알 수 없어/.test(o14.message.text) && /체중으로 추정하지 않습니다/.test(o14.message.text) && log.research.length === 0);
const o15 = await turn('내 키와 리치를 체급 내에서 비교해줘.');
check(15, '절대값과 키 대비 비율(계산)을 구분', /내 신체 값 \(측정값\)/.test(o15.message.text) && /키 대비 리치 \(계산값\)/.test(o15.message.text) && /1\.011/.test(o15.message.text));
const o16 = await turn('내 리치 175cm는 얼마나 드문 편이야?');
check(16, '지금 말한 175cm를 프로필(180cm)보다 우선', /리치: 175cm \(지금 말씀하신 값\)/.test(o16.message.text) && /프로필에는 180cm/.test(o16.message.text));
check(16, '스타일 희귀성으로 오분류하지 않음', intents(o16)[0] === 'PHYSICAL_ATTRIBUTE_COMPARISON');
const o14b = await turn('나는 라이트급이야. 내 리치는 체급 내에서 긴 편이야?', [], { research: async (req) => { log.research.push(req); return okOutcome([page('UFC lightweight reach', 'https://stats.example.com/lw', 'The average reach of UFC lightweight fighters in our sample of 120 athletes is 182 cm. Other text.')]); } });
check(14, '체급이 있으면 표본 자료를 찾아 원문 그대로 인용 (백분위 계산 안 함)', log.research.length === 1 && /182 cm/.test(o14b.message.text) && /백분위나 순위를 계산하지 않았습니다/.test(o14b.message.text), o14b.message.text.slice(-300));

console.log('\n[D] 통증 · 정서');
const o17 = await turn('스피닝 백 피스트를 쳤는데 암바 걸린 것처럼 팔이 아파.');
check(17, '통증 경로: 검색·모델 없음, 중단·의료진 안내, 원인 단정 안 함', intents(o17)[0] === 'INJURY_OR_PAIN_QUESTION' && log.research.length === 0 && log.chat.length === 0 && /멈추고/.test(o17.message.text) && /의료진/.test(o17.message.text) && /단정하지 않/.test(o17.message.text));
const o18 = await turn('내가 격투기에 재능이 없는 것 같아서 힘들어.');
check(18, '정서 경로: 공감 우선 규칙·추측 금지, 검색 없음', intents(o18)[0] === 'EMOTIONAL_SUPPORT' && log.research.length === 0 && /공감/.test(log.chat[0]?.messages[0].content ?? '') && /추측하지 않는다/.test(log.chat[0]?.messages[0].content ?? ''));

console.log('\n[E] 선수 분석');
const fighterReport = { fighter: 'Ilia Topuria', martialArt: 'mixed-martial-arts', items: [{ kind: 'combo', text: 'jab cross lead hook', steps: ['Jab', 'Cross', 'Lead Hook'], support: 'source_analysis', quotes: [{ site: 'ex.com', quote: 'Topuria often throws the jab cross into a left hook.', url: 'https://ex.com/a', verified: true }], techniqueIds: ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__lead-hook'], frequencyStated: true }], videos: [], candidates: [], limits: [], webResults: [page('Topuria breakdown', 'https://ex.com/a', 'Topuria often throws the jab cross into a left hook.')], videoResults: [], sources: [{ title: 'Topuria breakdown', url: 'https://ex.com/a', sourceTypeLabel: '기사', reliabilityLabel: '보통', contentRead: true, used: true, relevance: 1, why: ['quoted'] }], searched: true, pagesRead: 1, searchLog: { rounds: [] } };
const fdeps = { fighterStyle: async (f) => { log.fighter.push(f); return fighterReport; }, resolveName: async () => ({ ok: true, en: 'Ilia Topuria' }) };
const o19 = await turn('토푸리아가 자주 쓰는 콤보 알려줘.', [], fdeps);
check(19, '선수 식별 → 근거 기반 선수 분석 경로 (자유 생성 아님)', log.fighter[0] === 'Ilia Topuria' && intents(o19)[0] === 'FIGHTER_TECHNIQUE_ANALYSIS' && log.chat.length === 0, intents(o19));
check(19, '원문 인용과 출처 사용 여부 표시', /Topuria often throws/.test(o19.message.text) && o19.message.sources?.[0]?.used === true);
const o19b = await turn('일리아 토푸리아가 자주 사용하는 콤보를 찾아서 수업으로 만들어줘.', [], fdeps);
check(19, '멀티 인텐트: 선수 분석 + 수업 생성 (분석에서 확인된 기술만)', !!o19b.message.lessonProposal && o19b.message.lessonProposal.techniqueIds.every((id) => ['kickboxing__jab', 'kickboxing__cross', 'kickboxing__lead-hook'].includes(id)) && o19b.message.lessonProposal.sourceUrls.includes('https://ex.com/a'), o19b.message.lessonProposal);
const o20 = await turn('내 스타일과 가장 비슷한 선수를 찾아줘.', [], { styleProfile: undefined });
check(20, '근거 없는 유사도 수치 없음', !/유사도\s*\d+|\d+\s*%/.test(o20.message.text));

console.log('\n[F] 장비 추천');
const o21 = await turn('처음 사용하는 마우스피스와 신가드 추천해줘.', [], { research: async (req) => { log.research.push(req); return okOutcome(/mouthguard|마우스피스/i.test(req.query) ? [page('Best mouthguards 2026', 'https://gear.example.com/m', 'For beginners the SISU Aero and the Shock Doctor Gel Max are popular. SISU Aero costs about $25.')] : []); } });
check(21, '의도 = PRODUCT_RECOMMENDATION, 제품군별 검색', intents(o21)[0] === 'PRODUCT_RECOMMENDATION' && log.research.length === 2);
check(21, '자료에 실제로 나온 제품만 (SISU Aero, Shock Doctor Gel Max) + 자료 번호', /SISU Aero \[1\]/.test(o21.message.text) && /Shock Doctor Gel Max/.test(o21.message.text), o21.message.text.slice(0, 600));
check(21, '자료가 없는 제품군(신가드)은 제품명을 만들지 않음', /신가드[\s\S]*제품명은 적지 않았습니다|신가드[\s\S]*제품은 추천하지 않았습니다/.test(o21.message.text));
check(21, '가격·구매 가능 여부를 확인된 것처럼 말하지 않음', /현재 가격 아님/.test(o21.message.text) && /구매 가능 여부와 현재 가격은 확인하지 않았습니다/.test(o21.message.text));

console.log('\n[G] 상대 패턴');
const o22 = await turn('상대방의 페인트에 너무 예민하게 반응하는 것 같아.');
check(22, 'feint 문맥 이해, 정서 상담으로 오분류하지 않음', intents(o22)[0] === 'OPPONENT_PATTERN_ANALYSIS' && /feint/.test(o22.message.text) && /페인트에 너무 크게 반응하는 상황/.test(o22.message.text), intents(o22));

console.log('\n[H] 소셜');
const o23 = await turn('이번 주 하트 가장 많은 콤보, 셋업, 게시물 알려줘.');
check(23, '내부 소셜 집계(이번 주), 웹 검색 없음', intents(o23)[0] === 'SOCIAL_TRENDING' && log.social[0] === 'week' && log.research.length === 0);

console.log('\n[I] 앱 기능');
const o24 = await turn('JAB의 3D 프리뷰 화면 띄워줘.');
check(24, '의도 = TECHNIQUE_3D_PREVIEW, 모델·검색 없음', intents(o24)[0] === 'TECHNIQUE_3D_PREVIEW' && log.chat.length === 0 && log.research.length === 0);
check(24, '잽 3D 시연을 열린 상태로 첨부 (실제 클립)', o24.message.preview?.open === true && o24.message.preview.items[0].techniqueId === 'kickboxing__jab' && !!o24.message.preview.items[0].clipId);
const oNo3d = await turn('암바 3D 시연 보여줘');
check(24, '3D가 없는 기술은 다른 애니메이션으로 대신하지 않음', oNo3d.message.preview?.open !== true && /3D 시연이 없어 열지 않았습니다/.test(oNo3d.message.text), oNo3d.message.text.slice(0, 120));
const oArt = await turn('암바 3D 시연 보여줘', [], {}, { martialArt: 'kickboxing' });
check(24, '대화 종목(킥복싱)에 없는 기술(암바)도 찾아서 답함 (UI 테스트에서 발견한 결함)', oArt.message.techniqueIds?.some((id) => /armbar|arm-bar|juji/i.test(id)) && /3D 시연이 없어/.test(oArt.message.text), oArt.message.text.slice(0, 120));
const oApp = await turn('잽 기술 상세 화면 열어줘');
check(24, '앱 액션: 기술 상세 화면 이동 (autoRun)', intents(oApp)[0] === 'APP_ACTION' && oApp.message.action?.autoRun === true && oApp.message.action.to === '/arts/kickboxing/techniques/kickboxing__jab');

console.log('\n[K] 수업 연동');
const setupPage = page('MMA single leg setups', 'https://mma.example.com/single', 'A common single leg setup in MMA is the jab to single leg: throw the jab and change levels to the single leg.');
const r31 = { research: async (req) => { log.research.push(req); return okOutcome([setupPage]); } };
const o31 = await turn('MMA에서 싱글렉 셋업 알려줘.', [], r31);
check(31, '싱글렉 셋업 조사 (검색 실행)', log.research.length >= 1 && (o31.message.sources ?? []).some((s) => s.url === setupPage.url));
const h31 = asHistory([['MMA에서 싱글렉 셋업 알려줘.', o31]]);
const o31b = await turn('이걸로 수업 만들어줘.', h31, r31);
check(31, '대화 주제로 수업 제안', !!o31b.message.lessonProposal);
const lp = o31b.message.lessonProposal;
check(32, '수업 제안에 이전 검색 자료 URL 포함', lp?.sourceUrls.includes(setupPage.url), lp?.sourceUrls);
const merged = CL.lessonSourcesFor(lp, o31b.message, h31);
const cur = CL.buildLessonCurriculum(lp, index, merged, 'conv-1');
check(32, '만든 수업에 이전 검색 자료가 기록됨 (chatLessonMeta.sources)', cur?.chatLessonMeta?.sources.some((s) => s.url === setupPage.url), cur?.chatLessonMeta?.sources);

// 수업 진행 상태 (실제 sessionStore)
const ids = cur.days[0].techniqueIds;
SS.startCoachDayRun(cur.id, 1, 'text', ids);
SS.updateCoachDayRun((r) => ({ ...r, index: 0, step: 'practice' }));
const before = SS.getCoachDayRun();
const lesson = LS.lessonSnapshot(before, { topic: lp.topic, art: cur.martialArt });
const o33 = await turn('이 기술 막히면 어떻게 해?', [], r31, { lesson, inLesson: true });
const mid = SS.getCoachDayRun();
check(33, '수업 중 질문에 답해도 수업 상태 그대로 (id·단계·위치)', mid.id === before.id && mid.step === before.step && mid.index === before.index && JSON.stringify(mid.techniqueIds) === JSON.stringify(before.techniqueIds));
const o34 = await turn('더블 레그도 같이 배우고 싶어', [], r31, { lesson, inLesson: true });
check(34, '수업 중 새 기술 → 이 수업에 추가 제안 (동의 전에는 바꾸지 않음)', !!o34.message.lessonAdd && JSON.stringify(SS.getCoachDayRun().techniqueIds) === JSON.stringify(before.techniqueIds), o34.message.text.slice(0, 160));
const acc = o34.message.lessonAdd ? CL.acceptLessonAddition(o34.message.lessonAdd) : { added: [] };
const after = SS.getCoachDayRun();
check(34, '동의하면 수업 끝에 추가', acc.added.length > 0 && after.techniqueIds.length > before.techniqueIds.length, acc.message);
check(35, '추가 후에도 수업 id·진행 단계·위치·기존 기술 순서 유지', after.id === before.id && after.step === before.step && after.index === before.index && before.techniqueIds.every((id, i) => after.techniqueIds[i] === id));
SS.clearCoachDayRun();

console.log('\n[L] 추가 통합');
const o36 = await turn('플라잉 니 영상 찾아줘.', [], { research: async (req) => { log.research.push(req); return { ok: true, kind: 'video', results: [], diagnostics: { failedEngines: [], engines: ['t'], rawCount: 5, irrelevantRemoved: 5, removedTitles: ['Flying to Bali vlog'], duplicatesRemoved: 0 } }; } });
check(36, '검색 결과가 모두 무관하면 0건이라고 밝히고 무관한 자료를 쓰지 않음', /모두 제외했습니다/.test(o36.message.text) && /관련 자료로 볼 수 있는 결과는 0건/.test(o36.message.text) && !(o36.message.sources ?? []).length);
const conflict = page('Double leg myths', 'https://web.example.com/dl', 'The double leg takedown is not allowed in MMA and is only a judo throw.');
const o37 = await turn('MMA 더블렉 셋업 자료 찾아줘', [], { research: async (req) => { log.research.push(req); return okOutcome([conflict]); } });
check(37, '내부 DB와 외부 자료를 구분해 표시 (외부 자료를 DB 사실로 섞지 않음)', /MARTIALDEX/.test(o37.message.text) && (o37.message.sources ?? []).length === 1 && !/Double leg myths/.test(o37.message.text.split('■').find((s) => /MARTIALDEX (내부 )?기록/.test(s)) ?? ''), o37.message.text.slice(0, 200));
const o38 = await turn('내 체급이 뭐였지?');
check(38, '프로필에 없는 정보: 저장된 값 없음 + 체중으로 추정 안 함 (모델 호출 없음)', intents(o38)[0] === 'PERSONAL_CONTEXT_QUERY' && /알 수 없습니다/.test(o38.message.text) && /추정하지 않습니다/.test(o38.message.text) && log.chat.length === 0, o38.message.text);
const o39 = await turn('내가 배우지 않은 그래플링 기술 알려줘.');
check(39, '학습 기록이 없는 사용자: 미학습 목록을 실제로 보여 줌', intents(o39)[0] === 'UNLEARNED_TECHNIQUE_SEARCH' && /미학습 \d{2,}개/.test(o39.message.text) && /모두 미학습으로 표시/.test(o39.message.text));
const learnedJab = LD.allTechniques.find((t) => t.id === 'wrestling__high-single');
const o39b = await turn('내가 학습하지 않은 기술 중 하체 태클 알려줘.', [], { learner: () => [{ technique: learnedJab, state: 'learned', states: ['learned'], proficiency: 80, proficiencyChange14d: null, pose: null, lessonDays: 2, practiceDays: 1, lastStudiedAt: '2026-11-10', nextReviewAt: null, evidence: ['AI 코치 수업 2일'] }] });
check(39, '학습 기록이 있으면 그 기술은 미학습에서 빠지고 따로 표시', /학습 기록 있음 1개/.test(o39b.message.text) && /이미 학습 기록이 있어 뺀 기술: High Single/.test(o39b.message.text));
check(40, '"이거 말고"는 이전 답변과 중복되는 항목을 제거 (5번과 같은 경로)', results.filter((r) => r.id === 5).every((r) => r.ok));
const o41 = await turn('슬립 어퍼를 자주 쓰는 상대에 대한 대처법 알려줘.', [], { research: async (req) => { log.research.push(req); return { ok: false, code: 'UNSUPPORTED', message: '이 기기에서는 검색 불가' }; } });
check(41, '검색이 없는 플랫폼(UNSUPPORTED)에서도 같은 경로로 답하고 검색 불가를 밝힘', intents(o41)[0] === 'COUNTER_STRATEGY' && /실시간 검색을 할 수 없어/.test(o41.message.text) && /상황 정의/.test(o41.message.text));
const o42 = await turn('슬립 어퍼를 자주 쓰는 상대에 대한 대처법 알려줘.', [], { research: async () => ({ ok: false, code: 'TIMEOUT', message: '검색 서버 응답 지연' }), chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'Ollama 꺼짐' }) });
check(42, '검색 실패 + AI 실패: 실패를 밝히고 기록·판단은 그대로 제공', /외부 자료 검색에 실패했습니다/.test(o42.message.text) && /로컬 AI를 사용할 수 없어 해석은 붙이지 않았습니다/.test((o42.message.guardNotes ?? []).join(' ')) && /상황 정의/.test(o42.message.text));
const o42b = await turn('잽 다음에 뭐 치면 좋아?', [], { chat: async () => ({ ok: false, code: 'NOT_RUNNING', message: 'Ollama 꺼짐' }), dataAnswer: async () => null });
check(42, '일반 경로 AI 실패: 데이터만으로 답하고 이유 표시', !!o42b.message.dataOnly && /로컬 AI 모델을 사용할 수 없어/.test(o42b.message.text));

console.log('\n[용어] 격투기 문맥');
const rd = (t) => CT.readCombatTerms(t);
check('T', "'투자' 같은 단어 속 '투'는 바꾸지 않음", !/크로스/.test(rd('투자 얘기 말고 셋업 알려줘').lookupText));
check('T', "'원투'는 잽·크로스", /잽 크로스/.test(rd('원투 셋업').lookupText));
check('T', "'페인트'는 반응 문맥에서만 feint", rd('페인트에 속아').feint === true && rd('벽 페인트 색 추천').feint === false);
check('T', "'암바처럼 아프다'는 통증 (기술 검색 아님)", I.analyzeIntents('스파링하다가 암바 걸린 것처럼 팔꿈치가 아파').intents[0] === 'INJURY_OR_PAIN_QUESTION');

console.log(`\n=== SUMMARY: ${pass}/${pass + fail} passed ===`);
const byTest = new Map();
for (const r of results) byTest.set(String(r.id), (byTest.get(String(r.id)) ?? true) && r.ok);
console.log('항목별:', [...byTest].map(([k, v]) => `${k}:${v ? 'O' : 'X'}`).join(' '));
process.exit(fail ? 1 : 0);
