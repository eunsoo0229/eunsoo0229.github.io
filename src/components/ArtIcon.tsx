import { Glyph, hasGlyph } from './Icon';

// Martial-art marks from the Forge set, keyed by the same ids data/processed/*.json and
// martialArtSummaries use (boxing glove, kickboxing glove + roundhouse arc, muay-thai knee/elbow,
// taekwondo high kick, karate fist from a gi sleeve, wrestling singlet, judo lapel grip, sambo
// winged jacket, bjj belt knot, mma octagon cage). An art without a mark (a retired or unknown id)
// falls through to its emoji, as before.
export function hasArtIcon(artId: string): boolean {
  return hasGlyph('arts', artId);
}

export default function ArtIcon({
  art,
  fallback,
  size = 28,
  label,
}: {
  art: string;
  /** Emoji shown when this art has no mark. */
  fallback?: string;
  size?: number;
  /** Accessible name; omit when the art name is printed next to the mark. */
  label?: string;
}) {
  if (!hasArtIcon(art)) return <span aria-hidden="true">{fallback ?? ''}</span>;
  return <Glyph set="arts" name={art as never} className="art-icon" label={label} style={{ width: size, height: size }} />;
}
