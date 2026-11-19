import { useCallback, useEffect, useState } from 'react';
import ModelDownloadConsent from './ModelDownloadConsent';
import {
  cancelEngineDownload,
  deleteEngineModel,
  downloadEngineModel,
  formatBytes,
  getEngineStatus,
  setEngineModel,
  startEngine,
  stopEngine,
  subscribeEngine,
} from '../lib/localAi/engineControl';
import { getAiEngine, setAiEngine } from '../lib/localAi/enginePreference';
import type { AiEngineChoice, EngineStatus } from '../lib/localAi/types';
import GeminiQuotaBadge from './monetization/GeminiQuotaBadge';

// 설정 > AI 엔진 — which engine answers generative features, and the in-app control of the
// local engine (시작 / 종료 / 모델 다운로드). The user never needs a terminal. Nothing starts
// or downloads until a button here is pressed; the download size is shown and confirmed first.

const PHASE_LABEL: Record<EngineStatus['phase'], string> = {
  off: '꺼짐',
  starting: '시작 중',
  loading: '모델 로딩 중',
  running: '실행 중',
  idle: '대기 (모델 메모리 해제됨)',
  error: '오류',
  unsupported: '이 기기에서 사용 불가',
};

export default function LocalAiEnginePanel() {
  const [choice, setChoice] = useState<AiEngineChoice>(getAiEngine);
  const [s, setS] = useState<EngineStatus | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [consent, setConsent] = useState(false);

  const refresh = useCallback(() => {
    void getEngineStatus().then(setS);
  }, []);

  useEffect(() => {
    refresh();
    const off = subscribeEngine(refresh);
    // while something is in progress the status changes without an event (load progress, RAM)
    const timer = window.setInterval(refresh, 4000);
    return () => {
      off();
      window.clearInterval(timer);
    };
  }, [refresh]);

  async function act(label: string, fn: () => Promise<{ ok: boolean; code?: string; message?: string }>) {
    setBusy(label);
    setNote(null);
    try {
      const r = await fn();
      if (!r.ok && r.message) setNote(r.message);
    } finally {
      setBusy(null);
      refresh();
    }
  }

  function chooseEngine(c: AiEngineChoice) {
    setChoice(c);
    setAiEngine(c);
  }

  const model = s?.models.find((m) => m.id === s.model) ?? null;
  const on = s && (s.phase === 'running' || s.phase === 'loading' || s.phase === 'starting' || s.phase === 'idle');
  const supported = s && s.phase !== 'unsupported';

  function approveDownload() {
    if (!s) return;
    setConsent(false);
    // approved on the consent screen; once verified the engine starts (a failed / cancelled download can be retried)
    void act('download', async () => {
      const r = await downloadEngineModel(s.model, { approved: true });
      return r.ok ? startEngine() : r;
    });
  }

  return (
    <div className="local-ai-panel" data-testid="local-ai-panel">
      <div className="chip-row" role="radiogroup" aria-label="생성형 AI 엔진" data-testid="ai-engine-choice">
        {(['local', 'gemini'] as const).map((c) => (
          <button key={c} type="button" role="radio" aria-checked={choice === c} className={`chip${choice === c ? ' active' : ''}`} onClick={() => chooseEngine(c)} data-testid={`ai-engine-choice-${c}`}>
            {c === 'local' ? '로컬 AI (기본)' : 'Gemini (외부 API)'}
          </button>
        ))}
      </div>
      <p className="muted local-ai-panel__help">
        {choice === 'local'
          ? 'AI 코치·커리큘럼·질문하기 등 생성형 AI 기능이 이 기기의 로컬 모델로 답합니다. 로컬 AI가 꺼져 있으면 Gemini로 바꾸지 않고 실행 안내를 보여 줍니다.'
          : '생성형 AI 기능이 Google Gemini(외부 유료 API)로 답합니다. 직접 선택한 경우에만 사용됩니다. 무료 플랜은 하루 사용 횟수가 정해져 있고 PRO 는 무제한입니다.'}
      </p>
      {choice === 'gemini' && <GeminiQuotaBadge />}

      {!s ? (
        <p className="muted">로컬 AI 상태 확인 중…</p>
      ) : !supported ? (
        <p className="muted" data-testid="local-ai-unsupported">
          {s.error?.message}
        </p>
      ) : (
        <>
          <dl className="local-ai-panel__status" data-testid="local-ai-status">
            <dt>엔진 상태</dt>
            <dd data-testid="local-ai-phase" data-phase={s.phase}>
              {PHASE_LABEL[s.phase]}
              {s.external ? ' · 사용자가 직접 실행한 Ollama (MARTIALDEX가 종료하지 않음)' : s.owned ? ' · MARTIALDEX가 실행함' : ''}
            </dd>
            <dt>모델</dt>
            <dd>
              <select
                value={s.model}
                disabled={!!busy || !!s.pull || s.phase === 'loading' || s.phase === 'starting'}
                onChange={(e) => void act('model', () => setEngineModel(e.target.value))}
                aria-label="로컬 AI 모델"
                data-testid="local-ai-model"
              >
                {s.models.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.label} · {formatBytes(m.downloadBytes)}
                  </option>
                ))}
              </select>
              {s.model !== 'qwen2.5:3b' && <span className="local-ai-panel__warn"> 기본 모델(Qwen2.5 3B)보다 작은 모델이라 답변 품질이 낮을 수 있습니다.</span>}
            </dd>
            <dt>모델 설치</dt>
            <dd data-testid="local-ai-installed">
              {s.platform === 'electron' && s.phase === 'off' && !s.external ? '엔진을 시작하면 확인합니다' : s.modelInstalled ? '설치됨 (검증 완료)' : '설치되지 않음'}
            </dd>
            <dt>메모리</dt>
            <dd data-testid="local-ai-ram">
              {s.loaded ? `모델 ${formatBytes(s.loaded.sizeBytes)} 사용 중` : '모델이 메모리에 없음'}
              {s.deviceRamBytes ? ` · 기기 RAM ${formatBytes(s.deviceRamBytes)}` : ''}
            </dd>
            {s.freeStorageBytes != null && (
              <>
                <dt>저장 공간</dt>
                <dd>여유 {formatBytes(s.freeStorageBytes)}</dd>
              </>
            )}
            {s.platform === 'electron' && s.phase === 'off' && (
              <>
                <dt>Ollama</dt>
                <dd>{s.binary ? '설치됨 (시작을 누르면 백그라운드에서 실행)' : '설치되지 않음 — ollama.com에서 설치 후 시작을 눌러 주세요'}</dd>
              </>
            )}
          </dl>

          {s.pull && (
            <div className="local-ai-panel__progress" data-testid="local-ai-pull">
              <progress max={s.pull.total || 1} value={s.pull.completed} />
              <span>
                {s.pull.status === 'verifying' ? '무결성 검사 중…' : s.pull.total ? `${formatBytes(s.pull.completed)} / ${formatBytes(s.pull.total)}` : s.pull.status || '준비 중'}
              </span>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelEngineDownload().then(refresh)}>
                다운로드 취소
              </button>
            </div>
          )}

          <div className="local-ai-panel__actions">
            {!on ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={!!busy} onClick={() => void act('start', () => startEngine())} data-testid="local-ai-start">
                {busy === 'start' ? '시작 중…' : '로컬 AI 시작'}
              </button>
            ) : (
              <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => void act('stop', () => stopEngine())} data-testid="local-ai-stop">
                {busy === 'stop' ? '종료 중…' : s.external ? '모델 메모리 해제' : '로컬 AI 종료'}
              </button>
            )}
            {(on || s.platform === 'android') && !s.modelInstalled && !s.pull && !consent && (
              <button type="button" className="btn btn-sm" disabled={!!busy} onClick={() => setConsent(true)} data-testid="local-ai-download">
                모델 다운로드 ({model ? formatBytes(model.downloadBytes) : ''})
              </button>
            )}
            {s.platform === 'android' && s.modelInstalled && !s.loaded && !s.pull && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={!!busy}
                onClick={() => window.confirm(`${s.model} 모델 파일을 삭제할까요? 다시 쓰려면 다시 다운로드해야 합니다.`) && void act('delete', () => deleteEngineModel(s.model))}
                data-testid="local-ai-delete"
              >
                모델 파일 삭제
              </button>
            )}
            {s.phase === 'idle' && (
              <button type="button" className="btn btn-ghost btn-sm" disabled={!!busy} onClick={() => void act('start', () => startEngine())}>
                모델 다시 올리기
              </button>
            )}
          </div>

          {consent && model && <ModelDownloadConsent status={s} model={model} onApprove={approveDownload} onLater={() => setConsent(false)} busy={!!busy} />}

          {(note || s.error) && (
            <p className="local-ai-panel__error" role="alert" data-testid="local-ai-error">
              {note ?? s.error?.message}
            </p>
          )}
        </>
      )}
    </div>
  );
}
