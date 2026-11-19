// 지도자·숙련자 자격 신청 (credential_applications, 0055) — 신청 화면과 플랫폼 관리자 콘솔이 같이 쓴다.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callRpc, run } from './common';

export const CREDENTIAL_ARTS: Record<string, string> = {
  '*': '전 종목',
  boxing: '복싱',
  kickboxing: '킥복싱',
  'muay-thai': '무에타이',
  bjj: '주짓수',
  wrestling: '레슬링',
  'mixed-martial-arts': '종합격투기(MMA)',
  judo: '유도',
  taekwondo: '태권도',
  karate: '가라테',
  sambo: '삼보',
};

export const CREDENTIAL_TIERS = {
  beginner: '입문자',
  intermediate: '중급자',
  advanced: '숙련자',
  instructor: '지도자',
} as const;
export type CredentialTier = keyof typeof CREDENTIAL_TIERS;

export interface CredentialApplication {
  id: string;
  userId: string;
  martialArt: string;
  requestedTier: CredentialTier;
  evidence: string;
  status: 'pending' | 'approved' | 'rejected';
  reviewNote: string;
  reviewedAt: string | null;
  createdAt: string;
}

export function mapCredentialApplication(r: Record<string, unknown>): CredentialApplication {
  return {
    id: r.id as string,
    userId: r.user_id as string,
    martialArt: (r.martial_art as string) ?? '*',
    requestedTier: r.requested_tier as CredentialTier,
    evidence: (r.evidence as string) ?? '',
    status: r.status as CredentialApplication['status'],
    reviewNote: (r.review_note as string) ?? '',
    reviewedAt: (r.reviewed_at as string | null) ?? null,
    createdAt: r.created_at as string,
  };
}

export const CRED_STATUS_LABEL: Record<CredentialApplication['status'], string> = { pending: '검토 대기', approved: '승인', rejected: '반려' };

export async function listMyCredentialApplications(userId: string): Promise<AuthResult<CredentialApplication[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('credential_applications').select('*').eq('user_id', userId).order('created_at', { ascending: false }));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapCredentialApplication) } : r;
}

export function applyCredential(userId: string, martialArt: string, tier: CredentialTier, evidence: string): Promise<AuthResult<void>> {
  const e = evidence.trim();
  if (e.length < 10) return Promise.resolve({ ok: false, message: '근거를 10자 이상 적어 주세요.' });
  return run<void>(() => supabase!.from('credential_applications').insert({ user_id: userId, martial_art: martialArt, requested_tier: tier, evidence: e.slice(0, 2000) }));
}

/** 플랫폼 관리자: 검토 대기 신청 (RLS 가 관리자에게만 전체를 보여 준다) */
export async function adminListPendingCredentials(): Promise<AuthResult<CredentialApplication[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('credential_applications').select('*').eq('status', 'pending').order('created_at').limit(200));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapCredentialApplication) } : r;
}

export const reviewCredential = (id: string, approve: boolean, note: string) => callRpc<void>('review_credential_application', { p_id: id, p_approve: approve, p_note: note });
