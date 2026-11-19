import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon, { Glyph, type IconName } from '../components/Icon';
import AutoGrowTextarea from '../components/AutoGrowTextarea';
import { runCoachTurn } from '../lib/selfAi/coachAgent';
import EvidencePanel from '../components/coach/EvidencePanel';
import { appCoachDeps } from '../lib/selfAi/deps';
import { acceptLessonAddition, lessonSourcesFor, startLessonFromProposal } from '../lib/selfAi/chatLesson';
import { loadKnowledgeIndex } from '../lib/martialdexKnowledge/loadIndex';
import { selfResearchProvider } from '../lib/selfResearch/provider';
import {
  appendMessage,
  createConversation,
  deleteConversation,
  updateConversation,
  useConversation,
  useConversationList,
} from '../lib/selfAi/conversationStore';
import type { CoachChatMessage } from '../lib/selfAi/types';
import { PROBLEM_LABEL, type ClaimCheck } from '../lib/selfAi/evidenceCheck';
import VideoResultCards from '../components/video/VideoResultCards';
import ChatMotionPreview from '../components/motion3d/ChatMotionPreview';
import SelfAiServerSettings from '../components/coach/SelfAiServerSettings';
import { selfAiBackend, WAIT_EVENT, type BackendKind } from '../lib/selfAi/transport';

const EXAMPLES = ['복싱에서 잽을 활용한 셋업과 콤보를 배우고 싶어', '로마첸코 풋워크 영상 보여줘', '암바 할 때 엉덩이는 어떻게 해?', '요즘 훈련이 너무 힘들어'];

type Status = { ai: 'checking' | 'ok' | 'off' | 'unsupported'; aiModel?: string | null; search: 'checking' | 'ok' | 'off' | 'disabled' | 'unsupported'; where?: BackendKind };

function SourceList({ m }: { m: CoachChatMessage }) {
  // videos: cards with the in-app player instead of a link list
  if (m.sources?.length && m.sources.every((s) => s.sourceType === 'video')) return <VideoResultCards videos={m.sources} testId="self-ai-videos" />;
  if (m.role !== 'assistant') return null;
  const freshness = m.research?.cached
    ? `이전 검색 결과 — ${hhmm(m.research.cached.searchedAt)}에 검색 (새 검색 아님, 검색 서버 현재 상태: ${m.research.cached.serverUp ? '응답함' : '응답 없음'})`
    : m.sources?.[0]?.fetchedAt
      ? `이번 질문에서 새로 검색 — ${hhmm(m.sources[0].fetchedAt)}`
      : '';
  // 근거 상태 + 접는 출처 목록 (6분류 · 근거 상세 · 원문 열기 · 자료 간 상충 · 관련 기술) — components/coach/EvidencePanel
  return <EvidencePanel m={m} freshness={freshness} />;
}

function hhmm(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const CLAIM_MARK: Record<ClaimCheck['status'], IconName> = { supported: 'check', unverified: 'info', contradicted: 'close', opinion: 'comment' };
const CLAIM_LABEL: Record<ClaimCheck['status'], string> = { supported: '출처 문장과 일치', unverified: '출처에서 확인 안 됨 — 직접 확인 필요', contradicted: '출처와 다른 내용이라 답변에서 지움', opinion: '코치의 의견 (출처 아님)' };

/** 근거 대조 — the code's sentence-by-sentence comparison with the sources (evidenceCheck.ts), kept apart from the source list. */
function ClaimList({ claims }: { claims: ClaimCheck[] }) {
  const unverified = claims.filter((c) => c.status === 'unverified').length;
  return (
    <details className="ai-msg__sources" data-testid="self-ai-claims">
      <summary className="ai-msg__sources-label">
        근거 대조 — 앱이 답변 문장을 출처 문장과 비교한 결과 ({claims.filter((c) => c.status === 'supported').length}개 일치{unverified ? ` · ${unverified}개 확인 필요` : ''})
      </summary>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {claims.map((c, i) => (
          <li key={i} data-status={c.status}>
            <Icon name={CLAIM_MARK[c.status]} /> {c.source ? `[${c.source}] ` : ''}
            {c.sentence.slice(0, 120)}
            <span className="muted"> — {CLAIM_LABEL[c.status]}{c.problems.length ? ` · 주의: ${c.problems.map((p) => PROBLEM_LABEL[p]).join(', ')}` : ''}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export default function CoachChat() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const list = useConversationList();
  const conversationId = params.get('c') ?? list[0]?.id ?? null;
  const conversation = useConversation(conversationId);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState('');
  const [streamText, setStreamText] = useState('');
  const [error, setError] = useState<string | null>(null);
  // lesson additions accepted in this chat (the button runs once per proposal)
  const [addedFrom, setAddedFrom] = useState<Set<string>>(() => new Set());
  const [status, setStatus] = useState<Status>({ ai: 'checking', search: 'checking' });
  const requestRef = useRef<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Checked on open and again after every turn, so the line follows Ollama / SearXNG going down or coming back.
  const refreshStatus = useCallback(async () => {
    const backend = selfAiBackend();
    const ai = backend.kind !== 'none' ? await backend.modelStatus().catch(() => null) : null;
    const search = selfResearchProvider.available() ? await selfResearchProvider.status() : null;
    if (!mountedRef.current) return;
    setStatus({
      ai: backend.kind === 'none' ? 'unsupported' : ai?.ok ? 'ok' : 'off',
      where: backend.kind,
      aiModel: ai?.model ?? null,
      search: !selfResearchProvider.available() ? 'unsupported' : search?.ok ? 'ok' : search?.disabled ? 'disabled' : 'off',
    });
  }, []);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    void refreshStatus();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshStatus]);

  // self-AI server: queue position / model loading, shown in the busy line
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ requestId: string; kind: string; position?: number; seconds?: number }>).detail;
      if (d.requestId !== requestRef.current) return;
      setPhase(d.kind === 'queued' ? `자체 AI 서버 대기 중 (${d.position}번째)…` : d.kind === 'waiting' ? `모델이 답변을 준비하는 중 (${d.seconds}초)…` : '답변 작성 중…');
    };
    window.addEventListener(WAIT_EVENT, on);
    return () => window.removeEventListener(WAIT_EVENT, on);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [conversation?.messages.length, streamText]);

  function selectConversation(id: string | null) {
    setParams(id ? { c: id } : {}, { replace: true });
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || busy) return;
    setError(null);
    let conv = conversation;
    if (!conv) {
      conv = createConversation(null);
      selectConversation(conv.id);
    }
    const history = conv.messages;
    appendMessage(conv.id, { role: 'user', text });
    setInput('');
    setBusy(true);
    setStreamText('');
    const requestId = `chat-${Date.now()}`;
    requestRef.current = requestId;
    try {
      const out = await runCoachTurn(
        { text, history, martialArt: conv.martialArt, requestId, onDelta: (d) => setStreamText((s) => s + d), onStatus: setPhase },
        appCoachDeps()
      );
      appendMessage(conv.id, out.message);
      // "…화면 열어줘": the learner asked the app to DO it — navigate now (the message says what was opened)
      if (out.message.action?.autoRun) navigate(out.message.action.to, { state: out.message.action.state });
      // the art the learner named wins over a canonical record's art ("복싱 크로스" → kickboxing__cross is still boxing)
      const art = out.plan.art ?? out.plan.techniques[0]?.martialArt;
      if (!conv.martialArt && art) updateConversation(conv.id, { martialArt: art });
    } catch {
      setError('답변 중 오류가 발생했습니다. 다시 시도해 주세요.');
    } finally {
      setBusy(false);
      setPhase('');
      setStreamText('');
      requestRef.current = null;
      void refreshStatus();
    }
  }

  async function startLesson(m: CoachChatMessage) {
    if (!m.lessonProposal || !conversation) return;
    const index = await loadKnowledgeIndex();
    // the lesson gets the research of the WHOLE topic, not only of this message: sources found in earlier turns
    // that the proposal names (proposal.sourceUrls) are carried in too (K32 — 수업에 이전 검색 결과 포함)
    const sources = lessonSourcesFor(m.lessonProposal, m, conversation.messages);
    const res = startLessonFromProposal(m.lessonProposal, index, sources, conversation.id);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    updateConversation(conversation.id, { lessonSessionId: res.curriculum.id });
    navigate(res.route);
  }

  return (
    <div className="page mx-coach-workspace">
      <div className="container">
        <BackButton />
        <header className="mx-page-masthead mx-page-masthead--coach">
          <div>
            <span className="mx-eyebrow">CHAPTER 02 · AI COACH WORKSPACE</span>
            <h1 className="mx-coach-title"><Glyph set="ai" name="self-ai-chat" /> MARTIALDEX 자체 AI 코치</h1>
          </div>
        </header>
        <p className="video-status-message" data-testid="self-ai-status">
          {status.where === 'server' ? '자체 AI 서버 · ' : ''}로컬 AI: {status.ai === 'ok' ? `실행 중 (${status.aiModel})` : status.ai === 'off' ? (status.where === 'server' ? '꺼짐 — 서버의 모델 실행기를 확인해 주세요' : '꺼짐 — Ollama를 실행해 주세요') : status.ai === 'unsupported' ? '이 기기 미지원 (자체 AI 서버 연결 필요)' : '확인 중…'} · 자체 검색:{' '}
          {status.search === 'ok' ? '사용 가능' : status.search === 'disabled' ? '꺼짐 (설정 > AI 엔진에서 켤 수 있음)' : status.search === 'off' ? (status.where === 'server' ? '꺼짐 — 서버의 SearXNG를 확인해 주세요' : '응답 없음 — 설정 > AI 엔진에서 자체 검색을 다시 켜 주세요') : status.search === 'unsupported' ? '이 기기 미지원' : '확인 중…'}
        </p>
        {status.where !== 'electron' && status.ai !== 'checking' && <SelfAiServerSettings onChange={() => void refreshStatus()} />}

        <div className="chip-row" style={{ marginBottom: 8 }}>
          <button className="chip" onClick={() => selectConversation(createConversation(null).id)} data-testid="self-ai-new">
            + 새 대화
          </button>
          {list.slice(0, 8).map((c) => (
            <button key={c.id} className={`chip${c.id === conversationId ? ' active' : ''}`} onClick={() => selectConversation(c.id)}>
              {c.title}
            </button>
          ))}
          {conversation && (
            <button
              className="chip"
              onClick={() => {
                deleteConversation(conversation.id);
                selectConversation(null);
              }}
            >
              대화 삭제
            </button>
          )}
        </div>

        <div className="ai-chat" ref={scrollRef} data-testid="self-ai-chat" style={{ maxHeight: '60vh' }}>
          {!conversation?.messages.length && (
            <div className="ai-chat__examples">
              {EXAMPLES.map((q) => (
                <button key={q} className="ai-chat__example" onClick={() => void send(q)}>
                  {q}
                </button>
              ))}
            </div>
          )}
          {conversation?.messages.map((m) => (
            <div key={m.id} className={`ai-msg ai-msg--${m.role === 'user' ? 'user' : 'model'}`}>
              <div className="ai-msg__bubble" style={{ whiteSpace: 'pre-wrap' }}>
                {m.tasks?.length ? (
                  <div className="ai-msg__tasks" data-testid="self-ai-tasks">
                    {m.tasks.map((t, i) => (
                      <span key={i} className={`chip ai-task ai-task--${t.status}`} title={t.note}>
                        <Icon name={t.status === 'done' ? 'check' : t.status === 'failed' ? 'close' : 'info'} /> {t.label}
                      </span>
                    ))}
                  </div>
                ) : null}
                {m.text}
                <SourceList m={m} />
                {m.claims?.length ? <ClaimList claims={m.claims} /> : null}
                {m.personalData && (
                  <div className="ai-msg__sources-label" data-testid="self-ai-personal-data">
                    {m.personalData.loadFailed ? <><Icon name="warn" /> 저장 데이터를 읽지 못함: </> : '근거: 앱에 저장된 내 데이터 — '}
                    {m.personalData.stores.join(' · ')}
                  </div>
                )}
                {m.videos?.length ? <VideoResultCards videos={m.videos} testId="self-ai-videos" /> : null}
                {m.preview ? <ChatMotionPreview preview={m.preview} /> : null}
                {m.guardNotes?.map((n, i) => (
                  <div key={i} className="ai-msg__sources-label">
                    ※ {n}
                  </div>
                ))}
                {m.action && (
                  <div style={{ marginTop: 8 }}>
                    <button className="btn btn-primary" onClick={() => navigate(m.action!.to, { state: m.action!.state })} data-testid="self-ai-action">
                      {m.action.label}
                    </button>
                  </div>
                )}
                {m.lessonAdd && m.lessonAdd.status === 'pending' && !addedFrom.has(m.id) && conversation && (
                  <div style={{ marginTop: 8 }}>
                    <button
                      className="btn btn-primary"
                      data-testid="self-ai-lesson-add"
                      onClick={() => {
                        const r = acceptLessonAddition(m.lessonAdd!);
                        setAddedFrom((prev) => new Set(prev).add(m.id));
                        appendMessage(conversation.id, { role: 'assistant', text: r.message, model: 'martialdex-lesson', tools: ['lesson_engine'] });
                      }}
                    >
                      수업에 추가
                    </button>
                  </div>
                )}
                {m.lessonProposal && (
                  <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <button className="btn btn-primary" onClick={() => void startLesson(m)} data-testid="self-ai-start-lesson">
                      {m.lessonProposal.suggested ? `「${m.lessonProposal.topic}」 수업 시작` : '이 주제로 수업 시작'}
                    </button>
                    {m.lessonProposal.suggested && m.id === conversation?.messages[conversation.messages.length - 1]?.id && (
                      <button className="btn btn-secondary" onClick={() => void send('아니, 괜찮아')} disabled={busy} data-testid="self-ai-decline-lesson">
                        다음에 할게요
                      </button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
          {busy && (
            <div className="ai-msg ai-msg--model ai-msg--pending" data-testid="self-ai-busy">
              <div className="ai-msg__bubble" style={{ whiteSpace: 'pre-wrap' }}>
                {streamText || phase || '생각 중…'}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="ai-error" role="alert">
            {error}
          </div>
        )}

        <div className="field-block" style={{ marginTop: 8 }}>
          <AutoGrowTextarea
            className="select"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="무엇이든 물어보세요 (예: 이 선수의 셋업과 콤보를 배우고 싶어)"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                void send(input);
              }
            }}
            data-testid="self-ai-input"
          />
        </div>
        <div className="modal-actions modal-actions--start">
          {busy ? (
            <button className="btn btn-ghost" onClick={() => requestRef.current && void selfAiBackend().cancel(requestRef.current)}>
              답변 멈추기
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void send(input)} data-testid="self-ai-send">
              보내기
            </button>
          )}
        </div>
        <div className="modal-note">
          답변은 내 컴퓨터의 오픈소스 AI가 MARTIALDEX 기록과 실제로 가져온 검색 자료만 근거로 작성합니다. 검색하지 않은 질문에는 검색 결과가 붙지 않으며, 부상 위험이 있는 기술은 지도자와 안전한 환경에서 연습하세요.
        </div>
      </div>
    </div>
  );
}
