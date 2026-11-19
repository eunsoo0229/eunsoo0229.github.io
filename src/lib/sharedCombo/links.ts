import { supabase } from '../supabase/client';
import { toKoreanAuthMessage } from '../auth/authErrors';
import type { AuthResult } from '../auth/authService';
import { resolveTechnique } from '../userTechniques/service';
import { motionForTechnique } from '../visualMitt/archetypes';
import { reviewConnections, stepsForIds } from '../visualMitt/combos';
import type { SharedCombo } from './types';

// 사용자 콤보·셋업 연결 — "A → B" between two shared combos/setups (table
// shared_combo_links, migration 0040). Anyone signed in can link any two
// shared items (their own or other users'); the link belongs to whoever made
// it. The same A → B link made by several users counts as their support.

export type LinkRelation = 'follow_up' | 'opens' | 'if_blocked';

export const RELATION_LABEL: Record<LinkRelation, string> = {
  follow_up: '이어서',
  opens: '셋업으로 열어줌',
  if_blocked: '막히면 전환',
};

export const RELATION_HELP: Record<LinkRelation, string> = {
  follow_up: 'A가 끝난 자세에서 바로 B로 이어서 칩니다.',
  opens: 'A가 만든 상대의 반응·빈틈으로 B를 넣습니다.',
  if_blocked: 'A가 막히거나 상대가 반응하지 않으면 B로 바꿉니다.',
};

export const RELATIONS: LinkRelation[] = ['follow_up', 'opens', 'if_blocked'];

export interface ComboLink {
  id: string;
  authorId: string;
  authorNickname: string;
  fromId: string;
  toId: string;
  relation: LinkRelation;
  note: string;
  createdAt: string;
}

const TABLE = 'shared_combo_links';
const NOT_CONFIGURED = 'Supabase 설정이 필요합니다.';

function message(error: unknown): string {
  const e = error as { code?: string; message?: string } | null;
  if (e && (e.code === 'PGRST205' || e.code === '42P01' || (/shared_combo_links/.test(e.message ?? '') && /does not exist|schema cache/.test(e.message ?? '')))) {
    return '콤보·셋업 연결 서버가 아직 준비되지 않았습니다(데이터베이스 마이그레이션 0040 적용 필요).';
  }
  if (e?.code === '23505') return '이미 같은 연결을 만들었습니다.';
  if (e?.code === '23503') return '연결하려는 콤보·셋업이 공유 취소되었습니다.';
  if (e?.code === '23514') return '같은 콤보·셋업끼리는 연결할 수 없습니다.';
  return toKoreanAuthMessage(error);
}

function mapRow(r: Record<string, unknown>): ComboLink {
  return {
    id: r.id as string,
    authorId: r.author_id as string,
    authorNickname: (r.author_nickname as string) ?? '',
    fromId: r.from_id as string,
    toId: r.to_id as string,
    relation: r.relation as LinkRelation,
    note: (r.note as string) ?? '',
    createdAt: r.created_at as string,
  };
}

/** Every link (public). Small table; used for counts and flows. */
export async function listAllLinks(): Promise<AuthResult<ComboLink[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { data, error } = await supabase.from(TABLE).select('*').order('created_at', { ascending: false }).limit(2000);
    if (error) return { ok: false, message: message(error) };
    return { ok: true, data: (data ?? []).map(mapRow) };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

export interface LinkInput {
  userId: string;
  nickname: string;
  fromId: string;
  toId: string;
  relation: LinkRelation;
  note: string;
}

export function validateLink(input: Pick<LinkInput, 'fromId' | 'toId' | 'relation' | 'note'>): string[] {
  const errors: string[] = [];
  if (!input.fromId || !input.toId) errors.push('연결할 콤보·셋업을 골라 주세요.');
  if (input.fromId && input.fromId === input.toId) errors.push('같은 콤보·셋업끼리는 연결할 수 없습니다.');
  if (!RELATIONS.includes(input.relation)) errors.push('연결 방식을 골라 주세요.');
  if (input.note.trim().length > 300) errors.push('메모는 300자 이하로 입력해 주세요.');
  return errors;
}

export async function createLink(input: LinkInput): Promise<AuthResult<ComboLink>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const errors = validateLink(input);
  if (errors.length) return { ok: false, message: errors.join(' ') };
  const id = `sl_${typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`}`;
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .insert({ id, author_id: input.userId, author_nickname: input.nickname || '익명', from_id: input.fromId, to_id: input.toId, relation: input.relation, note: input.note.trim() })
      .select('*')
      .single();
    if (error) return { ok: false, message: message(error) };
    return { ok: true, data: mapRow(data) };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

export async function deleteLink(id: string): Promise<AuthResult<void>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  try {
    const { error } = await supabase.from(TABLE).delete().eq('id', id);
    if (error) return { ok: false, message: message(error) };
    return { ok: true, data: undefined };
  } catch (e) {
    return { ok: false, message: message(e) };
  }
}

// ---------------------------------------------------------------- pure helpers

/** One A → B connection with everyone who made it (same pair + relation = support). */
export interface LinkGroup {
  fromId: string;
  toId: string;
  relation: LinkRelation;
  links: ComboLink[];
  support: number;
}

export function groupLinks(links: ComboLink[]): LinkGroup[] {
  const m = new Map<string, LinkGroup>();
  for (const l of links) {
    const k = `${l.fromId}>${l.toId}>${l.relation}`;
    const g = m.get(k) ?? { fromId: l.fromId, toId: l.toId, relation: l.relation, links: [], support: 0 };
    g.links.push(l);
    g.support = new Set(g.links.map((x) => x.authorId)).size;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.support - a.support || b.links[0].createdAt.localeCompare(a.links[0].createdAt));
}

/** Links per shared item (either direction), for the "🔗 N" badge. */
export function linkCounts(links: ComboLink[]): Map<string, number> {
  const pairs = new Map<string, Set<string>>();
  for (const l of links) {
    for (const id of [l.fromId, l.toId]) {
      const s = pairs.get(id) ?? new Set<string>();
      s.add(`${l.fromId}>${l.toId}`);
      pairs.set(id, s);
    }
  }
  return new Map([...pairs].map(([id, s]) => [id, s.size]));
}

/**
 * Is the hand-over natural? Checks the last step of A against the first step
 * of B with the Visualizing Mitt's reviewed connection rules (only when both
 * have a drawable motion) and a repeated technique. Notes only — never blocks.
 */
export function transitionNotes(from: Pick<SharedCombo, 'steps'>, to: Pick<SharedCombo, 'steps'>, relation: LinkRelation): string[] {
  const a = from.steps.at(-1);
  const b = to.steps[0];
  if (!a || !b) return [];
  const notes: string[] = [];
  if (relation === 'if_blocked') return notes; // a switch, not a continuous flow
  if (a.techniqueId === b.techniqueId) notes.push(`A의 마지막 기술과 B의 첫 기술이 같은 ${b.name}입니다 — 한 번만 칠지, 두 번 칠지 메모로 알려 주세요.`);
  const ta = resolveTechnique(a.techniqueId);
  const tb = resolveTechnique(b.techniqueId);
  if (ta && tb && motionForTechnique(ta) && motionForTechnique(tb)) {
    const steps = stepsForIds([ta.id, tb.id]);
    if (steps.length === 2) notes.push(...reviewConnections(steps));
  }
  return notes;
}

/** A → B steps merged (a repeated hand-over technique once), capped at 12 like a shared combo. */
export function mergedSteps(chain: Pick<SharedCombo, 'steps'>[]): SharedCombo['steps'] {
  const out: SharedCombo['steps'] = [];
  for (const c of chain) {
    for (const [i, s] of c.steps.entries()) {
      if (i === 0 && out.at(-1)?.techniqueId === s.techniqueId) continue;
      out.push(s);
    }
  }
  return out.slice(0, 12);
}

/**
 * The best-supported flow onward from `startId`: follow the most-supported
 * "이어서 / 열어줌" link at each step (never revisiting an item), up to
 * `maxItems` items. "막히면 전환" links are alternatives, not a flow.
 */
export function bestFlow(startId: string, links: ComboLink[], maxItems = 4): string[] {
  const groups = groupLinks(links).filter((g) => g.relation !== 'if_blocked');
  const flow = [startId];
  while (flow.length < maxItems) {
    const next = groups.find((g) => g.fromId === flow.at(-1) && !flow.includes(g.toId));
    if (!next) break;
    flow.push(next.toId);
  }
  return flow;
}
