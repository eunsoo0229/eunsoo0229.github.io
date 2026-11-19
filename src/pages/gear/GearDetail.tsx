// /gear/:id — 장비 상세: 사진, 정보, 판매자·후기, 찜, 문의(DM), 신고·차단, 판매자 관리, 거래 후기
import { useCallback, useEffect, useState } from 'react';
import GearCheckout from '../../components/gear/GearCheckout';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../lib/auth/AuthProvider';
import ShareButton from '../../components/social/ShareButton';
import { blockUser } from '../../lib/social/profileService';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  GEAR_CATEGORIES,
  GEAR_CONDITIONS,
  GEAR_STATUS,
  SAFETY_TIPS,
  addFavorite,
  deleteGear,
  gearArtLabel,
  getGear,
  inquire,
  listFavoriteIds,
  listInquiries,
  listReviewsFor,
  myReviewFor,
  removeFavorite,
  reportGear,
  sellerRating,
  setGearStatus,
  writeReview,
  type GearInquiry,
  type GearListing,
  type GearReview,
  type GearStatus,
} from '../../lib/gear/service';
import { LoginLink, NotConfigured, Stars, StatusPill } from './gearShared';

const REPORT_REASONS = ['사기 의심', '허위 정보', '금지 품목', '기타'];
const STATUS_ORDER: GearStatus[] = ['active', 'reserved', 'sold', 'hidden'];

export default function GearDetail() {
  const { id = '' } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isConfigured } = useAuth();

  const [item, setItem] = useState<GearListing | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [photo, setPhoto] = useState(0);

  const [reviews, setReviews] = useState<GearReview[]>([]);
  const [reviewsError, setReviewsError] = useState<string | null>(null);
  const [isFav, setIsFav] = useState(false);
  const [favBusy, setFavBusy] = useState(false);

  const [inquiryText, setInquiryText] = useState('');
  const [inquiryBusy, setInquiryBusy] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);

  const [reportOpen, setReportOpen] = useState(false);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState('');
  const [reportMsg, setReportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [reportBusy, setReportBusy] = useState(false);
  const [blockBusy, setBlockBusy] = useState(false);
  const [blockError, setBlockError] = useState<string | null>(null);

  // 판매자 관리
  const [inquiries, setInquiries] = useState<GearInquiry[] | null>(null);
  const [inquiriesError, setInquiriesError] = useState<string | null>(null);
  const [pickingBuyer, setPickingBuyer] = useState(false);
  const [buyerChoice, setBuyerChoice] = useState<string>('');
  const [manageBusy, setManageBusy] = useState(false);
  const [manageError, setManageError] = useState<string | null>(null);

  // 후기
  const [myReview, setMyReview] = useState<GearReview | null | undefined>(undefined);
  const [rating, setRating] = useState(5);
  const [reviewBody, setReviewBody] = useState('');
  const [reviewBusy, setReviewBusy] = useState(false);
  const [reviewError, setReviewError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isConfigured || !id) return;
    setLoading(true);
    setError(null);
    const r = await getGear(id);
    setLoading(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setItem(r.data);
    setPhoto(0);
  }, [id, isConfigured]);

  useEffect(() => {
    void load();
  }, [load]);

  const sellerId = item?.sellerId;
  const isSeller = !!user && !!item && user.id === item.sellerId;
  const isBuyer = !!user && !!item && item.buyerId === user.id;

  // 판매자 후기
  useEffect(() => {
    if (!sellerId) return;
    let alive = true;
    void listReviewsFor(sellerId).then((r) => {
      if (!alive) return;
      if (r.ok) {
        setReviews(r.data);
        setReviewsError(null);
      } else setReviewsError(r.message);
    });
    return () => {
      alive = false;
    };
  }, [sellerId]);

  // 찜 상태
  useEffect(() => {
    if (!user || !id) {
      setIsFav(false);
      return;
    }
    let alive = true;
    void listFavoriteIds(user.id).then((ids) => alive && setIsFav(ids.has(id)));
    return () => {
      alive = false;
    };
  }, [user, id]);

  // 판매자: 문의한 사람 목록
  const loadInquiries = useCallback(async () => {
    if (!isSeller || !id) return;
    const r = await listInquiries(id);
    if (r.ok) {
      setInquiries(r.data);
      setInquiriesError(null);
    } else setInquiriesError(r.message);
  }, [isSeller, id]);
  useEffect(() => {
    void loadInquiries();
  }, [loadInquiries]);

  // 후기 작성 여부
  const reviewEligible = !!item && item.status === 'sold' && !!item.buyerId && (isSeller || isBuyer);
  useEffect(() => {
    if (!reviewEligible || !user) {
      setMyReview(undefined);
      return;
    }
    let alive = true;
    void myReviewFor(id, user.id).then((r) => alive && setMyReview(r));
    return () => {
      alive = false;
    };
  }, [reviewEligible, id, user]);

  if (!isConfigured) return <NotConfigured fallback="/gear" />;

  if (loading && !item) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <LoadingState />
        </div>
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <ErrorState text={error} onRetry={() => void load()} />
        </div>
      </div>
    );
  }
  if (!item) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <EmptyState icon="🔍" text="상품을 찾을 수 없습니다. 삭제되었거나 볼 수 없는 상품입니다." />
          <div className="eco-row gear-center">
            <Link className="btn btn-secondary btn-sm" to="/gear">
              장비 목록으로
            </Link>
          </div>
        </div>
      </div>
    );
  }

  const listing = item;
  const cond = GEAR_CONDITIONS[listing.condition];
  const sr = sellerRating(reviews);
  const removed = listing.moderation === 'removed';

  async function toggleFav() {
    if (!user || favBusy) return;
    setFavBusy(true);
    const next = !isFav;
    const r = next ? await addFavorite(listing.id, user.id) : await removeFavorite(listing.id, user.id);
    setFavBusy(false);
    if (r.ok) {
      setIsFav(next);
      setItem((cur) => (cur ? { ...cur, favoriteCount: Math.max(0, cur.favoriteCount + (next ? 1 : -1)) } : cur));
    }
  }

  async function handleInquire() {
    if (!user) return;
    setInquiryBusy(true);
    setInquiryError(null);
    const r = await inquire(listing, user.id, inquiryText);
    setInquiryBusy(false);
    if (!r.ok) {
      setInquiryError(r.message);
      return;
    }
    navigate(`/messages/${r.data}`);
  }

  async function handleReport() {
    if (!user) return;
    setReportBusy(true);
    setReportMsg(null);
    const r = await reportGear(user.id, listing.id, reportReason, reportDetail.trim());
    setReportBusy(false);
    if (r.ok) {
      setReportMsg({ ok: true, text: '신고가 접수되었습니다. 운영팀이 확인합니다.' });
      setReportDetail('');
      setReportOpen(false);
    } else setReportMsg({ ok: false, text: r.message });
  }

  async function handleBlock() {
    if (!user) return;
    if (!window.confirm(`${listing.sellerNickname || '이 판매자'}님을 차단할까요? 서로의 상품과 메시지가 보이지 않게 됩니다.`)) return;
    setBlockBusy(true);
    setBlockError(null);
    const r = await blockUser(listing.sellerId, user.id);
    setBlockBusy(false);
    if (!r.ok) {
      setBlockError(r.message);
      return;
    }
    const idx = (window.history.state as { idx?: number } | null)?.idx;
    if (typeof idx === 'number' && idx > 0) navigate(-1);
    else navigate('/gear', { replace: true });
  }

  async function changeStatus(status: GearStatus, buyerId: string | null = null) {
    setManageBusy(true);
    setManageError(null);
    const r = await setGearStatus(listing.id, status, buyerId);
    setManageBusy(false);
    if (!r.ok) {
      setManageError(r.message);
      return;
    }
    setPickingBuyer(false);
    setBuyerChoice('');
    await load();
  }

  async function handleDelete() {
    if (!window.confirm('이 상품을 삭제할까요? 찜·문의 기록과 후기도 함께 사라지며 되돌릴 수 없습니다.')) return;
    setManageBusy(true);
    setManageError(null);
    const r = await deleteGear(listing.id);
    setManageBusy(false);
    if (!r.ok) {
      setManageError(r.message);
      return;
    }
    navigate('/gear/mine', { replace: true });
  }

  async function handleReview() {
    if (!user || !listing.buyerId) return;
    const other = isSeller ? listing.buyerId : listing.sellerId;
    setReviewBusy(true);
    setReviewError(null);
    const r = await writeReview(listing.id, user.id, other, rating, reviewBody);
    setReviewBusy(false);
    if (!r.ok) {
      setReviewError(r.message);
      return;
    }
    setMyReview(await myReviewFor(listing.id, user.id));
    if (isBuyer) {
      const rr = await listReviewsFor(listing.sellerId);
      if (rr.ok) setReviews(rr.data);
    }
  }

  const buyerNickname = listing.buyerId ? inquiries?.find((i) => i.buyerId === listing.buyerId)?.buyerNickname : undefined;

  return (
    <div className="page gear-page">
      <div className="container">
        <BackButton fallback="/gear" />
        <div className="breadcrumb">
          <Link to="/gear">장비 거래</Link>
          <span>/</span>
          <span className="gear-ellipsis">{listing.title}</span>
        </div>

        {removed && isSeller && (
          <div className="eco-notice" role="alert">
            <strong>
              <Icon name="warn" /> 운영 정책에 따라 내려진 상품입니다.
            </strong>{' '}
            다른 사용자에게 보이지 않으며 다시 판매 중으로 바꿀 수 없습니다. 숨기거나 삭제할 수 있습니다.
          </div>
        )}

        <div className="gear-detail">
          {/* 사진 */}
          <div className="gear-detail__media">
            <div className="gear-detail__main">
              {listing.images.length ? (
                <img src={listing.images[Math.min(photo, listing.images.length - 1)]} alt={`${listing.title} 사진 ${photo + 1}`} />
              ) : (
                <div className="gear-detail__noimg">
                  <Icon name="image" />
                  <span className="eco-meta">사진 없음</span>
                </div>
              )}
            </div>
            {listing.images.length > 1 && (
              <div className="eco-gallery gear-thumbs">
                {listing.images.map((src, i) => (
                  <button
                    key={src + i}
                    type="button"
                    className={`gear-thumb${i === photo ? ' is-active' : ''}`}
                    onClick={() => setPhoto(i)}
                    aria-label={`사진 ${i + 1} 보기`}
                    aria-pressed={i === photo}
                  >
                    <img src={src} alt="" loading="lazy" />
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* 정보 */}
          <div className="gear-detail__info eco-stack">
            <div className="eco-row">
              <StatusPill status={listing.status} />
              <span className="eco-pill">{GEAR_CATEGORIES[listing.category] ?? listing.category}</span>
              <span className="eco-pill">{gearArtLabel(listing.martialArt)}</span>
            </div>
            <h2 className="gear-detail__title">{listing.title}</h2>
            <div className="eco-price gear-detail__price">{listing.price === 0 ? '무료 나눔' : formatWon(listing.price)}</div>

            <dl className="gear-facts">
              <div>
                <dt>상태</dt>
                <dd>
                  <span className="eco-pill eco-pill--accent">{cond?.label ?? listing.condition}</span>
                  {cond && <span className="eco-meta gear-facts__note">{cond.note}</span>}
                </dd>
              </div>
              <div>
                <dt>브랜드</dt>
                <dd>{listing.brand || '미기재'}</dd>
              </div>
              <div>
                <dt>사이즈</dt>
                <dd>{listing.size || '미기재'}</dd>
              </div>
              <div>
                <dt>사용 기간</dt>
                <dd>{listing.usageMonths === null ? '미기재' : listing.usageMonths === 0 ? '사용 안 함' : `약 ${listing.usageMonths}개월`}</dd>
              </div>
              <div>
                <dt>지역</dt>
                <dd>{listing.region || '미기재'}</dd>
              </div>
              <div>
                <dt>거래 방법</dt>
                <dd className="eco-row">
                  {listing.meetupAvailable && <span className="eco-pill">직거래</span>}
                  {listing.shippingAvailable && <span className="eco-pill">택배{listing.shippingFee ? ` · 배송비 ${listing.shippingFee.toLocaleString('ko-KR')}원` : ' · 무료배송'}</span>}
                </dd>
              </div>
              <div>
                <dt>등록일</dt>
                <dd>{formatDate(listing.createdAt)}</dd>
              </div>
              {listing.status === 'sold' && (
                <div>
                  <dt>판매 완료</dt>
                  <dd>{formatDate(listing.soldAt)}</dd>
                </div>
              )}
            </dl>

            <div className="eco-row">
              {user ? (
                !isSeller && (
                  <button
                    type="button"
                    className={`btn btn-sm ${isFav ? 'btn-primary' : 'btn-secondary'}`}
                    data-testid="gear-fav"
                    aria-pressed={isFav}
                    disabled={favBusy}
                    onClick={() => void toggleFav()}
                  >
                    <Icon name={isFav ? 'heart-filled' : 'heart'} /> 찜 {listing.favoriteCount}
                  </button>
                )
              ) : (
                <span className="eco-meta">
                  <Icon name="heart" /> 찜 {listing.favoriteCount}
                </span>
              )}
              {listing.moderation !== 'removed' && listing.status !== 'hidden' && (
                <ShareButton attachment={() => ({ kind: 'gear', id: listing.id, title: listing.title, price: listing.price })} />
              )}
            </div>
          </div>
        </div>

        {/* 설명 */}
        <div className="eco-section">
          <h3>상품 설명</h3>
        </div>
        <div className="eco-card">
          {listing.description ? <p className="gear-description">{listing.description}</p> : <p className="eco-meta">판매자가 설명을 적지 않았습니다.</p>}
        </div>

        {/* 판매자 관리 */}
        {isSeller && (
          <>
            <div className="eco-section">
              <h3>판매 관리</h3>
              <Link className="btn btn-secondary btn-sm" to={`/gear/${listing.id}/edit`}>
                <Icon name="edit" /> 수정
              </Link>
            </div>
            <div className="eco-card eco-stack">
              <div className="eco-row" role="group" aria-label="거래 상태">
                {STATUS_ORDER.map((s) => {
                  const current = listing.status === s;
                  const blockedByModeration = removed && s !== 'hidden';
                  return (
                    <button
                      key={s}
                      type="button"
                      data-testid={`gear-status-${s}`}
                      className={`btn btn-sm ${current || (s === 'sold' && pickingBuyer) ? 'btn-primary' : 'btn-secondary'}`}
                      aria-pressed={current}
                      disabled={manageBusy || current || blockedByModeration}
                      onClick={() => {
                        if (s === 'sold') {
                          setPickingBuyer(true);
                          void loadInquiries();
                        } else {
                          setPickingBuyer(false);
                          void changeStatus(s);
                        }
                      }}
                    >
                      {GEAR_STATUS[s]}
                    </button>
                  );
                })}
              </div>
              {listing.status === 'sold' && (
                <p className="eco-meta">
                  구매자: {listing.buyerId ? buyerNickname || '지정됨' : '미지정'}
                  {' · '}판매 중으로 되돌리면 구매자 지정이 해제됩니다.
                </p>
              )}

              {pickingBuyer && listing.status !== 'sold' && (
                <div className="gear-buyer-picker eco-stack">
                  <strong>누구에게 판매했나요?</strong>
                  <p className="eco-meta">구매자를 지정하면 서로 거래 후기를 남길 수 있습니다. 이 상품에 문의한 사람 중에서만 고를 수 있습니다.</p>
                  {inquiriesError ? (
                    <p className="gear-error">{inquiriesError}</p>
                  ) : inquiries === null ? (
                    <p className="eco-meta">문의 목록을 불러오는 중...</p>
                  ) : inquiries.length === 0 ? (
                    <p className="eco-meta">아직 문의한 사람이 없습니다.</p>
                  ) : (
                    <div className="eco-stack">
                      {inquiries.map((iq) => (
                        <label key={iq.buyerId} className="eco-row gear-inline-check">
                          <input type="radio" name="gear-buyer" value={iq.buyerId} checked={buyerChoice === iq.buyerId} onChange={() => setBuyerChoice(iq.buyerId)} />
                          <span>{iq.buyerNickname || '이름 없는 사용자'}</span>
                          <span className="eco-meta--faint">{formatDate(iq.createdAt)} 문의</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <div className="eco-row">
                    <button type="button" className="btn btn-primary btn-sm" disabled={manageBusy || !buyerChoice} onClick={() => void changeStatus('sold', buyerChoice)}>
                      이 사람에게 판매 완료
                    </button>
                    <button type="button" className="btn btn-secondary btn-sm" disabled={manageBusy} onClick={() => void changeStatus('sold', null)}>
                      구매자 미지정으로 완료
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setPickingBuyer(false)}>
                      취소
                    </button>
                  </div>
                </div>
              )}

              {inquiries && inquiries.length > 0 && !pickingBuyer && (
                <details className="gear-inquiries">
                  <summary>받은 문의 {inquiries.length}건</summary>
                  <ul>
                    {inquiries.map((iq) => (
                      <li key={iq.buyerId} className="eco-row eco-row--between">
                        <span>{iq.buyerNickname || '이름 없는 사용자'}</span>
                        {iq.conversationId ? (
                          <Link to={`/messages/${iq.conversationId}`} className="btn btn-ghost btn-sm">
                            <Icon name="message" /> 대화 열기
                          </Link>
                        ) : (
                          <span className="eco-meta--faint">{formatDate(iq.createdAt)}</span>
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}

              {manageError && (
                <p className="gear-error" role="alert">
                  {manageError}
                </p>
              )}
              <div className="eco-row">
                <button type="button" className="btn btn-ghost btn-sm gear-danger" disabled={manageBusy} onClick={() => void handleDelete()}>
                  <Icon name="trash" /> 삭제
                </button>
              </div>
            </div>
          </>
        )}

        {/* 택배 거래 결제 (0059, Toss 테스트 결제) */}
        {!isSeller && <GearCheckout listing={listing} />}
        {listing.status === 'sold' && user && (isSeller || listing.buyerId === user.id) && (
          <p className="eco-meta" style={{ marginTop: 8 }}>
            <Link to="/gear/orders">택배 거래 주문 보기 (결제·발송·수령 확인)</Link>
          </p>
        )}

        {/* 문의 (구매자) */}
        {!isSeller && (
          <>
            <div className="eco-section">
              <h3>판매자에게 문의</h3>
            </div>
            <div className="eco-card eco-stack">
              {!user ? (
                <LoginLink text="문의하려면 로그인이 필요합니다." />
              ) : listing.status === 'sold' ? (
                <p className="eco-meta">판매 완료된 상품이라 문의할 수 없습니다.</p>
              ) : (
                <div className="eco-form">
                  {listing.status === 'reserved' && <p className="eco-meta">예약 중인 상품입니다. 거래가 취소될 경우를 위해 문의를 남길 수는 있습니다.</p>}
                  <label>
                    첫 메시지
                    <textarea
                      value={inquiryText}
                      maxLength={1000}
                      onChange={(e) => setInquiryText(e.target.value)}
                      placeholder={`"${listing.title}" 상품 문의드립니다.`}
                    />
                  </label>
                  <p className="eco-meta--faint">메시지에는 상품 카드가 함께 붙습니다. 전화번호나 계좌번호는 보내지 마세요.</p>
                  {inquiryError && (
                    <p className="gear-error" role="alert">
                      {inquiryError}
                    </p>
                  )}
                  <div className="eco-row">
                    <button type="button" className="btn btn-primary" data-testid="gear-inquire" disabled={inquiryBusy} onClick={() => void handleInquire()}>
                      <Icon name="message" /> {inquiryBusy ? '대화방 여는 중...' : '판매자에게 문의'}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* 거래 후기 작성 */}
        {reviewEligible && myReview !== undefined && (
          <>
            <div className="eco-section">
              <h3>거래 후기</h3>
            </div>
            <div className="eco-card eco-stack">
              {myReview ? (
                <div className="eco-stack">
                  <span className="eco-meta">내가 남긴 후기</span>
                  <Stars value={myReview.rating} />
                  {myReview.body && <p className="gear-description">{myReview.body}</p>}
                </div>
              ) : (
                <div className="eco-form">
                  <p className="eco-meta">{isSeller ? '구매자' : '판매자'}와의 거래는 어땠나요? 후기는 한 번만 남길 수 있습니다.</p>
                  <div className="eco-row" role="radiogroup" aria-label="별점">
                    {[1, 2, 3, 4, 5].map((n) => (
                      <button
                        key={n}
                        type="button"
                        role="radio"
                        aria-checked={rating === n}
                        aria-label={`${n}점`}
                        className="gear-star-btn"
                        onClick={() => setRating(n)}
                      >
                        <Icon name={n <= rating ? 'star-filled' : 'star'} />
                      </button>
                    ))}
                    <span className="eco-meta">{rating}점</span>
                  </div>
                  <label>
                    후기 (선택)
                    <textarea value={reviewBody} maxLength={1000} onChange={(e) => setReviewBody(e.target.value)} placeholder="약속 시간, 상품 상태 설명이 정확했는지 등을 적어 주세요." />
                  </label>
                  {reviewError && (
                    <p className="gear-error" role="alert">
                      {reviewError}
                    </p>
                  )}
                  <div className="eco-row">
                    <button type="button" className="btn btn-primary btn-sm" disabled={reviewBusy} onClick={() => void handleReview()}>
                      후기 남기기
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        )}

        {/* 판매자 */}
        <div className="eco-section">
          <h3>판매자</h3>
        </div>
        <div className="eco-card eco-stack">
          <div className="eco-row eco-row--between">
            <Link to={`/u/${listing.sellerId}`} className="gear-seller">
              <Icon name="user" /> <strong>{listing.sellerNickname || '판매자'}</strong>
            </Link>
            <span className="eco-row">
              {sr.avg === null ? (
                <span className="eco-meta">아직 거래 후기가 없습니다</span>
              ) : (
                <>
                  <Stars value={sr.avg} label={`평균 별점 ${sr.avg}점`} />
                  <span className="eco-meta">
                    {sr.avg.toFixed(1)} · 후기 {sr.count}개
                  </span>
                </>
              )}
            </span>
          </div>
          {reviewsError ? (
            <p className="gear-error">{reviewsError}</p>
          ) : (
            reviews.length > 0 && (
              <ul className="gear-reviews">
                {reviews.slice(0, 10).map((rv) => (
                  <li key={rv.listingId + rv.reviewerId}>
                    <div className="eco-row eco-row--between">
                      <Stars value={rv.rating} />
                      <span className="eco-meta--faint">{formatDate(rv.createdAt)}</span>
                    </div>
                    {rv.body ? <p>{rv.body}</p> : <p className="eco-meta--faint">내용 없는 별점 후기</p>}
                  </li>
                ))}
              </ul>
            )
          )}
          {!isSeller && user && (
            <div className="eco-row gear-safety-actions">
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                data-testid="gear-report"
                aria-expanded={reportOpen}
                onClick={() => {
                  setReportOpen((v) => !v);
                  setReportMsg(null);
                }}
              >
                <Icon name="flag" /> 신고
              </button>
              <button type="button" className="btn btn-ghost btn-sm gear-danger" disabled={blockBusy} onClick={() => void handleBlock()}>
                <Icon name="shield" /> 판매자 차단
              </button>
            </div>
          )}
          {!user && <LoginLink text="신고·차단하려면 로그인이 필요합니다." />}
          {blockError && (
            <p className="gear-error" role="alert">
              {blockError}
            </p>
          )}
          {reportOpen && user && (
            <div className="eco-form gear-report-form">
              <label>
                신고 사유
                <select value={reportReason} onChange={(e) => setReportReason(e.target.value)}>
                  {REPORT_REASONS.map((r) => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                자세한 내용 (선택)
                <textarea value={reportDetail} maxLength={1000} onChange={(e) => setReportDetail(e.target.value)} placeholder="어떤 점이 문제인지 적어 주세요." />
              </label>
              <div className="eco-row">
                <button type="button" className="btn btn-primary btn-sm" disabled={reportBusy} onClick={() => void handleReport()}>
                  신고 접수
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(false)}>
                  취소
                </button>
              </div>
            </div>
          )}
          {reportMsg && (
            <p className={reportMsg.ok ? 'eco-meta' : 'gear-error'} role="status">
              {reportMsg.text}
            </p>
          )}
        </div>

        {/* 안전 거래 안내 */}
        <div className="eco-notice">
          <strong>
            <Icon name="shield" /> 안전하게 거래하세요
          </strong>
          <ul>
            {SAFETY_TIPS.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
