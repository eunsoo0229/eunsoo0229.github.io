import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatWon } from '../../lib/ecosystem/common';
import { GYM_ARTS, searchGyms, type GymArt, type GymSearch, type GymSearchRow } from '../../lib/gymDirectory/service';
import { ArtPills, GymPage, NotConfigured, PricingVerifiedPill } from './gymShared';

const MAX_COMPARE = 4;

// 체육관 검색 — 플랫폼이 승인한 체육관만 보인다. 샘플·예시 체육관은 넣지 않는다.
export default function GymDirectory() {
  const navigate = useNavigate();
  const { isConfigured } = useAuth();
  const [q, setQ] = useState('');
  const [art, setArt] = useState<GymArt | ''>('');
  const [region, setRegion] = useState('');
  const [partnerOnly, setPartnerOnly] = useState(false);
  const [trialOnly, setTrialOnly] = useState(false);
  const [openMatOnly, setOpenMatOnly] = useState(false);
  const [maxMonthly, setMaxMonthly] = useState('');
  const [sort, setSort] = useState<NonNullable<GymSearch['sort']>>('name');
  const [rows, setRows] = useState<GymSearchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string[]>([]);
  const [reloadKey, setReloadKey] = useState(0);

  const search: GymSearch = useMemo(() => {
    const max = maxMonthly.trim() === '' ? null : Number(maxMonthly);
    return { q, art, region, partnerOnly, trialOnly, openMatOnly, maxMonthly: max !== null && Number.isFinite(max) && max >= 0 ? max : null, sort };
  }, [q, art, region, partnerOnly, trialOnly, openMatOnly, maxMonthly, sort]);

  const filtersActive = !!(q.trim() || art || region.trim() || partnerOnly || trialOnly || openMatOnly || search.maxMonthly !== null);

  useEffect(() => {
    if (!isConfigured) return;
    let cancelled = false;
    setLoading(true);
    const t = window.setTimeout(async () => {
      const r = await searchGyms(search);
      if (cancelled) return;
      setLoading(false);
      if (r.ok) {
        setRows(r.data);
        setError(null);
      } else setError(r.message);
    }, 300);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [search, isConfigured, reloadKey]);

  if (!isConfigured) return <NotConfigured back="/" />;

  function toggleCompare(id: string) {
    setSelected((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : prev.length >= MAX_COMPARE ? prev : [...prev, id]));
  }

  return (
    <GymPage back="/">
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">체육관 찾기</div>
          <h2>체육관 검색 · 가격 비교</h2>
          <p>플랫폼 승인을 받은 체육관만 보입니다. 가격은 체육관이 직접 입력한 값이며, 플랫폼 검증 여부를 함께 표시합니다.</p>
        </div>
        <div className="eco-row">
          <Link className="btn btn-secondary btn-sm" to="/gyms/deals">
            <Icon name="tag" /> 제휴 할인
          </Link>
          <Link className="btn btn-secondary btn-sm" to="/gyms/coupons">
            <Icon name="card" /> 내 쿠폰
          </Link>
          <Link className="btn btn-ghost btn-sm" to="/gyms/manage">
            <Icon name="building" /> 체육관 등록·제휴 신청
          </Link>
        </div>
      </div>

      <div className="eco-filters">
        <input
          data-testid="gym-search"
          type="search"
          placeholder="체육관 이름·소개 검색"
          aria-label="체육관 검색"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select aria-label="종목" value={art} onChange={(e) => setArt(e.target.value as GymArt | '')}>
          <option value="">전체 종목</option>
          {(Object.keys(GYM_ARTS) as GymArt[]).map((k) => (
            <option key={k} value={k}>
              {GYM_ARTS[k]}
            </option>
          ))}
        </select>
        <input type="text" placeholder="지역 (예: 강남구)" aria-label="지역" value={region} onChange={(e) => setRegion(e.target.value)} />
        <input
          type="number"
          inputMode="numeric"
          min={0}
          step={10000}
          placeholder="월 회비 상한 (원)"
          aria-label="월 회비 상한"
          value={maxMonthly}
          onChange={(e) => setMaxMonthly(e.target.value)}
        />
        <select aria-label="정렬" value={sort} onChange={(e) => setSort(e.target.value as NonNullable<GymSearch['sort']>)}>
          <option value="name">이름순</option>
          <option value="monthly_asc">월 회비 낮은 순</option>
          <option value="latest">최근 등록순</option>
        </select>
      </div>
      <div className="gym-filter-checks">
        <label>
          <input type="checkbox" checked={partnerOnly} onChange={(e) => setPartnerOnly(e.target.checked)} /> 제휴만
        </label>
        <label>
          <input type="checkbox" checked={trialOnly} onChange={(e) => setTrialOnly(e.target.checked)} /> 체험 가능
        </label>
        <label>
          <input type="checkbox" checked={openMatOnly} onChange={(e) => setOpenMatOnly(e.target.checked)} /> 자유 연습
        </label>
      </div>
      {search.maxMonthly !== null && <p className="eco-meta">월 회비 상한을 정하면 월 회비 정보가 없는 체육관은 제외됩니다.</p>}

      {selected.length > 0 && (
        <div className="eco-notice eco-notice--accent eco-row eco-row--between">
          <span>
            비교할 체육관 {selected.length}/{MAX_COMPARE}곳 선택됨{selected.length < 2 ? ' · 2곳 이상 고르면 비교할 수 있습니다' : ''}
          </span>
          <span className="eco-row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSelected([])}>
              선택 해제
            </button>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              data-testid="gym-compare-go"
              disabled={selected.length < 2}
              onClick={() => navigate(`/gyms/compare?ids=${selected.map(encodeURIComponent).join(',')}`)}
            >
              가격 비교하기
            </button>
          </span>
        </div>
      )}

      {loading && rows === null ? (
        <LoadingState text="체육관을 불러오는 중..." />
      ) : error ? (
        <ErrorState text={error} onRetry={() => setReloadKey((k) => k + 1)} />
      ) : !rows || rows.length === 0 ? (
        filtersActive ? (
          <EmptyState icon="🔍" text="조건에 맞는 체육관이 없습니다. 필터를 줄여 보세요." />
        ) : (
          <EmptyState
            icon="🏛"
            text="아직 공개된 체육관이 없습니다. 체육관이 직접 등록하고 플랫폼이 검토·승인한 뒤에만 이곳에 표시됩니다."
          />
        )
      ) : (
        <>
          <p className="eco-meta" style={{ marginBottom: 8 }}>
            {rows.length}곳{loading ? ' · 갱신 중...' : ''}
          </p>
          <div className="eco-grid">
            {rows.map((row) => {
              const l = row.listing;
              const checked = selected.includes(l.id);
              return (
                <div key={l.id} className="eco-card" data-testid="gym-card">
                  <Link to={`/gyms/${l.id}`} className="eco-card__media" aria-label={`${l.name} 상세`}>
                    {l.coverImageUrl ? <img src={l.coverImageUrl} alt="" loading="lazy" /> : <Icon name="building" />}
                  </Link>
                  <div className="eco-row eco-row--between">
                    <h3 style={{ margin: 0 }}>
                      <Link to={`/gyms/${l.id}`}>{l.name}</Link>
                    </h3>
                    {row.isPartner && <span className="eco-pill eco-pill--accent">제휴</span>}
                  </div>
                  <p className="eco-meta">
                    <Icon name="pin" /> {l.region}
                  </p>
                  <div className="eco-row" style={{ margin: '6px 0' }}>
                    <ArtPills arts={l.arts} />
                  </div>
                  <div className="eco-row eco-row--between">
                    {row.pricing?.monthly != null ? (
                      <span>
                        <span className="eco-meta">월 회비 </span>
                        <span className="eco-price">{formatWon(row.pricing.monthly)}</span>
                      </span>
                    ) : (
                      <span className="eco-meta">가격 정보 없음</span>
                    )}
                    <PricingVerifiedPill pricing={row.pricing} />
                  </div>
                  <p className="eco-meta" style={{ marginTop: 6 }}>
                    {row.rating.count > 0 && row.rating.avg !== null ? (
                      <>
                        <Icon name="star-filled" /> {row.rating.avg.toFixed(1)} · 후기 {row.rating.count}개
                      </>
                    ) : (
                      '후기 없음'
                    )}
                  </p>
                  <label className="eco-row eco-meta" style={{ marginTop: 8, cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={!checked && selected.length >= MAX_COMPARE}
                      onChange={() => toggleCompare(l.id)}
                    />
                    비교에 추가{!checked && selected.length >= MAX_COMPARE ? ` (최대 ${MAX_COMPARE}곳)` : ''}
                  </label>
                </div>
              );
            })}
          </div>
        </>
      )}
    </GymPage>
  );
}
