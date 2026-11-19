// MARTIALDEX navigation — the catalogue. Every route the old header exposed is kept (same paths),
// regrouped into numbered chapters for the Index identity.
import type { IconName } from '../Icon';
import { isAiCoachPath } from '../../lib/aiCoach/aiFeatureCatalog';

export interface NavLinkItem {
  to: string;
  label: string;
}
export interface Chapter {
  no: string;
  key: string;
  title: string; // display (EN, condensed caps)
  label: string; // Korean name
  to: string; // chapter landing
  icon: IconName;
  /** path prefixes that belong to this chapter (for the active state + chapter strip) */
  match: string[];
  items: NavLinkItem[];
}

export const CHAPTERS: Chapter[] = [
  {
    no: '01', key: 'learn', title: 'LEARN', label: '학습', to: '/learning', icon: 'book',
    match: ['/learning', '/arts', '/techniques', '/learned-techniques', '/graph', '/categories', '/user-combos', '/favorites', '/skill-tree', '/situation', '/fighter-style', '/ai-curriculum', '/marketplace', '/my-curriculum'],
    items: [
      { to: '/my-curriculum', label: '나의 학습 커리큘럼' },
      { to: '/learning', label: '학습 커리큘럼' },
      { to: '/arts', label: '무술 목록' },
      { to: '/techniques', label: '전체 기술' },
      { to: '/learned-techniques', label: '배운 기술' },
      { to: '/graph', label: '기술 그래프' },
      { to: '/skill-tree', label: '비주얼 기술 트리' },
      { to: '/user-combos', label: '사용자 콤보·셋업' },
      { to: '/favorites', label: '즐겨찾기' },
      { to: '/techniques/request', label: '기술 요청' },
      { to: '/categories', label: '기술 카테고리 관리' },
      { to: '/marketplace', label: '커리큘럼 마켓' },
    ],
  },
  {
    no: '02', key: 'coach', title: 'AI COACH', label: 'AI 코치', to: '/coach', icon: 'coach',
    match: ['/coach', '/ai-', '/pose-check', '/review', '/personal-coach'],
    items: [
      { to: '/coach', label: 'AI 코치 홈' },
      { to: '/coach/chat', label: 'AI 코치와 대화' },
      { to: '/coach/class', label: 'AI 코치 클래스' },
      { to: '/coach/lesson', label: '1회 수업' },
      { to: '/coach/mitt', label: '비주얼 미트' },
      { to: '/review', label: '복습' },
    ],
  },
  {
    no: '03', key: 'train', title: 'TRAIN', label: '훈련', to: '/training', icon: 'dumbbell',
    match: ['/training', '/free-training', '/combos', '/tactics', '/program', '/progress', '/sparring', '/today-training', '/home-training', '/nutrition', '/stats', '/dashboard', '/goals', '/training-analytics', '/my-skills', '/my-style', '/performance'],
    items: [
      { to: '/training', label: '훈련 홈' },
      { to: '/program', label: '개인 훈련 프로그램' },
      { to: '/performance', label: '훈련 성과 분석' },
      { to: '/progress', label: '훈련 성과 검증' },
      { to: '/today-training', label: '오늘의 훈련' },
      { to: '/free-training', label: '자유훈련' },
      { to: '/training/routines', label: '훈련 루틴' },
      { to: '/training/trainer', label: 'AI 트레이너 (루틴·식단)' },
      { to: '/training/exercises', label: '헬스 운동' },
      { to: '/combos', label: '콤보 북' },
      { to: '/tactics', label: '전술 셋업' },
      { to: '/training-analytics', label: '훈련 분석/캘린더' },
      { to: '/sparring/record', label: '스파링 촬영' },
      { to: '/home-training', label: '홈트레이닝' },
      { to: '/home-training/request', label: '홈트 운동 요청' },
      { to: '/nutrition', label: '오늘의 영양' },
      { to: '/nutrition/goals', label: '영양 목표' },
      { to: '/goals', label: '훈련 목표' },
      { to: '/my-skills', label: '나의 기술' },
      { to: '/stats', label: '나의 통계' },
      { to: '/dashboard', label: '대시보드' },
    ],
  },
  {
    no: '04', key: 'gyms', title: 'GYMS', label: '체육관', to: '/gyms', icon: 'building',
    match: ['/gyms', '/gym', '/business'],
    items: [
      { to: '/gyms', label: '체육관 찾기·가격 비교' },
      { to: '/gyms/deals', label: '제휴 할인 혜택' },
      { to: '/gyms/coupons', label: '내 할인 쿠폰' },
      { to: '/gym', label: '체육관 참가 (학생)' },
      { to: '/gym/admin', label: '체육관 운영 대시보드' },
      { to: '/business', label: '사업자 요금제' },
      { to: '/gyms/manage', label: '체육관 등록·제휴 신청' },
    ],
  },
  {
    no: '05', key: 'market', title: 'MARKET', label: '마켓', to: '/gear', icon: 'cart',
    match: ['/gear', '/content', '/library', '/creator', '/wallet', '/billing'],
    items: [
      { to: '/content', label: '디지털 콘텐츠 마켓' },
      { to: '/library', label: '내 라이브러리' },
      { to: '/creator', label: '크리에이터 스튜디오' },
      { to: '/wallet', label: '내 지갑 (MARTIAL COIN)' },
      { to: '/wallet/store', label: '코인 스토어' },
      { to: '/gear', label: '격투기 장비 중고거래' },
      { to: '/gear/new', label: '장비 판매 등록' },
      { to: '/gear/mine', label: '내 거래 관리' },
      { to: '/gear/orders', label: '택배 거래 주문' },
    ],
  },
  {
    no: '06', key: 'community', title: 'COMMUNITY', label: '커뮤니티', to: '/community', icon: 'users',
    match: ['/community', '/shorts', '/messages', '/clans', '/notifications', '/u/', '/evaluations'],
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
    no: '07', key: 'profile', title: 'PROFILE', label: '마이', to: '/fighter-profile', icon: 'user',
    match: ['/fighter-profile', '/profile', '/verification', '/admin', '/membership'],
    items: [
      { to: '/fighter-profile', label: '개인 파이터 프로필' },
      { to: '/membership', label: '멤버십 (FREE · PRO)' },
      { to: '/profile', label: '프로필·설정' },
      { to: '/verification', label: '지도자·숙련자 자격 검증' },
      { to: '/admin/platform', label: '플랫폼 관리 (운영자)' },
    ],
  },
];

// AI-only screens (situation, ai-combo, my-style …) live behind the AI Coach hub, not in other menus
// (the AI tab is the single entry — see aiFeatureCatalog.AI_COACH_PATHS).
export function chapterFor(pathname: string): Chapter | null {
  if (pathname === '/' || pathname === '') return null;
  if (isAiCoachPath(pathname)) return CHAPTERS.find((c) => c.key === 'coach') ?? null;
  let best: { c: Chapter; len: number } | null = null;
  for (const c of CHAPTERS) {
    for (const m of c.match) {
      if (pathname === m || pathname.startsWith(m.endsWith('/') || m.endsWith('-') ? m : `${m}/`) || pathname === m) {
        if (!best || m.length > best.len) best = { c, len: m.length };
      }
    }
  }
  return best?.c ?? null;
}

/** Mobile bottom bar — five thumbs-reach destinations */
export const TAB_BAR: { to: string; label: string; icon: IconName; chapter: string | null }[] = [
  { to: '/', label: '홈', icon: 'home', chapter: null },
  { to: '/learning', label: '학습', icon: 'book', chapter: 'learn' },
  { to: '/coach', label: 'AI 코치', icon: 'coach', chapter: 'coach' },
  { to: '/community', label: '커뮤니티', icon: 'users', chapter: 'community' },
  { to: '/fighter-profile', label: '마이', icon: 'user', chapter: 'profile' },
];
