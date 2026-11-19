import { Glyph } from '../Icon';
import { useState } from 'react';
import { ALL_FIELDS, BODY_METHODS, DYNAMIC_METHODS, MEASURE_KIND_LABEL, METHOD_LABEL, SECTIONS, STATIC_METHODS, formatValue, valueOf, type FieldSpec } from '../../lib/fighterProfile/catalog';
import { effectiveStatus, liveItem, withConfirmed, withItem, withoutItem } from '../../lib/fighterProfile/store';
import type { FighterProfile, MeasureMethod, ProfileItem, SectionId } from '../../lib/fighterProfile/types';

export const SOURCE_BADGE: Record<ProfileItem['source'], string> = {
  self_report: '본인 답변',
  measured: '직접 측정',
  video_observed: '영상 관찰',
  system_calculated: '자동 계산',
  coach_inferred: 'AI 추론',
};
export const STATUS_BADGE: Record<string, string> = { confirmed: '확인됨', unconfirmed: '확인 전', needs_review: '확인 필요', outdated: '오래됨' };

/** Fields shown in a section: everything top-level + per-defense / per-position detail for the ones the user named. */
function sectionFields(p: FighterProfile, s: SectionId): FieldSpec[] {
  const named = (k: string) => {
    const v = valueOf(p, k);
    return Array.isArray(v) ? v : [];
  };
  return ALL_FIELDS.filter((f) => {
    if (f.section !== s) return false;
    const d = f.key.match(/^def\.(\w+)\.\w+$/);
    if (d) return named('def.main').includes(d[1]) || !!liveItem(p, f.key);
    const ps = f.key.match(/^pos\.(\w+)\.\w+$/);
    if (ps) return [...named('pos.comfortable'), ...named('pos.uncomfortable')].includes(ps[1]) || !!liveItem(p, f.key);
    if (f.key === 'body.apeIndex') return !!liveItem(p, f.key);
    return true;
  });
}

function methodsFor(f: FieldSpec) {
  return f.measureKind === 'body' ? BODY_METHODS : f.measureKind === 'dynamic_reach' ? DYNAMIC_METHODS : STATIC_METHODS;
}

function Editor({ f, item, onSave, onCancel }: { f: FieldSpec; item: ProfileItem | null; onSave: (input: Parameters<typeof withItem>[2]) => string | null; onCancel: () => void }) {
  const cur = item?.state === 'answered' ? item.value : null;
  const [val, setVal] = useState<string>(Array.isArray(cur) ? '' : cur === null ? '' : String(cur));
  const [multi, setMulti] = useState<string[]>(Array.isArray(cur) ? cur : []);
  const m = item?.measurement;
  const [method, setMethod] = useState<string>(m?.method ?? '');
  const [date, setDate] = useState<string>(m?.measuredAt ?? '');
  const [side, setSide] = useState<string>(m?.side ?? '');
  const [conf, setConf] = useState<string>(m?.confidence ?? 'medium');
  const [cond, setCond] = useState<string>(m?.conditions ?? '');
  const [err, setErr] = useState<string | null>(null);

  function submit() {
    const value = f.kind === 'multi' ? multi : f.kind === 'boolean' ? val === 'true' : val;
    const e = onSave({
      value,
      source: f.kind === 'measurement' ? 'measured' : 'self_report',
      ...(f.kind === 'measurement' ? { measurement: { method: (method || null) as MeasureMethod | null, measuredAt: date || null, side: (side || null) as 'left' | 'right' | null, confidence: conf as 'high' | 'medium' | 'low', conditions: cond || null } } : {}),
    });
    setErr(e);
  }

  return (
    <div className="fp-editor" data-testid="fp-editor">
      {f.help && <p className="fp-help"><Glyph set="ui" name="info" /> {f.help}</p>}
      {f.kind === 'choice' && (
        <select className="select" value={val} onChange={(e) => setVal(e.target.value)} data-testid="fp-edit-value">
          <option value="">선택</option>
          {f.options!.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
      {f.kind === 'multi' && f.options && (
        <div className="chip-row">
          {f.options.map((o) => (
            <button key={o.value} type="button" className={`chip${multi.includes(o.value) ? ' chip--active' : ''}`} aria-pressed={multi.includes(o.value)} onClick={() => setMulti((x) => (x.includes(o.value) ? x.filter((y) => y !== o.value) : [...x, o.value]))}>
              {o.label}
            </button>
          ))}
        </div>
      )}
      {f.kind === 'boolean' && (
        <select className="select" value={val} onChange={(e) => setVal(e.target.value)} data-testid="fp-edit-value">
          <option value="">선택</option>
          <option value="true">예</option>
          <option value="false">아니요</option>
        </select>
      )}
      {(f.kind === 'number' || f.kind === 'measurement') && (
        <label className="fp-inline">
          <input className="select" inputMode="decimal" value={val} onChange={(e) => setVal(e.target.value)} placeholder={f.unit ?? ''} data-testid="fp-edit-value" style={{ maxWidth: 120 }} /> {f.unit}
        </label>
      )}
      {f.kind === 'text' && <textarea className="select field-full" rows={2} value={val} onChange={(e) => setVal(e.target.value)} data-testid="fp-edit-value" />}
      {f.kind === 'measurement' && (
        <div className="fp-measure">
          <span className="fp-meta">
            측정 종류: <strong>{MEASURE_KIND_LABEL[f.measureKind ?? 'body']}</strong>
            {f.limb ? ` · ${f.limb === 'lead' ? '앞손/앞발' : '뒷손/뒷발'}` : ''}
          </span>
          <select className="select" value={method} onChange={(e) => setMethod(e.target.value)} aria-label="측정 방법" data-testid="fp-edit-method">
            <option value="">측정 방법 (모르면 비워 두기)</option>
            {methodsFor(f).map((x) => (
              <option key={x.value} value={x.value}>
                {x.label}
              </option>
            ))}
          </select>
          <input className="select" type="date" value={date} onChange={(e) => setDate(e.target.value)} aria-label="측정 날짜" />
          {f.measureKind !== 'body' && (
            <select className="select" value={side} onChange={(e) => setSide(e.target.value)} aria-label="좌우">
              <option value="">좌우 구분 없음</option>
              <option value="left">왼쪽</option>
              <option value="right">오른쪽</option>
            </select>
          )}
          <select className="select" value={conf} onChange={(e) => setConf(e.target.value)} aria-label="측정 신뢰도">
            <option value="high">신뢰도 높음</option>
            <option value="medium">신뢰도 보통</option>
            <option value="low">신뢰도 낮음</option>
          </select>
          <input className="select" value={cond} onChange={(e) => setCond(e.target.value)} placeholder="측정 조건 (예: 맨발, 스텝 없이)" aria-label="측정 조건" />
        </div>
      )}
      {err && (
        <p className="ai-error" role="alert">
          {err}
        </p>
      )}
      <div className="chip-row" style={{ marginTop: 6 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={submit} data-testid="fp-edit-save">
          저장
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onCancel}>
          취소
        </button>
      </div>
    </div>
  );
}

export function ItemMeta({ item }: { item: ProfileItem }) {
  const st = effectiveStatus(item);
  const m = item.measurement;
  return (
    <span className="fp-badges">
      <span className={`fp-badge fp-badge--${item.source}`}>{SOURCE_BADGE[item.source]}</span>
      {st !== 'confirmed' && <span className={`fp-badge fp-badge--${st}`}>{STATUS_BADGE[st]}</span>}
      {m && (
        <span className="fp-meta">
          {MEASURE_KIND_LABEL[m.kind]} · {m.method ? METHOD_LABEL[m.method] : '측정 방법 모름'}
          {m.side ? ` · ${m.side === 'left' ? '왼쪽' : '오른쪽'}` : ''}
          {m.measuredAt ? ` · ${m.measuredAt}` : ''} · 신뢰도 {({ high: '높음', medium: '보통', low: '낮음' } as const)[m.confidence]}
          {m.conditions ? ` · ${m.conditions}` : ''}
        </span>
      )}
    </span>
  );
}

/** 상세 프로필 — every category, item by item: edit, delete, confirm. */
export default function ProfileDetail({ profile, save, initialSection }: { profile: FighterProfile; save: (p: FighterProfile) => void; initialSection?: SectionId | null }) {
  const [open, setOpen] = useState<SectionId | null>(initialSection ?? 'training');
  const [editing, setEditing] = useState<string | null>(null);
  const [showEmpty, setShowEmpty] = useState(false);

  return (
    <div className="fp-detail" data-testid="fp-detail">
      <label className="fp-inline fp-meta" style={{ marginBottom: 8 }}>
        <input type="checkbox" checked={showEmpty} onChange={(e) => setShowEmpty(e.target.checked)} /> 비어 있는 항목도 보기 (직접 입력)
      </label>
      {SECTIONS.filter((s) => s.id !== 'style').map((s) => {
        const fields = sectionFields(profile, s.id);
        const filled = fields.filter((f) => liveItem(profile, f.key));
        const shown = showEmpty ? fields : filled;
        return (
          <div key={s.id} className="card info-card fp-section" data-testid={`fp-section-${s.id}`}>
            <button type="button" className="fp-section__head" onClick={() => setOpen(open === s.id ? null : s.id)} aria-expanded={open === s.id}>
              <span>
                <Glyph set="fighter" name={s.id} /> {s.label}
              </span>
              <span className="fp-meta">{filled.length}개 기록</span>
            </button>
            {open === s.id && (
              <ul className="fp-items">
                {shown.length === 0 && <li className="fp-meta">아직 기록이 없어요. AI 인터뷰로 채우거나 “비어 있는 항목도 보기”로 직접 입력할 수 있어요.</li>}
                {shown.map((f) => {
                  const it = liveItem(profile, f.key);
                  return (
                    <li key={f.key} className="fp-item" data-testid="fp-item" data-key={f.key}>
                      <div className="fp-item__row">
                        <div>
                          <div className="fp-item__label">{f.label}</div>
                          <div className="fp-item__value">
                            {!it ? <span className="fp-meta">비어 있음</span> : it.state === 'answered' ? formatValue(f, it.value) : it.state === 'unknown' ? <span className="fp-meta">미확인{it.note ? ` — “${it.note}”` : ''}</span> : <span className="fp-meta">건너뜀</span>}
                          </div>
                          {it && <ItemMeta item={it} />}
                          {it?.note && it.state === 'answered' && f.kind !== 'text' && <div className="fp-meta">원래 답변: “{it.note}”</div>}
                        </div>
                        <div className="fp-item__actions">
                          {f.key !== 'body.apeIndex' && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(editing === f.key ? null : f.key)} data-testid="fp-edit">
                              {it ? '수정' : '입력'}
                            </button>
                          )}
                          {it && it.state === 'answered' && effectiveStatus(it) !== 'confirmed' && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(withConfirmed(profile, f.key))} data-testid="fp-confirm">
                              맞아요
                            </button>
                          )}
                          {it && f.key !== 'body.apeIndex' && (
                            <button type="button" className="btn btn-ghost btn-sm" onClick={() => window.confirm(`“${f.label}” 기록을 지울까요?`) && save(withoutItem(profile, f.key, 'user'))} data-testid="fp-delete">
                              삭제
                            </button>
                          )}
                        </div>
                      </div>
                      {editing === f.key && (
                        <Editor
                          f={f}
                          item={it}
                          onCancel={() => setEditing(null)}
                          onSave={(input) => {
                            const r = withItem(profile, f.key, input, 'user');
                            if (!r.ok) return r.message;
                            save(r.profile);
                            setEditing(null);
                            return null;
                          }}
                        />
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        );
      })}
    </div>
  );
}

