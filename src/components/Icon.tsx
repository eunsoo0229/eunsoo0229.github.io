// The MARTIALDEX "Forge" glyph set: every icon is drawn on a 24x24 grid with square caps, miter joins,
// 45° chamfers and one optional red accent layer (see components/icons/glyphs.ts, generated from the
// asset workspace). Section headings and controls use the 'ui' set through <Icon>; the other sets
// (martial arts, AI features, roles, notifications …) render through <Glyph set=… name=…>.
//
// ICON_FOR_EMOJI keeps the old emoji → glyph substitutions reviewable, and lets data that still
// stores an emoji (EmptyState icons, older records) resolve to a glyph.
import type { CSSProperties } from 'react';
import { GLYPHS, type GlyphEl, type GlyphSet } from './icons/glyphs';

export type IconName = keyof (typeof GLYPHS)['ui'];

/** Which glyph replaced which emoji. */
export const ICON_FOR_EMOJI: Record<string, IconName> = {
  '🥋': 'gi', '🧑‍🥋': 'gi',
  '🥊': 'glove',
  '🤼': 'grapple',
  '🎉': 'celebrate',
  '🧠': 'brain',
  '🎯': 'target',
  '🔗': 'link',
  '✅': 'check', '👍': 'check', '★': 'star-filled', '⭐': 'star-filled',
  '🧍': 'stance',
  '🤖': 'bot',
  '🔁': 'repeat', '🔀': 'repeat',
  '📅': 'calendar',
  '🔥': 'flame',
  '🎥': 'video', '🎬': 'video', '📱': 'video',
  '📷': 'camera',
  '📊': 'chart',
  '📈': 'trend',
  '🧑‍🏫': 'coach',
  '📋': 'list', '📜': 'list', '📒': 'list', '🗒': 'list',
  '⏱': 'timer', '🕓': 'timer', '🕑': 'timer',
  '🎓': 'grad',
  '🏋️': 'dumbbell', '🏋': 'dumbbell', '💪': 'dumbbell',
  '👤': 'user',
  '🧑‍🤝‍🧑': 'users',
  '➕': 'plus',
  '🔍': 'search', '🔎': 'search',
  '📝': 'note', '✍️': 'note',
  '🏛': 'building',
  '🔻': 'down',
  '📘': 'book', '📖': 'book', '📚': 'book',
  '🍚': 'bowl',
  '🛒': 'cart', '🛍': 'cart',
  '⚠️': 'warn',
  '✦': 'spark', '💡': 'spark',
  '🧪': 'flask',
  '🕸': 'graph',
  '🌳': 'tree',
  '🏠': 'home',
  '📥': 'download',
  '🌐': 'globe',
  '🏷': 'tag',
  '🗂️': 'folder', '🗂': 'folder',
  '🔊': 'sound',
  '💰': 'coin',
  '🏆': 'trophy',
  '⚖️': 'scale',
  '🩹': 'bandage',
  '🧩': 'puzzle',
  '📭': 'inbox',
  '🔒': 'lock',
  '⏳': 'hourglass',
  '💳': 'card',
  '👥': 'users',
  '🏗': 'build',
  '☆': 'star',
  '❌': 'close',
  // controls / social actions (Forge set)
  '▶': 'play', '▶️': 'play', '⏸': 'pause', '⏸️': 'pause', '⏹': 'stop', '■': 'stop', '◀': 'prev', '⏮': 'prev', '⏭': 'next',
  '🔇': 'sound-off', '🎙': 'mic', '🎤': 'mic', '📁': 'upload', '♥': 'heart-filled', '♡': 'heart', '❤️': 'heart-filled',
  '💬': 'comment', '🔖': 'bookmark-filled', '📑': 'bookmark', '☰': 'menu', '⌕': 'search', '⚙': 'settings', '⚙️': 'settings',
  '⎋': 'logout', '↩': 'back', '➡': 'forward', '↗': 'external', '✕': 'close', '✓': 'check', '☑': 'check-square', '☐': 'square',
  'ℹ️': 'info', '🖥': 'theme-system', '☀': 'theme-light', '☾': 'theme-dark', '📍': 'pin', '🔔': 'bell', '✉️': 'message',
  '🛡️': 'shield', '🛡': 'shield', '⚔️': 'swords', '⚔': 'swords', '☁️': 'cloud', '⌨️': 'keyboard', '⚡': 'zap', '🔑': 'key', '📸': 'camera', '📹': 'video',
};

/** The ui glyph for an emoji (with or without the variation selector), if any. */
export function iconForEmoji(emoji: string | null | undefined): IconName | null {
  if (!emoji) return null;
  return ICON_FOR_EMOJI[emoji] ?? ICON_FOR_EMOJI[emoji.replace(/\uFE0F/g, '')] ?? null;
}

function renderEl([kind, data, width]: GlyphEl, i: number) {
  const accent = kind.startsWith('a');
  const fill = kind.endsWith('f');
  const cls = accent ? 'mdx-a' : undefined;
  const paint = fill ? { fill: 'currentColor', stroke: 'none' } : width ? { strokeWidth: width } : {};
  if (kind === 'c' || kind === 'ac' || kind === 'cf') {
    const [cx, cy, r] = data.split(' ').map(Number);
    return <circle key={i} className={cls} cx={cx} cy={cy} r={r} {...paint} />;
  }
  return <path key={i} className={cls} d={data} {...paint} />;
}

type GlyphProps = {
  className?: string;
  /** Accessible name; omitted → decorative (aria-hidden). */
  label?: string;
  style?: CSSProperties;
};

export function Glyph<S extends GlyphSet>({ set, name, className, label, style }: GlyphProps & { set: S; name: keyof (typeof GLYPHS)[S] & string }) {
  const els = (GLYPHS[set] as Record<string, readonly GlyphEl[]>)[name];
  if (!els) return null;
  return (
    <svg
      className={`ui-icon mdx-icon${className ? ` ${className}` : ''}`}
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
      {els.map(renderEl)}
    </svg>
  );
}

/** True when `name` is a glyph of `set` (for ids coming from data). */
export function hasGlyph(set: GlyphSet, name: string | null | undefined): boolean {
  return !!name && name in GLYPHS[set];
}

export default function Icon({ name, className, label }: { name: IconName; className?: string; label?: string }) {
  return <Glyph set="ui" name={name} className={className} label={label} />;
}
