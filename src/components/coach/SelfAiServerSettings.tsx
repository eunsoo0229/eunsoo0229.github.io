import { useState } from 'react';
import { getServerConfig, setServerConfig } from '../../lib/selfAi/transport';

// Connects this device to a MARTIALDEX self-AI server (server/self-ai) — for Android / web,
// which cannot run the model and the search themselves. The token is issued by the server's
// owner (server/self-ai/auth.cjs) and stays on this device only.

export default function SelfAiServerSettings({ onChange }: { onChange: () => void }) {
  const saved = getServerConfig();
  const [open, setOpen] = useState(!saved);
  const [url, setUrl] = useState(saved?.url ?? '');
  const [token, setToken] = useState(saved?.token ?? '');
  const [msg, setMsg] = useState<string | null>(null);

  async function test() {
    const u = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//.test(u) || !token.trim()) {
      setMsg('서버 주소(http:// 또는 https://)와 토큰을 입력해 주세요.');
      return;
    }
    try {
      const res = await fetch(`${u}/v1/status`, { headers: { authorization: `Bearer ${token.trim()}` }, signal: AbortSignal.timeout(6000) });
      if (res.status === 401) return setMsg('토큰이 올바르지 않습니다.');
      if (!res.ok) return setMsg(`서버 오류 (${res.status})`);
      const j = (await res.json()) as { user: string; model: { ok: boolean; model: string | null }; search: { ok: boolean } };
      setServerConfig({ url: u, token: token.trim() });
      setMsg(`연결됨 — 사용자 ${j.user} · 모델 ${j.model.ok ? j.model.model : '꺼짐'} · 검색 ${j.search.ok ? '사용 가능' : '꺼짐'}`);
      setOpen(false);
      onChange();
    } catch {
      setMsg('서버에 연결할 수 없습니다. 주소와 네트워크를 확인해 주세요.');
    }
  }

  return (
    <div className="self-ai-server" data-testid="self-ai-server">
      {!open ? (
        <p className="muted">
          자체 AI 서버: {saved ? saved.url : '연결 안 됨'}{' '}
          <button type="button" className="link-button" onClick={() => setOpen(true)} data-testid="self-ai-server-edit">
            {saved ? '변경' : '연결'}
          </button>
          {saved && (
            <>
              {' · '}
              <button type="button" className="link-button" onClick={() => { setServerConfig(null); setMsg('연결을 해제했습니다.'); onChange(); }} data-testid="self-ai-server-clear">
                해제
              </button>
            </>
          )}
        </p>
      ) : (
        <div className="self-ai-server__form">
          <p className="muted">이 기기에서는 AI 모델과 검색을 직접 실행하지 않습니다. MARTIALDEX 자체 AI 서버 주소와 발급받은 토큰을 입력하면 같은 자체 AI를 사용합니다.</p>
          <input className="input" placeholder="서버 주소 (예: http://localhost:8787)" value={url} onChange={(e) => setUrl(e.target.value)} data-testid="self-ai-server-url" />
          <input className="input" placeholder="접근 토큰" type="password" value={token} onChange={(e) => setToken(e.target.value)} data-testid="self-ai-server-token" />
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void test()} data-testid="self-ai-server-connect">
            연결 확인
          </button>
        </div>
      )}
      {msg && <p className="muted" data-testid="self-ai-server-msg">{msg}</p>}
    </div>
  );
}
