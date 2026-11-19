import type { FighterProfile, MeasureKind, MeasureMethod, ProfileValue, SectionId } from './types';

// The fields a fighter profile can hold — the APPLICATION decides what is
// asked, in what order, and what a valid value is. The AI only words the
// question and reads the answer (interview.ts).

export type FieldKind = 'choice' | 'multi' | 'text' | 'number' | 'measurement' | 'boolean';

export interface FieldOption {
  value: string;
  label: string;
  /** Words that mean this option in a free answer (deterministic parsing). */
  keywords?: string[];
}

export interface FieldSpec {
  key: string;
  section: SectionId;
  label: string;
  kind: FieldKind;
  options?: FieldOption[];
  unit?: 'cm' | 'kg' | '회';
  min?: number;
  max?: number;
  measureKind?: MeasureKind;
  limb?: 'lead' | 'rear';
  /** The question when nothing earlier changes it. */
  question: string;
  /** Measurement guide / technique explanation for someone who doesn't know the term. */
  help?: string;
  /** Asked only when this holds (gating by earlier answers). */
  when?: (p: FighterProfile) => boolean;
  /** Previous answers that change how the question is worded. */
  ask?: (p: FighterProfile) => string | null;
  /** Arts this field matters for (coach context). Empty = every art. */
  arts?: string[];
  /** Items to re-check when this one changes. */
  related?: string[];
  /** Interview order inside its section (lower first). Not asked in the interview when undefined. */
  order?: number;
  /** Shown/asked only as part of a detailed measurement. */
  detail?: boolean;
}

export const SECTIONS: { id: SectionId; label: string; icon: string }[] = [
  { id: 'training', label: '훈련 경험·목표', icon: '🎯' },
  { id: 'body', label: '기본 신체 정보', icon: '📏' },
  { id: 'striking', label: '타격', icon: '🥊' },
  { id: 'defense', label: '가드·방어', icon: '🛡️' },
  { id: 'movement', label: '이동·경기 습관', icon: '👣' },
  { id: 'grappling', label: '그래플링', icon: '🤼' },
  { id: 'positions', label: '포지션', icon: '🧩' },
  { id: 'style', label: '개인 스타일', icon: '⭐' },
];
export const SECTION_LABEL = Object.fromEntries(SECTIONS.map((s) => [s.id, s.label])) as Record<SectionId, string>;

export const STRIKING_ARTS = ['boxing', 'kickboxing', 'muay-thai', 'taekwondo', 'karate', 'mixed-martial-arts'];
export const KICKING_ARTS = ['kickboxing', 'muay-thai', 'taekwondo', 'karate', 'mixed-martial-arts'];
export const GRAPPLING_ARTS = ['wrestling', 'bjj', 'judo', 'sambo', 'mixed-martial-arts'];
const MMA = 'mixed-martial-arts';

export const ART_OPTIONS: FieldOption[] = [
  { value: 'boxing', label: '복싱', keywords: ['복싱', 'boxing'] },
  { value: 'kickboxing', label: '킥복싱', keywords: ['킥복싱', 'kickboxing', 'k-1', 'k1'] },
  { value: 'muay-thai', label: '무에타이', keywords: ['무에타이', '무에이타이', 'muay'] },
  { value: 'taekwondo', label: '태권도', keywords: ['태권도', 'taekwondo'] },
  { value: 'karate', label: '가라테', keywords: ['가라테', '공수도', 'karate'] },
  { value: 'wrestling', label: '레슬링', keywords: ['레슬링', 'wrestling'] },
  { value: 'bjj', label: '주짓수', keywords: ['주짓수', 'bjj', '브라질리안', 'jiu'] },
  { value: 'judo', label: '유도', keywords: ['유도', 'judo'] },
  { value: 'sambo', label: '삼보', keywords: ['삼보', 'sambo'] },
  { value: MMA, label: 'MMA', keywords: ['mma', '종합격투기', '종합 격투기', '종합'] },
];

// ---- shared option sets
const FREQ: FieldOption[] = [
  { value: 'often', label: '자주', keywords: ['자주', '많이', '항상', '거의 다', '주로', 'often'] },
  { value: 'sometimes', label: '가끔', keywords: ['가끔', '때때로', '종종', '상황에 따라', '필요할 때'] },
  { value: 'rarely', label: '거의 안 함', keywords: ['거의 안', '별로', '드물', '잘 안'] },
  { value: 'never', label: '안 함', keywords: ['안 해', '안해', '안 써', '안써', '전혀', '없어', '안 함'] },
];
const PREF: FieldOption[] = [
  { value: 'favorite', label: '선호 · 주무기', keywords: ['제일 좋아', '주무기', '가장 많이', '특기', '자신 있'] },
  { value: 'use', label: '쓰는 편', keywords: ['쓰는 편', '가끔', '종종', '쓰긴', '써'] },
  { value: 'rarely', label: '거의 안 씀', keywords: ['거의 안', '별로', '잘 안'] },
  { value: 'no', label: '안 씀 · 모름', keywords: ['안 써', '안써', '안 해', '모르', '해본 적 없'] },
];
const LEVEL3: FieldOption[] = [
  { value: 'high', label: '높음', keywords: ['높', '편해', '편하', '자신 있', '좋아', '강해'] },
  { value: 'medium', label: '보통', keywords: ['보통', '그럭저럭', '중간', '애매'] },
  { value: 'low', label: '낮음', keywords: ['낮', '불편', '자신 없', '약해', '싫어', '힘들'] },
];
const LEAD_REAR: FieldOption[] = [
  { value: 'lead', label: '앞손 · 앞발', keywords: ['앞손', '앞발', '리드', '잽', 'lead'] },
  { value: 'rear', label: '뒷손 · 뒷발', keywords: ['뒷손', '뒷발', '리어', '스트레이트', 'rear'] },
  { value: 'both', label: '비슷함', keywords: ['둘 다', '비슷', '양쪽', '상관없'] },
];
const RANGE: FieldOption[] = [
  { value: 'long', label: '먼 거리', keywords: ['먼', '멀리', '장거리', '아웃', '롱'] },
  { value: 'mid', label: '중간 거리', keywords: ['중간', '미들', '중거리'] },
  { value: 'close', label: '가까운 거리', keywords: ['가까', '근거리', '인파이트', '붙어', '안쪽'] },
  { value: 'varies', label: '상황에 따라', keywords: ['상황', '다양', '바꿔', '그때그때'] },
];
const SIDE: FieldOption[] = [
  { value: 'left', label: '왼쪽', keywords: ['왼쪽', '왼'] },
  { value: 'right', label: '오른쪽', keywords: ['오른쪽', '오른'] },
  { value: 'both', label: '양쪽', keywords: ['양쪽', '둘 다', '상관없'] },
];

export const BODY_METHODS: { value: MeasureMethod; label: string }[] = [
  { value: 'tape_helper', label: '다른 사람이 줄자로 측정' },
  { value: 'tape_self', label: '혼자 줄자·벽으로 측정' },
  { value: 'official', label: '대회·체육관 공식 측정' },
  { value: 'estimate', label: '대략 알고 있는 값' },
];
export const STATIC_METHODS: { value: MeasureMethod; label: string }[] = [
  { value: 'wall_static', label: '스탠스에서 벽·표시까지 정지 상태로 뻗어 측정' },
  { value: 'partner_static', label: '파트너가 미트를 대고 정지 상태로 측정' },
  { value: 'estimate', label: '대략 알고 있는 값' },
];
export const DYNAMIC_METHODS: { value: MeasureMethod; label: string }[] = [
  { value: 'floor_marker', label: '바닥 표시에서 실제로 치거나 차서 측정' },
  { value: 'partner_mitt', label: '파트너 미트 거리로 측정' },
  { value: 'video', label: '촬영 영상으로 측정 (오차 있음)' },
  { value: 'estimate', label: '대략 알고 있는 값' },
];
export const METHOD_LABEL: Record<MeasureMethod, string> = Object.fromEntries([...BODY_METHODS, ...STATIC_METHODS, ...DYNAMIC_METHODS].map((m) => [m.value, m.label])) as Record<MeasureMethod, string>;
export const MEASURE_KIND_LABEL: Record<MeasureKind, string> = { body: '신체 치수', static_reach: '정지 상태 도달 거리', dynamic_reach: '실제 동작 중 도달 거리' };

// ---- helpers for gating / wording
export function valueOf(p: FighterProfile, key: string): ProfileValue | null {
  const it = p.items[key];
  return it && !it.deletedAt && it.state === 'answered' ? it.value : null;
}
export function arts(p: FighterProfile): string[] {
  const v = valueOf(p, 'train.arts');
  return Array.isArray(v) ? v : [];
}
const trainsAny = (list: string[]) => (p: FighterProfile) => arts(p).some((a) => list.includes(a));
const trains = (a: string) => (p: FighterProfile) => arts(p).includes(a);
const is = (key: string, ...values: string[]) => (p: FighterProfile) => {
  const v = valueOf(p, key);
  return Array.isArray(v) ? v.some((x) => values.includes(x)) : v !== null && values.includes(String(v));
};
const and = (...fs: ((p: FighterProfile) => boolean)[]) => (p: FighterProfile) => fs.every((f) => f(p));
const stanceLabel = (p: FighterProfile) => ({ orthodox: '오소독스', southpaw: '사우스포', switch: '스위치' })[String(valueOf(p, 'body.stance'))] ?? null;

const BODY_HELP = '줄자로 재는 신체 치수예요. 기술을 쳤을 때 닿는 거리와는 다른 값이라 따로 기록합니다.';
const REACH_STATIC_HELP =
  '정지 상태 도달 거리: 평소 스탠스로 서서 앞발 끝을 바닥 표시에 맞추고, 몸을 앞으로 기울이거나 발을 내딛지 않은 채 기술을 끝까지 뻗었을 때 주먹·발끝이 닿는 지점까지의 바닥 거리(cm)예요. 발을 내딛으며 실제로 친 거리는 "실제 동작 중 도달 거리"로 따로 적습니다.';
const KICK_HELP =
  '평소 스탠스에서 앞발 끝을 바닥 표시에 맞추고, 스텝 없이 그 자리에서 차서 발이 닿는 지점(미트·벽 표시)까지의 거리(cm)예요. 스위치나 스텝을 넣었다면 측정 조건에 적어 주세요.';

function measurement(key: string, label: string, kind: MeasureKind, o: Partial<FieldSpec> = {}): FieldSpec {
  return { key, section: 'body', label, kind: 'measurement', unit: 'cm', min: 20, max: 260, measureKind: kind, question: `${label}를 알고 있나요? 숫자(cm)와 어떻게 쟀는지 알려 주세요.`, ...o };
}

// ---- static fields
const FIELDS: FieldSpec[] = [
  // H. 훈련 경험·목표 (asked first: it decides which sections are relevant)
  { key: 'train.arts', section: 'training', label: '수련 종목', kind: 'multi', options: ART_OPTIONS, order: 1, question: '먼저, 지금 수련하고 있거나 해 본 종목을 알려 주세요. 여러 개여도 괜찮아요.' },
  { key: 'train.years', section: 'training', label: '수련 기간', kind: 'text', order: 2, question: '종목별로 얼마나 수련했나요? (예: 복싱 2년, 주짓수 6개월)', ask: (p) => (arts(p).length > 1 ? `${arts(p).length}개 종목을 하셨군요. 종목별로 얼마나 수련했나요? (예: 복싱 2년, 주짓수 6개월)` : null) },
  { key: 'train.frequency', section: 'training', label: '주당 훈련 횟수', kind: 'number', unit: '회', min: 0, max: 21, order: 3, question: '요즘 일주일에 몇 번 정도 훈련하나요?' },
  { key: 'train.environment', section: 'training', label: '운동 환경', kind: 'choice', order: 4, question: '주로 어디서 훈련하나요? 체육관, 집, 아니면 둘 다인가요?', options: [
    { value: 'gym', label: '체육관', keywords: ['체육관', '도장', '짐', 'gym', '관'] },
    { value: 'home', label: '집', keywords: ['집', '홈', '방'] },
    { value: 'both', label: '둘 다', keywords: ['둘 다', '둘다', '반반', '모두'] },
  ] },
  { key: 'train.equipment', section: 'training', label: '사용 가능한 장비', kind: 'multi', order: 5, question: '쓸 수 있는 장비가 있나요? 샌드백, 미트(파트너), 매트, 거울 같은 것들이요.', options: [
    { value: 'bag', label: '샌드백', keywords: ['샌드백', '백', '헤비백'] },
    { value: 'mitt', label: '미트·파트너', keywords: ['미트', '파트너', '코치'] },
    { value: 'mat', label: '매트', keywords: ['매트'] },
    { value: 'mirror', label: '거울', keywords: ['거울'] },
    { value: 'gloves', label: '글러브', keywords: ['글러브'] },
    { value: 'none', label: '없음', keywords: ['없어', '없음', '맨몸'] },
  ] },
  { key: 'train.methods', section: 'training', label: '선호하는 훈련 방식', kind: 'multi', order: 6, question: '어떤 훈련 방식을 좋아하나요? (스파링, 미트, 샌드백, 드릴, 쉐도우, 롤링, 영상 보며 공부 등)', options: [
    { value: 'sparring', label: '스파링', keywords: ['스파링', '스파'] },
    { value: 'mitt', label: '미트', keywords: ['미트'] },
    { value: 'bag', label: '샌드백', keywords: ['샌드백', '백'] },
    { value: 'drill', label: '드릴·반복', keywords: ['드릴', '반복'] },
    { value: 'shadow', label: '쉐도우', keywords: ['쉐도우', '섀도'] },
    { value: 'rolling', label: '롤링', keywords: ['롤링', '스파링(그래플'] },
    { value: 'video', label: '영상 공부', keywords: ['영상', '유튜브'] },
  ] },
  { key: 'train.canFilm', section: 'training', label: '훈련 영상 촬영 가능', kind: 'boolean', order: 7, question: '훈련할 때 영상을 찍을 수 있나요? (자세 분석에 쓸 수 있어요)' },
  { key: 'train.wantToLearn', section: 'training', label: '배우고 싶은 기술', kind: 'text', order: 50, question: '요즘 특히 배우고 싶은 기술이 있나요?' },
  { key: 'train.improve', section: 'training', label: '개선하고 싶은 부분', kind: 'text', order: 51, question: '스스로 가장 고치고 싶은 부분이나 약하다고 느끼는 부분은 뭔가요?' },
  { key: 'train.goalShort', section: 'training', label: '단기 목표', kind: 'text', order: 52, question: '앞으로 1~3개월 안의 목표가 있나요?' },
  { key: 'train.goalLong', section: 'training', label: '장기 목표', kind: 'text', order: 53, question: '길게 보면 어떤 파이터가 되고 싶나요? (대회, 승급, 취미, 체력 등)' },

  // A. 기본 신체 정보
  { key: 'body.stance', section: 'body', label: '기본 스탠스', kind: 'choice', order: 1, question: '평소 어떤 스탠스를 기본으로 쓰나요? 오소독스(왼발 앞), 사우스포(오른발 앞) 중에서요.', help: '오소독스: 왼발·왼손이 앞. 사우스포: 오른발·오른손이 앞.', related: ['body.stanceSwitch', 'box.comfortHand', 'box.powerHand', 'wr.direction', 'wr.legPreference'], options: [
    { value: 'orthodox', label: '오소독스', keywords: ['오소독스', '오서독스', '왼발 앞', '왼손 앞', 'orthodox'] },
    { value: 'southpaw', label: '사우스포', keywords: ['사우스포', '사우스 포', '오른발 앞', '오른손 앞', 'southpaw'] },
    { value: 'switch', label: '반반 · 스위치', keywords: ['반반', '스위치', '둘 다', '번갈'] },
  ] },
  { key: 'body.stanceSwitch', section: 'body', label: '스탠스 전환 빈도', kind: 'choice', options: FREQ, order: 2, question: '경기나 스파링 중에 스탠스를 바꾸기도 하나요?', ask: (p) => (stanceLabel(p) && valueOf(p, 'body.stance') !== 'switch' ? `${stanceLabel(p)}를 기본으로 쓰시는군요. 상황에 따라 반대 스탠스로도 전환하나요?` : null), related: ['body.switchPurpose'] },
  { key: 'body.switchPurpose', section: 'body', label: '스탠스 전환 목적', kind: 'multi', order: 3, when: (p) => is('body.stanceSwitch', 'often', 'sometimes')(p) || is('body.stance', 'switch')(p), question: '스탠스를 바꾸는 주된 이유는 뭔가요?', options: [
    { value: 'angle', label: '공격 각도 바꾸기', keywords: ['각도', '앵글'] },
    { value: 'confuse', label: '상대 대응 방해', keywords: ['적응', '헷갈', '방해', '혼란', '읽히'] },
    { value: 'power', label: '강한 쪽 손·발 쓰기', keywords: ['강한', '파워', '힘'] },
    { value: 'kick', label: '킥 셋업', keywords: ['킥', '발차기'] },
    { value: 'defense', label: '방어·거리 조절', keywords: ['방어', '거리', '피하'] },
    { value: 'habit', label: '무의식적 습관', keywords: ['습관', '나도 모르게', '무의식'] },
  ] },
  { key: 'body.dominantHand', section: 'body', label: '주로 쓰는 손', kind: 'choice', options: [...SIDE.slice(0, 2), { value: 'both', label: '양손잡이', keywords: ['양손', '둘 다', '양쪽'] }], order: 4, question: '평소 오른손잡이인가요, 왼손잡이인가요?' },
  { key: 'body.dominantFoot', section: 'body', label: '주로 쓰는 발', kind: 'choice', options: SIDE, order: 5, question: '공을 찬다면 주로 어느 발로 차나요?', when: trainsAny([...KICKING_ARTS, ...GRAPPLING_ARTS]) },
  { key: 'body.height', section: 'body', label: '키', kind: 'number', unit: 'cm', min: 100, max: 230, order: 6, question: '키를 알려 줄 수 있나요? (원하지 않으면 건너뛰어도 돼요)' },
  { key: 'body.weight', section: 'body', label: '체중', kind: 'number', unit: 'kg', min: 30, max: 200, order: 7, question: '체중은요? 대략이어도 괜찮아요.' },
  { key: 'body.measureDetail', section: 'body', label: '신체 측정 진행 여부', kind: 'boolean', order: 8, question: '리치(양팔을 펼친 길이) 같은 신체 치수를 재 본 적이 있나요? 있다면 몇 가지 더 물어볼게요.' },
  measurement('body.wingspan', '리치 (양팔을 수평으로 펼친 손끝 사이 거리)', 'body', { order: 9, when: is('body.measureDetail', 'true'), help: `${BODY_HELP} 벽에 등을 대고 양팔을 어깨높이로 수평으로 펼쳐, 왼손 가운뎃손가락 끝부터 오른손 끝까지 잽니다.` }),
  { key: 'body.apeIndex', section: 'body', label: '키 대비 리치 비율', kind: 'number', min: 0.8, max: 1.2, question: '', help: '리치 ÷ 키 — 저장된 키와 리치로 계산한 값이에요 (1보다 크면 키보다 팔이 긴 편).' },
  measurement('body.armLength', '팔 길이 (어깨 끝~가운뎃손가락 끝)', 'body', { order: 10, when: is('body.measureDetail', 'true'), detail: true, help: BODY_HELP }),
  measurement('body.upperArm', '상완 길이 (어깨 끝~팔꿈치)', 'body', { detail: true, help: BODY_HELP }),
  measurement('body.forearm', '전완 길이 (팔꿈치~손목)', 'body', { detail: true, help: BODY_HELP }),
  measurement('body.inseam', '인심 (가랑이~바닥)', 'body', { order: 11, when: and(is('body.measureDetail', 'true'), trainsAny([...KICKING_ARTS, ...GRAPPLING_ARTS])), detail: true, help: BODY_HELP }),
  measurement('body.outseam', '아웃심 (골반 옆 허리선~바닥)', 'body', { detail: true, help: BODY_HELP }),

  // B. 타격 — 복싱
  { key: 'box.favoritePunches', section: 'striking', label: '자주 쓰는 펀치', kind: 'multi', arts: STRIKING_ARTS, order: 1, when: trainsAny(STRIKING_ARTS), question: '펀치에 대해 물어볼게요. 가장 자주 쓰는 펀치는 뭔가요?', ask: (p) => (valueOf(p, 'body.stance') ? '이제 펀치에 대해 물어볼게요. 가장 자주 쓰는 펀치는 뭔가요? (잽, 스트레이트, 훅, 어퍼컷, 오버핸드, 바디 등)' : null), options: [
    { value: 'jab', label: '잽', keywords: ['잽', 'jab'] },
    { value: 'straight', label: '스트레이트', keywords: ['스트레이트', '원투', '크로스', 'straight'] },
    { value: 'leadHook', label: '리드 훅', keywords: ['리드 훅', '앞손 훅', '레프트 훅'] },
    { value: 'rearHook', label: '리어 훅', keywords: ['리어 훅', '뒷손 훅', '라이트 훅'] },
    { value: 'uppercut', label: '어퍼컷', keywords: ['어퍼'] },
    { value: 'overhand', label: '오버핸드', keywords: ['오버핸드'] },
    { value: 'body', label: '바디 펀치', keywords: ['바디', '몸통'] },
  ] },
  { key: 'box.comfortHand', section: 'striking', label: '편한 손', kind: 'choice', options: LEAD_REAR, arts: STRIKING_ARTS, order: 2, when: trainsAny(STRIKING_ARTS), question: '앞손과 뒷손 중 어느 쪽이 더 편하게 나가나요?', ask: (p) => (is('box.favoritePunches', 'jab')(p) && is('box.favoritePunches', 'straight')(p) ? '잽과 스트레이트를 둘 다 많이 쓰시네요. 그중 더 편하게 나가는 쪽은 어느 쪽인가요?' : null) },
  { key: 'box.powerHand', section: 'striking', label: '강하다고 느끼는 손', kind: 'choice', options: [...LEAD_REAR.slice(0, 2), { value: 'both', label: '비슷함 · 잘 모름', keywords: ['비슷', '모르', '둘 다'] }], arts: STRIKING_ARTS, order: 3, when: trainsAny(STRIKING_ARTS), question: '그럼 더 강하다고 느끼는 손은 어느 쪽인가요? (편한 손과 다를 수 있어요)' },
  { key: 'box.preferredRange', section: 'striking', label: '선호하는 공격 거리', kind: 'choice', options: RANGE, arts: STRIKING_ARTS, order: 4, when: trainsAny(STRIKING_ARTS), question: '공격할 때 어느 거리를 가장 좋아하나요? 먼 거리, 중간, 붙어서 싸우는 거리 중에서요.' },
  { key: 'box.combos', section: 'striking', label: '선호하는 펀치 조합', kind: 'text', arts: STRIKING_ARTS, order: 5, when: trainsAny(STRIKING_ARTS), question: '자주 쓰는 펀치 조합이 있나요? (예: 잽-잽-스트레이트, 원투-훅)' },
  { key: 'box.uppercut', section: 'striking', label: '어퍼컷 사용', kind: 'choice', options: FREQ, arts: STRIKING_ARTS, order: 6, when: and(trainsAny(STRIKING_ARTS), (p) => !is('box.favoritePunches', 'uppercut')(p)), question: '어퍼컷은 얼마나 자주 쓰나요?' },
  { key: 'box.afterAttack', section: 'striking', label: '공격 후 이동 습관', kind: 'choice', arts: STRIKING_ARTS, order: 7, when: trainsAny(STRIKING_ARTS), question: '공격을 마친 뒤에는 보통 어떻게 움직이나요?', options: [
    { value: 'stay', label: '그 자리에 머묾', keywords: ['그 자리', '멈춰', '서 있'] },
    { value: 'back', label: '뒤로 빠짐', keywords: ['뒤로', '빠져', '백스텝'] },
    { value: 'angle', label: '각도 빼기', keywords: ['각도', '옆으로', '사이드', '피벗'] },
    { value: 'press', label: '계속 압박', keywords: ['계속', '압박', '들어가', '밀어'] },
    { value: 'clinch', label: '클린치', keywords: ['클린치', '붙어'] },
  ] },
  { key: 'box.counter', section: 'striking', label: '카운터 성향', kind: 'choice', options: FREQ, arts: STRIKING_ARTS, order: 8, when: trainsAny(STRIKING_ARTS), question: '상대가 먼저 들어올 때 카운터를 노리는 편인가요?' },
  { key: 'box.feints', section: 'striking', label: '페인트 활용', kind: 'choice', options: FREQ, arts: STRIKING_ARTS, order: 9, when: trainsAny(STRIKING_ARTS), question: '페인트(속임 동작)는 얼마나 쓰나요?' },
  { key: 'box.rangeMeasured', section: 'striking', label: '펀치 사거리 측정 여부', kind: 'boolean', arts: STRIKING_ARTS, order: 10, when: trainsAny(STRIKING_ARTS), question: '펀치가 닿는 거리를 직접 재 본 적이 있나요? 있다면 잽·스트레이트·훅 사거리를 따로 기록할게요.' },
  { ...measurement('box.range.jab', '잽 사거리', 'static_reach', { order: 11, help: REACH_STATIC_HELP }), section: 'striking', arts: STRIKING_ARTS, limb: 'lead', when: is('box.rangeMeasured', 'true') },
  { ...measurement('box.range.straight', '스트레이트 사거리', 'static_reach', { order: 12, help: REACH_STATIC_HELP }), section: 'striking', arts: STRIKING_ARTS, limb: 'rear', when: is('box.rangeMeasured', 'true') },
  { ...measurement('box.range.leadHook', '리드 훅 사거리', 'static_reach', { help: REACH_STATIC_HELP }), section: 'striking', arts: STRIKING_ARTS, limb: 'lead' },
  { ...measurement('box.range.rearHook', '리어 훅 사거리', 'static_reach', { help: REACH_STATIC_HELP }), section: 'striking', arts: STRIKING_ARTS, limb: 'rear' },

  // B. 타격 — 킥
  { key: 'kick.favorite', section: 'striking', label: '주로 쓰는 킥', kind: 'multi', arts: KICKING_ARTS, order: 20, when: trainsAny(KICKING_ARTS), question: '킥 얘기로 넘어갈게요. 가장 자주 쓰는 킥은 뭔가요?', options: [
    { value: 'leadRound', label: '앞발 라운드킥', keywords: ['앞발 라운드', '앞발 돌려', '리드 라운드', '앞발 킥', '스위치킥'] },
    { value: 'rearRound', label: '뒷발 라운드킥', keywords: ['뒷발 라운드', '뒷발 돌려', '리어 라운드', '라운드킥', '돌려차기'] },
    { value: 'teep', label: '프론트킥 · 티프', keywords: ['프론트', '티프', '앞차기', '밀어차기', 'teep'] },
    { value: 'side', label: '사이드킥', keywords: ['사이드', '옆차기'] },
    { value: 'low', label: '로킥', keywords: ['로킥', '로우킥', '카프'] },
    { value: 'middle', label: '미들킥', keywords: ['미들', '바디킥', '몸통'] },
    { value: 'high', label: '하이킥', keywords: ['하이', '헤드킥', '얼굴'] },
    { value: 'spinning', label: '회전 킥', keywords: ['뒤돌려', '회전', '스피닝', '뒤차기'] },
  ] },
  { key: 'kick.lowKick', section: 'striking', label: '로킥 선호', kind: 'choice', options: PREF, arts: KICKING_ARTS, order: 21, when: and(trainsAny(KICKING_ARTS), (p) => !is('kick.favorite', 'low')(p)), question: '로킥(다리를 차는 킥)은 얼마나 쓰나요?' },
  { key: 'kick.middleKick', section: 'striking', label: '미들킥 선호', kind: 'choice', options: PREF, arts: KICKING_ARTS, order: 22, when: and(trainsAny(KICKING_ARTS), (p) => !is('kick.favorite', 'middle')(p)), question: '미들킥(몸통을 차는 킥)은요?' },
  { key: 'kick.highKick', section: 'striking', label: '하이킥 사용', kind: 'choice', options: FREQ, arts: KICKING_ARTS, order: 23, when: and(trainsAny(KICKING_ARTS), (p) => !is('kick.favorite', 'high')(p)), question: '하이킥은 얼마나 자주 차나요?' },
  { key: 'kick.switchKick', section: 'striking', label: '스위치킥 사용', kind: 'choice', options: FREQ, arts: KICKING_ARTS, order: 24, when: trainsAny(KICKING_ARTS), question: '스위치킥(발을 바꿔 앞발로 차는 킥)은 쓰나요?', help: '앞발과 뒷발 위치를 빠르게 바꾼 뒤 원래 앞발이던 다리로 강하게 차는 킥이에요.' },
  { key: 'kick.recovery', section: 'striking', label: '킥 후 스탠스 복귀 습관', kind: 'choice', arts: KICKING_ARTS, order: 25, when: trainsAny(KICKING_ARTS), question: '킥을 찬 다음 발은 보통 어디로 돌아오나요?', options: [
    { value: 'back', label: '원래 스탠스로 복귀', keywords: ['원래', '제자리', '돌아와', '복귀'] },
    { value: 'forward', label: '앞에 내려놓음', keywords: ['앞에', '앞으로', '내려'] },
    { value: 'switch', label: '반대 스탠스가 됨', keywords: ['반대', '스위치', '바뀌'] },
    { value: 'unbalanced', label: '자주 균형이 무너짐', keywords: ['무너', '흔들', '균형', '넘어'] },
  ] },
  { key: 'kick.feints', section: 'striking', label: '킥 페인트 사용', kind: 'choice', options: FREQ, arts: KICKING_ARTS, order: 26, when: trainsAny(KICKING_ARTS), question: '킥으로 페인트(차는 척)를 걸기도 하나요?' },
  { key: 'kick.preferredRange', section: 'striking', label: '선호하는 킥 거리', kind: 'choice', options: RANGE, arts: KICKING_ARTS, order: 27, when: trainsAny(KICKING_ARTS), question: '킥은 어느 거리에서 차는 게 가장 편한가요?' },
  { key: 'kick.rangeMeasured', section: 'striking', label: '킥 도달 거리 측정 여부', kind: 'boolean', arts: KICKING_ARTS, order: 28, when: trainsAny(KICKING_ARTS), question: '킥이 닿는 거리를 재 본 적이 있나요? 있다면 앞발·뒷발, 킥 종류별로 따로 기록할게요.' },
  ...([
    ['side', '사이드킥'],
    ['front', '프론트킥'],
    ['round', '라운드킥'],
  ] as const).flatMap(([k, name], i) =>
    (['lead', 'rear'] as const).map((limb, j): FieldSpec => ({
      ...measurement(`kick.range.${k}.${limb}`, `${limb === 'lead' ? '앞발' : '뒷발'} ${name} 도달 거리`, 'static_reach', { help: KICK_HELP }),
      section: 'striking',
      arts: KICKING_ARTS,
      limb,
      order: 29 + i * 2 + j,
      when: is('kick.rangeMeasured', 'true'),
    }))
  ),

  // B. MMA 타격
  { key: 'mma.strikeStyle', section: 'striking', label: 'MMA 거리 타격 방식', kind: 'choice', arts: [MMA], order: 40, when: trains(MMA), question: 'MMA 거리에서는 어떤 식으로 타격하는 편인가요?', options: [
    { value: 'boxing', label: '복싱 위주', keywords: ['복싱', '펀치 위주', '손'] },
    { value: 'kicking', label: '킥 위주', keywords: ['킥', '발'] },
    { value: 'mixed', label: '펀치·킥 섞어서', keywords: ['섞', '골고루', '둘 다'] },
    { value: 'counter', label: '받아치기 위주', keywords: ['카운터', '받아'] },
    { value: 'entry', label: '테이크다운 셋업용', keywords: ['테이크다운', '태클', '잡으'] },
  ] },
  { key: 'mma.punchToKick', section: 'striking', label: '펀치 이후 킥 연결', kind: 'text', arts: [MMA, 'kickboxing', 'muay-thai'], order: 41, when: trainsAny([MMA, 'kickboxing', 'muay-thai']), question: '펀치 다음에 킥으로 이어 가는 연결이 있나요? (예: 원투-로킥)' },
  { key: 'mma.kickToPunch', section: 'striking', label: '킥 이후 펀치 연결', kind: 'text', arts: [MMA, 'kickboxing', 'muay-thai'], order: 42, when: trainsAny([MMA, 'kickboxing', 'muay-thai']), question: '반대로 킥을 찬 다음 펀치로 이어 가나요?' },
  { key: 'mma.clinchEntry', section: 'striking', label: '클린치 진입 성향', kind: 'choice', options: FREQ, arts: [MMA, 'muay-thai'], order: 43, when: trainsAny([MMA, 'muay-thai']), question: '타격하다가 클린치로 들어가는 편인가요?' },
  { key: 'mma.tdAwareness', section: 'striking', label: '타격 중 테이크다운 경계', kind: 'choice', arts: [MMA], order: 44, when: trains(MMA), question: '타격할 때 상대 테이크다운을 어떻게 경계하나요?', options: [
    { value: 'stance', label: '낮은 자세·무게 중심', keywords: ['낮', '자세', '중심'] },
    { value: 'distance', label: '거리 유지', keywords: ['거리'] },
    { value: 'sprawl', label: '스프롤 준비', keywords: ['스프롤'] },
    { value: 'little', label: '별로 신경 못 씀', keywords: ['별로', '못', '안 해', '신경 안'] },
  ] },
  { key: 'mma.cage', section: 'striking', label: '케이지 활용', kind: 'text', arts: [MMA], order: 45, when: trains(MMA), question: '케이지(벽)를 어떻게 활용하나요? 상대를 몰아넣거나, 등을 대고 버티거나, 빠져나오는 방식 등이요.' },

  // C. 가드·방어 — overview (per-entity detail below)
  { key: 'def.main', section: 'defense', label: '자주 쓰는 가드·방어', kind: 'multi', arts: STRIKING_ARTS, order: 1, when: trainsAny(STRIKING_ARTS), question: '방어에 대해 물어볼게요. 주로 어떤 가드나 방어를 쓰나요?' },
  { key: 'def.uncomfortable', section: 'defense', label: '불편한 방어', kind: 'text', arts: STRIKING_ARTS, order: 9, when: trainsAny(STRIKING_ARTS), question: '반대로 쓰기 불편하거나 잘 안 되는 방어가 있나요?' },

  // D. 이동·경기 습관
  { key: 'move.forward', section: 'movement', label: '전진 성향', kind: 'choice', options: FREQ, order: 1, question: '경기 중 앞으로 나가서 압박하는 편인가요?' },
  { key: 'move.backward', section: 'movement', label: '후퇴 성향', kind: 'choice', options: FREQ, order: 2, question: '압박을 받으면 뒤로 물러나는 경우가 많나요?', ask: (p) => (is('move.forward', 'often')(p) ? '앞으로 나가는 편이시군요. 그럼 반대로 상대가 압박해 올 때는 뒤로 물러나는 경우가 많나요?' : null) },
  { key: 'move.lateral', section: 'movement', label: '좌우 이동', kind: 'choice', options: [...SIDE, { value: 'rarely', label: '잘 안 함', keywords: ['잘 안', '별로', '안 해'] }], order: 3, question: '옆으로 움직일 때 주로 어느 쪽으로 도나요?' },
  { key: 'move.pivot', section: 'movement', label: '피벗', kind: 'choice', options: FREQ, order: 4, when: trainsAny(STRIKING_ARTS), question: '피벗(앞발 축으로 몸을 돌려 각도 빼기)을 쓰나요?' },
  { key: 'move.circle', section: 'movement', label: '원형 이동', kind: 'choice', options: FREQ, order: 5, when: trainsAny(STRIKING_ARTS), question: '상대 주위를 돌면서 원을 그리듯 움직이나요?' },
  { key: 'move.distance', section: 'movement', label: '거리 조절 방식', kind: 'text', order: 6, question: '상대와의 거리는 주로 어떻게 조절하나요?' },
  { key: 'move.pressure', section: 'movement', label: '압박 방식', kind: 'text', order: 7, when: is('move.forward', 'often', 'sometimes'), question: '상대를 압박할 때는 어떤 방식으로 몰아붙이나요?' },
  { key: 'move.counterAfterDefense', section: 'movement', label: '수비 후 반격', kind: 'choice', options: FREQ, order: 8, question: '막거나 피한 다음 바로 반격하는 편인가요?' },
  { key: 'move.habits', section: 'movement', label: '무의식적인 습관', kind: 'text', order: 9, question: '코치나 파트너에게 들은 습관이 있나요? (예: 잽 후 손이 내려간다, 턱이 든다)' },
  { key: 'move.byOpponent', section: 'movement', label: '상대에 따라 바뀌는 습관', kind: 'text', order: 10, question: '상대에 따라 싸우는 방식이 바뀌나요? (예: 키 큰 상대, 사우스포 상대, 압박형 상대)' },

  // E. 그래플링 — 레슬링
  ...([
    ['single', '싱글렉', '한쪽 다리를 잡는 태클'],
    ['double', '더블렉', '두 다리를 함께 잡는 태클'],
    ['highCrotch', '하이 크로치', '다리 안쪽 높은 곳을 잡고 들어가는 태클'],
    ['bodyLock', '바디락', '상대 몸통을 두 팔로 감아 잡는 것'],
    ['snapDown', '스냅다운', '상대 머리를 아래로 끌어내리는 것'],
    ['armDrag', '암드래그', '상대 팔을 끌어당기며 등 쪽으로 도는 것'],
    ['legTrip', '레그 트립', '다리를 걸어 넘어뜨리는 것'],
  ] as const).map(([k, name, desc], i): FieldSpec => ({
    key: `wr.${k}`,
    section: 'grappling',
    label: `${name} 선호`,
    kind: 'choice',
    options: PREF,
    arts: ['wrestling', MMA, 'bjj', 'sambo', 'judo'],
    order: i === 0 ? 1 : i === 1 ? 2 : 10 + i,
    when: trainsAny(['wrestling', MMA, 'sambo']),
    question: i === 0 ? `테이크다운 얘기로 넘어갈게요. 싱글렉(${desc})은 얼마나 쓰나요?` : `${name}(${desc})은 어때요?`,
    help: `${name}: ${desc}.`,
  })),
  { key: 'wr.direction', section: 'grappling', label: '테이크다운 선호 방향', kind: 'choice', arts: ['wrestling', MMA, 'sambo'], order: 3, when: and(trainsAny(['wrestling', MMA, 'sambo']), is('wr.single', 'favorite', 'use')), question: '싱글렉은 주로 상대의 어느 쪽 다리를 잡나요? 상대 오른다리, 왼다리 중에서요.', ask: (p) => (is('wr.single', 'favorite')(p) ? '싱글렉을 주무기로 쓰시는군요. 주로 상대의 어느 쪽 다리를 잡나요? 상대 오른다리, 왼다리 중에서요.' : null), options: [
    { value: 'oppRight', label: '상대 오른다리', keywords: ['오른다리', '오른쪽 다리', '오른쪽'] },
    { value: 'oppLeft', label: '상대 왼다리', keywords: ['왼다리', '왼쪽 다리', '왼쪽'] },
    { value: 'both', label: '양쪽 다', keywords: ['양쪽', '둘 다', '상관없'] },
  ] },
  { key: 'wr.legPreference', section: 'grappling', label: '상대 다리별 선호', kind: 'choice', arts: ['wrestling', MMA, 'sambo'], order: 4, when: and(trainsAny(['wrestling', MMA, 'sambo']), is('wr.single', 'favorite', 'use')), question: '상대의 앞다리와 뒷다리 중 어느 쪽을 노리는 편인가요?', options: [
    { value: 'lead', label: '상대 앞다리', keywords: ['앞다리', '앞에 있는', '앞쪽'] },
    { value: 'rear', label: '상대 뒷다리', keywords: ['뒷다리', '뒤에 있는', '뒤쪽'] },
    { value: 'either', label: '상황에 따라', keywords: ['상황', '둘 다', '상관없'] },
  ] },
  { key: 'wr.entry', section: 'grappling', label: '선호하는 진입 방식', kind: 'multi', arts: ['wrestling', MMA, 'sambo'], order: 5, when: trainsAny(['wrestling', MMA, 'sambo']), question: '테이크다운은 주로 어떻게 진입하나요?', options: [
    { value: 'levelChange', label: '타격 후 레벨 체인지', keywords: ['타격', '펀치', '레벨'] },
    { value: 'handFight', label: '핸드 파이팅에서', keywords: ['핸드', '손 싸움', '손싸움', '그립'] },
    { value: 'snap', label: '스냅·페이크로 반응 유도', keywords: ['스냅', '페이크', '반응'] },
    { value: 'counter', label: '상대가 들어올 때 카운터', keywords: ['카운터', '들어올 때'] },
    { value: 'clinch', label: '클린치에서', keywords: ['클린치', '붙어서', '언더훅'] },
  ] },
  { key: 'wr.finish', section: 'grappling', label: '선호하는 마무리', kind: 'choice', arts: ['wrestling', MMA, 'sambo'], order: 6, when: trainsAny(['wrestling', MMA, 'sambo']), question: '다리를 잡은 뒤에는 주로 어떻게 마무리하나요?', options: [
    { value: 'runPipe', label: '런 더 파이프 (다리를 끌며 돌기)', keywords: ['런', '파이프', '돌아'] },
    { value: 'drive', label: '대각선으로 밀기', keywords: ['밀어', '드라이브', '대각'] },
    { value: 'lift', label: '들어 올리기', keywords: ['들어', '리프트', '올려'] },
    { value: 'trip', label: '다리 걸기', keywords: ['걸어', '트립', '걸기'] },
    { value: 'double', label: '더블렉으로 전환', keywords: ['더블', '전환'] },
  ] },
  { key: 'wr.afterTD', section: 'grappling', label: '테이크다운 이후 선호 포지션', kind: 'choice', arts: ['wrestling', MMA, 'sambo', 'bjj'], order: 7, when: trainsAny(['wrestling', MMA, 'sambo', 'bjj']), question: '넘어뜨린 다음엔 어떤 포지션을 잡고 싶나요?', options: [
    { value: 'top', label: '탑 컨트롤 (사이드·마운트)', keywords: ['사이드', '마운트', '탑', '위에서'] },
    { value: 'back', label: '백 테이크', keywords: ['백', '등'] },
    { value: 'ride', label: '라이드 (엎드린 상대 위)', keywords: ['라이드', '엎드'] },
    { value: 'standUp', label: '다시 일어나기', keywords: ['일어나', '스탠딩', '세워'] },
  ] },
  // E. 주짓수
  { key: 'bjj.topBottom', section: 'grappling', label: '탑 / 가드 선호', kind: 'choice', arts: ['bjj', 'judo', 'sambo', MMA], order: 20, when: trainsAny(['bjj', 'judo', 'sambo', MMA]), question: '바닥에서는 위(탑)에서 싸우는 것과 아래(가드)에서 싸우는 것 중 어느 쪽이 편한가요?', options: [
    { value: 'top', label: '탑', keywords: ['위', '탑', '눌러'] },
    { value: 'bottom', label: '가드(바텀)', keywords: ['아래', '가드', '바텀', '밑'] },
    { value: 'both', label: '둘 다 비슷', keywords: ['둘 다', '비슷', '상관없'] },
  ] },
  { key: 'bjj.guards', section: 'grappling', label: '쓰는 가드', kind: 'multi', arts: ['bjj', MMA], order: 21, when: and(trainsAny(['bjj', MMA]), is('bjj.topBottom', 'bottom', 'both')), question: '가드에서는 주로 어떤 가드를 쓰나요?', options: [
    { value: 'closed', label: '클로즈드 가드', keywords: ['클로즈드', '클로즈'] },
    { value: 'half', label: '하프 가드', keywords: ['하프'] },
    { value: 'open', label: '오픈 가드', keywords: ['오픈'] },
    { value: 'butterfly', label: '버터플라이 가드', keywords: ['버터플라이', '나비'] },
    { value: 'dlr', label: '데 라 히바', keywords: ['데라', '드라', 'dlr', '히바'] },
    { value: 'spider', label: '스파이더·라쏘', keywords: ['스파이더', '라쏘'] },
    { value: 'x', label: 'X·SLX', keywords: ['x가드', 'slx', '싱글레그 x'] },
  ] },
  { key: 'bjj.sweeps', section: 'grappling', label: '스윕 선호', kind: 'text', arts: ['bjj', MMA], order: 22, when: and(trainsAny(['bjj', MMA]), is('bjj.topBottom', 'bottom', 'both')), question: '자주 쓰는 스윕이 있나요?' },
  { key: 'bjj.passing', section: 'grappling', label: '가드 패스 선호', kind: 'text', arts: ['bjj', MMA], order: 23, when: and(trainsAny(['bjj', MMA]), is('bjj.topBottom', 'top', 'both')), question: '가드를 넘을 때는 주로 어떤 패스를 쓰나요? (니 컷, 토레안도, 스택 등)' },
  { key: 'bjj.escapes', section: 'grappling', label: '이스케이프 선호', kind: 'text', arts: ['bjj', 'judo', 'sambo', 'wrestling', MMA], order: 24, when: trainsAny(GRAPPLING_ARTS), question: '깔렸을 때 주로 쓰는 탈출 방법이 있나요? (새우빼기, 브리지, 언더훅 등)' },
  { key: 'bjj.subs', section: 'grappling', label: '서브미션 선호', kind: 'multi', arts: ['bjj', 'judo', 'sambo', MMA], order: 25, when: trainsAny(['bjj', 'judo', 'sambo', MMA]), question: '자주 노리는 서브미션은 뭔가요?', options: [
    { value: 'rnc', label: '리어 네이키드 초크', keywords: ['리어', '네이키드', 'rnc', '뒤에서 조르'] },
    { value: 'guillotine', label: '길로틴', keywords: ['길로틴'] },
    { value: 'triangle', label: '트라이앵글', keywords: ['트라이앵글', '삼각'] },
    { value: 'armbar', label: '암바', keywords: ['암바', '팔 꺾', '팔꺾'] },
    { value: 'kimura', label: '기무라', keywords: ['기무라', '키무라'] },
    { value: 'armTriangle', label: '암 트라이앵글', keywords: ['암 트라이앵글', '암트라이앵글', '어깨 조르기'] },
    { value: 'leglock', label: '레그락', keywords: ['레그락', '힐훅', '앵클', '니바'] },
    { value: 'collar', label: '깃 조르기', keywords: ['깃', '칼라', '라펠'] },
  ] },
  { key: 'bjj.favorites', section: 'grappling', label: '자주 쓰는 그래플링 기술', kind: 'text', arts: GRAPPLING_ARTS, order: 26, when: trainsAny(GRAPPLING_ARTS), question: '그 밖에 그래플링에서 자주 쓰는 기술이 있나요?' },
  // E. MMA 그래플링
  { key: 'mmag.cageWrestling', section: 'grappling', label: '케이지 레슬링', kind: 'choice', options: LEVEL3, arts: [MMA], order: 30, when: trains(MMA), question: '케이지에 상대를 몰아넣고 레슬링하는 건 얼마나 편한가요?' },
  { key: 'mmag.cageEscape', section: 'grappling', label: '케이지 탈출', kind: 'text', arts: [MMA], order: 31, when: trains(MMA), question: '반대로 케이지에 등이 붙었을 때는 어떻게 빠져나오나요?' },
  { key: 'mmag.topControl', section: 'grappling', label: '탑 컨트롤', kind: 'choice', options: LEVEL3, arts: [MMA], order: 32, when: trains(MMA), question: '위에서 상대를 눌러 두는 탑 컨트롤은 얼마나 자신 있나요?' },
  { key: 'mmag.gnp', section: 'grappling', label: '그라운드 앤 파운드 선호', kind: 'choice', options: PREF, arts: [MMA], order: 33, when: trains(MMA), question: '위에서 때리는 그라운드 앤 파운드는 얼마나 쓰나요?' },
  { key: 'mmag.guardDefense', section: 'grappling', label: '가드에서의 방어·탈출', kind: 'text', arts: [MMA], order: 34, when: trains(MMA), question: '깔린 상태에서 파운딩을 막고 일어나는 방식이 있나요?' },
  { key: 'mmag.scramble', section: 'grappling', label: '스크램블 성향', kind: 'choice', arts: [MMA, 'wrestling'], order: 35, when: trainsAny([MMA, 'wrestling']), question: '포지션이 무너지는 혼전(스크램블)에서는 어떻게 하는 편인가요?', options: [
    { value: 'standUp', label: '일단 일어남', keywords: ['일어나', '스탠딩'] },
    { value: 'top', label: '위를 잡으려 함', keywords: ['위', '탑'] },
    { value: 'back', label: '백을 노림', keywords: ['백', '등'] },
    { value: 'guard', label: '가드로 정리', keywords: ['가드'] },
  ] },
  { key: 'mmag.strikeGrapple', section: 'grappling', label: '그래플링과 타격 연결', kind: 'text', arts: [MMA], order: 36, when: trains(MMA), question: '타격과 그래플링을 어떻게 이어 가나요? (예: 원투 후 더블렉, 테이크다운 방어 후 엘보)' },

  // F. 포지션 — overview (per-position detail below)
  { key: 'pos.comfortable', section: 'positions', label: '편한 포지션', kind: 'multi', arts: GRAPPLING_ARTS, order: 1, when: trainsAny(GRAPPLING_ARTS), question: '포지션별로 물어볼게요. 가장 편하게 느끼는 포지션은 어디인가요?' },
  { key: 'pos.uncomfortable', section: 'positions', label: '불편한 포지션', kind: 'multi', arts: GRAPPLING_ARTS, order: 2, when: trainsAny(GRAPPLING_ARTS), question: '반대로 가장 불편하거나 자주 당하는 포지션은요?' },
];

// ---- C. per guard / defense
export const DEFENSES: FieldOption[] = [
  { value: 'longGuard', label: '롱가드', keywords: ['롱가드', '롱 가드', '팔을 뻗'] },
  { value: 'highGuard', label: '하이가드', keywords: ['하이가드', '하이 가드', '얼굴 옆'] },
  { value: 'crossArm', label: '크로스암 가드', keywords: ['크로스암', '크로스 암', '팔짱'] },
  { value: 'shell', label: '쉘 가드', keywords: ['쉘', '숄더롤', '숄더 롤', '필리'] },
  { value: 'peekaboo', label: '피카부', keywords: ['피카부', '피크어부'] },
  { value: 'openGuard', label: '오픈 가드 (손 내림)', keywords: ['손 내리', '오픈 가드', '로우 가드'] },
  { value: 'parry', label: '패링', keywords: ['패링', '쳐내'] },
  { value: 'slip', label: '슬립', keywords: ['슬립', '머리 빼'] },
  { value: 'roll', label: '롤', keywords: ['롤링', '롤 '] },
  { value: 'weave', label: '위빙', keywords: ['위빙', '더킹'] },
  { value: 'backstep', label: '백스텝', keywords: ['백스텝', '뒤로'] },
  { value: 'sidestep', label: '사이드스텝', keywords: ['사이드스텝', '옆으로'] },
  { value: 'check', label: '체크 (킥 방어)', keywords: ['체크', '정강이'] },
  { value: 'block', label: '블로킹', keywords: ['블로킹', '막아', '블록'] },
  { value: 'distance', label: '거리 유지', keywords: ['거리'] },
  { value: 'bait', label: '상대 공격 유도', keywords: ['유도', '미끼', '일부러'] },
  { value: 'counter', label: '반격 위주', keywords: ['반격', '카운터'] },
];
const DEF_ATTRS: { attr: string; label: string; kind: FieldKind; options?: FieldOption[]; question: (n: string) => string; interview?: boolean }[] = [
  { attr: 'freq', label: '빈도', kind: 'choice', options: FREQ, question: (n) => `${n}는 얼마나 자주 쓰나요?` },
  { attr: 'situation', label: '쓰는 상황', kind: 'text', question: (n) => `${n}는 주로 어떤 상황에서 쓰나요?`, interview: true },
  { attr: 'discomfort', label: '불편한 상황', kind: 'text', question: (n) => `${n}를 쓸 때 불편하거나 잘 안 되는 상황이 있나요?`, interview: true },
  { attr: 'proscons', label: '스스로 느끼는 장단점', kind: 'text', question: (n) => `${n}의 장단점을 스스로 어떻게 느끼나요?` },
];

// ---- F. per position (top and bottom kept apart)
export const POSITIONS: FieldOption[] = [
  { value: 'mountTop', label: '마운트 (탑)', keywords: ['마운트 탑', '탑 마운트', '마운트 위', '마운트'] },
  { value: 'mountBottom', label: '마운트 (바텀)', keywords: ['바텀 마운트', '마운트 밑', '마운트 아래', '마운트 깔'] },
  { value: 'halfTop', label: '하프가드 (탑)', keywords: ['하프 탑', '하프가드 위'] },
  { value: 'halfBottom', label: '하프가드 (바텀)', keywords: ['하프 바텀', '하프가드 아래', '하프가드', '하프'] },
  { value: 'closedTop', label: '클로즈드 가드 안 (탑)', keywords: ['가드 안', '클로즈드 탑'] },
  { value: 'closedBottom', label: '클로즈드 가드 (바텀)', keywords: ['클로즈드', '클로즈드 가드'] },
  { value: 'sideTop', label: '사이드 컨트롤 (탑)', keywords: ['사이드 탑', '사이드 컨트롤 위', '사이드'] },
  { value: 'sideBottom', label: '사이드 컨트롤 (바텀)', keywords: ['사이드 밑', '사이드 아래', '사이드 깔', '사이드 바텀'] },
  { value: 'backTop', label: '백 컨트롤 (잡은 쪽)', keywords: ['백 컨트롤', '백 잡', '백'] },
  { value: 'backBottom', label: '백 (잡힌 쪽)', keywords: ['백 잡히', '백 당', '등 잡'] },
  { value: 'turtleTop', label: '터틀 (위)', keywords: ['터틀 위'] },
  { value: 'turtleBottom', label: '터틀 (아래)', keywords: ['터틀', '거북'] },
  { value: 'openGuardBottom', label: '오픈 가드 (바텀)', keywords: ['오픈 가드', '오픈가드'] },
  { value: 'clinch', label: '스탠딩 클린치', keywords: ['클린치'] },
  { value: 'cageTop', label: '케이지 (상대를 몰아넣은 쪽)', keywords: ['케이지 몰', '몰아넣'] },
  { value: 'cageBottom', label: '케이지 (등이 붙은 쪽)', keywords: ['케이지 등', '케이지에 붙', '케이지'] },
];
const POS_ATTRS: { attr: string; label: string; kind: FieldKind; options?: FieldOption[]; question: (n: string) => string; on?: 'comfortable' | 'uncomfortable' }[] = [
  { attr: 'comfort', label: '편안함', kind: 'choice', options: LEVEL3, question: (n) => `${n}에서는 얼마나 편한가요?` },
  { attr: 'confidence', label: '자신감', kind: 'choice', options: LEVEL3, question: (n) => `${n}에서의 자신감은 어느 정도인가요?` },
  { attr: 'action', label: '선호하는 행동', kind: 'text', question: (n) => `${n}에서는 주로 무엇을 하려고 하나요?`, on: 'comfortable' },
  { attr: 'techniques', label: '주로 쓰는 기술', kind: 'text', question: (n) => `${n}에서 주로 쓰는 기술은 뭔가요?`, on: 'comfortable' },
  { attr: 'mistakes', label: '자주 하는 실수', kind: 'text', question: (n) => `${n}에서 자주 하는 실수가 있나요?`, on: 'uncomfortable' },
  { attr: 'uncomfortable', label: '불편한 상황', kind: 'text', question: (n) => `${n}에서 특히 불편한 상황은요?` },
  { attr: 'exit', label: '탈출·전환 선호', kind: 'choice', question: (n) => `${n}에서는 빠져나오는 쪽인가요, 다른 포지션으로 전환하는 쪽인가요?`, on: 'uncomfortable', options: [
    { value: 'escape', label: '탈출', keywords: ['탈출', '빠져', '이스케이프', '새우'] },
    { value: 'transition', label: '전환', keywords: ['전환', '바꿔', '돌아', '넘어가'] },
    { value: 'sweep', label: '스윕 · 리버설', keywords: ['스윕', '뒤집', '리버설'] },
    { value: 'stay', label: '버티기', keywords: ['버텨', '버티', '막고'] },
    { value: 'submit', label: '서브미션 노림', keywords: ['서브미션', '조르', '꺾'] },
  ] },
  { attr: 'wantToLearn', label: '배우고 싶은 기술', kind: 'text', question: (n) => `${n}에서 배우고 싶은 기술이 있나요?` },
];

function defenseFields(): FieldSpec[] {
  const main = FIELDS.find((f) => f.key === 'def.main')!;
  main.options = DEFENSES;
  return DEFENSES.flatMap((d, di) =>
    DEF_ATTRS.map((a, ai): FieldSpec => ({
      key: `def.${d.value}.${a.attr}`,
      section: 'defense',
      label: `${d.label} · ${a.label}`,
      kind: a.kind,
      options: a.options,
      arts: STRIKING_ARTS,
      question: a.question(d.label),
      // The interview goes deeper only on the defenses the user said they use (first three).
      order: a.interview ? 2 + di * 0.01 + ai * 0.001 : undefined,
      when: a.interview ? (p) => (Array.isArray(valueOf(p, 'def.main')) ? (valueOf(p, 'def.main') as string[]).slice(0, 3).includes(d.value) : false) : undefined,
    }))
  );
}

function positionFields(): FieldSpec[] {
  for (const k of ['pos.comfortable', 'pos.uncomfortable']) FIELDS.find((f) => f.key === k)!.options = POSITIONS;
  return POSITIONS.flatMap((pos, pi) =>
    POS_ATTRS.map((a, ai): FieldSpec => {
      const listKey = a.on === 'comfortable' ? 'pos.comfortable' : 'pos.uncomfortable';
      return {
        key: `pos.${pos.value}.${a.attr}`,
        section: 'positions',
        label: `${pos.label} · ${a.label}`,
        kind: a.kind,
        options: a.options,
        arts: GRAPPLING_ARTS,
        question: a.question(pos.label),
        order: a.on ? 3 + pi * 0.01 + ai * 0.001 : undefined,
        when: a.on ? (p) => (Array.isArray(valueOf(p, listKey)) ? (valueOf(p, listKey) as string[]).slice(0, 2).includes(pos.value) : false) : undefined,
      };
    })
  );
}

/** 실제 동작 중 도달 거리 — a separate item for every static reach, never merged with it. */
function dynamicReachFields(): FieldSpec[] {
  return FIELDS.filter((f) => f.measureKind === 'static_reach').map((f) => ({
    ...f,
    key: `${f.key}.dynamic`,
    label: `${f.label} (실제 동작 중)`,
    measureKind: 'dynamic_reach' as const,
    order: undefined,
    when: undefined,
    question: `${f.label}를 실제로 움직이며(스텝·체중 이동 포함) 쳤을 때 닿는 거리를 잰 적이 있나요?`,
    help: '실제 동작 중 도달 거리: 스텝과 체중 이동을 포함해 실제로 치거나 찼을 때 닿는 거리예요. 정지 상태 도달 거리와는 다른 값이라 따로 기록하고 서로 비교하지 않습니다. 영상으로 잰 값은 오차가 있어요.',
  }));
}

export const ALL_FIELDS: FieldSpec[] = [...FIELDS, ...dynamicReachFields(), ...defenseFields(), ...positionFields()];
const BY_KEY = new Map(ALL_FIELDS.map((f) => [f.key, f]));
export function fieldOf(key: string): FieldSpec | undefined {
  return BY_KEY.get(key);
}

/** Derived (system_calculated) values — never asked, recomputed from measured items. */
export const DERIVED_KEYS = ['body.apeIndex'] as const;

export function optionLabel(f: FieldSpec, v: string): string {
  return f.options?.find((o) => o.value === v)?.label ?? v;
}

/** A value as the user reads it. */
export function formatValue(f: FieldSpec | undefined, v: ProfileValue | null): string {
  if (v === null || v === undefined) return '';
  if (!f) return Array.isArray(v) ? v.join(', ') : String(v);
  if (Array.isArray(v)) return v.map((x) => optionLabel(f, x)).join(', ');
  if (typeof v === 'boolean') return v ? '예' : '아니요';
  if (typeof v === 'number') return `${v}${f.unit ?? ''}`;
  return f.options ? optionLabel(f, v) : v;
}
