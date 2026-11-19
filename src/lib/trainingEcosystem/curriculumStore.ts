// Storage of the personal curriculum — local-first like every learner domain (martialdex:* keys go into the account
// backup, cloudSync/dataBackup.ts). One active plan; a plan replaced by a new goal is archived, never deleted, so its
// history stays readable. The learner's level is NOT stored here (it is read live from the records).

import { useEffect, useState } from 'react';
import type { PersonalCurriculum } from './personalCurriculum';

const KEY = 'martialdex:personal-curriculum';
export const PERSONAL_CURRICULUM_EVENT = 'martialdex:personal-curriculum-updated';
const MAX_ARCHIVED = 10;

interface Stored {
  active: PersonalCurriculum | null;
  archived: PersonalCurriculum[];
}

function read(): Stored {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && typeof v === 'object') return { active: v.active ?? null, archived: Array.isArray(v.archived) ? v.archived : [] };
  } catch {
    /* unreadable → empty */
  }
  return { active: null, archived: [] };
}

function write(s: Stored): void {
  localStorage.setItem(KEY, JSON.stringify({ active: s.active, archived: s.archived.slice(0, MAX_ARCHIVED) }));
  window.dispatchEvent(new CustomEvent(PERSONAL_CURRICULUM_EVENT));
}

export function getActiveCurriculum(): PersonalCurriculum | null {
  return read().active;
}

export function listArchivedCurricula(): PersonalCurriculum[] {
  return read().archived;
}

export function saveActiveCurriculum(plan: PersonalCurriculum): void {
  const s = read();
  write({ ...s, active: plan });
}

/** A new goal: the current plan is archived (with its log), the new one becomes active. */
export function replaceActiveCurriculum(plan: PersonalCurriculum, reason: string): void {
  const s = read();
  const old = s.active ? { ...s.active, log: [...s.active.log, { at: new Date().toISOString(), kind: 'goal_change' as const, summary: reason }] } : null;
  write({ active: plan, archived: old ? [old, ...s.archived] : s.archived });
}

export function useActiveCurriculum(): PersonalCurriculum | null {
  const [plan, setPlan] = useState(getActiveCurriculum);
  useEffect(() => {
    const on = () => setPlan(getActiveCurriculum());
    window.addEventListener(PERSONAL_CURRICULUM_EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(PERSONAL_CURRICULUM_EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  return plan;
}
