import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import ErrorState from '../../components/ErrorState';
import Icon from '../../components/Icon';
import LoadingState from '../../components/LoadingState';
import { CoinAmount, MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import {
  CREATOR_STATUS_LABEL,
  PRODUCT_STATUS_LABEL,
  PRODUCT_TYPE_LABEL,
  deleteProduct,
  getCreatorProfile,
  listMyProducts,
  saveMyCreatorProfile,
  setProductOnSale,
  submitProduct,
  type CreatorProduct,
  type CreatorProfile,
  type Credential,
} from '../../lib/monetization/service';

export default function CreatorStudio() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CreatorProfile | null | undefined>(undefined);
  const [products, setProducts] = useState<CreatorProduct[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState({ display_name: '', bio: '', specialties: '', years_training: '', is_minor: false, guardian_consent: false });
  const [creds, setCreds] = useState<Credential[]>([]);

  async function load() {
    if (!user) return;
    const [p, pr] = await Promise.all([getCreatorProfile(user.id), listMyProducts(user.id)]);
    if (!p.ok) return setError(p.message);
    setProfile(p.data);
    setProducts(pr.ok ? pr.data : []);
    if (p.data) {
      setForm({ display_name: p.data.display_name, bio: p.data.bio, specialties: p.data.specialties.join(', '), years_training: p.data.years_training?.toString() ?? '', is_minor: p.data.is_minor, guardian_consent: p.data.guardian_consent });
      setCreds(p.data.credentials);
    }
  }
  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  async function saveProfile() {
    if (!form.display_name.trim()) return setError('활동명을 입력해 주세요.');
    const r = await saveMyCreatorProfile({
      display_name: form.display_name.trim(),
      bio: form.bio,
      specialties: form.specialties.split(',').map((s) => s.trim()).filter(Boolean).slice(0, 10),
      years_training: form.years_training ? Number(form.years_training) : null,
      credentials: creds.filter((c) => c.title.trim()).map((c) => ({ title: c.title.trim(), issuer: c.issuer?.trim(), year: c.year?.trim() })),
      is_minor: form.is_minor,
      guardian_consent: form.guardian_consent,
    });
    if (!r.ok) return setError(r.message);
    setEditing(false);
    setNotice(r.data.status === 'approved' ? '프로필을 저장했습니다.' : '창작자 신청이 접수되었습니다. 운영자 검토 후 판매할 수 있습니다.');
    void load();
  }

  async function act(fn: () => Promise<{ ok: boolean; message?: string }>, done: string) {
    const r = await fn();
    if (!r.ok) return setError((r as { message: string }).message);
    setNotice(done);
    void load();
  }

  if (!user) return <MonoPage kicker="CREATOR STUDIO" title="크리에이터 스튜디오" icon="edit"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;
  if (profile === undefined && !error) return <MonoPage kicker="CREATOR STUDIO" title="크리에이터 스튜디오" icon="edit"><LoadingState /></MonoPage>;

  const showForm = !profile || editing;
  return (
    <MonoPage
      kicker="CREATOR STUDIO"
      title="크리에이터 스튜디오"
      icon="edit"
      fallback="/content"
      lede="직접 만든 커리큘럼·강의·훈련 자료를 MARTIAL COIN 으로 판매하세요. 판매 금액의 기본 85%가 창작자 몫입니다(수수료는 운영 정책에 따라 바뀔 수 있고, 구매 시점 비율로 고정)."
      actions={profile ? <><Link className="btn btn-primary btn-sm" to="/creator/products/new" data-testid="new-product">새 콘텐츠</Link><Link className="btn btn-secondary btn-sm" to="/creator/revenue">수익·정산</Link></> : undefined}
    >
      {error && <p className="gear-error" role="alert" data-testid="studio-error">{error}</p>}
      {notice && <p className="eco-notice eco-notice--accent" role="status" data-testid="studio-notice">{notice}</p>}

      {profile && !editing && (
        <section className="eco-card eco-stack" data-testid="creator-profile">
          <div className="eco-row eco-row--between">
            <strong>{profile.display_name}</strong>
            <span className={`eco-pill ${profile.status === 'approved' ? 'eco-pill--good' : 'eco-pill--warn'}`} data-testid="creator-status">{CREATOR_STATUS_LABEL[profile.status]}</span>
          </div>
          {profile.review_note && <p className="eco-meta">운영자 메모: {profile.review_note}</p>}
          <p className="eco-meta">{profile.specialties.join(' · ')} {profile.years_training != null && `· 수련 ${profile.years_training}년`}</p>
          {profile.verified_credentials.length > 0 && <div>{profile.verified_credentials.map((c, i) => <div key={i}><Icon name="verified" /> {c.title} (운영자 검증)</div>)}</div>}
          {profile.credentials.length > 0 && <div className="eco-meta">본인 입력 자격: {profile.credentials.map((c) => c.title).join(', ')} — 검증 전에는 구매자에게 "본인 입력"으로 표시됩니다.</div>}
          {profile.is_minor && <p className="eco-notice">미성년 창작자: 보호자 동의·계약 확인 전에는 정산이 보류됩니다.</p>}
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}>프로필 수정</button>
        </section>
      )}

      {showForm && (
        <section className="eco-card eco-form" data-testid="creator-form">
          <h3>{profile ? '프로필 수정' : '창작자 신청'}</h3>
          <div className="eco-form-grid">
            <label>활동명<input value={form.display_name} maxLength={40} onChange={(e) => setForm({ ...form, display_name: e.target.value })} data-testid="creator-name" /></label>
            <label>수련 경력(년)<input type="number" min={0} max={80} value={form.years_training} onChange={(e) => setForm({ ...form, years_training: e.target.value })} /></label>
          </div>
          <label>전문 분야 (쉼표로 구분)<input value={form.specialties} onChange={(e) => setForm({ ...form, specialties: e.target.value })} placeholder="복싱, 킥복싱" /></label>
          <label>소개<textarea value={form.bio} maxLength={2000} onChange={(e) => setForm({ ...form, bio: e.target.value })} /></label>
          <fieldset className="eco-stack">
            <legend>자격·인증 (본인 입력 — 운영자 검증 전에는 미검증으로 표시)</legend>
            {creds.map((c, i) => (
              <div key={i} className="eco-row">
                <input value={c.title} placeholder="자격명" onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} />
                <input value={c.issuer ?? ''} placeholder="발급 기관" onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, issuer: e.target.value } : x)))} />
                <input value={c.year ?? ''} placeholder="연도" style={{ maxWidth: 90 }} onChange={(e) => setCreds(creds.map((x, j) => (j === i ? { ...x, year: e.target.value } : x)))} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreds(creds.filter((_, j) => j !== i))}>삭제</button>
              </div>
            ))}
            {creds.length < 20 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCreds([...creds, { title: '' }])}>+ 자격 추가</button>}
          </fieldset>
          <label className="eco-row"><input type="checkbox" checked={form.is_minor} onChange={(e) => setForm({ ...form, is_minor: e.target.checked })} /> 만 19세 미만입니다</label>
          {form.is_minor && <label className="eco-row"><input type="checkbox" checked={form.guardian_consent} onChange={(e) => setForm({ ...form, guardian_consent: e.target.checked })} /> 보호자 동의를 받았습니다 (정산 전 운영자가 별도 확인)</label>}
          <div className="eco-row">
            <button type="button" className="btn btn-primary" onClick={() => void saveProfile()} data-testid="creator-save">{profile ? '저장' : '신청하기'}</button>
            {profile && <button type="button" className="btn btn-ghost" onClick={() => setEditing(false)}>취소</button>}
          </div>
        </section>
      )}

      {profile && (
        <section className="eco-stack">
          <h3>내 콘텐츠</h3>
          {products.length === 0 ? (
            <EmptyState icon="🎬" text="아직 등록한 콘텐츠가 없습니다." />
          ) : (
            <div className="eco-table-wrap">
              <table className="eco-table" data-testid="my-products">
                <thead><tr><th>제목</th><th>유형</th><th>가격</th><th>상태</th><th>판매</th><th></th></tr></thead>
                <tbody>
                  {products.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/content/${p.id}`}>{p.title}</Link>{p.review_note && <div className="eco-meta">운영자: {p.review_note}</div>}</td>
                      <td>{PRODUCT_TYPE_LABEL[p.product_type]}</td>
                      <td>{p.price_coins > 0 ? <CoinAmount value={p.price_coins} /> : '무료'}</td>
                      <td>{PRODUCT_STATUS_LABEL[p.status]}</td>
                      <td>{p.sales_count}</td>
                      <td className="eco-row">
                        {p.status !== 'suspended' && <Link className="btn btn-ghost btn-sm" to={`/creator/products/${p.id}`}>편집</Link>}
                        {(p.status === 'draft' || p.status === 'rejected') && <button type="button" className="btn btn-secondary btn-sm" onClick={() => void act(() => submitProduct(p.id), '검수를 요청했습니다.')} data-testid={`submit-${p.id}`}>검수 요청</button>}
                        {(p.status === 'approved' || p.status === 'pending_review') && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => setProductOnSale(p.id, false), '판매를 중지했습니다. 기존 구매자는 계속 열람할 수 있습니다.')}>판매 중지</button>}
                        {p.status === 'unlisted' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => void act(() => setProductOnSale(p.id, true), '판매를 재개했습니다.')}>판매 재개</button>}
                        {p.sales_count === 0 && p.status !== 'approved' && <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm('삭제할까요?') && void act(() => deleteProduct(p.id), '삭제했습니다.')}>삭제</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
      {error === null && profile === null && <p className="eco-meta--faint">타인의 영상·이미지·저작물은 판매할 수 없습니다. 허위 자격·경력 표시는 신고 대상이며 판매가 제한됩니다.</p>}
      {error && profile === undefined && <ErrorState text={error} onRetry={() => { setError(null); void load(); }} />}
    </MonoPage>
  );
}
