// 사용자·관리자가 만든 기술 카테고리 — the technique taxonomy (techniqueTaxonomy/) is computed from each art's
// official categories and never edited; categories created when registering a new technique live here and are
// attached to that taxonomy as extra nodes. Technique ids never change: a technique points at a node
// (Technique.taxonomyNodeId), and renaming / moving / merging a category only changes this record.

export type CategoryStatus = 'active' | 'inactive' | 'merged';

export interface CustomCategory {
  /** `${art}/c-<slug>` — stable; never reused for another category. */
  id: string;
  art: string;
  /** A taxonomy node id (built-in) or another custom category id in the SAME art; null = new top-level (Level 2) group. */
  parentId: string | null;
  ko: string;
  en: string;
  description: string;
  status: CategoryStatus;
  /** status 'merged': the category its techniques now belong to. */
  mergedInto: string | null;
  /**
   * Top-level groups only: the category string techniques filed here carry in `technique.category`
   * ("스크램블 (Scrambles)") — what every existing category filter keeps reading.
   */
  categoryString: string | null;
  createdBy: string | null;
  /** user = made while registering a technique; admin = category management; ai_approved = an AI proposal a person approved. */
  origin: 'user' | 'admin' | 'ai_approved';
  createdAt: string;
  updatedAt: string;
  /** Saved on this device only (logged out, or the server table isn't deployed yet). */
  local?: boolean;
}

export interface NewCategoryInput {
  art: string;
  parentId: string | null;
  ko: string;
  en: string;
  description?: string;
  origin?: CustomCategory['origin'];
}

/** A category already in the art that the new one would duplicate (or nearly). */
export interface CategoryMatch {
  nodeId: string;
  label: string;
  path: string;
  /** same = the same category (creation blocked, use this one); similar = check before creating. */
  kind: 'same' | 'similar';
  reason: string;
}
