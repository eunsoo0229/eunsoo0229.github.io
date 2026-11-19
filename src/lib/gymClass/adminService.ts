// 체육관 운영 대시보드 (0055) — 가입 승인 · 역할 · 회원 진도(동의 기반 요약) · 과제/피드백 · 공지 · 통계.
// 출석·수업 참여는 기존 gym_class_sessions / gym_class_attendance 에서 계산한다(새로 저장하지 않음).
// 학습·자세·훈련 원본은 회원 기기와 본인 전용 테이블에 있고, 지도자는 회원이 공유한 요약본만 본다.
import { supabase } from '../supabase/client';
import type { AuthResult } from '../auth/authService';
import { callRpc, run } from '../ecosystem/common';
import { computeAllSkillProgress } from '../skillProgress/weaknessEngine';
import { getAllRecords } from '../poseAnalysis/recordsService';
import { listTrainingHistory } from '../trainingHistory/service';
import { MASTERY_LABEL, type MasteryStatus } from '../skillProgress/types';

export interface GymMemberRow {
  gymId: string;
  userId: string;
  role: 'instructor' | 'student';
  nickname: string;
  joinedAt: string;
}
export interface JoinRequest {
  gymId: string;
  userId: string;
  nickname: string;
  message: string;
  status: 'pending' | 'approved' | 'rejected';
  createdAt: string;
}
export interface Assignment {
  id: string;
  gymId: string;
  memberId: string;
  authorId: string;
  kind: 'task' | 'technique' | 'feedback' | 'ai_review';
  techniqueId: string | null;
  title: string;
  body: string;
  dueDate: string | null;
  status: 'open' | 'done' | 'dismissed';
  memberNote: string;
  createdAt: string;
  updatedAt: string;
}
export const ASSIGNMENT_KIND_LABEL: Record<Assignment['kind'], string> = {
  task: '훈련 과제',
  technique: '기술 학습 권장',
  feedback: '훈련 피드백',
  ai_review: 'AI 분석 검토 의견',
};
export interface Announcement {
  id: string;
  gymId: string;
  authorId: string;
  title: string;
  body: string;
  pinned: boolean;
  createdAt: string;
}

/** 회원이 체육관에 공유하는 진도 요약 (회원 기기에서 계산) */
export interface ProgressSummary {
  version: 1;
  generatedAt: string;
  counts: Record<MasteryStatus, number>;
  learned: number;
  techniques: { id: string; name: string; martialArt: string; status: MasteryStatus; latestScore: number | null; lastPracticedAt: string | null }[];
  pose: { techniqueId: string; name: string; count: number; first: number; latest: number; latestAt: string; method: string; lowReliability: number }[];
  training: { sessions30: number; minutes30: number; lastSessionAt: string | null; weekly: number[] };
}

const mapMember = (r: Record<string, unknown>): GymMemberRow => ({ gymId: r.gym_id as string, userId: r.user_id as string, role: r.role as GymMemberRow['role'], nickname: r.nickname as string, joinedAt: r.joined_at as string });
const mapAssignment = (r: Record<string, unknown>): Assignment => ({
  id: r.id as string,
  gymId: r.gym_id as string,
  memberId: r.member_id as string,
  authorId: r.author_id as string,
  kind: r.kind as Assignment['kind'],
  techniqueId: (r.technique_id as string | null) ?? null,
  title: r.title as string,
  body: (r.body as string) ?? '',
  dueDate: (r.due_date as string | null) ?? null,
  status: r.status as Assignment['status'],
  memberNote: (r.member_note as string) ?? '',
  createdAt: r.created_at as string,
  updatedAt: r.updated_at as string,
});

// ---------------- 가입 · 역할 ----------------

/** 코드로 참가 — 승인제 체육관이면 신청서가 남는다. 서버가 0055 이전이면 기존 경로로 동작. */
export async function joinWithCode(code: string, nickname: string, message = ''): Promise<AuthResult<{ gymId: string; gymName: string; outcome: 'joined' | 'requested' | 'already' }>> {
  const r = await callRpc<{ gym_id: string; gym_name: string; outcome: 'joined' | 'requested' | 'already' }[]>('join_gym_with_code', { p_code: code.trim().toUpperCase(), p_nickname: nickname, p_message: message });
  if (!r.ok) return r;
  const row = Array.isArray(r.data) ? r.data[0] : null;
  return row ? { ok: true, data: { gymId: row.gym_id, gymName: row.gym_name, outcome: row.outcome } } : { ok: false, message: '체육관 코드를 찾을 수 없습니다.' };
}

export async function listMembers(gymId: string): Promise<AuthResult<GymMemberRow[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_members').select('*').eq('gym_id', gymId).order('joined_at'));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapMember) } : r;
}

export async function listJoinRequests(gymId: string): Promise<AuthResult<JoinRequest[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_join_requests').select('*').eq('gym_id', gymId).eq('status', 'pending').order('created_at'));
  return r.ok
    ? { ok: true, data: (r.data ?? []).map((x) => ({ gymId: x.gym_id as string, userId: x.user_id as string, nickname: x.nickname as string, message: (x.message as string) ?? '', status: x.status as JoinRequest['status'], createdAt: x.created_at as string })) }
    : r;
}

export const decideJoin = (gymId: string, userId: string, approve: boolean) => callRpc<void>('decide_gym_join', { p_gym: gymId, p_user: userId, p_approve: approve });
export const setMemberRole = (gymId: string, userId: string, role: 'instructor' | 'student') => callRpc<void>('set_gym_member_role', { p_gym: gymId, p_user: userId, p_role: role });
export const removeMember = (gymId: string, userId: string) => callRpc<void>('remove_gym_member', { p_gym: gymId, p_user: userId });
export const setJoinApproval = (gymId: string, required: boolean) => callRpc<void>('set_gym_join_approval', { p_gym: gymId, p_required: required });

export async function getJoinApproval(gymId: string): Promise<boolean | null> {
  if (!supabase) return null;
  try {
    const { data, error } = await supabase.from('gyms').select('join_approval').eq('id', gymId).maybeSingle();
    if (error) return null;
    return (data?.join_approval as boolean | undefined) ?? null;
  } catch {
    return null;
  }
}

// ---------------- 출석 · 수업 참여 (기존 테이블) ----------------

export interface SessionRow {
  id: string;
  date: string;
  gymClassId: string;
}
export interface AttendanceRow {
  sessionId: string;
  studentUserId: string;
  completed: boolean;
  completedAt: string | null;
}

export async function listSessionsAndAttendance(gymId: string, sinceDate: string): Promise<AuthResult<{ sessions: SessionRow[]; attendance: AttendanceRow[] }>> {
  const s = await run<Record<string, unknown>[]>(() => supabase!.from('gym_class_sessions').select('id, date, gym_class_id').eq('gym_id', gymId).gte('date', sinceDate).order('date'));
  if (!s.ok) return s;
  const sessions = (s.data ?? []).map((x) => ({ id: x.id as string, date: x.date as string, gymClassId: x.gym_class_id as string }));
  if (!sessions.length) return { ok: true, data: { sessions, attendance: [] } };
  const a = await run<Record<string, unknown>[]>(() => supabase!.from('gym_class_attendance').select('session_id, student_user_id, completed, completed_at').in('session_id', sessions.map((x) => x.id)));
  if (!a.ok) return a;
  return { ok: true, data: { sessions, attendance: (a.data ?? []).map((x) => ({ sessionId: x.session_id as string, studentUserId: x.student_user_id as string, completed: !!x.completed, completedAt: (x.completed_at as string | null) ?? null })) } };
}

// ---------------- 진도 공유 ----------------

export async function listProgress(gymId: string): Promise<AuthResult<Map<string, { summary: ProgressSummary; updatedAt: string }>>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_member_progress').select('*').eq('gym_id', gymId));
  if (!r.ok) return r;
  return { ok: true, data: new Map((r.data ?? []).map((x) => [x.user_id as string, { summary: x.summary as ProgressSummary, updatedAt: x.updated_at as string }])) };
}

export async function getMyShare(gymId: string, userId: string): Promise<{ updatedAt: string } | null> {
  if (!supabase) return null;
  try {
    const { data } = await supabase.from('gym_member_progress').select('updated_at').eq('gym_id', gymId).eq('user_id', userId).maybeSingle();
    return data ? { updatedAt: data.updated_at as string } : null;
  } catch {
    return null;
  }
}

/** 회원 기기의 기존 기록에서 요약을 만든다 (새 측정값을 만들지 않음). */
export function buildProgressSummary(now = new Date()): ProgressSummary {
  const entries = computeAllSkillProgress();
  const counts = { not_started: 0, learning: 0, average: 0, proficient: 0, needs_improvement: 0 } as Record<MasteryStatus, number>;
  const touched = entries.filter((e) => e.progress.status !== 'not_started' || e.progress.practiceCount > 0 || e.progress.analysisCount > 0);
  for (const e of touched) counts[e.progress.status]++;
  const techniques = touched
    .sort((a, b) => (b.progress.lastPracticedAt ?? '').localeCompare(a.progress.lastPracticedAt ?? ''))
    .slice(0, 80)
    .map((e) => ({ id: e.technique.id, name: e.technique.name, martialArt: e.technique.martialArt, status: e.progress.status, latestScore: e.progress.latestScore, lastPracticedAt: e.progress.lastPracticedAt }));
  const nameOf = new Map(entries.map((e) => [e.technique.id, e.technique.name]));
  const byTech = new Map<string, ReturnType<typeof getAllRecords>>();
  for (const r of getAllRecords()) byTech.set(`${r.techniqueId}::${r.method ?? 'landmark'}`, [...(byTech.get(`${r.techniqueId}::${r.method ?? 'landmark'}`) ?? []), r]);
  const pose = [...byTech.values()]
    .map((rs) => {
      const s = [...rs].sort((a, b) => a.analyzedAt.localeCompare(b.analyzedAt));
      return { techniqueId: s[0].techniqueId, name: nameOf.get(s[0].techniqueId) ?? s[0].techniqueId, count: s.length, first: s[0].score, latest: s[s.length - 1].score, latestAt: s[s.length - 1].analyzedAt, method: s[0].method ?? 'landmark', lowReliability: s.filter((x) => x.reliability === 'low').length };
    })
    .sort((a, b) => b.latestAt.localeCompare(a.latestAt))
    .slice(0, 40);
  const hist = listTrainingHistory().filter((e) => e.completed);
  // TrainingHistoryEntry.date is a LOCAL calendar day (YYYY-MM-DD); compare against local days too —
  // toISOString() (UTC) put today's morning sessions outside the current week in UTC+ time zones.
  const localDay = (t: number) => {
    const d = new Date(t);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const since30 = localDay(now.getTime() - 30 * 86400000);
  const last30 = hist.filter((e) => e.date >= since30);
  const weekly = Array.from({ length: 8 }, (_, i) => {
    const end = localDay(now.getTime() - i * 7 * 86400000);
    const start = localDay(now.getTime() - (i + 1) * 7 * 86400000);
    return hist.filter((e) => e.date > start && e.date <= end).length;
  }).reverse();
  return {
    version: 1,
    generatedAt: now.toISOString(),
    counts,
    learned: touched.length,
    techniques,
    pose,
    training: {
      sessions30: last30.length,
      minutes30: last30.reduce((s, e) => s + (e.actualMinutes ?? e.estimatedMinutes ?? 0), 0),
      lastSessionAt: hist.map((e) => e.completedAt).sort().pop() ?? null,
      weekly,
    },
  };
}

export async function shareProgress(gymId: string, userId: string): Promise<AuthResult<void>> {
  const summary = buildProgressSummary();
  return run<void>(() => supabase!.from('gym_member_progress').upsert({ gym_id: gymId, user_id: userId, summary, updated_at: new Date().toISOString() }, { onConflict: 'gym_id,user_id' }));
}
export const stopSharing = (gymId: string, userId: string) => run<void>(() => supabase!.from('gym_member_progress').delete().eq('gym_id', gymId).eq('user_id', userId));

// ---------------- 과제 · 피드백 ----------------

export async function listAssignments(gymId: string, memberId?: string): Promise<AuthResult<Assignment[]>> {
  const r = await run<Record<string, unknown>[]>(() => {
    let q = supabase!.from('gym_assignments').select('*').eq('gym_id', gymId).order('created_at', { ascending: false }).limit(300);
    if (memberId) q = q.eq('member_id', memberId);
    return q;
  });
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapAssignment) } : r;
}
export async function listMyAssignments(userId: string): Promise<AuthResult<Assignment[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_assignments').select('*').eq('member_id', userId).order('created_at', { ascending: false }).limit(100));
  return r.ok ? { ok: true, data: (r.data ?? []).map(mapAssignment) } : r;
}
export async function createAssignment(input: { gymId: string; memberId: string; authorId: string; kind: Assignment['kind']; techniqueId: string | null; title: string; body: string; dueDate: string | null }): Promise<AuthResult<void>> {
  if (!input.title.trim()) return { ok: false, message: '제목을 입력해 주세요.' };
  return run<void>(() =>
    supabase!.from('gym_assignments').insert({ gym_id: input.gymId, member_id: input.memberId, author_id: input.authorId, kind: input.kind, technique_id: input.techniqueId, title: input.title.trim().slice(0, 120), body: input.body.trim().slice(0, 3000), due_date: input.dueDate || null }),
  );
}
export const updateAssignment = (id: string, patch: Partial<{ title: string; body: string; status: Assignment['status']; memberNote: string; dueDate: string | null }>) =>
  run<void>(() =>
    supabase!
      .from('gym_assignments')
      .update({
        ...(patch.title !== undefined ? { title: patch.title } : {}),
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.status !== undefined ? { status: patch.status } : {}),
        ...(patch.memberNote !== undefined ? { member_note: patch.memberNote } : {}),
        ...(patch.dueDate !== undefined ? { due_date: patch.dueDate } : {}),
      })
      .eq('id', id),
  );
export const deleteAssignment = (id: string) => run<void>(() => supabase!.from('gym_assignments').delete().eq('id', id));

// ---------------- 공지 ----------------

export async function listAnnouncements(gymId: string): Promise<AuthResult<Announcement[]>> {
  const r = await run<Record<string, unknown>[]>(() => supabase!.from('gym_announcements').select('*').eq('gym_id', gymId).order('pinned', { ascending: false }).order('created_at', { ascending: false }).limit(50));
  return r.ok
    ? { ok: true, data: (r.data ?? []).map((x) => ({ id: x.id as string, gymId: x.gym_id as string, authorId: x.author_id as string, title: x.title as string, body: (x.body as string) ?? '', pinned: !!x.pinned, createdAt: x.created_at as string })) }
    : r;
}
export const createAnnouncement = (gymId: string, authorId: string, title: string, body: string, pinned: boolean) =>
  title.trim() ? run<void>(() => supabase!.from('gym_announcements').insert({ gym_id: gymId, author_id: authorId, title: title.trim().slice(0, 120), body: body.trim().slice(0, 3000), pinned })) : Promise.resolve({ ok: false as const, message: '제목을 입력해 주세요.' });
export const deleteAnnouncement = (id: string) => run<void>(() => supabase!.from('gym_announcements').delete().eq('id', id));

// ---------------- 대시보드 계산 (순수 함수 — 테스트 대상) ----------------

export interface MemberStat {
  userId: string;
  nickname: string;
  role: GymMemberRow['role'];
  attended: number;
  completed: number;
  attendanceRate: number | null;
  lastActivityAt: string | null;
  inactiveDays: number | null;
  shared: boolean;
  learned: number | null;
  proficient: number | null;
  openAssignments: number;
}
export interface DashboardStats {
  totalMembers: number;
  students: number;
  activeMembers: number;
  sessions: number;
  attendanceRate: number | null;
  participationRate: number | null;
  learningCompletionRate: number | null;
  sharedCount: number;
  inactive: MemberStat[];
  members: MemberStat[];
  weeklyAttendance: { week: string; attended: number; possible: number }[];
}

export const INACTIVE_DAYS = 14;

export function computeDashboard(
  members: GymMemberRow[],
  sessions: SessionRow[],
  attendance: AttendanceRow[],
  progress: Map<string, { summary: ProgressSummary; updatedAt: string }>,
  assignments: Assignment[],
  now = new Date(),
): DashboardStats {
  const students = members.filter((m) => m.role === 'student');
  const sessionDate = new Map(sessions.map((s) => [s.id, s.date]));
  const stats: MemberStat[] = members.map((m) => {
    const mine = attendance.filter((a) => a.studentUserId === m.userId);
    // only sessions held after the member joined can be counted against them
    const eligible = sessions.filter((s) => s.date >= m.joinedAt.slice(0, 10)).length;
    const p = progress.get(m.userId);
    const acts = [
      ...mine.map((a) => a.completedAt ?? (sessionDate.get(a.sessionId) ? `${sessionDate.get(a.sessionId)}T00:00:00Z` : null)),
      p?.summary.training.lastSessionAt ?? null,
    ].filter((x): x is string => !!x);
    const last = acts.sort().pop() ?? null;
    const inactiveDays = last ? Math.floor((now.getTime() - new Date(last).getTime()) / 86400000) : null;
    const prof = p ? p.summary.counts.proficient : null;
    return {
      userId: m.userId,
      nickname: m.nickname,
      role: m.role,
      attended: mine.length,
      completed: mine.filter((a) => a.completed).length,
      attendanceRate: eligible ? Math.round((mine.length / eligible) * 100) : null,
      lastActivityAt: last,
      inactiveDays,
      shared: !!p,
      learned: p ? p.summary.learned : null,
      proficient: prof,
      openAssignments: assignments.filter((a) => a.memberId === m.userId && a.status === 'open').length,
    };
  });
  const studentStats = stats.filter((s) => s.role === 'student');
  const possible = studentStats.reduce((sum, s) => {
    const m = students.find((x) => x.userId === s.userId)!;
    return sum + sessions.filter((x) => x.date >= m.joinedAt.slice(0, 10)).length;
  }, 0);
  const attended = studentStats.reduce((s, x) => s + x.attended, 0);
  const completed = studentStats.reduce((s, x) => s + x.completed, 0);
  const active = studentStats.filter((s) => s.inactiveDays !== null && s.inactiveDays < INACTIVE_DAYS).length;
  const shared = studentStats.filter((s) => s.shared);
  const learnedSum = shared.reduce((s, x) => s + (x.learned ?? 0), 0);
  const profSum = shared.reduce((s, x) => s + (x.proficient ?? 0), 0);

  const weeks = new Map<string, { attended: number; possible: number }>();
  for (const s of sessions) {
    const d = new Date(`${s.date}T00:00:00Z`);
    const wd = (d.getUTCDay() + 6) % 7;
    d.setUTCDate(d.getUTCDate() - wd);
    const k = d.toISOString().slice(0, 10);
    const w = weeks.get(k) ?? { attended: 0, possible: 0 };
    w.attended += attendance.filter((a) => a.sessionId === s.id && students.some((m) => m.userId === a.studentUserId)).length;
    w.possible += students.filter((m) => s.date >= m.joinedAt.slice(0, 10)).length;
    weeks.set(k, w);
  }

  return {
    totalMembers: members.length,
    students: students.length,
    activeMembers: active,
    sessions: sessions.length,
    attendanceRate: possible ? Math.round((attended / possible) * 100) : null,
    participationRate: attended ? Math.round((completed / attended) * 100) : null,
    learningCompletionRate: learnedSum ? Math.round((profSum / learnedSum) * 100) : null,
    sharedCount: shared.length,
    inactive: studentStats.filter((s) => s.inactiveDays === null || s.inactiveDays >= INACTIVE_DAYS).sort((a, b) => (b.inactiveDays ?? 9999) - (a.inactiveDays ?? 9999)),
    members: stats,
    weeklyAttendance: [...weeks.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([week, v]) => ({ week, ...v })),
  };
}

export const statusLabel = (s: MasteryStatus) => MASTERY_LABEL[s];
