// 기술 평가 항목 카탈로그 — DB 체크 제약(0056 technique_evaluations.criteria)과 같은 키 목록.
// 종목마다 기본 템플릿을 주되, 작성자가 항목을 골라 바꿀 수 있다(모든 기술에 같은 항목을 강제하지 않음).

export const CRITERIA = {
  stance: { label: '자세', hint: '스탠스·체중 배분' },
  balance: { label: '균형', hint: '동작 중·후 중심 유지' },
  accuracy: { label: '동작 정확성', hint: '궤적·타격면·관절 각도' },
  distance: { label: '거리 조절', hint: '들어가고 빠지는 거리' },
  timing: { label: '타이밍', hint: '상대 움직임에 맞춘 시점' },
  speed: { label: '속도', hint: '시작·회수 속도' },
  completeness: { label: '기술 완성도', hint: '처음부터 끝까지의 완성도' },
  power: { label: '힘 전달', hint: '하체→상체 연결' },
  guard: { label: '가드·방어', hint: '동작 중 빈틈' },
  footwork: { label: '풋워크', hint: '발 위치·이동' },
  transition: { label: '연결 동작', hint: '다음 동작으로의 이어짐' },
  control: { label: '컨트롤', hint: '상대 제어·압박' },
  grip: { label: '그립', hint: '잡기 위치·강도' },
  base: { label: '베이스', hint: '무게중심·지지면' },
  recovery: { label: '회수·복귀', hint: '동작 후 원래 자세로 복귀' },
} as const;

export type CriterionKey = keyof typeof CRITERIA;
export const CRITERION_KEYS = Object.keys(CRITERIA) as CriterionKey[];
export const MAX_CRITERIA = 8;

const STRIKING: CriterionKey[] = ['stance', 'balance', 'accuracy', 'distance', 'timing', 'speed', 'recovery'];
const KICKING: CriterionKey[] = ['stance', 'balance', 'accuracy', 'distance', 'timing', 'power', 'recovery'];
const GRAPPLING: CriterionKey[] = ['base', 'grip', 'control', 'transition', 'timing', 'completeness'];
const THROWING: CriterionKey[] = ['grip', 'base', 'balance', 'timing', 'power', 'completeness'];

/** 종목별 기본 템플릿 (기술 DB 의 무술 id 기준). */
export const TEMPLATES: Record<string, CriterionKey[]> = {
  boxing: STRIKING,
  kickboxing: KICKING,
  'muay-thai': KICKING,
  taekwondo: KICKING,
  karate: KICKING,
  bjj: GRAPPLING,
  wrestling: ['base', 'distance', 'timing', 'control', 'transition', 'completeness'],
  judo: THROWING,
  sambo: THROWING,
  'mixed-martial-arts': ['stance', 'distance', 'timing', 'transition', 'control', 'completeness'],
  other: ['stance', 'balance', 'accuracy', 'timing', 'completeness'],
};

export function templateFor(art: string | null | undefined): CriterionKey[] {
  return [...(TEMPLATES[art ?? ''] ?? TEMPLATES.other)];
}

export const EVAL_ARTS: { id: string; label: string }[] = [
  { id: 'boxing', label: '복싱' },
  { id: 'kickboxing', label: '킥복싱' },
  { id: 'muay-thai', label: '무에타이' },
  { id: 'bjj', label: '주짓수' },
  { id: 'wrestling', label: '레슬링' },
  { id: 'mixed-martial-arts', label: 'MMA' },
  { id: 'judo', label: '유도' },
  { id: 'taekwondo', label: '태권도' },
  { id: 'karate', label: '가라테' },
  { id: 'sambo', label: '삼보' },
  { id: 'other', label: '기타 무술' },
];
export const artLabel = (id: string) => EVAL_ARTS.find((a) => a.id === id)?.label ?? id;

export const TIER_LABEL: Record<string, string> = {
  unverified: '미검증 사용자',
  beginner: '초급 (검증)',
  intermediate: '중급 (검증)',
  advanced: '숙련 (검증)',
  instructor: '검증된 지도자',
};
export const TIER_ORDER = ['unverified', 'beginner', 'intermediate', 'advanced', 'instructor'];

/** 표본 크기 → 신뢰도 표시. 평균을 실력의 절대 점수로 읽지 않도록 항상 함께 보여 준다. */
export function reliabilityOf(n: number): { level: 'none' | 'insufficient' | 'low' | 'moderate' | 'good'; label: string; note: string } {
  if (n === 0) return { level: 'none', label: '평가 없음', note: '아직 참여한 사람이 없습니다.' };
  if (n < 3) return { level: 'insufficient', label: '표본 부족', note: `참여자 ${n}명 — 개인 의견에 가깝습니다. 평균으로 판단하지 마세요.` };
  if (n < 10) return { level: 'low', label: '신뢰도 낮음', note: `참여자 ${n}명 — 참고용입니다.` };
  if (n < 30) return { level: 'moderate', label: '신뢰도 보통', note: `참여자 ${n}명 — 경향을 볼 수 있지만 확정적이지 않습니다.` };
  return { level: 'good', label: '표본 충분', note: `참여자 ${n}명 — 그래도 커뮤니티 의견이며 공식 인증이 아닙니다.` };
}
