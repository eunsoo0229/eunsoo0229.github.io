// 통합 로컬 AI 엔진 — one status shape for every platform's engine
// (Mac/Windows: Ollama managed by electron/localEngine.cjs; Android: on-device runtime plugin).

export type EnginePhase = 'off' | 'starting' | 'loading' | 'running' | 'idle' | 'error' | 'unsupported';

export interface EngineModelOption {
  id: string;
  label: string;
  downloadBytes: number;
  minRamGb: number;
  /** Android: complete + hash-verified on this device. */
  installed?: boolean;
  /** Android: bytes of an interrupted download (resumed on the next download). */
  partialBytes?: number;
}

export interface EngineStatus {
  /** 'electron' (Mac · Windows) · 'android' · 'none' (web / no engine on this device). */
  platform: 'electron' | 'android' | 'none';
  phase: EnginePhase;
  error: { code: string; message: string } | null;
  /** Model the user selected (qwen2.5:3b unless they picked a smaller one). */
  model: string;
  models: EngineModelOption[];
  /** true = MARTIALDEX started this engine (it stops it on 종료 / quit). */
  owned: boolean;
  /** true = an Ollama the user runs themselves — never stopped by MARTIALDEX. */
  external: boolean;
  modelInstalled: boolean;
  /** Model currently in RAM, with its size when the platform reports it. */
  loaded: { name: string; sizeBytes: number } | null;
  /** Download in progress. */
  pull: { model: string; status: string; completed: number; total: number } | null;
  /** Ollama binary found on this computer (desktop) — null = not installed. */
  binary?: string | null;
  /** Device RAM in bytes, when known (Android). */
  deviceRamBytes?: number | null;
  /** Android: RAM free right now, storage free for model files, and whether the network is metered (mobile data). */
  availRamBytes?: number | null;
  freeStorageBytes?: number | null;
  metered?: boolean;
}

export interface EngineActionResult {
  ok: boolean;
  code?: string;
  message?: string;
  model?: string;
}

/** Which engine runs generative AI features. Gemini only by the user's explicit choice — never automatically. */
export type AiEngineChoice = 'local' | 'gemini';
