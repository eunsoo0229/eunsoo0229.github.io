// Types for the sourced combo / setup library (read by src/lib/tacticalFinder/comboLibrary.ts).
export interface CuratedSetupStep {
  t: string;
  note?: string;
  react?: string;
}
export interface CuratedEntry {
  kind: 'combo' | 'setup';
  art: string;
  steps: (string | CuratedSetupStep)[];
  purpose: string;
  desc: string;
  src: string[];
  label?: string;
}
export const SOURCES: Record<string, { label: string; url: string | null }>;
export const ENTRIES: CuratedEntry[];
