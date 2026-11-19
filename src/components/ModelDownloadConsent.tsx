import type { EngineModelOption, EngineStatus } from '../lib/localAi/types';
import { formatBytes } from '../lib/localAi/engineControl';

// 모델 다운로드 승인 화면 — the only way a model download starts. Shows the model name, file size,
// the storage it needs (and what is free, on Android), and what it is used for. The user presses
// 다운로드 or 나중에; nothing is downloaded otherwise. A model already installed never shows this.

const STORAGE_MARGIN = 300 * 1024 * 1024;

export default function ModelDownloadConsent({
  status,
  model,
  onApprove,
  onLater,
  busy = false,
}: {
  status: EngineStatus;
  model: EngineModelOption;
  onApprove: () => void;
  onLater: () => void;
  busy?: boolean;
}) {
  const remaining = model.downloadBytes - (model.partialBytes ?? 0);
  const needed = remaining + STORAGE_MARGIN;
  const free = status.freeStorageBytes ?? null;
  const short = free !== null && free < needed;
  const lowRam = status.deviceRamBytes ? status.deviceRamBytes / 1e9 < model.minRamGb : false;
  return (
    <div className="model-consent" role="dialog" aria-labelledby="model-consent-title" data-testid="model-consent">
      <h3 id="model-consent-title">로컬 AI 모델 다운로드</h3>
      <dl className="local-ai-panel__status">
        <dt>모델</dt>
        <dd data-testid="model-consent-name">{model.label}</dd>
        <dt>파일 크기</dt>
        <dd data-testid="model-consent-size">{formatBytes(model.downloadBytes)}{model.partialBytes ? ` (받은 ${formatBytes(model.partialBytes)}부터 이어받기)` : ''}</dd>
        <dt>필요한 저장 공간</dt>
        <dd>
          약 {formatBytes(needed)}
          {free !== null && <> · 현재 여유 {formatBytes(free)}</>}
        </dd>
        <dt>사용 목적</dt>
        <dd>AI 코치 대화, 수업 중 질문, 커리큘럼·훈련 계획 작성 등 MARTIALDEX의 생성형 AI 기능을 인터넷 없이 이 기기에서 실행합니다. 질문 내용은 기기 밖으로 나가지 않습니다.</dd>
      </dl>
      {status.metered && <p className="local-ai-panel__warn">지금 모바일 데이터에 연결되어 있습니다. 용량이 커서 Wi-Fi 연결을 권장합니다.</p>}
      {lowRam && (
        <p className="local-ai-panel__warn">
          이 기기의 메모리({formatBytes(status.deviceRamBytes ?? 0)})는 이 모델의 권장 사양({model.minRamGb}GB)보다 적습니다. 실행이 느리거나 메모리 부족으로 멈출 수 있습니다. 더 작은 모델을 선택할 수도 있습니다.
        </p>
      )}
      {short && <p className="local-ai-panel__error">저장 공간이 부족합니다. 약 {formatBytes(needed - (free ?? 0))}를 더 확보한 뒤 다시 시도해 주세요.</p>}
      <p className="muted">다운로드가 끝나면 파일이 공식 모델과 같은지 검사한 뒤에만 사용합니다. 진행 중에도 취소할 수 있고, 나중에 이어서 받을 수 있습니다.</p>
      <div className="local-ai-panel__actions">
        <button type="button" className="btn btn-primary btn-sm" disabled={busy || short} onClick={onApprove} data-testid="model-consent-approve">
          다운로드 ({formatBytes(remaining)})
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onLater} data-testid="model-consent-later">
          나중에
        </button>
      </div>
    </div>
  );
}
