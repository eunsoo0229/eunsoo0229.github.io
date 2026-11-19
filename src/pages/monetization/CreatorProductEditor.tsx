import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import EmptyState from '../../components/EmptyState';
import LoadingState from '../../components/LoadingState';
import { MonoPage } from '../../components/monetization/shared';
import { useAuth } from '../../lib/auth/AuthProvider';
import { getUnifiedMartialArtSummaries, searchAllTechniques } from '../../lib/userTechniques/service';
import {
  DIFFICULTY_LABEL,
  PRODUCT_TYPE_LABEL,
  getProduct,
  getProductContent,
  saveProduct,
  submitProduct,
  type ContentSection,
  type Difficulty,
  type ProductType,
} from '../../lib/monetization/service';

const EMPTY = {
  product_type: 'course' as ProductType,
  title: '',
  summary: '',
  description: '',
  target_audience: '',
  martial_art: '',
  difficulty: 'all' as Difficulty,
  est_minutes: '',
  price_coins: '1000',
  pro_included: false,
  thumbnail_url: '',
  outline: '',
  preview: '',
  rights_confirmed: false,
};

export default function CreatorProductEditor() {
  const { id } = useParams();
  const isNew = !id || id === 'new';
  const { user } = useAuth();
  const navigate = useNavigate();
  const [f, setF] = useState(EMPTY);
  const [sections, setSections] = useState<ContentSection[]>([{ title: '', text: '' }]);
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [techQuery, setTechQuery] = useState<Record<number, string>>({});
  const arts = getUnifiedMartialArtSummaries();

  useEffect(() => {
    if (isNew || !id) return;
    void (async () => {
      const [p, c] = await Promise.all([getProduct(id), getProductContent(id)]);
      setLoading(false);
      if (!p.ok || !p.data) return setError(p.ok ? '콘텐츠를 찾을 수 없습니다.' : p.message);
      const d = p.data;
      setF({
        product_type: d.product_type, title: d.title, summary: d.summary, description: d.description, target_audience: d.target_audience,
        martial_art: d.martial_art ?? '', difficulty: d.difficulty, est_minutes: d.est_minutes?.toString() ?? '', price_coins: String(d.price_coins),
        pro_included: d.pro_included, thumbnail_url: d.thumbnail_url ?? '', outline: d.outline.join('\n'), preview: d.preview?.text ?? '', rights_confirmed: d.rights_confirmed,
      });
      if (c.ok && c.data?.body.sections?.length) setSections(c.data.body.sections);
    })();
  }, [id, isNew]);

  function payload() {
    const price = Math.max(0, Math.floor(Number(f.price_coins) || 0));
    return {
      ...(isNew ? {} : { id }),
      product_type: f.product_type,
      title: f.title.trim(),
      summary: f.summary.trim(),
      description: f.description,
      target_audience: f.target_audience,
      martial_art: f.martial_art,
      difficulty: f.difficulty,
      est_minutes: f.est_minutes ? Number(f.est_minutes) : '',
      price_coins: price,
      pro_included: f.pro_included,
      thumbnail_url: /^https:\/\//.test(f.thumbnail_url) ? f.thumbnail_url : '',
      outline: f.outline.split('\n').map((s) => s.trim()).filter(Boolean).slice(0, 50),
      preview: { text: f.preview },
      technique_ids: [...new Set(sections.flatMap((s) => s.technique_ids ?? []))],
      rights_confirmed: f.rights_confirmed,
      content: { sections: sections.filter((s) => s.title.trim() || s.text.trim()).map((s) => ({ ...s, video_url: s.video_url && /^https:\/\//.test(s.video_url) ? s.video_url : undefined })) },
    };
  }

  async function save(submit: boolean) {
    if (f.title.trim().length < 2) return setError('제목을 2자 이상 입력해 주세요.');
    if (submit && !f.rights_confirmed) return setError('저작권 확인에 동의해야 검수를 요청할 수 있습니다.');
    setBusy(true);
    setError(null);
    const r = await saveProduct(payload());
    if (!r.ok) {
      setBusy(false);
      return setError(r.message);
    }
    if (submit && (r.data.status === 'draft' || r.data.status === 'rejected')) {
      const s = await submitProduct(r.data.id);
      if (!s.ok) {
        setBusy(false);
        return setError(s.message);
      }
    }
    setBusy(false);
    navigate('/creator');
  }

  if (!user) return <MonoPage kicker="CREATOR STUDIO" title="콘텐츠 편집"><EmptyState icon="🔒" text="로그인 후 이용할 수 있습니다." /></MonoPage>;
  if (loading) return <MonoPage kicker="CREATOR STUDIO" title="콘텐츠 편집"><LoadingState /></MonoPage>;

  return (
    <MonoPage kicker="CREATOR STUDIO" title={isNew ? '새 콘텐츠' : '콘텐츠 편집'} icon="edit" fallback="/creator" lede={isNew ? undefined : '판매 중인 콘텐츠를 고치면 재검수 후 다시 판매됩니다. 기존 구매자는 고친 내용을 계속 열람합니다.'}>
      {error && <p className="gear-error" role="alert" data-testid="editor-error">{error}</p>}
      <section className="eco-card eco-form" data-testid="product-editor">
        <div className="eco-form-grid">
          <label>유형
            <select value={f.product_type} onChange={(e) => setF({ ...f, product_type: e.target.value as ProductType })}>
              {(Object.keys(PRODUCT_TYPE_LABEL) as ProductType[]).map((t) => <option key={t} value={t}>{PRODUCT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label>무술
            <select value={f.martial_art} onChange={(e) => setF({ ...f, martial_art: e.target.value })}>
              <option value="">전 종목</option>
              {arts.map((a) => <option key={a.id} value={a.id}>{a.nameKo}</option>)}
            </select>
          </label>
          <label>난이도
            <select value={f.difficulty} onChange={(e) => setF({ ...f, difficulty: e.target.value as Difficulty })}>
              {(Object.keys(DIFFICULTY_LABEL) as Difficulty[]).map((d) => <option key={d} value={d}>{DIFFICULTY_LABEL[d]}</option>)}
            </select>
          </label>
          <label>예상 학습 시간(분)<input type="number" min={1} value={f.est_minutes} onChange={(e) => setF({ ...f, est_minutes: e.target.value })} /></label>
          <label>가격 (MC, 0 = 무료)<input type="number" min={0} max={1000000} value={f.price_coins} onChange={(e) => setF({ ...f, price_coins: e.target.value })} data-testid="editor-price" /></label>
          <label>썸네일 이미지 URL (https)<input value={f.thumbnail_url} onChange={(e) => setF({ ...f, thumbnail_url: e.target.value })} placeholder="https://" /></label>
        </div>
        <label>제목<input value={f.title} maxLength={80} onChange={(e) => setF({ ...f, title: e.target.value })} data-testid="editor-title" /></label>
        <label>한 줄 소개<input value={f.summary} maxLength={300} onChange={(e) => setF({ ...f, summary: e.target.value })} /></label>
        <label>상세 설명<textarea value={f.description} maxLength={8000} onChange={(e) => setF({ ...f, description: e.target.value })} /></label>
        <label>학습 대상<input value={f.target_audience} maxLength={500} onChange={(e) => setF({ ...f, target_audience: e.target.value })} placeholder="예: 잽을 처음 배우는 입문자" /></label>
        <label>공개 목차 (한 줄에 하나)<textarea value={f.outline} onChange={(e) => setF({ ...f, outline: e.target.value })} /></label>
        <label>무료 미리보기<textarea value={f.preview} maxLength={3000} onChange={(e) => setF({ ...f, preview: e.target.value })} data-testid="editor-preview" /></label>
        <label className="eco-row"><input type="checkbox" checked={f.pro_included} onChange={(e) => setF({ ...f, pro_included: e.target.checked })} /> PRO 구독자에게 무료로 포함</label>
      </section>

      <section className="eco-stack">
        <h3>본문 (구매자만 열람)</h3>
        {sections.map((s, i) => {
          const q = techQuery[i] ?? '';
          const hits = q.trim().length >= 2 ? searchAllTechniques(q).slice(0, 5) : [];
          return (
            <div key={i} className="eco-card eco-form">
              <label>{i + 1}. 소제목<input value={s.title} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))} data-testid={`section-title-${i}`} /></label>
              <label>내용<textarea rows={6} value={s.text} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)))} data-testid={`section-text-${i}`} /></label>
              <label>직접 촬영한 영상 링크 (https, 선택)<input value={s.video_url ?? ''} onChange={(e) => setSections(sections.map((x, j) => (j === i ? { ...x, video_url: e.target.value } : x)))} /></label>
              <label>기술 DB 연결<input value={q} onChange={(e) => setTechQuery({ ...techQuery, [i]: e.target.value })} placeholder="기술 이름 검색" /></label>
              {hits.length > 0 && (
                <div className="eco-row">
                  {hits.map((t) => (
                    <button key={t.id} type="button" className="eco-pill" onClick={() => {
                      setSections(sections.map((x, j) => (j === i ? { ...x, technique_ids: [...new Set([...(x.technique_ids ?? []), t.id])] } : x)));
                      setTechQuery({ ...techQuery, [i]: '' });
                    }}>+ {t.koreanName ?? t.name}</button>
                  ))}
                </div>
              )}
              {!!s.technique_ids?.length && <div className="eco-meta">연결된 기술 {s.technique_ids.length}개</div>}
              {sections.length > 1 && <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSections(sections.filter((_, j) => j !== i))}>섹션 삭제</button>}
            </div>
          );
        })}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSections([...sections, { title: '', text: '' }])}>+ 섹션 추가</button>
      </section>

      <section className="eco-card eco-stack">
        <label className="eco-row">
          <input type="checkbox" checked={f.rights_confirmed} onChange={(e) => setF({ ...f, rights_confirmed: e.target.checked })} data-testid="editor-rights" />
          이 콘텐츠는 제가 직접 만들었거나 판매할 권리가 있으며, 타인의 영상·이미지·문서를 무단으로 포함하지 않았습니다.
        </label>
        <div className="eco-row">
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void save(true)} data-testid="editor-submit">저장 후 검수 요청</button>
          <button type="button" className="btn btn-secondary" disabled={busy} onClick={() => void save(false)} data-testid="editor-save">초안 저장</button>
        </div>
      </section>
    </MonoPage>
  );
}
