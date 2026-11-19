import { supabase } from '../supabase/client';
import { toKoreanAuthMessage } from '../auth/authErrors';
import type { AuthResult } from '../auth/authService';
import { getProfile, mergeProfiles, normalizeProfile, replaceProfile } from '../fighterProfile/store';
import { isStillCurrentUser } from './syncGuard';

// 개인 파이터 프로필 ↔ the user's own fighter_profiles row (0041). Item-level
// merge (store.ts mergeProfiles), so it is safe to run silently on every
// login and after every local change. If 0041 isn't deployed yet this just
// returns an error; the local profile is unaffected.
export async function syncFighterProfileBidirectional(userId: string): Promise<AuthResult<{ pulled: boolean; pushed: boolean }>> {
  if (!supabase) return { ok: false, message: 'Supabase 설정이 필요합니다.' };
  if (!userId) return { ok: false, message: '로그인이 필요합니다.' };
  try {
    const { data: row, error } = await supabase.from('fighter_profiles').select('data, updated_at').eq('user_id', userId).maybeSingle();
    if (error) return { ok: false, message: toKoreanAuthMessage(error) };
    if (!(await isStillCurrentUser(userId))) return { ok: true, data: { pulled: false, pushed: false } };

    const local = getProfile();
    const merged = row ? mergeProfiles(local, normalizeProfile(row.data)) : local;
    const mergedJson = JSON.stringify(merged);
    const pulled = !!row && mergedJson !== JSON.stringify(local);
    if (pulled) replaceProfile(merged);

    const cloudJson = row ? JSON.stringify(normalizeProfile(row.data)) : null;
    let pushed = false;
    // Nothing to push for an untouched profile (no items, interview never started).
    const empty = !Object.keys(merged.items).length && merged.interview.status === 'idle' && !merged.style;
    if (!empty && mergedJson !== cloudJson) {
      const { error: upErr } = await supabase.from('fighter_profiles').upsert({ user_id: userId, data: merged, updated_at: new Date().toISOString() });
      if (upErr) return { ok: false, message: toKoreanAuthMessage(upErr) };
      pushed = true;
    }
    return { ok: true, data: { pulled, pushed } };
  } catch (e) {
    return { ok: false, message: toKoreanAuthMessage(e) };
  }
}
