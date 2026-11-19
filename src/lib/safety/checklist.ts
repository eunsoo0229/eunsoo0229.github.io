// 훈련 전 안전 체크리스트 (사양 §5-3). Local-first (martialdex:* → account backup). A checklist is linked to training
// records by DATE (the training history schema is not changed): the records screen can show "안전 체크 완료" for a day.
// Not completing it never blocks training; the important items are stated plainly.

import { useEffect, useState } from 'react';
import type { SafetyKind } from './techniqueSafety';

const KEY = 'martialdex:safety-checklists';
export const SAFETY_CHECKLIST_EVENT = 'martialdex:safety-checklists-updated';
const MAX = 400;

export interface ChecklistItem {
  id: string;
  label: string;
  /** Shown with emphasis — the item that matters most for safety. */
  important?: boolean;
}

export interface ChecklistRecord {
  id: string;
  /** YYYY-MM-DD (local) — links the checklist to that day's training records. */
  date: string;
  at: string;
  techniqueIds: string[];
  withPartner: boolean;
  checked: Record<string, boolean>;
  /** "통증이나 이상 증상이 있나요?" — null = not answered. */
  pain: boolean | null;
  note: string | null;
}

export function checklistItems(opts: { kinds: SafetyKind[]; withPartner: boolean; equipment: string[] }): ChecklistItem[] {
  const items: ChecklistItem[] = [
    { id: 'space', label: '훈련 공간이 안전한가요? (주변 물건·바닥·매트)', important: opts.kinds.some((k) => ['throw', 'takedown', 'joint_lock', 'leg_lock', 'choke', 'neck', 'position'].includes(k)) },
    { id: 'equipment', label: opts.equipment.length ? `필요한 보호 장비를 준비했나요? (${opts.equipment.slice(0, 4).join(', ')})` : '필요한 보호 장비를 준비했나요?' },
    { id: 'warmup', label: '준비운동을 마쳤나요?', important: true },
    { id: 'goal', label: '오늘의 학습 목표를 확인했나요?' },
  ];
  if (opts.withPartner) items.push({ id: 'partner', label: '파트너와 서로의 수준, 연습 범위와 강도, 탭 규칙을 확인했나요?', important: true });
  return items;
}

function read(): ChecklistRecord[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function localDate(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function saveChecklist(rec: Omit<ChecklistRecord, 'id' | 'at' | 'date'> & { date?: string }, now = new Date()): ChecklistRecord {
  const r: ChecklistRecord = { id: `sc_${now.getTime().toString(36)}${Math.random().toString(36).slice(2, 6)}`, date: rec.date ?? localDate(now), at: now.toISOString(), techniqueIds: rec.techniqueIds, withPartner: rec.withPartner, checked: rec.checked, pain: rec.pain, note: rec.note };
  localStorage.setItem(KEY, JSON.stringify([r, ...read()].slice(0, MAX)));
  window.dispatchEvent(new CustomEvent(SAFETY_CHECKLIST_EVENT));
  return r;
}

export function listChecklists(): ChecklistRecord[] {
  return read();
}

export function checklistsOn(date: string): ChecklistRecord[] {
  return read().filter((r) => r.date === date);
}

export function checklistComplete(r: ChecklistRecord, items: { id: string }[]): boolean {
  return items.every((i) => r.checked[i.id]) && r.pain === false;
}

export function useChecklistsOn(date: string): ChecklistRecord[] {
  const [v, setV] = useState(() => checklistsOn(date));
  useEffect(() => {
    const on = () => setV(checklistsOn(date));
    on();
    window.addEventListener(SAFETY_CHECKLIST_EVENT, on);
    return () => window.removeEventListener(SAFETY_CHECKLIST_EVENT, on);
  }, [date]);
  return v;
}
