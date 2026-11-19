// Lesson plan for a "…배우고 싶어" request in the conversation coach — written
// by code from MARTIALDEX data only (never by the model):
//   which techniques (in the art the learner named), in what order
//   (선행 기술 → 핵심 → 응용), the recorded setups/combos, the situations the
//   records give, and — stated plainly — what the records do NOT have.
// Each technique must pass lessonReadiness before it is taught: a stub record
// (e.g. sambo "Single Leg" with no overview/steps/key points) used to become a
// lesson that repeated its category name in every stage.

import type { Technique } from '../../types';
import { artIn } from '../coachKnowledge/featureCatalog';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { lessonReadiness, type ReadinessReport } from '../coachLesson/lessonReadiness';
import { cleanPosition } from '../coachLesson/concepts';
import { josa } from '../coachLesson/text';
import { gatherTechniqueKnowledge } from '../martialdexKnowledge/index';
import type { KnowledgeIndex, KnowledgeSequence } from '../martialdexKnowledge/types';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { getUnifiedAllTechniques, normalizeTechniqueName, resolveTechnique } from '../userTechniques/service';
import { categoryTopicsInText, familyWord, type CategoryTopic } from '../knowledgeBase/topics';

export type PlanRole = 'prerequisite' | 'core' | 'application';

export interface LessonPlanItem {
  technique: Technique;
  role: PlanRole;
  readiness: ReadinessReport;
  /** Why it is in the plan ("선행 기술: …", "이름에 Single Leg 포함" …). */
  why: string;
}

export interface LessonPlan {
  topic: string;
  art: string | null;
  items: LessonPlanItem[];
  /** Techniques named / found but not taught: their record lacks the data a lesson needs. */
  excluded: { technique: Technique; readiness: ReadinessReport }[];
  sequences: KnowledgeSequence[];
  /** "상대가 막으면" side: counter / escape techniques recorded for the core techniques. */
  responses: { name: string; relation: string; of: string }[];
  situations: string[];
  notes: string[];
  /** The technique family (an official category) the request named, when it named one. */
  family?: { category: string; paragraph: string | null; source: string; members: Technique[]; rest: Technique[] };
}

const MAX_ITEMS = 4;
const DIFF_RANK: Record<string, number> = { beginner: 0, intermediate: 1, advanced: 2 };
const teachable = (r: ReadinessReport) => r.level !== 'insufficient';
const label = (t: Technique) => (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name);

/**
 * Same-art records whose name contains the requested technique's name
 * ("Single Leg" → "Single-Leg Position", "Single-Leg Down Defense").
 */
function familyInArt(baseNames: string[], art: string): Technique[] {
  const keys = [...new Set(baseNames.map(normalizeTechniqueName).filter((k) => k.length >= 4))];
  if (!keys.length) return [];
  return getUnifiedAllTechniques().filter((t) => t.martialArt === art && [t.name, ...(t.aliases ?? [])].some((n) => keys.some((k) => normalizeTechniqueName(n).includes(k))));
}

export function planLesson(text: string, opts: { art?: string | null; index?: KnowledgeIndex | null } = {}): LessonPlan {
  const art = artIn(text) ?? opts.art ?? null;
  const notes: string[] = [];
  const inArt = exactTechniquesInText(text, art).matches;
  const anyArt = art && !inArt.length ? exactTechniquesInText(text, null) : null;
  const named = inArt.length ? inArt : [];

  const candidates = new Map<string, { t: Technique; why: string }>();
  for (const t of named) candidates.set(t.id, { t, why: '질문에서 언급' });
  // A stub record (or a name only registered in another art) → the same-art records named after it.
  const stubNames = [...named.filter((t) => !teachable(lessonReadiness(t))).map((t) => t.name), ...(anyArt?.matches.map((t) => t.name) ?? []), ...(anyArt?.ambiguous.flatMap((a) => a.candidates.map((c) => c.name)) ?? [])];
  if (art && stubNames.length) {
    for (const t of familyInArt(stubNames, art)) if (!candidates.has(t.id)) candidates.set(t.id, { t, why: `이름에 '${stubNames[0]}' 포함 (같은 무술 기록)` });
  }

  // A family named ("싱글렉" = the category 싱글 레그) and no single record of the art taught by that name.
  const topic: CategoryTopic | null = art ? categoryTopicsInText(text, art)[0] ?? null : null;
  const namedTeachable = named.some((t) => teachable(lessonReadiness(t)));
  if (topic && !namedTeachable) return familyPlan(text, topic, [...candidates.values()].map((c) => c.t), opts.index ?? null);

  const excluded: LessonPlan['excluded'] = [];
  const core: LessonPlanItem[] = [];
  for (const { t, why } of candidates.values()) {
    const readiness = lessonReadiness(t);
    if (teachable(readiness)) core.push({ technique: t, role: 'core', readiness, why });
    else excluded.push({ technique: t, readiness });
  }
  // easier first; at the same level the attacking record before its defence / counter
  const reactive = (t: Technique) => (/(defen[cs]e|escape|counter|block|catch)/i.test(t.name) ? 1 : 0);
  core.sort((a, b) => (DIFF_RANK[a.technique.difficulty ?? 'intermediate'] ?? 1) - (DIFF_RANK[b.technique.difficulty ?? 'intermediate'] ?? 1) || reactive(a.technique) - reactive(b.technique));
  if (anyArt && !core.length && (anyArt.matches.length || anyArt.ambiguous.length)) {
    const elsewhere = [...anyArt.matches.map((t) => ({ name: t.name, art: t.martialArt })), ...anyArt.ambiguous.flatMap((a) => a.candidates.map((c) => ({ name: c.name, art: c.martialArt })))];
    notes.push(`'${elsewhere[0].name}'는 MARTIALDEX에 ${[...new Set(elsewhere.map((e) => e.art))].join('·')} 기술로만 등록돼 있고, 요청하신 무술의 기록은 없습니다. 다른 무술 기록으로 바꿔서 가르치지 않았습니다.`);
  }

  // 선행 기술 / 응용 from the technique graph (real edges between real records), only if teachable.
  const used = new Set(core.map((c) => c.technique.id));
  const prerequisites: LessonPlanItem[] = [];
  const applications: LessonPlanItem[] = [];
  const responses: LessonPlan['responses'] = [];
  for (const c of core.slice(0, 2)) {
    let conn: ReturnType<typeof getTechniqueConnections> | null = null;
    try {
      conn = getTechniqueConnections(c.technique);
    } catch {
      conn = null;
    }
    if (!conn) continue;
    const take = (list: { techniqueId: string; techniqueName: string }[], role: PlanRole, into: LessonPlanItem[], why: string) => {
      for (const x of list) {
        if (used.has(x.techniqueId)) continue;
        const t = resolveTechnique(x.techniqueId);
        if (!t || (art && t.martialArt !== art)) continue;
        const readiness = lessonReadiness(t);
        if (!teachable(readiness)) continue;
        used.add(t.id);
        into.push({ technique: t, role, readiness, why });
        return;
      }
    };
    take(conn.prerequisite, 'prerequisite', prerequisites, `${c.technique.name}의 선행 기술`);
    take([...conn.next, ...conn.chain], 'application', applications, `${c.technique.name}에서 이어지는 기술`);
    for (const [relation, list] of [['카운터', conn.counter], ['상대 대응·탈출', conn.escape]] as const) {
      for (const x of list.slice(0, 2)) responses.push({ name: x.techniqueName, relation, of: c.technique.name });
    }
  }
  const items = [...prerequisites, ...core, ...applications].slice(0, MAX_ITEMS);

  const sequences: KnowledgeSequence[] = [];
  if (opts.index) {
    for (const it of items) {
      const k = gatherTechniqueKnowledge(it.technique.id, opts.index, { art: art ?? undefined });
      for (const s of [...(k?.setupsInto ?? []), ...(k?.combos.map((x) => x.sequence) ?? [])]) if (!sequences.some((x) => x.id === s.id)) sequences.push(s);
    }
  }
  const situations = [...new Set(items.filter((i) => i.role === 'core').flatMap((i) => i.technique.positions.filter((p) => !/자주 등장|노기/.test(p)).map(cleanPosition)))].slice(0, 4);
  if (!candidates.size && !anyArt?.matches.length) notes.push('질문에서 MARTIALDEX에 등록된 기술 이름을 찾지 못했습니다.');
  return { topic: text.trim().slice(0, 80), art, items, excluded, sequences: sequences.slice(0, 4), responses: responses.slice(0, 4), situations, notes };
}

const isChain = (t: Technique) => /\bto\b/i.test(t.name);
const isReactive = (t: Technique) => /(defen[cs]e|escape|counter|block|catch)/i.test(t.name);
const isPosition = (t: Technique) => /position|stance/i.test(t.name);
const diffRank = (t: Technique) => DIFF_RANK[t.difficulty ?? 'intermediate'] ?? 1;


/**
 * A lesson on a technique FAMILY: the encyclopedia's paragraph says what the family is;
 * the position record first (선행), then the easiest entries of the family (핵심), then a
 * recorded chain out of it (응용). Every item is a real record that passes readiness;
 * the rest of the family is listed for later, and defence records are the 상대 대응 side.
 */
function familyPlan(text: string, topic: CategoryTopic, sameName: Technique[], index: KnowledgeIndex | null): LessonPlan {
  const art = topic.art;
  // the family's own word ("Single" in High Single, Low Single, Single to Double …) also names the records filed
  // elsewhere in the art: Single-Leg Position (그립 분류), Single-Leg Down Defense (방어 분류)
  const word = familyWord(topic.members);
  const sameWord = word ? getUnifiedAllTechniques().filter((t) => (t.martialArts ?? [t.martialArt]).includes(art) && new RegExp(`^${word}\\b`, 'i').test(t.name)) : [];
  const pool = [...new Map([...topic.members, ...sameWord, ...sameName.filter((t) => t.martialArt === art || t.martialArts?.includes(art))].map((t) => [t.id, t])).values()];
  const ready = pool.filter((t) => teachable(lessonReadiness(t)));
  const excluded = pool.filter((t) => !teachable(lessonReadiness(t))).map((t) => ({ technique: t, readiness: lessonReadiness(t) }));
  const inFamily = (t: Technique) => topic.members.some((m) => m.id === t.id);
  const pick = (list: Technique[], n: number) => [...list].sort((a, b) => diffRank(a) - diffRank(b)).slice(0, n);
  // the family's own position record ("Single-Leg Position") before a reaction position inside it ("Crackdown Position")
  const positions = ready.filter((t) => isPosition(t) && !isReactive(t));
  const position = pick(positions.filter((t) => !word || new RegExp(`^${word}\\b`, 'i').test(t.name)), 1).concat().slice(0, 1);
  if (!position.length) position.push(...pick(positions, 1));
  const core = pick(ready.filter((t) => inFamily(t) && !isChain(t) && !isReactive(t) && !isPosition(t)), 2);
  const chain = pick(ready.filter((t) => inFamily(t) && isChain(t)), 1);
  const item = (t: Technique, role: PlanRole, why: string): LessonPlanItem => ({ technique: t, role, readiness: lessonReadiness(t), why });
  const items = [
    ...position.map((t) => item(t, 'prerequisite', `${topic.category} 진입 전 자세`)),
    ...core.map((t) => item(t, 'core', `${topic.category} 계열 (MARTIALDEX 분류)`)),
    ...chain.map((t) => item(t, 'application', `${topic.category}에서 이어지는 전환`)),
  ];
  const used = new Set(items.map((i) => i.technique.id));
  const responses = ready.filter((t) => isReactive(t)).slice(0, 3).map((t) => ({ name: label(t), relation: '방어', of: topic.category }));
  const sequences: KnowledgeSequence[] = [];
  if (index) {
    for (const it of items) {
      const k = gatherTechniqueKnowledge(it.technique.id, index, { art });
      for (const s of [...(k?.setupsInto ?? []), ...(k?.combos.map((x) => x.sequence) ?? [])]) if (!sequences.some((x) => x.id === s.id)) sequences.push(s);
    }
  }
  const notes: string[] = [];
  if (sameName.some((t) => t.martialArt !== art && !t.martialArts?.includes(art))) notes.push('같은 이름의 다른 무술 기록은 사용하지 않았습니다.');
  return {
    topic: text.trim().slice(0, 80),
    art,
    items,
    excluded,
    sequences: sequences.slice(0, 4),
    responses,
    situations: [],
    notes,
    family: { category: topic.category, paragraph: topic.paragraph, source: topic.source, members: topic.members, rest: topic.members.filter((t) => !used.has(t.id) && teachable(lessonReadiness(t))) },
  };
}

const ROLE_LABEL: Record<PlanRole, string> = { prerequisite: '선행', core: '핵심', application: '응용' };

/** The plan as the coach's reply. Every line is MARTIALDEX data or a statement that data is missing. */
export function lessonPlanText(plan: LessonPlan, artName?: (art: string) => string): string {
  const art = plan.art ? (artName ? artName(plan.art) : plan.art) : null;
  if (!plan.items.length) {
    const lines = [`${art ? `${art} ` : ''}수업을 만들 수 있는 MARTIALDEX 기술 기록이 없습니다.`];
    if (plan.excluded.length) lines.push(`찾은 기록: ${plan.excluded.map((e) => `${label(e.technique)} (없는 자료: ${e.readiness.missing.join(', ')})`).join(' / ')} — 자료가 부족해 수업으로 만들지 않았습니다.`);
    lines.push(...plan.notes);
    lines.push('확인되지 않은 내용으로 수업을 채우지 않습니다. 기술 이름을 바꿔 말씀하시거나, 영상 검색("… 영상 찾아 줘")으로 참고 자료를 먼저 보실 수 있습니다.');
    return lines.join('\n');
  }
  const core = plan.items.filter((i) => i.role === 'core');
  const fam = plan.family;
  const lines = [
    `📘 수업 계획 — ${art ? `${art} · ` : ''}${fam ? `${fam.category} 계열 (${fam.members.length}개 기록)` : core.map((i) => label(i.technique)).join(', ') || plan.items.map((i) => label(i.technique)).join(', ')}`,
    ...(fam?.paragraph ? [`• ${josa(fam.category, '이/가').endsWith('이') ? `${fam.category}이란` : `${fam.category}란`}: "${fam.paragraph}" — MARTIALDEX ${art ?? ''} 백과사전`] : []),
    `• 학습 목표: ${plan.items.map((i) => label(i.technique)).join(' → ')} 순서로 동작 원리와 핵심 포인트를 익히고, 기록된 상황에 적용해 봅니다.`,
    `• 선수 지식: ${plan.items.some((i) => i.role === 'prerequisite') ? plan.items.filter((i) => i.role === 'prerequisite').map((i) => label(i.technique)).join(', ') : 'MARTIALDEX 기록에 연결된 선행 기술이 없습니다.'}`,
    '• 진행 순서 (각 기술: 설명 → 이해 확인 → 영상 → 실습 → 상황 판단):',
    ...plan.items.map((i, n) => `  ${n + 1}. [${ROLE_LABEL[i.role]}] ${label(i.technique)}${i.technique.difficulty ? ` · ${{ beginner: '초급', intermediate: '중급', advanced: '고급' }[i.technique.difficulty]}` : ''} — 자료: ${i.readiness.have.join(', ')}${i.readiness.missing.length ? ` / 없음: ${i.readiness.missing.join(', ')}` : ''}`),
    `• 관련 셋업·콤보: ${plan.sequences.length ? plan.sequences.map((s) => `${s.name} (${s.steps.map((x) => x.name).join(' → ')})`).join(' / ') : 'MARTIALDEX에 이 기술들의 셋업·콤보 기록이 아직 없습니다.'}`,
    `• 상황별 적용: ${plan.situations.length ? plan.situations.join(', ') : fam?.paragraph ? '위 계열 설명의 진입 상황·상대 반응별 전환' : '기록된 사용 상황이 없습니다.'}${plan.responses.length ? ` / 상대 대응: ${plan.responses.map((r) => `${r.name}(${r.relation})`).join(', ')}` : ''}`,
    '• 복습: 수업 마지막에 배운 핵심 포인트를 직접 말해 보는 복습이 있습니다.',
    ...(fam?.rest.length ? [`• 이어서 배울 수 있는 ${fam.category} 기록: ${fam.rest.slice(0, 8).map(label).join(', ')}${fam.rest.length > 8 ? ` 외 ${fam.rest.length - 8}개` : ''}`] : []),
  ];
  const shown = plan.excluded.slice(0, 3);
  const gaps = [
    ...(shown.length ? [`${shown.map((e) => label(e.technique)).join(', ')}${plan.excluded.length > shown.length ? ` 외 ${plan.excluded.length - shown.length}개` : ''}은(는) 기록에 설명·동작 단계·핵심 포인트가 없어 수업에서 뺐습니다.`] : []),
    ...plan.notes,
  ];
  if (gaps.length) lines.push(`• 자료 부족: ${gaps.join(' ')}`);
  lines.push('수업 내용은 MARTIALDEX 기술 기록으로만 구성합니다. 아래 "이 주제로 수업 시작"을 누르면 기존 수업 엔진으로 진행됩니다.');
  return lines.join('\n');
}
