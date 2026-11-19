import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import LoadingState from '../../components/LoadingState';
import { MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate } from '../../lib/ecosystem/common';
import { PRODUCT_STATUS_LABEL, getProductsByIds, listMyLibrary, type ContentPurchase, type CreatorProduct } from '../../lib/monetization/service';
import { ProductCard } from './ContentMarket';

export default function Library() {
  const { user } = useAuth();
  const [rows, setRows] = useState<{ purchase: ContentPurchase; product: CreatorProduct | undefined }[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      const r = await listMyLibrary(user.id);
      if (!r.ok) return setError(r.message);
      const ps = await getProductsByIds([...new Set(r.data.map((x) => x.product_id))]);
      const byId = new Map((ps.ok ? ps.data : []).map((p) => [p.id, p]));
      setRows(r.data.map((purchase) => ({ purchase, product: byId.get(purchase.product_id) })));
    })();
  }, [user?.id]);

  if (!user) return <MonoPage kicker="LIBRARY" title="내 라이브러리" icon="book"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;
  const active = (rows ?? []).filter((r) => r.purchase.status === 'completed');
  const refunded = (rows ?? []).filter((r) => r.purchase.status === 'refunded');
  return (
    <MonoPage kicker="LIBRARY" title="내 라이브러리" icon="book" fallback="/content" lede="구매한 콘텐츠는 창작자가 수정하거나 판매를 중지해도 계속 열람할 수 있습니다." actions={<Link className="btn btn-ghost btn-sm" to="/content">마켓으로</Link>}>
      {error && <ErrorState text={error} />}
      {!rows ? (
        <LoadingState />
      ) : active.length === 0 ? (
        <EmptyState icon="📚" text="아직 구매한 콘텐츠가 없습니다." />
      ) : (
        <div className="mono-products" data-testid="library-grid">
          {active.map(({ purchase, product }) =>
            product ? (
              <div key={purchase.id} className="eco-stack">
                <ProductCard p={product} />
                <span className="eco-meta">
                  {formatDate(purchase.created_at)} 구매{purchase.privileged_comp ? ' · 무제한 계정' : ` · ${purchase.price_coins.toLocaleString('ko-KR')} MC`}
                  {product.status !== 'approved' && ` · ${PRODUCT_STATUS_LABEL[product.status]}`}
                  {purchase.refund_status === 'requested' && ' · 환불 검토 중'}
                </span>
              </div>
            ) : null,
          )}
        </div>
      )}
      {refunded.length > 0 && <p className="eco-meta--faint">환불된 구매 {refunded.length}건은 열람 권한이 해제되었습니다.</p>}
    </MonoPage>
  );
}
