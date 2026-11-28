import { ENTRIES as V1, SOURCES as S1 } from '../../../data/curated-combos/curated-v1.mjs';
import { ENTRIES as MMA2, SOURCES as S2 } from '../../../data/curated-combos/curated-mma-v2.mjs';
import { ENTRIES as DEF1, SOURCES as S3 } from '../../../data/curated-combos/curated-defense-v1.mjs';
import type { CuratedEntry } from '../../../data/curated-combos/curated-v1.mjs';
import { listMyCombos } from '../combo/service';
import { listMyTactics } from '../tactic/service';
import { resolveTechnique } from '../userTechniques/service';
import { RECORD_FEATURE_RULES } from './lexicon';
import { indexedById, resolveName } from './techniqueIndex';
import type { Feature, StepRef } from './types';

// Combos and setups come from three places, never from a model:
//  1. the sourced library in data/curated-combos (270 entries the operator published to 사용자 콤보, each with a
//     source article or marked "운영자 정리"), its step names resolved against the technique DB here;
//  2. the user's own 콤보 북 (combo/service) and 전술 셋업 (tactic/service) — already technique ids.
// A step whose name has no DB record stays in the card as "DB 미확인" and the entry is never described as verified.

export interface LibraryEntry {
  key: string;
  kind: 'combo' | 'setup';
  art: string;
  title: string;
  purpose: string;
  desc: string;
  steps: StepRef[];
  features: Set<Feature>;
  /** lower-cased purpose + description + reactions + step names — matched against the analysed input */
  text: string;
  sources: { label: string; url: string | null }[];
  origin: 'curated-library' | 'my-combo' | 'my-tactic';
  allInDb: boolean;
}

const SOURCES: Record<string, { label: string; url: string | null }> = { ...S3, ...S2, ...S1 };
let cache: LibraryEntry[] | null = null;

function stepOf(raw: string | { t: string; note?: string; react?: string }, art: string): StepRef {
  const name = typeof raw === 'string' ? raw : raw.t;
  const it = resolveName(name, [art]);
  return {
    name: it ? it.t.name : name.split('@')[0],
    techniqueId: it ? it.t.id : null,
    martialArt: it ? it.t.martialArt : null,
    inDb: !!it,
    role: null,
    note: typeof raw === 'string' ? null : raw.note ?? null,
    react: typeof raw === 'string' ? null : raw.react ?? null,
  };
}

function featuresOf(text: string, steps: StepRef[]): Set<Feature> {
  const f = new Set<Feature>();
  for (const r of RECORD_FEATURE_RULES) if (r.re.test(text)) f.add(r.value);
  for (const s of steps) if (s.techniqueId) for (const x of indexedById(s.techniqueId)?.features ?? []) f.add(x);
  if (steps.length > 1) f.add('combination');
  return f;
}

function curated(e: CuratedEntry, i: number, set: string): LibraryEntry {
  const steps = e.steps.map((s) => stepOf(s, e.art));
  const title = e.label ? `${e.label} · ${steps.map((s) => s.name).join(' → ')}` : steps.map((s) => s.name).join(' → ');
  const text = `${e.purpose} ${e.desc} ${steps.map((s) => `${s.name} ${s.note ?? ''} ${s.react ?? ''}`).join(' ')}`.toLowerCase();
  return {
    key: `lib:${set}:${i}`,
    kind: e.kind,
    art: e.art,
    title,
    purpose: e.purpose,
    desc: e.desc,
    steps,
    features: featuresOf(text, steps),
    text,
    sources: e.src.map((k) => SOURCES[k] ?? { label: k, url: null }),
    origin: 'curated-library',
    allInDb: steps.every((s) => s.inDb),
  };
}

export function curatedLibrary(): LibraryEntry[] {
  if (!cache) cache = [...V1.map((e, i) => curated(e, i, 'v1')), ...MMA2.map((e, i) => curated(e, i, 'mma2')), ...DEF1.map((e, i) => curated(e, i, 'def1'))];
  return cache;
}

function idStep(id: string): StepRef {
  const t = resolveTechnique(id);
  return { name: t?.name ?? id, techniqueId: t ? t.id : null, martialArt: t?.martialArt ?? null, inDb: !!t, role: null, note: null, react: null };
}

/** The user's own combos and tactics (read on every search: they change while the app runs). */
export function personalLibrary(): LibraryEntry[] {
  const out: LibraryEntry[] = [];
  for (const c of listMyCombos()) {
    const steps = c.techniqueIds.map(idStep);
    if (steps.length < 2) continue;
    const text = `${c.name} ${c.description} ${steps.map((s) => s.name).join(' ')}`.toLowerCase();
    out.push({ key: `combo:${c.id}`, kind: 'combo', art: steps.find((s) => s.martialArt)?.martialArt ?? '', title: c.name, purpose: c.description, desc: c.aiComboMeta?.goalText ?? '', steps, features: featuresOf(text, steps), text, sources: [{ label: '내 콤보 북', url: null }], origin: 'my-combo', allInDb: steps.every((s) => s.inDb) });
  }
  for (const t of listMyTactics()) {
    const steps = t.techniqueIds.map(idStep);
    if (!steps.length) continue;
    const text = `${t.name} ${t.situation} ${steps.map((s) => s.name).join(' ')}`.toLowerCase();
    out.push({ key: `tactic:${t.id}`, kind: 'setup', art: steps.find((s) => s.martialArt)?.martialArt ?? '', title: t.name, purpose: t.situation, desc: t.feedback ?? '', steps, features: featuresOf(text, steps), text, sources: [{ label: '내 전술 셋업', url: null }], origin: 'my-tactic', allInDb: steps.every((s) => s.inDb) });
  }
  return out;
}
