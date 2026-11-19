import { useCallback, useEffect, useState } from 'react';
import { getSelfSearchStatus, setSelfSearchEnabled, subscribeSelfSearch, type SelfSearchStatus } from '../lib/selfResearch/searchSwitch';

// 설정 > AI 엔진 · 자체 웹 검색 — the ON/OFF switch for the self-hosted SearXNG search. The choice
// is kept across restarts; OFF stops only a search server MARTIALDEX started. Disabled, with the
// reason, where there is no search at all (web without a server). Android searches on the device itself.

const PHASE_LABEL: Record<SelfSearchStatus['phase'], string> = {
  off: '꺼짐',
  starting: '시작 중',
  running: '실행 중',
  stopped: '켜짐 · 검색 서버 응답 없음',
  error: '오류',
};

export default function SelfSearchSwitch() {
  const [s, setS] = useState<SelfSearchStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(() => {
    void getSelfSearchStatus().then(setS);
  }, []);
  useEffect(() => {
    refresh();
    return subscribeSelfSearch(refresh);
  }, [refresh]);

  async function toggle(on: boolean) {
    setBusy(true);
    setNote(null);
    const r = await setSelfSearchEnabled(on);
    if (!r.ok && r.message) setNote(r.message);
    setBusy(false);
    refresh();
  }

  if (!s) return null;
  return (
    <div className="self-search-switch" data-testid="self-search-switch">
      <label className="self-search-switch__row">
        <input
          type="checkbox"
          role="switch"
          checked={s.enabled}
          disabled={!s.supported || busy || s.phase === 'starting'}
          onChange={(e) => void toggle(e.target.checked)}
          data-testid="self-search-toggle"
        />
        <span>
          자체 웹 검색 <strong data-testid="self-search-phase" data-phase={s.phase}>{s.supported ? (busy ? '바꾸는 중…' : s.via?.kind === 'device' && s.phase === 'running' ? '켜짐 · 이 기기에서 검색' : PHASE_LABEL[s.phase]) : '사용 불가'}</strong>
          {s.supported && s.external && s.enabled && ' · 사용자가 직접 실행한 검색 서버 (MARTIALDEX가 끄지 않음)'}
          {s.supported && s.owned && ' · MARTIALDEX가 실행함'}
        </span>
      </label>
      <p className="muted local-ai-panel__help">
        {!s.supported
          ? s.reason
          : s.via?.kind === 'device'
            ? '켜면 코치가 영상·논문·최신 자료를 이 기기에서 직접 찾습니다 (Bing · DuckDuckGo · 위키백과 · YouTube · Crossref · OpenAlex · arXiv 공개 검색, API 키·유료 서비스 없음). 검색어는 이 검색 사이트들로 전송됩니다. 꺼도 로컬 AI 대화와 MARTIALDEX 기술 자료 검색은 그대로 쓰이고, 다른 검색 서비스로 바꾸지 않습니다.'
            : '켜면 코치가 영상·논문·최신 자료를 이 컴퓨터의 자체 검색 서버(SearXNG)로 찾습니다. 꺼도 로컬 AI 대화와 MARTIALDEX 기술 자료 검색은 그대로 쓰이고, 다른 검색 서비스로 바꾸지 않습니다.'}
      </p>
      {s.supported && !s.installed && <p className="local-ai-panel__warn">자체 검색 실행 환경이 없습니다: {s.missing.join(', ')}</p>}
      {(note || s.error) && (
        <p className="local-ai-panel__error" role="alert" data-testid="self-search-error">
          {note ?? s.error?.message}
        </p>
      )}
    </div>
  );
}
