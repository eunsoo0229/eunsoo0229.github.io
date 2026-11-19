import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import ShareButton from '../../components/social/ShareButton';
import { formatDate, formatWon } from '../../lib/ecosystem/common';
import {
  claimOffer,
  getGymListing,
  getPricing,
  isActivePartner,
  listOffers,
  listReviews,
  reportGym,
  startInquiry,
  writeGymReview,
  type GymListing,
  type GymOffer,
  type GymPricing,
  type GymReview,
} from '../../lib/gymDirectory/service';
import {
  ArtPills,
  GymPage,
  LISTING_STATUS_LABEL,
  LoginLink,
  NotConfigured,
  OFFER_TARGET_LABEL,
  OfferPrice,
  PricingVerifiedPill,
  isOfferLive,
  mapHref,
  offerDiscountText,
  offerLimitText,
  offerPeriodText,
  safeHref,
  UUID_RE,
} from './gymShared';

const REPORT_REASONS = ['허위 정보', '실제 가격과 다름', '부적절한 내용', '스팸·광고', '기타'];
const SNS_LABEL: Record<string, string> = { instagram: '인스타그램', youtube: '유튜브', blog: '블로그' };

type Loaded = { listing: GymListing; pricing: GymPricing | null; partner: boolean; offers: GymOffer[]; reviews: GymReview[] };

function yn(b: boolean | null): string {
  return b === null ? '정보 없음' : b ? '가능' : '불가';
}

export default function GymListingDetail() {
  const { listingId = '' } = useParams();
  const navigate = useNavigate();
  const { user, profile, isConfigured } = useAuth();
  const [data, setData] = useState<Loaded | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const [claimed, setClaimed] = useState<Record<string, string>>({});
  const [claimError, setClaimError] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [inquiryError, setInquiryError] = useState<string | null>(null);

  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

  const [report, setReport] = useState<{ type: 'gym_listing' | 'gym_review'; id: string; label: string } | null>(null);
  const [reportReason, setReportReason] = useState(REPORT_REASONS[0]);
  const [reportDetail, setReportDetail] = useState('');
  const [reportMsg, setReportMsg] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    setNotFound(false);
    setData((d) => (d && d.listing.id === listingId ? d : null));
    if (!UUID_RE.test(listingId)) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const lr = await getGymListing(listingId);
    if (!lr.ok) {
      setError(lr.message);
      setLoading(false);
      return;
    }
    if (!lr.data) {
      setNotFound(true);
      setLoading(false);
      return;
    }
    const [pricing, partner, offers, reviews] = await Promise.all([getPricing(listingId), isActivePartner(listingId), listOffers(listingId), listReviews(listingId)]);
    setData({
      listing: lr.data,
      pricing,
      partner,
      // 관리자 본인은 초안까지 보이므로, 공개 화면에는 지금 진행 중인 할인만 남긴다
      offers: offers.ok ? offers.data.filter((o) => isOfferLive(o)) : [],
      reviews: reviews.ok ? reviews.data : [],
    });
    setLoading(false);
  }

  useEffect(() => {
    if (!isConfigured) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, isConfigured]);

  const myReview = data && user ? data.reviews.find((r) => r.userId === user.id) : undefined;
  useEffect(() => {
    if (myReview) {
      setRating(myReview.rating);
      setBody(myReview.body);
    }
  }, [myReview]);

  if (!isConfigured) return <NotConfigured />;
  if (loading && !data) return <GymPage><LoadingState text="체육관 정보를 불러오는 중..." /></GymPage>;
  if (error) return <GymPage><ErrorState text={error} onRetry={() => void load()} /></GymPage>;
  if (notFound || !data) {
    return (
      <GymPage>
        <EmptyState icon="🏛" text="체육관을 찾을 수 없거나 아직 공개되지 않았습니다." />
      </GymPage>
    );
  }

  const { listing: l, pricing: p, partner, offers, reviews } = data;
  const isOwner = !!user && user.id === l.ownerUserId;

  async function handleClaim(offerId: string) {
    setBusy(true);
    setClaimError((m) => ({ ...m, [offerId]: '' }));
    const r = await claimOffer(offerId);
    setBusy(false);
    if (r.ok) setClaimed((m) => ({ ...m, [offerId]: r.data.code }));
    else setClaimError((m) => ({ ...m, [offerId]: r.message }));
  }

  async function handleInquiry() {
    setBusy(true);
    setInquiryError(null);
    const r = await startInquiry(l.id);
    setBusy(false);
    if (r.ok && r.data) navigate(`/messages/${r.data}`);
    else setInquiryError(r.ok ? '대화를 시작하지 못했습니다.' : r.message);
  }

  async function handleReview() {
    if (!user) return;
    if (rating < 1 || rating > 5) return;
    setBusy(true);
    setReviewMsg(null);
    const r = await writeGymReview(l.id, user.id, profile?.nickname ?? '', rating, body);
    setBusy(false);
    if (!r.ok) {
      setReviewMsg(r.message);
      return;
    }
    setReviewMsg(myReview ? '후기를 수정했습니다.' : '후기를 등록했습니다.');
    const rv = await listReviews(l.id);
    if (rv.ok) setData((d) => (d ? { ...d, reviews: rv.data } : d));
  }

  async function handleReport() {
    if (!user || !report) return;
    if (!window.confirm(`${report.label}을(를) "${reportReason}" 사유로 신고할까요?`)) return;
    setBusy(true);
    const r = await reportGym(user.id, report.type, report.id, reportReason, reportDetail.trim());
    setBusy(false);
    if (r.ok) {
      setReportMsg('신고가 접수되었습니다. 플랫폼에서 검토합니다.');
      setReport(null);
      setReportDetail('');
    } else setReportMsg(r.message);
  }

  const priceRows: [string, string][] = p
    ? [
        ['월 회비', formatWon(p.monthly)],
        ['3개월', formatWon(p.threeMonth)],
        ['6개월', formatWon(p.sixMonth)],
        ['연간', formatWon(p.yearly)],
        ['입회비', formatWon(p.initiationFee)],
        ['등록비', formatWon(p.registrationFee)],
        ['도복·장비 비용', formatWon(p.gearCost)],
        ['주당 수업 횟수', p.sessionsPerWeek != null ? `${p.sessionsPerWeek}회` : '정보 없음'],
        ['1회 수업 시간', p.minutesPerSession != null ? `${p.minutesPerSession}분` : '정보 없음'],
        ['자유 연습(오픈매트)', yn(p.openMat)],
        ['여러 종목 수강', yn(p.multiArt)],
        ['체험 수업', yn(p.trialAvailable)],
        ['체험 수업 가격', formatWon(p.trialPrice)],
      ]
    : [];

  const snsEntries = Object.entries(l.sns ?? {}).filter(([, v]) => typeof v === 'string' && v.trim());
  const website = safeHref(l.website);

  return (
    <GymPage>
      <div className="breadcrumb">
        <Link to="/gyms">체육관 검색</Link>
        <span>/</span>
        <span>{l.name}</span>
      </div>

      {l.status !== 'approved' && (
        <div className="eco-notice">
          아직 공개되지 않은 체육관입니다 (상태: {LISTING_STATUS_LABEL[l.status]}). 등록한 관리자와 플랫폼 관리자만 볼 수 있습니다.
        </div>
      )}

      {l.coverImageUrl && (
        <div className="eco-card__media" style={{ margin: '0 0 12px', borderRadius: 'var(--radius-lg)' }}>
          <img src={l.coverImageUrl} alt={`${l.name} 대표 이미지`} />
        </div>
      )}

      <div className="eco-page-head">
        <div>
          <div className="eco-row">
            <ArtPills arts={l.arts} />
            {partner && <span className="eco-pill eco-pill--accent">MARTIALDEX 제휴</span>}
          </div>
          <h2>{l.name}</h2>
          <p>
            <Icon name="pin" /> {l.region} · {l.address}
          </p>
        </div>
        <div className="eco-row">
          {user ? (
            !isOwner && (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy || l.status !== 'approved'} onClick={handleInquiry}>
                <Icon name="message" /> 등록 문의 (DM)
              </button>
            )
          ) : (
            <Link className="btn btn-primary btn-sm" to="/login">
              로그인하고 문의하기
            </Link>
          )}
          {l.status === 'approved' && <ShareButton attachment={() => ({ kind: 'gym', id: l.id, name: l.name, region: l.region })} />}
          {isOwner && (
            <Link className="btn btn-secondary btn-sm" to={`/gyms/manage/${l.id}`}>
              <Icon name="edit" /> 관리
            </Link>
          )}
        </div>
      </div>
      {inquiryError && <p className="eco-meta" role="alert">{inquiryError}</p>}

      <div className="eco-section">
        <h3>기본 정보</h3>
      </div>
      <div className="eco-card eco-stack">
        <div>
          <div className="eco-meta">주소</div>
          <div>{l.address}</div>
          <a href={mapHref(l)} target="_blank" rel="noopener noreferrer" className="eco-meta">
            <Icon name="external" /> 지도에서 보기 (OpenStreetMap{l.lat === null ? ' 주소 검색' : ''})
          </a>
        </div>
        {l.phone && (
          <div>
            <div className="eco-meta">전화</div>
            <a href={`tel:${l.phone.replace(/[^0-9+]/g, '')}`}>{l.phone}</a>
          </div>
        )}
        {l.website && (
          <div>
            <div className="eco-meta">홈페이지</div>
            {website ? (
              <a href={website} target="_blank" rel="noopener noreferrer">
                {l.website}
              </a>
            ) : (
              <span>{l.website}</span>
            )}
          </div>
        )}
        {snsEntries.length > 0 && (
          <div>
            <div className="eco-meta">SNS</div>
            <div className="eco-row">
              {snsEntries.map(([k, v]) => {
                const href = safeHref(v);
                const label = SNS_LABEL[k] ?? k;
                return href ? (
                  <a key={k} href={href} target="_blank" rel="noopener noreferrer" className="eco-pill">
                    {label}
                  </a>
                ) : (
                  <span key={k} className="eco-pill">
                    {label}: {v}
                  </span>
                );
              })}
            </div>
          </div>
        )}
        {l.hours && (
          <div>
            <div className="eco-meta">운영 시간</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{l.hours}</div>
          </div>
        )}
        {l.facilities.length > 0 && (
          <div>
            <div className="eco-meta">시설</div>
            <div className="eco-row">
              {l.facilities.map((f) => (
                <span key={f} className="eco-pill">
                  {f}
                </span>
              ))}
            </div>
          </div>
        )}
        {l.description && (
          <div>
            <div className="eco-meta">소개</div>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{l.description}</p>
          </div>
        )}
      </div>

      {l.instructors.length > 0 && (
        <>
          <div className="eco-section">
            <h3>지도자</h3>
          </div>
          <div className="eco-grid eco-grid--tight">
            {l.instructors.map((ins, i) => (
              <div key={`${ins.name}-${i}`} className="eco-card">
                <h3>{ins.name}</h3>
                {ins.title && <div className="eco-meta">{ins.title}</div>}
                {ins.career && <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: 13 }}>{ins.career}</p>}
              </div>
            ))}
          </div>
        </>
      )}

      {l.schedule.length > 0 && (
        <>
          <div className="eco-section">
            <h3>수업 시간표</h3>
          </div>
          <div className="eco-table-wrap">
            <table className="eco-table">
              <thead>
                <tr>
                  <th>요일</th>
                  <th>시간</th>
                  <th>수업</th>
                </tr>
              </thead>
              <tbody>
                {l.schedule.map((s, i) => (
                  <tr key={i}>
                    <td>{s.day}</td>
                    <td>{s.time}</td>
                    <td>{s.className}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <div className="eco-section">
        <h3>가격</h3>
        <PricingVerifiedPill pricing={p} />
      </div>
      {!p ? (
        <EmptyState icon="📋" text="체육관이 아직 가격 정보를 등록하지 않았습니다. 문의로 확인해 주세요." />
      ) : (
        <>
          <div className="eco-row" style={{ marginBottom: 8 }}>
            <span className="eco-meta">최종 확인일: {formatDate(p.ownerConfirmedAt)}</span>
            <span className="eco-meta">·</span>
            <span className="eco-meta">플랫폼 가격 검증: {p.verifiedAt ? `완료 (${formatDate(p.verifiedAt)})` : '미검증'}</span>
          </div>
          <div className="eco-table-wrap">
            <table className="eco-table">
              <tbody>
                {priceRows.map(([label, value]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th>
                    <td className={value === '정보 없음' ? 'eco-missing' : undefined}>{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {p.notes && <p className="eco-meta" style={{ whiteSpace: 'pre-wrap' }}>비고: {p.notes}</p>}
          <p className="eco-meta--faint">가격은 체육관이 직접 입력한 값입니다. 등록 전 체육관에 최종 금액을 꼭 확인해 주세요.</p>
        </>
      )}

      <div className="eco-section">
        <h3>제휴 할인</h3>
      </div>
      {offers.length === 0 ? (
        <p className="eco-meta">
          {partner ? '지금 진행 중인 할인이 없습니다.' : '플랫폼과 제휴 계약이 확인된 체육관만 할인 쿠폰을 제공합니다. 이 체육관은 현재 제휴 할인이 없습니다.'}
        </p>
      ) : (
        <div className="eco-stack">
          {offers.map((o) => (
            <div key={o.id} className="eco-card eco-stack">
              <div className="eco-row eco-row--between">
                <h3 style={{ margin: 0 }}>{o.title}</h3>
                <span className="eco-pill eco-pill--accent">{offerDiscountText(o)}</span>
              </div>
              <OfferPrice offer={o} />
              <div className="eco-meta">
                <Icon name="calendar" /> {offerPeriodText(o)} · {OFFER_TARGET_LABEL[o.target]} · {offerLimitText(o)}
              </div>
              {o.terms && <p className="eco-meta" style={{ whiteSpace: 'pre-wrap', margin: 0 }}>조건: {o.terms}</p>}
              {claimed[o.id] ? (
                <div className="eco-notice eco-notice--accent">
                  쿠폰이 발급되었습니다. 체육관 등록 시 이 코드를 보여 주세요.
                  <div className="gym-coupon-code" data-testid="gym-coupon-code">
                    {claimed[o.id]}
                  </div>
                  <Link to="/gyms/coupons">내 쿠폰 보기</Link>
                </div>
              ) : !user ? (
                <LoginLink text="할인 쿠폰을 받으려면 로그인이 필요합니다." />
              ) : isOwner ? (
                <p className="eco-meta">내 체육관의 할인은 받을 수 없습니다.</p>
              ) : (
                <div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    data-testid="gym-offer-claim"
                    disabled={busy || !(o.priceVerified && o.discountedPrice != null)}
                    onClick={() => handleClaim(o.id)}
                  >
                    <Icon name="tag" /> 할인 쿠폰 받기
                  </button>
                  {claimError[o.id] && (
                    <p className="eco-meta" role="alert">
                      {claimError[o.id]}
                    </p>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="eco-section">
        <h3>후기 {reviews.length > 0 ? `${reviews.length}개` : ''}</h3>
      </div>
      {user && !isOwner && l.status === 'approved' && (
        <div className="eco-card eco-form" style={{ marginBottom: 12 }}>
          <strong>{myReview ? '내 후기 수정' : '후기 쓰기'}</strong>
          <label>
            별점
            <select value={rating} onChange={(e) => setRating(Number(e.target.value))}>
              {[5, 4, 3, 2, 1].map((n) => (
                <option key={n} value={n}>
                  {n}점
                </option>
              ))}
            </select>
          </label>
          <label>
            내용
            <textarea maxLength={1500} value={body} onChange={(e) => setBody(e.target.value)} placeholder="수업 분위기, 지도 방식, 시설 등을 적어 주세요." />
          </label>
          <p className="eco-meta--faint">이 체육관 쿠폰으로 실제 등록했거나 연결된 체육관의 회원이면 "실제 회원" 표시가 자동으로 붙습니다.</p>
          <div className="eco-row">
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={handleReview}>
              {myReview ? '수정하기' : '등록하기'}
            </button>
            {reviewMsg && <span className="eco-meta">{reviewMsg}</span>}
          </div>
        </div>
      )}
      {!user && <LoginLink text="후기를 쓰려면 로그인이 필요합니다." />}
      {reviews.length === 0 ? (
        <p className="eco-meta">아직 후기가 없습니다.</p>
      ) : (
        <div className="eco-stack">
          {reviews.map((r) => (
            <div key={r.userId} className="eco-card">
              <div className="eco-row eco-row--between">
                <span className="eco-row">
                  <strong>{r.userNickname || '회원'}</strong>
                  {r.verifiedMember && (
                    <span className="eco-pill eco-pill--good">
                      <Icon name="verified" /> 실제 회원
                    </span>
                  )}
                </span>
                <span className="eco-meta">
                  <Icon name="star-filled" /> {r.rating}/5 · {formatDate(r.createdAt)}
                </span>
              </div>
              {r.body && <p style={{ whiteSpace: 'pre-wrap', margin: '6px 0 0', fontSize: 14 }}>{r.body}</p>}
              {user && user.id !== r.userId && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => setReport({ type: 'gym_review', id: `${r.listingId}:${r.userId}`, label: '이 후기' })}
                >
                  <Icon name="flag" /> 신고
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="eco-section">
        <h3>신고</h3>
      </div>
      {!user ? (
        <LoginLink text="잘못된 정보를 신고하려면 로그인이 필요합니다." />
      ) : (
        <>
          {!isOwner && !report && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReport({ type: 'gym_listing', id: l.id, label: '이 체육관 정보' })}>
              <Icon name="flag" /> 체육관 정보 신고
            </button>
          )}
          {report && (
            <div className="eco-card eco-form">
              <strong>{report.label} 신고</strong>
              <label>
                사유
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
                <textarea maxLength={1000} value={reportDetail} onChange={(e) => setReportDetail(e.target.value)} />
              </label>
              <div className="eco-row">
                <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={handleReport}>
                  신고하기
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReport(null)}>
                  취소
                </button>
              </div>
            </div>
          )}
          {reportMsg && <p className="eco-meta">{reportMsg}</p>}
        </>
      )}
    </GymPage>
  );
}
