// 자동 계정 데이터 동기화를 앱에 연결하는 훅.
//
// 로그인하면 ① 클라우드의 현재 상태를 내려받고(앱을 열 때 자동 복원) ② 그 뒤로는 바뀔 때마다 올린다.
// 프로필 화면에서 "백업"·"복원"을 누르지 않아도 되도록 하는 것이 목적이다.
//
// 자동 복원이 기록을 지울 수 있다는 점 때문에, 양쪽이 모두 바뀐 경우(conflict)에는 아무것도 덮어쓰지 않고
// 상태만 알려 준다 — 어느 쪽을 쓸지는 사용자가 고른다 (cloudSync/autoState.ts 의 규칙 설명 참고).

import { useEffect, useRef, useState } from 'react';
import { pullState, pushState, startAutoStateSync, type PullResult } from './autoState';

export type AutoSyncState =
  | { phase: 'idle' }
  | { phase: 'loading' } // 앱을 열며 클라우드 상태를 확인하는 중
  | { phase: 'ready'; lastPushAt: string | null }
  | { phase: 'conflict'; cloud: { deviceName: string | null; at: string; keyCount: number }; localChangedAt: string }
  | { phase: 'error'; message: string };

export interface AutoSyncApi {
  state: AutoSyncState;
  /** 충돌일 때: 클라우드 것으로 덮어쓴다. */
  useCloud: () => Promise<void>;
  /** 충돌일 때: 이 기기 것을 올려 클라우드를 덮어쓴다. */
  useThisDevice: () => Promise<void>;
}

export function useAutoStateSync(userId: string | null): AutoSyncApi {
  const [state, setState] = useState<AutoSyncState>({ phase: 'idle' });
  const stopRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    stopRef.current?.();
    stopRef.current = null;
    if (!userId) {
      setState({ phase: 'idle' });
      return;
    }
    let cancelled = false;
    setState({ phase: 'loading' });

    void (async () => {
      let pulled: PullResult;
      try {
        pulled = await pullState(userId);
      } catch (e) {
        if (!cancelled) setState({ phase: 'error', message: e instanceof Error ? e.message : '불러오지 못했습니다.' });
        return;
      }
      if (cancelled) return;
      if (pulled.kind === 'conflict') {
        // 충돌이면 올리기도 시작하지 않는다 — 사용자가 고르기 전에 한쪽이 덮이면 안 된다
        setState({ phase: 'conflict', cloud: pulled.cloud, localChangedAt: pulled.localChangedAt });
        return;
      }
      if (pulled.kind === 'skipped') {
        setState({ phase: 'error', message: pulled.reason });
        return;
      }
      setState({ phase: 'ready', lastPushAt: pulled.kind === 'applied' ? pulled.from.at : null });
      stopRef.current = startAutoStateSync(userId, {
        onPush: ({ at }) => !cancelled && setState({ phase: 'ready', lastPushAt: at }),
        onError: (message) => !cancelled && setState({ phase: 'error', message }),
      });
    })();

    return () => {
      cancelled = true;
      stopRef.current?.();
      stopRef.current = null;
    };
  }, [userId]);

  const resolve = async (which: 'cloud' | 'device') => {
    if (!userId) return;
    setState({ phase: 'loading' });
    try {
      if (which === 'cloud') await pullState(userId, { force: true });
      else await pushState(userId, { force: true });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : '처리하지 못했습니다.' });
      return;
    }
    setState({ phase: 'ready', lastPushAt: new Date().toISOString() });
    stopRef.current?.();
    stopRef.current = startAutoStateSync(userId, {
      onPush: ({ at }) => setState({ phase: 'ready', lastPushAt: at }),
      onError: (message) => setState({ phase: 'error', message }),
    });
  };

  return { state, useCloud: () => resolve('cloud'), useThisDevice: () => resolve('device') };
}
