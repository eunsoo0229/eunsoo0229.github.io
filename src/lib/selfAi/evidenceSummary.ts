// 근거·출처 신뢰성 (사양 §4-3 ~ §4-6) — on top of what the coach already records (sources with type / reliability /
// used, per-sentence claim checks): the spec's six source categories, one evidence status per answer, and
// disagreements BETWEEN sources. A category says what kind of publisher it is, never that the content is true.

import { checkClaims, PROBLEM_LABEL, type EvidenceSource } from './evidenceCheck';
import type { ChatSource, CoachChatMessage } from './types';

export type SourceCategory = 'official' | 'academic' | 'coach_education' | 'specialist_media' | 'community' | 'unverifiable';

export const SOURCE_CATEGORY_LABEL: Record<SourceCategory, string> = {
  official: '공식 기관·공식 규정',
  academic: '학술 연구·연구기관',
  coach_education: '전문 지도자·교육기관',
  specialist_media: '전문 매체·참고 자료',
  community: '커뮤니티·개인 게시물',
  unverifiable: '출처 확인 불가',
};

// coaches, academies, instructional publishers (hostname)
const COACH_EDU = /(bjjfanatics|grapplearts|evolve-mma|evolve-university|tristar|aka(thailand)?|jiujitsux|bjj-?mental|grapplingindustries|marcelogarcia|gracie|mma-?leech|fightscience|sportmentary|taipeibjj|bjjheroes|expertboxing|boxingscience|fightcamp|muaythaipros|yokkao|judoinfo|usawmembership|teamusa|wrestlingmindset|flowrestling|coach|academy|dojo|gym\.)/i;
// fight press / references
const MEDIA = /(mmajunkie|mmafighting|bloodyelbow|sherdog|tapology|boxrec|espn|cbssports|theringmag|ringtv|boxingscene|bjjee|flograppling|bjj ?eastern|onefc|mmamania|lowkickmma|sportskeeda|thesportster|ranker|mmaweekly|wikipedia|namu\.wiki|britannica|olympics\.com\/en\/news)/i;

function host(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^(www|m)\./, '');
  } catch {
    return '';
  }
}

export function categoryOf(s: Pick<ChatSource, 'url' | 'sourceType' | 'contentRead' | 'video'>): SourceCategory {
  const h = host(s.url);
  if (!h) return 'unverifiable';
  if (s.sourceType === 'official') return 'official';
  if (s.sourceType === 'academic') return 'academic';
  if (s.sourceType === 'forum' || s.sourceType === 'blog') return 'community';
  if (COACH_EDU.test(h)) return 'coach_education';
  if (s.sourceType === 'records' || s.sourceType === 'reference' || MEDIA.test(h)) return 'specialist_media';
  if (s.sourceType === 'video') return s.video?.channel ? 'coach_education' : 'unverifiable';
  // a general page the app could not even read: nothing tells who wrote it
  return s.contentRead ? 'specialist_media' : 'unverifiable';
}

export type EvidenceStatus = 'sufficient' | 'partial' | 'conflict' | 'none' | 'undecidable' | 'internal' | 'not_needed';

export const EVIDENCE_STATUS_LABEL: Record<EvidenceStatus, string> = {
  sufficient: '근거 충분',
  partial: '일부 근거만 확인',
  conflict: '자료 간 의견 다름',
  none: '관련 자료를 찾지 못함',
  undecidable: '현재 자료로 판단 어려움',
  internal: 'MARTIALDEX 내부 데이터 근거',
  not_needed: '근거 표시 대상 아님',
};

export const UNCERTAIN_SENTENCE = '현재 확인 가능한 자료만으로는 해당 내용을 확정하기 어렵습니다.';

export interface SourceConflict {
  a: number;
  b: number;
  aQuote: string;
  bQuote: string;
  why: string;
}

export interface EvidenceSummary {
  status: EvidenceStatus;
  label: string;
  /** One honest sentence for the learner. */
  text: string;
  categories: { category: SourceCategory; label: string; count: number }[];
}

const siteOf = (url: string) => host(url);

export function evidenceSummary(m: Pick<CoachChatMessage, 'sources' | 'claims' | 'research' | 'model' | 'personalData' | 'guardNotes'> & { sourceConflicts?: SourceConflict[] }): EvidenceSummary {
  const sources = (m.sources ?? []).filter((s) => s.sourceType !== 'video');
  const cats = new Map<SourceCategory, number>();
  for (const s of sources) cats.set(categoryOf(s), (cats.get(categoryOf(s)) ?? 0) + 1);
  const categories = [...cats.entries()].map(([category, count]) => ({ category, label: SOURCE_CATEGORY_LABEL[category], count }));
  const facts = (m.claims ?? []).filter((c) => c.status !== 'opinion');
  const supported = facts.filter((c) => c.status === 'supported');
  const contradicted = facts.filter((c) => c.status === 'contradicted').length || (m.guardNotes ?? []).filter((n) => /출처 \[\d+\]와 다른 내용/.test(n)).length;
  const sites = new Set(supported.map((c) => siteOf(sources.find((s) => s.n === c.source)?.url ?? '')).filter(Boolean));
  const done = (status: EvidenceStatus, text: string): EvidenceSummary => ({ status, label: EVIDENCE_STATUS_LABEL[status], text, categories });

  if (!sources.length) {
    if (m.personalData || /^martialdex-(data|plan|route|list|evidence)/.test(m.model ?? '')) return done('internal', 'MARTIALDEX 기술 데이터베이스·내 기록을 근거로 한 답변입니다 (외부 자료 검색 없음).');
    if (m.research?.searched) return done('none', `검색했지만 질문과 관련된 자료를 찾지 못했습니다. ${UNCERTAIN_SENTENCE}`);
    return done('not_needed', '외부 자료를 쓰지 않은 답변입니다.');
  }
  if (m.sourceConflicts?.length) return done('conflict', `자료끼리 서로 다르게 설명하는 부분이 ${m.sourceConflicts.length}곳 있습니다 — 아래에 양쪽 문장을 함께 보여 드립니다. 어느 한쪽을 정답으로 정하지 않았습니다.`);
  if (!sources.some((s) => s.contentRead)) return done('undecidable', `찾은 자료의 본문을 읽지 못해(영상이거나 자동 수집이 막힌 사이트) 내용을 대조하지 못했습니다. ${UNCERTAIN_SENTENCE}`);
  if (!facts.length) return done('partial', '자료를 찾았지만 답변 문장과 대조할 수 있는 사실 문장이 없습니다 — 출처 원문을 직접 확인해 주세요.');
  const ratio = supported.length / facts.length;
  if (contradicted) return done('partial', `출처와 다른 내용 ${contradicted}개는 답변에서 지웠습니다. 남은 문장 중 ${supported.length}/${facts.length}개가 출처 문장과 일치합니다.`);
  if (ratio >= 0.6 && sites.size >= 2) return done('sufficient', `답변 문장 ${supported.length}/${facts.length}개가 서로 다른 자료 ${sites.size}곳의 문장과 일치합니다.`);
  if (supported.length) return done('partial', `답변 문장 ${supported.length}/${facts.length}개만 출처 문장과 일치합니다${sites.size < 2 ? ' (근거가 한 곳의 자료뿐)' : ''}. 나머지는 직접 확인이 필요합니다.`);
  return done('undecidable', `답변 문장 중 출처 문장과 일치하는 것이 없습니다. ${UNCERTAIN_SENTENCE}`);
}

/** Sentences in one source that another source contradicts (same checks as answer-vs-source, source-vs-source). */
export function sourceConflicts(excerpts: EvidenceSource[], max = 3): SourceConflict[] {
  const out: SourceConflict[] = [];
  for (const a of excerpts) {
    const others = excerpts.filter((b) => b.n !== a.n);
    if (!others.length || !a.text.trim()) continue;
    for (const c of checkClaims(a.text, others)) {
      if (c.status !== 'contradicted' || c.source === null || !c.quote) continue;
      if (out.some((x) => (x.a === c.source && x.b === a.n) || (x.a === a.n && x.b === c.source))) continue;
      out.push({ a: a.n, b: c.source, aQuote: c.sentence.slice(0, 200), bQuote: c.quote.slice(0, 200), why: c.problems.map((p) => PROBLEM_LABEL[p]).join(', ') || '내용이 서로 다름' });
      if (out.length >= max) return out;
    }
  }
  return out;
}
