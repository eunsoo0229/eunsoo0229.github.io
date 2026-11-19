import type { AskAiRequest, AskAiResult } from './lib/ai/types';
import type { VideoInfoOutcome, VideoSearchOutcome } from './lib/videoSearch/types';
import type { WebSearchOutcome } from './lib/webSearch/types';
import type { PersonName, ResearchOutcome, ResearchRequest } from './lib/selfResearch/types';
import type { SelfAiChatRequest, SelfAiChatResult } from './lib/selfAi/types';
import type { LocalSttApi } from './lib/voice/localSttTypes';
import type { LocalAskRequest, LocalAskResult, LocalModelStatus } from './lib/coachProvider/types';
import type { EngineActionResult, EngineStatus } from './lib/localAi/types';

declare global {
  interface Window {
    martialdex?: {
      openExternal: (url: string) => void;
      openInApp: (url: string) => void;
      askAi: (request: AskAiRequest) => Promise<AskAiResult>;
      /** MARTIALDEX 자체 AI 코치 — local Ollama model (Mac 앱 only, electron/ollama.cjs). Never Gemini. */
      localAi?: { status: () => Promise<LocalModelStatus>; ask: (request: LocalAskRequest) => Promise<LocalAskResult>; cancel?: (requestId: string) => Promise<boolean> };
      /** 통합 로컬 AI 엔진 (Mac · Windows 앱) — electron/localEngine.cjs. */
      localEngine?: {
        status: () => Promise<Omit<EngineStatus, 'platform'>>;
        start: (opts: { model?: string }) => Promise<EngineActionResult>;
        stop: () => Promise<EngineActionResult>;
        setModel: (model: string) => Promise<EngineActionResult>;
        pull: (model: string) => Promise<EngineActionResult>;
        cancelPull: () => Promise<boolean>;
        onProgress: (cb: (p: { model: string; status: string; completed: number; total: number }) => void) => () => void;
        onChange: (cb: () => void) => () => void;
      };
      searchYoutube: (query: string) => Promise<VideoSearchOutcome>;
      requestMicAccess?: () => Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'>;
      /** 로컬 음성인식 (Mac 앱 only). */
      stt?: LocalSttApi;
      /** macOS camera permission (TCC) — asks once when not determined. */
      requestCameraAccess?: () => Promise<'granted' | 'denied' | 'restricted' | 'not-determined' | 'unknown'>;
      openCameraSettings?: () => Promise<boolean>;
      getDeviceInfo?: () => Promise<{ deviceName: string; platform: string; appVersion: string }>;
      getYoutubeVideoInfo: (videoId: string) => Promise<VideoInfoOutcome>;
      webSearch: (query: string) => Promise<WebSearchOutcome>;
      selfAi?: {
        status: () => Promise<{ ok: boolean; running: boolean; model: string | null; models: string[]; reason: string | null }>;
        chat: (request: SelfAiChatRequest, onDelta?: (delta: string) => void) => Promise<SelfAiChatResult>;
        cancel: (requestId: string) => Promise<boolean>;
      };
      /** 자체 검색 ON/OFF (Mac · Windows 앱) — electron/selfSearch/service.cjs. */
      selfSearch?: {
        status: () => Promise<import('./lib/selfResearch/searchSwitch').SelfSearchStatus>;
        setEnabled: (on: boolean) => Promise<{ ok: boolean; code?: string; message?: string; external?: boolean; stoppedServer?: boolean }>;
        onChange: (cb: () => void) => () => void;
      };
      research?: { status: () => Promise<{ ok: boolean; url: string | null; disabled?: boolean }>; search: (request: ResearchRequest) => Promise<ResearchOutcome>; entity?: (name: string) => Promise<PersonName> };
      saveVideo: (id: string, base64Data: string) => Promise<{ ok: true; path: string } | { ok: false; message: string }>;
      deleteVideo: (path: string) => Promise<{ ok: boolean; message?: string }>;
      revealVideo: (path: string) => void;
      openVideo: (path: string) => Promise<{ ok: boolean; message?: string }>;
      /** Read-only bytes of a saved recording inside the app's sparring-videos folder (스파링 분석 2.0). */
      readVideo?: (path: string) => Promise<{ ok: true; data: Uint8Array<ArrayBuffer> } | { ok: false; message: string }>;
      startPowerSaveBlocker: () => Promise<{ ok: boolean }>;
      stopPowerSaveBlocker: () => Promise<{ ok: boolean }>;
    };
  }
}
