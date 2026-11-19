// "레슬링 솔로 드릴 훈련을 하고 싶어", "오늘 주짓수 연습하자", "복싱 솔로 드릴 수업 만들어 줘",
// "내가 부족한 기술 위주로 수업해 줘" — a training request becomes a LESSON of real MARTIALDEX
// records of THAT art (never another art's techniques), shaped by the learner's records:
//   복습   techniques the learner has learned (review due first)
//   보강   techniques the records show as weak
//   준비   the next techniques to learn (prerequisites learned / connected / beginner)
//   기초   basics of the art when the learner has no records yet
// Solo drills use only movements a person can do alone: for wrestling / BJJ the app's own solo
// drill cue list (soloDrill/moves.ts) and the arts' basic-movement categories; for striking arts
// stance / footwork / strikes / evasive defence — never partner work (clinch, counters to an
// attack, takedowns, guard work). A request the DB cannot serve says why and what it can do.

import type { Technique } from '../../types';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { categoryInArt } from '../loadData';
import { DRILL_MOVES } from '../soloDrill/moves';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { getUnifiedAllTechniques, resolveTechnique } from '../userTechniques/service';
import { sectionOf } from '../knowledgeBase/topics';
import { inArt, type TechniqueLearning } from '../personalCoach/learnerModel';
import { nextToLearn } from '../personalCoach/personalAnswers';

export type TrainingType = 'solo' | 'partner' | 'art' | 'review' | 'weakness';

export const TRAINING_LABEL: Record<TrainingType, string> = { solo: '솔로 드릴', partner: '파트너 드릴', art: '종목 훈련', review: '복습', weakness: '약점 보강' };

export type ItemRole = 'review' | 'reinforce' | 'prepare' | 'basic';
const ROLE_LABEL: Record<ItemRole, string> = { review: '복습', reinforce: '보강', prepare: '준비', basic: '기초' };

export interface TrainingItem {
  technique: Technique;
  role: ItemRole;
  why: string;
}

export interface TrainingPlan {
  ok: boolean;
  art: string | null;
  type: TrainingType;
  items: TrainingItem[];
  /** What to prepare (space, mat, partner). */
  prep: string[];
  /** Why it could not be made / what is missing. */
  notes: string[];
  /** The app's own solo drill screen for the art, when it has one. */
  drillRoute: string | null;
}

const GRAPPLING_SOLO_ARTS = new Set(['wrestling', 'bjj']);
const STRIKING_ARTS = new Set(['boxing', 'kickboxing', 'muay-thai', 'karate', 'taekwondo', 'mixed-martial-arts']);
/** Striking categories a person can drill alone (shadow): stance, footwork, strikes, evasive defence, linked strikes. */
const SOLO_STRIKING = /^(기본 자세|풋워크|기본 펀치|특수 펀치|페인트|조합|방어|펀치 방어|킥 방어|스탠스|펀치|킥|니 |엘보|장거리|중거리 펀치|로우킥|기본 자세 \(|이동|손기술|팔꿈치|발차기|막기|타이사바키|기본 서기|기본 발차기|겨루기 발차기|회전 발차기|연결 기술|대표적인 콤비네이션|스트라이킹|MMA 복싱|MMA 킥복싱)/;
/** Basic-movement categories of grappling arts (movement alone, no partner). */
const SOLO_GRAPPLING_CATEGORY = /^(기본 자세와 움직임|기본 움직임과 연결 기술|기본 자세와 이동|기본 자세와 거리)/;
const NEEDS_PARTNER_NAME = /(hand ?fighting|grip|tie|clinch|catch|counter|throw|takedown|sweep|pass|guard|control|mount|choke|lock|bar|hold)/i;

/** Can this technique be drilled without a partner (as the app's records describe it)? */
export function soloCapable(t: Technique, art: string): boolean {
  const cat = categoryInArt(t, art);
  if (GRAPPLING_SOLO_ARTS.has(art)) {
    if (DRILL_MOVES.some((m) => canonicalTechniqueId(m.id) === canonicalTechniqueId(t.id))) return true;
    return SOLO_GRAPPLING_CATEGORY.test(cat) && !NEEDS_PARTNER_NAME.test(t.name);
  }
  if (STRIKING_ARTS.has(art)) return SOLO_STRIKING.test(cat) && !/(catch|clinch|counter|카운터)/i.test(`${t.name} ${cat}`);
  return SOLO_GRAPPLING_CATEGORY.test(cat) && !NEEDS_PARTNER_NAME.test(t.name);
}

const teachable = (t: Technique) => !t.notTechnique && lessonReadiness(t).level !== 'insufficient';
const DIFF: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };

/** The art's techniques for this kind of training, in the encyclopedia's order (stance → movement → attacks …). */
function poolFor(type: TrainingType, art: string): Technique[] {
  const all = getUnifiedAllTechniques().filter((t) => inArt(t, art) && teachable(t));
  const order = (t: Technique) => sectionOf(art, categoryInArt(t, art))?.order ?? 99;
  const pool = type === 'solo' ? all.filter((t) => soloCapable(t, art)) : type === 'partner' ? all.filter((t) => !soloCapable(t, art)) : all;
  return pool.sort((a, b) => order(a) - order(b) || (DIFF[a.difficulty ?? 'intermediate'] ?? 1) - (DIFF[b.difficulty ?? 'intermediate'] ?? 1));
}

const MAX = 5;

export function planTraining(type: TrainingType, art: string | null, learner: TechniqueLearning[]): TrainingPlan {
  const base = { art, type, prep: [] as string[], notes: [] as string[], drillRoute: null as string | null };
  // review / weakness without an art: across arts, from the learner's records
  if (!art && type !== 'review' && type !== 'weakness') return { ...base, ok: false, items: [], notes: ['어느 무술로 훈련할지 알려 주세요. 예: "레슬링 솔로 드릴 하고 싶어"'] };
  const byId = new Map(learner.map((l) => [canonicalTechniqueId(l.technique.id), l]));
  const L = (t: Technique) => byId.get(canonicalTechniqueId(t.id));
  const items: TrainingItem[] = [];
  const add = (t: Technique, role: ItemRole, why: string) => {
    if (items.length >= MAX || items.some((i) => canonicalTechniqueId(i.technique.id) === canonicalTechniqueId(t.id))) return;
    items.push({ technique: t, role, why });
  };
  const pool = art ? poolFor(type === 'review' || type === 'weakness' ? 'art' : type, art) : learner.map((l) => l.technique).filter(teachable);
  const inPool = new Set(pool.map((t) => canonicalTechniqueId(t.id)));
  const scoped = learner.filter((l) => inPool.has(canonicalTechniqueId(l.technique.id)));
  const studied = scoped.filter((l) => l.state !== 'not_started' && l.state !== 'planned');

  if (art && !pool.length) {
    const solo = type === 'solo';
    return { ...base, ok: false, items: [], notes: [solo ? `MARTIALDEX에 ${art} 기록 중 혼자 연습할 수 있는(솔로 드릴) 동작으로 분류된 수업 가능 기록이 없습니다. 파트너가 필요한 기술을 솔로 드릴로 소개하지 않았습니다.` : `MARTIALDEX에 이 훈련에 맞는 ${art} 수업 가능 기록이 없습니다.`, solo ? '대신: 같은 무술의 파트너 드릴 수업, 또는 기술 이름을 말해 기술 수업을 만들 수 있습니다.' : ''].filter(Boolean) };
  }

  const weak = scoped.filter((l) => l.states.includes('weak')).sort((a, b) => (a.proficiency ?? 0) - (b.proficiency ?? 0));
  const due = scoped.filter((l) => l.states.includes('review_due'));
  const learned = scoped.filter((l) => l.states.includes('learned')).sort((a, b) => (a.lastStudiedAt ?? '').localeCompare(b.lastStudiedAt ?? ''));
  if (type === 'weakness') {
    for (const l of weak) add(l.technique, 'reinforce', `기록상 숙련도 부족 — ${l.evidence.slice(0, 2).join(', ') || '최근 수업·복습 결과'}`);
    if (!items.length) return { ...base, ok: false, items: [], notes: [studied.length ? '수업·복습 기록상 숙련도 부족으로 판단된 기술이 없습니다. 복습 수업이나 새 기술 수업을 만들 수 있습니다.' : '이 기기에 학습 기록이 없어 부족한 기술을 판단할 수 없습니다(기록을 지어내지 않습니다).'] };
  } else if (type === 'review') {
    for (const l of [...due, ...learned]) add(l.technique, 'review', l.states.includes('review_due') ? `복습 예정일 지남(${l.nextReviewAt?.slice(0, 10)})` : `학습 완료 · 마지막 학습 ${l.lastStudiedAt ?? '-'}`);
    if (!items.length) return { ...base, ok: false, items: [], notes: ['복습할 학습 완료 기술 기록이 없습니다.'] };
  } else {
    // personal composition inside the pool
    for (const l of [...due, ...learned].slice(0, 2)) add(l.technique, 'review', l.states.includes('review_due') ? '복습 예정일 지남' : '배운 기술 다시 다지기');
    for (const l of weak.slice(0, 2)) add(l.technique, 'reinforce', `숙련도 부족(${l.proficiency ?? '-'})`);
    if (art) for (const n of nextToLearn(art, scoped, 2)) add(n.technique, 'prepare', n.why);
    // no records / few items: the art's basics for this training, in the encyclopedia order
    for (const t of pool) {
      if (items.length >= Math.min(MAX, 4)) break;
      const l = L(t);
      if (l && l.state !== 'not_started' && l.state !== 'planned') continue;
      add(t, 'basic', `${categoryInArt(t, art!)}${t.difficulty ? ` · ${{ beginner: '초급', intermediate: '중급', advanced: '고급' }[t.difficulty]}` : ''}`);
    }
  }
  if (type === 'solo') {
    base.prep.push('파트너 없이 혼자: 동작을 크게 할 수 있는 공간(가로·세로 2m 이상), 레슬링·주짓수는 매트 권장');
    if (art && GRAPPLING_SOLO_ARTS.has(art)) base.drillRoute = `/coach/mitt?tab=command&art=${encodeURIComponent(art)}`;
  } else if (type === 'partner') base.prep.push('파트너 1명 필요 — 혼자서는 이 구성으로 연습할 수 없습니다. 기술을 천천히, 상대가 탭하면 즉시 멈춥니다.');
  if (!studied.length && type !== 'review' && type !== 'weakness') base.notes.push('학습 기록이 없어 이 무술의 기초부터 구성했습니다.');
  return { ...base, ok: items.length > 0, items, notes: items.length ? base.notes : [...base.notes, '조건에 맞는 수업 가능 기록이 없습니다.'] };
}

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

export function trainingPlanText(plan: TrainingPlan, artName: (a: string) => string): string {
  const art = plan.art ? artName(plan.art) : '';
  if (!plan.ok) return [`${art} ${TRAINING_LABEL[plan.type]} 수업을 만들지 못했습니다.`.trim(), ...plan.notes.map((n) => `- ${n}`)].join('\n');
  const lines = [
    `🏋️ ${art} ${TRAINING_LABEL[plan.type]} 수업 계획 — MARTIALDEX ${art} 기록 ${plan.items.length}개`.replace(/\s+/g, ' '),
    `• 구성 (모두 ${art || '해당 무술'} 기록, 다른 무술 기술 없음):`,
    ...plan.items.map((i, n) => `  ${n + 1}. [${ROLE_LABEL[i.role]}] ${label(i.technique)} — ${i.why}`),
    ...(plan.prep.length ? [`• 준비: ${plan.prep.join(' / ')}`] : []),
    '• 진행: 각 기술마다 설명 → 이해 확인 → 영상 → 실습(솔로 드릴·타이머) → 확인. 수업 중 언제든 질문할 수 있습니다.',
    ...plan.notes.map((n) => `• ${n}`),
    `아래 "이 주제로 수업 시작"을 누르면 바로 시작합니다.${plan.drillRoute ? ' 구령에 맞춰 움직이는 솔로 드릴 화면은 "솔로 드릴 화면 열기"로 열 수 있습니다.' : ''}`,
  ];
  return lines.join('\n');
}

export function trainingTechniqueIds(plan: TrainingPlan): string[] {
  return plan.items.map((i) => resolveTechnique(i.technique.id)?.id ?? i.technique.id);
}
