// /gear — 격투기 장비 중고거래 목록 (검색 + 필터 + 정렬)
import { PartnerSlot } from '../../components/monetization/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import Icon from '../../components/Icon';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../lib/auth/AuthProvider';
import {
  GEAR_ARTS,
  GEAR_CATEGORIES,
  GEAR_CONDITIONS,
  searchGear,
  type GearCategory,
  type GearCondition,
  type GearFilters,
  type GearListing,
} from '../../lib/gear/service';
import { GearCard, NotConfigured } from './gearShared';

type Sort = NonNullable<GearFilters['sort']>;

const toPrice = (s: string): number | null => {
  const n = Number(s.replace(/[^\d]/g, ''));
  return s.trim() === '' || !Number.isFinite(n) ? null : Math.floor(n);
};

export default function GearMarket() {
  const { user, isConfigured } = useAuth();
  const [q, setQ] = useState('');
  const [debouncedText, setDebouncedText] = useState({ q: '', brand: '', size: '', region: '', min: '', max: '' });
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [region, setRegion] = useState('');
  const [minPrice, setMinPrice] = useState('');
  const [maxPrice, setMaxPrice] = useState('');
  const [category, setCategory] = useState<GearCategory | ''>('');
  const [martialArt, setMartialArt] = useState('');
  const [condition, setCondition] = useState<GearCondition | ''>('');
  const [includeSold, setIncludeSold] = useState(false);
  const [sort, setSort] = useState<Sort>('latest');
  const [showFilters, setShowFilters] = useState(false);

  const [items, setItems] = useState<GearListing[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const reqId = useRef(0);

  // 텍스트 입력은 300ms 디바운스
  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedText({ q, brand, size, region, min: minPrice, max: maxPrice }), 300);
    return () => window.clearTimeout(t);
  }, [q, brand, size, region, minPrice, maxPrice]);

  const load = useCallback(async () => {
    if (!isConfigured) return;
    const id = ++reqId.current;
    setLoading(true);
    setError(null);
    const r = await searchGear({
      q: debouncedText.q,
      brand: debouncedText.brand,
      size: debouncedText.size,
      region: debouncedText.region,
      minPrice: toPrice(debouncedText.min),
      maxPrice: toPrice(debouncedText.max),
      category,
      martialArt,
      condition,
      includeSold,
      sort,
    });
    if (id !== reqId.current) return; // 늦게 도착한 이전 응답 무시
    setLoading(false);
    if (r.ok) setItems(r.data);
    else setError(r.message);
  }, [isConfigured, debouncedText, category, martialArt, condition, includeSold, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!isConfigured) return <NotConfigured />;

  const activeFilterCount =
    [category, martialArt, condition, brand.trim(), size.trim(), region.trim(), minPrice.trim(), maxPrice.trim()].filter(Boolean).length + (includeSold ? 1 : 0);

  function resetFilters() {
    setCategory('');
    setMartialArt('');
    setCondition('');
    setBrand('');
    setSize('');
    setRegion('');
    setMinPrice('');
    setMaxPrice('');
    setIncludeSold(false);
  }

  return (
    <div className="page gear-page">
      <div className="container">
        <BackButton fallback="/" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">장비 거래</div>
            <h2>
              <Icon name="cart" /> 격투기 장비 중고거래
            </h2>
            <p>글러브·도복·보호대를 사고팔 수 있습니다. 결제는 MARTIALDEX 밖에서 당사자끼리 진행합니다.</p>
          </div>
          <div className="eco-row">
            {user && (
              <Link className="btn btn-secondary btn-sm" to="/gear/mine">
                <Icon name="user" /> 내 거래
              </Link>
            )}
            <Link className="btn btn-primary btn-sm" to={user ? '/gear/new' : '/login'}>
              <Icon name="plus" /> 판매하기
            </Link>
          </div>
        </div>

        <div className="gear-searchbar">
          <label className="gear-searchbar__field">
            <Icon name="search" />
            <input
              type="search"
              data-testid="gear-search"
              placeholder="상품명, 브랜드, 설명 검색"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              aria-label="장비 검색"
            />
          </label>
          <select className="gear-sort" value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label="정렬">
            <option value="latest">최신순</option>
            <option value="price_asc">가격 낮은 순</option>
            <option value="price_desc">가격 높은 순</option>
          </select>
          <button type="button" className="btn btn-secondary btn-sm" aria-expanded={showFilters} onClick={() => setShowFilters((v) => !v)}>
            <Icon name="filter" /> 필터{activeFilterCount ? ` ${activeFilterCount}` : ''}
          </button>
        </div>

        <PartnerSlot placement="gear" />
        {showFilters && (
          <div className="gear-filter-panel">
            <div className="eco-filters">
              <select value={martialArt} onChange={(e) => setMartialArt(e.target.value)} aria-label="종목">
                <option value="">종목 전체</option>
                {GEAR_ARTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value as GearCategory | '')} aria-label="상품 종류">
                <option value="">상품 종류 전체</option>
                {(Object.keys(GEAR_CATEGORIES) as GearCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {GEAR_CATEGORIES[k]}
                  </option>
                ))}
              </select>
              <select value={condition} onChange={(e) => setCondition(e.target.value as GearCondition | '')} aria-label="상태">
                <option value="">상태 전체</option>
                {(Object.keys(GEAR_CONDITIONS) as GearCondition[]).map((k) => (
                  <option key={k} value={k}>
                    {GEAR_CONDITIONS[k].label}
                  </option>
                ))}
              </select>
              <input value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="브랜드" aria-label="브랜드" />
              <input value={size} onChange={(e) => setSize(e.target.value)} placeholder="사이즈 (예: 12oz, A2)" aria-label="사이즈" />
              <input value={region} onChange={(e) => setRegion(e.target.value)} placeholder="지역 (예: 마포구)" aria-label="지역" />
              <input inputMode="numeric" value={minPrice} onChange={(e) => setMinPrice(e.target.value)} placeholder="최소 가격(원)" aria-label="최소 가격" />
              <input inputMode="numeric" value={maxPrice} onChange={(e) => setMaxPrice(e.target.value)} placeholder="최대 가격(원)" aria-label="최대 가격" />
            </div>
            <div className="eco-row eco-row--between">
              <label className="eco-row eco-meta gear-inline-check">
                <input type="checkbox" checked={includeSold} onChange={(e) => setIncludeSold(e.target.checked)} /> 판매 완료 포함
              </label>
              <button type="button" className="btn btn-ghost btn-sm" onClick={resetFilters} disabled={!activeFilterCount}>
                필터 초기화
              </button>
            </div>
          </div>
        )}

        {loading && items.length === 0 ? (
          <LoadingState />
        ) : error ? (
          <ErrorState text={error} onRetry={() => void load()} />
        ) : items.length === 0 ? (
          <div>
            <EmptyState
              icon="🔍"
              text={q || activeFilterCount ? '조건에 맞는 상품이 없습니다. 검색어나 필터를 바꿔 보세요.' : '아직 등록된 상품이 없습니다. 첫 상품을 올려 보세요.'}
            />
            <div className="eco-row gear-center">
              <Link className="btn btn-primary btn-sm" to={user ? '/gear/new' : '/login'}>
                판매할 장비 올리기
              </Link>
            </div>
          </div>
        ) : (
          <>
            <p className="eco-meta" aria-live="polite">
              {loading ? '검색 중...' : `상품 ${items.length}개`}
            </p>
            <div className="eco-grid eco-grid--tight gear-grid">
              {items.map((it) => (
                <GearCard key={it.id} item={it} />
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
