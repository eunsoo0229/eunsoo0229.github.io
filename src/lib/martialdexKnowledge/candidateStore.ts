// Local store of 신규 기술/셋업/콤보 후보 (local-first, like every user-data domain).
// Separate from the verified technique DB and from add_teq on purpose: a
// candidate is only research output until a person reviews it. A server table
// is drafted in supabase/migrations/0042_knowledge_candidates.sql (not applied).

import type { CandidateStatus, KnowledgeCandidate } from './types';

const KEY = 'martialdex:knowledge-candidates';
export const KNOWLEDGE_CANDIDATES_EVENT = 'martialdex:knowledge-candidates-updated';
const MAX = 500;

function read(): KnowledgeCandidate[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(all: KnowledgeCandidate[]): void {
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX)));
  window.dispatchEvent(new CustomEvent(KNOWLEDGE_CANDIDATES_EVENT));
}

export function candidateKey(c: Pick<KnowledgeCandidate, 'kind' | 'name' | 'martialArt' | 'steps'>): string {
  const steps = c.steps?.map((s) => s.techniqueId ?? s.name.toLowerCase()).join('>') ?? '';
  return `${c.kind}|${c.martialArt}|${steps || c.name.toLowerCase().trim()}`;
}

const RANK: Record<CandidateStatus, number> = { duplicate: 0, insufficient: 1, pending: 2, partially_verified: 3, verified: 4 };

export function listCandidates(): KnowledgeCandidate[] {
  return read();
}

/**
 * Insert or merge by candidateKey. Evidence is unioned by URL; the status may
 * only move up when the merged evidence supports it (the caller re-classifies).
 */
export function upsertCandidates(items: KnowledgeCandidate[]): KnowledgeCandidate[] {
  const all = read();
  const byKey = new Map(all.map((c) => [candidateKey(c), c]));
  for (const it of items) {
    const k = candidateKey(it);
    const prev = byKey.get(k);
    if (!prev) {
      byKey.set(k, it);
      continue;
    }
    const urls = new Set(prev.evidence.map((e) => e.url));
    const evidence = [...prev.evidence, ...it.evidence.filter((e) => !urls.has(e.url))];
    const better = RANK[it.status] >= RANK[prev.status] ? it : prev;
    byKey.set(k, { ...better, id: prev.id, createdAt: prev.createdAt, evidence });
  }
  const merged = [...byKey.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  write(merged);
  return merged;
}

export function removeCandidate(id: string): void {
  write(read().filter((c) => c.id !== id));
}
