import { useEffect, useState } from 'react';
import type { SharedCombo } from '../sharedCombo/types';
import { resolveTechnique } from '../userTechniques/service';
import { stepsForIds, reviewConnections, type MittCombo } from './combos';

// 사용자 콤보·셋업 in Visualizing Mitt — combos/setups MARTIALDEX users shared
// (shared_combos, publicly readable) played on the mitt. A shared combo is
// playable as written only when EVERY step is a real technique the mitt can
// draw; otherwise it still shows in the 사용자 콤보 tab, where the AI reads its
// description to split it into mitt steps.

export const sharedMittId = (id: string) => `shared:${id}`;

/** The shared combo's own steps on the mitt (null when a step is missing or not drawable). */
export function sharedToMitt(c: SharedCombo): MittCombo | null {
  const ids = c.steps.map((s) => s.techniqueId).filter((id): id is string => !!id && !!resolveTechnique(id));
  if (!ids.length || ids.length !== c.steps.length) return null;
  const steps = stepsForIds(ids);
  if (steps.length !== ids.length) return null;
  const notes = [...c.steps];
  const withNotes = steps.map((st, i) => ({ ...st, ...(notes[i]?.note ? { note: notes[i].note as string } : {}), ...(notes[i]?.opponentReaction ? { opponentReaction: notes[i].opponentReaction as string } : {}) }));
  return {
    id: sharedMittId(c.id),
    name: c.name,
    source: 'saved',
    sourceLabel: `사용자 공유 ${c.kind === 'setup' ? '셋업' : '콤보'} · by ${c.authorNickname || '익명'} · ♥${c.likeCount}`,
    steps: withNotes,
    skipped: [],
    warnings: reviewConnections(withNotes),
  };
}

let cache: { at: number; list: SharedCombo[] } | null = null;
const TTL_MS = 5 * 60 * 1000;

/** Shared combos (cached for a few minutes); an error message when they can't be loaded. */
export async function loadSharedCombos(viewerId: string | null, force = false): Promise<{ list: SharedCombo[]; error: string | null }> {
  if (!force && cache && Date.now() - cache.at < TTL_MS) return { list: cache.list, error: null };
  const { listSharedCombos } = await import('../sharedCombo/service');
  const r = await listSharedCombos(viewerId);
  if (!r.ok) return { list: cache?.list ?? [], error: r.message };
  cache = { at: Date.now(), list: r.data };
  return { list: r.data, error: null };
}

/** Shared combos for the drills / the 사용자 콤보 tab. */
export function useSharedCombos(viewerId: string | null, enabled = true): { list: SharedCombo[]; loading: boolean; error: string | null; reload: () => void } {
  const [state, setState] = useState<{ list: SharedCombo[]; loading: boolean; error: string | null }>({ list: cache?.list ?? [], loading: enabled && !cache, error: null });
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    setState((s) => ({ ...s, loading: true }));
    void loadSharedCombos(viewerId, nonce > 0).then((r) => alive && setState({ list: r.list, loading: false, error: r.error }));
    return () => {
      alive = false;
    };
  }, [viewerId, enabled, nonce]);
  return { ...state, reload: () => setNonce((n) => n + 1) };
}

/** The shared combos the mitt can play as written. */
export function playableShared(list: SharedCombo[]): MittCombo[] {
  return list.map(sharedToMitt).filter((c): c is MittCombo => !!c);
}
