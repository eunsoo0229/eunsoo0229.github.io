// 숏폼·게시물 기술 평가 서비스 — 기존 community_posts 에 1:1 로 붙는 평가 설정(0056).
// 투표·집계는 서버 RPC 만 쓴다(클라이언트가 평균이나 참여자 수를 계산·저장하지 않음).
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callRpc, run, NOT_CONFIGURED } from '../ecosystem/common';
import type { CriterionKey } from './criteria';

export interface TechniqueEvaluation {
  postId: string;
  authorId: string;
  martialArt: string;
  techniqueId: string | null;
  techniqueName: string;
  criteria: CriterionKey[];
  resultsVisibility: 'public' | 'author_only';
  allowSelfVote: boolean;
  opensAt: string;
  closesAt: string | null;
  closedAt: string | null;
  createdAt: string;
}

export interface EvaluationSettingsInput {
  martialArt: string;
  techniqueId: string | null;
  techniqueName: string;
  criteria: CriterionKey[];
  resultsVisibility: 'public' | 'author_only';
  /** days until voting closes; null = no deadline */
  durationDays: number | null;
}

export interface CriterionStat {
  n: number;
  avg: number;
  dist: [number, number, number, number, number];
}
export interface GroupStat {
  voters: number;
  suppressed: boolean;
  avg?: Partial<Record<CriterionKey, number>>;
}
export interface EvaluationStats {
  hidden: boolean;
  participants: number;
  open: boolean;
  opensAt?: string;
  closesAt: string | null;
  closedAt: string | null;
  criteria?: CriterionKey[];
  overall?: Partial<Record<CriterionKey, CriterionStat>>;
  groups?: Record<string, GroupStat>;
  sameGymVoters?: number;
  outsideGym?: GroupStat;
  minGroupSize?: number;
}

export interface MyVote {
  postId: string;
  scores: Partial<Record<CriterionKey, number>>;
  feedback: Partial<Record<CriterionKey, string>>;
  comment: string;
  status: 'valid' | 'withdrawn' | 'invalidated';
  revision: number;
  updatedAt: string;
}

export interface FeedbackItem {
  feedbackId: string;
  feedback: Partial<Record<CriterionKey, string>>;
  comment: string;
  helpful: boolean;
  updatedAt: string;
}

function mapEval(r: Record<string, unknown>): TechniqueEvaluation {
  return {
    postId: r.post_id as string,
    authorId: r.author_id as string,
    martialArt: r.martial_art as string,
    techniqueId: (r.technique_id as string | null) ?? null,
    techniqueName: r.technique_name as string,
    criteria: (r.criteria as CriterionKey[]) ?? [],
    resultsVisibility: r.results_visibility as TechniqueEvaluation['resultsVisibility'],
    allowSelfVote: !!r.allow_self_vote,
    opensAt: r.opens_at as string,
    closesAt: (r.closes_at as string | null) ?? null,
    closedAt: (r.closed_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

function mapVote(r: Record<string, unknown>): MyVote {
  return {
    postId: r.post_id as string,
    scores: (r.scores as MyVote['scores']) ?? {},
    feedback: (r.feedback as MyVote['feedback']) ?? {},
    comment: (r.comment as string) ?? '',
    status: r.status as MyVote['status'],
    revision: Number(r.revision ?? 1),
    updatedAt: r.updated_at as string,
  };
}

export function isEvaluationOpen(e: Pick<TechniqueEvaluation, 'closedAt' | 'closesAt' | 'opensAt'>, now = Date.now()): boolean {
  if (e.closedAt) return false;
  if (new Date(e.opensAt).getTime() > now) return false;
  return !e.closesAt || new Date(e.closesAt).getTime() > now;
}

/** Called right after createPost when the author turned 기술 평가 on. */
export async function createEvaluation(postId: string, authorId: string, input: EvaluationSettingsInput): Promise<AuthResult<TechniqueEvaluation>> {
  if (!input.criteria.length) return { ok: false, message: '평가 항목을 하나 이상 골라 주세요.' };
  if (!input.techniqueName.trim()) return { ok: false, message: '평가받을 기술 이름을 입력해 주세요.' };
  const closesAt = input.durationDays ? new Date(Date.now() + input.durationDays * 86400000).toISOString() : null;
  return run<TechniqueEvaluation>(async () => {
    const res = await supabase!
      .from('technique_evaluations')
      .insert({
        post_id: postId,
        author_id: authorId,
        martial_art: input.martialArt,
        technique_id: input.techniqueId,
        technique_name: input.techniqueName.trim().slice(0, 120),
        criteria: input.criteria,
        results_visibility: input.resultsVisibility,
        closes_at: closesAt,
      })
      .select('*')
      .single();
    return { data: res.data ? mapEval(res.data) : null, error: res.error };
  });
}

export async function getEvaluations(postIds: string[]): Promise<Map<string, TechniqueEvaluation>> {
  const out = new Map<string, TechniqueEvaluation>();
  if (!supabase || postIds.length === 0) return out;
  try {
    const { data } = await supabase.from('technique_evaluations').select('*').in('post_id', postIds);
    for (const r of data ?? []) out.set(r.post_id as string, mapEval(r));
  } catch {
    // table not migrated yet on this server → simply no evaluations
  }
  return out;
}

export async function getEvaluation(postId: string): Promise<TechniqueEvaluation | null> {
  return (await getEvaluations([postId])).get(postId) ?? null;
}

export async function updateEvaluationSettings(postId: string, patch: { resultsVisibility?: 'public' | 'author_only'; close?: boolean }): Promise<AuthResult<void>> {
  invalidateEvaluation(postId);
  const row: Record<string, unknown> = {};
  if (patch.resultsVisibility) row.results_visibility = patch.resultsVisibility;
  if (patch.close) row.closed_at = new Date().toISOString();
  return run<void>(() => supabase!.from('technique_evaluations').update(row).eq('post_id', postId));
}

export async function getStats(postId: string): Promise<AuthResult<EvaluationStats | null>> {
  return callRpc<EvaluationStats | null>('get_technique_evaluation_stats', { p_post: postId });
}

export async function getMyVote(postId: string, userId: string | null): Promise<MyVote | null> {
  if (!supabase || !userId) return null;
  try {
    const { data } = await supabase.from('technique_votes').select('*').eq('post_id', postId).eq('voter_id', userId).maybeSingle();
    return data ? mapVote(data) : null;
  } catch {
    return null;
  }
}

export async function castVote(postId: string, scores: Partial<Record<CriterionKey, number>>, feedback: Partial<Record<CriterionKey, string>>, comment: string): Promise<AuthResult<void>> {
  const cleanScores: Record<string, number> = {};
  for (const [k, v] of Object.entries(scores)) if (typeof v === 'number') cleanScores[k] = Math.max(0, Math.min(100, Math.round(v)));
  if (!Object.keys(cleanScores).length) return { ok: false, message: '점수를 하나 이상 입력해 주세요.' };
  const cleanFeedback: Record<string, string> = {};
  for (const [k, v] of Object.entries(feedback)) if (typeof v === 'string' && v.trim()) cleanFeedback[k] = v.trim().slice(0, 300);
  return callRpc<void>('cast_technique_vote', { p_post: postId, p_scores: cleanScores, p_feedback: cleanFeedback, p_comment: comment.trim().slice(0, 500) });
}

export const withdrawVote = (postId: string) => callRpc<void>('withdraw_technique_vote', { p_post: postId });

export async function listFeedback(postId: string): Promise<AuthResult<FeedbackItem[]>> {
  const r = await callRpc<Record<string, unknown>[]>('list_technique_feedback', { p_post: postId });
  if (!r.ok) return r;
  return {
    ok: true,
    data: (r.data ?? []).map((x) => ({
      feedbackId: x.feedback_id as string,
      feedback: (x.feedback as FeedbackItem['feedback']) ?? {},
      comment: (x.comment as string) ?? '',
      helpful: !!x.helpful,
      updatedAt: x.updated_at as string,
    })),
  };
}

export const markFeedbackHelpful = (postId: string, feedbackId: string, helpful: boolean) =>
  callRpc<void>('mark_technique_feedback_helpful', { p_post: postId, p_feedback_id: feedbackId, p_helpful: helpful });

/** 신고: 투표/피드백은 익명 id 로만 신고된다 (`postId:feedbackId`). */
export async function reportFeedback(reporterId: string, postId: string, feedbackId: string, reason: string, detail = ''): Promise<AuthResult<void>> {
  return run<void>(() =>
    supabase!.from('user_reports').insert({ reporter_id: reporterId, target_type: 'technique_feedback', target_id: `${postId}:${feedbackId}`, reason, detail }),
  );
}

export interface MyVoteHistoryItem extends MyVote {
  evaluation: TechniqueEvaluation | null;
}

/** 내가 참여한 평가 기록 (내 투표 행은 RLS 상 나만 읽는다). */
export async function listMyVotes(userId: string): Promise<AuthResult<MyVoteHistoryItem[]>> {
  if (!supabase) return { ok: false, message: NOT_CONFIGURED };
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('technique_votes').select('*').eq('voter_id', userId).order('updated_at', { ascending: false }).limit(200));
  if (!r.ok) return r;
  const votes = (r.data ?? []).map(mapVote);
  const evals = await getEvaluations(votes.map((v) => v.postId));
  return { ok: true, data: votes.map((v) => ({ ...v, evaluation: evals.get(v.postId) ?? null })) };
}

export async function listMyEvaluations(userId: string): Promise<AuthResult<TechniqueEvaluation[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('technique_evaluations').select('*').eq('author_id', userId).order('created_at', { ascending: false }).limit(200));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapEval) } : r;
}

export interface EvaluationSummary {
  evaluations: number;
  totalVoters: number;
  items: { postId: string; martialArt: string; techniqueName: string; voters: number; avg: number | null }[];
}
export const getUserEvaluationSummary = (userId: string) => callRpc<EvaluationSummary>('get_user_evaluation_summary', { p_user: userId });

/** 내 점수와 전체 평균의 차이 (항목별). 평균이 없으면 null. */
export function diffFromAverage(mine: MyVote | null, stats: EvaluationStats | null): Partial<Record<CriterionKey, number | null>> {
  const out: Partial<Record<CriterionKey, number | null>> = {};
  if (!mine || !stats?.overall) return out;
  for (const [k, v] of Object.entries(mine.scores) as [CriterionKey, number][]) {
    const avg = stats.overall[k]?.avg;
    out[k] = typeof avg === 'number' ? Math.round((v - Number(avg)) * 10) / 10 : null;
  }
  return out;
}

// ---- 피드용 일괄 조회: 같은 틱에 요청된 게시물 id 를 한 번의 쿼리로 묶는다 (카드마다 쿼리하지 않음) ----
const evalCache = new Map<string, Promise<TechniqueEvaluation | null>>();
let pendingIds: string[] = [];
let pendingResolvers = new Map<string, (e: TechniqueEvaluation | null) => void>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function flush() {
  const ids = pendingIds;
  const resolvers = pendingResolvers;
  pendingIds = [];
  pendingResolvers = new Map();
  flushTimer = null;
  void getEvaluations(ids).then((m) => {
    for (const id of ids) resolvers.get(id)?.(m.get(id) ?? null);
  });
}

export function loadEvaluation(postId: string): Promise<TechniqueEvaluation | null> {
  const hit = evalCache.get(postId);
  if (hit) return hit;
  const p = new Promise<TechniqueEvaluation | null>((resolve) => {
    pendingIds.push(postId);
    pendingResolvers.set(postId, resolve);
    if (!flushTimer) flushTimer = setTimeout(flush, 0);
  });
  evalCache.set(postId, p);
  return p;
}

/** after creating / changing an evaluation */
export function invalidateEvaluation(postId: string): void {
  evalCache.delete(postId);
}
