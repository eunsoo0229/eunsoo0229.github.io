// 개인 파이터 프로필 (Personal Fighter Profile) — what the user told / measured /
// confirmed about themselves as a fighter. Built through an interview
// (interview.ts), edited item by item, read by the AI coaches (coachContext.ts).
//
// Every item keeps WHERE it came from (source) and HOW sure it is (status):
// the user's own words, a measurement, a video observation, a calculation and
// an AI inference are never treated as the same kind of fact.

export type SectionId = 'body' | 'striking' | 'defense' | 'movement' | 'grappling' | 'positions' | 'style' | 'training';

export type Source = 'self_report' | 'measured' | 'video_observed' | 'system_calculated' | 'coach_inferred';
export type Status = 'confirmed' | 'unconfirmed' | 'needs_review' | 'outdated';

/** 신체 치수 / 정지 상태 기술 도달 거리 / 실제 동작 중 도달 거리 — never mixed or compared. */
export type MeasureKind = 'body' | 'static_reach' | 'dynamic_reach';
export type MeasureMethod =
  | 'tape_self'
  | 'tape_helper'
  | 'official'
  | 'estimate'
  | 'wall_static'
  | 'partner_static'
  | 'floor_marker'
  | 'partner_mitt'
  | 'video';

export interface Measurement {
  kind: MeasureKind;
  unit: 'cm' | 'kg';
  method: MeasureMethod | null;
  /** YYYY-MM-DD the user measured it (not when it was typed in). */
  measuredAt: string | null;
  side?: 'left' | 'right' | null;
  limb?: 'lead' | 'rear' | null;
  confidence: 'high' | 'medium' | 'low';
  conditions?: string | null;
}

export type ProfileValue = string | number | boolean | string[];

export interface ProfileItem {
  key: string;
  /** answered = has a value; unknown = "모르겠어요" (미확인); skipped = the user chose not to answer. */
  state: 'answered' | 'unknown' | 'skipped';
  value: ProfileValue | null;
  /** The user's own words this came from (kept so a later reviewer can re-read it). */
  note?: string | null;
  source: Source;
  status: Status;
  measurement?: Measurement;
  /** video_observed only: what was seen, kept apart from what it might mean. */
  observation?: { observed: string; interpretation: string | null };
  createdAt: string;
  updatedAt: string;
  /** Tombstone — kept so a deletion syncs instead of being re-pulled. */
  deletedAt?: string | null;
}

export interface StyleTag {
  id: string;
  label: string;
  role: 'primary' | 'secondary' | 'tendency';
  /** The profile items this was concluded from (shown to the user). */
  basis: string[];
}

export interface StyleAnalysis {
  tags: StyleTag[];
  source: 'coach_inferred';
  /** confirmed only after the user said it fits; unconfirmed = shown but not accepted. */
  status: 'confirmed' | 'unconfirmed';
  analyzedAt: string;
  confirmedAt: string | null;
  updatedAt: string;
}

export interface HistoryEntry {
  id: string;
  at: string;
  key: string;
  action: 'set' | 'delete' | 'confirm' | 'review' | 'style';
  from?: ProfileValue | null;
  to?: ProfileValue | null;
  by: 'user' | 'interview' | 'system';
}

export interface InterviewMessage {
  role: 'coach' | 'user';
  text: string;
  at: string;
  /** The field this message asked about / answered. */
  key?: string | null;
}

/** Something the user said that answers ANOTHER question — saved only after the user confirms it. */
export interface Proposal {
  key: string;
  value: ProfileValue;
  evidence: string;
}

export interface InterviewState {
  status: 'idle' | 'active' | 'paused' | 'finished';
  /** The field being asked right now (null between questions / when finished). */
  currentKey: string | null;
  /** One clarification per field at most. */
  clarifying: boolean;
  messages: InterviewMessage[];
  pending: Proposal[];
  startedAt: string | null;
  updatedAt: string;
}

export interface FighterProfile {
  version: 1;
  items: Record<string, ProfileItem>;
  style: StyleAnalysis | null;
  history: HistoryEntry[];
  interview: InterviewState;
  updatedAt: string;
}
