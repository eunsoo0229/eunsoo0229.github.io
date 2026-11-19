// Only the sentences of fetched pages that are about the question go to the local
// model. Measured on this Mac (qwen2.5:3b, CPU): reading the prompt runs at ~40–60
// tokens/s, so a 7,000-character prompt cost ~45 s before the first word — and most
// of it was page text unrelated to the question. A smaller, focused prompt is both
// faster and keeps the summary on the sources' relevant lines.

import type { ResearchResult } from '../selfResearch/types';

export interface FocusedSource {
  /** 1-based number the answer cites ([n]) — the source's position in the list shown. */
  n: number;
  result: ResearchResult;
  excerpt: string;
}

function sentences(text: string): string[] {
  return text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?。])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 20 && s.length <= 500);
}

/**
 * Per source: the sentences containing any of `terms` (case-insensitive), up to
 * `perSource` characters. Sources with no such sentence are left out — the model is
 * never asked to summarise a page that does not address the question.
 */
export function focusSources(results: ResearchResult[], terms: string[], opts: { max?: number; perSource?: number; contentOnly?: boolean } = {}): FocusedSource[] {
  const words = [...new Set(terms.map((t) => t.toLowerCase().trim()).filter((t) => t.length >= 2))];
  if (!words.length) return [];
  const out: FocusedSource[] = [];
  for (const [i, r] of results.entries()) {
    // contentOnly: page text that was really read (a search engine's one-line summary is not a source to summarise)
    const text = opts.contentOnly ? r.content ?? '' : r.content ?? r.snippet ?? '';
    const hits = sentences(text).filter((s) => words.some((w) => s.toLowerCase().includes(w)));
    if (!hits.length) continue;
    let excerpt = '';
    for (const h of hits) {
      if (excerpt.length + h.length > (opts.perSource ?? 600)) break;
      excerpt += `${excerpt ? ' ' : ''}${h}`;
    }
    if (excerpt) out.push({ n: i + 1, result: r, excerpt });
    if (out.length >= (opts.max ?? 4)) break;
  }
  return out;
}

export function focusedBlock(sources: FocusedSource[]): string {
  return sources.map((s) => `[${s.n}] ${s.result.title} (${s.result.source ?? ''})\n${s.excerpt}`).join('\n\n');
}
