// 프로필의 자동 동기화 상태 — "백업을 눌렀는가"가 아니라 "지금 안전한가"를 보여 준다.
//
// 자동 동기화(user_state)와 백업본(user_backups)은 다른 것이다. 화면에서도 그 차이를 분명히 해야
// 사용자가 "백업을 눌러야 하나?" 하고 다시 고민하지 않는다.
import { useAuth } from '../lib/auth/AuthProvider';
import { useAutoStateSync } from '../lib/cloudSync/useAutoStateSync';
import { formatBackupDate, formatBackupTime } from '../lib/cloudSync/dataBackup';

export default function AutoSyncStatus() {
  const { user } = useAuth();
  const { state } = useAutoStateSync(user?.id ?? null);
  if (!user) return null;

  const line = (() => {
    switch (state.phase) {
      case 'loading':
        return '계정 기록을 확인하는 중…';
      case 'ready':
        return state.lastPushAt
          ? `자동 저장됨 — ${formatBackupDate(state.lastPushAt)} ${formatBackupTime(state.lastPushAt)}`
          : '자동 저장이 켜져 있습니다. 기록이 바뀌면 알아서 올라갑니다.';
      case 'conflict':
        return '이 기기와 다른 기기의 기록이 모두 바뀌어 자동 저장을 멈췄습니다 — 화면 위의 안내에서 어느 쪽을 쓸지 골라 주세요.';
      case 'error':
        return `자동 저장 문제: ${state.message}`;
      default:
        return null;
    }
  })();

  return (
    <div className="card info-card" data-testid="auto-sync-status" style={{ marginBottom: 12 }}>
      <strong>자동 저장</strong>
      <p className="video-status-message">{line}</p>
      <p className="video-status-message">
        훈련 기록·커리큘럼·목표는 바뀔 때마다 자동으로 저장되고, 앱을 열면 자동으로 불러옵니다.
        아래 <strong>백업본</strong>은 그것과 별개로, 실수로 지웠을 때 되돌아갈 지점을 직접 만들어 두는 기능입니다.
      </p>
    </div>
  );
}
