import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate } from '../../lib/ecosystem/common';
import { listMyListings, type GymListing } from '../../lib/gymDirectory/service';
import { ArtPills, GymPage, LISTING_STATUS_LABEL, LISTING_STATUS_PILL, NotConfigured } from './gymShared';

// 체육관 관리자: 내가 등록한 체육관 목록 + 등록·제휴 절차 안내.
export default function GymManage() {
  const { user, isConfigured } = useAuth();
  const [rows, setRows] = useState<GymListing[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!user) return;
    setError(null);
    const r = await listMyListings(user.id);
    if (r.ok) setRows(r.data);
    else setError(r.message);
  }

  useEffect(() => {
    if (!isConfigured || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConfigured, user?.id]);

  if (!isConfigured) return <NotConfigured />;

  return (
    <GymPage>
      <div className="breadcrumb">
        <Link to="/gyms">체육관 검색</Link>
        <span>/</span>
        <span>체육관 관리</span>
      </div>
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">체육관 관리자</div>
          <h2>체육관 등록 · 제휴 신청</h2>
          <p>체육관 정보를 등록하면 플랫폼 검토 후 검색에 공개됩니다.</p>
        </div>
        {user && (
          <Link className="btn btn-primary btn-sm" to="/gyms/manage/new">
            <Icon name="plus" /> 새 체육관 등록
          </Link>
        )}
      </div>

      <div className="eco-notice eco-notice--accent">
        <strong>진행 순서</strong>
        <ul>
          <li>체육관 정보 등록 → 플랫폼이 검토한 뒤 승인되면 검색에 공개됩니다.</li>
          <li>가격 입력 → 플랫폼이 실제 가격을 확인하면 "가격 검증" 표시가 붙습니다. 가격을 바꾸면 검증이 다시 필요합니다.</li>
          <li>제휴 신청 → 플랫폼과 계약이 확인되면 할인 상품과 쿠폰을 진행할 수 있습니다.</li>
        </ul>
      </div>

      {!user ? (
        <>
          <EmptyState icon="🔒" text="체육관을 등록하거나 관리하려면 로그인이 필요합니다." />
          <div className="eco-row">
            <Link className="btn btn-primary" to="/login">
              로그인
            </Link>
          </div>
        </>
      ) : error ? (
        <ErrorState text={error} onRetry={() => void load()} />
      ) : !rows ? (
        <LoadingState text="내 체육관을 불러오는 중..." />
      ) : rows.length === 0 ? (
        <EmptyState icon="🏛" text="아직 등록한 체육관이 없습니다. '새 체육관 등록'으로 시작해 주세요." />
      ) : (
        <div className="eco-grid">
          {rows.map((l) => (
            <Link key={l.id} to={`/gyms/manage/${l.id}`} className="eco-card eco-card--link eco-stack">
              <div className="eco-row eco-row--between">
                <h3 style={{ margin: 0 }}>{l.name}</h3>
                <span className={LISTING_STATUS_PILL[l.status]}>{LISTING_STATUS_LABEL[l.status]}</span>
              </div>
              <div className="eco-meta">
                <Icon name="pin" /> {l.region}
              </div>
              <div className="eco-row">
                <ArtPills arts={l.arts} />
              </div>
              {(l.status === 'rejected' || l.status === 'suspended') && l.reviewNote && (
                <div className="eco-notice" style={{ margin: 0 }}>
                  플랫폼 메모: {l.reviewNote}
                </div>
              )}
              <div className="eco-meta--faint">
                등록 {formatDate(l.createdAt)}
                {l.reviewedAt ? ` · 검토 ${formatDate(l.reviewedAt)}` : ''}
              </div>
            </Link>
          ))}
        </div>
      )}
    </GymPage>
  );
}
