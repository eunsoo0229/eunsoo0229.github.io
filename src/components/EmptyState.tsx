import Icon, { iconForEmoji } from './Icon';

// Forge empty/error illustrations (assets/empty/*.svg: currentColor line art + one red accent),
// inlined so they follow the theme. Callers still pass the emoji they always passed; it picks the
// illustration below, or a glyph when the meaning has no illustration, or the character itself.
const ART = import.meta.glob('../assets/empty/*.svg', { eager: true, query: '?raw', import: 'default' }) as Record<string, string>;
const ART_SVG: Record<string, string> = Object.fromEntries(Object.entries(ART).map(([p, svg]) => [p.split('/').pop()!.replace('.svg', ''), svg]));

export type EmptyArt =
  | 'no-results' | 'no-posts' | 'no-techniques' | 'no-records' | 'no-notifications' | 'no-messages'
  | 'no-curriculum' | 'no-gym' | 'no-clan' | 'search-failed' | 'network-error' | 'load-failed'
  | 'no-review' | 'no-stats' | 'login-required' | 'loading' | 'no-favorites';

const ART_FOR_EMOJI: Record<string, EmptyArt> = {
  '🥋': 'no-techniques', '🥊': 'no-techniques', '🤼': 'no-techniques', '🧍': 'no-techniques',
  '⏳': 'loading',
  '📭': 'no-posts', '🌐': 'network-error', '📱': 'no-posts',
  '🏛': 'no-gym',
  '🔒': 'login-required',
  '🔁': 'no-review', '🩹': 'no-review', '🎓': 'no-review',
  '🔍': 'no-results', '🔎': 'no-results',
  '📊': 'no-stats', '📈': 'no-stats', '💡': 'no-stats', '✅': 'no-stats',
  '📘': 'no-curriculum', '📚': 'no-curriculum', '✏️': 'no-curriculum', '🏗': 'no-curriculum',
  '🕘': 'no-records', '🕓': 'no-records', '🕑': 'no-records', '📜': 'no-records', '📒': 'no-records', '📋': 'no-records', '📅': 'no-records',
  '★': 'no-favorites', '☆': 'no-favorites',
  '⚠️': 'load-failed', '⚠': 'load-failed',
};

/** The illustration alone (for ErrorState / custom layouts). */
export function EmptyArtSvg({ art }: { art: EmptyArt }) {
  const svg = ART_SVG[art];
  if (!svg) return null;
  // our own static asset files (assets/empty), not user content
  return <div className="empty-state__art" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />;
}

export default function EmptyState({ icon = '🥋', text, art }: { icon?: string; text: string; art?: EmptyArt }) {
  const key = art ?? ART_FOR_EMOJI[icon] ?? ART_FOR_EMOJI[icon.replace(/️/g, '')];
  const svg = key ? ART_SVG[key] : undefined;
  const glyph = svg ? null : iconForEmoji(icon);
  return (
    <div className="empty-state" data-art={key}>
      {svg && key ? (
        <EmptyArtSvg art={key} />
      ) : (
        <div className="empty-state__icon">{glyph ? <Icon name={glyph} /> : icon}</div>
      )}
      <p>{text}</p>
    </div>
  );
}
