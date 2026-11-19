import { supabase } from '../supabase/client';
import { toKoreanAuthMessage } from '../auth/authErrors';
import type { AuthResult } from '../auth/authService';
import { getGoalsData, normalizeGoals, replaceGoals, type GoalEntry, type GoalsData } from '../goals/store';
import { isStillCurrentUser } from './syncGuard';

// 개인 목표 ↔ the user's own training_goals row (0044). Entry-level merge (newer updatedAt wins per entry,
// tombstones included), so editing this week's goal on the phone and next year's on the desktop keeps both and a
// deletion still travels. Nothing is ever removed from either side here. If 0044 isn't deployed yet this just
// returns an error and the local goals are untouched.

/** Newer side wins per entry; a tombstone is an entry like any other, so a delete syncs. */
export function mergeGoals(a: GoalsData, b: GoalsData): GoalsData {
  const by = new Map<string, GoalEntry>();
  const key = (e: GoalEntry) => `${e.scope}|${e.periodKey}`;
  for (const e of [...a.entries, ...b.entries]) {
    const k = key(e);
    const mine = by.get(k);
    if (!mine || new Date(e.updatedAt).getTime() > new Date(mine.updatedAt).getTime()) by.set(k, e);
  }
  const entries = [...by.values()].sort((x, y) => x.updatedAt.localeCompare(y.updatedAt));
  const updatedAt = [a.updatedAt, b.updatedAt].sort().slice(-1)[0] ?? a.updatedAt;
  return { version: 1, entries, updatedAt };
}

export async function syncGoalsBidirectional(userId: string): Promise<AuthResult<{ pulled: boolean; pushed: boolean }>> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  if (!userId) return { ok: false, message: '로그인이 필요합니다.' };
  try {
    const { data: row, error } = await supabase.from('training_goals').select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (error) return { ok: false, message: toKoreanAuthMessage(error) };
    if (!(await isStillCurrentUser(userId))) return { ok: true, data: { pulled: false, pushed: false } };

    const local = getGoalsData();
    const merged = row ? mergeGoals(local, normalizeGoals(row.data)) : local;
    const mergedJson = JSON.stringify(merged.entries);
    const pulled = !!row && mergedJson !== JSON.stringify(local.entries);
    if (pulled) replaceGoals(merged);

    const cloudJson = row ? JSON.stringify(normalizeGoals(row.data).entries) : null;
    let pushed = false;
    if (merged.entries.length && mergedJson !== cloudJson) {
      const { error: upErr } = await supabase.from('training_goals').upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
      if (upErr) return { ok: false, message: toKoreanAuthMessage(upErr) };
      pushed = true;
    }
    return { ok: true, data: { pulled, pushed } };
  } catch (e) {
    return { ok: false, message: toKoreanAuthMessage(e) };
  }
}
