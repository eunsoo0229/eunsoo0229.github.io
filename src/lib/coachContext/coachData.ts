import { listMyCombos } from '../combo/service';
import { exactTechniquesInText } from '../coachKnowledge/lookup';
import { listLessonLog, weakConceptsFromLessons } from '../coachLesson/lessonLog';
import { listLearnedTechniques } from '../learnedTechniques/service';
import { listAllMeals } from '../nutrition/mealService';
import { getNutritionProfile } from '../nutrition/profileService';
import { GOAL_TYPE_LABEL, MEAL_TYPE_LABEL } from '../nutrition/types';
import { listConversations } from '../selfAi/conversationStore';
import { MASTERY_LABEL } from '../skillProgress/types';
import type { TechniqueSkillEntry } from '../skillProgress/weaknessEngine';
import { listSparringSessions as listSparringAnalyses } from '../sparringAnalysis/sparringSessionService';
import { listSparringSessions } from '../sparringSession/service';
import { INTENSITY_LABEL, SPARRING_TYPE_LABEL } from '../sparringSession/types';
import { listMyTactics } from '../tactic/service';
import { getTechniqueConnections } from '../techniqueGraph/buildGraph';
import { listFavorites } from '../userData';
import { listMyUserTechniques, resolveTechnique } from '../userTechniques/service';
import type { KnowledgeIndex } from '../martialdexKnowledge/types';
import type { Technique } from '../../types';
import { canonicalTechniqueId } from '../techniqueCanonical';

// 10차 — the rest of the learner's data for the AI coach: 콤보 · 전술 · 나만의 기술 · 즐겨찾기 · 스파링 · 식사 기록 ·
// 과거 코치 대화 (장기 학습 메모리). Read through each store's public API only (never raw `martialdex:*` iteration —
// one key holds a token), nothing written. Every item carries where it came from and how fresh it is; analyses are
// code-written from those records, and what the app CONCLUDES is labelled apart from what the learner RECORDED.

/** 공통 데이터 규격 — where an item came from, whose it is, how old, whether it has reached the account. */
export interface DataMeta {
  source: string;
  /** Owner id when the record carries one; null = not yet tied to an account (local only so far). */
  userId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  /** fresh ≤ 30 days · aging ≤ 180 · stale older · unknown no date */
  freshness: 'fresh' | 'aging' | 'stale' | 'unknown';
  /** local_only = the record has no account owner yet (not uploaded) · account = owned by an account · untracked = the store does not record it */
  syncStatus: 'local_only' | 'account' | 'untracked';
  /** user_entered · derived (computed by the app from records) · ai_generated (an AI wrote it, the user kept it) */
  confidence: 'user_entered' | 'derived' | 'ai_generated';
}

const DAY = 86400000;
export function freshnessOf(iso: string | null | undefined, now = Date.now()): DataMeta['freshness'] {
  if (!iso) return 'unknown';
  const age = now - new Date(iso).getTime();
  if (!Number.isFinite(age)) return 'unknown';
  return age <= 30 * DAY ? 'fresh' : age <= 180 * DAY ? 'aging' : 'stale';
}
const FRESH_LABEL: Record<DataMeta['freshness'], string> = { fresh: '최근', aging: '몇 달 전', stale: '오래된 기록', unknown: '날짜 없음' };
const SYNC_LABEL: Record<DataMeta['syncStatus'], string> = { local_only: '이 기기에만 있음 (계정에 아직 안 올라감)', account: '계정 동기화 대상', untracked: '동기화 상태 기록 없음' };
export function metaLine(m: DataMeta): string {
  return `출처: ${m.source} · ${m.updatedAt ? `수정 ${m.updatedAt.slice(0, 10)}` : '날짜 없음'} (${FRESH_LABEL[m.freshness]}) · ${SYNC_LABEL[m.syncStatus]}${m.confidence === 'ai_generated' ? ' · AI가 만든 내용을 사용자가 저장함' : ''}`;
}

const name = (id: string) => resolveTechnique(id)?.name ?? id;
const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '날짜 없음');

/**
 * Learned techniques by CANONICAL id (mastery from 연습 · 자세 측정 · 수업 records). Look up with `learnedOf` — a
 * combo saved as boxing__cross is the canonical kickboxing__cross record (techniqueCanonical.ts).
 */
export function learnedMap(): Map<string, TechniqueSkillEntry> {
  return new Map(listLearnedTechniques().map((e) => [canonicalTechniqueId(e.technique.id), e]));
}
export function learnedOf(learned: Map<string, TechniqueSkillEntry>, id: string): TechniqueSkillEntry | undefined {
  return learned.get(canonicalTechniqueId(id)) ?? learned.get(id);
}
function masteryOf(id: string, learned: Map<string, TechniqueSkillEntry>): string {
  const e = learnedOf(learned, id);
  return e ? MASTERY_LABEL[e.progress.status] : '학습 기록 없음';
}

// ---------------------------------------------------------------- 콤보

export interface ComboView {
  id: string;
  name: string;
  steps: { id: string; name: string; exists: boolean; mastery: string }[];
  missing: string[];
  meta: DataMeta;
}

export function readCombos(learned = learnedMap()): ComboView[] {
  return listMyCombos().map((c) => ({
    id: c.id,
    name: c.name,
    steps: c.techniqueIds.map((id) => ({ id, name: name(id), exists: !!resolveTechnique(id), mastery: masteryOf(id, learned) })),
    missing: c.techniqueIds.filter((id) => !resolveTechnique(id)),
    meta: { source: '내 콤보', userId: c.userId, createdAt: c.createdAt, updatedAt: c.updatedAt, freshness: freshnessOf(c.updatedAt), syncStatus: c.userId ? 'account' : 'local_only', confidence: c.aiComboMeta ? 'ai_generated' : 'user_entered' },
  }));
}

/** Per combo: which step is weakest, which links the technique graph records, and what the graph offers after the last step. */
export function analyzeCombos(learned = learnedMap()): string {
  const combos = readCombos(learned);
  if (!combos.length) return '저장된 콤보가 없습니다. (콤보 화면에서 기술을 순서대로 골라 저장할 수 있습니다)';
  const lines: string[] = [`저장된 콤보 ${combos.length}개 분석입니다. 숙련도는 앱의 연습·자세 측정·수업 기록으로 계산한 값입니다.`];
  for (const c of combos.slice(0, 8)) {
    lines.push(`■ ${c.name}: ${c.steps.map((s) => `${s.name}(${s.mastery})`).join(' → ')}`);
    if (c.missing.length) lines.push(`  - MARTIALDEX에 없는 기술 id: ${c.missing.join(', ')} — 이 단계는 분석하지 않았습니다.`);
    const weak = c.steps.filter((s) => s.exists && /(학습 기록 없음|개선 필요|미학습)/.test(s.mastery));
    if (weak.length) lines.push(`  - 먼저 보완할 단계 (기록상): ${weak.map((s) => `${s.name}(${s.mastery})`).join(', ')}`);
    // links between consecutive steps that the technique graph actually records
    const linked: string[] = [];
    const unlinked: string[] = [];
    for (let i = 0; i + 1 < c.steps.length; i++) {
      const a = resolveTechnique(c.steps[i].id);
      const b = c.steps[i + 1];
      if (!a || !b.exists) continue;
      let conn: ReturnType<typeof getTechniqueConnections> | null = null;
      try {
        conn = getTechniqueConnections(a);
      } catch {
        conn = null;
      }
      const recorded = !!conn && [...conn.next, ...conn.chain].some((x) => x.techniqueId === b.id);
      (recorded ? linked : unlinked).push(`${c.steps[i].name} → ${b.name}`);
    }
    if (linked.length) lines.push(`  - MARTIALDEX 기술 연결 기록이 있는 연결: ${linked.join(', ')}`);
    if (unlinked.length) lines.push(`  - 기술 연결 기록이 없는 연결 (직접 만든 연결 — 틀렸다는 뜻은 아님): ${unlinked.join(', ')}`);
    const last = resolveTechnique(c.steps.at(-1)?.id ?? '');
    if (last) {
      try {
        const next = getTechniqueConnections(last).next.filter((x) => !c.steps.some((s) => s.id === x.techniqueId)).slice(0, 3);
        if (next.length) lines.push(`  - 발전 방향: MARTIALDEX 기록상 ${last.name} 다음에 이어지는 기술 — ${next.map((x) => `${x.techniqueName}(${masteryOf(x.techniqueId, learned)})`).join(', ')}`);
      } catch {
        /* no graph entry */
      }
    }
    lines.push(`  - ${metaLine(c.meta)}`);
  }
  return lines.join('\n');
}

/**
 * New combinations from MARTIALDEX's recorded sequences (DB · shared combos — never invented): ranked by how many of
 * their steps the learner already practices, never one the learner already saved, every step a real record.
 */
export function recommendCombos(index: KnowledgeIndex, art: string | null, learned = learnedMap(), max = 4): string {
  const saved = new Set(listMyCombos().map((c) => c.techniqueIds.join('>')));
  const known = (id: string) => {
    const e = learnedOf(learned, id);
    return e && e.progress.status !== 'not_started';
  };
  const pool = index.sequences
    .filter((s) => s.origin !== 'my_combo' && (!art || !s.martialArt || s.martialArt === art))
    .map((s) => ({ s, ids: s.steps.map((x) => x.techniqueId).filter((x): x is string => !!x) }))
    .filter(({ s, ids }) => ids.length >= 2 && ids.length === s.steps.length && ids.every((id) => !!resolveTechnique(id)) && !saved.has(ids.join('>')))
    .map(({ s, ids }) => ({ s, ids, knownCount: ids.filter(known).length, proficient: ids.filter((id) => learnedOf(learned, id)?.progress.status === 'proficient').length }))
    .filter((x) => x.knownCount >= 1)
    .sort((a, b) => b.proficient - a.proficient || b.knownCount / b.ids.length - a.knownCount / a.ids.length || a.ids.length - b.ids.length)
    .slice(0, max);
  if (!learned.size) return '배운 기술 기록이 아직 없어 숙련도에 맞춘 콤보를 고를 수 없습니다. 먼저 기술을 연습하거나 수업을 하면 그 기록으로 추천합니다.';
  if (!pool.length) return `${art ? '이 무술에서 ' : ''}이미 연습한 기술로 시작하는 MARTIALDEX 기록 콤보 중 아직 저장하지 않은 것을 찾지 못했습니다. (없는 기술로 콤보를 만들지 않습니다)`;
  const lines = ['MARTIALDEX에 기록된 콤보 중, 이미 연습한 기술이 들어 있고 아직 저장하지 않은 것입니다 (기록된 순서 그대로 — 새로 지어낸 조합이 아님):'];
  for (const p of pool) {
    const fresh = p.ids.filter((id) => !known(id));
    lines.push(`- ${p.s.name}: ${p.ids.map((id) => `${name(id)}(${masteryOf(id, learned)})`).join(' → ')}${fresh.length ? ` · 새로 배울 기술: ${fresh.map(name).join(', ')}` : ' · 모두 연습한 기술'} [${p.s.origin === 'technique_db' ? 'MARTIALDEX 기록' : '사용자 공유 콤보'}]`);
  }
  lines.push('난이도 조절: 숙련 기술이 많은 콤보부터 위에 놓았습니다. 새로 배울 기술이 있는 콤보는 그 기술을 먼저 따로 연습하세요.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- 전술

const DISTANCE: [RegExp, string][] = [
  [/(먼 거리|원거리|아웃복싱|거리를 두|롱)/, '먼 거리'],
  [/(중간 거리|미들)/, '중간 거리'],
  [/(근거리|붙|인파이트|클린치)/, '근거리·클린치'],
  [/(그라운드|가드|마운트|하위|상위|깔린)/, '그라운드'],
];

export function analyzeTactics(learned = learnedMap()): string {
  const tactics = listMyTactics();
  if (!tactics.length) return '저장된 전술이 없습니다. (전술 화면에서 "상대가 ~하면 → 기술 순서"로 저장할 수 있습니다)';
  const combos = listMyCombos().map((c) => c.techniqueIds.join('>'));
  const lines = [`저장된 전술 ${tactics.length}개입니다. 아래 "기록"은 저장한 그대로이고, "앱의 판단"은 기록을 바탕으로 앱이 계산한 것입니다.`];
  const seen = new Map<string, string>();
  for (const t of tactics.slice(0, 8)) {
    const steps = t.techniqueIds.map((id) => `${name(id)}(${masteryOf(id, learned)})`);
    lines.push(`■ ${t.name} — 기록: 상황 "${t.situation}" → ${steps.join(' → ') || '기술 없음'}`);
    const dist = DISTANCE.filter(([re]) => re.test(t.situation)).map(([, l]) => l);
    const weak = t.techniqueIds.filter((id) => /(학습 기록 없음|개선 필요|미학습)/.test(masteryOf(id, learned)));
    const judge: string[] = [];
    judge.push(dist.length ? `상황 문장으로 본 거리: ${dist.join(', ')}` : '상황 문장에 거리 정보 없음');
    if (weak.length) judge.push(`약점: 숙련 기록이 부족한 단계 ${weak.map(name).join(', ')} — 실전에서 이 단계가 막히기 쉽습니다`);
    if (t.techniqueIds.length && !weak.length) judge.push('강점: 모든 단계가 연습 기록이 있는 기술');
    const key = t.techniqueIds.join('>');
    if (seen.has(key)) judge.push(`중복: 전술 「${seen.get(key)}」와 기술 순서가 같음`);
    else seen.set(key, t.name);
    if (combos.includes(key)) judge.push('저장한 콤보와 같은 순서 — 콤보 연습이 곧 이 전술 연습');
    lines.push(`  - 앱의 판단: ${judge.join(' · ')}`);
    if (t.feedback) lines.push(`  - 이전에 받은 AI 피드백 (${day(t.feedbackGeneratedAt)}): ${t.feedback.slice(0, 160)}`);
    lines.push(`  - ${metaLine({ source: '내 전술', userId: t.userId, createdAt: t.createdAt, updatedAt: t.updatedAt, freshness: freshnessOf(t.updatedAt), syncStatus: t.userId ? 'account' : 'local_only', confidence: 'user_entered' })}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 나만의 기술

export function describeMyTechniques(learned = learnedMap()): string {
  const mine = listMyUserTechniques();
  if (!mine.length) return '직접 만든 기술(나만의 기술)이 없습니다.';
  const lines = [`직접 만든 기술 ${mine.length}개입니다 (MARTIALDEX 공식 기술과 구분해 표시합니다. 코치는 이 기술을 고치거나 지우지 않습니다).`];
  for (const r of mine.slice(0, 8)) {
    const t = r.technique;
    const similar = exactTechniquesInText(`${t.name} ${(t.aliases ?? []).join(' ')}`, t.martialArt).matches.filter((x) => x.id !== t.id).slice(0, 3);
    let links: string[] = [];
    try {
      const c = getTechniqueConnections(t);
      links = [...c.prerequisite, ...c.next, ...c.samePosition].slice(0, 4).map((x) => `${x.techniqueName}(${masteryOf(x.techniqueId, learned)})`);
    } catch {
      links = [];
    }
    lines.push(`■ ${t.name}${t.koreanName ? ` (${t.koreanName})` : ''} — ${t.martialArt} · ${t.category ?? '분류 없음'} · 상태 ${r.status}`);
    if (t.description) lines.push(`  - 설명(직접 작성): ${String(t.description).slice(0, 140)}`);
    if (similar.length) lines.push(`  - 이름이 비슷한 MARTIALDEX 기술: ${similar.map((x) => x.name).join(', ')}`);
    lines.push(links.length ? `  - 연결 가능한 기술 (기술 연결 기록): ${links.join(', ')}` : '  - 기술 연결 기록에 아직 이어진 기술이 없습니다 — 같은 분류의 기술과 콤보로 묶어 연습해 볼 수 있습니다.');
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 즐겨찾기

export function describeFavorites(learned = learnedMap()): string {
  const fav = listFavorites();
  if (!fav.length) return '즐겨찾기한 기술이 없습니다.';
  const rows = fav.slice(0, 15).map((id) => ({ id, t: resolveTechnique(id), m: masteryOf(id, learned) }));
  const unlearned = rows.filter((r) => r.m === '학습 기록 없음');
  return [
    `즐겨찾기 ${fav.length}개입니다. 즐겨찾기는 관심 표시일 뿐 숙련도가 아닙니다 — 숙련도는 연습·측정·수업 기록으로만 판단합니다.`,
    ...rows.map((r) => `- ${r.t?.name ?? `${r.id} (MARTIALDEX에 없는 기술)`}: ${r.m}`),
    unlearned.length ? `학습 경로 제안: 아직 학습 기록이 없는 즐겨찾기 ${unlearned.length}개(${unlearned.slice(0, 4).map((r) => r.t?.name ?? r.id).join(', ')})를 하나씩 수업으로 배우는 순서를 추천합니다. "${unlearned[0].t?.name ?? unlearned[0].id} 수업 만들어 줘"라고 말하면 수업 계획을 만듭니다.` : '즐겨찾기한 기술은 모두 학습 기록이 있습니다. 숙련도가 낮은 것부터 복습하세요.',
  ].join('\n');
}

// ---------------------------------------------------------------- 스파링

const IMPROVE_STOP = new Set(['그리고', '너무', '조금', '많이', '계속', '다음', '오늘', '때문', '있었', '했다', '해야', '같다', '같음', '부분', '상대', '스파링']);

/** Words recurring across the learner's own "개선할 점 / 메모" — counted, not interpreted. */
function recurringWords(texts: string[]): { word: string; count: number }[] {
  const counts = new Map<string, Set<number>>();
  texts.forEach((txt, i) => {
    for (const w of txt.split(/[\s,.!?·/()~]+/)) {
      const word = w.replace(/(이|가|을|를|은|는|도|의|에|에서|으로|로|와|과|하고|이랑)$/, '');
      if (word.length < 2 || IMPROVE_STOP.has(word) || /^\d+$/.test(word)) continue;
      if (!counts.has(word)) counts.set(word, new Set());
      counts.get(word)!.add(i);
    }
  });
  return [...counts.entries()].map(([word, s]) => ({ word, count: s.size })).filter((x) => x.count >= 2).sort((a, b) => b.count - a.count).slice(0, 6);
}

export function analyzeSparring(learned = learnedMap(), goalTexts: string[] = []): string {
  const sessions = listSparringSessions().slice().sort((a, b) => b.date.localeCompare(a.date));
  const analyses = listSparringAnalyses();
  if (!sessions.length && !analyses.length) return '저장된 스파링 기록이 없습니다. 기록되지 않은 경기 결과나 성공률은 만들지 않습니다.';
  const lines: string[] = [];
  if (sessions.length) {
    const recent = sessions.slice(0, 6);
    lines.push(`■ 기록 (사용자가 저장한 스파링 ${sessions.length}회 중 최근 ${recent.length}회 — 원문 그대로)`);
    for (const s of recent) {
      const used = (s.usedTechniqueIds ?? []).map(name);
      lines.push(`- ${s.date} ${SPARRING_TYPE_LABEL[s.sparringType] ?? s.sparringType} · ${s.actualRounds}/${s.plannedRounds}라운드 · 강도 ${INTENSITY_LABEL[s.intensity] ?? s.intensity}${s.partnerName ? ` · 상대 ${s.partnerName}` : ''}${used.length ? ` · 사용 기술 ${used.join(', ')}` : ''}${s.wentWell ? ` · 잘된 점 "${s.wentWell}"` : ''}${s.toImprove ? ` · 개선할 점 "${s.toImprove}"` : ''}${s.notes ? ` · 메모 "${s.notes.slice(0, 80)}"` : ''}`);
    }
    // 정량: counted from the records
    // counted by CANONICAL id: a goal's "잽" and a recorded boxing__jab are the same record (measured live 2026-11-07:
    // without this the goal technique was reported as "사용 기록 0회" while the records had it twice)
    const usedCount = new Map<string, number>();
    for (const s of sessions) for (const id of s.usedTechniqueIds ?? []) usedCount.set(canonicalTechniqueId(id), (usedCount.get(canonicalTechniqueId(id)) ?? 0) + 1);
    const top = [...usedCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
    lines.push('■ 집계 (기록에서 센 숫자 — 성공률이 아니라 "사용했다고 기록한 횟수")');
    lines.push(top.length ? `- 가장 많이 사용한다고 기록한 기술: ${top.map(([id, n]) => `${name(id)} ${n}회`).join(', ')}` : '- 사용 기술을 기록한 스파링이 없습니다.');
    const improveTexts = sessions.map((s) => [s.toImprove, s.notes].filter(Boolean).join(' ')).filter(Boolean);
    const rec = recurringWords(improveTexts);
    lines.push(rec.length ? `- "개선할 점·메모"에 여러 번 나온 말: ${rec.map((r) => `"${r.word}" ${r.count}회`).join(', ')}` : '- "개선할 점·메모"에 반복해서 나온 말이 없습니다 (기록이 적거나 매번 다름).');
    const mentioned = new Map<string, Technique>();
    for (const txt of improveTexts) for (const t of exactTechniquesInText(txt, null).matches) mentioned.set(t.id, t);
    // 해석: what the app concludes — kept apart
    const advice: string[] = [];
    for (const t of [...mentioned.values()].slice(0, 3)) {
      let counters: string[] = [];
      try {
        const c = getTechniqueConnections(t);
        counters = [...c.counter, ...c.escape].slice(0, 2).map((x) => x.techniqueName);
      } catch {
        counters = [];
      }
      advice.push(`${t.name}(${masteryOf(t.id, learned)})이 개선할 점에 나옵니다${counters.length ? ` — 기록된 대응 기술: ${counters.join(', ')}` : ''}`);
    }
    for (const r of rec.slice(0, 2)) if (!advice.some((a) => a.includes(r.word))) advice.push(`"${r.word}"이(가) 여러 스파링에서 반복됩니다 — 다음 훈련의 집중 항목으로 추천합니다`);
    const goalTech = goalTexts.flatMap((g) => exactTechniquesInText(g, null).matches);
    for (const t of goalTech.slice(0, 2)) advice.push(`목표에 있는 ${t.name}: 스파링에서 사용했다고 기록한 횟수 ${usedCount.get(canonicalTechniqueId(t.id)) ?? 0}회`);
    lines.push('■ 앱의 판단 (위 기록을 바탕으로 한 해석 — 기록이 아님)');
    lines.push(...(advice.length ? advice.map((a) => `- ${a}`) : ['- 기록에서 반복 패턴을 찾지 못했습니다. 스파링 후 "개선할 점"을 적어 두면 다음 분석에 쓰입니다.']));
  }
  if (analyses.length) {
    const a = analyses[0];
    lines.push(`■ 영상 스파링 분석 (${a.date}, 앱의 자동 분석 결과)`);
    if (a.styleObservations.length) lines.push(`- 관찰: ${a.styleObservations.slice(0, 3).join(' / ')}`);
    if (a.weakAreas.length) lines.push(`- 약한 부분: ${a.weakAreas.slice(0, 3).map((w) => `${w.label}${w.score !== null ? ` ${w.score}` : ''}`).join(', ')}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------- 식사 기록

export function describeMeals(now = new Date(), days = 7): string {
  const profile = getNutritionProfile();
  const since = new Date(now.getTime() - (days - 1) * DAY).toISOString().slice(0, 10);
  const meals = listAllMeals().filter((m) => m.date >= since);
  const lines: string[] = [];
  const pbits = [profile.goalType ? `목표 ${GOAL_TYPE_LABEL[profile.goalType] ?? profile.goalType}` : '', profile.calorieGoal ? `칼로리 목표 ${profile.calorieGoal}kcal` : '', profile.proteinGoalG ? `단백질 목표 ${profile.proteinGoalG}g` : '', profile.bodyWeightKg ? `체중 ${profile.bodyWeightKg}kg` : ''].filter(Boolean);
  lines.push(pbits.length ? `영양 프로필(사용자 입력): ${pbits.join(' · ')}` : '영양 프로필에 저장된 목표가 없습니다.');
  if (!meals.length) {
    lines.push(`최근 ${days}일 식사 기록이 없습니다. 기록이 없는 날의 식사는 추측하지 않습니다.`);
  } else {
    const byDate = new Map<string, typeof meals>();
    for (const m of meals) byDate.set(m.date, [...(byDate.get(m.date) ?? []), m]);
    lines.push(`최근 ${days}일 중 식사 기록이 있는 날 ${byDate.size}일 (기록 없는 날은 계산에서 뺍니다):`);
    for (const [d, ms] of [...byDate.entries()].sort((a, b) => b[0].localeCompare(a[0]))) {
      const kcal = Math.round(ms.reduce((n, m) => n + m.foods.reduce((k, f) => k + (f.calories || 0), 0), 0));
      const protein = Math.round(ms.reduce((n, m) => n + m.foods.reduce((k, f) => k + (f.proteinG || 0), 0), 0));
      const est = ms.some((m) => m.isEstimate) ? ' · 일부 추정치(AI·사진 분석)' : '';
      lines.push(`- ${d}: ${ms.map((m) => `${MEAL_TYPE_LABEL[m.mealType]} ${m.foods.map((f) => f.name).join(', ')}`).join(' / ')} — 약 ${kcal}kcal, 단백질 ${protein}g${est}`);
    }
  }
  lines.push('안전: 극단적인 식단 제한이나 무리한 감량은 권하지 않습니다. 성장기라면 특히 충분히 먹는 것이 우선이며, 감량은 지도자·보호자·전문가와 상의하세요.');
  return lines.join('\n');
}

// ---------------------------------------------------------------- 장기 학습 메모리 (과거 코치 대화 + 수업)

export interface LearningMemory {
  /** Techniques the learner asked about, how often, when last (from their own messages). */
  topics: { techniqueId: string; name: string; count: number; lastAt: string }[];
  /** Questions asked more than once (similar wording). */
  repeated: { question: string; count: number; lastAt: string }[];
  /** Messages where the learner said something was hard / confusing. */
  difficulties: { text: string; techniqueIds: string[]; at: string; conversationId: string }[];
  /** How the learner asked to be taught (쉽게 · 짧게 · 자세히 · 예시). */
  preferences: { label: string; count: number }[];
  /** Finished lessons and their weak concepts (lesson log). */
  lessons: { title: string; date: string }[];
  weakConcepts: { name: string; label: string; at: string }[];
  conversations: number;
  messages: number;
}

const HARD = /(어려|헷갈|모르겠|이해가 안|이해 안|안 돼|안돼|잘 안|힘들|막혀|자꾸 틀|계속 틀)/;
const PREFS: [RegExp, string][] = [
  [/(쉽게|쉬운 말|초보.*설명)/, '쉽게 설명'],
  [/(짧게|간단히|요약)/, '짧게'],
  [/(자세히|자세하게|구체적)/, '자세히'],
  [/(예시|예를 들)/, '예시 포함'],
  [/(영상|보여)/, '영상으로'],
];

function bigramSet(s: string): Set<string> {
  const t = s.replace(/[^가-힣A-Za-z0-9]/g, '');
  const out = new Set<string>();
  for (let i = 0; i < t.length - 1; i++) out.add(t.slice(i, i + 2));
  return out;
}
function similar(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let n = 0;
  for (const x of a) if (b.has(x)) n++;
  return n / Math.max(a.size, b.size);
}

/** Built from the stored conversations + lesson log every time (originals untouched, deletions respected). */
export function learningMemory(): LearningMemory {
  const convs = listConversations();
  const topics = new Map<string, { techniqueId: string; name: string; count: number; lastAt: string }>();
  const questions: { text: string; grams: Set<string>; at: string }[] = [];
  const difficulties: LearningMemory['difficulties'] = [];
  const prefs = new Map<string, number>();
  let messages = 0;
  for (const c of convs) {
    for (const m of c.messages) {
      if (m.role !== 'user') continue;
      messages++;
      const found = exactTechniquesInText(m.text, c.martialArt).matches;
      for (const t of found) {
        const cur = topics.get(t.id) ?? { techniqueId: t.id, name: t.name, count: 0, lastAt: m.createdAt };
        cur.count++;
        if (m.createdAt > cur.lastAt) cur.lastAt = m.createdAt;
        topics.set(t.id, cur);
      }
      questions.push({ text: m.text.trim().slice(0, 120), grams: bigramSet(m.text), at: m.createdAt });
      if (HARD.test(m.text)) difficulties.push({ text: m.text.slice(0, 120), techniqueIds: found.map((t) => t.id), at: m.createdAt, conversationId: c.id });
      for (const [re, label] of PREFS) if (re.test(m.text)) prefs.set(label, (prefs.get(label) ?? 0) + 1);
    }
  }
  const repeated: LearningMemory['repeated'] = [];
  const used = new Set<number>();
  questions.forEach((q, i) => {
    if (used.has(i) || q.text.length < 6) return;
    const group = questions.map((o, j) => ({ o, j })).filter(({ o, j }) => j !== i && !used.has(j) && similar(q.grams, o.grams) >= 0.6);
    if (!group.length) return;
    group.forEach(({ j }) => used.add(j));
    used.add(i);
    repeated.push({ question: q.text, count: group.length + 1, lastAt: [q.at, ...group.map(({ o }) => o.at)].sort().at(-1)! });
  });
  let lessons: LearningMemory['lessons'] = [];
  let weakConcepts: LearningMemory['weakConcepts'] = [];
  try {
    lessons = listLessonLog().slice(0, 8).map((l) => ({ title: l.title, date: l.date }));
    weakConcepts = weakConceptsFromLessons().slice(0, 8).map((w) => ({ name: w.name, label: w.label, at: w.at }));
  } catch {
    /* lesson log unreadable — the memory says what it has */
  }
  return {
    topics: [...topics.values()].sort((a, b) => b.count - a.count || b.lastAt.localeCompare(a.lastAt)).slice(0, 10),
    repeated: repeated.sort((a, b) => b.count - a.count).slice(0, 5),
    difficulties: difficulties.sort((a, b) => b.at.localeCompare(a.at)).slice(0, 6),
    preferences: [...prefs.entries()].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count),
    lessons,
    weakConcepts,
    conversations: convs.length,
    messages,
  };
}

/** The memory as text — only the parts relevant to `topic` when one is given (question-relevant retrieval). */
export function learningMemoryText(topic: string | null = null, learned = learnedMap()): string {
  const m = learningMemory();
  if (!m.messages && !m.lessons.length) return '';
  const want = topic ? new Set(exactTechniquesInText(topic, null).matches.map((t) => t.id)) : null;
  // retrieval by topic: a question naming no technique gets no memory unless it asked for the past (caller passes null)
  if (want && !want.size) return '';
  const rel = <T extends { techniqueIds?: string[]; techniqueId?: string }>(x: T) => !want || !want.size || (x.techniqueId ? want.has(x.techniqueId) : (x.techniqueIds ?? []).some((id) => want.has(id)));
  const topics = m.topics.filter(rel);
  const diffs = m.difficulties.filter(rel);
  const lines = [`[장기 학습 메모리 — 지난 AI 코치 대화 ${m.conversations}개(질문 ${m.messages}개)와 수업 기록에서 앱이 정리 (원본 대화는 그대로)]`];
  if (topics.length) lines.push(`- 자주 물어본 기술: ${topics.slice(0, 6).map((t) => `${t.name} ${t.count}회(마지막 ${t.lastAt.slice(0, 10)}, 현재 ${masteryOf(t.techniqueId, learned)})`).join(', ')}`);
  if (m.repeated.length && (!want || !want.size)) lines.push(`- 여러 번 반복한 질문: ${m.repeated.slice(0, 3).map((r) => `"${r.question.slice(0, 40)}" ${r.count}회`).join(' / ')}`);
  if (diffs.length) lines.push(`- 어렵다고 말한 내용: ${diffs.slice(0, 3).map((d) => `"${d.text.slice(0, 50)}"(${d.at.slice(0, 10)})`).join(' / ')}`);
  if (m.weakConcepts.length) lines.push(`- 수업에서 이해가 부족했던 개념: ${m.weakConcepts.slice(0, 4).map((w) => `${w.name} — ${w.label}`).join(', ')}`);
  if (m.lessons.length) lines.push(`- 끝낸 수업: ${m.lessons.slice(0, 5).map((l) => `${l.date} ${l.title}`).join(', ')} — 이미 한 수업을 처음부터 반복하지 말고 이어서 다룰 것`);
  if (m.preferences.length) lines.push(`- 요청한 설명 방식: ${m.preferences.map((p) => `${p.label} ${p.count}회`).join(', ')}`);
  return lines.length > 1 ? lines.join('\n') : '';
}
