import type { Technique } from '../../types';
import { getMartialArt, martialArtSummaries } from '../loadData';
import { techniqueArts } from '../techniqueCanonical';
import { motionForTechnique } from '../visualMitt/archetypes';
import { listVisualizableTechniques } from '../visualMitt/combos';
import { drillPlanFor } from '../soloDrill/moves';
import { isPoseAnalysisSupported } from '../poseAnalysis/poseAnalysisConfig';
import { parseWorkoutSpec } from '../coachLesson/workoutPlan';
import { evidenceFor, exactTechniquesInText, similarlySpelled } from './lookup';
import { domainOf } from './coachPlan';
import { josa } from '../coachLesson/text';

// 자체 AI 코치가 여는 MARTIALDEX 기능 — the app's REAL training features the
// 자체 코치 can open from a sentence ("레슬링 솔로 드릴 하고 싶어"), each with
// the route it really runs on, what it may be given, and whether it calls an
// AI. Checked against the code (2026-10-25):
//   - callable     : opened through its own route; parameters validated here
//   - needs_gemini : exists, but runs on Gemini — the 자체 코치 never opens it
//                    (the student can still use it from its own screen)
//   - not_callable : exists, but has no entry the coach can preset (opened by
//                    the student only)
// Nothing here creates a feature: every route below already exists.

export type CoachFeatureId =
  | 'mitt_command'
  | 'mitt_reaction'
  | 'mitt_technique'
  | 'mitt_setup'
  | 'mitt_combos'
  | 'pose_check'
  | 'review'
  | 'round_timer'
  | 'technique_detail'
  | 'sparring_analysis'
  | 'form_compare'
  | 'situation_recommend'
  | 'combo_training';

export interface CoachFeature {
  id: CoachFeatureId;
  title: string;
  status: 'callable' | 'needs_gemini' | 'not_callable';
  /** Screen it opens (route pattern, documentation). */
  where: string;
  needsCamera?: boolean;
  /** Disclosed before opening: an AI call the FEATURE itself makes when the student uses it. */
  aiNote?: string;
}

export const COACH_FEATURES: Record<CoachFeatureId, CoachFeature> = {
  mitt_command: { id: 'mitt_command', title: '미트 공격 지시 · 솔로 드릴 (무술별 구령)', status: 'callable', where: '/coach/mitt?tab=command&art=<무술>' },
  mitt_reaction: { id: 'mitt_reaction', title: '미트 반응 훈련 (무작위 콤보)', status: 'callable', where: '/coach/mitt?tab=react&art=<무술>' },
  mitt_technique: { id: 'mitt_technique', title: 'Visualizing Mitt 단일 기술 연습', status: 'callable', where: '/coach/mitt?combo=single:<기술>' },
  mitt_setup: { id: 'mitt_setup', title: 'AI Visualizing Mitt', status: 'callable', where: '/coach/mitt' },
  mitt_combos: { id: 'mitt_combos', title: '미트 추천 콤보 (기술 DB 수록 콤보)', status: 'callable', where: '/coach/mitt?tab=db&art=<무술>' },
  pose_check: { id: 'pose_check', title: '내 자세 분석 (카메라, 이 기기에서 분석)', status: 'callable', where: '/arts/<무술>/techniques/<기술>?open=pose', needsCamera: true },
  review: { id: 'review', title: '기술 복습', status: 'callable', where: '/review/session?mode=training&ids=<기술>', aiNote: '복습 답변 채점은 로그인되어 있으면 Gemini를 사용하고, 안 되면 앱 안의 대체 채점으로 진행됩니다.' },
  round_timer: { id: 'round_timer', title: '라운드·휴식 타이머', status: 'callable', where: '/free-training/sparring?mode=timer&round=<초>&rest=<초>&rounds=<횟수>' },
  technique_detail: { id: 'technique_detail', title: '기술 상세', status: 'callable', where: '/arts/<무술>/techniques/<기술>' },
  sparring_analysis: { id: 'sparring_analysis', title: '스파링 영상 분석', status: 'callable', where: '/sparring', aiNote: '영상 분석은 이 기기에서 하고, 분석 결과의 코칭 문장은 로그인되어 있으면 Gemini로 만듭니다.' },
  form_compare: { id: 'form_compare', title: '기준 영상과 자세 비교', status: 'needs_gemini', where: '기술 상세 → "기준 영상과 비교해 평가"' },
  situation_recommend: { id: 'situation_recommend', title: '상황별 기술 추천', status: 'needs_gemini', where: '/situation' },
  combo_training: { id: 'combo_training', title: '콤보 훈련', status: 'not_callable', where: '/combos/<콤보>/train' },
};

export interface ActionContext {
  /** The technique being taught right now (lesson), if any. */
  current?: Technique | null;
  /** Inside a lesson: the coach asks before leaving the lesson screen. */
  inLesson?: boolean;
  /** Device capabilities (defaults: detected). */
  camera?: boolean;
  /** Techniques the coach just listed / recommended — "그거 연습하고 싶어" means one of them. */
  listed?: Technique[];
}

export type CoachAction =
  | {
      ok: true;
      featureId: CoachFeatureId;
      title: string;
      route: string;
      /** What the coach says when opening it. */
      message: string;
      /** Ask before leaving (a lesson is in progress). */
      confirm: boolean;
      /** The technique it is about, if any. */
      techniqueId?: string | null;
      /** What a following "왜?" answers: why this training (the data's own words). */
      why?: string;
    }
  | {
      ok: false;
      featureId: CoachFeatureId | null;
      reason: 'needs_choice' | 'invalid_params' | 'unsupported' | 'needs_gemini' | 'not_callable';
      message: string;
      /** Choices the student can pick (arts / techniques). */
      choices?: { label: string; text: string }[];
    };

// ---------------------------------------------------------------- request parsing

// a wish ("하고 싶어", "할래") or a noun command ending in the training word ("로우킥 미트 연습")
const WANT = /(고\s*싶|할래|해\s*볼래|해볼래|하자|할게|시작해|시작하|열어|켜\s*줘|켜줘|보여\s*줘|보여줘|해\s*줘|해줘|하러|돌려\s*줘|맞춰\s*줘|해\s*주세요|해주세요|원해|(연습|훈련|드릴|미트|패드)\s*[.!~ㅠㅜ]*\s*$)/;
const QUESTION_END = /[?？]\s*$|(나요|까요|가요|ㄹ까|어때|뭐야|뭔가요|있어요?|돼요?|되나)\s*[.!]?\s*$/;
const LESSON = /(배우고\s*싶|배울래|배우자|가르쳐|수업|레슨|강의)/;

const F = {
  solo: /(솔로\s*드릴|구령|섀도\s*(레슬링|드릴)|혼자서?\s*.{0,8}드릴|공격\s*지시|미트\s*콜)/,
  reaction: /(반응\s*훈련|무작위\s*콤보|랜덤\s*콤보)/,
  mitt: /(미트|패드|visualizing|비주얼라이징)/i,
  pose: /(자세\s*(확인|분석|체크|봐|봐줘|점검)|내\s*자세|폼\s*(확인|체크|분석))/,
  compare: /(기준\s*영상|영상과?\s*비교|프로\s*영상.*비교)/,
  sparring: /스파링\s*(영상)?\s*(분석|봐|리뷰)|스파링\s*영상/,
  review: /(복습|다시\s*공부|되짚)/,
  timer: /(타이머|라운드|\d+\s*(분|초)\s*.{0,10}(쉬|휴식|운동|훈련|라운드|하고))/,
  detail: /(기술\s*상세|상세\s*(화면|페이지)|자료\s*(화면|페이지))/,
  situation: /상황별?\s*(기술)?\s*추천/,
  practice: /(연습|훈련|드릴)\s*(하고\s*싶|하고싶|할래|해\s*볼래|해볼래|하자|할게|시작)/,
};

export const ROUND_LIMITS = { round: { min: 10, max: 1800 }, rest: { min: 0, max: 600 }, rounds: { min: 1, max: 20 } };

function hasCamera(ctx: ActionContext): boolean {
  if (typeof ctx.camera === 'boolean') return ctx.camera;
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

const REFERENCE = /^(그거|이거|저거|그걸|이걸|그\s*기술|이\s*기술|방금\s*배운\s*기술|방금\s*거|아까\s*거)$/;
const FILLER_WORDS = new Set(['그럼', '이제', '오늘', '좀', '나', '저', '우리', '한번', '같이', '그냥', '다시', '또', '나도', '바로', '지금']);

/** The words before the training word that should name a technique but name none (and are not an art / a reference / a time). */
function unresolvedName(text: string): string | null {
  const m = /^(.+?)\s*(미트|패드|연습|훈련|드릴|솔로)/.exec(text.trim());
  if (!m) return null;
  // filler words anywhere ("그럼 미트 할래", "오늘 좀 미트") are not a name
  let name = m[1].split(/\s+/).filter((w) => !FILLER_WORDS.has(w)).join(' ').trim();
  name = name.replace(/(으로|로|를|을|에서|도|만)$/, '').trim();
  if (!name || /\d/.test(name) || REFERENCE.test(name) || artIn(name) || /타격|그라운드|스탠딩|그래플링|입식|기본|단일|기술/.test(name)) return null;
  const found = exactTechniquesInText(name, null);
  if (found.matches.length || found.ambiguous.length) return null;
  return name;
}

/** Martial arts the mitt drills can run (arts that have visualizable techniques). */
export function mittArts(): string[] {
  return [...new Set(listVisualizableTechniques().flatMap((t) => techniqueArts(t)))];
}

/** A martial art named in the text ("레슬링", "무에타이", "MMA"). */
export function artIn(text: string): string | null {
  const t = text.toLowerCase().replace(/\s+/g, '');
  const aliases: Record<string, string[]> = { 'mixed-martial-arts': ['mma', '종합격투기'], bjj: ['주짓수', '브라질리언주짓수'] };
  // longest name first: "킥복싱" must not be read as "복싱"
  let best: { id: string; len: number } | null = null;
  for (const a of martialArtSummaries) {
    const names = [a.nameKo, a.nameEn, a.id, ...(aliases[a.id] ?? [])].filter(Boolean).map((n) => String(n).toLowerCase().replace(/\s+/g, ''));
    for (const n of names) if (n.length >= 2 && t.includes(n) && (!best || n.length > best.len)) best = { id: a.id, len: n.length };
  }
  return best?.id ?? null;
}

const artName = (id: string) => getMartialArt(id)?.nameKo ?? id;
const techName = (t: Technique) => evidenceFor(t).displayName; // Korean name from the record or its own data
const enc = encodeURIComponent;

/** The technique a request is about: named in it ("잽 연습"), else "이 기술 / 방금 배운" = the lesson's. */
function techniqueOf(text: string, ctx: ActionContext): { technique: Technique | null; ambiguous: { techniqueId: string; name: string; martialArt: string }[] } {
  const named = exactTechniquesInText(text, null);
  if (named.matches.length === 1) return { technique: named.matches[0], ambiguous: [] };
  if (!named.matches.length && named.ambiguous.length) return { technique: null, ambiguous: named.ambiguous[0].candidates };
  // "그거 / 추천한 거" → the technique the coach just recommended; several → asked, never guessed
  if (!named.matches.length && /그거|그\s*기술|그것|추천(한|해\s*준)/.test(text) && ctx.listed?.length) {
    if (ctx.listed.length === 1) return { technique: ctx.listed[0], ambiguous: [] };
    return { technique: null, ambiguous: ctx.listed.map((t) => ({ techniqueId: t.id, name: techName(t), martialArt: t.martialArt })) };
  }
  return { technique: ctx.current ?? null, ambiguous: [] };
}

function opened(featureId: CoachFeatureId, route: string, message: string, ctx: ActionContext, technique: Technique | null = null): CoachAction {
  const f = COACH_FEATURES[featureId];
  const note = f.aiNote ? ` (${f.aiNote})` : '';
  const lesson = ctx.inLesson ? ' 지금 수업은 저장되어 있어 화면의 뒤로 가기로 돌아오면 이어서 진행됩니다.' : '';
  // "왜?" after opening: what kind of training this is + the technique's own key point
  const kp = technique ? evidenceFor(technique).fields.keyPoints?.values[0] ?? null : null;
  const why = `${josa(f.title, '을/를')} 고른 이유: ${message.replace(/\s*(시간과 속도를|시작 버튼을|콤보를 골라)[^.]*\.\s*$/, '')}${kp ? ` 연습할 때 자료의 핵심 포인트는 "${kp}"입니다.` : ''}`;
  return { ok: true, featureId, title: f.title, route, message: `${message}${note}${lesson}`, confirm: !!ctx.inLesson, techniqueId: technique?.id ?? null, why };
}

/**
 * A training-feature request → a validated action, or null when the text is
 * not a feature request (a technique question, a lesson request, an answer).
 */
export function planCoachAction(text: string, ctx: ActionContext = {}): CoachAction | null {
  const t = text.trim();
  if (!t || QUESTION_END.test(t)) return null;
  const want = WANT.test(t);
  const which = (Object.keys(F) as (keyof typeof F)[]).filter((k) => F[k].test(t));
  if (!want || !which.length) return null;
  // "잽 배우고 싶어" / "수업하고 싶어" is a lesson request, unless a feature is named explicitly.
  if (LESSON.test(t) && !which.some((k) => k !== 'practice')) return null;

  if (which.includes('compare')) {
    return { ok: false, featureId: 'form_compare', reason: 'needs_gemini', message: '기준 영상과 자세 비교는 Gemini를 사용하는 기능이라 자체 AI 코치에서는 열지 않습니다. 이 기기에서 분석하는 "내 자세 분석"은 열 수 있습니다 — "자세 확인하고 싶어"라고 말씀해 주세요.' };
  }
  if (which.includes('situation')) {
    return { ok: false, featureId: 'situation_recommend', reason: 'needs_gemini', message: '상황별 기술 추천 화면은 Gemini를 사용합니다. 대신 "클로즈드 가드에서 쓸 수 있는 기술은?"처럼 물어보시면 MARTIALDEX 자료로 답하겠습니다.' };
  }

  // ground grappling is never a mitt drill (the mitt has no ground motions)
  if ((which.includes('mitt') || which.includes('solo') || which.includes('reaction')) && domainOf(t) === 'ground') {
    return { ok: false, featureId: 'mitt_setup', reason: 'unsupported', message: '그라운드·그래플링 동작은 Visualizing Mitt로 연습할 수 없습니다(미트에는 그라운드 동작이 없습니다). 그라운드 기술은 AI 코치 수업의 실습 단계(솔로 드릴·타이머)로 연습해 주세요.' };
  }
  // "복싱 미트 훈련", "무에타이 콤보 미트" — a striking art's mitt in the mode the request names
  if (which.includes('mitt') && !which.includes('solo') && !which.includes('reaction') && artIn(t) && !techniqueOf(t, {}).technique) {
    const art = artIn(t)!;
    if (!mittArts().includes(art)) return { ok: false, featureId: 'mitt_setup', reason: 'invalid_params', message: `${artName(art)}에는 미트로 그릴 수 있는 기술이 없습니다.` };
    if (/콤보|조합|연타/.test(t)) return opened('mitt_combos', `/coach/mitt?tab=db&art=${enc(art)}`, `${artName(art)} 기술 DB 수록 콤보 목록을 미트로 엽니다. 콤보를 골라 시작해 주세요.`, ctx);
    return opened('mitt_command', `/coach/mitt?tab=command&art=${enc(art)}`, `${artName(art)} 미트 훈련(코치가 공격을 지시하는 미트 콜)을 엽니다. 시간과 속도를 고른 뒤 시작을 눌러 주세요.`, ctx);
  }
  if (which.includes('solo') || which.includes('reaction')) {
    const id: CoachFeatureId = which.includes('solo') ? 'mitt_command' : 'mitt_reaction';
    const allowed = mittArts();
    const asked = artIn(t);
    const art = asked ?? (ctx.current ? techniqueArts(ctx.current).find((a) => allowed.includes(a)) ?? null : null);
    if (asked && !allowed.includes(asked)) {
      return { ok: false, featureId: id, reason: 'invalid_params', message: `${artName(asked)}에는 미트로 부를 수 있는 기술이 없어 ${josa(COACH_FEATURES[id].title, '을/를')} 열 수 없습니다. 가능한 무술: ${allowed.map(artName).join(', ')}.` };
    }
    if (!art) {
      return {
        ok: false,
        featureId: id,
        reason: 'needs_choice',
        message: '어느 무술로 할까요? 무술을 골라 주세요.',
        choices: allowed.map((a) => ({ label: artName(a), text: `${artName(a)} ${id === 'mitt_command' ? '솔로 드릴' : '반응 훈련'} 하고 싶어` })),
      };
    }
    const tab = id === 'mitt_command' ? 'command' : 'react';
    const what = id === 'mitt_command' ? (art === 'wrestling' ? '레슬링 솔로 드릴(태클·스프롤 등 구령)' : `${artName(art)} 공격 지시 훈련`) : `${artName(art)} 반응 훈련`;
    return opened(id, `/coach/mitt?tab=${tab}&art=${enc(art)}`, `${what} 화면을 엽니다. 시간과 속도를 고른 뒤 시작을 눌러 주세요.`, ctx);
  }

  if (which.includes('timer')) {
    const spec = parseWorkoutSpec(t);
    const rounds = spec.sets ?? 3;
    const round = spec.exerciseDurationSeconds ?? 180;
    const rest = spec.restDurationSeconds ?? 60;
    const bad: string[] = [];
    if (round < ROUND_LIMITS.round.min || round > ROUND_LIMITS.round.max) bad.push(`라운드 시간 ${round}초 (가능: 10초~30분)`);
    if (rest < ROUND_LIMITS.rest.min || rest > ROUND_LIMITS.rest.max) bad.push(`휴식 ${rest}초 (가능: 0~10분)`);
    if (rounds < ROUND_LIMITS.rounds.min || rounds > ROUND_LIMITS.rounds.max) bad.push(`라운드 수 ${rounds} (가능: 1~20)`);
    if (bad.length) return { ok: false, featureId: 'round_timer', reason: 'invalid_params', message: `타이머 설정을 확인해 주세요: ${bad.join(', ')}.` };
    const mm = (s: number) => (s % 60 === 0 ? `${s / 60}분` : `${s}초`);
    return opened('round_timer', `/free-training/sparring?mode=timer&round=${round}&rest=${rest}&rounds=${rounds}`, `라운드·휴식 타이머를 ${mm(round)} 운동, ${rest ? `${mm(rest)} 휴식` : '휴식 없음'}, ${rounds}라운드로 맞춰 엽니다. 시작 버튼을 누르면 시작됩니다.`, ctx);
  }

  if (which.includes('sparring')) {
    return opened('sparring_analysis', '/sparring', '스파링 영상 분석 화면을 엽니다. 분석할 영상을 골라 주세요.', ctx);
  }

  // a name the student put before the training word that MARTIALDEX does not know ("기무라 미트로 할래"):
  // never fall back to a generic screen — say so, and offer same-sound spellings as choices
  const unknown = unresolvedName(t);
  if (unknown) {
    const hints = similarlySpelled(unknown.replace(/(으로|로|을|를|에서|도|만)$/, ''));
    return {
      ok: false,
      featureId: null,
      reason: 'needs_choice',
      message: `${josa(`"${unknown}"`, '은/는')} MARTIALDEX에서 확인되는 기술 이름이 아닙니다.${hints.length ? ' 혹시 아래 기술을 말씀하시는 건가요?' : ' 정확한 기술 이름으로 다시 말씀해 주세요.'} 확인되지 않은 기술로 훈련 화면을 열지 않았습니다.`,
      choices: hints.map((h) => ({ label: h.name, text: t.replace(unknown, h.name) })),
    };
  }
  // features about one technique
  const { technique, ambiguous } = techniqueOf(t, ctx);
  if (ambiguous.length) {
    return { ok: false, featureId: null, reason: 'needs_choice', message: '같은 이름의 기술이 여러 개 있습니다. 어느 기술인지 골라 주세요.', choices: ambiguous.map((c) => ({ label: `${c.name} · ${artName(c.martialArt)}`, text: `${c.name} ${artName(c.martialArt)}` })) };
  }
  if (which.includes('review')) {
    if (!technique) return opened('review', '/review', '복습 화면을 엽니다. 복습할 기록을 골라 주세요.', ctx);
    return opened('review', `/review/session?mode=training&ids=${enc(technique.id)}`, `${techName(technique)} 복습을 시작합니다.`, ctx, technique);
  }
  if (which.includes('pose')) {
    if (!technique) return { ok: false, featureId: 'pose_check', reason: 'needs_choice', message: '어떤 기술의 자세를 확인할까요? 기술 이름을 말씀해 주세요.' };
    if (!isPoseAnalysisSupported(technique.id)) {
      return { ok: false, featureId: 'pose_check', reason: 'unsupported', message: `${josa(techName(technique), '은/는')} 이 기기에서 하는 자세 분석이 아직 지원되지 않습니다. 기준 영상 비교는 Gemini 기능이라 자체 코치에서는 열지 않습니다. 대신 기술 상세에서 자세 설명을 보실 수 있습니다.` };
    }
    if (!hasCamera(ctx)) return { ok: false, featureId: 'pose_check', reason: 'unsupported', message: '이 기기에서는 카메라를 사용할 수 없어 자세 분석을 열 수 없습니다.' };
    return opened('pose_check', `/arts/${enc(technique.martialArt)}/techniques/${enc(technique.id)}?open=pose`, `${techName(technique)} 자세 분석을 엽니다. 카메라 권한을 허용해 주세요.`, ctx);
  }
  if (which.includes('detail')) {
    if (!technique) return { ok: false, featureId: 'technique_detail', reason: 'needs_choice', message: '어떤 기술의 상세 화면을 열까요? 기술 이름을 말씀해 주세요.' };
    return opened('technique_detail', `/arts/${enc(technique.martialArt)}/techniques/${enc(technique.id)}`, `${techName(technique)} 기술 상세 화면을 엽니다.`, ctx);
  }
  if (which.includes('practice') || which.includes('mitt')) {
    if (!technique) {
      if (which.includes('mitt')) return opened('mitt_setup', '/coach/mitt', 'Visualizing Mitt 화면을 엽니다. 연습할 콤보나 기술을 골라 주세요.', ctx);
      return null; // "연습하고 싶어" alone: not enough to act on
    }
    if (motionForTechnique(technique)) {
      return opened('mitt_technique', `/coach/mitt?combo=${enc(`single:${technique.id}`)}`, `${josa(techName(technique), '을/를')} 미트에 그려지는 동작이 있어 Visualizing Mitt로 연습합니다.`, ctx, technique);
    }
    const drillArt = techniqueArts(technique).find((a) => mittArts().includes(a));
    if (drillPlanFor(technique)?.group === 'ground') {
      return { ok: false, featureId: 'mitt_technique', reason: 'unsupported', message: `${josa(techName(technique), '은/는')} 그라운드 동작이라 Visualizing Mitt로 연습할 수 없습니다. "${technique.koreanName ?? technique.name} 배우고 싶어"로 수업을 만들면 실습 단계에서 솔로 드릴로 연습합니다.` };
    }
    if (drillPlanFor(technique) && drillArt) {
      return opened('mitt_command', `/coach/mitt?tab=command&art=${enc(drillArt)}`, `${josa(techName(technique), '은/는')} 미트로 그리는 동작이 없어 ${artName(drillArt)} 솔로 드릴(구령 훈련)을 엽니다.`, ctx);
    }
    return {
      ok: false,
      featureId: 'mitt_technique',
      reason: 'unsupported',
      message: `${josa(techName(technique), '은/는')} Visualizing Mitt나 솔로 드릴로 연습할 수 있는 동작이 MARTIALDEX에 없습니다. 기술 상세의 동작 단계를 보거나, "${technique.koreanName ?? technique.name} 복습하고 싶어"로 복습할 수 있습니다.`,
    };
  }
  return null;
}

/** "이 기술을 연습할 때 어떤 기능을 쓰면 돼?" — the features that can really practise this technique. */
export function practiceAnswer(t: Technique): string {
  const lines: string[] = [];
  if (motionForTechnique(t)) lines.push(`Visualizing Mitt 단일 기술 연습 ("${t.koreanName ?? t.name} 연습하고 싶어")`);
  const art = techniqueArts(t).find((a) => mittArts().includes(a));
  if (art) lines.push(`${artName(art)} 공격 지시·솔로 드릴 ("${artName(art)} 솔로 드릴 하고 싶어")`);
  if (drillPlanFor(t)) lines.push('AI 코치 수업의 실습 단계 솔로 드릴 (이 기술 수업 중 실습 단계에서 자동으로 진행)');
  if (isPoseAnalysisSupported(t.id)) lines.push('내 자세 분석 — 카메라로 이 기기에서 분석 ("자세 확인하고 싶어")');
  lines.push(`기술 복습 ("${t.koreanName ?? t.name} 복습하고 싶어")`);
  lines.push('라운드·휴식 타이머 ("3분 훈련하고 1분 쉬고 싶어")');
  return `${josa(techName(t), '을/를')} MARTIALDEX에서 연습할 수 있는 기능: ${lines.map((l, i) => `${i + 1}) ${l}`).join(' ')}.`;
}
