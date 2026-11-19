// MARTIALDEX AppShell — replaces the old site header.
// Desktop: a slim index bar (wordmark · numbered chapters · tools) and a full-screen INDEX overlay that
// lays the whole catalogue out as an editorial table of contents. Phone/tablet: compact top bar +
// thumb-reach tab bar. Every destination the old header linked to is still reachable (navConfig.ts).
import { useEffect, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import Icon from '../Icon';
import SearchBar from '../SearchBar';
import AiAskModal from '../AiAskModal';
import { useTheme } from '../../lib/theme';
import { useAuth } from '../../lib/auth/AuthProvider';
import { signOutUser } from '../../lib/auth/authService';
import { useNotificationAlerts } from '../../lib/social/useNotificationAlerts';
import { CHAPTERS, TAB_BAR, chapterFor } from './navConfig';
import { IndexNo, MatMark, Wordmark } from './BrandMarks';

const THEME_ICON = { system: 'theme-system', light: 'theme-light', dark: 'theme-dark' } as const;
const THEME_LABEL = { system: '시스템', light: '본(라이트)', dark: '잉크(다크)' } as const;

export function IndexMenu({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { pathname } = useLocation();
  const current = chapterFor(pathname);
  const [hover, setHover] = useState<string | null>(null);
  const focus = CHAPTERS.find((c) => c.key === (hover ?? current?.key)) ?? CHAPTERS[0];

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div className={`mx-index-menu${open ? ' is-open' : ''}`} aria-hidden={!open} role="dialog" aria-label="전체 메뉴" data-testid="index-menu">
      <div className="mx-index-menu__bar">
        <Wordmark />
        <button type="button" className="mx-index-menu__close" onClick={onClose} aria-label="메뉴 닫기" tabIndex={open ? 0 : -1}>
          <span>CLOSE</span>
          <Icon name="close" />
        </button>
      </div>
      <div className="mx-index-menu__body">
        <nav className="mx-index-menu__chapters" aria-label="챕터">
          <NavLink to="/" end className="mx-index-menu__chapter" onClick={onClose} tabIndex={open ? 0 : -1} onMouseEnter={() => setHover(null)}>
            <IndexNo n="00" />
            <span className="mx-index-menu__title">HOME</span>
            <span className="mx-index-menu__ko">홈</span>
          </NavLink>
          {CHAPTERS.map((c) => (
            <Link
              key={c.key}
              to={c.to}
              className={`mx-index-menu__chapter${current?.key === c.key ? ' is-current' : ''}${focus.key === c.key ? ' is-focus' : ''}`}
              onClick={onClose}
              onMouseEnter={() => setHover(c.key)}
              onFocus={() => setHover(c.key)}
              tabIndex={open ? 0 : -1}
              data-testid={`index-chapter-${c.key}`}
            >
              <IndexNo n={c.no} />
              <span className="mx-index-menu__title">{c.title}</span>
              <span className="mx-index-menu__ko">{c.label}</span>
            </Link>
          ))}
        </nav>
        <div className="mx-index-menu__detail" key={focus.key}>
          <div className="mx-index-menu__detail-head">
            <IndexNo n={focus.no} />
            <span>{focus.label}</span>
          </div>
          <ul className="mx-index-menu__links">
            {focus.items.map((it) => (
              <li key={it.to}>
                <NavLink to={it.to} end onClick={onClose} tabIndex={open ? 0 : -1}>
                  {it.label}
                  <Icon name="chevron-right" />
                </NavLink>
              </li>
            ))}
          </ul>
          {/* the full catalogue, for keyboard / phone users who never hover */}
          <details className="mx-index-menu__all">
            <summary tabIndex={open ? 0 : -1}>전체 목록 보기</summary>
            <div className="mx-index-menu__all-grid">
              {CHAPTERS.map((c) => (
                <div key={c.key}>
                  <div className="mx-index-menu__all-head"><IndexNo n={c.no} /> {c.label}</div>
                  {c.items.map((it) => (
                    <NavLink key={it.to} to={it.to} end onClick={onClose} tabIndex={open ? 0 : -1}>{it.label}</NavLink>
                  ))}
                </div>
              ))}
            </div>
          </details>
        </div>
      </div>
      <div className="mx-index-menu__foot">
        <span>THE MARTIAL ARTS INDEX</span>
        <MatMark size={14} />
        <span>참고용 데이터 · 실전 적용은 지도자 감독 하에</span>
      </div>
    </div>
  );
}

export default function AppShell() {
  const { theme, cycleTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isConfigured, user, loading: authLoading } = useAuth();
  const { unread, invite, dismissInvite } = useNotificationAlerts(isConfigured && user ? user.id : null, pathname);
  const [menuOpen, setMenuOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const chapter = chapterFor(pathname);

  useEffect(() => {
    setMenuOpen(false);
    setSearchOpen(false);
  }, [pathname]);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener('scroll', on, { passive: true });
    return () => window.removeEventListener('scroll', on);
  }, []);

  async function handleLogout() {
    await signOutUser();
    navigate('/login');
  }

  return (
    <>
      <header className={`mx-bar${scrolled ? ' is-scrolled' : ''}`} data-testid="app-shell">
        <div className="mx-bar__inner">
          <Link to="/" className="mx-bar__brand" aria-label="MARTIALDEX 홈">
            <Wordmark />
          </Link>
          <nav className="mx-bar__chapters" aria-label="주요 메뉴">
            {CHAPTERS.slice(0, 6).map((c) => (
              <NavLink key={c.key} to={c.to} className={() => `mx-bar__chapter${chapter?.key === c.key ? ' is-active' : ''}`} data-testid={`nav-${c.key}`}>
                <IndexNo n={c.no} />
                <span>{c.label}</span>
              </NavLink>
            ))}
          </nav>
          <div className="mx-bar__tools">
            <button type="button" className="mx-tool" onClick={() => setSearchOpen((v) => !v)} aria-label="기술 검색" aria-expanded={searchOpen}>
              <Icon name="search" />
            </button>
            <button type="button" className="mx-tool mx-tool--hide-sm" onClick={() => setAiOpen(true)} aria-label="AI에게 질문" title="AI에게 질문">
              <Icon name="spark" />
            </button>
            <button type="button" className="mx-tool mx-tool--hide-sm" onClick={cycleTheme} aria-label={`테마: ${THEME_LABEL[theme]}`} title={`테마: ${THEME_LABEL[theme]} (클릭해서 전환)`}>
              <Icon name={THEME_ICON[theme]} />
            </button>
            {isConfigured && user && (
              <Link to="/notifications" className="mx-tool mx-tool--bell" aria-label={unread > 0 ? `알림, 읽지 않은 알림 ${unread}개` : '알림'} data-testid="header-notifications">
                <Icon name="bell" />
                {unread > 0 && <span className="mx-tool__badge">{unread > 99 ? '99+' : unread}</span>}
              </Link>
            )}
            {isConfigured && !authLoading && (user ? (
              <button type="button" className="mx-tool mx-tool--hide-sm" onClick={handleLogout} aria-label="로그아웃" title="로그아웃">
                <Icon name="logout" />
              </button>
            ) : (
              <Link to="/login" className="mx-bar__signin">로그인</Link>
            ))}
            <button type="button" className="mx-bar__index" onClick={() => setMenuOpen(true)} aria-label="전체 메뉴 열기" aria-expanded={menuOpen} data-testid="index-open">
              <span className="mx-bar__index-lines" aria-hidden="true"><i /><i /></span>
              <span className="mx-bar__index-word">INDEX</span>
            </button>
          </div>
        </div>
        {searchOpen && (
          <div className="mx-bar__search">
            <SearchBar variant="header" />
          </div>
        )}
        {chapter && (
          <div className="mx-chapter-strip" aria-hidden="true">
            <span className="mx-chapter-strip__no">CH.{chapter.no}</span>
            <span className="mx-chapter-strip__rule" />
            <span className="mx-chapter-strip__title">{chapter.title}</span>
          </div>
        )}
      </header>

      <IndexMenu open={menuOpen} onClose={() => setMenuOpen(false)} />

      <nav className="mx-tabbar" aria-label="하단 메뉴" data-testid="tab-bar">
        {TAB_BAR.map((t) => {
          const active = t.chapter ? chapter?.key === t.chapter : pathname === '/';
          return (
            <Link key={t.to} to={t.to} className={`mx-tabbar__item${active ? ' is-active' : ''}`} aria-current={active ? 'page' : undefined}>
              <Icon name={t.icon} />
              <span>{t.label}</span>
            </Link>
          );
        })}
      </nav>

      {aiOpen && <AiAskModal onClose={() => setAiOpen(false)} />}
      {invite && pathname !== '/notifications' && (
        <div className="notif-toast mx-toast" role="status" data-testid="clan-invite-toast">
          <Icon name="users" />
          <span className="notif-toast__text">{invite.clanName ? `'${invite.clanName}' 클랜에서 초대가 왔습니다.` : '클랜 초대가 왔습니다.'}</span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { dismissInvite(); navigate('/notifications'); }}>확인</button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissInvite} aria-label="닫기">닫기</button>
        </div>
      )}
    </>
  );
}

export function BrandFooter() {
  return (
    <footer className="mx-footer">
      <div className="mx-footer__inner">
        <div className="mx-footer__brand">
          <Wordmark stacked />
          <p>The Martial Arts Index — 기술 백과사전 · AI 코치 · 훈련 · 체육관 · 커뮤니티</p>
        </div>
        <div className="mx-footer__cols">
          {CHAPTERS.slice(0, 6).map((c) => (
            <div key={c.key}>
              <div className="mx-footer__head"><IndexNo n={c.no} /> {c.title}</div>
              {c.items.slice(0, 4).map((it) => <Link key={it.to} to={it.to}>{it.label}</Link>)}
            </div>
          ))}
        </div>
        <div className="mx-footer__legal">
          <span>MARTIALDEX — 무술 기술 백과사전 (참고용 데이터, 실전 적용은 지도자 감독 하에)</span>
        </div>
      </div>
    </footer>
  );
}
