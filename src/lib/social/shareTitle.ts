import type { CommunityPost } from '../communityPost/types';

/** 공유 카드에 보일 게시물 제목: 본문 첫 줄 → 태그한 기술·콤보 이름 → 기본 문구. */
export function postShareTitle(post: Pick<CommunityPost, 'content' | 'tags' | 'authorNickname'>, fallback = '게시물'): string {
  const line = post.content.split('\n').map((l) => l.trim()).find(Boolean);
  if (line) return line.length > 60 ? `${line.slice(0, 59)}…` : line;
  if (post.tags.length) return `${post.tags.map((t) => t.name).slice(0, 3).join(' · ')} ${fallback}`;
  return `${post.authorNickname}님의 ${fallback}`;
}
