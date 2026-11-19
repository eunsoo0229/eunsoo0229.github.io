// 개인 훈련 프로그램 저장소 (local-first, martialdex:* 키 → 기존 클라우드 백업(dataBackup)에 자동 포함).
// 엔진 입력은 기존 데이터에서 모으고, 하루 훈련을 마치면 기존 훈련 기록(trainingHistory)에 한 건을 남긴다
// — 훈련 기록의 단일 원본은 trainingHistory 이며, 이 저장소는 계획과 완료 체크만 가진다.
import { computeAllSkillProgress, rankWeakness } from '../skillProgress/weaknessEngine';
import { listFavorites } from '../userData';
import { listMyCombos } from '../combo/service';
import { getTechnique } from '../loadData';
import { deleteTrainingHistoryEntry, getTrainingHistoryEntry, listTrainingHistory, recordTrainingSession } from '../trainingHistory/service';
import {
  DEFAULT_SETTINGS,
  addDays,
  completionOf,
  generateWeek,
  mondayOf,
  regenerateKeeping,
  type Candidate,
  type ProgramItem,
  type ProgramSettings,
  type WeeklyProgram,
} from './engine';

const KEY = 'martialdex:training-program';
export const PROGRAM_EVENT = 'martialdex:training-program-updated';

interface ProgramData {
  settings: ProgramSettings;
  weeks: WeeklyProgram[];
}

function read(): ProgramData {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<ProgramData>;
      return { settings: { ...DEFAULT_SETTINGS, ...(d.settings ?? {}) }, weeks: Array.isArray(d.weeks) ? d.weeks : [] };
    }
  } catch {
    /* corrupted → start fresh */
  }
  return { settings: { ...DEFAULT_SETTINGS }, weeks: [] };
}

function write(d: ProgramData) {
  d.weeks = [...d.weeks].sort((a, b) => b.weekStart.localeCompare(a.weekStart)).slice(0, 12);
  localStorage.setItem(KEY, JSON.stringify(d));
  window.dispatchEvent(new Event(PROGRAM_EVENT));
}

export function getProgramSettings(): ProgramSettings {
  return read().settings;
}

export function getWeek(weekStart: string): WeeklyProgram | null {
  return read().weeks.find((w) => w.weekStart === weekStart) ?? null;
}

export function listWeeks(): WeeklyProgram[] {
  return read().weeks;
}

const DIFF: Record<string, number> = { beginner: 1, intermediate: 2, advanced: 3 };

export function collectCandidates(): Candidate[] {
  const entries = computeAllSkillProgress();
  const weak = rankWeakness(entries, { limit: 10 });
  const weakRank = new Map(weak.map((w, i) => [w.techniqueId, i]));
  const fav = new Set(listFavorites());
  for (const e of entries) if (e.progress.status === 'needs_improvement' && !weakRank.has(e.technique.id)) weakRank.set(e.technique.id, weak.length + weakRank.size);
  return entries.map((e) => ({
    techniqueId: e.technique.id,
    name: e.technique.koreanName && e.technique.koreanName !== e.technique.name ? `${e.technique.name} (${e.technique.koreanName})` : e.technique.name,
    martialArt: e.technique.martialArt,
    status: e.progress.status,
    nextReviewAt: e.progress.nextReviewAt,
    difficulty: DIFF[e.technique.difficulty ?? ''] ?? 2,
    favorite: fav.has(e.technique.id),
    weakRank: weakRank.get(e.technique.id) ?? null,
  }));
}

export function recentMinutesBefore(weekStart: string): number[] {
  const hist = listTrainingHistory();
  return Array.from({ length: 7 }, (_, i) => {
    const d = addDays(weekStart, i - 7);
    return hist.filter((e) => e.date === d && e.completed).reduce((s, e) => s + (e.actualMinutes ?? e.estimatedMinutes ?? 0), 0);
  });
}

export function buildWeek(weekStart: string, assignments: { id: string; techniqueId: string | null; title: string }[] = [], now = new Date()): WeeklyProgram {
  const d = read();
  const previous = d.weeks.find((w) => w.weekStart === addDays(weekStart, -7)) ?? null;
  const current = d.weeks.find((w) => w.weekStart === weekStart) ?? null;
  const combos = listMyCombos().map((c) => ({ id: c.id, name: c.name, martialArt: getTechnique(c.techniqueIds[0] ?? '')?.martialArt ?? null }));
  const fresh = generateWeek({ weekStart, settings: d.settings, candidates: collectCandidates(), combos, assignments, recentMinutes: recentMinutesBefore(weekStart), previous }, now);
  const week = current ? regenerateKeeping(current, fresh) : fresh;
  d.weeks = [week, ...d.weeks.filter((w) => w.weekStart !== weekStart)];
  write(d);
  return week;
}

export function ensureThisWeek(assignments: { id: string; techniqueId: string | null; title: string }[] = []): WeeklyProgram {
  const ws = mondayOf(new Date());
  return getWeek(ws) ?? buildWeek(ws, assignments);
}

function mutateWeek(weekStart: string, fn: (w: WeeklyProgram) => void): WeeklyProgram | null {
  const d = read();
  const w = d.weeks.find((x) => x.weekStart === weekStart);
  if (!w) return null;
  fn(w);
  write(d);
  return w;
}

export function saveSettings(patch: Partial<ProgramSettings>): ProgramSettings {
  const d = read();
  const s = { ...d.settings, ...patch };
  s.daysPerWeek = Math.max(1, Math.min(6, Math.round(s.daysPerWeek)));
  s.sessionMinutes = Math.max(20, Math.min(180, Math.round(s.sessionMinutes)));
  s.newPerWeek = Math.max(0, Math.min(5, Math.round(s.newPerWeek)));
  s.fixedRestWeekdays = [...new Set(s.fixedRestWeekdays.filter((x) => x >= 0 && x <= 6))].sort();
  d.settings = s;
  write(d);
  return s;
}

export function toggleItemDone(weekStart: string, itemId: string): WeeklyProgram | null {
  return mutateWeek(weekStart, (w) => {
    for (const day of w.days) for (const it of day.items) if (it.id === itemId) {
      it.done = !it.done;
      it.doneAt = it.done ? new Date().toISOString() : null;
    }
  });
}

export function removeItem(weekStart: string, itemId: string): WeeklyProgram | null {
  return mutateWeek(weekStart, (w) => {
    for (const day of w.days) day.items = day.items.filter((i) => i.id !== itemId);
  });
}

export function moveItem(weekStart: string, itemId: string, toDate: string): WeeklyProgram | null {
  return mutateWeek(weekStart, (w) => {
    let item: ProgramItem | undefined;
    for (const day of w.days) {
      const i = day.items.findIndex((x) => x.id === itemId);
      if (i >= 0) item = day.items.splice(i, 1)[0];
    }
    const target = w.days.find((d) => d.date === toDate);
    if (item && target) {
      target.rest = false;
      target.userSet = true;
      target.items.push({ ...item, pinned: true });
    }
  });
}

export function addTechniqueItem(weekStart: string, date: string, techniqueId: string, title: string): WeeklyProgram | null {
  return mutateWeek(weekStart, (w) => {
    const day = w.days.find((d) => d.date === date);
    if (!day || day.items.some((i) => i.techniqueId === techniqueId)) return;
    day.rest = false;
    day.userSet = true;
    day.items.push({ id: `cu-${techniqueId}-${Date.now()}`, kind: 'custom', techniqueId, comboId: null, title, minutes: 10, reason: '직접 추가', done: false, doneAt: null, pinned: true });
  });
}

export function setRestDay(weekStart: string, date: string, rest: boolean): WeeklyProgram | null {
  return mutateWeek(weekStart, (w) => {
    const day = w.days.find((d) => d.date === date);
    if (!day) return;
    day.rest = rest;
    day.userSet = true;
    if (rest) day.items = day.items.filter((i) => i.done);
  });
}

/** 하루 훈련 완료 → 기존 훈련 기록에 1건. 다시 누르면 이전 기록을 지우고(클라우드 삭제도 예약) 새로 남겨 중복이 생기지 않는다. */
export function logDay(weekStart: string, date: string): string | null {
  const w = getWeek(weekStart);
  const day = w?.days.find((d) => d.date === date);
  if (!w || !day) return null;
  const done = day.items.filter((i) => i.done);
  if (!done.length) return null;
  const techniqueIds = [...new Set(done.flatMap((i) => (i.techniqueId ? [i.techniqueId] : [])))];
  if (day.loggedEntryId && getTrainingHistoryEntry(day.loggedEntryId)) deleteTrainingHistoryEntry(day.loggedEntryId);
  const entry = recordTrainingSession({
    id: `program-${date}-${Date.now().toString(36)}`,
    date,
    curriculumId: null,
    dayNumber: null,
    techniqueIds,
    completed: true,
    estimatedMinutes: done.reduce((s, i) => s + i.minutes, 0),
    notes: `개인 훈련 프로그램: ${done.map((i) => i.title).join(', ')}`,
    source: 'program',
  });
  mutateWeek(weekStart, (x) => {
    const dd = x.days.find((d) => d.date === date);
    if (dd) dd.loggedEntryId = entry.id;
  });
  return entry.id;
}

/** AI 코치 컨텍스트용 한 줄 요약 (기존 코치 시스템에 연결; 새 코치를 만들지 않는다). */
export function programContextLine(now = new Date()): string {
  const w = getWeek(mondayOf(now));
  if (!w) return '';
  const c = completionOf(w);
  const today = now.toISOString().slice(0, 10);
  const td = w.days.find((d) => d.date === today);
  const todayText = !td ? '' : td.rest ? '오늘은 휴식일' : `오늘 할 일: ${td.items.map((i) => `${i.title}${i.done ? '(완료)' : ''}`).join(', ') || '없음'}`;
  return `[개인 훈련 프로그램 — 사용자가 쓰는 이번 주 계획 (규칙 기반 생성, 실제 수행 기록은 훈련 기록이 원본)] ${w.weekStart} 주 · 완료 ${c.done}/${c.total}${c.rate !== null ? ` (${c.rate}%)` : ''}${todayText ? ` · ${todayText}` : ''}`;
}
