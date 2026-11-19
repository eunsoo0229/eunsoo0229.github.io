// Builds the in-app knowledge index (techniques ↔ setups ↔ combos ↔ links) and
// answers "what does MARTIALDEX already know around technique X".
// Pure over its inputs: network-backed sources (사용자 콤보·셋업, 연결) are
// passed in by the caller, and their absence is recorded in `sources`, never hidden.

import type { Technique } from '../../types';
import { listDbCombosForSharing } from '../sharedCombo/dbCombos';
import type { SharedCombo } from '../sharedCombo/types';
import type { ComboLink } from '../sharedCombo/links';
import type { Combo } from '../combo/types';
import { canonicalTechniqueId } from '../techniqueCanonical';
import { resolveTechnique } from '../userTechniques/service';
import type { KnowledgeIndex, KnowledgeSequence, SequenceLink, TechniqueKnowledge } from './types';

export interface KnowledgeInputs {
  sharedCombos?: SharedCombo[] | null;
  sharedComboError?: string;
  comboLinks?: ComboLink[] | null;
  myCombos?: Combo[];
}

const cid = (id: string) => canonicalTechniqueId(id);

export function buildKnowledgeIndex(inputs: KnowledgeInputs = {}): KnowledgeIndex {
  const sequences: KnowledgeSequence[] = [];
  const sources: KnowledgeIndex['sources'] = [];

  const db = listDbCombosForSharing().combos;
  for (const c of db) {
    sequences.push({
      id: `db:${c.sourceRef}`,
      kind: 'combo',
      name: c.name,
      martialArt: c.martialArt,
      purpose: c.purpose,
      steps: c.steps.map((s) => ({ techniqueId: cid(s.techniqueId), name: s.name, note: s.note, opponentReaction: s.opponentReaction })),
      origin: 'technique_db',
      sourceRef: c.sourceRef,
    });
  }
  sources.push({ origin: 'technique_db', count: db.length, ok: true });

  if (inputs.sharedCombos) {
    // Published copies of DB combos carry the same source_ref — keep one.
    const dbRefs = new Set(db.map((c) => c.sourceRef));
    let n = 0;
    for (const c of inputs.sharedCombos) {
      if (c.sourceRef && dbRefs.has(c.sourceRef)) continue;
      n++;
      sequences.push({
        id: `shared:${c.id}`,
        kind: c.kind,
        name: c.name,
        martialArt: c.martialArt,
        purpose: c.purpose,
        steps: c.steps.map((s) => ({ techniqueId: cid(s.techniqueId), name: s.name, note: s.note, opponentReaction: s.opponentReaction })),
        origin: 'shared_combo',
        supportCount: c.likeCount,
        sourceRef: c.sourceRef,
      });
    }
    sources.push({ origin: 'shared_combo', count: n, ok: true });
  } else {
    sources.push({ origin: 'shared_combo', count: 0, ok: false, note: inputs.sharedComboError ?? '사용자 콤보·셋업을 불러오지 못했습니다.' });
  }

  for (const c of inputs.myCombos ?? []) {
    if (c.techniqueIds.length < 2) continue;
    sequences.push({
      id: `mine:${c.id}`,
      kind: 'combo',
      name: c.name,
      martialArt: null,
      purpose: c.description || undefined,
      steps: c.techniqueIds.map((id) => ({ techniqueId: cid(id), name: resolveTechnique(id)?.name ?? id })),
      origin: 'my_combo',
    });
  }
  sources.push({ origin: 'my_combo', count: (inputs.myCombos ?? []).length, ok: true });

  const links: SequenceLink[] = [];
  if (inputs.comboLinks) {
    const byKey = new Map<string, SequenceLink>();
    for (const l of inputs.comboLinks) {
      const key = `${l.fromId}>${l.toId}>${l.relation}`;
      const e = byKey.get(key);
      if (e) e.support++;
      else byKey.set(key, { fromId: `shared:${l.fromId}`, toId: `shared:${l.toId}`, relation: l.relation, note: l.note || undefined, support: 1 });
    }
    links.push(...byKey.values());
    sources.push({ origin: 'combo_links', count: links.length, ok: true });
  } else {
    sources.push({ origin: 'combo_links', count: 0, ok: false, note: '콤보 연결을 불러오지 못했습니다.' });
  }
  return { sequences, links, sources };
}

function countMap(entries: string[]): { techniqueId: string; count: number }[] {
  const m = new Map<string, number>();
  for (const e of entries) m.set(e, (m.get(e) ?? 0) + 1);
  return [...m.entries()].map(([techniqueId, count]) => ({ techniqueId, count })).sort((a, b) => b.count - a.count);
}

const bySupport = (a: KnowledgeSequence, b: KnowledgeSequence) => (b.supportCount ?? 0) - (a.supportCount ?? 0) || a.steps.length - b.steps.length;

export function gatherTechniqueKnowledge(techniqueId: string, index: KnowledgeIndex, opts: { art?: string } = {}): TechniqueKnowledge | null {
  const technique = resolveTechnique(techniqueId);
  if (!technique) return null;
  const id = cid(technique.id);
  const inArt = (s: KnowledgeSequence) => !opts.art || !s.martialArt || s.martialArt === opts.art;
  const setupsInto: KnowledgeSequence[] = [];
  const setupsUsing: KnowledgeSequence[] = [];
  const combos: TechniqueKnowledge['combos'] = [];
  const after: string[] = [];
  const before: string[] = [];
  for (const s of index.sequences) {
    const pos = s.steps.findIndex((st) => st.techniqueId === id);
    if (pos < 0) continue;
    s.steps.forEach((st, i) => {
      if (st.techniqueId !== id) return;
      if (i + 1 < s.steps.length && s.steps[i + 1].techniqueId !== id) after.push(s.steps[i + 1].techniqueId);
      if (i > 0 && s.steps[i - 1].techniqueId !== id) before.push(s.steps[i - 1].techniqueId);
    });
    if (!inArt(s)) continue;
    if (s.kind === 'setup') (pos === s.steps.length - 1 ? setupsInto : setupsUsing).push(s);
    else combos.push({ sequence: s, position: pos });
  }
  return {
    technique,
    setupsInto: setupsInto.sort(bySupport),
    setupsUsing: setupsUsing.sort(bySupport),
    combos: combos.sort((a, b) => bySupport(a.sequence, b.sequence)),
    followUps: countMap(after),
    leadIns: countMap(before),
    relatedIds: (technique.relatedTechniques ?? []).filter((r) => !!resolveTechnique(r)),
  };
}

/** Sequences that continue from `sequenceId` via shared links (다음 연결), strongest support first. */
export function linkedSequences(sequenceId: string, index: KnowledgeIndex): { sequence: KnowledgeSequence; link: SequenceLink }[] {
  const byId = new Map(index.sequences.map((s) => [s.id, s]));
  return index.links
    .filter((l) => l.fromId === sequenceId && byId.has(l.toId))
    .sort((a, b) => b.support - a.support)
    .map((link) => ({ sequence: byId.get(link.toId)!, link }));
}

/** Same ordered technique ids (canonical) = the same sequence. */
export function findSameSequence(techniqueIds: string[], index: KnowledgeIndex): KnowledgeSequence | null {
  const key = techniqueIds.map(cid).join('>');
  return index.sequences.find((s) => s.steps.map((st) => st.techniqueId).join('>') === key) ?? null;
}

/** Compact text block of what MARTIALDEX knows around a technique — for LLM prompts (data only). */
export function knowledgeContextBlock(k: TechniqueKnowledge, max = 6): string {
  const name = (id: string) => resolveTechnique(id)?.name ?? id;
  const seq = (s: KnowledgeSequence) => `${s.steps.map((st) => st.name).join(' → ')}${s.purpose ? ` (${s.purpose.slice(0, 60)})` : ''} [${s.id}]`;
  const lines = [`기술: ${k.technique.name}${k.technique.koreanName ? ` / ${k.technique.koreanName}` : ''} [${k.technique.id}]`];
  if (k.setupsInto.length) lines.push(`이 기술로 들어가는 셋업: ${k.setupsInto.slice(0, max).map(seq).join(' | ')}`);
  if (k.combos.length) lines.push(`이 기술이 포함된 콤보: ${k.combos.slice(0, max).map((c) => seq(c.sequence)).join(' | ')}`);
  if (k.followUps.length) lines.push(`기록된 다음 동작: ${k.followUps.slice(0, max).map((f) => `${name(f.techniqueId)}×${f.count}`).join(', ')}`);
  if (k.leadIns.length) lines.push(`기록된 앞 동작: ${k.leadIns.slice(0, max).map((f) => `${name(f.techniqueId)}×${f.count}`).join(', ')}`);
  if (k.relatedIds.length) lines.push(`관련 기술: ${k.relatedIds.slice(0, max).map(name).join(', ')}`);
  return lines.join('\n');
}

export type { Technique };
