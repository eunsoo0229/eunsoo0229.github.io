import { useEffect, useState } from 'react';
import ModelDownloadConsent from './ModelDownloadConsent';
import { cancelEngineDownload, downloadEngineModel, formatBytes, getEngineStatus, LOCAL_AI_SETUP_EVENT, startEngine, subscribeEngine } from '../lib/localAi/engineControl';
import type { EngineStatus } from '../lib/localAi/types';

// 로컬 AI 첫 사용 안내 — shown by the app shell when a feature needed the local model and it is not
// installed yet (localProvider → requestLocalAiSetup). The consent screen, then download progress,
// integrity check and engine start. "나중에" closes it; nothing is downloaded without the button.

export default function LocalAiSetupPrompt() {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<EngineStatus | null>(null);
  const [step, setStep] = useState<'consent' | 'working' | 'done' | 'failed'>('consent');
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    const onSetup = () => {
      void getEngineStatus().then((st) => {
        if (st.modelInstalled || st.phase === 'unsupported') return; // installed: no approval needed
        setS(st);
        setStep(st.pull ? 'working' : 'consent');
        setMessage(null);
        setOpen(true);
      });
    };
    window.addEventListener(LOCAL_AI_SETUP_EVENT, onSetup);
    return () => window.removeEventListener(LOCAL_AI_SETUP_EVENT, onSetup);
  }, []);

  useEffect(() => {
    if (!open) return;
    return subscribeEngine(() => void getEngineStatus().then(setS));
  }, [open]);

  if (!open || !s) return null;
  const model = s.models.find((m) => m.id === s.model);
  if (!model) return null;

  async function approve() {
    setStep('working');
    setMessage(null);
    const r = await downloadEngineModel(model!.id, { approved: true });
    if (!r.ok) {
      setStep('failed');
      setMessage(r.message ?? '다운로드에 실패했습니다.');
      return;
    }
    const st = await startEngine(model!.id);
    setStep(st.ok ? 'done' : 'failed');
    setMessage(st.ok ? null : (st.message ?? '로컬 AI를 시작하지 못했습니다.'));
  }

  return (
    <div className="modal-overlay local-ai-setup" data-testid="local-ai-setup">
      <div className="modal-panel">
        {step === 'consent' && <ModelDownloadConsent status={s} model={model} onApprove={() => void approve()} onLater={() => setOpen(false)} />}
        {step === 'working' && (
          <div data-testid="local-ai-setup-progress">
            <h3>로컬 AI 모델 준비 중</h3>
            {s.pull ? (
              <>
                <progress max={s.pull.total || 1} value={s.pull.completed} style={{ width: '100%' }} />
                <p>{s.pull.status === 'verifying' ? '파일이 공식 모델과 같은지 검사 중…' : `${formatBytes(s.pull.completed)} / ${formatBytes(s.pull.total || model.downloadBytes)}`}</p>
              </>
            ) : (
              <p>{s.phase === 'loading' || s.phase === 'starting' ? '모델을 메모리에 올리는 중…' : '준비 중…'}</p>
            )}
            <div className="local-ai-panel__actions">
              {s.pull && (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => void cancelEngineDownload()}>
                  다운로드 취소
                </button>
              )}
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                닫기 (계속 받기)
              </button>
            </div>
          </div>
        )}
        {step === 'done' && (
          <div data-testid="local-ai-setup-done">
            <h3>로컬 AI 준비 완료</h3>
            <p>모델 {model.label}을(를) 확인하고 실행했습니다. 방금 하려던 요청을 다시 보내 주세요.</p>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setOpen(false)}>
              확인
            </button>
          </div>
        )}
        {step === 'failed' && (
          <div data-testid="local-ai-setup-failed">
            <h3>로컬 AI 준비 실패</h3>
            <p className="local-ai-panel__error">{message}</p>
            <div className="local-ai-panel__actions">
              <button type="button" className="btn btn-primary btn-sm" onClick={() => void approve()}>
                다시 시도
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)}>
                나중에
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
