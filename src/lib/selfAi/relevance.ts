// 검색 결과 관련성 평가 — 자료 한 건이 "이 질문의 근거로 쓸 수 있는가"를 코드가 축별로 판정한다.
//
// 왜 필요한가 (2026-11-08 측정). 기존 순위는 selfResearch/researchCore.ts 의 queryOverlap 하나였고, 그것은
// 제목+검색요약에 질의 단어가 몇 개 들어 있는지만 센다. 그래서 "더스틴 포이리에가 습관적으로 올리는 가드"에
//   · 포이리에 소개 글(가드 얘기 없음)        → 이름이 맞으니 높은 점수
//   · 복싱 가드 일반 설명(포이리에 얘기 없음) → 가드가 맞으니 높은 점수
//   · 주짓수 클로즈드 가드 글                 → "guard" 가 맞으니 높은 점수
// 셋 다 상위에 올라왔다. 세 자료 모두 "포이리에가 어떤 가드를 쓰는가"는 한 글자도 말하지 않는다.
//
// 여기서는 인물·주제를 AND 로 묶고, 둘이 같은 문장 안에 있는지(직접성)까지 본다. 제목은 본문이 아니므로
// 제목에서 본 것은 본문 확인으로 치지 않는다. 모든 축은 관찰된 사실만 쓴다 — 모델에게 묻지 않는다.

import type { ResearchResult } from '../selfResearch/types';

export interface RelevanceAxes {
  /** 선수·인물 일치도: 본문에 있으면 1, 제목·요약에만 있으면 0.6, 없으면 0 */
  subject: number;
  /** 기술·주제 일치도: 질문이 주제를 말했을 때만 평가. 다른 뜻의 동명 기술이면 깎는다 */
  topic: number;
  /** 질문 의도 일치도: 습관을 물었는데 자료가 1회성 경기 기사뿐이면 낮다 */
  intent: number;
  /** 본문 확인 여부: 원문을 실제로 읽었는가 (검색 요약만이면 0) */
  body: number;
  /** 출처 신뢰도: 검색 파이프라인이 매긴 등급 + 출처 유형 */
  trust: number;
  /** 근거의 직접성: 인물과 주제가 같은 문장 안에 있으면 1, 본문 안 다른 곳이면 0.5 */
  directness: number;
}

export type RelevanceVerdict =
  | 'evidence' // 본문에서 인물+주제를 함께 확인 — 주장을 세울 근거로 쓸 수 있다
  | 'reference' // 관련은 있으나 본문 확인이나 직접성이 부족 — 참고 목록에만
  | 'drop'; // 이 질문의 근거가 아니다

export interface RelevanceScore {
  axes: RelevanceAxes;
  /** 0..100 — 축의 가중합. 정렬용이며, 판정(verdict)은 점수가 아니라 축의 조건으로 내린다. */
  score: number;
  verdict: RelevanceVerdict;
  /** 관찰한 사실만 (사용자에게 "왜 이 자료를 썼는지/뺐는지" 그대로 보여 줄 수 있는 문장) */
  reasons: string[];
  /** 인물과 주제가 함께 나온 본문 문장 (있을 때) — 근거 인용과 대조에 쓴다 */
  directSentence?: string;
}

// ────────────────────────────────────────────────────────────── 주제 사전
//
// 격투 선수 분석에서 실제로 묻는 주제만 넣는다. `query` 는 검색어에 보탤 영어 낱말,
// `match` 는 자료가 그 주제를 정말 다루는지 보는 표현, `conflict` 는 글자는 같은데
// 다른 기술인 경우(가드: 복싱의 손 자세 ↔ 주짓수의 바닥 가드).
export interface TopicDef {
  key: string;
  label: string;
  ask: RegExp;
  query: string[];
  match: RegExp;
  conflict?: RegExp;
}

/** 주짓수의 바닥 가드 — 타격 가드를 물었을 때 이 표현들은 같은 주제가 아니다. */
const GROUND_GUARD = /(closed|open|half|full|butterfly|x-?|spider|lasso|worm|z-?|deep half|de la riva|dlr|rubber|sit-?up|knee shield)[\s-]?guard|guard (pass|passing|pull|retention|recovery|break)|pass(ing|ed)? (his|her|the|their) guard|from (his|her|their) guard|가드\s*(패스|리커버리|브레이크|풀링)|하프\s*가드|클로즈드\s*가드|버터플라이\s*가드/i;

export const TOPICS: TopicDef[] = [
  {
    key: 'guard',
    label: '가드·방어 자세',
    ask: /(가드|방어\s*자세|방어\s*습관|손\s*위치|guard|defensive (stance|posture|shell)|hand position)/i,
    query: ['guard', 'defense', 'hands', 'head movement'],
    match: /(high guard|long guard|philly shell|shoulder roll|cross-?arm|ear ?muff|peek-?a-?boo|tight guard|low guard|hands (up|high|low|down)|guard (up|high|low|position|placement)|defensive (stance|posture|shell|structure)|keeps? (his|her|their) hands|하이\s*가드|롱\s*가드|필리\s*쉘|가드(를|는|가)?\s*(올리|내리|높|낮|유지))/i,
    conflict: GROUND_GUARD,
  },
  { key: 'lead_hand', label: '앞손 운용', ask: /(앞손|리드\s*핸드|lead hand|jab 활용|잽 활용)/i, query: ['lead hand', 'jab'], match: /(lead hand|lead (left|right)|jab(s|bing)?|pawing|앞손|리드\s*핸드|잽)/i },
  { key: 'setup', label: '셋업', ask: /(셋업|set-?up|진입\s*방법|어떻게 들어가)/i, query: ['setups'], match: /(set[- ]?up|sets? up|entry|entries|feint|셋업|페인트)/i },
  // "jab followed by a lead hook" 도 콤비네이션이다 — 2026-11-08 회귀: `followed by` 를 놓쳐 실제 콤비네이션
  // 분석 페이지가 "주제 불일치"로 빠졌고, 두 곳에서 확인되던 Cross 가 한 곳짜리로 떨어졌다
  { key: 'combo', label: '콤비네이션', ask: /(콤보|콤비네이션|연타|combination|combo)/i, query: ['combinations'], match: /(combination|combo|one-?two|1-?2|follow(s|ed|ing)?\s+(it\s+)?(up\s+)?(with|by)|then\s+(throws?|fires?|lands?|comes?)|콤보|콤비네이션|연타)/i },
  { key: 'counter', label: '카운터', ask: /(카운터|받아치|counter)/i, query: ['counter'], match: /(counter(s|ing|ed|-?punch|-?attack)?|check hook|받아치|카운터)/i },
  { key: 'footwork', label: '거리·풋워크', ask: /(거리|풋워크|스텝|스탠스|footwork|distance|stance|range)/i, query: ['footwork', 'distance'], match: /(footwork|distance|range|stance|switch(es|ing)? stance|southpaw|orthodox|pivot|step|풋워크|스탠스|거리)/i },
  { key: 'kick', label: '킥', ask: /(킥|발차기|로우킥|카프킥|kick)/i, query: ['kicks', 'leg kicks'], match: /(kick(s|ing)?|calf|low kick|head kick|teep|round ?house|킥|발차기)/i },
  { key: 'clinch', label: '클린치', ask: /(클린치|clinch|플럼)/i, query: ['clinch'], match: /(clinch|plum|collar tie|under ?hook|클린치)/i },
  { key: 'grappling', label: '그래플링', ask: /(그래플링|레슬링|테이크다운|주짓수|서브미션|grappling|wrestling|takedown|submission)/i, query: ['grappling', 'wrestling'], match: /(grappl|wrestl|takedown|double leg|single leg|submission|choke|guard|sprawl|그래플링|레슬링|테이크다운)/i },
  { key: 'striking', label: '타격', ask: /(타격|펀치|주먹|striking|punch|boxing|복싱)/i, query: ['striking'], match: /(strik|punch|boxing|jab|cross|hook|uppercut|타격|펀치)/i },
  // "파이팅 스타일 알려줘" 는 주제를 좁힌 질문이 아니라 전반 분석 요청이다 — 여기에 '스타일'을 넣으면
  // 경기 운영을 말하지 않은 기술 분석 자료가 전부 "주제 불일치"로 버려진다 (2026-11-08 측정)
  { key: 'gameplan', label: '경기 운영', ask: /(경기\s*운영|게임\s*플랜|전략|gameplan|game plan|strategy)/i, query: ['game plan'], match: /(game ?plan|strategy|approach|pace|pressure|경기 운영|전략)/i },
];

/** 질문이 "습관적으로 / 자주 / 주로" 처럼 반복성을 물었는가 — 한 자료만으로는 답할 수 없는 질문. */
const HABIT_ASK = /(습관|버릇|자주|주로|즐겨|항상|반복|늘\s|habitual|often|usually|always|tend(s|ency)|signature|go-?to)/i;

export interface QuestionFocus {
  /** 자료에서 찾을 인물 이름 표기들 (영문 전체 이름, 성, 한글 표기) */
  subjects: string[];
  topics: TopicDef[];
  /** 검색어에 보탤 영어 낱말 */
  queryWords: string[];
  /** 반복성(습관)을 물었다 — 근거 한 곳으로는 단정하지 않는다 */
  habit: boolean;
}

/** 사람 이름을 자료에서 찾을 표기들로 (전체 이름 + 성). evidenceStyle.namesFighter 와 같은 규칙. */
export function nameForms(name: string): string[] {
  const parts = name.split(/\s+/).filter((p) => p.length >= 3);
  return [...new Set([name, ...parts.slice(-1)])].filter(Boolean);
}

/** 질문에서 "누구의 / 무엇을" 을 뽑는다. 주제를 말하지 않았으면 topics 는 비어 있고, 주제 축은 평가하지 않는다. */
export function focusOf(question: string, subject: string | null, extraNames: (string | null | undefined)[] = []): QuestionFocus {
  const topics = TOPICS.filter((t) => t.ask.test(question));
  // 타격·그래플링 같은 큰 묶음은 더 좁은 주제가 이미 잡혔으면 뺀다 ("가드" 질문이 "타격" 으로 넓어지지 않도록)
  const narrow = topics.filter((t) => t.key !== 'striking' && t.key !== 'grappling' && t.key !== 'gameplan');
  const picked = narrow.length ? narrow : topics;
  const subjects = [...new Set([subject, ...extraNames].filter((x): x is string => !!x && x.trim().length > 1).flatMap(nameForms))];
  return { subjects, topics: picked, queryWords: [...new Set(picked.flatMap((t) => t.query))], habit: HABIT_ASK.test(question) };
}

// ────────────────────────────────────────────────────────────── 축 평가

function hasAny(text: string, forms: string[]): boolean {
  return forms.some((f) => (/^[A-Za-z]/.test(f) ? new RegExp(`\\b${f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i') : new RegExp(f.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i')).test(text));
}

export function splitSentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 15);
}

const TRUST_OF: Record<string, number> = { academic: 1, official: 0.95, records: 0.9, reference: 0.7, video: 0.6, web: 0.55, blog: 0.4, forum: 0.25 };

/**
 * 자료 한 건을 6축으로 평가한다.
 *
 * 판정은 점수가 아니라 조건으로 내린다 — 점수는 정렬에만 쓴다. 높은 총점이 "인물은 맞는데 주제는 없는 글"을
 * 근거로 승격시키는 일이 없어야 하기 때문이다(사양 §3: 단순 키워드 일치를 높은 관련성으로 취급하지 않는다).
 */
export function scoreResult(result: ResearchResult, focus: QuestionFocus): RelevanceScore {
  const head = `${result.title} ${result.snippet ?? ''}`;
  // 부분적으로만 채워진 결과(캐시·테스트 대역)도 평가할 수 있어야 한다 — 없는 필드는 "확인 못함"으로 본다
  const status = result.extraction?.status;
  const bodyText = status === 'ok' ? result.content ?? '' : '';
  const engines = result.engines?.length ?? 0;
  const reasons: string[] = [];

  // 1) 인물 일치도 — 본문에 있어야 제대로 맞은 것, 제목뿐이면 절반도 못 준다
  let subject = 0;
  if (!focus.subjects.length) subject = 1; // 인물을 묻지 않은 질문
  else if (bodyText && hasAny(bodyText, focus.subjects)) {
    subject = 1;
    reasons.push('본문에 해당 선수 이름이 나옴');
  } else if (hasAny(head, focus.subjects)) {
    subject = 0.6;
    reasons.push('제목·검색요약에만 선수 이름이 있고 본문에서는 확인하지 못함');
  } else reasons.push('이 선수에 대한 자료가 아님 (제목·본문 어디에도 이름이 없음)');

  // 2) 주제 일치도 — 질문이 주제를 말했을 때만. 동명 다른 기술은 주제가 아니다
  let topic = 0;
  let topicConflict = false;
  if (!focus.topics.length) topic = 1;
  else {
    const inBody = focus.topics.filter((t) => bodyText && t.match.test(bodyText));
    const inHead = focus.topics.filter((t) => t.match.test(head));
    if (inBody.length) {
      topic = 1;
      reasons.push(`본문이 ${inBody.map((t) => t.label).join('·')}를 다룸`);
    } else if (inHead.length) {
      topic = 0.5;
      reasons.push(`제목·요약만 ${inHead.map((t) => t.label).join('·')}를 언급 (본문 확인 안 됨)`);
    } else reasons.push(`질문한 주제(${focus.topics.map((t) => t.label).join('·')})를 다루지 않음`);
    // 같은 낱말, 다른 기술: 주제 표현은 충돌 쪽에만 있고 본래 뜻으로는 안 쓰였다
    const conflicted = focus.topics.filter((t) => t.conflict && t.conflict.test(`${head} ${bodyText}`));
    if (conflicted.length && topic < 1) {
      topicConflict = true;
      topic = 0;
      reasons.push(`같은 이름의 다른 기술을 다룬 자료 (${conflicted.map((t) => t.label).join('·')}의 다른 뜻)`);
    }
  }

  // 3) 본문 확인 여부 — 검색 요약은 본문이 아니다
  const body = bodyText ? 1 : 0;
  if (!bodyText) reasons.push(!status || status === 'not_attempted' ? '본문을 읽지 않음 (검색 요약만)' : `본문을 읽지 못함 (${status})`);

  // 4) 근거의 직접성 — 인물과 주제가 같은 문장 안에 있는가
  let directness = 0;
  let directSentence: string | undefined;
  if (!focus.subjects.length || !focus.topics.length) directness = body ? 0.75 : 0.3;
  else if (bodyText && !topicConflict) {
    const hit = splitSentences(bodyText).find((s) => hasAny(s, focus.subjects) && focus.topics.some((t) => t.match.test(s) && !(t.conflict && t.conflict.test(s))));
    if (hit) {
      directness = 1;
      directSentence = hit.slice(0, 400);
      reasons.push('선수와 질문 주제가 같은 문장에서 함께 확인됨');
    } else if (subject === 1 && topic === 1) {
      directness = 0.5;
      reasons.push('선수와 주제가 본문에 모두 있으나 같은 문장에서 연결되지는 않음 (간접 근거)');
    }
  } else if (subject > 0 && topic > 0) directness = 0.2;

  // 5) 출처 신뢰도
  const trust = Math.min(1, (TRUST_OF[result.sourceType] ?? 0.5) + (engines >= 2 ? 0.05 : 0));

  // 6) 질문 의도 일치도 — 습관을 물었으면 자료가 반복성을 말해야 의도에 맞다
  let intent = 0.6;
  if (focus.habit) {
    const freq = /(often|frequently|usually|always|habitually|tends? to|signature|go-?to|staple|bread and butter|repeatedly|자주|주로|즐겨|습관적)/i;
    if (bodyText && directSentence && freq.test(directSentence)) {
      intent = 1;
      reasons.push('원문 문장이 빈도 표현을 씀 (습관을 묻는 질문에 맞음)');
    } else if (bodyText && freq.test(bodyText)) intent = 0.7;
    else {
      intent = 0.4;
      reasons.push('자료가 반복·빈도를 말하지 않음 (1회성 서술일 수 있음)');
    }
  } else if (directSentence) intent = 1;
  else if (body) intent = 0.7;

  const axes: RelevanceAxes = { subject, topic, intent, body, trust, directness };
  const score = Math.round(100 * (subject * 0.3 + topic * 0.25 + directness * 0.2 + body * 0.1 + trust * 0.08 + intent * 0.07));

  // 판정: 근거로 쓰려면 본문에서 인물과 주제가 둘 다 확인돼야 한다
  let verdict: RelevanceVerdict;
  if (!subject || (focus.topics.length && !topic) || (!body && subject < 1)) verdict = 'drop';
  else if (body === 1 && subject === 1 && topic === 1 && directness >= 0.5) verdict = 'evidence';
  else verdict = 'reference';
  return { axes, score, verdict, reasons, ...(directSentence ? { directSentence } : {}) };
}


