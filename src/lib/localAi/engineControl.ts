import { Capacitor, registerPlugin } from '@capacitor/core';
import type { EngineActionResult, EngineStatus } from './types';

// 로컬 AI 엔진 제어 — the settings panel's 시작 / 종료 / 다운로드 and the status every
// generative feature checks. Two adapters behind one shape:
//   electron : window.martialdex.localEngine (electron/localEngine.cjs → Ollama)
//   android  : the LocalLlm Capacitor plugin (llama.cpp on the device), when the APK has it
// Nothing here starts an engine on its own; status() only reads.

/** Android on-device runtime (android/app/.../LocalLlmPlugin). */
export interface LocalLlmPlugin {
  status(): Promise<EngineStatus>;
  start(opts: { model?: string }): Promise<EngineActionResult>;
  stop(): Promise<EngineActionResult>;
  setModel(opts: { model: string }): Promise<EngineActionResult>;
  /** `approved` must be true: the user pressed 다운로드 on the consent screen (the plugin refuses otherwise). */
  download(opts: { model: string; approved: boolean }): Promise<EngineActionResult>;
  deleteModel(opts: { model: string }): Promise<EngineActionResult>;
  diagnostics(): Promise<Record<string, unknown>>;
  cancelDownload(): Promise<{ ok: boolean }>;
  chat(opts: { requestId: string; messages: { role: string; content: string }[]; json?: boolean; maxTokens?: number; temperature?: number }): Promise<{ ok: boolean; text?: string; model?: string; evalCount?: number; ms?: number; code?: string; message?: string; partial?: string }>;
  cancel(opts: { requestId: string }): Promise<{ ok: boolean }>;
  addListener(event: 'delta', cb: (e: { requestId: string; delta: string }) => void): Promise<{ remove: () => Promise<void> }>;
  addListener(event: 'changed', cb: () => void): Promise<{ remove: () => Promise<void> }>;
}

export const LocalLlm = registerPlugin<LocalLlmPlugin>('LocalLlm');

export function androidEngineAvailable(): boolean {
  return Capacitor.getPlatform() === 'android' && Capacitor.isPluginAvailable('LocalLlm');
}

function desktop() {
  return typeof window !== 'undefined' ? window.martialdex?.localEngine : undefined;
}

export function enginePlatform(): EngineStatus['platform'] {
  if (desktop()) return 'electron';
  if (androidEngineAvailable()) return 'android';
  return 'none';
}

const UNSUPPORTED: EngineStatus = {
  platform: 'none',
  phase: 'unsupported',
  error: { code: 'UNSUPPORTED_PLATFORM', message: '이 기기(웹 브라우저)에서는 로컬 AI 엔진을 실행할 수 없습니다. MARTIALDEX 데스크톱 앱이나 Android 앱에서 사용해 주세요.' },
  model: 'qwen2.5:3b',
  models: [],
  owned: false,
  external: false,
  modelInstalled: false,
  loaded: null,
  pull: null,
};

export async function getEngineStatus(): Promise<EngineStatus> {
  const d = desktop();
  try {
    if (d) {
      const s = await d.status();
      return { ...s, platform: 'electron', loaded: s.loaded ? { name: s.loaded.name, sizeBytes: s.loaded.sizeBytes } : null } as EngineStatus;
    }
    if (androidEngineAvailable()) return { ...(await LocalLlm.status()), platform: 'android' };
  } catch {
    return { ...UNSUPPORTED, platform: enginePlatform(), phase: 'error', error: { code: 'UNKNOWN', message: '로컬 AI 상태를 확인하지 못했습니다.' } };
  }
  return UNSUPPORTED;
}

export async function startEngine(model?: string): Promise<EngineActionResult> {
  const d = desktop();
  if (d) return d.start(model ? { model } : {});
  if (androidEngineAvailable()) return LocalLlm.start(model ? { model } : {});
  return { ok: false, code: 'UNSUPPORTED_PLATFORM', message: UNSUPPORTED.error!.message };
}

export async function stopEngine(): Promise<EngineActionResult> {
  const d = desktop();
  if (d) return d.stop();
  if (androidEngineAvailable()) return LocalLlm.stop();
  return { ok: true };
}

export async function setEngineModel(model: string): Promise<EngineActionResult> {
  const d = desktop();
  if (d) return d.setModel(model);
  if (androidEngineAvailable()) return LocalLlm.setModel({ model });
  return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
}

/** Only after the user approved on the consent screen (ModelDownloadConsent) — never called automatically. */
export async function downloadEngineModel(model: string, approval: { approved: true }): Promise<EngineActionResult> {
  if (approval?.approved !== true) return { ok: false, code: 'NOT_APPROVED' };
  const d = desktop();
  if (d) return d.pull(model);
  if (androidEngineAvailable()) return LocalLlm.download({ model, approved: true });
  return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
}

/** Android: removes a downloaded model file (frees storage). */
export async function deleteEngineModel(model: string): Promise<EngineActionResult> {
  if (androidEngineAvailable()) return LocalLlm.deleteModel({ model });
  return { ok: false, code: 'UNSUPPORTED_PLATFORM' };
}

// ---------------------------------------------------------------- first-use setup

/** Asked when a feature needs the local model and it is not installed — the app shell shows the consent screen. */
export const LOCAL_AI_SETUP_EVENT = 'martialdex:local-ai-setup';
export function requestLocalAiSetup(reason: 'model_missing'): void {
  try {
    window.dispatchEvent(new CustomEvent(LOCAL_AI_SETUP_EVENT, { detail: { reason } }));
  } catch {
    /* no window */
  }
}

export async function cancelEngineDownload(): Promise<void> {
  const d = desktop();
  if (d) await d.cancelPull();
  else if (androidEngineAvailable()) await LocalLlm.cancelDownload();
}

/** Re-read status whenever the engine reports a change (start/stop/download/exit). → unsubscribe */
export function subscribeEngine(cb: () => void): () => void {
  const d = desktop();
  if (d) {
    const offChange = d.onChange(cb);
    const offProgress = d.onProgress(cb);
    return () => {
      offChange();
      offProgress();
    };
  }
  if (androidEngineAvailable()) {
    let handle: { remove: () => Promise<void> } | null = null;
    let closed = false;
    void LocalLlm.addListener('changed', cb).then((h) => {
      if (closed) void h.remove();
      else handle = h;
    });
    return () => {
      closed = true;
      void handle?.remove();
    };
  }
  return () => {};
}

export function formatBytes(n: number): string {
  if (!n) return '0';
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)}GB` : `${Math.round(n / 1e6)}MB`;
}

/** The message a generative feature shows when the local engine is not ready (never a different engine). */
export function engineNotReadyMessage(s: EngineStatus): string {
  if (s.phase === 'unsupported') return s.error?.message ?? UNSUPPORTED.error!.message;
  if (s.platform === 'electron' && s.phase === 'off' && !s.binary) return 'Ollama가 이 컴퓨터에 설치되어 있지 않습니다. ollama.com에서 설치한 뒤 설정 > 로컬 AI 엔진에서 [로컬 AI 시작]을 눌러 주세요.';
  if (!s.modelInstalled && !(s.platform === 'electron' && s.phase === 'off')) return `로컬 AI 모델 ${s.model}이(가) 아직 설치되지 않았습니다. 안내 화면이나 설정 > 로컬 AI 엔진에서 다운로드를 승인하면 사용할 수 있습니다.`;
  if (s.phase === 'error' && s.error) return s.error.message;
  return '로컬 AI 엔진이 꺼져 있습니다. 설정 > 로컬 AI 엔진에서 [로컬 AI 시작]을 눌러 주세요.';
}
