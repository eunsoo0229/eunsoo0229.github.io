import Icon from '../Icon';
import { useEffect, useRef, useState } from 'react';
import { SECTION_LABEL, fieldOf, formatValue } from '../../lib/fighterProfile/catalog';
import { acceptProposal, answerInterview, editAnswer, finishInterview, pauseInterview, progress, questionFor, rejectProposal, skipCurrent, startInterview, type AskJson } from '../../lib/fighterProfile/interview';
import { liveItem } from '../../lib/fighterProfile/store';
import { getProfile } from '../../lib/fighterProfile/store';
import type { FighterProfile } from '../../lib/fighterProfile/types';
import { getCoachPreference } from '../../lib/coachProvider/preference';

type Engine = 'gemini' | 'martialdex';

async function geminiAskJson(): Promise<AskJson> {
  const { askGeminiForJson } = await import('../../lib/fighterStyle/geminiJson');
  return (p) => askGeminiForJson(p);
}

/** AI 인터뷰 — one question at a time; the app decides what is asked and saved. */
export default function InterviewChat({ profile, save }: { profile: FighterProfile; save: (p: FighterProfile) => void }) {
  const [engine, setEngine] = useState<Engine>(() => (getCoachPreference().last === 'martialdex' ? 'martialdex' : 'gemini'));
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement | null>(null);
  const iv = profile.interview;
  const prog = progress(profile);
  const current = iv.currentKey ? fieldOf(iv.currentKey) : null;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'nearest' });
  }, [iv.messages.length, iv.pending.length]);

  async function send(text: string) {
    const t = text.trim();
    if (!t || busy) return;
    setBusy(true);
    setInput('');
    try {
      const askJson = engine === 'gemini' ? await geminiAskJson() : null;
      // Read the latest stored copy so a slow AI reply can't overwrite edits made meanwhile.
      const r = await answerInterview(getProfile(), t, { askJson });
      save(r.profile);
    } finally {
      setBusy(false);
    }
  }

  const running = iv.status === 'active' && !!iv.currentKey;
  const pct = prog.total ? Math.round((prog.answered / prog.total) * 100) : 0;

  return (
    <div className="card info-card fp-interview" data-testid="fp-interview">
      <div className="fp-interview__head">
        <div>
          <strong>AI와 프로필 만들기</strong>
          <div className="fp-meta">
            기록 {prog.answered} / 질문 범위 {prog.total} {current ? `· 지금: ${SECTION_LABEL[current.section]}` : ''}
          </div>
          <div className="fp-bar" aria-label={`프로필 범위 ${pct}%`}>
            <span style={{ width: `${pct}%` }} />
          </div>
        </div>
        <label className="fp-engine">
          대화 엔진
          <select className="select" value={engine} onChange={(e) => setEngine(e.target.value as Engine)} disabled={busy} data-testid="fp-engine">
            <option value="gemini">Gemini AI (답변 해석·자연스러운 질문)</option>
            <option value="martialdex">MARTIALDEX 자체 (규칙 기반, AI 호출 없음)</option>
          </select>
        </label>
      </div>

      <div className="fp-log" data-testid="fp-log">
        {iv.messages.length === 0 && <p className="video-status-message">질문은 하나씩 드려요. 모르는 건 “모르겠어요”, 답하기 싫은 건 “건너뛰기”를 누르면 됩니다.</p>}
        {iv.messages.map((m, i) =>
          m.role === 'coach' ? (
            <div key={i} className="trainer-msg trainer-msg--coach" data-testid="fp-coach-msg">
              {m.text}
            </div>
          ) : (
            <div key={i} className="trainer-msg trainer-msg--user fp-user-msg" data-testid="fp-user-msg">
              {m.text}
              {m.key && liveItem(profile, m.key) && (
                <button type="button" className="fp-edit-link" onClick={() => save(editAnswer(profile, m.key!))} disabled={busy} title="이 답변 다시 하기">
                  수정
                </button>
              )}
            </div>
          )
        )}
        {iv.pending.map((pr) => {
          const f = fieldOf(pr.key)!;
          return (
            <div key={pr.key} className="fp-proposal" data-testid="fp-proposal">
              <div>
                말씀 중에 <strong>{f.label}</strong>: “{formatValue(f, pr.value)}”(으)로 들렸어요 — 기록할까요?
                <div className="fp-meta">근거: “{pr.evidence}”</div>
              </div>
              <div className="chip-row">
                <button type="button" className="chip" onClick={() => save(acceptProposal(profile, pr.key))} data-testid="fp-proposal-yes">
                  맞아요, 기록
                </button>
                <button type="button" className="chip" onClick={() => save(rejectProposal(profile, pr.key))}>
                  아니요
                </button>
              </div>
            </div>
          );
        })}
        {busy && <div className="trainer-msg trainer-msg--coach">답변을 정리하는 중…</div>}
        <div ref={endRef} />
      </div>

      {current?.help && running && <p className="fp-help"><Icon name="info" /> {current.help}</p>}

      {!running ? (
        <div className="chip-row" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-primary" onClick={() => save(startInterview(profile))} data-testid="fp-start">
            {iv.status === 'paused' ? '이어서 하기' : iv.status === 'finished' ? '남은 질문 이어서 하기' : 'AI와 프로필 만들기 시작'}
          </button>
        </div>
      ) : (
        <>
          {current?.options && (current.kind === 'choice' || current.kind === 'multi') && (
            <div className="chip-row fp-quick">
              {current.options.map((o) => (
                <button key={o.value} type="button" className="chip" disabled={busy} onClick={() => (current.kind === 'choice' ? void send(o.label) : setInput((v) => (v ? `${v}, ${o.label}` : o.label)))}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
          {current?.kind === 'boolean' && (
            <div className="chip-row fp-quick">
              <button type="button" className="chip" disabled={busy} onClick={() => void send('네')}>
                네
              </button>
              <button type="button" className="chip" disabled={busy} onClick={() => void send('아니요')}>
                아니요
              </button>
            </div>
          )}
          <div className="fp-input">
            <textarea
              className="select field-full"
              rows={2}
              value={input}
              placeholder={current ? questionFor(current, profile).slice(0, 60) : ''}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  void send(input);
                }
              }}
              disabled={busy}
              data-testid="fp-input"
            />
            <button type="button" className="btn btn-primary" onClick={() => void send(input)} disabled={busy || !input.trim()} data-testid="fp-send">
              보내기
            </button>
          </div>
          <div className="chip-row" style={{ marginTop: 6 }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(skipCurrent(profile))} disabled={busy} data-testid="fp-skip">
              건너뛰기
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => void send('모르겠어요')} disabled={busy} data-testid="fp-unknown">
              모르겠어요
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(pauseInterview(profile))} disabled={busy} data-testid="fp-pause">
              임시 저장 · 나중에
            </button>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => save(finishInterview(profile))} disabled={busy} data-testid="fp-finish">
              인터뷰 종료
            </button>
          </div>
        </>
      )}
      <p className="fp-meta" style={{ marginTop: 8 }}>
        {engine === 'gemini' ? 'Gemini가 답변을 읽고 질문을 다듬지만, 무엇을 묻고 저장할지는 앱이 정합니다. 다른 항목에 대한 말은 확인을 받은 뒤에만 기록해요.' : 'AI를 호출하지 않고 정해진 규칙으로 답변을 읽습니다. 애매하면 한 번 더 물어봐요.'}
      </p>
    </div>
  );
}
