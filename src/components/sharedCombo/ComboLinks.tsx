import Icon from '../Icon';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { createCombo } from '../../lib/combo/service';
import { resolveTechnique } from '../../lib/userTechniques/service';
import { useAuth } from '../../lib/auth/AuthProvider';
import {
  bestFlow,
  createLink,
  deleteLink,
  groupLinks,
  listAllLinks,
  mergedSteps,
  RELATION_HELP,
  RELATION_LABEL,
  RELATIONS,
  transitionNotes,
  type ComboLink,
  type LinkGroup,
  type LinkRelation,
} from '../../lib/sharedCombo/links';
import { KIND_LABEL, type SharedCombo } from '../../lib/sharedCombo/types';
import { stepFlow } from './SharedComboCard';

// 🔗 연결된 콤보·셋업 — on a shared combo/setup's page: what it leads into,
// what leads into it, the best-supported flow onward, and (signed in) a
// form to connect it with another shared combo/setup.

function LinkRow({ group, other, direction, userId, onDelete }: { group: LinkGroup; other: SharedCombo | undefined; direction: 'out' | 'in'; userId: string | null; onDelete: (l: ComboLink) => void }) {
  const mine = group.links.find((l) => l.authorId === userId) ?? null;
  const notes = group.links.filter((l) => l.note).slice(0, 3);
  return (
    <li className="combo-link" data-testid="combo-link" data-relation={group.relation} data-direction={direction} data-other={other?.id ?? ''}>
      <div className="combo-link__head">
        <span className={`chip chip--sm combo-link__rel combo-link__rel--${group.relation}`}>
          {direction === 'out' ? '→ ' : '← '}
          {RELATION_LABEL[group.relation]}
        </span>
        {other ? (
          <Link to={`/user-combos/${other.id}`} data-testid="combo-link-target">
            <span className={`chip chip--sm shared-kind shared-kind--${other.kind}`}>{KIND_LABEL[other.kind]}</span> <strong>{other.name}</strong>
          </Link>
        ) : (
          <span className="video-status-message">공유가 취소된 콤보·셋업</span>
        )}
        <span className="technique-row__sub" data-testid="combo-link-support">
          {group.support}명이 연결
        </span>
        {mine && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(mine)} data-testid="combo-link-delete">
            내 연결 삭제
          </button>
        )}
      </div>
      {other && <p className="shared-combo-card__flow">{stepFlow(other)}</p>}
      {notes.map((l) => (
        <p key={l.id} className="combo-step__note">
          <Icon name="note" /> {l.note} <span className="technique-row__sub">— {l.authorNickname || '익명'}</span>
        </p>
      ))}
    </li>
  );
}

export default function ComboLinks({ combo, all }: { combo: SharedCombo; all: SharedCombo[] }) {
  const { user, profile } = useAuth();
  const [links, setLinks] = useState<ComboLink[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [direction, setDirection] = useState<'out' | 'in'>('out');
  const [relation, setRelation] = useState<LinkRelation>(combo.kind === 'setup' ? 'opens' : 'follow_up');
  const [query, setQuery] = useState('');
  const [targetId, setTargetId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<{ id: string; skipped: number } | null>(null);
  const byId = useMemo(() => new Map(all.map((c) => [c.id, c])), [all]);

  function load() {
    void listAllLinks().then((r) => {
      if (r.ok) setLinks(r.data);
      else {
        setLinks([]);
        setError(r.message);
      }
    });
  }
  useEffect(load, [combo.id]);

  const groups = useMemo(() => groupLinks(links ?? []), [links]);
  const outgoing = groups.filter((g) => g.fromId === combo.id);
  const incoming = groups.filter((g) => g.toId === combo.id);
  const flow = useMemo(() => bestFlow(combo.id, links ?? []).map((id) => (id === combo.id ? combo : byId.get(id))).filter((c): c is SharedCombo => !!c), [links, combo, byId]);

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return all
      .filter((c) => c.id !== combo.id && (!q || `${c.name} ${c.purpose} ${c.steps.map((s) => s.name).join(' ')}`.toLowerCase().includes(q)))
      .sort((a, b) => Number(b.martialArt === combo.martialArt) - Number(a.martialArt === combo.martialArt) || b.likeCount - a.likeCount)
      .slice(0, 8);
  }, [all, query, combo]);
  const target = targetId ? byId.get(targetId) : undefined;
  const from = direction === 'out' ? combo : target;
  const to = direction === 'out' ? target : combo;
  const notes = from && to ? transitionNotes(from, to, relation) : [];

  async function save() {
    if (!user || !from || !to) return;
    setSaving(true);
    setError(null);
    const r = await createLink({ userId: user.id, nickname: profile?.nickname ?? '', fromId: from.id, toId: to.id, relation, note });
    setSaving(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    setLinks((prev) => [r.data, ...(prev ?? [])]);
    setAdding(false);
    setTargetId(null);
    setNote('');
    setQuery('');
  }

  async function remove(l: ComboLink) {
    if (!window.confirm('내가 만든 이 연결을 삭제할까요?')) return;
    const r = await deleteLink(l.id);
    if (r.ok) setLinks((prev) => (prev ?? []).filter((x) => x.id !== l.id));
    else setError(r.message);
  }

  function saveFlow() {
    const steps = mergedSteps(flow);
    const ids = steps.map((s) => s.techniqueId).filter((id) => !!resolveTechnique(id));
    if (!ids.length) return;
    const c = createCombo({
      name: flow.map((f) => f.name).join(' → ').slice(0, 80),
      description: `사용자 콤보·셋업 연결 흐름: ${flow.map((f) => `${f.name}(${f.authorNickname || '익명'})`).join(' → ')}`,
      techniqueIds: ids,
      visualMittMeta: { createdAt: new Date().toISOString(), stance: 'orthodox', type: flow[0].kind, purpose: flow.at(-1)!.purpose, source: 'user', stepNotes: steps.filter((s) => ids.includes(s.techniqueId)).map((s) => ({ techniqueId: s.techniqueId, note: s.note ?? '', opponentReaction: s.opponentReaction ?? null })) },
    });
    setSaved({ id: c.id, skipped: steps.length - ids.length });
  }

  return (
    <section data-testid="combo-links" data-count={(outgoing.length + incoming.length).toString()}>
      <h3 className="ai-catalog__section"><Icon name="link" /> 연결된 콤보·셋업</h3>
      {links === null && (
        <p className="video-status-message">
          <span className="spinner" /> 연결을 불러오는 중…
        </p>
      )}
      {error && (
        <div className="ai-error" role="alert" data-testid="combo-links-error">
          {error}
        </div>
      )}
      {links && (
        <>
          {outgoing.length === 0 && incoming.length === 0 && (
            <p className="video-status-message" data-testid="combo-links-empty">
              아직 연결이 없습니다. 이 {KIND_LABEL[combo.kind]} 다음에 이어지거나, 막혔을 때 바꿀 수 있는 콤보·셋업을 연결해 보세요.
            </p>
          )}
          {outgoing.length > 0 && (
            <>
              <h4>이 {KIND_LABEL[combo.kind]} 다음에</h4>
              <ul className="combo-links" data-testid="combo-links-out">
                {outgoing.map((g) => (
                  <LinkRow key={`${g.toId}-${g.relation}`} group={g} other={byId.get(g.toId)} direction="out" userId={user?.id ?? null} onDelete={(l) => void remove(l)} />
                ))}
              </ul>
            </>
          )}
          {incoming.length > 0 && (
            <>
              <h4>이 {KIND_LABEL[combo.kind]}로 이어지는 앞 동작</h4>
              <ul className="combo-links" data-testid="combo-links-in">
                {incoming.map((g) => (
                  <LinkRow key={`${g.fromId}-${g.relation}`} group={g} other={byId.get(g.fromId)} direction="in" userId={user?.id ?? null} onDelete={(l) => void remove(l)} />
                ))}
              </ul>
            </>
          )}

          {flow.length >= 2 && (
            <div className="card info-card combo-flow" data-testid="combo-flow" data-ids={flow.map((f) => f.id).join(',')}>
              <strong>추천 연결 흐름</strong>
              <span className="technique-row__sub"> — 가장 많이 지지받은 연결을 따라갑니다</span>
              <p className="combo-flow__chain">
                {flow.map((f, i) => (
                  <span key={f.id}>
                    {i > 0 && <span className="combo-flow__arrow"> → </span>}
                    {f.id === combo.id ? <strong>{f.name}</strong> : <Link to={`/user-combos/${f.id}`}>{f.name}</Link>}
                  </span>
                ))}
              </p>
              <p className="shared-combo-card__flow" data-testid="combo-flow-steps">
                {stepFlow({ steps: mergedSteps(flow) })}
              </p>
              <button type="button" className="btn btn-secondary btn-sm" onClick={saveFlow} data-testid="combo-flow-save">
                <Icon name="download" /> 이 흐름을 내 콤보 북에 담기
              </button>
              {saved && (
                <p className="video-status-message" data-testid="combo-flow-saved">
                  내 콤보 북에 담았습니다{saved.skipped ? ` (내 기기에 없는 기술 ${saved.skipped}개는 제외)` : ''}. <Link to={`/combos/${saved.id}/train`}>바로 훈련하기</Link>
                </p>
              )}
            </div>
          )}

          {!user ? (
            <p className="video-status-message">
              <Link to="/login">로그인</Link>하면 이 {KIND_LABEL[combo.kind]}를 다른 콤보·셋업과 연결할 수 있습니다.
            </p>
          ) : !adding ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setAdding(true)} data-testid="combo-link-add">
              <Icon name="link" /> 다른 콤보·셋업과 연결하기
            </button>
          ) : (
            <div className="card info-card" data-testid="combo-link-form">
              <div className="chip-row">
                <button type="button" className={`chip${direction === 'out' ? ' active' : ''}`} onClick={() => setDirection('out')} data-testid="combo-link-dir-out">
                  이 {KIND_LABEL[combo.kind]} 다음에 →
                </button>
                <button type="button" className={`chip${direction === 'in' ? ' active' : ''}`} onClick={() => setDirection('in')} data-testid="combo-link-dir-in">
                  ← 이 {KIND_LABEL[combo.kind]} 앞에
                </button>
              </div>
              <div className="chip-row" style={{ marginTop: 6 }}>
                {RELATIONS.map((r) => (
                  <button key={r} type="button" className={`chip${relation === r ? ' active' : ''}`} onClick={() => setRelation(r)} data-testid={`combo-link-rel-${r}`}>
                    {RELATION_LABEL[r]}
                  </button>
                ))}
              </div>
              <p className="video-status-message" style={{ margin: '4px 0' }}>
                {RELATION_HELP[relation].replace('A', direction === 'out' ? '이 동작' : '고른 동작').replace('B', direction === 'out' ? '고른 동작' : '이 동작')}
              </p>
              <input className="select" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="연결할 콤보·셋업 검색 (이름·목적·기술)" data-testid="combo-link-search" />
              <ul className="combo-link-picker" data-testid="combo-link-candidates">
                {candidates.map((c) => (
                  <li key={c.id}>
                    <button type="button" className={`combo-link-picker__item${targetId === c.id ? ' active' : ''}`} onClick={() => setTargetId(c.id)} data-testid="combo-link-candidate" data-id={c.id}>
                      <span className={`chip chip--sm shared-kind shared-kind--${c.kind}`}>{KIND_LABEL[c.kind]}</span> <strong>{c.name}</strong>
                      <span className="technique-row__sub"> · {stepFlow(c)}</span>
                    </button>
                  </li>
                ))}
                {candidates.length === 0 && <li className="video-status-message">검색 결과가 없습니다.</li>}
              </ul>
              {from && to && (
                <div data-testid="combo-link-preview">
                  <p className="shared-combo-card__flow">
                    <strong>{from.name}</strong> → <em>{RELATION_LABEL[relation]}</em> → <strong>{to.name}</strong>
                  </p>
                  {relation !== 'if_blocked' && <p className="video-status-message">이어서 하면: {stepFlow({ steps: mergedSteps([from, to]) })}</p>}
                  {notes.map((n) => (
                    <p key={n} className="combo-step__note" data-testid="combo-link-note">
                      <Icon name="warn" /> 참고: {n}
                    </p>
                  ))}
                </div>
              )}
              <input className="select" style={{ marginTop: 6 }} value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="연결 팁 (선택) — 예: 상대가 가드를 올리면 바로 바디로" data-testid="combo-link-memo" />
              <div className="modal-actions modal-actions--start">
                <button type="button" className="btn btn-primary btn-sm" onClick={() => void save()} disabled={!target || saving} data-testid="combo-link-save">
                  {saving ? '연결하는 중…' : '연결하기'}
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setAdding(false)}>
                  취소
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  );
}
