import type { Technique } from '../../types';
import type { GoalTechniqueMatch } from './types';
import type { SubGoal } from './subGoals';
import type { DbEvidenceTechnique } from './dbEvidence';
import { checkDbTechniqueForPart, hasTrustworthyDbData } from './dbEvidence';
import type { ResearchedTechnique } from './techniqueResearch';
import type { EvidencePlanPart } from './evidencePlanner';
import { namesLikelySame } from './diversity';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { classifyPhase } from '../fighterStyle/phaseClassifier';
import { classifyTechniqueStructure } from './structureClassifier';

// 근거 등급 정책 (web-evidence curricula) — every candidate becomes
//   A  verified by web sources (a web-verified name whose MARTIALDEX entry does not contradict the part's situation)
//   B  confirmed by MARTIALDEX's own curated posture data for the part (dbEvidence.ts) — never labelled web-verified
//   C  neither — listed for transparency, never scheduled
// and the pool keeps one entry per real technique (same canonical id, or the same name with only generic
// words added — "Cutback" / "Cutback Finish"), so a short pool is never padded with the same technique twice.

export interface EvidencePolicyResult {
  pool: GoalTechniqueMatch[];
  excludedC: { name: string; reason: string }[];
  duplicatesMerged: { kept: string; dropped: string }[];
  parts: EvidencePlanPart[];
  counts: { A: number; B: number };
}

/** Words that never make a different technique on their own. ("defense"/"escape"/"counter" DO — not listed.) */
const GENERIC = new Set(['finish', 'finishes', 'technique', 'techniques', 'basic', 'basics', 'variation', 'variations', 'entry', 'entries', 'setup', 'setups', 'attack', 'shot', 'takedown', 'takedowns', 'leg', 'drill', 'drills', 'the', 'a', 'from', 'standard']);
function coreTokens(name: string): string {
  return name
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[^a-z0-9가-힣\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !GENERIC.has(w))
    .sort()
    .join(' ');
}
/** Same core name, ignoring spacing ("Duckunder" = "Duck Under", "Slideby" = "Slide By"). */
function sameCoreName(a: string, b: string): boolean {
  const x = coreTokens(a).replace(/\s+/g, '');
  return x.length > 0 && x === coreTokens(b).replace(/\s+/g, '');
}
export function sameTechniqueForPool(a: GoalTechniqueMatch, b: GoalTechniqueMatch): boolean {
  if (canonicalTechniqueId(a.techniqueId) === canonicalTechniqueId(b.techniqueId)) return true;
  return sameCoreName(a.techniqueName, b.techniqueName);
}

const MAX_DB_PER_PART = 12;
const DB_SCORE = 55;

export function applyEvidencePolicy(input: {
  matches: GoalTechniqueMatch[];
  parts: SubGoal[];
  /** Parts the curriculum may use (partial scope) — all parts when null. */
  includedPartIds: string[] | null;
  webTechniques: ResearchedTechnique[];
  dbEvidence: DbEvidenceTechnique[];
  resolve: (id: string) => Technique | undefined;
}): EvidencePolicyResult {
  const parts = input.parts.filter((p) => !input.includedPartIds || input.includedPartIds.includes(p.id));
  const partIds = new Set(parts.map((p) => p.id));
  const core = parts.find((p) => p.role === 'core') ?? parts[0] ?? null;
  const web = input.webTechniques.filter((w) => !w.partId || partIds.has(w.partId));
  const db = input.dbEvidence.filter((d) => partIds.has(d.partId));
  const excludedC: EvidencePolicyResult['excludedC'] = [];
  const graded: GoalTechniqueMatch[] = [];

  // one web-verified technique vouches for ONE MARTIALDEX entry — its closest name ("Ankle Lock" →
  // Straight Ankle Lock, not also Outside / Inside Ankle Lock): exact core name first, then the highest score
  // every name the entry is known by — a registered technique may carry the Korean name, the English one in aliases
  const namesOf = (m: GoalTechniqueMatch) => {
    const t = input.resolve(m.techniqueId);
    return [m.techniqueName, t?.name, t?.koreanName, ...(t?.aliases ?? [])].filter((n): n is string => !!n && n.trim().length > 0);
  };
  const exact = (w: ResearchedTechnique, m: GoalTechniqueMatch) => namesOf(m).some((n) => sameCoreName(w.name, n));
  const webFor = new Map<string, ResearchedTechnique>();
  for (const w of web) {
    const candidates = input.matches.filter((m) => exact(w, m) || namesOf(m).some((n) => namesLikelySame(w.name, n)));
    const best = [...candidates].sort((a, b) => Number(exact(w, b)) - Number(exact(w, a)) || b.relevanceScore - a.relevanceScore)[0];
    if (best && !webFor.has(best.techniqueId)) webFor.set(best.techniqueId, w);
  }

  for (const m of input.matches) {
    const t = input.resolve(m.techniqueId);
    const hit = webFor.get(m.techniqueId);
    if (hit && t) {
      const part = parts.find((p) => p.id === hit.partId) ?? core;
      // the name matched a web-verified technique — but a curated MARTIALDEX entry whose own data says another
      // situation / purpose / side ("Body Triangle" the attack vs. "Body Triangle Escape") is not that technique
      const contradicted = part && hasTrustworthyDbData(t) && checkDbTechniqueForPart(t, part, part === core ? null : core, 'contradiction').verdict === 'fail';
      if (!contradicted) {
        graded.push({ ...m, evidenceGrade: 'A', evidencePartId: part?.id, evidenceNote: `웹 자료 ${hit.sourceUrls?.length ?? 1}건: ${(hit.sourceTitles ?? []).slice(0, 2).join(' / ') || hit.sourceUrls?.[0] || ''}` });
        continue;
      }
      excludedC.push({ name: m.techniqueName, reason: `웹 기술명(${hit.name})과 이름은 비슷하지만 MARTIALDEX 자료의 상황·목적이 다름` });
      continue;
    }
    const d = db.find((x) => x.techniqueId === m.techniqueId);
    if (d) {
      graded.push({ ...m, evidenceGrade: 'B', evidencePartId: d.partId, evidenceNote: `MARTIALDEX 자세 데이터: ${d.quote}` });
      continue;
    }
    excludedC.push({ name: m.techniqueName, reason: '웹·DB 근거 모두 확인되지 않음(목표 문구와 이름만 일치)' });
  }

  // DB-confirmed techniques the phrase matcher did not surface (capped per part, matcher's picks first)
  for (const part of parts) {
    const already = graded.filter((g) => g.evidencePartId === part.id && g.evidenceGrade === 'B').length;
    let room = MAX_DB_PER_PART - already;
    for (const d of db.filter((x) => x.partId === part.id)) {
      if (room <= 0) break;
      if (graded.some((g) => g.techniqueId === d.techniqueId)) continue;
      const t = input.resolve(d.techniqueId);
      if (!t) continue;
      graded.push({
        techniqueId: t.id,
        techniqueName: t.name,
        martialArt: t.martialArt,
        relevanceScore: DB_SCORE,
        reason: 'MARTIALDEX 자세 데이터로 상황·목적 확인',
        phase: classifyPhase(t),
        structureRole: classifyTechniqueStructure(t),
        evidenceGrade: 'B',
        evidencePartId: part.id,
        evidenceNote: `MARTIALDEX 자세 데이터: ${d.quote}`,
      });
      room--;
    }
  }

  // one entry per real technique: A beats B, then the higher score
  const order = (g: GoalTechniqueMatch) => (g.evidenceGrade === 'A' ? 0 : 1);
  const sorted = [...graded].sort((a, b) => order(a) - order(b) || b.relevanceScore - a.relevanceScore);
  const pool: GoalTechniqueMatch[] = [];
  const duplicatesMerged: EvidencePolicyResult['duplicatesMerged'] = [];
  for (const g of sorted) {
    const same = pool.find((p) => sameTechniqueForPool(p, g));
    if (same) {
      if (same.techniqueId !== g.techniqueId) duplicatesMerged.push({ kept: same.techniqueName, dropped: g.techniqueName });
      continue;
    }
    pool.push(g);
  }
  // learning parts in the order asked, core first
  const partRank = (id?: string) => {
    const i = parts.findIndex((p) => p.id === id);
    return i < 0 ? parts.length : i;
  };
  pool.sort((a, b) => partRank(a.evidencePartId) - partRank(b.evidencePartId) || order(a) - order(b) || b.relevanceScore - a.relevanceScore);
  const planParts: EvidencePlanPart[] = parts.map((p) => ({ id: p.id, label: p.label, techniqueIds: pool.filter((g) => g.evidencePartId === p.id).map((g) => g.techniqueId) }));
  const unassigned = pool.filter((g) => !g.evidencePartId || !partIds.has(g.evidencePartId)).map((g) => g.techniqueId);
  if (unassigned.length > 0 && planParts[0]) planParts[0].techniqueIds.push(...unassigned);
  return {
    pool,
    excludedC: [...new Map(excludedC.map((e) => [e.name, e])).values()],
    duplicatesMerged,
    parts: planParts,
    counts: { A: pool.filter((g) => g.evidenceGrade === 'A').length, B: pool.filter((g) => g.evidenceGrade === 'B').length },
  };
}
