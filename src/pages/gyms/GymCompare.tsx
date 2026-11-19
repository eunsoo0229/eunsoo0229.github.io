import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate } from '../../lib/ecosystem/common';
import { buildComparison, getGymListing, getPricingMany, type GymListing, type GymPricing } from '../../lib/gymDirectory/service';
import { GymPage, NotConfigured, UUID_RE } from './gymShared';

// 가격 비교 — 값이 없으면 "정보 없음", 총비용은 구성 요소를 모두 알 때만 계산한다(추정 없음).
export default function GymCompare() {
  const { isConfigured } = useAuth();
  const [params] = useSearchParams();
  const idsParam = params.get('ids') ?? '';
  const ids = useMemo(
    () =>
      [...new Set(idsParam.split(',').map((s) => s.trim()).filter((s) => UUID_RE.test(s)))].slice(0, 4),
    [idsParam],
  );
  const [rows, setRows] = useState<{ listing: GymListing; pricing: GymPricing | null }[] | null>(null);
  const [missing, setMissing] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    if (!isConfigured || ids.length === 0) return;
    let cancelled = false;
    setRows(null);
    setError(null);
    (async () => {
      const results = await Promise.all(ids.map((id) => getGymListing(id)));
      if (cancelled) return;
      const failed = results.find((r) => !r.ok);
      if (failed && !failed.ok) {
        setError(failed.message);
        return;
      }
      const listings = results.flatMap((r) => (r.ok && r.data ? [r.data] : []));
      const pricing = await getPricingMany(listings.map((l) => l.id));
      if (cancelled) return;
      setMissing(ids.length - listings.length);
      setRows(listings.map((l) => ({ listing: l, pricing: pricing.get(l.id) ?? null })));
    })();
    return () => {
      cancelled = true;
    };
  }, [ids, isConfigured, reloadKey]);

  const table = useMemo(() => (rows ? buildComparison(rows) : []), [rows]);

  if (!isConfigured) return <NotConfigured />;

  return (
    <GymPage>
      <div className="breadcrumb">
        <Link to="/gyms">체육관 검색</Link>
        <span>/</span>
        <span>가격 비교</span>
      </div>
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">가격 비교</div>
          <h2>체육관 가격 비교</h2>
          <p>체육관이 직접 입력한 가격을 나란히 보여 줍니다. 초록색 값이 비교 가능한 항목 중 가장 낮은 금액입니다.</p>
        </div>
      </div>

      {ids.length < 2 ? (
        <>
          <EmptyState icon="🔍" text="비교할 체육관을 2곳 이상 골라 주세요. 체육관 검색 화면에서 '비교에 추가'를 누르면 됩니다." />
          <div className="eco-row">
            <Link className="btn btn-primary btn-sm" to="/gyms">
              체육관 검색으로
            </Link>
          </div>
        </>
      ) : error ? (
        <ErrorState text={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !rows ? (
        <LoadingState text="가격 정보를 불러오는 중..." />
      ) : rows.length === 0 ? (
        <EmptyState icon="🏛" text="선택한 체육관을 찾을 수 없습니다. 공개가 중단되었을 수 있습니다." />
      ) : (
        <>
          {missing > 0 && <div className="eco-notice">선택한 체육관 중 {missing}곳은 찾을 수 없어 비교에서 제외했습니다.</div>}
          <div className="eco-table-wrap">
            <table className="eco-table gym-compare-table">
              <thead>
                <tr>
                  <th scope="col">항목</th>
                  {rows.map((r) => (
                    <th key={r.listing.id} scope="col">
                      <Link to={`/gyms/${r.listing.id}`}>{r.listing.name}</Link>
                      <div className="eco-meta--faint">{r.listing.region}</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {table.map((row) => (
                  <tr key={row.key}>
                    <th scope="row">{row.label}</th>
                    {row.values.map((v, i) => (
                      <td key={i} className={v === null ? 'eco-missing' : row.best === i ? 'eco-best' : undefined}>
                        {v ?? '정보 없음'}
                      </td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row">최종 확인일</th>
                  {rows.map((r) => (
                    <td key={r.listing.id} className={r.pricing ? undefined : 'eco-missing'}>
                      {r.pricing ? formatDate(r.pricing.ownerConfirmedAt) : '정보 없음'}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row">플랫폼 가격 검증</th>
                  {rows.map((r) => (
                    <td key={r.listing.id}>
                      {!r.pricing ? (
                        <span className="eco-pill eco-pill--muted">가격 미등록</span>
                      ) : r.pricing.verifiedAt ? (
                        <span className="eco-pill eco-pill--good">검증 완료 ({formatDate(r.pricing.verifiedAt)})</span>
                      ) : (
                        <span className="eco-pill eco-pill--warn">미검증</span>
                      )}
                    </td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
          <div className="eco-notice">
            <ul>
              <li>첫 1년 총비용은 연간 요금·입회비·등록비·장비 비용을 모두 알 때만 계산합니다. 하나라도 없으면 추정하지 않고 "정보 없음"으로 둡니다.</li>
              <li>1회 수업당 금액은 월 회비와 주당 수업 횟수가 모두 있을 때만 계산합니다(한 달 약 4.3주 기준).</li>
              <li>최저 금액 표시는 값이 있는 체육관이 2곳 이상일 때만 붙습니다. 등록 전 체육관에 최종 금액을 꼭 확인해 주세요.</li>
            </ul>
          </div>
        </>
      )}
    </GymPage>
  );
}
