// What a person approved from the curation candidates (data/curated/knowledge-review.json,
// written by scripts/review-knowledge-candidates.mjs). The only curation data the
// app applies to records. No dependency on loadData (it is read from there).

import reviewData from '../../../data/curated/knowledge-review.json';
import type { CurationCandidate, ReviewDecision } from './types';

type Decision = ReviewDecision & { candidate?: CurationCandidate };

const decisions = ((reviewData as { decisions?: Decision[] }).decisions ?? []).filter((d) => d.decision === 'approved' && d.candidate);

export interface ApprovedCuration {
  text: string;
  candidateId: string;
  reviewedBy: string;
  reviewedAt: string;
  sources: CurationCandidate['sources'];
}

const byTarget = new Map<string, { description?: ApprovedCuration; koreanName?: ApprovedCuration }>();
for (const d of decisions) {
  const c = d.candidate!;
  if ((c.kind !== 'description' && c.kind !== 'korean_name') || !c.text?.trim()) continue;
  const entry = byTarget.get(c.targetId) ?? {};
  entry[c.kind === 'description' ? 'description' : 'koreanName'] = { text: c.text.trim(), candidateId: c.id, reviewedBy: d.by, reviewedAt: d.at, sources: c.sources };
  byTarget.set(c.targetId, entry);
}

export function approvedCurationFor(techniqueIds: string[]): { description?: ApprovedCuration; koreanName?: ApprovedCuration } | null {
  for (const id of techniqueIds) {
    const hit = byTarget.get(id);
    if (hit) return hit;
  }
  return null;
}

/** Approved candidates of a kind (relations, sub-categories, technique records). */
export function approvedCandidates(kind: CurationCandidate['kind']): CurationCandidate[] {
  return decisions.map((d) => d.candidate!).filter((c) => c.kind === kind);
}
