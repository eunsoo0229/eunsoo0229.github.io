// TACTICAL FINDER — 110+ real-language inputs through the real engine (rule analysis + technique DB + combo library).
// No browser, no network, no AI call: the engine's DB path is deterministic, so every expectation is checkable.
//   node .devtools/test-tactical-finder.mjs            (writes data/audit/tactical-finder-test.json)
// Each case checks the analysis (목적·상황·종목 …) and the recommendations (existence in the DB, relevance by the
// features the input asked for, art scope, duplicates, safety handling). A case passes only if every check holds —
// "the engine answered" is never counted as a pass by itself.
import fs from 'node:fs';
import path from 'node:path';
import { createServer } from 'vite';

const APP = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const store = new Map();
globalThis.window = globalThis;
globalThis.Worker = class { postMessage() {} terminate() {} addEventListener() {} };
const et = new EventTarget();
Object.assign(globalThis, { addEventListener: (...a) => et.addEventListener(...a), removeEventListener: (...a) => et.removeEventListener(...a), dispatchEvent: (e) => et.dispatchEvent(e) });
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k), key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; } };

// type: 1 단일기술 2 셋업 3 콤보 4 공격 5 방어 6 카운터 7 거리 8 레슬링 9 그래플링 10 MMA 11 오타·비정형 12 모호 13 DB에 없는 기술 14 복합 조건
// expect: goals / behaviors / arts (analysis must contain), feat (a top-3 technique OR top-3 setup/combo must have one of
// these features), kind ('setup' | 'combo': that section must be non-empty), safety, unknown, noSignal, range
const CASES = [
  // ---- spec examples
  { t: 4, q: '상대가 계속 뒤로 빠질 때 공격을 연결하고 싶어.', goals: ['attack'], behaviors: ['retreat'], feat: ['pressure', 'combination', 'punch', 'knee', 'kick', 'footwork'] },
  { t: 3, q: '상대가 내 잽에 반응해서 가드를 올리면 다음 공격을 어떻게 연결할까?', goals: ['attack'], behaviors: ['guardHigh', 'jabReaction'], feat: ['body', 'feint', 'combination', 'kick'], kind: 'combo' },
  { t: 8, q: '상대의 테이크다운 시도를 방어한 뒤 유리한 포지션을 만들고 싶어.', goals: ['tdDefense', 'position'], behaviors: ['takedownAttempt'], feat: ['tdDefense', 'groundTop', 'back', 'clinch'] },
  { t: 6, q: '상대가 압박할 때 거리를 유지하면서 카운터하고 싶어.', goals: ['counter', 'distance'], behaviors: ['pressure'], feat: ['counter', 'footwork', 'distance', 'defense'] },
  { t: 4, q: '클린치 상황에서 유리한 공격 기회를 만들고 싶어.', goals: ['clinch'], behaviors: ['clinch'], feat: ['clinch', 'knee', 'elbow', 'takedown'] },
  { t: 3, q: '상대의 공격을 회피한 뒤 반격하는 조합을 찾고 싶어.', goals: ['counter'], feat: ['counter', 'defense'], kind: 'combo' },
  // ---- 1 single technique
  { t: 1, q: '잽 대신 쓸 수 있는 거리 재는 단일 기술 하나 추천해줘', goals: ['distance'], feat: ['distance', 'footwork', 'punch', 'kick'] },
  { t: 1, q: '무에타이에서 상대 전진을 끊는 기술 하나', arts: ['muay-thai'], feat: ['kick', 'distance', 'counter', 'footwork', 'defense', 'clinch', 'knee'] },
  { t: 1, q: '레슬링 기본 테이크다운 기술을 알려줘', arts: ['wrestling'], goals: ['takedown'], feat: ['takedown'] },
  { t: 1, q: '주짓수 초보가 먼저 배울 탈출 기술', arts: ['bjj'], goals: ['escape'], feat: ['escape'] },
  { t: 1, q: '복싱에서 바디를 공격하는 펀치', arts: ['boxing'], feat: ['body', 'punch'] },
  { t: 1, q: '킥복싱 로우킥 방어 기술', arts: ['kickboxing'], goals: ['defense'], feat: ['defense', 'counter'] },
  { t: 1, q: '하이가드로 막는 상대에게 쓸 어퍼컷 계열 기술', behaviors: ['guardHigh'], feat: ['punch', 'body', 'kick', 'feint'] },
  { t: 1, q: '상대 목을 잡았을 때 쓸 니킥', behaviors: ['clinch'], feat: ['knee', 'clinch'] },
  // ---- 2 setups
  { t: 2, q: '페인트로 반응을 유도해서 들어가는 셋업 알려줘', feat: ['feint', 'combination'], kind: 'setup' },
  { t: 2, q: '상대 반응을 이끌어서 테이크다운으로 연결하는 셋업', goals: ['takedown'], feat: ['takedown'], kind: 'setup' },
  { t: 2, q: '킥 페인트로 상대를 속이고 펀치를 넣는 셋업', feat: ['feint', 'punch', 'kick'], kind: 'setup' },
  { t: 2, q: '레벨 체인지로 상대 가드를 내리게 하는 셋업', feat: ['takedown', 'feint', 'punch'], kind: 'setup' },
  { t: 2, q: '잽으로 미끼를 던지고 크로스를 맞히는 셋업', feat: ['punch', 'feint', 'combination'], kind: 'setup' },
  { t: 2, q: '무에타이 셋업: 티프로 거리 만들고 들어가기', arts: ['muay-thai'], feat: ['kick', 'distance', 'combination'], kind: 'setup' },
  { t: 2, q: 'MMA에서 타격으로 테이크다운을 숨기는 셋업', arts: ['mixed-martial-arts'], feat: ['takedown', 'punch'], kind: 'setup' },
  { t: 2, q: '상대가 잽을 막을 때 쓸 셋업', behaviors: ['blocks'], feat: ['feint', 'body', 'combination', 'punch'], kind: 'setup' },
  // ---- 3 combos
  { t: 3, q: '복싱 기본 원투 이후 이어갈 콤보', arts: ['boxing'], feat: ['punch', 'combination'], kind: 'combo' },
  { t: 3, q: '킥복싱 펀치 후 로우킥으로 끝나는 콤보', arts: ['kickboxing'], feat: ['kick', 'punch', 'combination'], kind: 'combo' },
  { t: 3, q: '하이로우 콤비네이션 찾아줘 몸통 공격 포함', feat: ['body', 'combination', 'punch'], kind: 'combo' },
  { t: 3, q: '무에타이 엘보로 마무리하는 연타', arts: ['muay-thai'], feat: ['elbow', 'combination'], kind: 'combo' },
  { t: 3, q: 'MMA 타격에서 더블렉으로 이어지는 콤보', arts: ['mixed-martial-arts'], feat: ['takedown', 'combination', 'punch'], kind: 'combo' },
  { t: 3, q: '레슬링 체인 레슬링 콤보 싱글렉 실패하면', arts: ['wrestling'], feat: ['takedown'], kind: 'combo' },
  { t: 3, q: '근거리에서 쓰는 어퍼컷 훅 연타 조합', range: 'close', feat: ['punch', 'combination'], kind: 'combo' },
  { t: 3, q: '카운터로 시작하는 콤보 조합', goals: ['counter'], feat: ['counter', 'defense', 'combination'], kind: 'combo' },
  // ---- 4 attack
  { t: 4, q: '가드를 단단히 지키는 상대를 공략하고 싶어', behaviors: ['guardHigh'], goals: ['attack'], feat: ['body', 'feint', 'combination', 'kick'] },
  { t: 4, q: '키가 큰 상대에게 들어가서 공격하고 싶어', behaviors: ['taller'], feat: ['pressure', 'clinch', 'footwork', 'takedown', 'combination'] },
  { t: 4, q: '상대가 카운터를 노리고 기다리면 어떻게 공격하지', behaviors: ['counterWaiting'], feat: ['feint', 'combination', 'footwork'] },
  { t: 4, q: '몸통 공격으로 상대 가드를 내리고 싶어', feat: ['body', 'punch', 'kick'] },
  { t: 4, q: '킥으로 득점하고 싶어 킥복싱', arts: ['kickboxing'], feat: ['kick'] },
  { t: 4, q: '압박하면서 공격을 이어가고 싶어', goals: ['attack'], feat: ['pressure', 'combination', 'punch'] },
  { t: 4, q: '상대가 다 막혀서 공격이 안 들어가', behaviors: ['blocks'], feat: ['feint', 'body', 'combination'] },
  { t: 4, q: '복싱 근거리 인파이팅 공격', arts: ['boxing'], range: 'close', feat: ['punch'] },
  // ---- 5 defense
  { t: 5, q: '상대 펀치를 막는 방어 기술', goals: ['defense'], behaviors: ['punches'], feat: ['defense'] },
  { t: 5, q: '로우킥을 많이 차는 상대 방어', behaviors: ['kicks'], goals: ['defense'], feat: ['defense', 'counter'] },
  { t: 5, q: '잽을 피하는 방법', goals: ['defense'], feat: ['defense', 'footwork'] },
  { t: 5, q: '훅이 들어올 때 방어하고 싶어', goals: ['defense'], feat: ['defense'] },
  { t: 5, q: '킥을 캐치하는 방어', goals: ['defense'], feat: ['defense', 'counter', 'clinch'] },
  { t: 5, q: '테이크다운 막고 싶어', goals: ['tdDefense'], feat: ['tdDefense', 'defense'] },
  { t: 5, q: '스프롤 다음에 뭘 해야 해?', goals: ['tdDefense'], feat: ['tdDefense', 'defense', 'groundTop', 'back', 'clinch'] },
  { t: 5, q: '클린치에서 니를 막고 빠져나오고 싶어', behaviors: ['clinch'], feat: ['clinch', 'escape', 'defense'] },
  // ---- 6 counter
  { t: 6, q: '잽에 대한 카운터', goals: ['counter'], feat: ['counter', 'defense', 'punch'] },
  { t: 6, q: '상대 크로스를 흘리고 반격', goals: ['counter'], feat: ['counter', 'defense', 'punch'] },
  { t: 6, q: '킥을 막은 다음 반격하는 기술', goals: ['counter'], feat: ['counter', 'defense', 'kick', 'punch'] },
  { t: 6, q: '상대가 들어올 때 카운터 니킥', goals: ['counter'], feat: ['knee', 'counter'] },
  { t: 6, q: '무에타이 티프 카운터', arts: ['muay-thai'], goals: ['counter'], feat: ['counter', 'kick', 'defense'] },
  { t: 6, q: '상대 테이크다운에 카운터로 길로틴을 노리고 싶어', behaviors: ['takedownAttempt'], feat: ['submission', 'tdDefense', 'counter', 'clinch'] },
  { t: 6, q: '슬립 후에 넣을 카운터 펀치', goals: ['counter'], feat: ['punch', 'counter', 'defense'] },
  { t: 6, q: '복싱 카운터 기술 추천', arts: ['boxing'], goals: ['counter'], feat: ['counter', 'defense'] },
  // ---- 7 distance
  { t: 7, q: '거리를 유지하면서 싸우고 싶어', goals: ['distance'], feat: ['footwork', 'distance'] },
  { t: 7, q: '상대가 압박할 때 서클링으로 빠지고 싶어', behaviors: ['pressure'], feat: ['footwork', 'distance', 'counter'] },
  { t: 7, q: '긴 리치로 거리 싸움을 하고 싶다', goals: ['distance'], feat: ['distance', 'footwork', 'punch', 'kick'] },
  { t: 7, q: '킥 거리에서 펀치 거리로 들어가는 방법', goals: ['distance'], feat: ['footwork', 'distance', 'pressure', 'combination'] },
  { t: 7, q: '원거리에서 티프로 거리 조절', range: 'long', feat: ['kick', 'distance'] },
  { t: 7, q: '링 코너에 몰렸을 때 빠져나오기', goals: ['escape'], feat: ['footwork', 'escape', 'defense', 'clinch'] },
  { t: 7, q: '스텝으로 각도를 만들고 싶어', feat: ['footwork'] },
  { t: 7, q: '아웃파이팅 하고 싶어 복싱', arts: ['boxing'], goals: ['distance'], feat: ['footwork', 'distance', 'punch'] },
  // ---- 8 wrestling
  { t: 8, q: '레슬링 싱글렉 피니시', arts: ['wrestling'], feat: ['takedown'] },
  { t: 8, q: '더블렉 들어갈 때 상대가 스프롤하면', feat: ['takedown', 'tdDefense', 'clinch'] },
  { t: 8, q: '레슬링 탑 포지션 컨트롤', arts: ['wrestling'], goals: ['position'], feat: ['groundTop', 'back', 'clinch'] },
  { t: 8, q: '레슬링 바텀에서 일어나기', arts: ['wrestling'], goals: ['escape'], feat: ['escape'] },
  { t: 8, q: '언더훅을 잡았을 때 테이크다운', feat: ['takedown', 'clinch'] },
  { t: 8, q: '프론트 헤드락에서 할 수 있는 것', feat: ['clinch', 'back', 'takedown', 'submission', 'groundTop'] },
  { t: 8, q: '레슬링 스탠스에서 상대 다리를 잡는 공격', arts: ['wrestling'], feat: ['takedown'] },
  { t: 8, q: '바디락에서 넘기고 싶어', goals: ['takedown'], feat: ['takedown', 'clinch'] },
  // ---- 9 grappling
  { t: 9, q: '마운트에서 깔렸을 때 탈출', behaviors: ['bottom'], goals: ['escape'], feat: ['escape'] },
  { t: 9, q: '사이드컨트롤 당했을 때 빠져나오기', behaviors: ['bottom'], goals: ['escape'], feat: ['escape', 'guard'] },
  { t: 9, q: '클로즈드 가드에서 서브미션', behaviors: ['inGuard'], goals: ['submission'], feat: ['submission'] },
  { t: 9, q: '가드에서 스윕하고 싶어', goals: ['sweep'], feat: ['sweep'] },
  { t: 9, q: '백 잡았을 때 마무리', goals: ['position'], feat: ['back', 'submission'] },
  { t: 9, q: '가드 패스 하는 방법', feat: ['pass', 'groundTop'] },
  { t: 9, q: '유도 굳히기에서 빠져나오기', arts: ['judo'], goals: ['escape'], feat: ['escape'] },
  { t: 9, q: '하프가드에서 상위로 뒤집기', goals: ['sweep'], feat: ['sweep', 'guard'] },
  // ---- 10 MMA
  { t: 10, q: 'MMA에서 펀치로 들어가서 테이크다운', arts: ['mixed-martial-arts'], feat: ['takedown', 'punch'] },
  { t: 10, q: 'mma 케이지 레슬링 방어', arts: ['mixed-martial-arts'], feat: ['tdDefense', 'defense', 'clinch'] },
  { t: 10, q: '종합격투기 그라운드 앤 파운드 포지션', arts: ['mixed-martial-arts'], feat: ['groundTop', 'punch', 'elbow'] },
  { t: 10, q: 'MMA 스프롤 후 타격', arts: ['mixed-martial-arts'], feat: ['tdDefense', 'punch'] },
  { t: 10, q: 'UFC처럼 레벨체인지로 타격과 테이크다운 섞기', arts: ['mixed-martial-arts'], feat: ['takedown', 'punch', 'feint'] },
  { t: 10, q: 'MMA 바닥에서 일어나기', arts: ['mixed-martial-arts'], goals: ['escape'], feat: ['escape'] },
  { t: 10, q: 'MMA 클린치에서 더티 복싱', arts: ['mixed-martial-arts'], behaviors: ['clinch'], feat: ['clinch', 'punch', 'elbow', 'knee'] },
  { t: 10, q: 'MMA 카프킥 이후 연결', arts: ['mixed-martial-arts'], feat: ['kick', 'combination', 'punch'] },
  // ---- 11 typo / informal
  { t: 11, q: '테익다운 막고싶음', goals: ['tdDefense'], feat: ['tdDefense', 'defense'] },
  { t: 11, q: '상대가 압바하면 카운타 어케함', goals: ['counter'], feat: ['counter', 'defense', 'footwork'] },
  { t: 11, q: '크린치에서 머하지', behaviors: ['clinch'], feat: ['clinch', 'knee', 'elbow', 'takedown'] },
  { t: 11, q: '컴보 추천좀 복싱', arts: ['boxing'], feat: ['combination', 'punch'], kind: 'combo' },
  { t: 11, q: '무에따이 니킥 셋업', arts: ['muay-thai'], feat: ['knee', 'clinch', 'combination'], kind: 'setup' },
  { t: 11, q: '젭 다음에 뭐 침?', feat: ['punch', 'combination', 'kick', 'transition'] },
  { t: 11, q: 'takedown defense pls', goals: ['tdDefense'], feat: ['tdDefense', 'defense'] },
  { t: 11, q: '주지수 하위에서 탈출 ㅠㅠ', arts: ['bjj'], goals: ['escape'], feat: ['escape'] },
  // ---- 12 ambiguous (no goal / situation): the engine must say it could not tell, never invent a purpose
  { t: 12, q: '음.. 뭐 하지', noSignal: true },
  { t: 12, q: '좋은 거 알려줘', noSignal: true },
  { t: 12, q: '???', noSignal: true },
  { t: 12, q: '오늘 운동 끝', noSignal: true },
  { t: 12, q: '그냥 추천', noSignal: true },
  { t: 12, q: '격투기', noSignal: true },
  // ---- 13 techniques the DB does not have: reported as missing, never described
  { t: 13, q: 'dragon whirlwind kick 같은 기술로 공격하고 싶어', unknown: true, goals: ['attack'] },
  { t: 13, q: '플라잉 스콜피온 블레이드라는 기술을 쓰고 싶어', unknown: true },
  { t: 13, q: 'phantom spiral choke 하는 법', unknown: true },
  { t: 13, q: 'super galaxy uppercut으로 카운터', unknown: true, goals: ['counter'] },
  { t: 13, q: '천둥 회오리 킥이라는 기술로 마무리', unknown: true },
  { t: 13, q: 'mega twister takedown 추천', unknown: true, goals: ['takedown'] },
  // ---- 14 mixed conditions
  { t: 14, q: '사우스포 상대가 압박해올 때 오소독스인 내가 카운터하고 싶어', behaviors: ['pressure'], goals: ['counter'], feat: ['counter', 'footwork', 'defense'] },
  { t: 14, q: '초보인데 킥복싱에서 키 큰 상대를 압박하는 콤보', arts: ['kickboxing'], behaviors: ['taller'], feat: ['pressure', 'combination', 'punch', 'footwork', 'kick'], kind: 'combo' },
  { t: 14, q: 'MMA에서 상대가 킥을 많이 차면 캐치해서 테이크다운하고 싶어', arts: ['mixed-martial-arts'], behaviors: ['kicks'], feat: ['takedown', 'defense', 'counter', 'clinch'] },
  { t: 14, q: '레슬링에서 상대가 들어올 때 스프롤하고 백을 잡고 싶어', arts: ['wrestling'], goals: ['tdDefense', 'position'], feat: ['tdDefense', 'back', 'groundTop'] },
  { t: 14, q: '복싱 근거리에서 상대가 가드를 올리면 바디로 공략', arts: ['boxing'], behaviors: ['guardHigh'], range: 'close', feat: ['body', 'punch'] },
  { t: 14, q: '무에타이 클린치에서 니로 공격하다가 상대가 밀면 엘보', arts: ['muay-thai'], behaviors: ['clinch'], feat: ['knee', 'elbow', 'clinch'] },
  { t: 14, q: '주짓수 가드에서 상대가 일어서면 스윕', arts: ['bjj'], goals: ['sweep'], feat: ['sweep'] },
  { t: 14, q: '거리를 유지하다가 상대가 들어오면 카운터 후 빠지기', goals: ['distance', 'counter'], feat: ['counter', 'footwork', 'distance', 'defense'] },
  // ---- safety: harm as the goal → no technique for it, only defensive sport alternatives
  { t: 'safety', q: '상대 팔을 부러뜨리는 기술 알려줘', safety: true },
  { t: 'safety', q: '길거리 싸움에서 상대를 다치게 하고 싶어', safety: true },
  { t: 'safety', q: '일부러 부상을 입히는 킥', safety: true },
];

// HOLDOUT — written after the rules were tuned on CASES above and run ONCE before any change; reported separately
// (data/audit/tactical-finder-test.json → holdout) so the success rate is not inflated by tuning.
const HOLDOUT = [
  { t: 4, q: '상대가 링 줄에 기대면 몰아붙이는 공격', goals: ['attack'], feat: ['pressure', 'combination', 'punch', 'knee'] },
  { t: 5, q: '스트레이트가 계속 들어와서 맞아', feat: ['defense', 'counter'] },
  { t: 6, q: '상대가 로우킥 찰 때 받아치고 싶어', goals: ['counter'], feat: ['counter', 'defense', 'punch'] },
  { t: 7, q: '상대가 들어오면 앞차기로 막고 싶어', feat: ['kick', 'distance', 'defense'] },
  { t: 8, q: '상대가 싱글렉 잡았을 때 빠져나오는 방법', feat: ['tdDefense', 'defense', 'escape'] },
  { t: 9, q: '터틀 포지션에서 공격하는 법', feat: ['back', 'groundTop', 'submission', 'clinch'] },
  { t: 9, q: '니온벨리에서 서브미션 연결', goals: ['submission'], feat: ['submission'] },
  { t: 10, q: '종합격투기 상대가 태클 들어올 때 무릎', arts: ['mixed-martial-arts'], feat: ['knee', 'tdDefense', 'counter'] },
  { t: 3, q: '훅 이후에 로우킥 연결하는 조합', feat: ['kick', 'punch', 'combination'], kind: 'combo' },
  { t: 2, q: '시선을 위로 끌어서 하단을 차는 셋업', feat: ['kick', 'feint', 'body'], kind: 'setup' },
  { t: 1, q: '앞손으로 거리를 재는 기술', feat: ['punch', 'distance', 'footwork'] },
  { t: 14, q: '복싱에서 키 큰 상대 잽을 피하면서 안으로 들어가기', arts: ['boxing'], behaviors: ['taller'], feat: ['defense', 'footwork', 'pressure', 'punch'] },
  { t: 11, q: '상대가 자꾸 클린치 잡는데 어케 떼냄', behaviors: ['clinch'], feat: ['clinch', 'escape', 'defense', 'knee'] },
  { t: 11, q: 'how to counter a jab', goals: ['counter'], feat: ['counter', 'defense'] },
  { t: 12, q: '아무거나', noSignal: true },
  { t: 13, q: 'cobra lightning elbow 쓰는 법', unknown: true },
  { t: 5, q: '바디블로 맞을 때 막는 방법', goals: ['defense'], feat: ['defense'] },
  { t: 7, q: '상대가 거리를 두고 아웃파이팅하면 어떻게 좁히지', feat: ['pressure', 'footwork', 'combination'] },
  { t: 8, q: '레슬링 상대 균형을 무너뜨리는 기술', arts: ['wrestling'], feat: ['takedown', 'clinch'] },
  { t: 10, q: 'MMA 상대가 케이지로 밀 때 빠져나오기', arts: ['mixed-martial-arts'], feat: ['escape', 'clinch', 'tdDefense', 'footwork'] },
  { t: 9, q: '삼각조르기 들어가는 셋업', feat: ['submission', 'guard'] },
  { t: 6, q: '상대 훅을 숙여 피하고 어퍼컷', goals: ['defense'], feat: ['punch', 'defense', 'counter'] },
  { t: 4, q: '무에타이에서 상대 가드를 열고 엘보 넣기', arts: ['muay-thai'], feat: ['elbow', 'clinch', 'feint'] },
  { t: 1, q: '유도에서 상대가 뒤로 버틸 때 쓰는 메치기', arts: ['judo'], goals: ['takedown'], feat: ['takedown'] },
  { t: 14, q: '초보 복서가 압박하는 상대한테 쓸 쉬운 방어', arts: ['boxing'], behaviors: ['pressure'], feat: ['defense', 'footwork', 'counter'] },
  { t: 'safety', q: '상대가 못 일어나게 만드는 니킥', safety: true },
  { t: 3, q: '레슬링 테이크다운 실패 후 다시 들어가는 연결', arts: ['wrestling'], feat: ['takedown'], kind: 'combo' },
  { t: 7, q: '사우스포 상대와 거리 싸움', feat: ['footwork', 'distance', 'punch', 'kick'] },
  { t: 5, q: '킥복싱 하이킥 방어', arts: ['kickboxing'], feat: ['defense'] },
  { t: 2, q: '페이크 슛으로 상대 손을 내리게 하고 펀치', feat: ['feint', 'punch', 'takedown'], kind: 'setup' },
];

const results = [];
const failures = [];
const timings = [];
const server = await createServer({ root: APP, logLevel: 'error', server: { middlewareMode: true, hmr: false }, appType: 'custom', optimizeDeps: { noDiscovery: true, include: [] } });
try {
  const R = await server.ssrLoadModule('/src/lib/tacticalFinder/recommend.ts');
  const IDX = await server.ssrLoadModule('/src/lib/tacticalFinder/techniqueIndex.ts');
  const UT = await server.ssrLoadModule('/src/lib/userTechniques/service.ts');
  const LD = await server.ssrLoadModule('/src/lib/loadData.ts');
  const T0 = performance.now();
  IDX.techniqueIndex();
  const indexMs = Math.round(performance.now() - T0);

  const featuresOfRec = (rec) => {
    const f = new Set();
    for (const s of rec.steps) if (s.techniqueId) for (const x of IDX.indexedById(s.techniqueId)?.features ?? []) f.add(x);
    return f;
  };
  const runCases = (cases, bucket, fails) => {
  for (const c of cases) {
    const t0 = performance.now();
    const r = R.findTactics(c.q, { personal: false, count: 5 });
    const ms = performance.now() - t0;
    timings.push(ms);
    const a = r.analysis;
    const errs = [];
    const has = (list, vals) => vals.every((v) => list.some((x) => x.value === v));
    if (c.goals && !has(a.goals, c.goals)) errs.push(`목적 ${c.goals} ⊄ ${a.goals.map((g) => g.value)}`);
    if (c.behaviors && !has(a.behaviors, c.behaviors)) errs.push(`상황 ${c.behaviors} ⊄ ${a.behaviors.map((b) => b.value)}`);
    if (c.arts && !has(a.arts, c.arts)) errs.push(`종목 ${c.arts} ⊄ ${a.arts.map((x) => x.value)}`);
    if (c.range && a.range?.value !== c.range) errs.push(`거리 ${c.range} ≠ ${a.range?.value}`);
    const all = [...r.techniques, ...r.setups, ...r.combos, ...r.alternatives];
    // every technique on every card exists in the DB, and the inDb flag tells the truth
    for (const rec of all) {
      for (const s of rec.steps) {
        if (s.inDb && !(s.techniqueId && UT.resolveTechnique(s.techniqueId))) errs.push(`DB 확인 표시인데 기록 없음: ${s.name}`);
        if (!s.inDb && s.techniqueId) errs.push(`미확인 표시인데 id 있음: ${s.name}`);
      }
      if (rec.kind === 'technique' && !LD.getTechnique(rec.techniqueId) && !UT.resolveTechnique(rec.techniqueId)) errs.push(`없는 기술 추천: ${rec.techniqueId}`);
      const sum = rec.scoreParts.reduce((s, p) => s + p.points, 0), max = rec.scoreParts.reduce((s, p) => s + p.max, 0);
      if (rec.origin !== 'graph' && Math.round((100 * sum) / max) !== rec.score) errs.push(`점수 근거 불일치: ${rec.title}`);
      if (!rec.reasons.length) errs.push(`추천 이유 없음: ${rec.title}`);
    }
    for (const [name, list] of [['기술', r.techniques], ['셋업', r.setups], ['콤보', r.combos]]) {
      const keys = list.map((x) => x.key);
      if (new Set(keys).size !== keys.length) errs.push(`${name} 중복`);
      const seqs = list.map((x) => x.steps.map((s) => s.techniqueId ?? s.name).join('>'));
      if (new Set(seqs).size !== seqs.length) errs.push(`${name} 같은 구성 중복`);
    }
    const titles = r.techniques.map((x) => x.title.toLowerCase());
    if (new Set(titles).size !== titles.length) errs.push('같은 이름 기술 중복');
    if (a.arts.length) {
      const allowed = new Set(a.arts.flatMap((x) => (x.value === 'mixed-martial-arts' ? ['mixed-martial-arts', 'boxing', 'kickboxing', 'muay-thai', 'wrestling', 'bjj'] : [x.value])));
      for (const rec of [...r.techniques, ...r.setups, ...r.combos]) if (rec.martialArt && !allowed.has(rec.martialArt)) errs.push(`종목 밖 추천: ${rec.title} (${rec.martialArt})`);
    }
    if (c.feat) {
      const top = [...r.techniques.slice(0, 3), ...r.setups.slice(0, 3), ...r.combos.slice(0, 3)];
      if (!top.some((rec) => c.feat.some((f) => featuresOfRec(rec).has(f)))) errs.push(`상위 추천에 원하는 성격(${c.feat}) 없음: ${top.slice(0, 3).map((x) => x.title)}`);
      if (!r.techniques.length && !r.combos.length && !r.setups.length) errs.push('추천 없음');
    }
    if (c.kind === 'setup' && !r.setups.length) errs.push('셋업 추천 없음');
    if (c.kind === 'combo' && !r.combos.length) errs.push('콤보 추천 없음');
    if (c.noSignal) {
      if (all.length) errs.push(`모호한 입력인데 추천함: ${all.slice(0, 2).map((x) => x.title)}`);
      if (!r.notices.some((n) => /찾지 못했습니다/.test(n.text))) errs.push('모호한 입력 안내 없음');
    }
    if (c.unknown) {
      if (!a.unknownTerms.length) errs.push('DB에 없는 기술 이름을 알리지 않음');
      if (!r.notices.some((n) => /찾지 못한 이름/.test(n.text))) errs.push('정보 부족 안내 없음');
      for (const u of a.unknownTerms) for (const rec of all) if (rec.title.toLowerCase().includes(u.toLowerCase())) errs.push(`없는 기술을 카드로 만듦: ${u}`);
    }
    if (c.safety) {
      if (!a.safety.blocked) errs.push('위험 요청을 막지 않음');
      if (r.setups.length || r.combos.length) errs.push('위험 요청에 콤보·셋업 제공');
      for (const rec of r.techniques) for (const f of ['punch', 'kick', 'knee', 'elbow', 'submission', 'takedown']) if (featuresOfRec(rec).has(f)) errs.push(`위험 요청에 공격 기술: ${rec.title}`);
    } else if (a.safety.blocked) errs.push(`안전 차단 오탐: ${a.safety.terms}`);
    if (ms > 1500) errs.push(`응답 느림 ${Math.round(ms)}ms`);
    const ok = errs.length === 0;
    bucket.push({ type: c.t, query: c.q, ok, ms: Math.round(ms), analysis: a.summary.map((s) => `${s.label}: ${s.value}`), top: { techniques: r.techniques.slice(0, 3).map((x) => x.title), setups: r.setups.slice(0, 2).map((x) => x.title), combos: r.combos.slice(0, 2).map((x) => x.title) }, errors: errs });
    if (!ok) fails.push({ q: c.q, errs });
  }
  };
  runCases(CASES, results, failures);
  const holdout = [];
  const holdoutFails = [];
  runCases(HOLDOUT, holdout, holdoutFails);

  // ---- 15 personalization ON / OFF on the same inputs (seeded profile: trains boxing, southpaw, Jab learning, Cross favorite)
  const now = new Date().toISOString();
  const item = (key, value) => ({ key, state: 'answered', value, source: 'user', status: 'confirmed', createdAt: now, updatedAt: now });
  store.set('martialdex:fighter-profile', JSON.stringify({ version: 1, items: { 'train.arts': item('train.arts', ['boxing']), 'body.stance': item('body.stance', 'southpaw') }, style: null, history: [], interview: { startedAt: now, answeredKeys: [], skippedKeys: [], lastAskedKey: null, done: false }, updatedAt: now }));
  store.set('martialdex:favorites', JSON.stringify(['boxing__cross']));
  const PERS = ['상대가 압박할 때 카운터하고 싶어', '상대가 뒤로 빠질 때 공격', '방어 기술 추천', '가드를 올리는 상대 공략', '거리를 유지하고 싶어'];
  for (const q of PERS) {
    const off = R.findTactics(q, { personal: false, count: 5 });
    const on = R.findTactics(q, { personal: true, count: 5 });
    const errs = [];
    if (!on.personalApplied.length) errs.push('개인화 데이터를 읽지 못함');
    if (!on.techniques.some((x) => x.scoreParts.some((p) => p.key === 'personal'))) errs.push('개인화 점수 항목 없음');
    if (off.techniques.some((x) => x.scoreParts.some((p) => p.key === 'personal'))) errs.push('OFF인데 개인화 점수');
    const boxingOn = on.techniques.filter((x) => x.martialArt === 'boxing').length;
    const boxingOff = off.techniques.filter((x) => x.martialArt === 'boxing').length;
    if (boxingOn < boxingOff) errs.push(`개인화 ON에서 수련 종목(복싱) 추천이 줄어듦 ${boxingOff}→${boxingOn}`);
    if (on.techniques.length < Math.min(5, off.techniques.length)) errs.push('개인화가 결과를 지나치게 제한함');
    // a stated art beats the profile
    const muay = R.findTactics(`무에타이 ${q}`, { personal: true, count: 5 });
    if (muay.techniques.some((x) => x.martialArt === 'boxing')) errs.push('사용자가 지정한 종목보다 프로필 종목을 우선함');
    const ok = !errs.length;
    results.push({ type: 15, query: `[개인화 ON/OFF] ${q}`, ok, ms: 0, analysis: on.personalApplied, top: { off: off.techniques.slice(0, 3).map((x) => `${x.title}(${x.martialArt})`), on: on.techniques.slice(0, 3).map((x) => `${x.title}(${x.martialArt})`) }, errors: errs });
    if (!ok) failures.push({ q: `[개인화] ${q}`, errs });
  }
  store.delete('martialdex:fighter-profile');
  store.delete('martialdex:favorites');

  // ---- filters / paging / cache
  const extra = [];
  const f1 = R.findTactics('카운터 기술', { personal: false, art: 'boxing', count: 3 });
  extra.push(['종목 필터(복싱) → 모든 카드가 복싱', f1.techniques.length > 0 && f1.techniques.every((x) => x.martialArt === 'boxing')]);
  extra.push(['추천 개수 3 → 섹션당 최대 3', f1.techniques.length <= 3 && f1.combos.length <= 3 && f1.setups.length <= 3]);
  const f10 = R.findTactics('카운터 기술', { personal: false, count: 10 });
  extra.push(['추천 개수 10 → 기술 10개', f10.techniques.length === 10]);
  const p0 = R.findTactics('방어 기술', { personal: false, count: 5 }, 0);
  const p1 = R.findTactics('방어 기술', { personal: false, count: 5 }, 1);
  extra.push(['다른 추천 보기 → 겹치지 않는 다음 결과', p1.techniques.length > 0 && !p1.techniques.some((x) => p0.techniques.some((y) => y.key === x.key))]);
  const kOnly = R.findTactics('잽 이후 콤보', { personal: false, kind: 'combo' });
  extra.push(['유형 필터(콤보) → 콤보만', kOnly.combos.length > 0 && !kOnly.techniques.length && !kOnly.setups.length]);
  const c1 = R.findTactics('상대가 압박할 때 카운터', { personal: false });
  const c2 = R.findTactics('상대가 압박할 때 카운터', { personal: false });
  extra.push(['같은 검색 반복 → 캐시 사용', !c1.cached && c2.cached]);
  const cat = R.findTactics('', { personal: false, category: 'wrestling' });
  extra.push(['카테고리(WRESTLING)만 선택해도 검색됨', cat.techniques.length > 0 && cat.techniques.every((x) => x.martialArt === 'wrestling')]);
  const diff = R.findTactics('방어', { personal: false, difficulty: 'beginner' });
  extra.push(['난이도 필터(초급) → 난이도 기록이 초급인 기술만 + 안내', diff.techniques.every((x) => x.difficulty === '초급') && diff.notices.some((n) => /난이도/.test(n.text))]);
  for (const [n, ok] of extra) {
    results.push({ type: 'filter', query: n, ok, ms: 0, analysis: [], top: {}, errors: ok ? [] : ['실패'] });
    if (!ok) failures.push({ q: n, errs: ['실패'] });
  }

  const sorted = [...timings].sort((x, y) => x - y);
  const report = {
    generatedBy: '.devtools/test-tactical-finder.mjs',
    at: new Date().toISOString(),
    inputs: CASES.length + PERS.length,
    checksTotal: results.length,
    passed: results.filter((r) => r.ok).length,
    timing: { indexBuildMs: indexMs, medianMs: Math.round(sorted[Math.floor(sorted.length / 2)]), p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)]), maxMs: Math.round(sorted.at(-1)) },
    byType: Object.fromEntries([...new Set(results.map((r) => String(r.type)))].map((t) => [t, `${results.filter((r) => String(r.type) === t && r.ok).length}/${results.filter((r) => String(r.type) === t).length}`])),
    results,
    holdout: { inputs: HOLDOUT.length, passed: holdout.filter((r) => r.ok).length, results: holdout },
  };
  fs.writeFileSync(path.join(APP, 'data/audit/tactical-finder-test.json'), JSON.stringify(report, null, 1) + '\n');
  for (const f of failures) console.log('FAIL —', f.q, '::', f.errs.join(' | ').slice(0, 300));
  console.log('\nby type', JSON.stringify(report.byType));
  console.log('timing', JSON.stringify(report.timing));
  for (const f of holdoutFails) console.log('HOLDOUT FAIL —', f.q, '::', f.errs.join(' | ').slice(0, 300));
  console.log(`\n${report.passed}/${report.checksTotal} passed (${report.inputs} inputs)`);
  console.log(`holdout ${report.holdout.passed}/${report.holdout.inputs} (not used for tuning)`);
  process.exitCode = failures.length ? 1 : 0;
} finally {
  await server.close();
}
