import { goalSlots, isPast, listGoals, pastGoals, periodLabel, type GoalEntry } from './store';

// 개인 목표 → AI 코치. The user's own words, passed through unchanged, with the rules for using them: the coach
// reads goals, it never writes them, and a goal that was not written stays missing (no invented goals).
//
// Priority when the budget runs out (spec §9): 이번 주 → 이번 달 → 올해 → 내년 → 앞으로 → 지난 목표. 내년·장기
// 목표가 잘려 나가면 "장기 목표는 여기 실리지 않았다"고 알려, 모델이 없는 것으로 오해하지 않게 한다.

export interface GoalsContextRequest {
  /** Upper bound on the block's characters (default 1200). */
  max?: number;
  /** Include finished periods as reference (default true, capped at 2). */
  includePast?: boolean;
  now?: Date;
  /** For tests: goals instead of the stored ones. */
  goals?: GoalEntry[];
}

export interface GoalsContext {
  /** '' when the user has written no goals — callers then add nothing. */
  text: string;
  /** Slots that were sent, for tests / transparency. */
  slots: string[];
  /** Goals the budget left out. */
  omitted: string[];
  /** One line for the UI ("이번 주 · 이번 달 목표 반영"). */
  summary: string;
}

const HEADER = '[개인 목표 — 사용자가 직접 작성한 글]';
const RULES = [
  '사용 원칙: 사용자가 쓴 목표를 그대로 읽고, 조언·수업·훈련 계획을 이 방향에 맞춘다. 목표를 참고했다면 한 문장으로 짧게 밝힌다.',
  '주의: 목표는 사용자의 계획이지 달성한 실력이 아니다. 목표를 고치거나 새로 만들거나 지우지 않는다. 여기 없는 목표는 지어내지 말고, 물어보면 "저장된 목표가 없다"고 답한다. 지난 목표와 현재 목표를 섞지 않는다.',
].join('\n');

function label(e: GoalEntry, now: Date, nextYear: string): string {
  if (e.scope === 'long_term') return '앞으로의 목표';
  if (e.scope === 'year' && e.periodKey === nextYear) return `내년 목표 (${e.periodKey}년)`;
  const base = e.scope === 'week' ? '이번 주 목표' : e.scope === 'month' ? '이번 달 목표' : '올해 목표';
  return `${base} (${periodLabel(e)})`;
}

export function goalsContext(req: GoalsContextRequest = {}): GoalsContext {
  const now = req.now ?? new Date();
  const max = req.max ?? 1200;
  const nextYear = String(now.getFullYear() + 1);
  const all = req.goals ?? listGoals();
  const slots = req.goals
    ? goalSlots(now).map((s) => ({ ...s, entry: all.find((e) => e.scope === s.scope && e.periodKey === s.periodKey) ?? null }))
    : goalSlots(now);
  const active = slots.filter((s) => s.entry).map((s) => s.entry!);
  const past = (req.includePast ?? true) ? (req.goals ? all.filter((e) => isPast(e, now)) : pastGoals(now)).slice(0, 2) : [];

  if (!active.length && !past.length) return { text: '', slots: [], omitted: [], summary: '' };

  const lines: string[] = [];
  const sent: string[] = [];
  const omitted: string[] = [];
  let used = HEADER.length + RULES.length;
  for (const e of active) {
    const l = `- ${label(e, now, nextYear)}: ${e.text}`;
    if (used + l.length > max) {
      omitted.push(label(e, now, nextYear));
      continue;
    }
    used += l.length;
    lines.push(l);
    sent.push(label(e, now, nextYear));
  }
  const pastLines: string[] = [];
  for (const e of past) {
    const l = `- ${periodLabel(e)} (기간 종료): ${e.text.slice(0, 200)}`;
    if (used + l.length > max) {
      omitted.push(periodLabel(e));
      continue;
    }
    used += l.length;
    pastLines.push(l);
  }

  const text = [
    HEADER,
    RULES,
    ...lines,
    ...(pastLines.length ? ['[지난 목표 — 기간이 끝남, 참고용]', ...pastLines] : []),
    ...(omitted.length ? [`(분량 제한으로 이번 요청에 싣지 않은 목표: ${omitted.join(', ')} — 없는 것이 아니라 생략된 것이므로 "목표가 없다"고 답하지 않는다)`] : []),
  ].join('\n');

  return { text, slots: sent, omitted, summary: sent.slice(0, 3).join(' · ') };
}

/** The block to append to a coach request's context ('' when the user wrote no goals). */
export function goalsContextBlock(req: GoalsContextRequest = {}): string {
  try {
    const c = goalsContext(req);
    return c.text ? `\n\n${c.text}` : '';
  } catch {
    // a broken goals store must never break a lesson or a chat answer
    return '';
  }
}
