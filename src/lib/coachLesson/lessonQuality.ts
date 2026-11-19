import type { Technique } from '../../types';
import { contentTokens, overlap } from './text';

// Text checks for lesson content and data answers (pure — no data loading):
// repeated, near-repeated, empty or meaningless sentences, and text that defines
// another technique. Lessons are built only from MARTIALDEX data (concepts.ts);
// whether a record has enough data to be taught is lessonReadiness.ts.

// ---------------------------------------------------------------- text checks

export type TextIssueKind = 'repeat' | 'near_repeat' | 'meaningless' | 'empty_quote' | 'too_short' | 'name_mismatch';

export interface TextIssue {
  kind: TextIssueKind;
  text: string;
  /** For repeats: the earlier sentence it repeats. */
  of?: string;
}

const norm = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').replace(/[.。!?…\s]+$/, '').trim().toLowerCase();

/** Sentences of a text (Korean sentence endings, line breaks, " / " separators). */
export function sentencesOf(text: string): string[] {
  return text
    .split(/\n+|(?<=[.!?。])\s+|\s+\/\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

// Sentences that carry no information about the technique on their own.
const MEANINGLESS = [
  /^.{0,40}(은|는)\s*.{0,40}\s*분류의\s*(기술|동작)입니다\.?$/, // "X은 Y 분류의 기술입니다" — only the category
  /^[-—–\s.·]+$/,
  /---/,
  /^(정리하면|한 문장으로 (다시 )?말씀드리면|쉽게 말하면)[,\s]*\.?$/,
];

export function isMeaningless(s: string): boolean {
  const t = s.trim();
  if (!t) return true;
  if (MEANINGLESS.some((re) => re.test(t))) return true;
  return contentTokens(t).length === 0;
}

/**
 * Share of the longer sentence's content words found in the other (Korean verb
 * endings differ: 넘기기 / 넘겨야 count as the same word — text.ts tokenMatch).
 */
function similarity(a: string[], b: string[]): number {
  if (!a.length || !b.length) return 0;
  const [long, short] = a.length >= b.length ? [a, b] : [b, a];
  return overlap(long, short) / long.length;
}

// List lines ("  1. [핵심] A · 중급 — 자료: …") share their template by design.
const LIST_LINE = /^\s*(\d+\.|[•·\-])\s/;

export interface TextCheckOptions {
  /** Token similarity at which two sentences count as the same content. */
  nearRepeat?: number;
  /** Fewer content tokens than this in the whole text = too short. */
  minTokens?: number;
  /** The technique the text is about (name mismatch check). */
  technique?: Technique;
  /** Names of OTHER techniques that must not be described as this one. */
  otherNames?: string[];
  /**
   * Lines that restate on purpose (a lesson's "정리하면 …" answer after misses, the
   * recap): they may repeat what was taught; everything else must say something new.
   */
  restate?: RegExp;
}

/**
 * Repeated / near-repeated / meaningless / empty sentences in one text or a list
 * of texts (lesson stages). Short framing sentences (questions, "좋습니다") are
 * not compared: a lesson may ask "여기까지 이해되셨습니까?" more than once.
 */
export function checkText(texts: string | string[], opts: TextCheckOptions = {}): TextIssue[] {
  const issues: TextIssue[] = [];
  const near = opts.nearRepeat ?? 0.8;
  const seen: { n: string; tokens: string[]; text: string }[] = [];
  let tokenTotal = 0;
  for (const text of Array.isArray(texts) ? texts : [texts]) {
    if (/""|“”|''/.test(text)) issues.push({ kind: 'empty_quote', text });
    const restating = !!opts.restate && opts.restate.test(text.trim());
    const listLine = LIST_LINE.test(text);
    for (const s of sentencesOf(text)) {
      const tokens = contentTokens(s);
      tokenTotal += tokens.length;
      if (/[?？]$/.test(s) || tokens.length < 3) continue;
      if (isMeaningless(s)) {
        issues.push({ kind: 'meaningless', text: s });
        continue;
      }
      const n = norm(s);
      if (!restating) {
        const same = seen.find((x) => x.n === n);
        if (same) issues.push({ kind: 'repeat', text: s, of: same.text });
        else if (!listLine) {
          const sim = seen.find((x) => similarity(x.tokens, tokens) >= near);
          if (sim) issues.push({ kind: 'near_repeat', text: s, of: sim.text });
        }
      }
      seen.push({ n, tokens, text: s });
    }
  }
  if (opts.minTokens && tokenTotal < opts.minTokens) issues.push({ kind: 'too_short', text: (Array.isArray(texts) ? texts.join(' ') : texts).slice(0, 80) });
  if (opts.technique && opts.otherNames?.length) {
    const own = [opts.technique.name, opts.technique.koreanName ?? '', ...opts.technique.aliases].filter((x) => x.length >= 2).map((x) => x.toLowerCase());
    for (const s of Array.isArray(texts) ? texts : [texts]) {
      // "더블 레그 테이크다운은 …" as the explanation of Single Leg: the text defines another technique.
      const head = s.trim().slice(0, 40).toLowerCase();
      const other = opts.otherNames.find((n) => n.length >= 3 && head.startsWith(n.toLowerCase()) && !own.some((o) => head.startsWith(o)));
      if (other) issues.push({ kind: 'name_mismatch', text: s, of: other });
    }
  }
  return issues;
}

/** True when every informative sentence of `text` repeats (or nearly repeats) one of `earlier`. */
export function addsNothing(text: string, earlier: string[], nearRepeat = 0.8): boolean {
  const before = earlier.flatMap(sentencesOf).map((s) => ({ n: norm(s), tokens: contentTokens(s) }));
  const informative = sentencesOf(text).filter((s) => contentTokens(s).length >= 3);
  if (!informative.length) return false;
  return informative.every((s) => {
    const tokens = contentTokens(s);
    return before.some((b) => b.n === norm(s) || similarity(b.tokens, tokens) >= nearRepeat);
  });
}

/** Drops sentences that repeat earlier ones (exact or near) — keeps the first, in order. */
export function dedupeSentences(texts: string[], nearRepeat = 0.8): string[] {
  const kept: { n: string; tokens: string[] }[] = [];
  const out: string[] = [];
  for (const text of texts) {
    const sentences = sentencesOf(text).filter((s) => {
      const tokens = contentTokens(s);
      if (tokens.length < 3) return true;
      const n = norm(s);
      if (kept.some((k) => k.n === n || similarity(k.tokens, tokens) >= nearRepeat)) return false;
      kept.push({ n, tokens });
      return true;
    });
    if (sentences.length) out.push(sentences.join(' '));
  }
  return out;
}
