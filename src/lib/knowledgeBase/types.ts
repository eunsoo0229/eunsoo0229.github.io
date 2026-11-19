// Curation candidates for the MARTIALDEX technique DB — descriptions, Korean names,
// relations between techniques, sub-categories and new technique records — kept
// OUTSIDE the official DB (data/processed + data/curated) until a person approves
// them (data/curated/knowledge-review.json). Each carries where it came from and how
// well it is supported. Nothing here is ever written into the official records
// automatically, and AI-written text is never marked as verified.

/** Verification status (spec order, strongest first). */
export type CurationStatus =
  | 'verified' // 검증 완료 — a person reviewed it against its sources
  | 'multi_source' // 복수 자료 확인 — ≥2 independent sources say it
  | 'single_source' // 단일 자료 확인 — exactly one source says it
  | 'needs_review' // 검토 필요 — a source exists but does not say it plainly / it is a classification judgement
  | 'insufficient' // 자료 부족 — no source found
  | 'cannot_generate'; // 설명 생성 불가 — not a single technique (a form, a rule set, a concept heading)

export const CURATION_STATUS_LABEL: Record<CurationStatus, string> = {
  verified: '검증 완료',
  multi_source: '복수 자료 확인',
  single_source: '단일 자료 확인',
  needs_review: '검토 필요',
  insufficient: '자료 부족',
  cannot_generate: '설명 생성 불가',
};

export type CurationSourceKind =
  /** data/raw/*.md — the encyclopedia the official DB was parsed from. */
  | 'internal_encyclopedia'
  /** data/curated/posture.json — the app's curated per-technique posture text. */
  | 'internal_posture'
  /** A fetched web page whose text contained the quote (checked in code). */
  | 'web';

export interface CurationSource {
  kind: CurationSourceKind;
  /** File#section for internal sources, URL for web. */
  ref: string;
  title?: string;
  /** The sentence that supports the candidate, copied verbatim. */
  quote: string;
  /** Web only: whether the quote was found in the page body (not just a search snippet). */
  quoteInBody?: boolean;
}

export type CandidateKind = 'description' | 'korean_name' | 'relation' | 'subcategory' | 'technique';

export type RelationKind =
  | 'next' // A → B in a recorded flow
  | 'on_reaction' // A, then B when the opponent reacts (the reaction is in `condition`)
  | 'setup' // A sets up B
  | 'combo_step' // A is followed by B inside a combination
  | 'on_failure' // when A fails, go to B
  | 'prerequisite' // learn A before B
  | 'counter' // B counters A
  | 'variation_of' // A is a variation of base B
  | 'answers_situation'; // the technique (toId = targetId) is the recorded answer to `condition`

export interface CurationCandidate {
  /** Stable: "<kind>:<target>[:<extra>]". */
  id: string;
  kind: CandidateKind;
  martialArt: string;
  /** The official technique id this candidate is about (description / korean_name / relation from / technique id). */
  targetId: string;
  status: CurationStatus;
  /** Why this status (shown to the reviewer). */
  statusReason: string;
  sources: CurationSource[];
  /** description / korean_name: the text. */
  text?: string;
  relation?: { kind: RelationKind; toId: string; condition?: string };
  subcategory?: { parentCategory: string; title: string; order: number; techniqueIds: string[] };
  technique?: { name: string; koreanName: string | null; category: string; subcategory?: string; variationIds?: string[]; description: string };
  /** Which script made it. */
  createdBy: string;
}

export interface ReviewDecision {
  id: string;
  decision: 'approved' | 'rejected';
  by: string;
  at: string;
  note?: string;
}

export interface CandidateFile {
  version: number;
  generatedAt: string;
  about: string;
  candidates: CurationCandidate[];
}
