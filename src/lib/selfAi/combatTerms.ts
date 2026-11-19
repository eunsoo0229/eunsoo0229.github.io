// 격투기 문맥 용어 해석 (42개 문제 §4). 질문을 기술 DB에서 찾기 전에, 한국어 격투기 현장 용어를
// DB가 아는 이름으로 옮긴다. DB 자체는 바꾸지 않는다 — 조회용 문장과 "이렇게 이해했다"는 안내만 만든다.
//
// 측정(2026-11-15, coachKnowledge/lookup.exactTechniquesInText):
//   "투를 맞추기 위한 셋업"  → karate__mawashi-zuki   (복싱 번호 체계를 몰라 엉뚱한 기술)
//   "허리후리기"             → 찾지 못함              (DB의 유도 하라이고시 한국어명이 '후리기 허리')
//   "슬립 어퍼"              → kickboxing__slip 하나   (슬립→어퍼컷 연결 패턴이 기술 하나로 축소)
//   "페인트에 예민하게 반응" → 웹 검색                (feint 문맥을 못 읽음)
// 단어 하나로 뜻을 정하지 않는다: 번호 펀치는 타격 문맥에서만, '페인트'는 반응·속임 문맥에서만 옮긴다.

export interface CombatReading {
  /** Text for technique lookup (the learner's words replaced by names the DB knows). */
  lookupText: string;
  /** What was understood, in the learner's language — shown with the answer. */
  notes: string[];
  /** Patterns made of several techniques ("슬립 어퍼" = slip → uppercut), kept as one pattern. */
  patterns: { phrase: string; parts: string[] }[];
  /** "페인트" read as a feint (not paint / not a technique search for the word alone). */
  feint: boolean;
}

// 복싱 번호 체계 (오소독스 기준 관례): 1 잽, 2 크로스(뒷손 스트레이트), 3 리드 훅, 4 리어 훅,
// 5 리드 어퍼컷, 6 리어 어퍼컷. 체육관마다 4~6번이 다를 수 있어 1~3만 자동으로 옮기고 안내한다.
const NUMBERED: { re: RegExp; to: string; note: string }[] = [
  { re: /원\s*-?\s*투\s*-?\s*쓰리/g, to: ' 잽 크로스 리드 훅 ', note: "'원투쓰리'를 잽 → 크로스 → 리드 훅(복싱 번호 1-2-3)으로 이해했습니다." },
  { re: /원\s*-?\s*투/g, to: ' 잽 크로스 ', note: "'원투'를 잽 → 크로스(복싱 번호 1-2)로 이해했습니다." },
];
const STRIKE_CONTEXT = /(셋업|콤보|콤비네이션|맞추|맞히|펀치|치(고|는|면|기)|잽|훅|어퍼|스트레이트|복싱|킥복싱|타격|연타)/;
// a standalone "투"/"쓰리" token (with a particle) — never inside another word (투기, 투자, 쓰리쿠션 …)
const LONE_TWO = /(^|[\s,])투(를|을|가|이|는|은|로|도|만|\s|$)/;
const LONE_THREE = /(^|[\s,])쓰리(를|을|가|이|는|은|로|도|만|\s|$)/;

// 복합 공격 패턴 — 기술 하나로 축소하지 않는다
const PATTERNS: { re: RegExp; phrase: string; parts: string[]; lookup: string }[] = [
  { re: /슬립\s*(앤드|&|후|하고|해서)?\s*어퍼(컷)?/, phrase: '슬립 어퍼', parts: ['슬립', '어퍼컷'], lookup: ' 슬립 어퍼컷 ' },
  { re: /더킹\s*(후|하고|해서)?\s*훅/, phrase: '더킹 훅', parts: ['더킹', '훅'], lookup: ' Duck Hook ' },
  { re: /레벨\s*체인지\s*(후|하고)?\s*(더블|싱글)/, phrase: '레벨 체인지 → 태클', parts: ['레벨 체인지', '더블 레그'], lookup: ' Level Change Feint Double Leg ' },
];

// 유도·레슬링 현장 용어 → DB 이름 (DB의 한국어명이 다르게 저장된 경우)
const TERMS: { re: RegExp; to: string; note: string }[] = [
  { re: /허리\s*후리기/g, to: ' Harai Goshi ', note: "'허리후리기'를 유도의 하라이고시(Harai Goshi)로 이해했습니다." },
  { re: /밭다리(\s*걸기)?/g, to: ' Osoto Gari ', note: "'밭다리'를 유도의 오소토가리(Osoto Gari)로 이해했습니다." },
  { re: /안다리(\s*걸기)?/g, to: ' Ouchi Gari ', note: "'안다리'를 유도의 오우치가리(Ouchi Gari)로 이해했습니다." },
  { re: /업어\s*치기/g, to: ' Seoi Nage ', note: "'업어치기'를 유도의 세오이나게(Seoi Nage)로 이해했습니다." },
  { re: /빗당겨\s*치기/g, to: ' Tai Otoshi ', note: "'빗당겨치기'를 유도의 타이오토시(Tai Otoshi)로 이해했습니다." },
];

// '페인트' = feint when it is about being tricked / reacting / drawing a reaction
const FEINT_CONTEXT = /페인트.{0,20}(반응|속|걸려|예민|민감|과민|낚|움찔|당해|쓰|섞|활용|막)|(반응|속|예민).{0,12}페인트/;

export function readCombatTerms(text: string): CombatReading {
  let t = ` ${text} `;
  const notes: string[] = [];
  const patterns: CombatReading['patterns'] = [];
  for (const p of PATTERNS) {
    if (!p.re.test(t)) continue;
    patterns.push({ phrase: p.phrase, parts: p.parts });
    t = t.replace(p.re, p.lookup);
    notes.push(`'${p.phrase}'를 ${p.parts.join(' → ')}로 이어지는 하나의 공격 패턴으로 이해했습니다.`);
  }
  const striking = STRIKE_CONTEXT.test(text);
  for (const n of NUMBERED) {
    if (!n.re.test(t)) continue;
    t = t.replace(n.re, n.to);
    notes.push(n.note);
  }
  if (striking && LONE_TWO.test(t)) {
    t = t.replace(LONE_TWO, '$1 크로스 $2');
    notes.push("'투'를 복싱 번호 2번, 크로스(뒷손 스트레이트)로 이해했습니다. 다른 뜻이면 기술 이름으로 말씀해 주세요.");
  }
  if (striking && LONE_THREE.test(t)) {
    t = t.replace(LONE_THREE, '$1 리드 훅 $2');
    notes.push("'쓰리'를 복싱 번호 3번, 리드 훅으로 이해했습니다.");
  }
  for (const term of TERMS) {
    if (!term.re.test(t)) continue;
    t = t.replace(term.re, term.to);
    notes.push(term.note);
  }
  // "맞추기 위한 / 맞히려면" is the verb "to land", not a technique (it matched karate Mawashi-zuki by sound)
  t = t.replace(/맞(추|히)(기|려|는|고|면|도록|게)\S*/g, ' ');
  const feint = FEINT_CONTEXT.test(text);
  if (feint) notes.push("'페인트'를 상대를 속이는 동작(feint)으로 이해했습니다.");
  return { lookupText: t.replace(/\s+/g, ' ').trim(), notes: [...new Set(notes)], patterns, feint };
}
