// 체육관 운영 화면 공통 조각 — 지표 카드(값이 없으면 "데이터 없음" + 이유), 날짜 도우미.
import type { ReactNode } from 'react';
import type { Assignment, GymMemberRow } from '../../lib/gymClass/adminService';

export function MetricCard({ label, value, sub, why }: { label: string; value: string | number | null; sub?: ReactNode; why?: string }) {
  return (
    <div className="eco-metric">
      <div className="eco-metric__label">{label}</div>
      {value === null ? (
        <>
          <div className="eco-metric__value gadm-missing">데이터 없음</div>
          {why && <div className="gadm-why">{why}</div>}
        </>
      ) : (
        <>
          <div className="eco-metric__value">{value}</div>
          {sub && <div className="eco-metric__sub">{sub}</div>}
        </>
      )}
    </div>
  );
}

export const pct = (n: number | null) => (n === null ? null : `${n}%`);

export function ymd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function daysAgo(n: number, now = new Date()): string {
  return ymd(new Date(now.getTime() - n * 86400000));
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('ko-KR');
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString('ko-KR', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export const ROLE_LABEL: Record<GymMemberRow['role'], string> = { instructor: '지도자', student: '학생' };

export const STATUS_LABEL: Record<Assignment['status'], string> = { open: '진행 중', done: '완료', dismissed: '종료' };

export function statusPillClass(s: Assignment['status']): string {
  return s === 'done' ? 'eco-pill eco-pill--good' : s === 'open' ? 'eco-pill eco-pill--accent' : 'eco-pill eco-pill--muted';
}

export const POSE_METHOD_LABEL: Record<string, string> = {
  landmark: '자세 랜드마크 분석',
  video_compare: '참고 영상 비교',
  reference_3d: '3D 기준 동작 비교',
};
