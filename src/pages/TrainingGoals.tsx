import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import { GOALS_EVENT, GOAL_TEXT_MAX, deleteGoal, goalSlots, pastGoals, periodLabel, saveGoal, type GoalSlot } from '../lib/goals/store';

// 개인 목표 — free text per period (이번 주 / 이번 달 / 올해 / 내년 / 앞으로). Autosaves 1.5 s after typing stops and
// on blur / page hide, with an explicit 저장 button as well; an unsaved draft is kept in sessionStorage so leaving
// the screen mid-sentence never loses it. Periods come from today's date (store.ts), so the year labels move on
// their own and a finished week/month drops into 지난 목표 instead of being rewritten or deleted.

const DRAFT_KEY = 'martialdex:training-goals-draft';
const AUTOSAVE_MS = 1500;

const HINTS: Record<GoalSlot['slot'], string> = {
  week: '이번 주에 연습할 기술, 고치고 싶은 약점, 훈련 횟수 등 — 자유롭게',
  month: '이번 달에 집중할 능력, 익히고 싶은 기술·콤비네이션, 체계적으로 고칠 약점',
  year: '올해의 기술 수준과 성장 방향, 나가고 싶은 대회, 이루고 싶은 성과',
  next_year: '내년 계획 — 올해 목표와 이어지는 성장, 새로 도전할 분야',
  long_term: '궁극적으로 어떤 실력·스타일에 닿고 싶은지, 배우고 싶은 무술, MARTIALDEX로 이루고 싶은 것',
};

function readDrafts(): Record<string, string> {
  try {
    const raw = window.sessionStorage.getItem(DRAFT_KEY);
    return raw ? (JSON.parse(raw) as Record<string, string>) : {};
  } catch {
    return {};
  }
}
function writeDrafts(d: Record<string, string>): void {
  try {
    window.sessionStorage.setItem(DRAFT_KEY, JSON.stringify(d));
  } catch {
    /* session storage full / blocked — the in-memory state still holds the text */
  }
}

const fmt = (iso: string): string => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

export default function TrainingGoals() {
  const [tick, setTick] = useState(0);
  const slots = useMemo(() => goalSlots(), [tick]);
  const past = useMemo(() => pastGoals(), [tick]);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => readDrafts());
  // the autosave timer and the blur handler must read the LATEST text, not the drafts captured when they were
  // created — a single keystroke-then-timeout would otherwise commit an empty draft and lose the edit
  const draftsRef = useRef(drafts);
  draftsRef.current = drafts;
  const [savedAt, setSavedAt] = useState<Record<string, number>>({});
  const timers = useRef<Record<string, number>>({});

  useEffect(() => {
    const on = () => setTick((t) => t + 1);
    window.addEventListener(GOALS_EVENT, on);
    return () => window.removeEventListener(GOALS_EVENT, on);
  }, []);

  const stored = useCallback((s: GoalSlot) => s.entry?.text ?? '', []);
  const valueOf = useCallback((s: GoalSlot) => drafts[s.slot] ?? stored(s), [drafts, stored]);
  const dirty = useCallback((s: GoalSlot) => drafts[s.slot] !== undefined && drafts[s.slot] !== stored(s), [drafts, stored]);

  const commit = useCallback(
    (s: GoalSlot) => {
      const text = draftsRef.current[s.slot];
      if (text === undefined || text === stored(s)) return;
      saveGoal(s.scope, s.periodKey, text);
      const next = { ...draftsRef.current };
      delete next[s.slot];
      draftsRef.current = next;
      writeDrafts(next);
      setDrafts(next);
      setSavedAt((m) => ({ ...m, [s.slot]: Date.now() }));
      setTick((t) => t + 1);
    },
    [stored]
  );

  // everything unsaved is written when the page is hidden or unmounted (app backgrounded, tab closed, navigation)
  const pending = useRef<() => void>(() => {});
  pending.current = () => slots.forEach((s) => commit(s));
  useEffect(() => {
    const onHide = () => pending.current();
    window.addEventListener('pagehide', onHide);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      document.removeEventListener('visibilitychange', onHide);
      pending.current();
      Object.values(timers.current).forEach((t) => window.clearTimeout(t));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onChange = (s: GoalSlot, text: string) => {
    const next = { ...draftsRef.current, [s.slot]: text.slice(0, GOAL_TEXT_MAX) };
    draftsRef.current = next;
    writeDrafts(next);
    setDrafts(next);
    window.clearTimeout(timers.current[s.slot]);
    timers.current[s.slot] = window.setTimeout(() => commit(s), AUTOSAVE_MS);
  };

  const onDelete = (s: GoalSlot) => {
    deleteGoal(s.scope, s.periodKey);
    const next = { ...draftsRef.current };
    delete next[s.slot];
    draftsRef.current = next;
    writeDrafts(next);
    setDrafts(next);
    setTick((t) => t + 1);
  };

  const written = slots.filter((s) => valueOf(s).trim()).length;

  return (
    <div className="page" data-testid="training-goals">
      <div className="container">
        <BackButton />
        <div className="section-title">
          <h1><Icon name="target" /> 개인 목표</h1>
        </div>
        <p className="video-status-message" data-testid="goals-intro">
          훈련 방향을 자유롭게 적어 두면 AI 코치가 대화·수업·커리큘럼에서 이 목표를 참고합니다. 빈칸으로 두어도 됩니다. 작성한 목표는 {written}개이고, 기간이 지난 목표는 아래에 그대로 남습니다 (자동으로 지우지 않습니다).
        </p>

        {slots.map((s) => {
          const v = valueOf(s);
          const isDirty = dirty(s);
          return (
            <section key={s.slot} className="card info-card goal-card" data-testid="goal-card" data-slot={s.slot} data-period={s.periodKey}>
              <div className="goal-card__head">
                <h3>{s.label}</h3>
                <span className="video-status-message" data-testid="goal-state">
                  {isDirty ? '저장 안 됨' : savedAt[s.slot] ? '저장됨' : s.entry ? `마지막 수정 ${fmt(s.entry.updatedAt)}` : '작성 전'}
                </span>
              </div>
              <textarea
                className="goal-card__text"
                rows={4}
                placeholder={HINTS[s.slot]}
                value={v}
                maxLength={GOAL_TEXT_MAX}
                onChange={(e) => onChange(s, e.target.value)}
                onBlur={() => commit(s)}
                data-testid="goal-input"
                aria-label={s.label}
              />
              <div className="goal-card__actions">
                <button type="button" className="btn btn-primary btn-sm" disabled={!isDirty} onClick={() => commit(s)} data-testid="goal-save">
                  저장
                </button>
                {s.entry && (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => onDelete(s)} data-testid="goal-delete">
                    삭제
                  </button>
                )}
                <span className="video-status-message">
                  {v.length}/{GOAL_TEXT_MAX}자 · 1.5초 후 자동 저장
                </span>
              </div>
            </section>
          );
        })}

        {past.length > 0 && (
          <details className="card info-card" data-testid="goals-past">
            <summary>지난 목표 ({past.length}) — 기간이 끝난 목표, 지우지 않고 보관합니다</summary>
            <ul className="goal-past-list">
              {past.map((e) => (
                <li key={e.id} data-testid="goal-past-item" data-period={e.periodKey}>
                  <strong>{periodLabel(e)}</strong> <span className="video-status-message">마지막 수정 {fmt(e.updatedAt)}</span>
                  <p>{e.text}</p>
                </li>
              ))}
            </ul>
          </details>
        )}

        <div className="card info-card">
          <p className="video-status-message">
            AI 코치는 이 목표를 읽기만 합니다 — 코치가 목표를 고치거나 지우지 않습니다. 저장하지 않은 내용은 이 기기에만 임시 보관되고, 저장하면 로그인한 계정의 백업·동기화 대상에 포함됩니다.
          </p>
          <div className="chip-row">
            <Link to="/fighter-profile" className="btn btn-secondary btn-sm">
              개인 파이터 프로필 →
            </Link>
            <Link to="/coach/chat" className="btn btn-secondary btn-sm">
              AI 코치와 대화하기 →
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
