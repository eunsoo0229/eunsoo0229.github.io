import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { CoinAmount, MonoPage, PartnerSlot } from '../../components/monetization/shared';
import { getUnifiedMartialArtSummaries } from '../../lib/userTechniques/service';
import { DIFFICULTY_LABEL, PRODUCT_TYPE_LABEL, listApprovedProducts, type CreatorProduct, type ProductType } from '../../lib/monetization/service';

export function artName(id: string | null): string {
  if (!id) return '전 종목';
  return getUnifiedMartialArtSummaries().find((a) => a.id === id)?.nameKo ?? id;
}

export function ProductCard({ p }: { p: CreatorProduct }) {
  return (
    <Link to={`/content/${p.id}`} className="mono-product" data-testid={`product-${p.id}`}>
      <div className="mono-product__thumb" style={p.thumbnail_url ? { backgroundImage: `url(${p.thumbnail_url})` } : undefined}>
        <span className="eco-pill eco-pill--muted">{PRODUCT_TYPE_LABEL[p.product_type]}</span>
        {p.pro_included && <span className="eco-pill eco-pill--accent">PRO 포함</span>}
      </div>
      <div className="mono-product__body">
        <strong>{p.title}</strong>
        <span className="eco-meta">{artName(p.martial_art)} · {DIFFICULTY_LABEL[p.difficulty]}{p.est_minutes ? ` · ${p.est_minutes}분` : ''}</span>
        <div className="eco-row eco-row--between">
          {p.price_coins > 0 ? <CoinAmount value={p.price_coins} /> : <span className="eco-pill eco-pill--good">무료</span>}
          <span className="eco-meta">{p.rating_count > 0 ? `★ ${Number(p.rating_avg).toFixed(1)} (${p.rating_count})` : '후기 없음'} · 판매 {p.sales_count}</span>
        </div>
      </div>
    </Link>
  );
}

export default function ContentMarket() {
  const [items, setItems] = useState<CreatorProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [type, setType] = useState('');
  const [art, setArt] = useState('');
  const [q, setQ] = useState('');
  const arts = getUnifiedMartialArtSummaries();

  async function load() {
    setItems(null);
    const r = await listApprovedProducts({ type: type || undefined, art: art || undefined, q: q.trim() || undefined });
    if (r.ok) setItems(r.data);
    else setError(r.message);
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, art]);

  return (
    <MonoPage
      kicker="DIGITAL MARKET"
      title="디지털 콘텐츠 마켓"
      icon="book"
      lede="지도자와 창작자가 만든 커리큘럼·강의·훈련 자료. 모든 상품은 판매 전 검수를 거칩니다."
      actions={
        <>
          <Link className="btn btn-secondary btn-sm" to="/library">내 라이브러리</Link>
          <Link className="btn btn-ghost btn-sm" to="/creator">크리에이터 스튜디오</Link>
          <Link className="btn btn-ghost btn-sm" to="/marketplace">원화 커리큘럼 마켓</Link>
        </>
      }
    >
      <form className="eco-filters" onSubmit={(e) => { e.preventDefault(); void load(); }}>
        <select value={type} onChange={(e) => setType(e.target.value)} aria-label="상품 유형">
          <option value="">모든 유형</option>
          {(Object.keys(PRODUCT_TYPE_LABEL) as ProductType[]).map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
        </select>
        <select value={art} onChange={(e) => setArt(e.target.value)} aria-label="무술">
          <option value="">모든 무술</option>
          {arts.map((a) => <option key={a.id} value={a.id}>{a.nameKo}</option>)}
        </select>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="제목 검색" aria-label="제목 검색" />
        <button type="submit" className="btn btn-secondary btn-sm"><Icon name="search" /> 검색</button>
      </form>
      <PartnerSlot placement="content" />
      {error && <ErrorState text={error} onRetry={() => { setError(null); void load(); }} />}
      {!items ? (
        <LoadingState />
      ) : items.length === 0 ? (
        <EmptyState icon="📚" text="조건에 맞는 콘텐츠가 아직 없습니다." />
      ) : (
        <div className="mono-products" data-testid="product-grid">
          {items.map((p) => <ProductCard key={p.id} p={p} />)}
        </div>
      )}
    </MonoPage>
  );
}
