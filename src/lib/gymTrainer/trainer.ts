import type { Technique } from '../../types';
import { GYM_BODY_PART_LABEL } from '../gymTraining/recovery';
import type { GeminiJsonOutcome } from '../userTechniques/geminiJson';

// 헬스 트레이너 — asked during the rest between sets: "자극이 안 와요 / 어깨가 아파요" plus how the
// lifter thinks they are moving. The trainer corrects the form — and when the lifter says their form
// is fine but the symptom says otherwise, it DOUBTS it: concrete yes/no checks for the usual causes
// on that exercise ("어깨와 팔 각도가 90도인가요?") before any correction.
//
// The gym library has no verified per-exercise form text (gymTraining/library.ts), so the guidance
// is the AI's general coaching knowledge — labelled as such, never a diagnosis. Danger signs are
// caught by fixed rules BEFORE the AI, and always end the set.

export type TrainerMode = 'probe' | 'correct' | 'stop' | 'info';

export interface TrainerCheck {
  /** a yes/no question about one concrete detail, e.g. "벤치에서 팔꿈치가 몸통과 90도로 벌어져 있나요?" */
  question: string;
  /** why it matters for the symptom (short) */
  why: string;
}

export interface TrainerReply {
  mode: TrainerMode;
  /** what the trainer says (Korean, polite, 1–4 sentences) */
  message: string;
  /** form checks the lifter answers with 예 / 아니요 / 모르겠어요 */
  checks: TrainerCheck[];
  /** concrete corrections for the next set */
  cues: string[];
  /** next-set adjustment (lower the weight, fewer reps, swap the exercise …) */
  nextSet: string | null;
  /** set when the lifter should stop and/or see a professional */
  safety: string | null;
  source: 'ai' | 'rules';
}

export interface TrainerTurn {
  role: 'user' | 'trainer';
  text: string;
  reply?: TrainerReply;
}

export interface SetContext {
  setNumber: number;
  totalSets: number;
  weightKg: number | null;
  reps: number | null;
  rpe: number | null;
}

// ---------- danger signs (deterministic, before any AI)

const RED_FLAGS: [RegExp, string][] = [
  [/찌릿|전기\s?오|저려|저림|감각이\s?(없|둔)|마비/, '찌릿하거나 저린 느낌은 신경이 눌렸다는 신호일 수 있습니다'],
  [/뚝\s?(소리|하고)|툭\s?소리|딱\s?소리.*아프|빠지는\s?느낌|빠진\s?것\s?같/, '“뚝” 소리나 빠지는 느낌은 인대·힘줄 손상 신호일 수 있습니다'],
  [/(날카로운|찌르는|칼로|극심한|심한|참을\s?수\s?없는)\s?(통증|아픔|고통)|너무\s?아파/, '날카롭거나 심한 통증은 운동으로 해결할 통증이 아닙니다'],
  [/부었|붓기|부어|멍이/, '붓기나 멍은 부상 신호일 수 있습니다'],
  [/가슴\s?(이|이\s?)?(조여|답답|통증)|숨이\s?(안|차서\s?못)|어지러|토할\s?것|실신|눈앞이/, '가슴 답답함·어지러움은 즉시 운동을 멈춰야 하는 신호입니다'],
];

/** A danger sign in what the lifter wrote → always stop (no AI needed). */
export function redFlag(text: string): string | null {
  for (const [re, why] of RED_FLAGS) if (re.test(text)) return why;
  return null;
}

export function stopReply(why: string): TrainerReply {
  return {
    mode: 'stop',
    message: `${why}. 지금 세트는 여기서 멈추고 오늘은 이 부위 운동을 쉬어 주세요.`,
    checks: [],
    cues: [],
    nextSet: '이 운동은 오늘 더 하지 않습니다.',
    safety: '통증이 계속되거나 붓기·저림이 있으면 정형외과·재활 전문가에게 진료를 받아 주세요. AI 트레이너의 조언은 진단이 아닙니다.',
    source: 'rules',
  };
}

// ---------- offline fallback: general checks per body part (when the AI can't be reached)

const GENERAL_CHECKS: Partial<Record<NonNullable<Technique['gymBodyPart']>, TrainerCheck[]>> = {
  chest: [
    { question: '내릴 때 팔꿈치가 몸통과 90도에 가깝게 옆으로 벌어지나요?', why: '팔꿈치가 많이 벌어지면 어깨 앞쪽에 부담이 몰립니다 (보통 45~75도).' },
    { question: '날개뼈를 모아 뒤로 붙인 상태를 끝까지 유지하나요?', why: '날개뼈가 풀리면 가슴 대신 어깨가 일을 합니다.' },
    { question: '바를 가슴 중간~아래쪽(명치 근처)으로 내리나요?', why: '목 쪽으로 내리면 어깨 각도가 커집니다.' },
  ],
  back: [
    { question: '당길 때 손보다 팔꿈치를 먼저 몸 쪽으로 끌어오나요?', why: '손으로 당기면 이두가 먼저 지칩니다.' },
    { question: '마지막에 날개뼈를 뒤·아래로 모으나요?', why: '날개뼈 움직임이 없으면 등 자극이 약합니다.' },
    { question: '허리가 둥글게 말리지 않고 중립을 유지하나요?', why: '허리가 말리면 허리에 부담이 갑니다.' },
  ],
  shoulders: [
    { question: '팔을 올릴 때 어깨가 귀 쪽으로 으쓱 올라가나요?', why: '승모근이 먼저 개입하면 어깨 자극이 줄고 목이 아플 수 있습니다.' },
    { question: '팔을 정확히 옆이 아니라 살짝 앞(약 30도)으로 들어 올리나요?', why: '견갑면에서 움직이면 어깨 관절이 편합니다.' },
  ],
  quads: [
    { question: '앉을 때 무릎이 발끝과 같은 방향을 향하나요?', why: '무릎이 안으로 모이면 무릎 안쪽에 부담이 갑니다.' },
    { question: '발뒤꿈치가 바닥에서 뜨지 않나요?', why: '뒤꿈치가 뜨면 무릎 앞쪽에 하중이 몰립니다.' },
  ],
  hamstrings: [
    { question: '내려갈 때 무릎을 살짝만 굽히고 엉덩이를 뒤로 빼나요?', why: '엉덩이를 빼지 않으면 허리로 들게 됩니다.' },
    { question: '허리가 둥글게 말리지 않나요?', why: '허리가 말리면 햄스트링 대신 허리가 버팁니다.' },
  ],
  glutes: [{ question: '마지막 지점에서 엉덩이를 1초 쥐어짜고 허리를 꺾지 않나요?', why: '허리를 젖히면 둔근 대신 허리에 자극이 갑니다.' }],
  biceps: [{ question: '올릴 때 팔꿈치가 앞뒤로 움직이거나 몸을 흔드나요?', why: '반동을 쓰면 이두 자극이 줄어듭니다.' }],
  triceps: [{ question: '팔꿈치가 바깥으로 벌어지지 않고 고정되어 있나요?', why: '팔꿈치가 벌어지면 어깨와 가슴이 개입합니다.' }],
  lower_back: [{ question: '허리를 과하게 젖히지 않고 중립까지만 올라오나요?', why: '과신전은 허리에 부담을 줍니다.' }],
  abs: [{ question: '허리가 바닥에서 뜨지 않게 복부에 힘을 주고 있나요?', why: '허리가 뜨면 고관절 굴곡근과 허리가 일을 합니다.' }],
};

export function fallbackReply(t: Pick<Technique, 'gymBodyPart'>): TrainerReply {
  const checks = (t.gymBodyPart && GENERAL_CHECKS[t.gymBodyPart]) || [
    { question: '무게를 줄였을 때도 같은 증상이 있나요?', why: '무게가 자세를 무너뜨리는 경우가 많습니다.' },
    { question: '동작 범위 끝에서 반동을 쓰고 있나요?', why: '반동은 목표 근육 대신 관절에 부담을 줍니다.' },
  ];
  return {
    mode: 'probe',
    message: '지금은 AI 트레이너에 연결되지 않아, 이 부위에서 흔히 생기는 자세 문제를 먼저 점검해 볼게요.',
    checks: checks.slice(0, 3),
    cues: [],
    nextSet: '증상이 있으면 다음 세트는 무게를 10~20% 줄여 자세부터 확인해 주세요.',
    safety: null,
    source: 'rules',
  };
}

// ---------- AI

export function exerciseContext(t: Technique, set: SetContext | null): string {
  return [
    `[운동] ${t.name}${t.koreanName && t.koreanName !== t.name ? ` (${t.koreanName})` : ''}`,
    t.gymBodyPart ? `부위: ${GYM_BODY_PART_LABEL[t.gymBodyPart]}` : '',
    t.primaryMuscle ? `주동근: ${t.primaryMuscle}${t.secondaryMuscles?.length ? ` · 보조근: ${t.secondaryMuscles.join(', ')}` : ''}` : '',
    t.gymEquipment?.length ? `장비: ${t.gymEquipment.join(', ')}` : '',
    set ? `[방금 세트] ${set.setNumber}/${set.totalSets}세트${set.weightKg != null ? ` · ${set.weightKg}kg` : ''}${set.reps != null ? ` × ${set.reps}회` : ''}${set.rpe != null ? ` · RPE ${set.rpe}` : ''}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM = [
  '너는 헬스장의 1:1 퍼스널 트레이너다. 회원이 세트 사이 휴식 시간에 "자극이 안 온다", "어디가 아프다"와 지금 자기 자세를 말한다.',
  '규칙:',
  '1) 회원이 "자세는 정확하다/올바르다"고 해도 증상이 있으면 그대로 믿지 않는다. 그 운동에서 그 증상을 일으키는 흔한 원인을 1~3개 골라, 회원이 스스로 확인할 수 있는 구체적인 예/아니요 질문으로 확인한다(mode "probe"). 예: 벤치프레스에서 어깨가 아프면 "내릴 때 어깨와 팔(팔꿈치) 각도가 90도로 벌어져 있나요?", "날개뼈를 모은 채로 유지하나요?", "바를 목 쪽으로 내리나요?".',
  '2) 질문은 숫자·방향·위치처럼 눈으로 확인 가능한 것으로 만든다("자세가 괜찮나요?" 같은 막연한 질문 금지). 이미 대화에서 답한 질문은 다시 묻지 않는다.',
  '3) 원인이 좁혀지면 mode "correct": cues에 다음 세트에서 바로 쓸 교정 지시 2~4개(짧은 명령형), nextSet에 무게·횟수·대체 운동 조정을 쓴다.',
  '4) 날카로운 통증·저림·뚝 소리·붓기·가슴 답답함 등 부상 신호가 보이면 mode "stop", safety에 운동 중단과 전문가 진료 권고를 쓴다. 진단명이나 치료를 단정하지 않는다.',
  '5) 근거 없는 수치나 연구를 지어내지 않는다. 일반적으로 널리 쓰이는 코칭 큐만 쓴다. 모든 문장은 한국어 존댓말, message는 1~4문장.',
  '출력(JSON만): {"mode":"probe"|"correct"|"stop"|"info","message":string,"checks":[{"question":string,"why":string}],"cues":[string],"nextSet":string|null,"safety":string|null}',
].join('\n');

interface RawReply {
  mode?: unknown;
  message?: unknown;
  checks?: unknown;
  cues?: unknown;
  nextSet?: unknown;
  safety?: unknown;
}
const isRaw = (d: unknown): d is RawReply => !!d && typeof d === 'object' && typeof (d as RawReply).message === 'string';
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);

export function normalizeReply(r: RawReply): TrainerReply {
  const mode: TrainerMode = r.mode === 'probe' || r.mode === 'correct' || r.mode === 'stop' || r.mode === 'info' ? r.mode : 'info';
  const checks = Array.isArray(r.checks)
    ? r.checks
        .map((c) => (c && typeof c === 'object' ? { question: str((c as TrainerCheck).question), why: str((c as TrainerCheck).why) ?? '' } : null))
        .filter((c): c is TrainerCheck => !!c && !!c.question)
        .slice(0, 3)
    : [];
  const cues = Array.isArray(r.cues) ? r.cues.map(str).filter((x): x is string => !!x).slice(0, 4) : [];
  return { mode: checks.length && mode === 'info' ? 'probe' : mode, message: str(r.message) ?? '', checks, cues, nextSet: str(r.nextSet), safety: str(r.safety), source: 'ai' };
}

export type AskJson = <T>(p: { systemInstruction: string; contextText: string; question: string; useSearchGrounding?: boolean; validate?: (d: unknown) => d is T }) => Promise<GeminiJsonOutcome<T>>;

async function defaultAskJson(): Promise<AskJson> {
  return (await import('../userTechniques/geminiJson')).askGeminiForJsonWithGrounding;
}

/**
 * One trainer turn. Danger signs → stop (rules). Otherwise the AI reads the exercise, the last set and the
 * whole conversation (so answers to its own checks are taken into account). AI unavailable → general checks.
 */
export async function askTrainer(input: { technique: Technique; set: SetContext | null; history: TrainerTurn[]; userText: string; askJson?: AskJson }): Promise<TrainerReply> {
  const flag = redFlag(input.userText);
  if (flag) return stopReply(flag);
  const ask = input.askJson ?? (await defaultAskJson());
  const convo = [...input.history, { role: 'user' as const, text: input.userText }]
    .map((t) => `${t.role === 'user' ? '회원' : '트레이너'}: ${t.text}${t.reply?.checks.length ? `\n(트레이너 확인 질문: ${t.reply.checks.map((c) => c.question).join(' / ')})` : ''}`)
    .join('\n');
  const r = await ask<RawReply>({
    systemInstruction: SYSTEM,
    contextText: exerciseContext(input.technique, input.set),
    question: `[대화]\n${convo}\n\n위 대화의 마지막 회원 말에 트레이너로서 답해 줘.`,
    useSearchGrounding: false,
    validate: isRaw,
  });
  if (!r.ok) return fallbackReply(input.technique);
  const reply = normalizeReply(r.data);
  if (!reply.message) return fallbackReply(input.technique);
  return reply;
}

/** What a tap on 예 / 아니요 / 모르겠어요 sends back for one check. */
export function answerText(check: TrainerCheck, answer: 'yes' | 'no' | 'unsure'): string {
  return `“${check.question}” → ${answer === 'yes' ? '예' : answer === 'no' ? '아니요' : '잘 모르겠어요'}`;
}
