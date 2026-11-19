import Icon, { Glyph } from '../Icon';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { Technique } from '../../types';
import { answerText, askTrainer, type SetContext, type TrainerCheck, type TrainerTurn } from '../../lib/gymTrainer/trainer';

const QUICK = ['자극이 안 와요', '어깨가 아파요', '허리가 아파요', '무릎이 아파요', '손목이 아파요', '목이 뻐근해요'];

// The conversation outlives one rest period (the card unmounts during each set) — kept per
// session + exercise for this app run only.
const store = new Map<string, TrainerTurn[]>();

/**
 * 트레이너에게 질문 — shown under the rest timer of a 헬스 exercise. The lifter says what they feel and
 * how they think they move; the trainer corrects it, or — when "my form is fine" doesn't match the
 * symptom — asks concrete yes/no checks first.
 */
export default function TrainerPanel({ technique, set, sessionKey }: { technique: Technique; set: SetContext | null; sessionKey: string }) {
  const key = `${sessionKey}:${technique.id}`;
  const [open, setOpen] = useState(() => (store.get(key)?.length ?? 0) > 0);
  const [turns, setTurns] = useState<TrainerTurn[]>(() => store.get(key) ?? []);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [answered, setAnswered] = useState<Set<string>>(new Set());
  const endRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    store.set(key, turns);
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [key, turns]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setInput('');
    const history = turns;
    setTurns((x) => [...x, { role: 'user', text: t }]);
    const reply = await askTrainer({ technique, set, history, userText: t });
    setTurns((x) => [...x, { role: 'trainer', text: reply.message, reply }]);
    setBusy(false);
  }

  function answer(check: TrainerCheck, a: 'yes' | 'no' | 'unsure') {
    setAnswered((s) => new Set(s).add(check.question));
    void send(answerText(check, a));
  }

  if (!open) {
    return (
      <button type="button" className="btn btn-secondary trainer-open" onClick={() => setOpen(true)} data-testid="trainer-open">
        <Icon name="dumbbell" /> 트레이너에게 질문 — 자극이 안 오거나 아픈 곳이 있었나요?
      </button>
    );
  }

  return (
    <div className="trainer-panel" data-testid="trainer-panel">
      <div className="trainer-panel__head">
        <strong><Glyph set="ai" name="gym-trainer" /> AI 트레이너 · {technique.name}</strong>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
          접기
        </button>
      </div>
      {turns.length === 0 && (
        <p className="video-status-message" style={{ margin: '4px 0 8px' }}>
          방금 세트에서 느낀 점과 <strong>지금 내 자세</strong>를 말해 주세요. 예: “벤치할 때 어깨 앞쪽이 아파요. 팔꿈치는 옆으로 벌리고 바는 가슴 위로 내려요.”
        </p>
      )}
      <div className="trainer-panel__log" data-testid="trainer-log">
        {turns.map((t, i) =>
          t.role === 'user' ? (
            <div key={i} className="trainer-msg trainer-msg--user">
              {t.text}
            </div>
          ) : (
            <div key={i} className={`trainer-msg trainer-msg--coach${t.reply?.mode === 'stop' ? ' is-stop' : ''}`} data-testid="trainer-reply" data-mode={t.reply?.mode}>
              <p style={{ margin: 0 }}>{t.text}</p>
              {!!t.reply?.checks.length && (
                <div className="trainer-checks" data-testid="trainer-checks">
                  {t.reply.checks.map((c) => (
                    <div key={c.question} className="trainer-check">
                      <div className="trainer-check__q"><Icon name="info" /> {c.question}</div>
                      {c.why && <div className="trainer-check__why">{c.why}</div>}
                      {i === turns.length - 1 && !answered.has(c.question) && (
                        <div className="chip-row">
                          <button type="button" className="chip" onClick={() => answer(c, 'yes')} disabled={busy} data-testid="trainer-yes">
                            예
                          </button>
                          <button type="button" className="chip" onClick={() => answer(c, 'no')} disabled={busy} data-testid="trainer-no">
                            아니요
                          </button>
                          <button type="button" className="chip" onClick={() => answer(c, 'unsure')} disabled={busy}>
                            잘 모르겠어요
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              {!!t.reply?.cues.length && (
                <ul className="trainer-cues" data-testid="trainer-cues">
                  {t.reply.cues.map((c) => (
                    <li key={c}><Icon name="check" /> {c}</li>
                  ))}
                </ul>
              )}
              {t.reply?.nextSet && <p className="trainer-next"><Icon name="forward" /> 다음 세트: {t.reply.nextSet}</p>}
              {t.reply?.safety && (
                <p className="trainer-safety" role="alert" data-testid="trainer-safety">
                  <Icon name="warn" /> {t.reply.safety}
                </p>
              )}
              {t.reply?.source === 'rules' && t.reply.mode !== 'stop' && <p className="trainer-meta">일반 점검 질문 (AI 연결 없음)</p>}
            </div>
          )
        )}
        {busy && <div className="trainer-msg trainer-msg--coach">자세를 살펴보는 중…</div>}
        <div ref={endRef} />
      </div>
      <div className="chip-row" style={{ margin: '6px 0' }}>
        {QUICK.map((q) => (
          <button key={q} type="button" className="chip" onClick={() => setInput((v) => (v ? `${v} ${q}` : q))} disabled={busy}>
            {q}
          </button>
        ))}
      </div>
      <div className="trainer-panel__input">
        <textarea
          className="select field-full"
          rows={2}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="느낀 점 + 지금 자세 (예: 자세는 맞는 것 같은데 어깨가 아파요)"
          disabled={busy}
          data-testid="trainer-input"
        />
        <button type="button" className="btn btn-primary" onClick={() => void send(input)} disabled={busy || !input.trim()} data-testid="trainer-send">
          보내기
        </button>
      </div>
      <p className="trainer-meta">
        AI 트레이너의 일반적인 자세 조언이며 의학적 진단이 아닙니다. 날카로운 통증·저림이 있으면 바로 멈추세요. ·{' '}
        <Link to="/training/trainer">목적별 루틴·식단 짜기</Link>
      </p>
    </div>
  );
}
