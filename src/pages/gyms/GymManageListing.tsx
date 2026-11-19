import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { listMyGyms } from '../../lib/gymClass/service';
import type { Gym } from '../../lib/gymClass/types';
import {
  GYM_ARTS,
  createListing,
  getGymListing,
  updateListing,
  uploadGymImage,
  validateListing,
  type GymArt,
  type GymListing,
  type GymListingInput,
  type InstructorInfo,
  type ScheduleItem,
} from '../../lib/gymDirectory/service';
import { GymPage, LISTING_STATUS_LABEL, LISTING_STATUS_PILL, NotConfigured, UUID_RE } from './gymShared';
import { CouponsSection, OffersSection, PartnershipSection, PricingSection, StatsSection } from './GymManageSections';

type Tab = 'info' | 'pricing' | 'partner' | 'offers' | 'coupons' | 'stats';
const TABS: [Tab, string][] = [
  ['info', '기본 정보'],
  ['pricing', '가격'],
  ['partner', '제휴'],
  ['offers', '할인'],
  ['coupons', '쿠폰'],
  ['stats', '통계'],
];

// 체육관 관리자: 등록(new) / 수정 + 가격·제휴·할인·쿠폰·통계.
export default function GymManageListing() {
  const { listingId = '' } = useParams();
  const isNew = listingId === 'new';
  const { user, isConfigured } = useAuth();
  const [listing, setListing] = useState<GymListing | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('info');

  async function load() {
    if (isNew || !user) return;
    if (!UUID_RE.test(listingId)) {
      setListing(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const r = await getGymListing(listingId);
    setLoading(false);
    if (r.ok) setListing(r.data);
    else setError(r.message);
  }

  useEffect(() => {
    setTab('info');
    if (isNew) {
      setListing(null);
      setLoading(false);
      return;
    }
    if (!isConfigured || !user) return;
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listingId, isConfigured, user?.id]);

  if (!isConfigured) return <NotConfigured back="/gyms/manage" />;
  if (!user) {
    return (
      <GymPage back="/gyms/manage">
        <EmptyState icon="🔒" text="체육관을 관리하려면 로그인이 필요합니다." />
        <div className="eco-row">
          <Link className="btn btn-primary" to="/login">
            로그인
          </Link>
        </div>
      </GymPage>
    );
  }
  if (loading) return <GymPage back="/gyms/manage"><LoadingState /></GymPage>;
  if (error) return <GymPage back="/gyms/manage"><ErrorState text={error} onRetry={() => void load()} /></GymPage>;
  if (!isNew && (!listing || listing.ownerUserId !== user.id)) {
    return (
      <GymPage back="/gyms/manage">
        <EmptyState icon="🏛" text="체육관을 찾을 수 없거나 내가 등록한 체육관이 아닙니다." />
      </GymPage>
    );
  }

  return (
    <GymPage back="/gyms/manage">
      <div className="breadcrumb">
        <Link to="/gyms/manage">체육관 관리</Link>
        <span>/</span>
        <span>{isNew ? '새 체육관 등록' : listing!.name}</span>
      </div>
      <div className="eco-page-head">
        <div>
          <div className="eco-kicker">체육관 관리자</div>
          <h2>{isNew ? '새 체육관 등록' : listing!.name}</h2>
          {!isNew && listing && (
            <div className="eco-row" style={{ marginTop: 6 }}>
              <span className={LISTING_STATUS_PILL[listing.status]}>{LISTING_STATUS_LABEL[listing.status]}</span>
              {listing.status === 'approved' && (
                <Link to={`/gyms/${listing.id}`} className="eco-meta">
                  <Icon name="external" /> 공개 화면 보기
                </Link>
              )}
            </div>
          )}
        </div>
      </div>
      {listing && (listing.status === 'rejected' || listing.status === 'suspended') && (
        <div className="eco-notice">
          {listing.status === 'rejected' ? '등록이 반려되었습니다.' : '공개가 정지되었습니다.'}
          {listing.reviewNote ? ` 플랫폼 메모: ${listing.reviewNote}` : ''} 정보를 고쳐 저장한 뒤 플랫폼에 다시 검토를 요청해 주세요.
        </div>
      )}
      {listing?.status === 'pending' && <div className="eco-notice eco-notice--accent">플랫폼이 검토 중입니다. 승인되면 검색에 공개됩니다.</div>}

      {!isNew && listing && (
        <div className="eco-tabs" role="tablist">
          {TABS.map(([k, label]) => (
            <button key={k} type="button" role="tab" className="eco-tab" aria-selected={tab === k} onClick={() => setTab(k)}>
              {label}
            </button>
          ))}
        </div>
      )}

      {(isNew || tab === 'info') && <ListingForm userId={user.id} listing={listing} onSaved={(l) => setListing(l)} />}
      {listing && tab === 'pricing' && <PricingSection listingId={listing.id} />}
      {listing && tab === 'partner' && <PartnershipSection listing={listing} />}
      {listing && tab === 'offers' && <OffersSection listingId={listing.id} />}
      {listing && tab === 'coupons' && <CouponsSection listingId={listing.id} />}
      {listing && tab === 'stats' && <StatsSection listingId={listing.id} />}
    </GymPage>
  );
}

// ---------------- 기본 정보 폼 ----------------

interface FormState {
  name: string;
  arts: GymArt[];
  description: string;
  coverImageUrl: string | null;
  address: string;
  region: string;
  lat: string;
  lng: string;
  phone: string;
  website: string;
  instagram: string;
  youtube: string;
  blog: string;
  hours: string;
  facilities: string;
  instructors: InstructorInfo[];
  schedule: ScheduleItem[];
  gymId: string;
}

function toForm(l: GymListing | null): FormState {
  return {
    name: l?.name ?? '',
    arts: l?.arts ?? [],
    description: l?.description ?? '',
    coverImageUrl: l?.coverImageUrl ?? null,
    address: l?.address ?? '',
    region: l?.region ?? '',
    lat: l?.lat != null ? String(l.lat) : '',
    lng: l?.lng != null ? String(l.lng) : '',
    phone: l?.phone ?? '',
    website: l?.website ?? '',
    instagram: l?.sns?.instagram ?? '',
    youtube: l?.sns?.youtube ?? '',
    blog: l?.sns?.blog ?? '',
    hours: l?.hours ?? '',
    facilities: (l?.facilities ?? []).join(', '),
    instructors: l?.instructors ?? [],
    schedule: l?.schedule ?? [],
    gymId: l?.gymId ?? '',
  };
}

function toInput(f: FormState): GymListingInput | string {
  const lat = f.lat.trim() === '' ? null : Number(f.lat);
  const lng = f.lng.trim() === '' ? null : Number(f.lng);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) return '위도는 -90 ~ 90 사이 숫자로 입력해 주세요.';
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) return '경도는 -180 ~ 180 사이 숫자로 입력해 주세요.';
  const sns: Record<string, string> = {};
  if (f.instagram.trim()) sns.instagram = f.instagram.trim();
  if (f.youtube.trim()) sns.youtube = f.youtube.trim();
  if (f.blog.trim()) sns.blog = f.blog.trim();
  const facilities = [...new Set(f.facilities.split(',').map((s) => s.trim()).filter(Boolean))];
  if (facilities.length > 30) return '시설은 30개까지 입력할 수 있습니다.';
  const instructors = f.instructors
    .map((i) => ({ name: i.name.trim(), title: i.title.trim(), career: i.career.trim() }))
    .filter((i) => i.name || i.title || i.career);
  if (instructors.some((i) => !i.name)) return '지도자 이름을 입력하거나 빈 줄을 지워 주세요.';
  const schedule = f.schedule
    .map((s) => ({ day: s.day.trim(), time: s.time.trim(), className: s.className.trim() }))
    .filter((s) => s.day || s.time || s.className);
  if (schedule.some((s) => !s.day || !s.time)) return '시간표의 요일과 시간을 모두 입력하거나 빈 줄을 지워 주세요.';
  if (f.description.length > 3000) return '소개는 3000자 이하로 입력해 주세요.';
  if (f.hours.length > 600) return '운영 시간은 600자 이하로 입력해 주세요.';
  return {
    gymId: f.gymId || null,
    name: f.name,
    arts: f.arts,
    description: f.description,
    coverImageUrl: f.coverImageUrl,
    address: f.address,
    region: f.region,
    lat,
    lng,
    phone: f.phone,
    website: f.website,
    sns,
    hours: f.hours,
    facilities,
    instructors,
    schedule,
  };
}

function ListingForm({ userId, listing, onSaved }: { userId: string; listing: GymListing | null; onSaved: (l: GymListing) => void }) {
  const navigate = useNavigate();
  const [f, setF] = useState<FormState>(() => toForm(listing));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [ownedGyms, setOwnedGyms] = useState<Gym[]>([]);

  useEffect(() => {
    setF(toForm(listing));
  }, [listing]);

  useEffect(() => {
    let cancelled = false;
    void listMyGyms(userId).then((r) => {
      if (!cancelled && r.ok) setOwnedGyms(r.data.map((m) => m.gym).filter((g) => g.ownerUserId === userId));
    });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF((prev) => ({ ...prev, [k]: v }));

  function toggleArt(a: GymArt) {
    set('arts', f.arts.includes(a) ? f.arts.filter((x) => x !== a) : [...f.arts, a]);
  }

  async function handleUpload(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setUploadError(null);
    const r = await uploadGymImage(file, userId);
    setUploading(false);
    if (r.ok) set('coverImageUrl', r.data);
    else setUploadError(r.message);
  }

  async function handleSave() {
    setMsg(null);
    const input = toInput(f);
    if (typeof input === 'string') {
      setMsg({ ok: false, text: input });
      return;
    }
    const invalid = validateListing(input);
    if (invalid) {
      setMsg({ ok: false, text: invalid });
      return;
    }
    setBusy(true);
    if (!listing) {
      const r = await createListing(userId, input);
      setBusy(false);
      if (!r.ok) {
        setMsg({ ok: false, text: r.message });
        return;
      }
      navigate(`/gyms/manage/${r.data.id}`, { replace: true });
      return;
    }
    const r = await updateListing(listing.id, input);
    if (!r.ok) {
      setBusy(false);
      setMsg({ ok: false, text: r.message });
      return;
    }
    const fresh = await getGymListing(listing.id);
    setBusy(false);
    if (fresh.ok && fresh.data) onSaved(fresh.data);
    setMsg({ ok: true, text: '저장했습니다.' });
  }

  return (
    <div className="eco-form">
      {!listing && (
        <div className="eco-notice eco-notice--accent">
          등록한 체육관은 플랫폼 검토 후 승인되어야 검색에 공개됩니다. 실제로 운영 중인 체육관의 정확한 정보만 입력해 주세요.
        </div>
      )}
      <div className="eco-form-grid">
        <label>
          체육관 이름 *
          <input value={f.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
        </label>
        <label>
          지역 * (예: 서울 강남구)
          <input value={f.region} maxLength={60} onChange={(e) => set('region', e.target.value)} />
        </label>
      </div>
      <label>
        주소 *
        <input value={f.address} maxLength={200} onChange={(e) => set('address', e.target.value)} />
      </label>
      <div>
        <div className="eco-meta" style={{ fontWeight: 600, marginBottom: 6 }}>
          제공 종목 *
        </div>
        <div className="gym-arts-pick">
          {(Object.keys(GYM_ARTS) as GymArt[]).map((a) => (
            <label key={a} className="eco-check">
              <input type="checkbox" checked={f.arts.includes(a)} onChange={() => toggleArt(a)} />
              {GYM_ARTS[a]}
            </label>
          ))}
        </div>
      </div>
      <div className="eco-form-grid">
        <label>
          위도 (선택)
          <input inputMode="decimal" value={f.lat} placeholder="예: 37.4979" onChange={(e) => set('lat', e.target.value)} />
        </label>
        <label>
          경도 (선택)
          <input inputMode="decimal" value={f.lng} placeholder="예: 127.0276" onChange={(e) => set('lng', e.target.value)} />
        </label>
      </div>
      <p className="eco-meta--faint">위도·경도를 넣으면 지도 링크가 정확한 위치로 열립니다. 비워 두면 주소로 검색합니다.</p>
      <div className="eco-form-grid">
        <label>
          전화
          <input type="tel" value={f.phone} maxLength={40} onChange={(e) => set('phone', e.target.value)} />
        </label>
        <label>
          홈페이지
          <input type="url" value={f.website} maxLength={300} placeholder="https://" onChange={(e) => set('website', e.target.value)} />
        </label>
      </div>
      <div className="eco-form-grid">
        <label>
          인스타그램
          <input value={f.instagram} placeholder="https://instagram.com/..." onChange={(e) => set('instagram', e.target.value)} />
        </label>
        <label>
          유튜브
          <input value={f.youtube} placeholder="https://youtube.com/..." onChange={(e) => set('youtube', e.target.value)} />
        </label>
        <label>
          블로그
          <input value={f.blog} placeholder="https://blog..." onChange={(e) => set('blog', e.target.value)} />
        </label>
      </div>
      <label>
        운영 시간
        <textarea value={f.hours} maxLength={600} placeholder="예: 평일 10:00-22:00, 토 10:00-15:00, 일 휴무" onChange={(e) => set('hours', e.target.value)} />
      </label>
      <label>
        시설 (쉼표로 구분)
        <input value={f.facilities} placeholder="예: 샤워실, 주차, 케이지, 링" onChange={(e) => set('facilities', e.target.value)} />
      </label>
      <label>
        소개
        <textarea value={f.description} maxLength={3000} onChange={(e) => set('description', e.target.value)} />
      </label>

      <div>
        <div className="eco-meta" style={{ fontWeight: 600, marginBottom: 6 }}>
          대표 이미지 (JPG·PNG·WEBP, 8MB 이하)
        </div>
        {f.coverImageUrl && (
          <div className="eco-card__media" style={{ margin: '0 0 8px', maxWidth: 360, borderRadius: 'var(--radius-lg)' }}>
            <img src={f.coverImageUrl} alt="대표 이미지 미리보기" />
          </div>
        )}
        <div className="eco-row">
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            disabled={uploading}
            onChange={(e) => {
              void handleUpload(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          {f.coverImageUrl && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('coverImageUrl', null)}>
              이미지 빼기
            </button>
          )}
        </div>
        {uploading && <p className="eco-meta">올리는 중...</p>}
        {uploadError && (
          <p className="eco-meta" role="alert" style={{ color: 'var(--accent)' }}>
            {uploadError}
          </p>
        )}
      </div>

      <div>
        <div className="eco-row eco-row--between" style={{ marginBottom: 6 }}>
          <span className="eco-meta" style={{ fontWeight: 600 }}>
            지도자
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('instructors', [...f.instructors, { name: '', title: '', career: '' }])}>
            <Icon name="plus" /> 추가
          </button>
        </div>
        <div className="gym-rows">
          {f.instructors.length === 0 && <p className="eco-meta--faint">등록된 지도자가 없습니다.</p>}
          {f.instructors.map((ins, i) => (
            <div key={i} className="gym-row-edit">
              <label>
                이름
                <input value={ins.name} onChange={(e) => set('instructors', f.instructors.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />
              </label>
              <label>
                직함
                <input value={ins.title} placeholder="예: 관장" onChange={(e) => set('instructors', f.instructors.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
              </label>
              <label>
                경력
                <input value={ins.career} onChange={(e) => set('instructors', f.instructors.map((x, j) => (j === i ? { ...x, career: e.target.value } : x)))} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="지도자 줄 삭제" onClick={() => set('instructors', f.instructors.filter((_, j) => j !== i))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <div>
        <div className="eco-row eco-row--between" style={{ marginBottom: 6 }}>
          <span className="eco-meta" style={{ fontWeight: 600 }}>
            수업 시간표
          </span>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => set('schedule', [...f.schedule, { day: '', time: '', className: '' }])}>
            <Icon name="plus" /> 추가
          </button>
        </div>
        <div className="gym-rows">
          {f.schedule.length === 0 && <p className="eco-meta--faint">등록된 수업이 없습니다.</p>}
          {f.schedule.map((s, i) => (
            <div key={i} className="gym-row-edit">
              <label>
                요일
                <input value={s.day} placeholder="예: 월·수·금" onChange={(e) => set('schedule', f.schedule.map((x, j) => (j === i ? { ...x, day: e.target.value } : x)))} />
              </label>
              <label>
                시간
                <input value={s.time} placeholder="예: 19:00-20:30" onChange={(e) => set('schedule', f.schedule.map((x, j) => (j === i ? { ...x, time: e.target.value } : x)))} />
              </label>
              <label>
                수업
                <input value={s.className} placeholder="예: 초급 복싱" onChange={(e) => set('schedule', f.schedule.map((x, j) => (j === i ? { ...x, className: e.target.value } : x)))} />
              </label>
              <button type="button" className="btn btn-ghost btn-sm" aria-label="시간표 줄 삭제" onClick={() => set('schedule', f.schedule.filter((_, j) => j !== i))}>
                <Icon name="trash" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <label>
        내 체육관 연결 (선택)
        <select value={f.gymId} onChange={(e) => set('gymId', e.target.value)}>
          <option value="">연결하지 않음</option>
          {ownedGyms.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
          {f.gymId && !ownedGyms.some((g) => g.id === f.gymId) && <option value={f.gymId}>연결된 체육관</option>}
        </select>
      </label>
      <p className="eco-meta--faint">
        앱의 수업용 체육관(내가 만든 체육관)과 연결하면, 그 체육관 회원의 후기에 "실제 회원" 표시가 붙고 신규 회원 전용 할인에서 기존 회원이 구분됩니다.
      </p>

      <div className="eco-row">
        <button type="button" className="btn btn-primary" data-testid="gym-listing-save" disabled={busy || uploading} onClick={handleSave}>
          {busy ? '저장 중...' : listing ? '저장' : '등록 신청'}
        </button>
        {msg && (
          <span className="eco-meta" role={msg.ok ? 'status' : 'alert'} style={msg.ok ? undefined : { color: 'var(--accent)' }}>
            {msg.text}
          </span>
        )}
      </div>
    </div>
  );
}
