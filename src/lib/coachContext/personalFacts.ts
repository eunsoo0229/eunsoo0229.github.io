import { getTechnique } from '../loadData';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { WEEKDAY_LABEL } from '../dateUtil';
import { ALL_FIELDS, fieldOf, formatValue } from '../fighterProfile/catalog';
import { effectiveStatus, getProfile, liveItem } from '../fighterProfile/store';
import type { ProfileItem } from '../fighterProfile/types';
import { goalSlots, pastGoals, periodLabel } from '../goals/store';
import { listMyGymRoutines } from '../gymRoutine/service';
import { getAllRecords } from '../poseAnalysis/recordsService';
import { listLearnedTechniques } from '../learnedTechniques/service';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { listTrainingHistory } from '../trainingHistory/service';
import type { TrainingHistoryEntry } from '../trainingHistory/types';

// "내 리치가 얼마야?" · "이번 주 목표가 뭐였지?" · "내 루틴 보여 줘" · "최근 훈련 기록" · "내 자세 측정 결과" — questions whose
// answer IS a stored value. Code reads the store (its public API, never raw keys) and writes the answer; no model
// paraphrases a number. Every answer names where the value came from, says plainly when nothing is stored, and
// tells "읽지 못함" apart from "저장된 값 없음". Nothing here writes: a value the user only SAID in the chat is not in
// the profile until they save it, and the answer says so.

export type PersonalFactQuery =
  | { kind: 'profile'; keys: string[]; label: string }
  | { kind: 'goals'; slot: 'week' | 'month' | 'year' | 'next_year' | 'long_term' | 'past' | 'all'; progress: boolean }
  | { kind: 'routine' }
  | { kind: 'training'; period: 'recent' | 'week' | 'month' }
  | { kind: 'pose' };

export interface PersonalFactAnswer {
  text: string;
  /** Stores read for this answer (shown as the answer's 근거). */
  stores: string[];
  /** A store threw — the answer says it could not be read (NOT "nothing stored"). */
  loadFailed: boolean;
}

const MINE = /(내|나의|제|저의|난|나는|내가|제가)\s?/;
// asking the coach to MAKE / CHANGE something from the data is not a lookup — that goes to the coach with the context
const ACTION = /(만들어|짜 ?줘|짜줘|추천|개선|바꿔|수정|고쳐|계획|맞춰|맞게|활용해|분석해|조언|어떻게 해야)/;

const PROFILE_TOPICS: { re: RegExp; label: string; keys: string[] }[] = [
  { re: /(킥|발차기).{0,4}(리치|거리|사거리)/, label: '킥 도달 거리', keys: ['kick.range.', 'kick.preferredRange'] },
  { re: /(펀치|주먹).{0,4}(리치|거리|사거리)/, label: '펀치 사거리', keys: ['box.range.', 'box.preferredRange'] },
  { re: /(리치|윙스팬|양팔.{0,4}길이)/, label: '리치', keys: ['body.wingspan', 'body.apeIndex'] },
  { re: /(다리\s*길이)/, label: '다리 길이', keys: ['body.inseam'] },
  { re: /(팔\s*길이)/, label: '팔 길이', keys: ['body.armLength'] },
  { re: /(신장|키가|키는|키\s*(얼마|몇)|키$)/, label: '키', keys: ['body.height'] },
  { re: /(체중|몸무게)/, label: '체중', keys: ['body.weight'] },
  { re: /(스탠스|사우스포|오소독스|스위칭)/, label: '스탠스', keys: ['body.stance', 'body.stanceSwitch', 'body.switchPurpose'] },
  { re: /(가드|방어 (방식|스타일))/, label: '가드·방어', keys: ['def.main', 'def.uncomfortable'] },
  { re: /(선호|좋아하는|편한).{0,6}거리/, label: '선호하는 거리', keys: ['box.preferredRange', 'kick.preferredRange'] },
  { re: /(주로|잘)\s*쓰는\s*손|주손|오른손잡이|왼손잡이/, label: '주로 쓰는 손', keys: ['body.dominantHand'] },
  { re: /(주로|잘)\s*쓰는\s*발|주발/, label: '주로 쓰는 발', keys: ['body.dominantFoot'] },
  { re: /(주력|선호|좋아하는|자주 쓰는|특기).{0,4}(기술|펀치|킥|무기)/, label: '선호 기술', keys: ['box.favoritePunches', 'kick.favorite', 'wr.single', 'wr.double'] },
  { re: /(수련|운동|훈련).{0,4}(경력|기간|몇 년)/, label: '수련 경력', keys: ['train.years', 'train.arts'] },
  { re: /(강점|약점|보완|부족한 점|고치고 싶)/, label: '스스로 적은 보완점', keys: ['train.improve', 'def.uncomfortable', 'pos.uncomfortable'] },
  { re: /(파이팅\s*)?스타일/, label: '스타일', keys: ['style'] },
];

/** Which stored-value question this is, or null (then the coach answers with the context). */
export function personalFactQuery(text: string): PersonalFactQuery | null {
  const t = text.trim();
  if (ACTION.test(t)) return null;
  if (/목표/.test(t) && !/(기술|선수).{0,4}목표/.test(t)) {
    const progress = /(달성|진행|얼마나|퍼센트|%|진척)/.test(t);
    const slot = /이번\s*주/.test(t)
      ? 'week'
      : /이번\s*달/.test(t)
        ? 'month'
        : /(올해|금년|올\s*해)/.test(t)
          ? 'year'
          : /내년/.test(t)
            ? 'next_year'
            : /(장기|앞으로|미래)/.test(t)
              ? 'long_term'
              : /(지난|과거|예전|이전)/.test(t)
                ? 'past'
                : 'all';
    return { kind: 'goals', slot, progress };
  }
  if (!MINE.test(t)) return null;
  if (/루틴|운동\s*계획|훈련\s*계획표/.test(t)) return { kind: 'routine' };
  if (/(자세|폼).{0,4}(측정|분석|점수|결과)|측정\s*(결과|기록)/.test(t)) return { kind: 'pose' };
  if (/(훈련|운동|연습).{0,4}(기록|내역|이력|했|한 거)|최근.{0,6}(훈련|운동|연습)/.test(t)) {
    return { kind: 'training', period: /이번\s*주/.test(t) ? 'week' : /이번\s*달/.test(t) ? 'month' : 'recent' };
  }
  for (const topic of PROFILE_TOPICS) if (topic.re.test(t)) return { kind: 'profile', keys: topic.keys, label: topic.label };
  return null;
}

const SOURCE_LABEL: Record<ProfileItem['source'], string> = {
  self_report: '본인 답변',
  measured: '직접 측정',
  video_observed: '영상 관찰',
  system_calculated: '저장된 값으로 계산',
  coach_inferred: 'AI 추론 (사용자 확인 필요)',
};
const day = (iso: string) => iso.slice(0, 10);
const UNSAVED_NOTE = '대화에서 새로 말씀하신 값은 개인 파이터 프로필에 저장하기 전까지 여기에 반영되지 않습니다 (설정 > 개인 파이터 프로필).';

function profileAnswer(q: Extract<PersonalFactQuery, { kind: 'profile' }>, now: Date): PersonalFactAnswer {
  const p = getProfile();
  const lines: string[] = [];
  if (q.keys.includes('style')) {
    const tags = p.style?.tags ?? [];
    if (tags.length) lines.push(`- 스타일: ${tags.map((t) => t.label).join(' · ')} (AI 분석${p.style?.status === 'confirmed' ? ', 사용자 확인함' : ', 사용자 미확인 — 참고만'})`);
  }
  const keys = q.keys.filter((k) => k !== 'style').flatMap((k) => (k.endsWith('.') ? ALL_FIELDS.filter((f) => f.key.startsWith(k)).map((f) => f.key) : [k]));
  let latest = '';
  for (const key of keys) {
    const f = fieldOf(key);
    const it = liveItem(p, key);
    if (!f || !it) continue;
    if (it.updatedAt > latest) latest = it.updatedAt;
    if (it.state === 'unknown') {
      lines.push(`- ${f.label}: 모른다고 답하셨습니다 (미확인)`);
      continue;
    }
    if (it.state !== 'answered' || it.value === null) continue;
    const flags = [SOURCE_LABEL[it.source]];
    if (it.measurement?.measuredAt) flags.push(`측정일 ${it.measurement.measuredAt}`);
    const st = effectiveStatus(it, now.getTime());
    if (st === 'outdated') flags.push('오래된 측정 — 다시 재는 것을 권장');
    if (st === 'needs_review') flags.push('확인 필요');
    lines.push(`- ${f.label}: ${formatValue(f, it.value)}${f.unit && !String(formatValue(f, it.value)).includes(f.unit) ? ` ${f.unit}` : ''} (${flags.join(' · ')})`);
  }
  if (!lines.length) {
    return {
      text: `개인 파이터 프로필에 ${q.label} 정보가 저장되어 있지 않습니다. 추측해서 말씀드리지 않겠습니다.\n프로필(설정 > 개인 파이터 프로필)에서 입력하시면 다음 답변부터 반영됩니다.\n${UNSAVED_NOTE}`,
      stores: ['개인 파이터 프로필'],
      loadFailed: false,
    };
  }
  return {
    text: [`개인 파이터 프로필에 저장된 ${q.label} 정보입니다.`, ...lines, `근거: 개인 파이터 프로필 (이 기기에 저장된 값${latest ? `, 마지막 수정 ${day(latest)}` : ''})`, UNSAVED_NOTE].join('\n'),
    stores: ['개인 파이터 프로필'],
    loadFailed: false,
  };
}

function inPeriod(e: TrainingHistoryEntry, period: 'week' | 'month', now: Date): boolean {
  const d = new Date(`${e.date}T00:00:00`);
  if (period === 'month') return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  const monday = new Date(now);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return d >= monday && d <= now;
}

const SOURCE_NAME: Partial<Record<TrainingHistoryEntry['source'], string>> = {
  curriculum: '커리큘럼',
  coach_today: 'AI 코치 수업',
  sparring: '스파링',
  review: '복습',
  combo: '콤보 훈련',
  shadow: '섀도',
  free_training: '자유 훈련',
  gym_class: '체육관 수업',
  sparring_session: '스파링 세션',
  visual_mitt: '비주얼 미트',
  program: '개인 훈련 프로그램',
};

function trainingLine(e: TrainingHistoryEntry): string {
  const names = e.techniqueIds.slice(0, 4).map((id) => getTechnique(id)?.name ?? id);
  const more = e.techniqueIds.length > 4 ? ` 외 ${e.techniqueIds.length - 4}개` : '';
  const minutes = e.actualMinutes ?? null;
  const parts = [`${e.date} ${SOURCE_NAME[e.source] ?? e.source}`, e.completed ? '완료' : '미완료', names.length ? `${names.join(', ')}${more}` : '', minutes ? `${minutes}분` : '', e.notes ? `메모: "${e.notes.slice(0, 60)}"` : ''];
  return `- ${parts.filter(Boolean).join(' · ')}`;
}

function trainingAnswer(period: 'recent' | 'week' | 'month', now: Date): PersonalFactAnswer {
  const all = listTrainingHistory();
  const list = period === 'recent' ? all.slice(0, 7) : all.filter((e) => inPeriod(e, period, now));
  const label = period === 'week' ? '이번 주' : period === 'month' ? '이번 달' : '최근';
  if (!list.length) return { text: `${label} 저장된 훈련 기록이 없습니다. (앱 밖에서 한 훈련은 기록되지 않습니다)`, stores: ['훈련 기록'], loadFailed: false };
  const done = list.filter((e) => e.completed).length;
  return {
    text: [`${label} 훈련 기록 ${list.length}건 (완료 ${done}건 · 미완료 ${list.length - done}건)${period === 'recent' && all.length > list.length ? ` — 전체 ${all.length}건 중 최근 ${list.length}건` : ''}입니다.`, ...list.slice(0, 10).map(trainingLine), '근거: 훈련 기록 (이 기기에 저장된 기록). 완료 기록은 훈련을 했다는 뜻이며, 기술을 익혔다는 판정은 아닙니다.'].join('\n'),
    stores: ['훈련 기록'],
    loadFailed: false,
  };
}

function goalsAnswer(q: Extract<PersonalFactQuery, { kind: 'goals' }>, now: Date): PersonalFactAnswer {
  const slots = goalSlots(now);
  const lines: string[] = [];
  if (q.slot === 'past') {
    const past = pastGoals(now).slice(0, 6);
    if (!past.length) return { text: '저장된 지난 목표가 없습니다.', stores: ['개인 목표'], loadFailed: false };
    lines.push('지난 기간의 목표입니다 (기간이 지나도 지우지 않고 보관됩니다).', ...past.map((g) => `- ${periodLabel(g)}: ${g.text.slice(0, 300)} (작성 ${day(g.createdAt)}${g.updatedAt !== g.createdAt ? `, 수정 ${day(g.updatedAt)}` : ''})`));
    return { text: [...lines, '근거: 개인 목표 (이 기기에 저장)'].join('\n'), stores: ['개인 목표'], loadFailed: false };
  }
  const wanted = q.slot === 'all' ? slots : slots.filter((s) => s.slot === q.slot);
  for (const s of wanted) {
    if (s.entry?.text.trim()) lines.push(`- ${s.label}: ${s.entry.text.slice(0, 400)} (작성 ${day(s.entry.createdAt)}${s.entry.updatedAt !== s.entry.createdAt ? `, 수정 ${day(s.entry.updatedAt)}` : ''})`);
    else if (q.slot !== 'all') lines.push(`- ${s.label}: 저장된 목표가 없습니다.`);
  }
  if (!lines.length) lines.push('저장된 목표가 없습니다. (개인 목표 화면에서 이번 주 · 이번 달 · 올해 · 내년 · 앞으로의 목표를 적을 수 있습니다)');
  const out = [`저장된 개인 목표입니다.`, ...lines];
  if (q.progress && (q.slot === 'week' || q.slot === 'month')) {
    const period = q.slot;
    const recs = listTrainingHistory().filter((e) => inPeriod(e, period, now));
    const done = recs.filter((e) => e.completed);
    const minutes = done.reduce((n, e) => n + (e.actualMinutes ?? 0), 0);
    const techs = [...new Set(done.flatMap((e) => e.techniqueIds))].map((id) => getTechnique(id)?.name ?? id);
    out.push(
      '',
      `${period === 'week' ? '이번 주' : '이번 달'} 실제 훈련 기록: 완료 ${done.length}회${minutes ? ` · ${minutes}분` : ''}${techs.length ? ` · 연습한 기술 ${techs.slice(0, 8).join(', ')}${techs.length > 8 ? ` 외 ${techs.length - 8}개` : ''}` : ''}.`,
      '목표는 자유 문장으로 저장되어 있고 훈련 기록과 자동으로 연결된 항목이 없어서, 달성률(%)은 계산하지 않았습니다. 위 기록을 목표와 비교해 보시고, 목표에 횟수(예: 주 3회)를 적어 두시면 그 기준으로 셀 수 있습니다.'
    );
  }
  out.push('근거: 개인 목표 · 훈련 기록 (이 기기에 저장)');
  return { text: out.join('\n'), stores: q.progress ? ['개인 목표', '훈련 기록'] : ['개인 목표'], loadFailed: false };
}

function routineAnswer(): PersonalFactAnswer {
  const routines = listMyGymRoutines();
  if (!routines.length) return { text: '저장된 훈련 루틴이 없습니다. (루틴 화면에서 요일별 루틴을 만들 수 있습니다)\nAI가 제안한 계획은 루틴으로 저장되지 않으며, 실제로 한 훈련은 훈련 기록에서만 셉니다.', stores: ['훈련 루틴'], loadFailed: false };
  const sorted = [...routines].sort((a, b) => Number(b.active) - Number(a.active) || b.updatedAt.localeCompare(a.updatedAt));
  const lines: string[] = [];
  for (const r of sorted.slice(0, 3)) {
    lines.push(`■ ${r.name}${r.active ? ' (사용 중)' : ''} — 수정 ${day(r.updatedAt)}`);
    const days = [...r.days].sort((a, b) => a.weekday - b.weekday);
    if (!days.length) lines.push('  (요일별 운동 없음)');
    for (const d of days) {
      const ex = d.exercises.map((x) => {
        const reps = x.targetSeconds ? `${x.targetSeconds}초` : x.targetReps.filter((n) => n !== null).join('/') || '횟수 미정';
        const kg = x.targetWeightKg.filter((n) => n !== null);
        return `${getTechnique(x.techniqueId)?.name ?? x.techniqueId} ${x.targetSets}세트×${reps}${kg.length ? ` (${kg.join('/')}kg)` : ''}`;
      });
      lines.push(`  ${WEEKDAY_LABEL[d.weekday]}: ${ex.join(', ') || '운동 없음'}`);
    }
  }
  return {
    text: [`저장된 훈련 루틴 ${routines.length}개입니다.`, ...lines, '근거: 훈련 루틴 (이 기기에 저장, 사용자가 루틴 화면에서 만든 것). 루틴은 계획이며, 실제로 한 훈련은 훈련 기록으로 확인합니다.'].join('\n'),
    stores: ['훈련 루틴'],
    loadFailed: false,
  };
}

const POSE_STATUS: Record<string, string> = { good: '좋음', average: '보통', needs_improvement: '개선 필요' };
const POSE_METHOD: Record<string, string> = { landmark: '관절 지표 측정', video_compare: '기준 영상 비교', reference_3d: '3D 기준 비교' };

function poseAnswer(): PersonalFactAnswer {
  const recs = [...getAllRecords()].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
  if (!recs.length) return { text: '저장된 자세 측정 기록이 없습니다.', stores: ['자세 측정 기록'], loadFailed: false };
  return {
    text: [`자세 측정 기록 ${recs.length}건 중 최근 ${Math.min(6, recs.length)}건입니다.`, ...recs.slice(0, 6).map((r) => `- ${day(r.analyzedAt)} ${getTechnique(r.techniqueId)?.name ?? r.techniqueId}: ${r.score}점 (${POSE_STATUS[r.status] ?? r.status} · ${POSE_METHOD[r.method ?? 'landmark']}${r.reliability ? ` · 신뢰도 ${({ high: '높음', medium: '보통', low: '낮음' } as const)[r.reliability]}` : ''})`), '근거: 자세 측정 기록 (이 기기에 저장). 점수는 측정 당시 촬영 조건의 결과입니다.'].join('\n'),
    stores: ['자세 측정 기록'],
    loadFailed: false,
  };
}

const STORE_OF: Record<PersonalFactQuery['kind'], string> = { profile: '개인 파이터 프로필', goals: '개인 목표', routine: '훈련 루틴', training: '훈련 기록', pose: '자세 측정 기록' };

// The stores swallow read errors and return "empty" — so before saying "없음" the store's own key is checked to be
// readable. Only these five known keys are touched (never an iteration over martialdex:* — one key holds a token).
const STORE_KEY: Record<PersonalFactQuery['kind'], string> = { profile: 'martialdex:fighter-profile', goals: 'martialdex:training-goals', routine: 'martialdex:gym-routines', training: 'martialdex:training-history', pose: 'martialdex:pose-records' };

function storeReadable(kind: PersonalFactQuery['kind']): boolean {
  try {
    const raw = window.localStorage.getItem(STORE_KEY[kind]);
    if (raw !== null) JSON.parse(raw);
    return true;
  } catch {
    return false;
  }
}

export function answerPersonalFact(q: PersonalFactQuery, now: Date = new Date()): PersonalFactAnswer {
  try {
    if (!storeReadable(q.kind) || (q.kind === 'goals' && q.progress && !storeReadable('training'))) throw new Error('unreadable');
    if (q.kind === 'profile') return profileAnswer(q, now);
    if (q.kind === 'goals') return goalsAnswer(q, now);
    if (q.kind === 'routine') return routineAnswer();
    if (q.kind === 'training') return trainingAnswer(q.period, now);
    return poseAnswer();
  } catch {
    // a store that cannot be read is NOT "nothing stored"
    return { text: `${STORE_OF[q.kind]}을(를) 읽지 못했습니다. 저장된 내용이 없는 것이 아니라 불러오기에 실패한 것이므로, 이 항목은 답하지 않겠습니다. 앱을 다시 열거나 잠시 후 다시 물어봐 주세요.`, stores: [STORE_OF[q.kind]], loadFailed: true };
  }
}

/**
 * 수업 계획에 붙는 "나에게 맞춘 점" — code-written facts about THIS learner and the planned techniques: their recorded
 * mastery (from 연습 · 자세 측정 · 수업 records), the goals that name a planned technique, the stance and the routine's
 * training days. The deterministic planner chose the techniques; this only shows how they meet the learner's data and
 * never claims a fit the data does not show. '' when nothing is stored.
 */
export function lessonFitText(techniqueIds: string[], now: Date = new Date()): string {
  const lines: string[] = [];
  try {
    // keyed by canonical id: a plan's boxing__cross is the canonical kickboxing__cross record
    const learned = new Map(listLearnedTechniques().map((e) => [canonicalTechniqueId(e.technique.id), e]));
    for (const id of techniqueIds) {
      const e = learned.get(canonicalTechniqueId(id));
      const n = getTechnique(id)?.name ?? id;
      if (!e) lines.push(`  - ${n}: 학습 기록 없음 → 처음 배우는 기술로 설명부터 합니다.`);
      else if (e.progress.status === 'proficient') lines.push(`  - ${n}: 숙련 (연습 ${e.progress.practiceCount}회) → 설명은 짧게, 상황 적용·연결 위주로 합니다.`);
      else if (e.progress.status === 'needs_improvement') lines.push(`  - ${n}: 개선 필요${e.progress.latestScore !== null ? ` (최근 자세 점수 ${e.progress.latestScore})` : ''} → 쉬운 단계부터 다시 확인합니다.`);
      else lines.push(`  - ${n}: ${({ learning: '학습 중', average: '보통', not_started: '미학습' } as const)[e.progress.status as 'learning' | 'average' | 'not_started'] ?? e.progress.status} (연습 ${e.progress.practiceCount}회${e.progress.lastPracticedAt ? `, 마지막 ${day(e.progress.lastPracticedAt)}` : ''})`);
    }
  } catch {
    lines.push('  - 배운 기술 기록을 읽지 못했습니다 (숙련도 반영 안 됨).');
  }
  try {
    // the same matcher the coach uses on questions ("잽" → boxing__jab), so a Korean goal finds an English record
    const planned = new Set(techniqueIds);
    for (const s of goalSlots(now)) {
      const text = s.entry?.text ?? '';
      if (!text.trim()) continue;
      const hit = exactTechniquesInText(text, null).matches.find((t) => planned.has(t.id));
      if (hit) lines.push(`  - ${s.label}("${text.slice(0, 40)}")에 ${hit.name}이(가) 있어 이 수업과 연결됩니다.`);
    }
  } catch {
    lines.push('  - 개인 목표를 읽지 못했습니다.');
  }
  try {
    const st = liveItem(getProfile(), 'body.stance');
    if (st?.state === 'answered' && st.value) lines.push(`  - 프로필 스탠스: ${formatValue(fieldOf('body.stance'), st.value)} — 설명의 앞손·앞발을 이 스탠스 기준으로 보세요.`);
  } catch {
    /* profile unreadable — no stance line */
  }
  try {
    const r = listMyGymRoutines().find((x) => x.active);
    if (r?.days.length) lines.push(`  - 사용 중인 루틴 「${r.name}」의 훈련 요일: ${[...r.days].sort((a, b) => a.weekday - b.weekday).map((d) => WEEKDAY_LABEL[d.weekday]).join('·')}`);
  } catch {
    /* routine unreadable */
  }
  return lines.length ? `• 나에게 맞춘 점 (앱에 저장된 기록 기준):\n${lines.join('\n')}` : '';
}

