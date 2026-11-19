import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { CoinAmount, MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { formatDate } from '../../lib/ecosystem/common';
import { resolveTechnique } from '../../lib/userTechniques/service';
import {
  DIFFICULTY_LABEL,
  PRODUCT_STATUS_LABEL,
  PRODUCT_TYPE_LABEL,
  REPORT_REASON_LABEL,
  addReview,
  getCreatorProfile,
  getMyPurchaseOf,
  getMyWallet,
  getProduct,
  getProductContent,
  listReviews,
  purchaseProduct,
  reportContent,
  requestContentRefund,
  type ContentPurchase,
  type CreatorProduct,
  type CreatorProfile,
  type ProductContent,
  type ProductReview,
  type ReportReason,
} from '../../lib/monetization/service';
import { notifyMembershipChanged, useMembership } from '../../lib/monetization/useMembership';
import { artName } from './ContentMarket';

export function ContentBody({ body }: { body: ProductContent }) {
  return (
    <div className="mono-content" data-testid="product-full-content">
      {(body.sections ?? []).map((s, i) => (
        <section key={i} className="eco-card eco-stack">
          <h4>{i + 1}. {s.title}</h4>
          <p style={{ whiteSpace: 'pre-wrap' }}>{s.text}</p>
          {s.video_url && /^https:\/\//.test(s.video_url) && (
            <a href={s.video_url} target="_blank" rel="noopener noreferrer" className="btn btn-ghost btn-sm"><Icon name="video" /> 영상 보기</a>
          )}
          {!!s.technique_ids?.length && (
            <div className="eco-row">
              {s.technique_ids.map((id) => {
                const t = resolveTechnique(id);
                return t ? (
                  <Link key={id} className="eco-pill" to={`/arts/${t.martialArt}/techniques/${t.id}`}>{t.koreanName ?? t.name}</Link>
                ) : null;
              })}
            </div>
          )}
        </section>
      ))}
      {(body.files ?? []).filter((f) => /^https:\/\//.test(f.url)).map((f) => (
        <a key={f.url} className="btn btn-secondary btn-sm" href={f.url} target="_blank" rel="noopener noreferrer"><Icon name="file" /> {f.name}</a>
      ))}
      {!body.sections?.length && !body.files?.length && <EmptyState icon="📄" text="본문이 비어 있습니다." />}
    </div>
  );
}

export default function ContentDetail() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const { membership } = useMembership();
  const [p, setP] = useState<CreatorProduct | null | undefined>(undefined);
  const [creator, setCreator] = useState<CreatorProfile | null>(null);
  const [content, setContent] = useState<ProductContent | null>(null);
  const [purchase, setPurchase] = useState<ContentPurchase | null>(null);
  const [reviews, setReviews] = useState<ProductReview[]>([]);
  const [balance, setBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(5);
  const [reviewText, setReviewText] = useState('');
  const [reportReason, setReportReason] = useState<ReportReason | ''>('');
  const [reportDetail, setReportDetail] = useState('');

  async function load() {
    const r = await getProduct(id);
    if (!r.ok) return setError(r.message);
    setP(r.data);
    if (!r.data) return;
    const [c, rv] = await Promise.all([getCreatorProfile(r.data.creator_id), listReviews(id)]);
    setCreator(c.ok ? c.data : null);
    setReviews(rv.ok ? rv.data : []);
    if (user) {
      // 열람 권한은 서버(RLS)가 판정한다: 본문 행이 오면 볼 수 있는 것
      const [ct, pu, w] = await Promise.all([getProductContent(id), getMyPurchaseOf(id, user.id), getMyWallet(user.id)]);
      setContent(ct.ok && ct.data ? ct.data.body : null);
      setPurchase(pu.ok ? pu.data : null);
      setBalance(w.ok ? w.data?.balance ?? 0 : null);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, user?.id]);

  async function buy() {
    if (!p) return;
    setBusy(true);
    setError(null);
    const r = await purchaseProduct(p.id);
    setBusy(false);
    if (!r.ok) return setError(r.message);
    setNotice(r.data.privileged_comp ? '운영자·개발자 계정으로 라이브러리에 추가했습니다. (코인 차감 없음)' : '구매가 완료되어 내 라이브러리에 추가되었습니다.');
    notifyMembershipChanged();
    void load();
  }

  async function submitReview() {
    if (!user || !p) return;
    const r = await addReview(p.id, user.id, rating, reviewText.trim());
    if (!r.ok) return setError(r.message.includes('권한') ? '구매한 사람만 후기를 남길 수 있고, 후기는 한 번만 쓸 수 있습니다.' : r.message);
    setReviewText('');
    void load();
  }

  async function submitReport() {
    if (!user || !p || !reportReason) return;
    const r = await reportContent(reportReason === 'false_credentials' ? { productId: p.id, creatorId: p.creator_id } : { productId: p.id }, user.id, reportReason, reportDetail.trim());
    if (!r.ok) return setError(r.message);
    setReportReason('');
    setReportDetail('');
    setNotice('신고가 접수되었습니다. 운영자가 검토합니다.');
  }

  async function askRefund() {
    if (!purchase) return;
    const reason = window.prompt('환불 사유를 입력해 주세요.');
    if (!reason) return;
    const r = await requestContentRefund(purchase.id, reason);
    if (!r.ok) return setError(r.message);
    setNotice('환불 요청이 접수되었습니다. 운영자 승인 후 코인이 돌아옵니다.');
    void load();
  }

  if (p === undefined && !error) return <MonoPage kicker="CONTENT" title="콘텐츠" fallback="/content"><LoadingState /></MonoPage>;
  if (!p) return <MonoPage kicker="CONTENT" title="콘텐츠" fallback="/content"><EmptyState icon="🔍" text="찾을 수 없거나 판매 중이 아닌 콘텐츠입니다." />{error && <ErrorState text={error} />}</MonoPage>;

  const own = user?.id === p.creator_id;
  const owned = !!purchase && purchase.status === 'completed';
  const proAccess = !owned && !!content && p.pro_included && !own;
  return (
    <MonoPage kicker={PRODUCT_TYPE_LABEL[p.product_type]} title={p.title} fallback="/content" lede={p.summary}>
      {error && <p className="gear-error" role="alert" data-testid="content-error">{error}</p>}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="content-notice">{notice}</p>}
      {p.status !== 'approved' && <p className="eco-notice">상태: {PRODUCT_STATUS_LABEL[p.status]}{p.status === 'unlisted' ? ' — 새 판매는 중지됐지만 구매자는 계속 열람할 수 있습니다.' : ''}</p>}

      <div className="mono-detail">
        <div className="eco-stack">
          <section className="eco-card eco-stack">
            <div className="eco-meta">{artName(p.martial_art)} · {DIFFICULTY_LABEL[p.difficulty]}{p.est_minutes ? ` · 예상 ${p.est_minutes}분` : ''} · v{p.version}</div>
            {p.target_audience && <div><strong>학습 대상</strong> <span className="eco-meta">{p.target_audience}</span></div>}
            <p style={{ whiteSpace: 'pre-wrap' }}>{p.description}</p>
            {p.outline.length > 0 && (
              <>
                <strong>구성</strong>
                <ol className="mono-outline">{p.outline.map((o, i) => <li key={i}>{o}</li>)}</ol>
              </>
            )}
          </section>

          {content ? (
            <section className="eco-stack">
              <h3><Icon name="book" /> 전체 콘텐츠 {proAccess && <span className="eco-pill eco-pill--accent">PRO 포함</span>}</h3>
              <ContentBody body={content} />
            </section>
          ) : (
            <section className="eco-card eco-stack" data-testid="product-preview">
              <h3>무료 미리보기</h3>
              <p style={{ whiteSpace: 'pre-wrap' }}>{p.preview?.text || '미리보기가 없습니다.'}</p>
              <p className="eco-meta--faint"><Icon name="lock" /> 전체 내용은 구매 후 열람할 수 있습니다{p.pro_included ? ' (PRO 구독자는 구매 없이 열람)' : ''}.</p>
            </section>
          )}

          <section className="eco-stack">
            <h3>구매자 후기 {p.rating_count > 0 && `★ ${Number(p.rating_avg).toFixed(1)} (${p.rating_count})`}</h3>
            {owned && (
              <div className="eco-card eco-form" data-testid="review-form">
                <label>평점
                  <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>{[5, 4, 3, 2, 1].map((n) => <option key={n} value={n}>{'★'.repeat(n)}</option>)}</select>
                </label>
                <label>후기<textarea value={reviewText} maxLength={2000} onChange={(e) => setReviewText(e.target.value)} /></label>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => void submitReview()}>후기 등록</button>
              </div>
            )}
            {reviews.length === 0 ? <p className="eco-meta">아직 후기가 없습니다.</p> : reviews.map((r) => (
              <div key={r.user_id} className="eco-card">
                <strong>{'★'.repeat(r.rating)}</strong> <span className="eco-meta">{formatDate(r.created_at)}</span>
                {r.body && <p>{r.body}</p>}
              </div>
            ))}
          </section>
        </div>

        <aside className="eco-stack">
          <section className="eco-card eco-stack" data-testid="purchase-box">
            {p.price_coins > 0 ? <CoinAmount value={p.price_coins} size="lg" /> : <strong>무료</strong>}
            {own ? (
              <Link className="btn btn-secondary" to={`/creator/products/${p.id}`}>내 콘텐츠 편집</Link>
            ) : owned ? (
              <>
                <span className="eco-pill eco-pill--good" data-testid="owned-badge">구매 완료</span>
                {purchase && !purchase.privileged_comp && purchase.price_coins > 0 && purchase.refund_status === 'none' && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => void askRefund()} data-testid="refund-request">환불 요청</button>
                )}
                {purchase?.refund_status === 'requested' && <span className="eco-meta">환불 검토 중</span>}
              </>
            ) : p.status === 'approved' ? (
              user ? (
                <>
                  <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void buy()} data-testid="buy-product">
                    {busy ? '구매 중…' : membership?.privileged ? '라이브러리에 추가 (무제한 계정)' : p.price_coins > 0 ? `${p.price_coins.toLocaleString('ko-KR')} MC 로 구매` : '무료로 받기'}
                  </button>
                  {!membership?.privileged && balance !== null && p.price_coins > balance && (
                    <p className="eco-meta">보유 {balance.toLocaleString('ko-KR')} MC · <Link to="/wallet/store">코인 충전</Link></p>
                  )}
                </>
              ) : (
                <Link className="btn btn-primary" to="/login">로그인 후 구매</Link>
              )
            ) : null}
            <p className="eco-meta--faint">환불 정책: 구매 후 {7}일 이내 요청 가능, 운영자 승인 후 코인으로 반환되며 열람 권한이 해제됩니다. 저작권 침해로 판매 중지된 상품은 구매자 전원에게 환불됩니다.</p>
          </section>

          {creator && (
            <section className="eco-card eco-stack" data-testid="creator-box">
              <strong>{creator.display_name}</strong>
              <span className="eco-meta">{creator.specialties.join(' · ')}{creator.years_training != null ? ` · 수련 ${creator.years_training}년 (본인 입력)` : ''}</span>
              {creator.bio && <p className="eco-meta">{creator.bio}</p>}
              {creator.verified_credentials.length > 0 && (
                <div>
                  <span className="eco-kicker">운영자 검증</span>
                  {creator.verified_credentials.map((c, i) => <div key={i}><Icon name="verified" /> {c.title}{c.issuer ? ` · ${c.issuer}` : ''}</div>)}
                </div>
              )}
              {creator.credentials.length > 0 && (
                <div>
                  <span className="eco-kicker">본인 입력 (미검증)</span>
                  {creator.credentials.map((c, i) => <div key={i} className="eco-meta">{c.title}{c.issuer ? ` · ${c.issuer}` : ''}{c.year ? ` · ${c.year}` : ''}</div>)}
                </div>
              )}
            </section>
          )}

          {user && !own && (
            <details className="eco-card">
              <summary>신고하기</summary>
              <div className="eco-form">
                <select value={reportReason} onChange={(e) => setReportReason(e.target.value as ReportReason)} aria-label="신고 사유">
                  <option value="">사유 선택</option>
                  {(Object.keys(REPORT_REASON_LABEL) as ReportReason[]).map((r) => <option key={r} value={r}>{REPORT_REASON_LABEL[r]}</option>)}
                </select>
                <textarea value={reportDetail} maxLength={2000} onChange={(e) => setReportDetail(e.target.value)} placeholder="내용 (원본 링크 등)" />
                <button type="button" className="btn btn-ghost btn-sm" disabled={!reportReason} onClick={() => void submitReport()}>신고 접수</button>
              </div>
            </details>
          )}
        </aside>
      </div>
    </MonoPage>
  );
}
