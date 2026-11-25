// 계정 데이터 자동 동기화 — 앱 어디에 있든 동작한다.
//
// 평소에는 아무것도 그리지 않는다. 사용자가 알아야 할 때만 띄운다:
//   · 다른 기기에서 올린 상태를 받아 왔을 때 (한 번 알려 주고 사라짐)
//   · 이 기기와 다른 기기가 모두 바뀌어 충돌했을 때 (어느 쪽을 쓸지 골라야 함)
// 충돌은 사용자가 고르기 전까지 어느 쪽도 덮어쓰지 않는다 — 조용히 "최신 것"을 택하면 다른 기기에서
// 한 훈련 기록이 사라진다.

import { useEffect, useState } from 'react';
import { useAuth } from '../lib/auth/AuthProvider';
import { useAutoStateSync } from '../lib/cloudSync/useAutoStateSync';
import { formatBackupDate, formatBackupTime } from '../lib/cloudSync/dataBackup';

function when(iso: string): string {
  try {
    return `${formatBackupDate(iso)} ${formatBackupTime(iso)}`;
  } catch {
    return iso;
  }
}

export default function AutoStateSyncWatcher() {
  const { user } = useAuth();
  const { state, useCloud, useThisDevice } = useAutoStateSync(user?.id ?? null);
  const [dismissed, setDismissed] = useState(false);

  // 새 충돌이 생기면 다시 보여 준다
  useEffect(() => {
    if (state.phase === 'conflict') setDismissed(false);
  }, [state.phase]);

  if (state.phase === 'conflict' && !dismissed) {
    return (
      <div className="card info-card auto-sync-conflict" data-testid="auto-sync-conflict" role="alertdialog" aria-live="polite">
        <strong>이 기기와 다른 기기의 기록이 모두 바뀌었습니다</strong>
        <p className="video-status-message">
          {state.cloud.deviceName ? `${state.cloud.deviceName}에서 ` : '다른 기기에서 '}
          {when(state.cloud.at)}에 올린 기록({state.cloud.keyCount}개 항목)이 있고, 이 기기에서도 그 뒤에 바뀐 내용이 있습니다.
          어느 쪽을 쓸지 고르기 전까지 <strong>아무것도 덮어쓰지 않았습니다</strong>.
        </p>
        <div className="row gap">
          <button className="btn btn-primary" data-testid="auto-sync-use-cloud" onClick={() => void useCloud()}>
            다른 기기 기록 쓰기
          </button>
          <button className="btn" data-testid="auto-sync-use-device" onClick={() => void useThisDevice()}>
            이 기기 기록 쓰기
          </button>
          <button className="btn btn-ghost" onClick={() => setDismissed(true)}>
            나중에
          </button>
        </div>
        <p className="video-status-message">
          고르기 전까지 자동 저장은 멈춰 있습니다. 되돌릴 지점이 필요하면 프로필에서 먼저 백업본을 만들어 두세요.
        </p>
      </div>
    );
  }
  return null;
}
