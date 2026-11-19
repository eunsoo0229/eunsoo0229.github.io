// 개인 훈련 프로그램 — 결정론적 엔진 (AI 모델 없이 동작).
// 같은 입력이면 항상 같은 주간 계획을 만든다. 입력은 기존 앱 데이터(숙련도·복습 주기·약점 순위·
// 즐겨찾기·콤보·최근 훈련량·체육관 과제)에서 온다. 숙련도를 바꾸거나 새 기록을 만들어 내지 않는다.

export type ProgramItemKind = 'assignment' | 'weak' | 'review' | 'new' | 'combo' | 'custom';

export interface ProgramItem {
  id: string;
  kind: ProgramItemKind;
  techniqueId: string | null;
  comboId: string | null;
  title: string;
  minutes: number;
  reason: string;
  done: boolean;
  doneAt: string | null;
  /** user moved / added this item — regeneration keeps it */
  pinned?: boolean;
}

export interface ProgramDay {
  date: string; // YYYY-MM-DD
  rest: boolean;
  /** user toggled rest/training for this date */
  userSet?: boolean;
  items: ProgramItem[];
  loggedEntryId: string | null;
}

export interface WeeklyProgram {
  weekStart: string; // Monday YYYY-MM-DD
  generatedAt: string;
  days: ProgramDay[];
  notes: string[];
}

export interface ProgramSettings {
  daysPerWeek: number; // 1..6
  sessionMinutes: number; // 20..180
  focusArt: string | null;
  newPerWeek: number; // 0..5
  /** 0=Mon … 6=Sun, always rest */
  fixedRestWeekdays: number[];
}

export const DEFAULT_SETTINGS: ProgramSettings = { daysPerWeek: 3, sessionMinutes: 60, focusArt: null, newPerWeek: 2, fixedRestWeekdays: [6] };

export interface Candidate {
  techniqueId: string;
  name: string;
  martialArt: string;
  status: 'not_started' | 'learning' | 'average' | 'proficient' | 'needs_improvement';
  nextReviewAt: string | null;
  difficulty: number; // 1 beginner .. 3 advanced (unknown = 2)
  favorite: boolean;
  /** rank from the existing weakness engine (0 = weakest); null = not ranked */
  weakRank: number | null;
}

export interface EngineInput {
  weekStart: string;
  settings: ProgramSettings;
  candidates: Candidate[];
  combos: { id: string; name: string; martialArt: string | null }[];
  assignments: { id: string; techniqueId: string | null; title: string }[];
  /** minutes trained per day over the 7 days before weekStart (oldest first) */
  recentMinutes: number[];
  previous: WeeklyProgram | null;
}

const ITEM_MIN = 10;

export function mondayOf(d: Date): string {
  const x = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const wd = (x.getUTCDay() + 6) % 7;
  x.setUTCDate(x.getUTCDate() - wd);
  return x.toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const x = new Date(`${iso}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Spread training days so they are not back-to-back when possible. Mon=0. */
const PATTERNS: Record<number, number[]> = { 1: [2], 2: [1, 4], 3: [0, 2, 4], 4: [0, 1, 3, 4], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };

export function pickTrainingWeekdays(n: number, fixedRest: number[]): number[] {
  const want = Math.max(1, Math.min(6, n));
  const base = PATTERNS[want].filter((d) => !fixedRest.includes(d));
  const pool = [0, 1, 2, 3, 4, 5, 6].filter((d) => !fixedRest.includes(d) && !base.includes(d));
  // refill from the free weekdays furthest from an already-chosen day
  while (base.length < want && pool.length) {
    pool.sort((a, b) => Math.min(...base.map((x) => Math.abs(x - b)), 7) - Math.min(...base.map((x) => Math.abs(x - a)), 7) || a - b);
    base.push(pool.shift()!);
  }
  return base.sort((a, b) => a - b);
}

export interface Adjustment {
  completionRate: number | null;
  itemsPerDayDelta: number;
  extraNew: number;
  recoveryCut: boolean;
  notes: string[];
}

/** How last week went → what changes this week. */
export function adjustmentFrom(previous: WeeklyProgram | null, recentMinutes: number[], settings: ProgramSettings): Adjustment {
  const notes: string[] = [];
  let completionRate: number | null = null;
  let itemsPerDayDelta = 0;
  let extraNew = 0;
  if (previous) {
    const items = previous.days.filter((d) => !d.rest).flatMap((d) => d.items);
    if (items.length) {
      completionRate = Math.round((items.filter((i) => i.done).length / items.length) * 100);
      if (completionRate < 50) {
        itemsPerDayDelta = -1;
        notes.push(`지난주 완료율 ${completionRate}% — 하루 항목을 1개 줄였습니다.`);
      } else if (completionRate >= 90) {
        extraNew = 1;
        notes.push(`지난주 완료율 ${completionRate}% — 새 기술 1개를 더 넣었습니다.`);
      } else {
        notes.push(`지난주 완료율 ${completionRate}% — 분량을 유지합니다.`);
      }
    }
  }
  const total = recentMinutes.reduce((a, b) => a + b, 0);
  const lastThree = recentMinutes.slice(-3);
  const planned = settings.daysPerWeek * settings.sessionMinutes;
  const recoveryCut = (planned > 0 && total >= planned * 1.5) || (lastThree.length === 3 && lastThree.every((m) => m > 0));
  if (recoveryCut) notes.push(total >= planned * 1.5 ? `최근 7일 훈련 ${total}분 — 계획보다 많아 이번 주 훈련일을 하루 줄여 회복 시간을 넣었습니다.` : '최근 3일 연속 훈련 — 이번 주는 하루 더 쉬도록 조정했습니다.');
  return { completionRate, itemsPerDayDelta, extraNew, recoveryCut, notes };
}

const byId = (a: Candidate, b: Candidate) => a.techniqueId.localeCompare(b.techniqueId);

export function generateWeek(input: EngineInput, now = new Date()): WeeklyProgram {
  const { settings } = input;
  const adj = adjustmentFrom(input.previous, input.recentMinutes, settings);
  const days = Math.max(1, settings.daysPerWeek - (adj.recoveryCut ? 1 : 0));
  const weekdays = pickTrainingWeekdays(days, settings.fixedRestWeekdays);
  const perDay = Math.max(1, Math.floor(settings.sessionMinutes / ITEM_MIN) + adj.itemsPerDayDelta);
  const weekEnd = addDays(input.weekStart, 7);
  const focus = (c: Candidate) => !settings.focusArt || c.martialArt === settings.focusArt;
  const used = new Set<string>();

  const carried: ProgramItem[] = (input.previous?.days ?? [])
    .flatMap((d) => d.items)
    .filter((i) => !i.done && (i.kind === 'weak' || i.kind === 'review' || i.kind === 'assignment' || i.kind === 'custom'));

  const queue: ProgramItem[] = [];
  const push = (it: Omit<ProgramItem, 'done' | 'doneAt' | 'minutes'> & { minutes?: number }) => {
    const key = it.techniqueId ?? it.comboId ?? it.id;
    if (used.has(key)) return;
    used.add(key);
    queue.push({ minutes: ITEM_MIN, done: false, doneAt: null, ...it });
  };

  for (const a of input.assignments) push({ id: `as-${a.id}`, kind: 'assignment', techniqueId: a.techniqueId, comboId: null, title: a.title, reason: '체육관 지도자가 지정한 과제' });
  for (const c of carried) push({ ...c, id: `${c.id}` , reason: `지난주에 못한 항목 — ${c.reason}` });

  const weak = input.candidates.filter((c) => c.weakRank !== null && focus(c)).sort((a, b) => (a.weakRank! - b.weakRank!) || byId(a, b));
  for (const c of weak.slice(0, 4)) push({ id: `wk-${c.techniqueId}`, kind: 'weak', techniqueId: c.techniqueId, comboId: null, title: c.name, reason: c.status === 'needs_improvement' ? '숙련도 "개선 필요"' : '약점 순위 상위 (자세 점수·연습 간격 기준)' });

  const review = input.candidates
    .filter((c) => focus(c) && c.nextReviewAt && c.nextReviewAt.slice(0, 10) < weekEnd && ['learning', 'average', 'needs_improvement', 'proficient'].includes(c.status))
    .sort((a, b) => a.nextReviewAt!.localeCompare(b.nextReviewAt!) || byId(a, b));
  for (const c of review.slice(0, 6)) push({ id: `rv-${c.techniqueId}`, kind: 'review', techniqueId: c.techniqueId, comboId: null, title: c.name, reason: `복습 예정일 ${c.nextReviewAt!.slice(0, 10)}` });

  const fresh = input.candidates
    .filter((c) => c.status === 'not_started' && focus(c))
    .sort((a, b) => Number(b.favorite) - Number(a.favorite) || a.difficulty - b.difficulty || byId(a, b));
  for (const c of fresh.slice(0, Math.max(0, settings.newPerWeek + adj.extraNew))) push({ id: `nw-${c.techniqueId}`, kind: 'new', techniqueId: c.techniqueId, comboId: null, title: c.name, reason: c.favorite ? '즐겨찾기한 아직 안 배운 기술' : '아직 안 배운 기초 난이도 기술' });

  const combos = input.combos.filter((c) => !settings.focusArt || !c.martialArt || c.martialArt === settings.focusArt).sort((a, b) => a.id.localeCompare(b.id));

  const out: ProgramDay[] = [];
  let qi = 0;
  let ci = 0;
  for (let d = 0; d < 7; d++) {
    const date = addDays(input.weekStart, d);
    const prevDay = input.previous?.weekStart === input.weekStart ? input.previous.days.find((x) => x.date === date) : undefined;
    const training = prevDay?.userSet ? !prevDay.rest : weekdays.includes(d);
    const items: ProgramItem[] = [];
    if (training) {
      while (items.length < perDay && qi < queue.length) items.push(queue[qi++]);
      if (items.length < perDay && combos.length) {
        const c = combos[ci++ % combos.length];
        if (!items.some((i) => i.comboId === c.id)) items.push({ id: `cb-${c.id}-${d}`, kind: 'combo', techniqueId: null, comboId: c.id, title: c.name, minutes: ITEM_MIN, reason: '내 콤보·셋업 연결 연습', done: false, doneAt: null });
      }
    }
    out.push({ date, rest: !training, userSet: prevDay?.userSet, items, loggedEntryId: prevDay?.loggedEntryId ?? null });
  }
  const leftover = queue.length - qi;
  const notes = [...adj.notes];
  if (leftover > 0) notes.push(`항목 ${leftover}개는 이번 주 분량을 넘어 다음 주로 넘어갑니다.`);
  if (!queue.length && !combos.length) notes.push('추천할 기록이 아직 없습니다. 기술을 배우거나 즐겨찾기·콤보를 추가하면 계획이 채워집니다.');
  return { weekStart: input.weekStart, generatedAt: now.toISOString(), days: out, notes };
}

/** Regenerate but keep what the user already did or placed by hand on this week's plan. */
export function regenerateKeeping(current: WeeklyProgram, fresh: WeeklyProgram): WeeklyProgram {
  const keep = new Map(current.days.map((d) => [d.date, d.items.filter((i) => i.done || i.pinned)]));
  const kept = new Set([...keep.values()].flat().map((i) => i.techniqueId ?? i.comboId ?? i.id));
  return {
    ...fresh,
    days: fresh.days.map((d) => {
      const mine = keep.get(d.date) ?? [];
      const old = current.days.find((x) => x.date === d.date);
      const rest = old?.userSet ? old.rest : d.rest;
      const add = rest ? [] : d.items.filter((i) => !kept.has(i.techniqueId ?? i.comboId ?? i.id));
      return { ...d, rest, userSet: old?.userSet, loggedEntryId: old?.loggedEntryId ?? null, items: [...mine, ...add] };
    }),
  };
}

export function completionOf(p: WeeklyProgram): { done: number; total: number; rate: number | null } {
  const items = p.days.filter((d) => !d.rest).flatMap((d) => d.items);
  const done = items.filter((i) => i.done).length;
  return { done, total: items.length, rate: items.length ? Math.round((done / items.length) * 100) : null };
}
