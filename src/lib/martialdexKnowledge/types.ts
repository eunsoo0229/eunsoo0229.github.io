// MARTIALDEX 내부 지식 — techniques, setups, combos and the links between
// them, gathered from every in-app source (기술 DB, DB 콤보 기록, 사용자 콤보·셋업,
// 콤보 연결, 내 콤보 북) so the coach and the curriculum never reduce a topic
// to a list of single techniques.

import type { Technique } from '../../types';

export type SequenceKind = 'setup' | 'combo';

export type SequenceOrigin = 'technique_db' | 'shared_combo' | 'my_combo';

export const SEQUENCE_ORIGIN_LABEL: Record<SequenceOrigin, string> = {
  technique_db: 'MARTIALDEX 기술 DB',
  shared_combo: '사용자 콤보·셋업',
  my_combo: '내 콤보 북',
};

export interface SequenceStep {
  techniqueId: string;
  name: string;
  note?: string;
  /** The opponent reaction this step is meant to draw (setups). */
  opponentReaction?: string;
}

export interface KnowledgeSequence {
  /** origin-prefixed stable id: "db:<sourceRef>", "shared:<id>", "mine:<id>" */
  id: string;
  kind: SequenceKind;
  name: string;
  martialArt: string | null;
  purpose?: string;
  steps: SequenceStep[];
  origin: SequenceOrigin;
  /** e.g. likes on a shared combo — how many people back it, not a quality score. */
  supportCount?: number;
  sourceRef?: string | null;
}

export type SequenceLinkRelation = 'follow_up' | 'opens' | 'if_blocked';

export interface SequenceLink {
  fromId: string;
  toId: string;
  relation: SequenceLinkRelation;
  note?: string;
  support: number;
}

export interface KnowledgeIndex {
  sequences: KnowledgeSequence[];
  links: SequenceLink[];
  /** Which sources were actually available when the index was built (e.g. shared combos need the network). */
  sources: { origin: SequenceOrigin | 'combo_links'; count: number; ok: boolean; note?: string }[];
}

export interface TechniqueKnowledge {
  technique: Technique;
  /** Setups that END in this technique — how to create the opening for it. */
  setupsInto: KnowledgeSequence[];
  /** Combos in which this technique appears, with its position. */
  combos: { sequence: KnowledgeSequence; position: number }[];
  /** Setups that use this technique as a step on the way to something else. */
  setupsUsing: KnowledgeSequence[];
  /** Techniques that come right after this one in recorded sequences (follow-ups), most common first. */
  followUps: { techniqueId: string; count: number }[];
  /** Techniques that come right before it (lead-ins), most common first. */
  leadIns: { techniqueId: string; count: number }[];
  /** Ids from the technique record's own relatedTechniques (all real ids). */
  relatedIds: string[];
}

// 신규 기술/셋업/콤보 후보 — never written into the verified technique DB.
export type CandidateStatus = 'verified' | 'partially_verified' | 'pending' | 'insufficient' | 'duplicate';

export const CANDIDATE_STATUS_LABEL: Record<CandidateStatus, string> = {
  verified: '검증 완료',
  partially_verified: '일부 정보 확인',
  pending: '검증 대기',
  insufficient: '자료 부족',
  duplicate: '기존 데이터와 중복',
};

export interface CandidateEvidence {
  url: string;
  title?: string;
  /** Short quote the extractor claims supports the candidate. */
  quote: string;
  /** True only when the quote's words were really found in the page text we fetched. */
  quoteVerified: boolean;
  /** 'content' = extracted page text, 'snippet' = search engine summary only. */
  checkedAgainst: 'content' | 'snippet' | 'none';
  sourceType?: string;
  publishedAt?: string;
}

export interface RawCandidate {
  kind: 'technique' | SequenceKind;
  name: string;
  martialArt: string;
  /** For setups/combos: step names in order. */
  steps?: string[];
  evidence: Omit<CandidateEvidence, 'quoteVerified' | 'checkedAgainst'>[];
}

export interface KnowledgeCandidate {
  id: string;
  kind: 'technique' | SequenceKind;
  name: string;
  martialArt: string;
  steps?: { name: string; techniqueId: string | null }[];
  status: CandidateStatus;
  statusReasons: string[];
  evidence: CandidateEvidence[];
  duplicateOf?: { kind: 'technique' | 'sequence'; id: string; name: string };
  /** Existing techniques this candidate connects to (resolved steps, or the technique a setup leads into). */
  linkedTechniqueIds: string[];
  /** Step names that are not in the DB — each becomes its own technique candidate. */
  unresolvedSteps: string[];
  createdAt: string;
}
