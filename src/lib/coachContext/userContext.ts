import { programContextLine } from '../trainingProgram/store';
import { buildCoachContext } from '../ai/context';
import { getCoachDayRun } from '../aiCoachDay/sessionStore';
import { listLearningRecords } from '../coachLesson/records';
import { listLessonLog, weakConceptsFromLessons } from '../coachLesson/lessonLog';
import { WEEKDAY_LABEL } from '../dateUtil';
import { profileContextBlock } from '../fighterProfile/coachContext';
import { goalsContext } from '../goals/coachContext';
import { listMyGymRoutines } from '../gymRoutine/service';
import { listLearnedTechniques } from '../learnedTechniques/service';
import { getTechnique } from '../loadData';
import { getNutritionProfile } from '../nutrition/profileService';
import { getAllRecords } from '../poseAnalysis/recordsService';
import { MASTERY_LABEL } from '../skillProgress/types';
import { listTrainingHistory } from '../trainingHistory/service';
import { listMyCombos } from '../combo/service';
import { listMyTactics } from '../tactic/service';
import { listMyUserTechniques } from '../userTechniques/service';
import { listFavorites } from '../userData';
import { listSparringSessions } from '../sparringSession/service';
import { describeMeals, freshnessOf, learnedMap, learnedOf, learningMemoryText } from './coachData';

// 공통 사용자 컨텍스트 — the ONE place that gathers who this learner is before any coach request, so 대화하기 and
// 수업하기 send the same thing instead of each assembling its own half. It only composes stores that already
// exist; it reads and never writes:
//   개인 파이터 프로필  fighterProfile/coachContext (art/topic-filtered)
//   개인 목표          goals/coachContext (이번 주 → 앞으로, priority-ordered)
//   학습 기록          ai/context buildCoachContext (숙련도 · 약점 · 진행 중 커리큘럼 · 최근 훈련)
//   최근 수업          coachLesson/lessonLog
//   (9차) 배운 기술·숙련도(이름별) · 훈련 루틴 · 훈련 메모 · 자세 측정 · 수업 약점/복습 · 진행 중 수업 · 영양 프로필
//   — 질문/수업 주제에 맞는 것만 (topic 선택), 각 줄에 출처와 마지막 수정일. Raw `martialdex:*` keys are never read
//   here (one of them holds the self-AI server token) — only each store's public read API.
//
// Each part is budgeted separately so a long profile can never push the goals out, and each is wrapped: a store
// that throws is reported in `loadErrors` and the others still go. "로딩 실패"와 "데이터 없음"은 구분한다 —
// a part that failed to load is said so in the block, so the model never reports missing data as "none written".

export interface UserCoachContextRequest {
  martialArt?: string | null;
  /** Lesson topic / technique / the user's question — narrows the profile to the relevant attributes. */
  topic?: string | null;
  /** Characters per part (profile, goals, learning). Default 800 / 1000 / 1200. */
  budget?: { profile?: number; goals?: number; learning?: number };
  /** Recent finished lessons to name (default 5, 0 = none). */
  lessons?: number;
  /** Characters for the 9차 detail sections together (default 1400, 0 = none). */
  detailBudget?: number;
  now?: Date;
}

export interface UserCoachContextResult {
  /** '' when the learner has registered nothing at all. */
  text: string;
  /** Which parts actually carried data — for tests and for the UI's "개인화 반영" line. */
  parts: { profile: boolean; goals: boolean; learning: boolean; lessons: boolean; learned: boolean; routine: boolean; training: boolean; pose: boolean; lessonDetail: boolean; activeLesson: boolean; nutrition: boolean; combos: boolean; tactics: boolean; myTechniques: boolean; favorites: boolean; sparring: boolean; meals: boolean; memory: boolean };
  /** Stores that threw (NOT the same as "the user wrote nothing"). */
  loadErrors: string[];
  /** Short, user-facing reason the answer was personalized. */
  summary: string;
}

function safe<T>(name: string, fn: () => T, fallback: T, errors: string[]): T {
  try {
    return fn();
  } catch {
    errors.push(name);
    return fallback;
  }
}

/**
 * Trims a block to WHOLE lines and says what it dropped. A plain `.slice(max)` was wrong here: these blocks open
 * with a fixed 사용 원칙/주의 preamble, so a small budget threw away the actual profile items and kept the
 * boilerplate (it silently dropped 자주 쓰는 가드·방어 / 좌우 이동 from boxing lessons). With `protectHeader` the
 * budget applies to the data lines ("- …") only, so the preamble costs nothing and the number means "how much
 * user data". Anything left out is declared, so the model never reads a cut as "the user has nothing else".
 */
function clipBlock(text: string, max: number, protectHeader = false): string {
  if (!text) return '';
  const lines = text.split('\n');
  let head: string[] = [];
  let rest = lines;
  if (protectHeader) {
    const first = lines.findIndex((l) => l.startsWith('- '));
    if (first > 0) {
      head = lines.slice(0, first);
      rest = lines.slice(first);
    }
  }
  const kept: string[] = [];
  let used = 0;
  let dropped = 0;
  for (const l of rest) {
    if (used + l.length > max && (kept.length || head.length)) {
      dropped++;
      continue;
    }
    used += l.length + 1;
    kept.push(l);
  }
  return [...head, ...kept, ...(dropped ? [`(분량 제한으로 ${dropped}줄 생략 — 저장된 내용이 더 있다는 뜻이므로 "없다"고 답하지 않는다)`] : [])].join('\n');
}

export function userCoachContext(req: UserCoachContextRequest = {}): UserCoachContextResult {
  const art = req.martialArt ?? null;
  const topic = req.topic ?? null;
  const b = req.budget ?? {};
  const loadErrors: string[] = [];

  // budget counts the profile's DATA lines; its 사용 원칙/주의 preamble always goes (clipBlock)
  const profile = safe('개인 파이터 프로필', () => clipBlock(profileContextBlock(art, topic).trim(), b.profile ?? 800, true), '', loadErrors);
  const goals = safe('개인 목표', () => goalsContext({ max: b.goals ?? 1000, now: req.now }), { text: '', slots: [], omitted: [], summary: '' }, loadErrors);
  const learning = safe('학습 기록', () => clipBlock(buildCoachContext().trim(), b.learning ?? 1200), '', loadErrors);
  const lessonCount = req.lessons ?? 5;
  const lessons = safe(
    '수업 기록',
    () =>
      lessonCount > 0
        ? listLessonLog()
            .slice(0, lessonCount)
            .map((l) => `${l.date} ${l.title}`)
        : [],
    [] as string[],
    loadErrors
  );

  const detail = (req.detailBudget ?? 1400) > 0 ? detailSections(topic, req.now ?? new Date(), loadErrors) : [];
  let detailText = '';
  for (const d of detail) {
    if (detailText.length + d.text.length > (req.detailBudget ?? 1400)) continue;
    detailText += `${detailText ? '\n\n' : ''}${d.text}`;
  }
  const has = (id: string) => detail.some((d) => d.id === id && detailText.includes(d.text));
  const parts = { profile: !!profile, goals: !!goals.text, learning: !!learning, lessons: lessons.length > 0, learned: has('learned'), routine: has('routine'), training: has('training'), pose: has('pose'), lessonDetail: has('lessonDetail'), activeLesson: has('activeLesson'), nutrition: has('nutrition'), combos: has('combos'), tactics: has('tactics'), myTechniques: has('myTechniques'), favorites: has('favorites'), sparring: has('sparring'), meals: has('meals'), memory: has('memory') };
  const offline = typeof navigator !== 'undefined' && navigator.onLine === false;
  const sections = [
    profile,
    goals.text,
    learning ? `[학습 기록 — 앱에 저장된 사용자의 실제 기록]\n${learning}` : '',
    lessons.length ? `[최근 수업]\n${lessons.map((l) => `- ${l}`).join('\n')}` : '',
    detailText,
    offline && (profile || goals.text || learning || detailText) ? '[데이터 상태] 현재 오프라인 — 위 내용은 이 기기에 저장된 데이터입니다. 다른 기기에서 바꾼 내용은 아직 반영되지 않았을 수 있습니다.' : '',
    loadErrors.length ? `[불러오지 못한 사용자 데이터] ${loadErrors.join(', ')} — 저장된 내용이 없는 것이 아니라 읽지 못한 것이므로, 이 항목은 "없다"고 단정하지 말고 모른다고 답한다.` : '',
  ].filter(Boolean);

  if (!sections.length) return { text: '', parts, loadErrors, summary: '' };

  return {
    text: sections.join('\n\n'),
    parts,
    loadErrors,
    summary: [goals.summary, parts.profile ? '프로필' : '', parts.learning ? '학습 기록' : ''].filter(Boolean).join(' · '),
  };
}

const day = (iso: string) => iso.slice(0, 10);
const name = (id: string) => getTechnique(id)?.name ?? id;
// which detail sections a question / lesson topic needs (no topic = a lesson or general request: the core ones)
const TOPIC: Record<string, RegExp> = {
  routine: /(루틴|계획|스케줄|요일|주\s*\d+회|웨이트|헬스|시간)/,
  training: /(훈련|운동|연습|기록|최근|빈도|꾸준|달성)/,
  pose: /(자세|폼|측정|점수|분석)/,
  nutrition: /(식단|영양|칼로리|단백질|감량|증량|체중|다이어트)/,
  // 10차 — only when the question / lesson topic is about them (질문별 선택적 검색)
  combos: /(콤보|콤비네이션|조합|연결|셋업)/,
  tactics: /(전술|전략|상황|카운터|대응|거리 싸움)/,
  myTechniques: /(나만의|내가 만든|직접 만든|만든 기술)/,
  favorites: /(즐겨\s*찾기|관심 기술)/,
  sparring: /(스파링|실전|경기|상대|약점|부족)/,
  memory: /(지난|이전|예전|배웠|배운|복습|기억|대화|반복|어려|헷갈)/,
};

/** The 9차 sections — each read through its store's API, labelled with its origin; a store that throws is reported, never guessed. */
function detailSections(topic: string | null, now: Date, errors: string[]): { id: string; text: string }[] {
  const t = topic ?? '';
  const want = (id: keyof typeof TOPIC) => !t || TOPIC[id].test(t);
  const asked = (id: keyof typeof TOPIC) => !!t && TOPIC[id].test(t);
  const out: { id: string; text: string; asked?: boolean }[] = [];
  const add = (id: string, label: string, fn: () => string, first = false) => {
    try {
      const text = fn();
      if (text) out.push({ id, text, asked: first });
    } catch {
      errors.push(label);
    }
  };
  const fresh = (iso: string | null | undefined) => ({ fresh: '최근', aging: '몇 달 전', stale: '오래된 기록', unknown: '날짜 없음' })[freshnessOf(iso)];
  if (asked('combos')) {
    add('combos', '내 콤보', () => {
      const learned = learnedMap();
      const list = listMyCombos().slice(0, 5);
      if (!list.length) return '[내 콤보] 저장된 콤보 없음';
      return ['[내 콤보 — 사용자가 저장 (괄호는 앱 기록의 숙련도)]', ...list.map((c) => `- ${c.name}: ${c.techniqueIds.map((id) => `${name(id)}(${learnedOf(learned, id) ? MASTERY_LABEL[learnedOf(learned, id)!.progress.status] : '기록 없음'})`).join(' → ')} · ${fresh(c.updatedAt)}${c.userId ? '' : ' · 계정에 아직 안 올라감'}`)].join('\n');
    }, true);
  }
  if (asked('tactics')) {
    add('tactics', '내 전술', () => {
      const list = listMyTactics().slice(0, 5);
      if (!list.length) return '[내 전술] 저장된 전술 없음';
      return ['[내 전술 — 사용자가 저장한 "상황 → 기술 순서"]', ...list.map((x) => `- ${x.name}: "${x.situation}" → ${x.techniqueIds.map(name).join(' → ')} · ${fresh(x.updatedAt)}`)].join('\n');
    }, true);
  }
  if (asked('myTechniques')) {
    add('myTechniques', '나만의 기술', () => {
      const list = listMyUserTechniques().slice(0, 6);
      return list.length ? `[나만의 기술 — 사용자가 직접 만든 기술 (MARTIALDEX 공식 기술 아님, 수정·삭제하지 않는다)] ${list.map((r) => `${r.technique.name}(${r.technique.martialArt})`).join(', ')}` : '[나만의 기술] 없음';
    }, true);
  }
  if (asked('favorites')) {
    add('favorites', '즐겨찾기', () => {
      const learned = learnedMap();
      const fav = listFavorites().slice(0, 10);
      return fav.length ? `[즐겨찾기 — 관심 표시일 뿐 숙련도가 아니다] ${fav.map((id) => `${name(id)}(${learnedOf(learned, id) ? MASTERY_LABEL[learnedOf(learned, id)!.progress.status] : '학습 기록 없음'})`).join(', ')}` : '[즐겨찾기] 없음';
    }, true);
  }
  if (asked('sparring')) {
    add('sparring', '스파링 기록', () => {
      const list = [...listSparringSessions()].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 4);
      if (!list.length) return '[스파링 기록] 없음 — 경기 결과·성공률을 만들지 않는다';
      return ['[스파링 기록 — 사용자가 적은 원문 (승패·성공률은 기록되지 않음)]', ...list.map((s) => `- ${s.date} ${s.actualRounds}라운드${(s.usedTechniqueIds ?? []).length ? ` · 사용 ${(s.usedTechniqueIds ?? []).map(name).join(', ')}` : ''}${s.wentWell ? ` · 잘된 점 "${s.wentWell}"` : ''}${s.toImprove ? ` · 개선할 점 "${s.toImprove}"` : ''}`)].join('\n');
    }, true);
  }
  if (t && TOPIC.nutrition.test(t)) add('meals', '식사 기록', () => `[영양 · 식사 기록]\n${describeMeals(now, 5)}`, true);
  if (asked('memory') || (t && /[가-힣A-Za-z]/.test(t))) {
    add('memory', '장기 학습 메모리', () => learningMemoryText(asked('memory') ? null : t), asked('memory'));
  }
  add('activeLesson', '진행 중인 수업', () => {
    const run = getCoachDayRun();
    if (!run || run.finishedAt) return '';
    const done = Object.keys(run.outcomes).map(name);
    return `[진행 중인 AI 코치 수업 — 아직 끝나지 않음] Day ${run.day} · 기술 ${run.techniqueIds.map(name).join(', ')} · 현재 ${name(run.techniqueIds[run.index] ?? '')} (${run.step} 단계)${done.length ? ` · 결과가 기록된 기술: ${done.join(', ')}` : ''} (시작 ${day(run.startedAt)})`;
  });
  add('learned', '배운 기술', () => {
    const list = listLearnedTechniques().slice(0, 12);
    if (!list.length) return '';
    return [
      '[배운 기술과 숙련도 — 앱 기록으로 계산 (최근 연습 순, 최대 12개). 숙련도는 연습·자세 측정·수업 기록으로 계산한 값이며 수업 완료만으로 숙련이 되지 않는다]',
      ...list.map((e) => `- ${e.technique.name}: ${MASTERY_LABEL[e.progress.status]}${e.progress.userOverride ? ' (사용자가 직접 지정)' : ''} · 연습 ${e.progress.practiceCount}회${e.progress.latestScore !== null ? ` · 최근 자세 점수 ${e.progress.latestScore}` : ''}${e.progress.lastPracticedAt ? ` · 마지막 ${day(e.progress.lastPracticedAt)}` : ''}`),
    ].join('\n');
  });
  add('lessonDetail', '수업 기록 상세', () => {
    const weak = weakConceptsFromLessons().slice(0, 6);
    const review = listLearningRecords().filter((r) => r.needsReview.length).slice(0, 5);
    if (!weak.length && !review.length) return '';
    return [
      '[이전 수업에서 남은 과제 — 수업 기록]',
      ...weak.map((w) => `- ${w.name}: "${w.label}" ${w.status === 'weak' ? '이해 부족' : '부분 이해'} (${day(w.at)})`),
      ...review.map((r) => `- 복습 필요: ${r.techniqueName} — ${r.needsReview.slice(0, 3).join(', ')}`),
    ].join('\n');
  });
  if (want('routine')) {
    add('routine', '훈련 루틴', () => {
      const r = listMyGymRoutines().find((x) => x.active) ?? listMyGymRoutines()[0];
      if (!r) return '';
      const days = [...r.days].sort((a, b) => a.weekday - b.weekday).map((d) => `${WEEKDAY_LABEL[d.weekday]} ${d.exercises.map((x) => `${name(x.techniqueId)} ${x.targetSets}세트`).join(', ') || '휴식'}`);
      return `[훈련 루틴 — 사용자가 루틴 화면에서 만든 계획 (실제 수행 기록 아님)] ${r.name}${r.active ? ' (사용 중)' : ''}, 수정 ${day(r.updatedAt)}: ${days.join(' / ') || '요일별 운동 없음'}`;
    });
    add('program', '개인 훈련 프로그램', () => programContextLine(now));
  }
  if (want('training')) {
    add('training', '훈련 기록', () => {
      const recent = listTrainingHistory().filter((e) => e.notes?.trim()).slice(0, 4);
      const month = listTrainingHistory().filter((e) => e.date.slice(0, 7) === now.toISOString().slice(0, 7));
      if (!recent.length && !month.length) return '';
      const lines = [`[훈련 기록 상세 — 사용자가 실제로 기록한 훈련] 이번 달 ${month.length}건 (완료 ${month.filter((e) => e.completed).length}건)`];
      for (const e of recent) lines.push(`- ${e.date} 메모: "${(e.notes ?? '').slice(0, 80)}"`);
      return lines.join('\n');
    });
  }
  if (want('pose')) {
    add('pose', '자세 측정 기록', () => {
      const recs = [...getAllRecords()].sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt)).slice(0, 5);
      if (!recs.length) return '';
      return ['[자세 측정 기록 — 최근 5건]', ...recs.map((r) => `- ${day(r.analyzedAt)} ${name(r.techniqueId)} ${r.score}점`)].join('\n');
    });
  }
  if (t && TOPIC.nutrition.test(t)) {
    add('nutrition', '영양 프로필', () => {
      const n = getNutritionProfile();
      const bits = [n.goalType ? `목표 ${n.goalType}` : '', n.bodyWeightKg ? `체중 ${n.bodyWeightKg}kg` : '', n.calorieGoal ? `칼로리 목표 ${n.calorieGoal}kcal` : '', n.proteinGoalG ? `단백질 ${n.proteinGoalG}g` : ''].filter(Boolean);
      return bits.length ? `[영양 프로필 — 사용자가 입력] ${bits.join(' · ')} (수정 ${day(n.updatedAt)})` : '';
    });
  }
  // what the question asked about goes first, so the budget never cuts it off
  return [...out.filter((x) => x.asked), ...out.filter((x) => !x.asked)];
}

/** The block to append to a coach request's context ('' when the learner has registered nothing). */
export function userCoachContextBlock(req: UserCoachContextRequest = {}): string {
  try {
    const c = userCoachContext(req);
    return c.text ? `\n\n${c.text}` : '';
  } catch {
    return '';
  }
}
