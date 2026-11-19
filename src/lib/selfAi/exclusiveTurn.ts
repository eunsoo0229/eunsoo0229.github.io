import type { CoachIntent } from './intents';
import type { ConversationMemory } from './conversationMemory';
import type { TurnOutput } from './coachAgent';
import type { TurnPlan } from './router';
import type { SelfAiChatRequest, SelfAiChatResult } from './types';

/**
 * The four intents that must NOT reach the research pipeline (§3-1, §13, §14, §16).
 *
 * Measured before this existed: "…쳤는데 암바 걸린 것처럼 팔이 아파" was classified
 * GENERAL_CONVERSATION and answered with an armbar technique write-up, and "이번 주
 * 하트 가장 많은 콤보/게시물" matched the 셋업 keyword and went to a web search.
 * Classifying them is not enough — the spec is explicit that a routed intent has to
 * change what actually runs, so each one answers from a source of its own here and
 * returns before any search is issued.
 */
export interface ExclusiveDeps {
  chat: (req: SelfAiChatRequest, onDelta?: (d: string) => void) => Promise<SelfAiChatResult>;
  /** Training records / profile as data (never invented). */
  learnerContext?: (art: string | null, topic: string) => string;
  /** Internal social aggregation — MARTIALDEX's own tables, never a web search. */
  socialTrending?: (period: SocialPeriod) => Promise<SocialTrendingResult>;
}

export type SocialPeriod = 'week' | 'month' | 'today' | 'recent';

export interface SocialTrendingItem {
  kind: 'post' | 'combo' | 'setup';
  id: string;
  title: string;
  author: string;
  hearts: number;
  createdAt: string;
}

export interface SocialTrendingResult {
  ok: boolean;
  /** Distinguishes "lookup failed" from "nothing in this period" (§16-2). */
  reason?: string;
  items: SocialTrendingItem[];
}

const noSearch = (reason: string) => ({ kind: 'web' as const, queries: [], reason, searched: false, status: 'skipped' as const });

function wrap(plan: TurnPlan, intent: CoachIntent, text: string, tools: string[]): TurnOutput {
  return {
    plan,
    results: [],
    message: { role: 'assistant', text, research: noSearch(`${intent} — 검색이 필요 없는 질문`), tools, model: 'martialdex-route' },
  };
}

/** §13 — a pain report is never answered with a technique write-up. Deterministic on purpose:
 *  a generated answer here risks sounding like a diagnosis, which this must never give. */
function painAnswer(): string {
  return [
    '먼저 그 동작을 멈추고 쉬어 주세요.',
    '',
    '통증의 원인은 말씀만으로는 알 수 없어서 단정하지 않겠습니다. 다음을 알려주시면 상황을 더 정확히 볼 수 있습니다.',
    '- 어느 부위가, 어떤 동작에서 아픈가요?',
    '- 언제부터인가요? 한 번에 생겼나요, 점점 심해졌나요?',
    '- 부기·멍·저림이 있나요? 팔을 끝까지 펴거나 돌릴 수 있나요?',
    '',
    '다음 중 하나라도 해당하면 연습을 중단하고 의료진의 진료를 받아 주세요. 미성년자라면 보호자에게 먼저 알리세요.',
    '- 통증이 심하거나 가라앉지 않고 계속됩니다',
    '- 관절을 움직이는 범위가 줄었거나 힘이 들어가지 않습니다',
    '- 부기, 변형, 저림이나 감각 이상이 있습니다',
    '',
    '괜찮아진 뒤에 같은 동작의 자세와 타격 강도를 함께 점검해 보면 좋겠습니다. 지금은 통증이 먼저입니다.',
  ].join('\n');
}

const EMOTION_RULES = [
  '너는 MARTIALDEX AI 코치다. 사용자가 실력·재능에 대한 좌절을 이야기했다.',
  '규칙:',
  '1. 먼저 그 감정을 있는 그대로 받아들이고 공감한다. 조언보다 공감이 앞선다.',
  '2. 아래 [사용자 기록]에 있는 내용만 사실로 말한다. 기록이 없으면 "기록이 아직 많지 않다"고 말한다.',
  '3. 사용자가 언제 시작했는지, 실력이 어느 정도인지 추측하지 않는다. 기록에 없으면 모른다고 한다.',
  '4. "누구나 그렇다", "재능보다 노력" 같은 빈말과 근거 없는 칭찬을 하지 않는다.',
  '5. 기술 목록이나 훈련 계획을 나열하지 않는다. 사용자가 원하면 다음에 함께 정하자고 제안만 한다.',
  '6. 어떤 경험 때문에 그렇게 느꼈는지 한 가지만 되묻는다.',
  '7. 3~5문장. 한국어 존댓말.',
].join('\n');

function formatTrending(r: SocialTrendingResult, periodLabel: string): string {
  if (!r.ok) {
    return `${periodLabel} 인기 콘텐츠를 불러오지 못했습니다${r.reason ? ` (${r.reason})` : ''}. 잠시 후 다시 시도해 주세요. 외부 검색으로 대신하지는 않았습니다.`;
  }
  if (r.items.length === 0) {
    return `${periodLabel}에는 하트를 받은 게시물·콤보·셋업이 없습니다. 조회는 정상적으로 됐고, 해당 기간에 기록이 없는 것입니다.`;
  }
  const group = (kind: SocialTrendingItem['kind'], label: string) => {
    const rows = r.items.filter((i) => i.kind === kind);
    if (!rows.length) return null;
    return [`${label}`, ...rows.map((i, n) => `${n + 1}. ${i.title} — ${i.author} · 하트 ${i.hearts} · ${i.createdAt.slice(0, 10)}`)].join('\n');
  };
  const blocks = [group('post', '게시물'), group('combo', '콤보'), group('setup', '셋업')].filter(Boolean);
  return [`${periodLabel} MARTIALDEX에서 하트를 가장 많이 받은 항목입니다.`, '', ...blocks].join('\n\n');
}

const PERIOD_LABEL: Record<SocialPeriod, string> = { week: '이번 주', month: '이번 달', today: '오늘', recent: '최근' };

export function periodOf(text: string): SocialPeriod {
  if (/오늘/.test(text)) return 'today';
  if (/이번 ?달|월간/.test(text)) return 'month';
  if (/이번 ?주|주간|지난 ?주/.test(text)) return 'week';
  return 'recent';
}

/** The gist of an earlier answer: its first content lines (app status lines and blank lines dropped). */
function gistOf(text: string, max = 4): string[] {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('🔎') && !/^요청을 \d+가지로/.test(l) && !/^■\s*$/.test(l))
    .slice(0, max)
    .map((l) => `  ${l.length > 140 ? `${l.slice(0, 139)}…` : l}`);
}

/**
 * "아까 말한 더블렉 셋업 기억해?" — the question names a topic: answer about THAT topic from the conversation
 * (what was asked, what was answered), not with the generic topic list. Null when no topic is named.
 */
function namedTopicRecall(text: string, plan: TurnPlan, memory: ConversationMemory, history: { role: string; text: string }[]): string | null {
  const ids = new Set(plan.techniques.map((t) => t.id));
  if (!ids.size) return null;
  const hit = memory.topics.find((t) => t.techniqueIds.some((id) => ids.has(id)));
  const named = plan.techniques[0];
  const name = named.koreanName && named.koreanName !== named.name ? `${named.koreanName}(${named.name})` : named.name;
  if (!hit) return `이 대화에서는 ${name}에 대해 이야기한 기록이 없습니다. 지금 이어서 알아볼까요?`;
  const asked = hit.questions[0] ?? null;
  const qi = asked ? history.findIndex((m) => m.role === 'user' && m.text.trim().startsWith(asked.slice(0, 40))) : -1;
  const reply = qi >= 0 ? history.slice(qi + 1).find((m) => m.role === 'assistant') : undefined;
  const aspect = /셋업/.test(text) ? '셋업' : /콤보/.test(text) ? '콤보' : '';
  return [
    `네, 기억합니다. 이 대화에서 「${hit.label}」${aspect ? ` ${aspect}` : ''}에 대해 ${hit.turns > 1 ? `${hit.turns}번` : ''} 이야기했습니다.`,
    ...(asked ? [`- 물어보신 내용: "${asked}"`] : []),
    ...(reply ? ['- 그때 드린 답변 요지:', ...gistOf(reply.text)] : []),
    '',
    '이 주제를 이어서 볼까요? 예: "이거 말고 다른 셋업", "이걸로 수업 만들어줘"',
  ].join('\n');
}

/** §4-1 — the answer is in the conversation; re-searching the web for it is the bug. */
function recallAnswer(memory: ConversationMemory, history: { role: string; text: string }[]): string {
  if (!memory.topics.length) {
    // Topics come from the assistant message's turn metadata / technique ids
    // (conversationMemory.keyOf). A conversation that predates that metadata, or
    // one made only of general chat, has none — but the user's own questions are
    // still right there, and quoting them answers "무슨 … 물어봤지?" correctly.
    const asked = history.filter((m) => m.role === 'user').map((m) => m.text.trim()).filter(Boolean);
    if (asked.length <= 1) {
      return '이 대화에서는 아직 다룬 주제가 없습니다. 무엇에 대해 이야기했는지 알려주시면 이어서 도와드릴게요.';
    }
    const earlier = asked.slice(0, -1); // 지금 질문("아까 뭐 물어봤지")은 뺀다
    return [
      `이 대화에서 처음 물어보신 것은 "${earlier[0]}" 입니다.`,
      '',
      '지금까지 물어보신 내용입니다.',
      ...earlier.map((q, i) => `${i + 1}. ${q.slice(0, 80)}`),
      '',
      '이 중 어떤 것을 이어서 볼까요?',
    ].join('\n');
  }
  const ordered = [...memory.topics].sort((a, b) => a.firstIndex - b.firstIndex);
  const first = ordered[0];
  const lines = ordered.map((t) => {
    const asked = t.questions?.[0];
    return `- ${t.label}${t.art ? ` (${t.art})` : ''}${asked ? ` — "${asked}"` : ''}`;
  });
  return [
    `이 대화에서 처음 물어보신 것은 「${first.label}」입니다.`,
    '',
    '지금까지 다룬 주제입니다.',
    ...lines,
    '',
    '이 중 어떤 것을 이어서 볼까요?',
  ].join('\n');
}

/**
 * Answers one of the exclusive intents, or returns null when this turn is not one.
 * Returning null is what lets the existing composite / single-intent routes stay
 * exactly as they were.
 */
export async function runExclusiveTurn(
  intent: CoachIntent,
  input: { text: string; martialArt?: string | null; history?: { role: string; text: string }[] },
  deps: ExclusiveDeps,
  plan: TurnPlan,
  memory: ConversationMemory,
): Promise<TurnOutput | null> {
  if (intent === 'INJURY_OR_PAIN_QUESTION') {
    return wrap(plan, intent, painAnswer(), ['safety']);
  }

  if (intent === 'CONVERSATION_RECALL') {
    return wrap(plan, intent, namedTopicRecall(input.text, plan, memory, input.history ?? []) ?? recallAnswer(memory, input.history ?? []), ['conversation_memory']);
  }

  if (intent === 'SOCIAL_TRENDING') {
    const period = periodOf(input.text);
    if (!deps.socialTrending) {
      return wrap(plan, intent, 'MARTIALDEX 인기 콘텐츠 조회를 이 환경에서는 사용할 수 없습니다. 외부 검색으로 대신하지는 않았습니다.', ['social']);
    }
    const r = await deps.socialTrending(period);
    return wrap(plan, intent, formatTrending(r, PERIOD_LABEL[period]), ['social']);
  }

  if (intent === 'EMOTIONAL_SUPPORT') {
    const records = deps.learnerContext?.(input.martialArt ?? null, '') ?? '';
    // The records belong in the system prompt with the rules — they are context,
    // not something the user said. (test-self-coach-agent [A15b] asserts the
    // learner record reaches messages[0].)
    const res = await deps.chat({
      requestId: `emotion-${Date.now()}`,
      messages: [
        { role: 'system', content: `${EMOTION_RULES}\n\n[사용자 기록]\n${records || '(기록 없음)'}` },
        { role: 'user', content: input.text },
      ],
      temperature: 0.4,
    });
    const text = res.ok && res.text.trim()
      ? res.text.trim()
      : '그렇게 느끼실 만큼 마음이 무거우셨겠어요. 어떤 일이 있어서 그렇게 느끼게 되셨는지 조금만 더 이야기해 주실 수 있을까요?';
    return wrap(plan, intent, text, ['empathy']);
  }

  return null;
}
