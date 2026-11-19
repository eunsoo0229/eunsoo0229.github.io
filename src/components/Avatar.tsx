import { useState } from 'react';
import cage from '../assets/forge/avatar-1.png';
import mat from '../assets/forge/avatar-2.png';
import ropes from '../assets/forge/avatar-3.png';
import chevrons from '../assets/forge/avatar-4.png';

// Four Forge defaults (faceless athlete bust on brushed metal: cage / mat / ropes / chevrons), handed out by a stable hash of the account id so
// one person keeps the same picture everywhere (feed, comments, shorts) and
// a feed of strangers doesn't come out all one image.
const DEFAULTS = [cage, mat, ropes, chevrons];

function pickDefault(seed: string): string {
  let h = 0;
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) | 0;
  return DEFAULTS[Math.abs(h) % DEFAULTS.length];
}

/**
 * The nickname initial stays rendered underneath the picture, so a profile
 * image that fails to load (or hasn't arrived yet) falls back to exactly
 * what this spot showed before instead of an empty circle.
 */
export default function Avatar({
  seed,
  nickname,
  src,
  className,
}: {
  seed: string;
  nickname: string;
  /** Uploaded profile picture, when the account has one. */
  src?: string | null;
  className?: string;
}) {
  const [broken, setBroken] = useState(false);
  const url = src ?? pickDefault(seed || nickname || '?');
  const initial = (nickname.trim()[0] ?? '?').toUpperCase();
  return (
    <span className={`avatar${className ? ` ${className}` : ''}`} aria-hidden="true">
      {initial}
      {!broken && (
        <img className="avatar__img" src={url} alt="" loading="lazy" decoding="async" onError={() => setBroken(true)} />
      )}
    </span>
  );
}
