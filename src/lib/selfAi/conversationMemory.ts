// What this conversation has been about — short-term + topic memory (사양 §6-1, §6-2).
//
// The coach used to see only the last 4 turns as raw text (coachAgent historyMessages), so
// "아까 이야기했던 내용으로 수업하고 싶어" after one unrelated question had nothing to point
// at, and a lesson request that names no technique got no "수업 시작" button.
// The conversation is already stored message by message (conversationStore.ts) with the
// technique ids, sources and videos each answer used, so the memory is DERIVED from it —
// no second store, nothing to fall out of sync, and an old conversation works too.
// Long-term memory (profile, goals, learned techniques, lesson logs, difficulties said to the
// coach) stays where it is (coachContext/userContext, coachLesson/lessonLog); this file only
// adds the topics of the user's other recent conversations, read from the same store.

import type { CoachChatMessage, LessonProposal } from './types';
import { resolveTechnique } from '../userTechniques/service';
import { canonicalTechniqueId } from '../techniqueCanonical';

export type Aspect = 'explain' | 'setup' | 'mma' | 'video' | 'web' | 'fit' | 'compare' | 'fighter' | 'lesson';

export const ASPECT_LABEL: Record<Aspect, string> = {
  explain: '기술 설명',
  setup: '셋업·연계',
  mma: 'MMA 실전 활용',
  video: '강의 영상',
  web: '외부 자료 조사',
  fit: '내 스타일과의 적합성',
  compare: '비교',
  fighter: '선수 분석',
  lesson: '수업',
};

export interface TopicThread {
  key: string;
  label: string;
  art: string | null;
  techniqueIds: string[];
  /** User turns about this topic. */
  turns: number;
  firstIndex: number;
  lastIndex: number;
  aspects: Aspect[];
  /** The user's own questions on this topic, in order (short). */
  questions: string[];
  sourceUrls: string[];
  videoUrls: string[];
  /** A lesson was offered for this topic and the user said no. */
  declined: boolean;
  offered: boolean;
  /** A lesson was started from it. */
  started: boolean;
}

export interface PendingSuggestion {
  messageIndex: number;
  proposal: LessonProposal;
}

export interface ConversationMemory {
  topics: TopicThread[];
  /** Topic of the most recent turn that had one. */
  latest: TopicThread | null;
  /** The last assistant message offered a lesson the user has not answered yet. */
  pendingSuggestion: PendingSuggestion | null;
  /** Work the user asked for that did not happen (search failed / disabled) — said again when relevant. */
  unfinished: string[];
  userTurns: number;
}

const ASPECT_RE: [Aspect, RegExp][] = [
  ['setup', /(셋업|세트업|setup|진입|엔트리|연계|콤보|콤비네이션|이어지는|연결)/i],
  ['mma', /(mma|ufc|종합\s*격투기|실전|실제 경기|선수들)/i],
  ['video', /(영상|동영상|유튜브|강의|youtube)/i],
  ['web', /(조사|찾아|검색|자료|사례)/],
  ['fit', /(내|나의|제)\s*(파이팅\s*)?스타일|나(한테|에게) 맞|나랑 맞/],
  ['compare', /(차이|비교|vs)/i],
  ['lesson', /(수업|레슨|배우고 ?싶)/],
];

export const DECLINE = /^(아니(요|오)?|아뇨|괜찮(아|아요|습니다)|됐어|됐습니다|나중에|다음에|싫어|안 할래|안할래|그냥 (대화|얘기)|수업은 (됐|괜찮|나중))/;
export const ACCEPT = /^(응|어|네|넵|예|좋아|좋아요|좋습니다|그래|그래요|오케이|ok|okay|콜|시작(해|하자|할게)|해\s*줘|하자|부탁해|그걸로|그렇게 해)/i;

function aspectsOf(text: string): Aspect[] {
  const out = ASPECT_RE.filter(([, re]) => re.test(text)).map(([a]) => a);
  return out.length ? out : ['explain'];
}

function keyOf(m: CoachChatMessage): { key: string; label: string; ids: string[]; art: string | null } | null {
  const ids = [...new Set((m.techniqueIds ?? []).map((id) => canonicalTechniqueId(id)))];
  const turnKey = m.turn?.topicKey;
  if (turnKey) return { key: turnKey, label: m.turn?.topicLabel ?? turnKey, ids: m.turn?.topicTechniqueIds ?? ids, art: m.turn?.art ?? null };
  if (!ids.length) return null;
  const t = resolveTechnique(ids[0]);
  return { key: `tech:${ids[0]}`, label: t ? (t.koreanName && t.koreanName !== t.name ? `${t.koreanName}(${t.name})` : t.name) : ids[0], ids: ids.slice(0, 4), art: t?.martialArt ?? null };
}

/** Topics, pending lesson offer and unfinished work of one conversation (derived from its messages, read only). */
export function buildConversationMemory(history: CoachChatMessage[]): ConversationMemory {
  const topics = new Map<string, TopicThread>();
  let latest: TopicThread | null = null;
  const unfinished: string[] = [];
  let userTurns = 0;
  for (let i = 0; i < history.length; i++) {
    const m = history[i];
    if (m.role !== 'assistant') {
      userTurns++;
      continue;
    }
    const q = history[i - 1]?.role === 'user' ? history[i - 1].text : '';
    const k = keyOf(m);
    if (m.research && (m.research.status === 'failed' || m.research.status === 'disabled' || m.research.status === 'unsupported') && q) {
      unfinished.push(`"${q.slice(0, 40)}" — ${m.research.kind === 'video' ? '영상' : '자료'} 검색을 하지 못함 (${m.research.status === 'disabled' ? '자체 검색 꺼짐' : m.research.message ?? '검색 실패'})`);
    }
    if (!k) continue;
    let th = topics.get(k.key);
    if (!th) {
      th = { key: k.key, label: k.label, art: k.art, techniqueIds: [], turns: 0, firstIndex: i, lastIndex: i, aspects: [], questions: [], sourceUrls: [], videoUrls: [], declined: false, offered: false, started: false };
      topics.set(k.key, th);
    }
    th.turns++;
    th.lastIndex = i;
    th.techniqueIds = [...new Set([...th.techniqueIds, ...k.ids])].slice(0, 6);
    th.art = th.art ?? k.art;
    const asp = [...aspectsOf(q), ...(m.turn?.aspects ?? [])] as Aspect[];
    th.aspects = [...new Set([...th.aspects, ...asp])];
    if (q) th.questions.push(q.replace(/\s+/g, ' ').slice(0, 80));
    th.sourceUrls = [...new Set([...th.sourceUrls, ...(m.sources ?? []).map((s) => s.url)])].slice(0, 10);
    th.videoUrls = [...new Set([...th.videoUrls, ...(m.videos ?? []).map((s) => s.url), ...(m.sources ?? []).filter((s) => s.video).map((s) => s.url)])].slice(0, 8);
    if (m.turn?.suggestion === 'offered') th.offered = true;
    // the user's answer to an offer is the next user message
    const next = history[i + 1];
    if (m.turn?.suggestion === 'offered' && next?.role === 'user' && DECLINE.test(next.text.trim())) th.declined = true;
    if (m.turn?.suggestion === 'declined') th.declined = true;
    latest = th;
  }
  const last = history[history.length - 1];
  const pendingSuggestion = last?.role === 'assistant' && last.lessonProposal && last.turn?.suggestion === 'offered' ? { messageIndex: history.length - 1, proposal: last.lessonProposal } : null;
  return { topics: [...topics.values()], latest, pendingSuggestion, unfinished: unfinished.slice(-3), userTurns };
}

const weight = (t: TopicThread) => t.turns * 2 + t.aspects.filter((a) => a !== 'explain').length + t.sourceUrls.length / 4;

/**
 * The topic a back-reference means. "지금까지 / 이걸" = the conversation's main thread; "아까" = an EARLIER
 * thread when the latest one is a single side question (the user moved on and came back).
 */
export function referredTopic(mem: ConversationMemory, text: string): { topic: TopicThread | null; alternatives: TopicThread[] } {
  if (!mem.topics.length) return { topic: null, alternatives: [] };
  const sorted = [...mem.topics].sort((a, b) => weight(b) - weight(a));
  const earlier = /(아까|이전에|전에|앞에서)/.test(text);
  let topic = mem.latest;
  if (earlier && mem.latest && mem.latest.turns <= 1) topic = sorted.find((t) => t.key !== mem.latest!.key) ?? mem.latest;
  else if (/(지금까지|여태|전부|다 같이|모두)/.test(text)) topic = sorted[0];
  else if (topic && topic.turns <= 1 && sorted[0] && weight(sorted[0]) >= weight(topic) + 3) topic = sorted[0];
  const alternatives = sorted.filter((t) => t.key !== topic?.key && t.turns >= 2).slice(0, 2);
  return { topic: topic ?? null, alternatives };
}

/** The conversation as the model should know it — compact, labelled, never the raw transcript. */
export function memoryBlock(mem: ConversationMemory, opts: { max?: number } = {}): string {
  if (!mem.topics.length && !mem.unfinished.length) return '';
  const lines = ['[이 대화에서 이미 다룬 내용 — 같은 설명을 반복하지 말고 이어서 답한다]'];
  for (const t of [...mem.topics].sort((a, b) => b.lastIndex - a.lastIndex).slice(0, opts.max ?? 4)) {
    lines.push(`- ${t.label}: ${t.turns}번 다룸 (${t.aspects.map((a) => ASPECT_LABEL[a]).join(', ')})${t.declined ? ' · 수업 제안을 사양함' : ''}${t.questions.length ? ` · 최근 질문 "${t.questions[t.questions.length - 1]}"` : ''}`);
  }
  if (mem.unfinished.length) lines.push(...mem.unfinished.map((u) => `- 아직 못 한 작업: ${u}`));
  return lines.join('\n');
}

/** Topics of the user's OTHER recent conversations (long-term: "이전에 자주 다룬 주제"). */
export function pastTopicsLine(conversations: { id: string; messages: CoachChatMessage[] }[], excludeId: string | null, max = 5): string {
  const count = new Map<string, { label: string; n: number }>();
  for (const c of conversations.slice(0, 15)) {
    if (c.id === excludeId) continue;
    for (const t of buildConversationMemory(c.messages).topics) {
      const e = count.get(t.key) ?? { label: t.label, n: 0 };
      e.n += t.turns;
      count.set(t.key, e);
    }
  }
  const top = [...count.values()].sort((a, b) => b.n - a.n).slice(0, max);
  return top.length ? `[이전 대화에서 다룬 주제] ${top.map((t) => `${t.label}(${t.n})`).join(', ')}` : '';
}
