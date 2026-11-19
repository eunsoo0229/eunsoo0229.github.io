// 실행 경로 의도 (42개 문제 최종 구현). intents.skillIntent() 가 고른 의도를 각자의 데이터·도구로 처리한다.
// 분류만 바꾸고 기존 경로(웹 검색 + 자유 생성)로 보내는 것을 막기 위해, 여기서 답하고 반환한다.
//
//   UNLEARNED_TECHNIQUE_SEARCH   기술 DB × 내 학습 기록 (모델·검색 없음)
//   COMBO_EVALUATION             기록 + 원리 판단 (tactics.ts) + 선택적 AI 해석
//   COUNTER_STRATEGY / OPPONENT_PATTERN_ANALYSIS   상황 정의·원리·선택지 + 외부 자료(있으면) + 선택적 AI 해석
//   PHYSICAL_ATTRIBUTE_COMPARISON  절대값 · 키 대비 비율(계산) · 체급 내 비교(체급과 표본이 있을 때만)
//   PRODUCT_RECOMMENDATION       선택 기준 + 검색 자료에 실제로 나온 브랜드·제품만 (지어내지 않음)
//   TECHNIQUE_3D_PREVIEW / APP_ACTION   앱 기능 실행 (3D 시연 · 화면 이동)
//   TOPIC_CONTINUATION           직전 주제 + 이미 보여 준 항목 제외
//   LESSON_CONTINUATION (수업 화면 밖)   진행 중인 수업에 추가 제안 / 없으면 새 수업 제안

import type { Technique } from '../../types';
import type { CoachIntent } from './intents';
import type { ConversationMemory } from './conversationMemory';
import type { TurnOutput } from './coachAgent';
import type { TurnPlan } from './router';
import type { ChatSource, CoachChatMessage, LessonProposal, SelfAiChatRequest, SelfAiChatResult, TurnResearchInfo } from './types';
import type { ResearchOutcome, ResearchRequest, ResearchResult } from '../selfResearch/types';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import type { TechniqueLearning } from '../personalCoach/learnerModel';
import { LEARNING_STATE_LABEL } from '../personalCoach/learnerModel';
import type { LessonAddProposal } from './lessonSession';
import { allTechniques, isManagedMartialArt } from '../loadData';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { lessonReadiness } from '../coachLesson/lessonReadiness';
import { artIn } from '../coachKnowledge/featureCatalog';
import { motionClipsFor } from '../motion3d/catalog';
import { isPoseAnalysisSupported } from '../poseAnalysis/poseAnalysisConfig';
import { resolveTechnique } from '../userTechniques/service';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import { sequenceReport } from './sequenceReport';
import { readCombatTerms } from './combatTerms';
import { defensesFor, evaluateSequence, evaluationText, orderedTechniques, situationOf, situationText, type Situation } from './tactics';
import { focusSources } from './sourceFocus';
import { guardAnswer } from './guard';
import { checkClaims, dropContradicted, PROBLEM_LABEL } from './evidenceCheck';
import { proposalFromTopic, topicSummary } from './compositeTurn';

export interface BodyProfile {
  heightCm: number | null;
  reachCm: number | null;
  weightKg: number | null;
  stance: 'orthodox' | 'southpaw' | 'switch' | null;
}

export interface SkillDeps {
  research: (req: ResearchRequest) => Promise<ResearchOutcome>;
  chat: (req: SelfAiChatRequest, onDelta?: (d: string) => void) => Promise<SelfAiChatResult>;
  learner?: () => TechniqueLearning[];
  bodyProfile?: () => BodyProfile;
  artName?: (art: string) => string;
  toSources: (results: ResearchResult[]) => ChatSource[];
  /** Ids of the lesson currently running (CoachDayRun), when there is one. */
  activeLessonTechniqueIds?: () => string[] | null;
  activeLesson?: () => { title: string; route: string; current: string | null; stepLabel: string } | null;
}

export interface SkillInput {
  text: string;
  history: CoachChatMessage[];
  requestId: string;
  onStatus?: (s: string) => void;
  /** In a lesson the existing lesson_add route (proposeLessonAddition) handles additions. */
  inLesson?: boolean;
}

const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);
const skipped = (reason: string): TurnResearchInfo => ({ kind: 'web', queries: [], reason, searched: false, status: 'skipped' });
const detailRoute = (t: Technique) => `/arts/${t.martialArt}/techniques/${encodeURIComponent(t.id)}`;

function researchInfoOf(queries: string[], reason: string, outcome: ResearchOutcome): TurnResearchInfo {
  if (!outcome.ok) return { kind: 'web', queries, reason, searched: outcome.code !== 'UNSUPPORTED' && outcome.code !== 'DISABLED', status: outcome.code === 'DISABLED' ? 'disabled' : outcome.code === 'UNSUPPORTED' ? 'unsupported' : 'failed', message: outcome.message, failureCode: outcome.code };
  return { kind: 'web', queries, reason, searched: true, status: outcome.results.length ? 'ok' : 'empty', pagesRead: outcome.results.filter((r) => r.extraction.status === 'ok').length, rawCount: outcome.diagnostics.rawCount, irrelevantRemoved: outcome.diagnostics.irrelevantRemoved, removedTitles: outcome.diagnostics.removedTitles };
}

/** One line telling the learner what the search did (truthful: failed / 0 relevant / N found). */
function searchLine(info: TurnResearchInfo, n: number): string {
  if (info.status === 'disabled') return '🔎 자체 검색이 꺼져 있어 외부 자료는 찾지 않았습니다.';
  if (info.status === 'unsupported') return '🔎 이 기기에서는 실시간 검색을 할 수 없어 외부 자료는 찾지 않았습니다.';
  if (info.status === 'failed') return `🔎 외부 자료 검색에 실패했습니다 (${info.message ?? '알 수 없는 오류'}). 다시 시도하지 않았고, 아래는 MARTIALDEX 기록과 앱의 판단입니다.`;
  if (info.status === 'empty') return info.rawCount && info.irrelevantRemoved ? `🔎 검색 결과 ${info.rawCount}건이 모두 질문과 관련이 없어 제외했습니다. 관련 외부 자료 0건.` : '🔎 검색했지만 관련 외부 자료가 0건입니다.';
  return `🔎 외부 자료 ${n}건 (본문 확인 ${info.pagesRead ?? 0}건)`;
}

// ---------------------------------------------------------------- 미학습 기술 (A3 · L39)

interface TopicFilter {
  label: string;
  re: RegExp;
  test: (t: Technique) => boolean;
}

const LEG_NAME = /(single|double|ankle pick|near ankle|far ankle|high crotch|knee tap|leg pick|fireman|low single|blast|snatch|morote gari|kuchiki taoshi|kibisu gaeshi|sukui nage)/i;
const NOT_A_SHOT = /(defen[cs]e|position|ride|tilt|guard|pass|lock|armbar|finish|half nelson|underhooks?$|sleeve|x$|entry$|transition|butterfly|spider|sit-out|back take)/i;
const SHOT_CATEGORY = /(싱글 레그|더블 레그|발목·무릎|테이크다운|스탠딩|투사|던지기|레슬링 계열|프론트 헤드락|리샷|te waza|손기술)/i;
const GRAPPLING = new Set(['bjj', 'wrestling', 'judo', 'sambo']);
const STRIKING = new Set(['boxing', 'kickboxing', 'muay-thai', 'karate', 'taekwondo']);

const FILTERS: TopicFilter[] = [
  { label: '하체 태클(다리를 잡는 테이크다운)', re: /(하체|다리)\s*(태클|공격|어택|잡기)|레그\s*(어택|태클)|leg\s*attack/i, test: (t) => LEG_NAME.test(t.name) && !NOT_A_SHOT.test(t.name) && SHOT_CATEGORY.test(t.category ?? '') },
  { label: '테이크다운', re: /테이크\s*다운|태클/, test: (t) => /(테이크다운|싱글 레그|더블 레그|발목·무릎|레슬링 계열|투사)/.test(t.category ?? '') && !/(방어|defen[cs]e)/i.test(`${t.name} ${t.category}`) },
  { label: '던지기', re: /던지기|메치기|투사|throw/i, test: (t) => /(던지기|투사|waza|throw)/i.test(t.category ?? '') && !/(방어|카운터|gaeshi)/i.test(`${t.name} ${t.category}`) },
  { label: '서브미션(관절기·조르기)', re: /서브미션|관절\s*기|조르기|초크|submission/i, test: (t) => /(서브미션|관절|조르기|초크|submission|choke|lock)/i.test(`${t.category} ${t.name}`) },
  { label: '킥', re: /킥|발차기|kick/i, test: (t) => /(kick|geri|teep|킥|차기)/i.test(`${t.name} ${t.category}`) && STRIKING.has(t.martialArt) },
  { label: '펀치', re: /펀치|주먹/, test: (t) => /(punch|jab|cross|hook|uppercut|zuki|tsuki|펀치)/i.test(`${t.name} ${t.category}`) && STRIKING.has(t.martialArt) },
  { label: '그래플링', re: /그래플링|grappling/i, test: (t) => GRAPPLING.has(t.martialArt) },
  { label: '타격', re: /타격|스트라이킹|striking/i, test: (t) => STRIKING.has(t.martialArt) },
];

export function topicFilterOf(text: string): TopicFilter | null {
  return FILTERS.find((f) => f.re.test(text)) ?? null;
}

/** Learned = the learner model has learning evidence (lesson / practice / review / assessment) or a user override. */
export function isStudied(l: TechniqueLearning | undefined): boolean {
  return !!l && l.state !== 'not_started' && l.state !== 'planned';
}

export function unlearnedReport(text: string, learner: TechniqueLearning[], artName: (a: string) => string): { text: string; lessonTechniqueIds: string[]; art: string | null } | null {
  const filter = topicFilterOf(text);
  const art = artIn(text);
  // an art alone ("안 배운 레슬링 기술") is the existing personalAnswer('unlearned') route — it also lists what is
  // planned and what to learn first; this report is for a CATEGORY ("하체 태클", "그래플링") it cannot filter by
  if (!filter) return null;
  const byId = new Map(learner.map((l) => [canonicalTechniqueId(l.technique.id), l]));
  const pool = allTechniques.filter((t) => isManagedMartialArt(t.martialArt) && !t.notTechnique && (!art || (t.martialArts ?? [t.martialArt]).includes(art)) && (!filter || filter.test(t)));
  const seen = new Set<string>();
  const unique = pool.filter((t) => {
    const id = canonicalTechniqueId(t.id);
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });
  const studied = unique.filter((t) => isStudied(byId.get(canonicalTechniqueId(t.id))));
  const unlearned = unique.filter((t) => !isStudied(byId.get(canonicalTechniqueId(t.id))));
  const anyRecords = learner.some(isStudied);
  const what = [art ? artName(art) : null, filter?.label].filter(Boolean).join(' · ');
  if (!unique.length) return { text: `MARTIALDEX 기술 DB에서 「${what}」에 해당하는 기술을 찾지 못했습니다. 다른 이름(예: 싱글 레그, 더블 레그, 테이크다운)으로 다시 물어봐 주세요.`, lessonTechniqueIds: [], art };
  const groups = new Map<string, Technique[]>();
  for (const t of unlearned) groups.set(t.martialArt, [...(groups.get(t.martialArt) ?? []), t]);
  const lines: string[] = [
    `■ MARTIALDEX 기술 DB에서 「${what}」(으)로 분류되는 기술 ${unique.length}개 — 학습 기록 있음 ${studied.length}개 · 미학습 ${unlearned.length}개`,
    anyRecords ? '학습 여부는 이 기기의 실제 학습 기록(AI 코치 수업·연습·복습·자세 측정)으로 판단했습니다.' : '이 기기에는 아직 학습 기록이 없어 아래 기술을 모두 미학습으로 표시합니다. (기록이 없다고 "미학습 기술이 없다"고 하지 않습니다)',
  ];
  for (const [a, ts] of [...groups].sort((x, y) => y[1].length - x[1].length)) {
    lines.push('', `● ${artName(a)} — 미학습 ${ts.length}개`);
    for (const t of ts.slice(0, 10)) {
      const st = byId.get(canonicalTechniqueId(t.id));
      const desc = (t.description || t.purpose || '').replace(/\s+/g, ' ').trim();
      lines.push(`- ${label(t)} · ${t.category ?? '분류 없음'} · ${st?.state === 'planned' ? '학습 예정(커리큘럼에 있음)' : '미학습'}${desc ? ` — ${desc.slice(0, 70)}${desc.length > 70 ? '…' : ''}` : ''}`);
    }
    if (ts.length > 10) lines.push(`  …외 ${ts.length - 10}개`);
  }
  if (studied.length) lines.push('', `■ 이미 학습 기록이 있어 뺀 기술: ${studied.slice(0, 8).map((t) => `${label(t)}(${LEARNING_STATE_LABEL[byId.get(canonicalTechniqueId(t.id))!.state]})`).join(', ')}`);
  const teachable = unlearned.filter((t) => lessonReadiness(t).level !== 'insufficient');
  const topArt = [...groups].sort((x, y) => y[1].length - x[1].length)[0]?.[0] ?? art;
  const pick = teachable.filter((t) => t.martialArt === topArt).slice(0, 3);
  if (pick.length) lines.push('', `아래 "이 주제로 수업 시작"으로 ${pick.map(label).join(', ')} 수업을 만들 수 있습니다.`);
  return { text: lines.join('\n'), lessonTechniqueIds: pick.map((t) => t.id), art: topArt };
}

// ---------------------------------------------------------------- 체격 비교 (C14–16)

const WEIGHT_CLASS = /(스트로급|플라이급|밴텀급|페더급|라이트급|웰터급|미들급|라이트\s*헤비급|헤비급|슈퍼\s*\S+급|-?\s*\d{2,3}\s*kg\s*(급|이하)?)/i;
const CLASS_EN: Record<string, string> = { 스트로급: 'strawweight', 플라이급: 'flyweight', 밴텀급: 'bantamweight', 페더급: 'featherweight', 라이트급: 'lightweight', 웰터급: 'welterweight', 미들급: 'middleweight', 라이트헤비급: 'light heavyweight', 헤비급: 'heavyweight' };

export function weightClassIn(texts: string[]): string | null {
  for (const t of [...texts].reverse()) {
    const m = t.match(WEIGHT_CLASS);
    if (m) return m[1].replace(/\s+/g, '');
  }
  return null;
}

/** Numbers with a source line: what is measured, from where — "현재 대화" wins over the stored profile. */
export function bodyValues(text: string, profile: BodyProfile | null): { height: { cm: number; from: string } | null; reach: { cm: number; from: string } | null } {
  const reachSaid = text.match(/(리치|윙스팬)\s*(?:은|는|이|가)?\s*(\d{3}(?:\.\d)?)\s*(cm|센티)?/i);
  const heightSaid = text.match(/키\s*(?:은|는|이|가)?\s*(\d{3}(?:\.\d)?)\s*(cm|센티)?/i);
  const height = heightSaid ? { cm: Number(heightSaid[1]), from: '지금 말씀하신 값' } : profile?.heightCm ? { cm: profile.heightCm, from: '파이터 프로필' } : null;
  const reach = reachSaid ? { cm: Number(reachSaid[2]), from: '지금 말씀하신 값' } : profile?.reachCm ? { cm: profile.reachCm, from: '파이터 프로필' } : null;
  return { height, reach };
}

/** Sentences of read pages that state a reach / height average or distribution with a number. */
export function sampleStatements(results: ResearchResult[], weightClass: string | null): { n: number; text: string; title: string }[] {
  const out: { n: number; text: string; title: string }[] = [];
  results.forEach((r, i) => {
    const body = (r.content ?? '').replace(/\s+/g, ' ');
    for (const s of body.split(/(?<=[.!?])\s+/)) {
      if (s.length > 320) continue;
      if (!/(reach|height|리치|키|신장)/i.test(s)) continue;
      if (!/(average|mean|median|평균|중앙값|percent|%|distribution)/i.test(s)) continue;
      if (!/\d/.test(s)) continue;
      if (weightClass && CLASS_EN[weightClass] && !new RegExp(CLASS_EN[weightClass], 'i').test(s) && !s.includes(weightClass)) continue;
      out.push({ n: i + 1, text: s.trim(), title: r.title });
      if (out.length >= 4) return;
    }
  });
  return out;
}

// ---------------------------------------------------------------- 장비 (F21)

interface GearKind {
  key: string;
  ko: string;
  re: RegExp;
  queries: string[];
  /** General buying criteria (일반 안내 — not a product claim). */
  criteria: string[];
}

const GEAR_KINDS: GearKind[] = [
  { key: 'mouthguard', ko: '마우스피스', re: /마우스\s*(피스|가드)/, queries: ['best mouthguard for beginners boxing mma', '격투기 마우스피스 추천 초보'], criteria: ['처음이라면 뜨거운 물에 데워 이에 맞추는 성형형(boil-and-bite)이 일반적인 시작점입니다. 치과에서 맞추는 맞춤형이 가장 잘 맞지만 비쌉니다.', '격투 스포츠(타격)용인지, 숨쉬기·말하기가 가능한 두께인지 확인하세요.', '교정기를 하고 있다면 교정 전용 제품이 따로 있습니다.'] },
  { key: 'shinguard', ko: '신가드(정강이 보호대)', re: /신\s*가드|정강이\s*보호대/, queries: ['best shin guards for muay thai beginners', '무에타이 신가드 추천 초보'], criteria: ['스파링용은 발등까지 덮는 형태가, 가벼운 연습·MMA용은 양말형(slip-on)이 흔합니다.', '체육관 스파링 규정(발등 보호 필수 여부)을 먼저 확인하세요.', '정강이 길이에 맞는 사이즈(S/M/L)를 제조사 표로 확인하세요.'] },
  { key: 'gloves', ko: '글러브', re: /글러브/, queries: ['best boxing gloves for beginners', '복싱 글러브 추천 초보'], criteria: ['샌드백·미트용과 스파링용(보통 14~16oz)을 구분하세요.', '손목 고정 방식(벨크로/끈)과 손 크기를 확인하세요.'] },
  { key: 'headgear', ko: '헤드기어', re: /헤드\s*기어/, queries: ['best headgear for sparring beginners'], criteria: ['시야를 가리지 않는지, 턱·볼 보호 범위를 확인하세요.'] },
  { key: 'wraps', ko: '핸드랩', re: /핸드\s*랩|붕대/, queries: ['best hand wraps boxing beginners'], criteria: ['길이(보통 4.5m 안팎)와 신축성 여부를 확인하세요.'] },
];

const BRANDS = ['Shock Doctor', 'SISU', 'Opro', 'OPRO', 'Venum', 'Hayabusa', 'Fairtex', 'Twins', 'Everlast', 'Title', 'Cleto Reyes', 'Winning', 'Sanabul', 'RDX', 'Top King', 'Yokkao', 'Ringside', 'Adidas', 'Rival', 'Raja', 'Battle Sports', 'Damage Control', 'Under Armour', 'Shock Absorber', 'Booster', 'Grant', 'Leone', 'Tatami'];

/** Brands (and the product names right after them) that the read pages actually name — nothing else is listed. */
export function gearMentions(results: ResearchResult[]): { name: string; n: number; price: string | null }[] {
  const out = new Map<string, { name: string; n: number; price: string | null }>();
  results.forEach((r, i) => {
    const body = `${r.title}. ${(r.content ?? r.snippet ?? '').replace(/\s+/g, ' ')}`;
    for (const b of BRANDS) {
      const re = new RegExp(`\\b${b.replace(/\s+/g, '\\s+')}\\b((?:\\s+(?:[A-Z][\\w+-]*|\\d[\\w+-]*)){0,3})`, 'g');
      for (const m of body.matchAll(re)) {
        const name = `${b}${m[1] ?? ''}`.replace(/\s+/g, ' ').trim().replace(/\s+(The|And|For|With|In|Of|Is|Are)$/i, '');
        const key = name.toLowerCase();
        if (out.has(key)) continue;
        const around = body.slice(m.index ?? 0, (m.index ?? 0) + 160);
        const price = around.match(/(\$\s?\d{1,3}(?:\.\d{2})?|\d{1,3},\d{3}\s?원|\d{4,6}\s?원)/)?.[1] ?? null;
        out.set(key, { name, n: i + 1, price });
      }
    }
  });
  return [...out.values()].slice(0, 10);
}

// ---------------------------------------------------------------- 공통: 선택적 AI 해석

async function interpret(deps: SkillDeps, input: SkillInput, facts: string, rules: string[], maxTokens = 320): Promise<{ text: string | null; notes: string[]; model: string | null }> {
  const sys = [
    '너는 MARTIALDEX AI 코치다. 한국어 존댓말로 3~5문장만 쓴다.',
    '아래 [기록과 앱의 판단]만 근거로 이 사용자에게 도움이 되는 해석을 덧붙인다.',
    '기록에 없는 기술 설명, 선수 사례, 통계, 성공률, 수치를 만들지 않는다. 앱의 판단을 반복 나열하지 않는다.',
    '해석 문장은 "제 판단으로는"으로 시작한다.',
    ...rules,
    `\n[기록과 앱의 판단]\n${facts.slice(0, 3200)}`,
  ].join('\n');
  const res = await deps.chat({ requestId: input.requestId, messages: [{ role: 'system', content: sys }, { role: 'user', content: input.text }], maxTokens, temperature: 0.2 });
  if (!res.ok) return { text: null, notes: [`로컬 AI를 사용할 수 없어 해석은 붙이지 않았습니다 (${res.message}). 위 기록과 앱의 판단은 그대로입니다.`], model: null };
  const g = guardAnswer(res.text, { sourceCount: 0, sourceUrls: [], searched: false });
  const claims = checkClaims(g.text, [{ n: 1, text: facts }]);
  const kept = dropContradicted(g.text, claims);
  const notes = kept.removed.map((c) => `기록과 다른 내용이라 지운 문장: "${c.sentence.slice(0, 80)}" — ${c.problems.map((p) => PROBLEM_LABEL[p]).join(', ')}`);
  if (g.removedPromises.length) notes.push(`실제로 하지 않는 동작을 약속한 문장 ${g.removedPromises.length}개를 지웠습니다.`);
  return { text: kept.text.trim() || null, notes, model: res.model };
}

// ---------------------------------------------------------------- dispatcher

export async function runSkillTurn(intent: CoachIntent, input: SkillInput, deps: SkillDeps, plan: TurnPlan, memory: ConversationMemory, index: KnowledgeIndex | null): Promise<TurnOutput | null> {
  const artName = (a: string) => (deps.artName ? deps.artName(a) : a);
  const out = (message: Omit<TurnOutput['message'], 'role'>, results: ResearchResult[] = []): TurnOutput => ({ plan, results, message: { role: 'assistant', ...message } });
  const reading = plan.readingNotes?.length ? `📝 이해한 내용: ${plan.readingNotes.join(' ')}\n\n` : '';

  if (intent === 'UNLEARNED_TECHNIQUE_SEARCH') {
    const learner = deps.learner?.() ?? [];
    const r = unlearnedReport(input.text, learner, artName);
    if (!r) return null; // no topic and no art → the existing my_progress route asks which art
    const proposal: LessonProposal | undefined = r.lessonTechniqueIds.length ? { topic: `미학습 ${topicFilterOf(input.text)?.label ?? artName(r.art ?? '')}`.slice(0, 80), martialArt: r.art, techniqueIds: r.lessonTechniqueIds, sequenceIds: [], sourceUrls: [], candidateIds: [] } : undefined;
    return out({ text: reading + r.text, research: skipped('MARTIALDEX 기술 DB × 내 학습 기록'), tools: ['db', 'learning_records'], model: 'martialdex-data', techniqueIds: r.lessonTechniqueIds, lessonProposal: proposal });
  }

  if (intent === 'COMBO_EVALUATION') {
    const steps = orderedTechniques(readCombatTerms(input.text).lookupText, plan.techniques);
    if (steps.length < 2) {
      return out({ text: `${reading}평가할 연결을 기술 이름으로 2개 이상 알려 주세요. 예: "잽 → 크로스 → 더블 레그". 지금 문장에서 찾은 MARTIALDEX 기술: ${steps.map(label).join(', ') || '없음'}.`, research: skipped('셋업 평가 — 기술 확인 필요'), tools: ['db'], model: 'martialdex-route' });
    }
    input.onStatus?.('기록과 원리로 연결을 평가하는 중…');
    const ev = evaluateSequence(steps, index);
    const facts = evaluationText(ev, artName);
    const ai = await interpret(deps, input, facts, ['사용자가 만든 연결의 장점 하나와 가장 먼저 고칠 점 하나를 말한다.']);
    const parts = [reading + facts];
    if (ai.text) parts.push(`■ AI 해석 (로컬 AI가 위 기록·판단만 보고 쓴 의견 — 사실 확인된 내용 아님)\n${ai.text}`);
    parts.push('구분: "MARTIALDEX 기록"은 DB에 있는 사실, "앱의 판단"은 일반적인 격투 원리에 따른 판단, "AI 해석"은 추론입니다.');
    return out({ text: parts.join('\n\n'), research: skipped('MARTIALDEX 기록 + 원리 판단'), tools: ['db', 'tactics'], model: ai.model ?? 'martialdex-tactics', techniqueIds: steps.map((s) => s.id), ...(ai.notes.length ? { guardNotes: ai.notes } : {}) });
  }

  if (intent === 'COUNTER_STRATEGY' || intent === 'OPPONENT_PATTERN_ANALYSIS') {
    const sit: Situation | null = situationOf(input.text, plan.techniques, plan.patterns ?? [], !!plan.feint);
    const stance = deps.bodyProfile?.().stance ?? null;
    const stanceKo = stance === 'orthodox' ? '오소독스' : stance === 'southpaw' ? '사우스포' : stance === 'switch' ? '스위치' : null;
    const queries = sit?.queries ?? [`how to counter ${plan.techniques.map((t) => t.name).join(' ')}`.trim()];
    if (!sit && !plan.techniques.length) return null;
    input.onStatus?.('관련 자료 검색 중…');
    const outcome = await deps.research({ query: queries[0], queries: queries.slice(1), kind: 'web', maxResults: 6 });
    const info = researchInfoOf(queries, '상대 패턴·상황 분석 — 외부 자료', outcome);
    const results = outcome.ok ? outcome.results : [];
    const sources = deps.toSources(results);
    const terms = [...(sit ? sit.queries.join(' ').split(/\s+/) : []), ...plan.techniques.map((t) => t.name)].filter((w) => w.length > 3);
    const focused = focusSources(results, terms, { max: 3, perSource: 260, contentOnly: true });
    const parts: string[] = [reading + searchLine(info, sources.length)];
    if (sit) {
      parts.push(situationText(sit, stanceKo));
    } else {
      // a technique the opponent uses, no rule for it: its records + recorded defenses
      const t = plan.techniques[0];
      const k = index ? gatherTechniqueKnowledge(t.id, index) : null;
      const defs = defensesFor(t);
      parts.push([`■ 상대가 쓰는 기술 — ${label(t)} (MARTIALDEX 기록)`, (t.description || t.purpose || '설명 기록 없음').slice(0, 300), defs.length ? `- 기록된 방어·대응: ${defs.map(label).join(', ')}` : '- 이 기술에 대한 방어·대응 기록이 MARTIALDEX에 없습니다.', k?.followUps.length ? `- 기록상 이 기술 뒤에 이어지는 기술: ${k.followUps.slice(0, 4).map((f) => resolveTechnique(f.techniqueId)?.name).filter(Boolean).join(', ')}` : ''].filter(Boolean).join('\n'));
    }
    if (focused.length) parts.push(['■ 외부 자료에서 확인한 문장 (원문 일부)', ...focused.map((f) => `- [${f.n}] "${f.excerpt.slice(0, 220)}"`)].join('\n'));
    else if (sources.length) parts.push('■ 외부 자료: 찾은 자료의 본문에서 이 상황을 직접 다룬 문장을 찾지 못해 인용하지 않았습니다. 출처 원문을 참고해 주세요.');
    const ai = await interpret(deps, input, parts.join('\n\n'), ['선택지 중 이 사용자가 먼저 시도해 볼 것 하나와 그 이유를 말한다.', '통증·부상 이야기가 없으면 의료 조언을 하지 않는다.']);
    if (ai.text) parts.push(`■ AI 해석 (로컬 AI의 추론 — 위 내용만 근거)\n${ai.text}`);
    parts.push('구분: "MARTIALDEX 기록"·"외부 자료"는 확인된 내용, "앱의 판단"은 일반적인 격투 원리에 따른 판단, "AI 해석"은 추론입니다. 실제 적용은 지도자와 함께 안전하게 연습해 주세요.');
    return out({ text: parts.join('\n\n'), sources: sources.length ? sources : undefined, research: info, tools: ['db', 'tactics', 'web_search'], model: ai.model ?? 'martialdex-tactics', techniqueIds: [...new Set([...plan.techniques.map((t) => t.id), ...(sit?.options.flatMap((o) => o.techniqueIds) ?? [])])].slice(0, 8), ...(ai.notes.length ? { guardNotes: ai.notes } : {}) }, results);
  }

  if (intent === 'PERSONAL_CONTEXT_QUERY') {
    const said = weightClassIn(input.history.filter((m) => m.role === 'user').map((m) => m.text));
    const what = input.text.match(/(체급|소속\s*체육관|전적|승률|등급|단증|벨트)/)?.[1] ?? '그 정보';
    if (what === '체급') {
      const w = deps.bodyProfile?.().weightKg ?? null;
      const text = said
        ? `이 대화에서 체급을 ${said}(이)라고 말씀하셨습니다. 파이터 프로필에는 체급 항목이 없어 따로 저장되어 있지 않습니다.`
        : `파이터 프로필에는 체급 항목이 없고, 이 대화에서도 체급을 말씀하신 적이 없어 알 수 없습니다.${w ? ` 프로필에 체중 ${w}kg가 저장되어 있지만, 체급 기준은 단체·종목마다 달라 체중으로 체급을 추정하지 않습니다.` : ''} 체급을 알려 주시면 이 대화에서 그 기준으로 답하겠습니다.`;
      return out({ text, research: skipped('저장 데이터 — 프로필에 없는 항목'), tools: ['profile', 'conversation_memory'], model: 'martialdex-data', personalData: { stores: ['파이터 프로필', '현재 대화'], loadFailed: false } });
    }
    return out({ text: `${what}은(는) 파이터 프로필이나 학습 기록에 저장하는 항목이 아니어서 알 수 없습니다. 추측해서 답하지 않겠습니다. 알려 주시면 이 대화에서 참고하겠습니다.`, research: skipped('저장 데이터 — 프로필에 없는 항목'), tools: ['profile'], model: 'martialdex-data', personalData: { stores: ['파이터 프로필'], loadFailed: false } });
  }

  if (intent === 'PHYSICAL_ATTRIBUTE_COMPARISON') {
    const profile = deps.bodyProfile?.() ?? null;
    const v = bodyValues(input.text, profile);
    const userTexts = [...input.history.filter((m) => m.role === 'user').map((m) => m.text), input.text];
    const cls = weightClassIn(userTexts);
    const lines: string[] = ['■ 내 신체 값 (측정값)'];
    lines.push(v.height ? `- 키: ${v.height.cm}cm (${v.height.from})` : '- 키: 저장된 값이 없습니다');
    lines.push(v.reach ? `- 리치: ${v.reach.cm}cm (${v.reach.from})` : '- 리치: 저장된 값이 없습니다');
    if (profile?.reachCm && v.reach?.from === '지금 말씀하신 값' && profile.reachCm !== v.reach.cm) lines.push(`  (프로필에는 ${profile.reachCm}cm로 저장되어 있지만, 지금 말씀하신 ${v.reach.cm}cm를 우선했습니다. 프로필은 바꾸지 않았습니다.)`);
    if (v.height && v.reach) {
      const ratio = v.reach.cm / v.height.cm;
      const diff = Math.round((v.reach.cm - v.height.cm) * 10) / 10;
      lines.push('', '■ 키 대비 리치 (계산값)', `- 리치 ÷ 키 = ${ratio.toFixed(3)} · 리치 − 키 = ${diff > 0 ? '+' : ''}${diff}cm`, `- ${diff > 0 ? '키보다 리치가 긴 편' : diff < 0 ? '키보다 리치가 짧은 편' : '키와 리치가 같은 편'}입니다. 이것은 내 몸 안의 비율이고, 다른 선수와 비교한 순위가 아닙니다.`);
    }
    let info: TurnResearchInfo = skipped('체급 정보 없음 — 비교 표본을 찾지 않음');
    let results: ResearchResult[] = [];
    lines.push('', '■ 체급 내 비교');
    if (!cls) {
      lines.push('- 체급을 알 수 없어 체급 내에서 긴 편인지·드문 편인지는 판단하지 않았습니다. 체급은 체중으로 추정하지 않습니다.', '- 어느 체급(예: 라이트급, 웰터급)·어느 단체 기준으로 비교할지 알려 주세요. 그러면 공개 자료에서 그 체급의 리치·키 자료를 찾아보고, 표본이 확인될 때만 비교합니다.');
    } else {
      input.onStatus?.(`${cls} 리치·키 자료 검색 중…`);
      const en = CLASS_EN[cls] ?? cls;
      const queries = [`UFC ${en} average reach height`, `${en} fighters reach statistics`];
      const outcome = await deps.research({ query: queries[0], queries: queries.slice(1), kind: 'web', maxResults: 6 });
      info = researchInfoOf(queries, `${cls} 신체 자료`, outcome);
      results = outcome.ok ? outcome.results : [];
      const stats = sampleStatements(results, cls);
      lines.push(`- 기준 체급: ${cls} (지금까지 대화에서 말씀하신 체급)`);
      if (stats.length) {
        lines.push('- 읽은 자료에서 찾은 체급 신체 자료 (원문 그대로 — 표본 수·측정 기준은 원문에 적힌 범위에서만 확인됨):', ...stats.map((s) => `  [${s.n}] "${s.text.slice(0, 240)}"`));
        lines.push('- 위 문장의 수치와 내 값을 직접 비교해 보세요. 자료마다 표본(선수 수)·단체·측정 시점이 달라 앱이 백분위나 순위를 계산하지 않았습니다.');
      } else {
        lines.push(`- ${searchLine(info, results.length).replace(/^🔎\s*/, '')} 읽은 자료에서 ${cls} 리치·키의 평균이나 분포를 숫자로 밝힌 문장을 찾지 못했습니다. 표본 없이 순위를 만들지 않았습니다.`);
      }
    }
    const sources = deps.toSources(results);
    return out({ text: reading + lines.join('\n'), sources: sources.length ? sources : undefined, research: info, tools: ['profile', ...(cls ? ['web_search'] : [])], model: 'martialdex-data', personalData: { stores: ['파이터 프로필'], loadFailed: !profile } }, results);
  }

  if (intent === 'PRODUCT_RECOMMENDATION') {
    const kinds = GEAR_KINDS.filter((g) => g.re.test(input.text));
    if (!kinds.length) return null;
    const parts: string[] = [];
    const allResults: ResearchResult[] = [];
    const infos: TurnResearchInfo[] = [];
    for (const g of kinds.slice(0, 3)) {
      input.onStatus?.(`${g.ko} 자료 검색 중…`);
      const outcome = await deps.research({ query: g.queries[0], queries: g.queries.slice(1), kind: 'web', maxResults: 6 });
      const info = researchInfoOf(g.queries, `${g.ko} 제품 자료`, outcome);
      infos.push(info);
      const results = outcome.ok ? outcome.results : [];
      const offset = allResults.length;
      allResults.push(...results);
      const mentions = gearMentions(results).map((m) => ({ ...m, n: m.n + offset }));
      const block = [`■ ${g.ko}`, '선택 기준 (일반 안내 — 특정 제품 정보 아님):', ...g.criteria.map((c) => `- ${c}`)];
      if (mentions.length) {
        block.push(`검색 자료에 실제로 나온 브랜드·제품 (자료 번호 — 앱이 제품을 고르거나 보증하지 않습니다):`, ...mentions.map((m) => `- ${m.name} [${m.n}]${m.price ? ` · 자료에 적힌 가격 ${m.price} (현재 가격 아님)` : ' · 가격: 자료에서 확인 안 됨'}`));
        block.push('- 구매 가능 여부와 현재 가격은 확인하지 않았습니다. 공식 판매처에서 사이즈표와 함께 확인해 주세요.');
      } else {
        block.push(info.status === 'ok' ? '- 찾은 자료에서 격투 스포츠용 브랜드·제품명을 확인하지 못해 제품은 추천하지 않았습니다.' : `- ${searchLine(info, results.length).replace(/^🔎\s*/, '')} 확인된 제품이 없어 제품명은 적지 않았습니다.`);
      }
      parts.push(block.join('\n'));
    }
    const sources = deps.toSources(allResults);
    const status = infos.some((i) => i.status === 'ok') ? 'ok' : infos[0]?.status ?? 'skipped';
    const info: TurnResearchInfo = { kind: 'web', queries: kinds.flatMap((g) => g.queries), reason: '장비 추천 — 실제 제품 자료', searched: infos.some((i) => i.searched), status: status as TurnResearchInfo['status'], pagesRead: infos.reduce((n, i) => n + (i.pagesRead ?? 0), 0) };
    return out({ text: `${parts.join('\n\n')}\n\n제품 이름은 검색 자료에 실제로 적힌 것만 옮겼습니다. 존재 여부·현재 판매 여부·가격은 공식 판매처에서 다시 확인해 주세요.`, sources: sources.length ? sources : undefined, research: info, tools: ['web_search', 'product_check'], model: 'martialdex-data' }, allResults);
  }

  if (intent === 'TECHNIQUE_3D_PREVIEW') {
    const t = plan.techniques[0];
    if (!t) {
      return out({ text: '어떤 기술의 3D 시연을 열까요? 기술 이름을 함께 말씀해 주세요. 예: "잽 3D 프리뷰 띄워줘"', research: skipped('앱 기능 — 3D 시연'), tools: ['app_action'], model: 'martialdex-route' });
    }
    const clip = motionClipsFor(t.id)[0] ?? null;
    if (!clip) {
      const with3d = allTechniques.filter((x) => motionClipsFor(x.id).length).map(label).slice(0, 8);
      return out({ text: `${label(t)}은(는) 아직 3D 시연이 없어 열지 않았습니다. 다른 기술의 애니메이션으로 대신 보여 주지 않습니다.\n3D 시연이 있는 기술: ${with3d.join(', ')}`, research: skipped('앱 기능 — 3D 시연'), tools: ['app_action'], model: 'martialdex-route', techniqueIds: [t.id], preview: { items: [{ techniqueId: t.id, name: label(t), clipId: null }], open: false } });
    }
    return out({ text: `${reading}${label(t)} 3D 시연을 아래에 열었습니다. 각도(정면·대각선·측면·후면)와 재생 속도를 바꿔 볼 수 있습니다.\n기술 설명과 함께 보려면 "기술 상세 화면"을 누르세요.`, research: skipped('앱 기능 — 3D 시연'), tools: ['app_action'], model: 'martialdex-route', techniqueIds: [t.id], preview: { items: [{ techniqueId: t.id, name: label(t), clipId: clip.clipId }], open: true }, action: { label: '기술 상세 화면', to: detailRoute(t) } });
  }

  if (intent === 'APP_ACTION') {
    const t = plan.techniques[0] ?? null;
    if (/학습\s*기록|배운 기술/.test(input.text)) {
      return out({ text: '배운 기술(학습 기록) 화면을 엽니다.', research: skipped('앱 기능 — 학습 기록'), tools: ['app_action'], model: 'martialdex-route', action: { label: '배운 기술 화면', to: '/learned-techniques', autoRun: true } });
    }
    if (!t) return out({ text: '어떤 기술의 화면을 열까요? 기술 이름을 함께 말씀해 주세요.', research: skipped('앱 기능'), tools: ['app_action'], model: 'martialdex-route' });
    if (/자세\s*(측정|분석)/.test(input.text)) {
      if (!isPoseAnalysisSupported(t.id)) return out({ text: `${label(t)}은(는) 카메라 자세 측정 기준이 없는 기술이라 측정 화면을 열지 않았습니다. 기술 상세 화면의 "기준 영상 비교"로 평가할 수 있습니다.`, research: skipped('앱 기능 — 자세 측정'), tools: ['app_action'], model: 'martialdex-route', techniqueIds: [t.id], action: { label: '기술 상세 화면', to: detailRoute(t) } });
      return out({ text: `${label(t)} 자세 측정 화면을 엽니다.`, research: skipped('앱 기능 — 자세 측정'), tools: ['app_action'], model: 'martialdex-route', techniqueIds: [t.id], action: { label: '자세 측정 화면', to: `${detailRoute(t)}?open=pose`, autoRun: true } });
    }
    return out({ text: `${label(t)} 기술 상세 화면을 엽니다.`, research: skipped('앱 기능 — 기술 상세'), tools: ['app_action'], model: 'martialdex-route', techniqueIds: [t.id], action: { label: '기술 상세 화면', to: detailRoute(t), autoRun: true } });
  }

  if (intent === 'TOPIC_CONTINUATION') {
    const topic = memory.latest;
    const techniques = (topic?.techniqueIds ?? []).map((id) => resolveTechnique(id)).filter((x): x is Technique => !!x);
    if (!topic || !techniques.length) return out({ text: '어떤 주제를 이어서 볼지 찾지 못했습니다. 기술 이름을 함께 말씀해 주세요. 예: "더블렉 말고 싱글렉 셋업"', research: skipped('이전 주제 없음'), tools: ['conversation_memory'], model: 'martialdex-route' });
    // what was already shown for this topic (the assistant answers of the conversation)
    const shown = new Set(input.history.filter((m) => m.role === 'assistant').flatMap((m) => m.text.split('\n').map((l) => l.trim()).filter((l) => /^- \[(셋업|콤보)\]/.test(l))));
    const wantSetup = /셋업/.test(input.text);
    input.onStatus?.(`${topic.label}의 다른 ${wantSetup ? '셋업' : '항목'} 찾는 중…`);
    const queries = [`${techniques[0].name} setups${wantSetup ? '' : ' combinations'}`, `${techniques[0].name} setup drills`];
    const outcome = await deps.research({ query: queries[0], queries: queries.slice(1), kind: 'web', maxResults: 8 });
    const info = researchInfoOf(queries, `${topic.label} — 이전 답변에 없던 항목`, outcome);
    const results = outcome.ok ? outcome.results : [];
    // the family's other records too ("더블렉" → Blast Double, High Double …) so "다른 셋업" can reach them
    const famIds = new Set(techniques.map((t) => t.id));
    const rep = sequenceReport(`${topic.label} ${wantSetup ? '셋업' : '콤보'}`, techniques, topic.art, index, results);
    const lines = rep.text.split('\n');
    const fresh = lines.filter((l) => !shown.has(l.trim()));
    const removed = lines.length - fresh.length;
    const newItems = fresh.filter((l) => /^- \[(셋업|콤보)\]/.test(l.trim()));
    const head = `「${topic.label}」의 ${wantSetup ? '셋업' : '항목'} 중 앞의 답변에서 보여 드린 ${removed}개를 빼고 정리했습니다.`;
    const none = !newItems.length ? `\n\n앞에서 보여 드린 것 외에 MARTIALDEX 기록과 이번 검색 자료에서 새로 찾은 ${wantSetup ? '셋업' : '항목'}이 없습니다. 같은 내용을 반복하지 않았습니다.` : '';
    void famIds;
    const sources = deps.toSources(results);
    return out({ text: [searchLine(info, sources.length), head + none, newItems.length ? fresh.join('\n') : ''].filter(Boolean).join('\n\n'), sources: sources.length ? sources : undefined, research: info, tools: ['conversation_memory', 'db', 'web_search'], model: 'martialdex-evidence', techniqueIds: rep.techniqueIds, turn: { intents: ['TOPIC_CONTINUATION'], topicKey: topic.key, topicLabel: topic.label, topicTechniqueIds: topic.techniqueIds, art: topic.art, aspects: ['setup'] } }, results);
  }

  if (intent === 'LESSON_CONTINUATION' && !input.inLesson) {
    const topic = memory.latest;
    const techniques = (topic?.techniqueIds ?? []).map((id) => resolveTechnique(id)).filter((x): x is Technique => !!x && lessonReadiness(x).level !== 'insufficient');
    if (!topic || !techniques.length) return out({ text: '방금 대화에서 수업에 넣을 MARTIALDEX 기술을 찾지 못했습니다. 어떤 기술을 넣을지 이름으로 말씀해 주세요.', research: skipped('수업 추가 — 주제 없음'), tools: ['conversation_memory'], model: 'martialdex-route' });
    const running = deps.activeLessonTechniqueIds?.() ?? null;
    const live = deps.activeLesson?.() ?? null;
    if (running && live) {
      const inRun = new Set(running.map(canonicalTechniqueId));
      const add = techniques.filter((t) => !inRun.has(canonicalTechniqueId(t.id))).slice(0, 3);
      if (!add.length) return out({ text: `방금 다룬 「${topic.label}」의 기술은 이미 진행 중인 수업 「${live.title}」에 들어 있어 추가할 것이 없습니다. 수업은 바뀌지 않았습니다.`, research: skipped('수업 추가'), tools: ['lesson_engine'], model: 'martialdex-route', action: { label: '수업 이어하기', to: live.route } });
      const proposal: LessonAddProposal = { kind: 'connected', techniqueIds: add.map((t) => t.id), reasons: Object.fromEntries(add.map((t) => [t.id, `대화에서 다룬 「${topic.label}」`])), status: 'pending' };
      return out({ text: `진행 중인 수업 「${live.title}」${live.current ? `(지금 ${live.current} · ${live.stepLabel} 단계)` : ''}에 방금 다룬 내용을 추가할까요?\n${add.map((t) => `- ${label(t)}: 대화에서 다룬 「${topic.label}」`).join('\n')}\n아래 "수업에 추가"를 누르면 수업 순서 끝에 붙입니다. 지금 하던 단계·진행 기록은 그대로입니다.`, research: skipped('수업 추가 제안'), tools: ['lesson_engine'], model: 'martialdex-route', techniqueIds: add.map((t) => t.id), lessonAdd: proposal });
    }
    const { proposal } = proposalFromTopic({ topicLabel: topic.label, techniques, art: topic.art, index, sourceUrls: topic.sourceUrls, videoUrls: topic.videoUrls, summary: topicSummary(topic) });
    if (!proposal) return out({ text: `「${topic.label}」로 수업을 구성할 기록이 부족합니다.`, research: skipped('수업 추가'), tools: ['lesson_plan'], model: 'martialdex-route' });
    return out({ text: `지금 진행 중인 수업이 없어 기존 수업에 추가하지 못했습니다. 대신 방금 다룬 「${topic.label}」로 새 수업을 구성했습니다.\n수업에 반영할 내용:\n${(proposal.summary ?? []).map((x) => `- ${x}`).join('\n')}\n아래 "이 주제로 수업 시작"을 누르면 시작합니다.`, research: skipped('수업 구성 — 대화 내용'), tools: ['lesson_plan'], model: 'martialdex-plan', techniqueIds: proposal.techniqueIds, lessonProposal: proposal });
  }

  return null;
}
