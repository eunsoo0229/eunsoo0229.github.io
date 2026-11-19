// Electron/macOS 카메라 권한 — getUserMedia 를 부르기 전에 OS에 먼저 물어야 하는 자리.
//
// 왜 필요한가 (2026-11-08 확인). macOS는 앱이 TCC로 카메라를 요청하기 전까지 Chromium에 비디오 장치를
// 하나도 보여 주지 않는다. 그래서 웹캠이 멀쩡한 Mac에서도 getUserMedia 가 NotFoundError 로 실패하고,
// 화면에는 "카메라를 찾을 수 없습니다. 카메라가 연결되어 있는지 확인해주세요"가 떴다 — 연결 문제가
// 아니라 앱이 macOS에 물어본 적이 없다는 뜻이었다.
//
// 메인 프로세스 핸들러(media:camera-access)와 preload 바인딩(requestCameraAccess)은 처음부터 있었지만
// 렌더러에서 아무도 부르지 않았다. 마이크 쪽은 같은 일을 voice/stt.ts 가 하고 있었다 — 카메라만 빠져 있었다.

export type CameraAccess = { ok: true } | { ok: false; reason: 'denied'; message: string };

/**
 * OS 카메라 권한을 확보한다. Electron/macOS가 아니면(웹·Android·Windows) 아무것도 하지 않고 통과시켜
 * 기존 동작 그대로 getUserMedia 가 판단하게 둔다.
 *
 * 반드시 navigator.mediaDevices.getUserMedia 호출 직전에 await 할 것.
 */
export async function ensureCameraAccess(): Promise<CameraAccess> {
  const ask = window.martialdex?.requestCameraAccess;
  if (!ask) return { ok: true };
  try {
    const status = await ask();
    if (status === 'denied' || status === 'restricted') {
      return {
        ok: false,
        reason: 'denied',
        message: '카메라 권한이 꺼져 있습니다. 시스템 설정 › 개인정보 보호 및 보안 › 카메라에서 MARTIALDEX를 허용한 뒤 다시 시도해 주세요.',
      };
    }
  } catch {
    // 알 수 없으면 막지 않는다 — getUserMedia 가 판단하게 둔다 (권한 확인 실패로 기능을 잠그지 않음)
  }
  return { ok: true };
}

/** 시스템 설정의 카메라 항목을 연다 (Electron/macOS에서만 동작). 열 수 있었으면 true. */
export async function openCameraSettings(): Promise<boolean> {
  try {
    return (await window.martialdex?.openCameraSettings?.()) ?? false;
  } catch {
    return false;
  }
}

/** 카메라를 열 수 있는 환경인가 — 버튼을 보여 줄지 판단할 때. */
export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}
