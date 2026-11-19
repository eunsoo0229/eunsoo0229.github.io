import { NavLink, Link, useLocation, useNavigate } from 'react-router-dom';
import { isAiCoachPath } from '../lib/aiCoach/aiFeatureCatalog';
import { useEffect, useRef, useState } from 'react';
import SearchBar from './SearchBar';
import AiAskModal from './AiAskModal';
import { useTheme } from '../lib/theme';
import { useAuth } from '../lib/auth/AuthProvider';
import { signOutUser } from '../lib/auth/authService';
import Icon, { Glyph } from './Icon';
import { useNotificationAlerts } from '../lib/social/useNotificationAlerts';


const THEME_ICON = {
  system: 'theme-system',
  light: 'theme-light',
  dark: 'theme-dark',
} as const;

// Kept short on purpose — these are the links people reach for constantly.
// Everything else (still one click away) lives in the "메뉴" dropdown below,
// so the bar never wraps onto a second line no matter how many features get
// added later.
const NAV_PRIMARY = [
  { to: '/learning', label: '학습' },
  { to: '/my-skills', label: '나의 기술' },
  { to: '/coach', label: 'AI 코치' },
  { to: '/gyms', label: '체육관' },
  { to: '/gear', label: '마켓' },
  { to: '/community', label: '커뮤니티' },
];

// Visually grouped for the "메뉴" dropdown / mobile menu — purely a
// rendering grouping, NAV_MORE below is flattened back out of this so every
// existing consumer (isInMore, NAV_ALL_MOBILE) sees the exact same flat list
// in the exact same order as before.
const NAV_MORE_GROUPS = [
  {
    label: '무술',
    items: [
      { to: '/arts', label: '무술 목록' },
      { to: '/techniques', label: '전체 기술' },
      { to: '/learned-techniques', label: '배운 기술' },
      { to: '/graph', label: '기술 그래프' },
      { to: '/techniques/request', label: '기술 요청' },
      { to: '/categories', label: '기술 카테고리 관리' },
      { to: '/user-combos', label: '사용자 콤보·셋업' },
      { to: '/favorites', label: '즐겨찾기' },
    ],
  },
  {
    label: '훈련',
    items: [
      { to: '/training', label: '훈련 홈' },
      { to: '/free-training', label: '자유훈련' },
      { to: '/training/routines', label: '훈련 루틴' },
      { to: '/training/trainer', label: 'AI 트레이너 (루틴·식단)' },
      { to: '/training/exercises', label: '헬스 운동' },
      { to: '/combos', label: '콤보 북' },
      { to: '/tactics', label: '전술 셋업' },
      { to: '/skill-tree', label: '비주얼 기술 트리' },
      { to: '/program', label: '개인 훈련 프로그램' },
      { to: '/progress', label: '훈련 성과 검증' },
      { to: '/training-analytics', label: '훈련 분석/캘린더' },
      { to: '/review', label: '복습' },
      { to: '/sparring/record', label: '스파링 촬영' },
    ],
  },
  {
    label: '커리큘럼',
    items: [
      { to: '/learning', label: '학습 커리큘럼' },
      { to: '/marketplace', label: '커리큘럼 마켓' },
    ],
  },
  {
    label: '마켓',
    items: [
      { to: '/gear', label: '격투기 장비 중고거래' },
      { to: '/gear/new', label: '장비 판매 등록' },
      { to: '/gear/mine', label: '내 거래 관리' },
      { to: '/gear/orders', label: '택배 거래 주문' },
    ],
  },
  {
    label: '홈트',
    items: [
      { to: '/home-training', label: '홈트레이닝' },
      { to: '/home-training/request', label: '홈트 운동 요청' },
    ],
  },
  {
    label: '영양',
    items: [
      { to: '/nutrition', label: '오늘의 영양' },
      { to: '/nutrition/goals', label: '영양 목표' },
    ],
  },
  {
    label: '커뮤니티',
    items: [
      { to: '/community', label: '커뮤니티' },
      { to: '/shorts', label: '숏폼' },
      { to: '/evaluations', label: '내 기술 평가' },
      { to: '/messages', label: '메시지' },
      { to: '/clans', label: '클랜' },
      { to: '/notifications', label: '알림' },
    ],
  },
  {
    label: '체육관',
    items: [
      { to: '/gyms', label: '체육관 찾기·가격 비교' },
      { to: '/gyms/deals', label: '제휴 할인 혜택' },
      { to: '/gyms/coupons', label: '내 할인 쿠폰' },
      { to: '/gym', label: '체육관 참가 (학생)' },
      { to: '/gym/admin', label: '체육관 운영 대시보드 (관장님)' },
      { to: '/gyms/manage', label: '체육관 등록·제휴 신청' },
    ],
  },
  {
    label: '계정',
    items: [
      { to: '/dashboard', label: '대시보드' },
      { to: '/fighter-profile', label: '개인 파이터 프로필' },
      { to: '/stats', label: '나의 통계' },
      { to: '/profile', label: '프로필' },
      { to: '/verification', label: '지도자·숙련자 자격 검증' },
      { to: '/admin/platform', label: '플랫폼 관리 (운영자)' },
    ],
  },
];
const NAV_MORE = NAV_MORE_GROUPS.flatMap((g) => g.items);

// Below 720px, .nav-links (and everything inside it — 학습/나의 기술/AI 코치
// plus the "메뉴" dropdown covering all of NAV_MORE) is hidden by CSS with no
// replacement, which on any real phone (always ≤720px in portrait) makes
// those pages completely unreachable from the header. The mobile menu button
// is that replacement — same destinations (홈 + NAV_PRIMARY ungrouped, then
// NAV_MORE_GROUPS grouped the same way as the desktop dropdown), shown only
// at that breakpoint (see .mobile-menu-btn in global.css).

export default function Header() {
  const { theme, cycleTheme } = useTheme();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const { isConfigured, user, loading: authLoading } = useAuth();
  const [aiOpen, setAiOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const moreRef = useRef<HTMLDivElement>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuRef = useRef<HTMLDivElement>(null);
  const { unread, invite, dismissInvite } = useNotificationAlerts(isConfigured && user ? user.id : null, pathname);

  async function handleLogout() {
    await signOutUser();
    navigate('/login');
  }

  const isInMore = NAV_MORE.some((item) => pathname === item.to || pathname.startsWith(item.to + '/'));

  useEffect(() => {
    if (!moreOpen) return;
    function onDocumentClick(e: MouseEvent) {
      if (moreRef.current && !moreRef.current.contains(e.target as Node)) setMoreOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [moreOpen]);

  useEffect(() => {
    if (!mobileMenuOpen) return;
    function onDocumentClick(e: MouseEvent) {
      if (mobileMenuRef.current && !mobileMenuRef.current.contains(e.target as Node)) setMobileMenuOpen(false);
    }
    document.addEventListener('mousedown', onDocumentClick);
    return () => document.removeEventListener('mousedown', onDocumentClick);
  }, [mobileMenuOpen]);

  useEffect(() => {
    setMoreOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <header className="site-header">
      <div className="container site-header__inner">
        <NavLink to="/" className="brand">
          <span className="brand__wordmark" role="img" aria-label="MARTIALDEX" />
        </NavLink>
        <nav className="nav-links">
          <NavLink to="/" end>
            홈
          </NavLink>
          {NAV_PRIMARY.map((item) => (
            <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive || (item.to === '/coach' && isAiCoachPath(pathname)) ? 'active' : '')}>
              {item.label}
            </NavLink>
          ))}
          <div className="nav-more" ref={moreRef}>
            <button
              type="button"
              className={`nav-more__button ${isInMore ? 'active' : ''}`}
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
            >
              메뉴 <Glyph set="ui" name="chevron-down" style={moreOpen ? { transform: 'rotate(180deg)' } : undefined} />
            </button>
            {moreOpen && (
              <div className="nav-more__panel">
                {NAV_MORE_GROUPS.map((group) => (
                  <div key={group.label} className="nav-more__group">
                    <div className="nav-more__group-label">{group.label}</div>
                    {group.items.map((item) => (
                      <NavLink key={item.to} to={item.to}>
                        {item.label}
                      </NavLink>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
        </nav>
        <div className="header-spacer" />
        <div className="nav-more mobile-menu-wrap" ref={mobileMenuRef}>
          <button
            type="button"
            className="icon-btn mobile-menu-btn"
            onClick={() => setMobileMenuOpen((v) => !v)}
            aria-expanded={mobileMenuOpen}
            title="메뉴"
            aria-label="메뉴"
          >
            <Icon name="menu" />
          </button>
          {mobileMenuOpen && (
            <div className="nav-more__panel mobile-menu-panel">
              <NavLink to="/" end>
                홈
              </NavLink>
              {NAV_PRIMARY.map((item) => (
                <NavLink key={item.to} to={item.to} className={({ isActive }) => (isActive || (item.to === '/coach' && isAiCoachPath(pathname)) ? 'active' : '')}>
                  {item.label}
                </NavLink>
              ))}
              {NAV_MORE_GROUPS.map((group) => (
                <div key={group.label} className="nav-more__group">
                  <div className="nav-more__group-label">{group.label}</div>
                  {group.items.map((item) => (
                    <NavLink key={item.to} to={item.to}>
                      {item.label}
                    </NavLink>
                  ))}
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="header-search-wrap">
          <SearchBar variant="header" />
        </div>
        <Link to="/techniques" className="icon-btn mobile-search-btn" title="기술 검색" aria-label="기술 검색">
          <Icon name="search" />
        </Link>
        <button className="icon-btn" onClick={() => setAiOpen(true)} title="AI에게 질문" aria-label="AI에게 질문">
          <Icon name="spark" />
        </button>
        <button
          className="icon-btn"
          onClick={cycleTheme}
          title={`테마: ${theme} (클릭해서 전환)`}
        >
          <Icon name={THEME_ICON[theme]} />
        </button>
        {isConfigured && user && (
          <Link to="/notifications" className="icon-btn notif-bell" title={unread > 0 ? `알림 ${unread}개` : '알림'} aria-label={unread > 0 ? `알림, 읽지 않은 알림 ${unread}개` : '알림'} data-testid="header-notifications">
            <Icon name="bell" />
            {unread > 0 && <span className="notif-bell__badge">{unread > 99 ? '99+' : unread}</span>}
          </Link>
        )}
        {isConfigured && !authLoading && (
          user ? (
            <button className="icon-btn" onClick={handleLogout} title="로그아웃" aria-label="로그아웃">
              <Icon name="logout" />
            </button>
          ) : (
            <Link to="/login" className="icon-btn" title="로그인" aria-label="로그인">
              <Icon name="user" />
            </Link>
          )
        )}
      </div>
      {aiOpen && <AiAskModal onClose={() => setAiOpen(false)} />}
      {invite && pathname !== '/notifications' && (
        <div className="notif-toast" role="status" data-testid="clan-invite-toast">
          <Icon name="users" />
          <span className="notif-toast__text">
            {invite.clanName ? `'${invite.clanName}' 클랜에서 초대가 왔습니다.` : '클랜 초대가 왔습니다.'}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => { dismissInvite(); navigate('/notifications'); }}>
            확인
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={dismissInvite} aria-label="닫기">
            닫기
          </button>
        </div>
      )}
    </header>
  );
}
