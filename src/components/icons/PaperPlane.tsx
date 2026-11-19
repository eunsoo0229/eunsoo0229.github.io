import type { CSSProperties } from 'react';

/**
 * 공유(보내기) 종이비행기 — 브랜드 글리프 규칙(24 그리드, 각진 끝·마이터 연결, 1.75 선)에 맞춰 직접 그린 아이콘.
 * 위·아래 날개 두 면과 가운데 접힘선, 꼬리의 접힘 한 칸은 강조선(.mdx-a → --mdx-icon-accent)으로 그린다.
 * 크기·색은 다른 <Icon> 과 같은 .ui-icon/.mdx-icon 규칙을 따른다.
 */
export default function PaperPlane({ label, className, style }: { label?: string; className?: string; style?: CSSProperties }) {
  return (
    <svg
      className={`ui-icon mdx-icon mx-plane${className ? ` ${className}` : ''}`}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="square"
      strokeLinejoin="miter"
      strokeMiterlimit={8}
      role={label ? 'img' : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      focusable="false"
      style={style}
    >
      {/* 위 날개: 코(21,3) → 왼쪽 끝(2.5,10.5) → 접힘점(10,14) */}
      <path d="M21 3L2.5 10.5L10 14Z" />
      {/* 아래 날개: 코 → 접힘점 → 아래 끝(13.5,21.5) */}
      <path d="M21 3L10 14L13.5 21.5Z" />
      {/* 꼬리 접힘 */}
      <path className="mdx-a" d="M10 14V19.5L12.4 17.1" />
    </svg>
  );
}
