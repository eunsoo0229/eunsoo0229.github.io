// TACTICAL FINDER — the user types a goal / situation in plain language, the system finds real MARTIALDEX
// techniques, setups and combinations for it. Everything recommended is a record that exists in the technique DB
// (data/processed via loadData) or in the sourced combo/setup library (data/curated-combos); nothing is invented.

/** Tactical features shared by the intent analysis and the technique / combo indexes (one vocabulary). */
export type Feature =
  | 'punch'
  | 'kick'
  | 'knee'
  | 'elbow'
  | 'body'
  | 'footwork'
  | 'feint'
  | 'defense'
  | 'counter'
  | 'pressure'
  | 'distance'
  | 'combination'
  | 'takedown'
  | 'tdDefense'
  | 'clinch'
  | 'groundTop'
  | 'guard'
  | 'sweep'
  | 'submission'
  | 'escape'
  | 'pass'
  | 'back'
  | 'transition';

export type Goal = 'attack' | 'defense' | 'counter' | 'distance' | 'takedown' | 'tdDefense' | 'position' | 'escape' | 'sweep' | 'submission' | 'clinch' | 'transition';
export type Behavior = 'retreat' | 'pressure' | 'guardHigh' | 'jabReaction' | 'takedownAttempt' | 'clinch' | 'kicks' | 'counterWaiting' | 'taller' | 'bottom' | 'top' | 'inGuard' | 'onBack' | 'punches' | 'blocks';
export type Range = 'long' | 'mid' | 'close' | 'clinch' | 'ground';
export type Intent = 'offense' | 'defense' | 'mixed';
export type DifficultyPref = 'beginner' | 'intermediate' | 'advanced';
export type RecKind = 'technique' | 'setup' | 'combo' | 'alternative';
export type QuickCategory = 'striking' | 'grappling' | 'wrestling' | 'mma' | 'defense' | 'counter' | 'distance' | 'transitions';

/** One analysed field with where it came from — a field the user did not give stays null (never guessed). */
export interface FieldValue<T> {
  value: T;
  /** The words in the input that set it (shown to the user as the evidence). */
  evidence: string[];
  source: 'rule' | 'ai' | 'category' | 'filter';
}

export interface MentionedTechnique {
  techniqueId: string;
  name: string;
  martialArt: string;
  term: string;
  /** The user wants to use this move (its family is ranked up); false = the opponent's move or the move before. */
  wanted: boolean;
}

export interface Analysis {
  text: string;
  normalized: string;
  goals: FieldValue<Goal>[];
  behaviors: FieldValue<Behavior>[];
  range: FieldValue<Range> | null;
  arts: FieldValue<string>[];
  intent: FieldValue<Intent> | null;
  techniqueTypes: FieldValue<Feature>[];
  difficulty: FieldValue<DifficultyPref> | null;
  stance: FieldValue<'orthodox' | 'southpaw'> | null;
  wantsKind: FieldValue<'setup' | 'combo' | 'technique'> | null;
  mentioned: MentionedTechnique[];
  /** Technique-like names in the input that match no record (reported as "DB에서 찾지 못함", never described). */
  unknownTerms: string[];
  /** Plain-language summary lines (목적 / 상황 / 전술 유형 …), built from the fields above only. */
  summary: { label: string; value: string }[];
  /** True when the request aims at hurting someone outside sport — answered with a safety notice + sport alternatives. */
  safety: { blocked: boolean; terms: string[] };
  /** Features the recommendation looks for, with the weight each analysed field gave them. */
  wanted: Partial<Record<Feature, number>>;
  /** 0..1 — how much of the input the analysis understood (fields found / words that mattered). */
  confidence: number;
  ai: { used: boolean; ok: boolean; message: string | null };
}

export interface ScorePart {
  key: 'goal' | 'situation' | 'connection' | 'art' | 'difficulty' | 'reliability' | 'personal';
  label: string;
  points: number;
  max: number;
}

export interface StepRef {
  /** The step as written in the source (the DB name of the record when resolved). */
  name: string;
  techniqueId: string | null;
  martialArt: string | null;
  /** Confirmed in the MARTIALDEX technique DB. */
  inDb: boolean;
  role: string | null;
  note: string | null;
  /** Setup steps: the opponent reaction this step is meant to draw (from the source data). */
  react: string | null;
}

export interface Recommendation {
  key: string;
  kind: RecKind;
  /** A technique card: the technique id. A setup / combo card: null. */
  techniqueId: string | null;
  title: string;
  martialArt: string;
  artLabel: string;
  steps: StepRef[];
  reasons: string[];
  situations: string[];
  difficulty: string | null;
  score: number;
  scoreParts: ScorePart[];
  /** Where the card comes from — the reader can judge reliability. */
  origin: 'technique-db' | 'curated-library' | 'my-combo' | 'my-tactic' | 'graph' | 'ai-generated';
  originLabel: string;
  sourceLinks: { label: string; url: string | null }[];
  purpose: string | null;
  expectedReaction: string | null;
  followUps: StepRef[];
  successConditions: string[];
  ifDifferent: { label: string; steps: StepRef[] }[];
  hasMotion3d: boolean;
  /** The user's own mastery of this technique (personalised runs only). */
  mastery: string | null;
}

export interface Filters {
  art: string | null;
  difficulty: DifficultyPref | null;
  kind: RecKind | null;
  count: 3 | 5 | 10;
  personal: boolean;
  category: QuickCategory | null;
}

export interface FinderResult {
  query: string;
  filters: Filters;
  analysis: Analysis;
  techniques: Recommendation[];
  setups: Recommendation[];
  combos: Recommendation[];
  alternatives: Recommendation[];
  /** Notices shown above the results (no match, information missing, AI not used, safety …). */
  notices: { tone: 'info' | 'warn'; text: string }[];
  page: number;
  hasMore: boolean;
  elapsedMs: number;
  cached: boolean;
  personalApplied: string[];
}
