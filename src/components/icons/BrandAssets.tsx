import { Glyph, hasGlyph, iconForEmoji } from '../Icon';

// The mapping layer between stored values and the Forge assets. Data keeps whatever it already
// stores — AiFeature.icon / AchievementDef.icon emoji, Curriculum.coverIcon / MarketplaceListing
// .coverIcon emoji in Supabase, training-source keys — and is resolved here at render time, so no
// row has to be migrated and anything without an asset still renders its original character.

const BADGES = import.meta.glob('../../assets/badges/*-128.png', { eager: true, import: 'default' }) as Record<string, string>;
const BADGES_LARGE = import.meta.glob('../../assets/badges/*[!8].png', { import: 'default' }) as Record<string, () => Promise<string>>;
const RANKS = import.meta.glob('../../assets/ranks/*-128.png', { eager: true, import: 'default' }) as Record<string, string>;

function byId(files: Record<string, string>, suffix: string): Record<string, string> {
  return Object.fromEntries(Object.entries(files).map(([p, url]) => [p.split('/').pop()!.replace(suffix, ''), url]));
}
const BADGE_URL = byId(BADGES, '-128.png');
const RANK_URL = byId(RANKS, '-128.png');

/** AI feature card icon (aiFeatureCatalog id); the catalog's emoji when the id has no glyph. */
export function FeatureIcon({ id, fallback, className }: { id: string; fallback?: string; className?: string }) {
  if (hasGlyph('ai', id)) return <Glyph set="ai" name={id as never} className={`feature-icon${className ? ` ${className}` : ''}`} />;
  return <span aria-hidden="true">{fallback ?? ''}</span>;
}

/** Achievement badge (definitions.ts id). Locked = grayscale, handled in CSS. */
export function AchievementBadge({ id, fallback, locked, size = 48 }: { id: string; fallback?: string; locked?: boolean; size?: number }) {
  const url = BADGE_URL[id];
  if (!url) return <span aria-hidden="true">{fallback ?? ''}</span>;
  return <img className={`achievement-badge${locked ? ' achievement-badge--locked' : ''}`} src={url} alt="" width={size} height={size} loading="lazy" decoding="async" />;
}

/** Full-size (512) badge, loaded on demand for an achievement detail / share view. */
export async function loadAchievementBadgeLarge(id: string): Promise<string | null> {
  const loader = Object.entries(BADGES_LARGE).find(([p]) => p.endsWith(`/${id}.png`))?.[1];
  return loader ? loader() : null;
}

/** Rank emblem for level 1–7 (rankEngine titles, in order). */
export function RankEmblem({ level, size = 22 }: { level: number; size?: number }) {
  const n = Math.min(7, Math.max(1, Math.round(level)));
  const url = RANK_URL[`rank-${n}`];
  if (!url) return null;
  return <img className="rank-emblem" src={url} alt="" width={size} height={size} decoding="async" />;
}

/** Training-record source (TrainingSource key); `fitness` = 헬스 class (gym_class + gym art). */
export function SourceIcon({ source, fitness }: { source: string; fitness?: boolean }) {
  const name = fitness ? 'gym-fitness' : source.replace(/_/g, '-');
  if (!hasGlyph('sources', name)) return <Glyph set="ui" name="gi" />;
  return <Glyph set="sources" name={name as never} />;
}

/**
 * A stored cover / preset emoji (coverIcon, LOCATION_ICON …) as a glyph. Unmapped values keep
 * rendering the stored character, so user data written by older builds never disappears.
 */
export function StoredIcon({ value, className }: { value: string | null | undefined; className?: string }) {
  const name = iconForEmoji(value);
  if (name) return <Glyph set="ui" name={name} className={className} />;
  return <span aria-hidden="true">{value ?? ''}</span>;
}
