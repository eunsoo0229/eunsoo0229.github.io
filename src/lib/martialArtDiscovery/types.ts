import type { Difficulty, PostureInfo } from '../../types';

/** A real source page actually returned by Tavily and actually cited as evidence — never fabricated (see aiVerification.ts). */
export interface WebEvidenceSource {
  title: string;
  url: string;
  /** Short excerpt/paraphrase of what in the source actually supports the verdict — never invented. */
  snippet: string;
}

export type TechniqueCategory = 'strike' | 'kick' | 'defense' | 'evasion' | 'takedown' | 'clinch' | 'grip' | 'other';

export interface DiscoveredTechniqueCandidate {
  name: string;
  nameKo: string | null;
  category: TechniqueCategory;
  description: string;
  sources: WebEvidenceSource[];
  confidence: number;
  /** True once this candidate survived the dedup pass (kept as the representative of its group) — false entries are never shown/selectable. */
  selected: boolean;
  /** Evidence-backed posture writeup (same schema as the official curated Technique.posture) — null when the real evidence in hand wasn't enough to responsibly fill it (never fabricated; matches data/curated/POSTURE_PROGRESS.md's own "확신 없으면 스킵" rule). */
  posture: PostureInfo | null;
  /** Criteria-based assessment (spec "긴급 안정화" section 11: complexity/coordination/balance/timing/prerequisite, not sourced from external evidence) — null when even that judgment isn't reasonably confident. */
  difficulty: Difficulty;
}

export type SingleTechniqueVerificationStatus =
  | 'already_exists'
  | 'verified'
  | 'multiple_candidates'
  | 'wrong_martial_art'
  | 'not_a_technique'
  | 'insufficient_web_evidence'
  | 'search_unavailable';

export interface SingleTechniqueVerificationOutcome {
  status: SingleTechniqueVerificationStatus;
  existingTechniqueId?: string;
  existingTechniqueName?: string;
  /** Set only when status === 'verified' (exactly one confirmed candidate). */
  candidate?: DiscoveredTechniqueCandidate;
  /** Set only when status === 'multiple_candidates' — a natural-language request matched more than one distinct, evidence-backed real technique; the user picks one. */
  candidates?: DiscoveredTechniqueCandidate[];
  /** Set only when status === 'wrong_martial_art' — the martial art the evidence actually shows this technique belongs to, if identifiable. */
  likelyMartialArt?: string | null;
  executedQueries: string[];
  wavesRun: number;
  errorMessage?: string;
}
