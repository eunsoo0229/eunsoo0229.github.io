import type { ReactNode } from 'react';
import { IMAGERY } from './imagery';
import { MatMark } from './BrandMarks';

/** Login / signup / reset — a split frame: a portrait plate with the brand line, and the form panel. The form pages are unchanged inside. */
export default function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auth" data-testid="auth-frame">
      <aside className="mx-auth__art" style={{ backgroundImage: `url(${IMAGERY.authPortrait})` }} aria-hidden="true">
        <span className="mx-eyebrow">MEMBERS · THE MARTIAL ARTS INDEX</span>
        <p className="mx-auth__quote">
          STUDY<br />THE CRAFT.<br /><em>OWN THE ROUND.</em>
        </p>
        <span className="mx-eyebrow mx-eyebrow--dim" style={{ marginTop: 18, display: 'flex', gap: 8, alignItems: 'center' }}>
          <MatMark size={12} /> 하나의 계정으로 학습 · 코칭 · 체육관 · 마켓 · 커뮤니티
        </span>
      </aside>
      <div className="mx-auth__panel">{children}</div>
    </div>
  );
}
