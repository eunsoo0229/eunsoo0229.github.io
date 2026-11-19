// Conversations with the MARTIALDEX 자체 AI 코치 — local-first like every other
// user-data domain (martialdex:* keys are included in the account backup,
// cloudSync/dataBackup.ts), so the coach remembers across app restarts.

import { useEffect, useState } from 'react';
import type { CoachChatMessage, CoachConversation } from './types';

const KEY = 'martialdex:coach-conversations';
export const COACH_CONVERSATIONS_EVENT = 'martialdex:coach-conversations-updated';
const MAX_CONVERSATIONS = 50;
const MAX_MESSAGES = 200;

function read(): CoachConversation[] {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '[]');
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function write(all: CoachConversation[]): void {
  localStorage.setItem(KEY, JSON.stringify(all.slice(0, MAX_CONVERSATIONS)));
  window.dispatchEvent(new CustomEvent(COACH_CONVERSATIONS_EVENT));
}

const newId = (p: string) => `${p}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

export function listConversations(): CoachConversation[] {
  return read().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getConversation(id: string): CoachConversation | null {
  return read().find((c) => c.id === id) ?? null;
}

export function createConversation(martialArt: string | null = null, now = new Date()): CoachConversation {
  const c: CoachConversation = { id: newId('conv'), title: '새 대화', martialArt, createdAt: now.toISOString(), updatedAt: now.toISOString(), messages: [] };
  write([c, ...read()]);
  return c;
}

export function appendMessage(conversationId: string, message: Omit<CoachChatMessage, 'id' | 'createdAt'> & Partial<Pick<CoachChatMessage, 'id' | 'createdAt'>>): CoachChatMessage | null {
  const all = read();
  const c = all.find((x) => x.id === conversationId);
  if (!c) return null;
  const m: CoachChatMessage = { id: message.id ?? newId('msg'), createdAt: message.createdAt ?? new Date().toISOString(), ...message } as CoachChatMessage;
  c.messages = [...c.messages, m].slice(-MAX_MESSAGES);
  c.updatedAt = m.createdAt;
  if (c.title === '새 대화' && m.role === 'user') c.title = m.text.replace(/\s+/g, ' ').slice(0, 40);
  write(all);
  return m;
}

export function updateConversation(id: string, patch: Partial<Pick<CoachConversation, 'title' | 'martialArt' | 'lessonSessionId'>>): void {
  const all = read();
  const c = all.find((x) => x.id === id);
  if (!c) return;
  Object.assign(c, patch);
  write(all);
}

export function deleteConversation(id: string): void {
  write(read().filter((c) => c.id !== id));
}

export function useConversation(id: string | null): CoachConversation | null {
  const [c, setC] = useState(() => (id ? getConversation(id) : null));
  useEffect(() => {
    setC(id ? getConversation(id) : null);
    const on = () => setC(id ? getConversation(id) : null);
    window.addEventListener(COACH_CONVERSATIONS_EVENT, on);
    return () => window.removeEventListener(COACH_CONVERSATIONS_EVENT, on);
  }, [id]);
  return c;
}

export function useConversationList(): CoachConversation[] {
  const [list, setList] = useState(listConversations);
  useEffect(() => {
    const on = () => setList(listConversations());
    window.addEventListener(COACH_CONVERSATIONS_EVENT, on);
    return () => window.removeEventListener(COACH_CONVERSATIONS_EVENT, on);
  }, []);
  return list;
}
