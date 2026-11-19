// /gear/new, /gear/:id/edit — 장비 판매 글 작성·수정
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import Icon from '../../components/Icon';
import BackButton from '../../components/BackButton';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import ErrorState from '../../components/ErrorState';
import { useAuth } from '../../lib/auth/AuthProvider';
import { validateImage } from '../../lib/ecosystem/common';
import {
  GEAR_ARTS,
  GEAR_CATEGORIES,
  GEAR_CONDITIONS,
  SIZE_HINT,
  createGear,
  getGear,
  updateGear,
  uploadGearImage,
  validateGearInput,
  type GearCategory,
  type GearCondition,
  type GearInput,
} from '../../lib/gear/service';
import { NotConfigured } from './gearShared';

const MAX_IMAGES = 8;

type Field = 'title' | 'price' | 'usage' | 'trade' | 'images' | 'description' | 'form';
function fieldOf(msg: string): Field {
  if (msg.includes('상품명')) return 'title';
  if (msg.includes('가격')) return 'price';
  if (msg.includes('사용 기간')) return 'usage';
  if (msg.includes('직거래') || msg.includes('택배') || msg.includes('배송비')) return 'trade';
  if (msg.includes('사진')) return 'images';
  if (msg.includes('설명')) return 'description';
  return 'form';
}

interface UploadJob {
  key: string;
  name: string;
  state: 'uploading' | 'error';
  message?: string;
}

export default function GearEditor() {
  const { id } = useParams<{ id: string }>();
  const editing = !!id;
  const navigate = useNavigate();
  const { user, profile, isConfigured } = useAuth();

  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<GearCategory>('boxing_gloves');
  const [martialArt, setMartialArt] = useState('');
  const [brand, setBrand] = useState('');
  const [size, setSize] = useState('');
  const [usageMonths, setUsageMonths] = useState('');
  const [condition, setCondition] = useState<GearCondition>('good');
  const [price, setPrice] = useState('');
  const [description, setDescription] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [region, setRegion] = useState('');
  const [shipping, setShipping] = useState(false);
  const [shippingFee, setShippingFee] = useState('');
  const [meetup, setMeetup] = useState(true);

  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [loading, setLoading] = useState(editing);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [notOwner, setNotOwner] = useState(false);
  const [saving, setSaving] = useState(false);
  const [fieldError, setFieldError] = useState<{ field: Field; message: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing || !id || !isConfigured || !user) return;
    let alive = true;
    setLoading(true);
    void getGear(id).then((r) => {
      if (!alive) return;
      setLoading(false);
      if (!r.ok) {
        setLoadError(r.message);
        return;
      }
      const g = r.data;
      if (!g) {
        setLoadError('상품을 찾을 수 없습니다.');
        return;
      }
      if (g.sellerId !== user.id) {
        setNotOwner(true);
        return;
      }
      setTitle(g.title);
      setCategory(g.category);
      setMartialArt(g.martialArt ?? '');
      setBrand(g.brand);
      setSize(g.size);
      setUsageMonths(g.usageMonths === null ? '' : String(g.usageMonths));
      setCondition(g.condition);
      setPrice(String(g.price));
      setDescription(g.description);
      setImages(g.images);
      setRegion(g.region);
      setShipping(g.shippingAvailable);
      setShippingFee(g.shippingFee ? String(g.shippingFee) : '');
      setMeetup(g.meetupAvailable);
    });
    return () => {
      alive = false;
    };
  }, [editing, id, isConfigured, user]);

  if (!isConfigured) return <NotConfigured fallback="/gear" />;

  if (!user) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <EmptyState icon="🔒" text="상품을 올리려면 로그인이 필요합니다." />
          <div className="eco-row gear-center">
            <Link className="btn btn-primary" to="/login">
              로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }
  if (loading) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <LoadingState />
        </div>
      </div>
    );
  }
  if (loadError || notOwner) {
    return (
      <div className="page">
        <div className="container">
          <BackButton fallback="/gear" />
          <ErrorState text={notOwner ? '내가 올린 상품만 수정할 수 있습니다.' : loadError ?? ''} />
        </div>
      </div>
    );
  }

  const me = user;
  const uploading = jobs.some((j) => j.state === 'uploading');
  const room = MAX_IMAGES - images.length - jobs.filter((j) => j.state === 'uploading').length;

  async function handleFiles(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (!files.length) return;
    const accepted = files.slice(0, Math.max(0, room));
    const overflow = files.slice(accepted.length);
    const newJobs: UploadJob[] = [];
    const toUpload: { key: string; file: File }[] = [];
    for (const file of accepted) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const invalid = validateImage(file);
      if (invalid) newJobs.push({ key, name: file.name, state: 'error', message: invalid });
      else {
        newJobs.push({ key, name: file.name, state: 'uploading' });
        toUpload.push({ key, file });
      }
    }
    for (const file of overflow) {
      newJobs.push({ key: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name, state: 'error', message: `사진은 ${MAX_IMAGES}장까지 올릴 수 있습니다.` });
    }
    setJobs((cur) => [...cur, ...newJobs]);
    for (const { key, file } of toUpload) {
      const r = await uploadGearImage(file, me.id);
      if (r.ok) {
        setImages((cur) => (cur.length < MAX_IMAGES ? [...cur, r.data] : cur));
        setJobs((cur) => cur.filter((j) => j.key !== key));
      } else {
        setJobs((cur) => cur.map((j) => (j.key === key ? { ...j, state: 'error', message: r.message } : j)));
      }
    }
  }

  function moveLeft(i: number) {
    if (i <= 0) return;
    setImages((cur) => {
      const next = [...cur];
      [next[i - 1], next[i]] = [next[i], next[i - 1]];
      return next;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (uploading) return;
    const priceNum = price.trim() === '' ? NaN : Number(price.replace(/[,\s]/g, ''));
    const usageNum = usageMonths.trim() === '' ? null : Number(usageMonths);
    const input: GearInput = {
      title,
      category,
      martialArt: martialArt || null,
      brand,
      size,
      usageMonths: usageNum,
      condition,
      price: priceNum,
      description,
      images,
      region,
      shippingAvailable: shipping,
      shippingFee: shippingFee.trim() === '' ? 0 : Number(shippingFee.replace(/[,\s]/g, '')),
      meetupAvailable: meetup,
    };
    const invalid = validateGearInput(input);
    if (invalid) {
      setFieldError({ field: fieldOf(invalid), message: invalid });
      return;
    }
    setFieldError(null);
    setSaving(true);
    if (editing && id) {
      const r = await updateGear(id, input);
      setSaving(false);
      if (!r.ok) {
        setFieldError({ field: fieldOf(r.message), message: r.message });
        return;
      }
      navigate(`/gear/${id}`, { replace: true });
    } else {
      const r = await createGear(me.id, profile?.nickname ?? '', input);
      setSaving(false);
      if (!r.ok) {
        setFieldError({ field: fieldOf(r.message), message: r.message });
        return;
      }
      navigate(`/gear/${r.data.id}`, { replace: true });
    }
  }

  const err = (f: Field) =>
    fieldError?.field === f ? (
      <span className="gear-error" role="alert">
        {fieldError.message}
      </span>
    ) : null;

  return (
    <div className="page gear-page">
      <div className="container gear-editor">
        <BackButton fallback={editing && id ? `/gear/${id}` : '/gear'} />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">장비 거래</div>
            <h2>{editing ? '판매 글 수정' : '장비 판매하기'}</h2>
          </div>
        </div>

        <div className="eco-notice eco-notice--accent">
          <strong>
            <Icon name="info" /> 올리기 전에 확인하세요
          </strong>
          <ul>
            <li>설명에 전화번호·계좌번호·주소 같은 개인정보를 적지 마세요. 연락은 앱 메시지로 합니다.</li>
            <li>만 19세 미만이면 보호자와 함께 거래하세요.</li>
            <li>상태는 아래 기준 중 실제와 가장 가까운 것을 고르고, 흠집·변형은 사진과 설명으로 보여 주세요.</li>
          </ul>
        </div>

        <form className="eco-form" onSubmit={(e) => void handleSubmit(e)} noValidate>
          <label>
            상품명
            <input value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} placeholder="예: 윈닝 12oz 복싱 글러브" aria-invalid={fieldError?.field === 'title'} />
            {err('title')}
          </label>

          <div className="eco-form-grid">
            <label>
              상품 종류
              <select value={category} onChange={(e) => setCategory(e.target.value as GearCategory)}>
                {(Object.keys(GEAR_CATEGORIES) as GearCategory[]).map((k) => (
                  <option key={k} value={k}>
                    {GEAR_CATEGORIES[k]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              종목
              <select value={martialArt} onChange={(e) => setMartialArt(e.target.value)}>
                <option value="">공통 (특정 종목 아님)</option>
                {GEAR_ARTS.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              브랜드
              <input value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} placeholder="모르면 비워 두세요" />
            </label>
            <label>
              사이즈
              <input value={size} maxLength={40} onChange={(e) => setSize(e.target.value)} placeholder={SIZE_HINT[category]} />
              <span className="eco-meta--faint">{SIZE_HINT[category]}</span>
            </label>
          </div>

          <label>
            상태
            <select value={condition} onChange={(e) => setCondition(e.target.value as GearCondition)}>
              {(Object.keys(GEAR_CONDITIONS) as GearCondition[]).map((k) => (
                <option key={k} value={k}>
                  {GEAR_CONDITIONS[k].label} — {GEAR_CONDITIONS[k].note}
                </option>
              ))}
            </select>
            <span className="eco-meta--faint">{GEAR_CONDITIONS[condition].note}</span>
          </label>

          <div className="eco-form-grid">
            <label>
              가격 (원)
              <input inputMode="numeric" value={price} onChange={(e) => setPrice(e.target.value.replace(/[^\d]/g, ''))} placeholder="0이면 무료 나눔" aria-invalid={fieldError?.field === 'price'} />
              {err('price')}
            </label>
            <label>
              사용 기간 (개월)
              <input inputMode="numeric" value={usageMonths} onChange={(e) => setUsageMonths(e.target.value.replace(/[^\d]/g, ''))} placeholder="모르면 비워 두세요" aria-invalid={fieldError?.field === 'usage'} />
              {err('usage')}
            </label>
            <label>
              거래 지역
              <input value={region} maxLength={60} onChange={(e) => setRegion(e.target.value)} placeholder="예: 서울 마포구" />
            </label>
          </div>

          <fieldset className="gear-fieldset">
            <legend>거래 방법</legend>
            <div className="eco-row">
              <label className="eco-check">
                <input type="checkbox" checked={meetup} onChange={(e) => setMeetup(e.target.checked)} /> 직거래
              </label>
              <label className="eco-check">
                <input type="checkbox" checked={shipping} onChange={(e) => setShipping(e.target.checked)} /> 택배
              </label>
            </div>
            {shipping && (
              <label style={{ marginTop: 8 }}>
                배송비 (원, 무료배송이면 비워 두세요)
                <input inputMode="numeric" value={shippingFee} onChange={(e) => setShippingFee(e.target.value)} placeholder="예: 3500" data-testid="gear-shipping-fee" />
                <span className="eco-meta--faint">택배 거래는 구매자가 앱에서 상품 가격 + 배송비를 결제합니다(현재 Toss 테스트 결제). 결제 후 송장 번호를 입력해 발송 처리하세요.</span>
              </label>
            )}
            {err('trade')}
          </fieldset>

          <label>
            설명
            <textarea
              value={description}
              maxLength={3000}
              rows={6}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="구매 시기, 사용 빈도, 흠집·냄새·변형 여부, 세탁 여부 등을 적어 주세요."
              aria-invalid={fieldError?.field === 'description'}
            />
            <span className="eco-meta--faint">{description.length}/3000</span>
            {err('description')}
          </label>

          <fieldset className="gear-fieldset">
            <legend>
              사진 ({images.length}/{MAX_IMAGES})
            </legend>
            <p className="eco-meta--faint">첫 번째 사진이 목록 대표 사진이 됩니다. JPG·PNG·WEBP·GIF, 장당 8MB 이하.</p>
            <div className="gear-editor__images">
              {images.map((src, i) => (
                <div key={src} className="gear-editor__img">
                  <img src={src} alt={`사진 ${i + 1}`} />
                  {i === 0 && <span className="eco-pill eco-pill--accent gear-editor__cover">대표</span>}
                  <div className="gear-editor__img-actions">
                    <button type="button" className="btn btn-ghost btn-sm" disabled={i === 0} onClick={() => moveLeft(i)} aria-label={`사진 ${i + 1} 앞으로 이동`}>
                      <Icon name="prev" />
                    </button>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImages((cur) => cur.filter((_, j) => j !== i))} aria-label={`사진 ${i + 1} 삭제`}>
                      <Icon name="close" />
                    </button>
                  </div>
                </div>
              ))}
              {jobs
                .filter((j) => j.state === 'uploading')
                .map((j) => (
                  <div key={j.key} className="gear-editor__img gear-editor__img--pending">
                    <span className="eco-meta">업로드 중...</span>
                  </div>
                ))}
              {room > 0 && (
                <label className="gear-editor__add">
                  <Icon name="upload" />
                  <span>사진 추가</span>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    multiple
                    hidden
                    data-testid="gear-image-input"
                    onChange={(e) => void handleFiles(e)}
                  />
                </label>
              )}
            </div>
            {jobs.some((j) => j.state === 'error') && (
              <ul className="gear-upload-errors">
                {jobs
                  .filter((j) => j.state === 'error')
                  .map((j) => (
                    <li key={j.key} className="gear-error">
                      {j.name}: {j.message}
                    </li>
                  ))}
                <li>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => setJobs((cur) => cur.filter((j) => j.state !== 'error'))}>
                    오류 지우기
                  </button>
                </li>
              </ul>
            )}
            {err('images')}
          </fieldset>

          {err('form')}
          <div className="eco-row">
            <button type="submit" className="btn btn-primary" data-testid="gear-save" disabled={saving || uploading}>
              {saving ? '저장 중...' : uploading ? '사진 업로드 중...' : editing ? '수정 저장' : '판매 글 올리기'}
            </button>
            <Link className="btn btn-ghost" to={editing && id ? `/gear/${id}` : '/gear'}>
              취소
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}
