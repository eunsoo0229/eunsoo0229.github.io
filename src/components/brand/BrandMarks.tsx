// MARTIALDEX brand marks — original to MARTIALDEX (not derived from any other brand's logo):
// • The MAT: a square mat turned 45°, cut by a single index tick — the training floor seen from above,
//   and the "◆" of a catalogue entry. Used as logomark, bullet, divider jewel.
// • The WORDMARK: MARTIAL / DEX stacked in condensed display caps; DEX carries the gold.
// • INDEX numerals and REGISTRATION corners frame imagery like plates in a printed catalogue.
import type { CSSProperties, ReactNode } from 'react';

export function MatMark({ size = 22, className = '', title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg className={`mx-mat ${className}`} width={size} height={size} viewBox="0 0 24 24" role={title ? 'img' : 'presentation'} aria-label={title} aria-hidden={title ? undefined : true}>
      <path d="M12 1.5 22.5 12 12 22.5 1.5 12Z" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path d="M12 6.2 17.8 12 12 17.8 6.2 12Z" fill="none" stroke="currentColor" strokeWidth="1" opacity=".55" />
      <path d="M12 1.5V8.4" stroke="var(--mx-accent)" strokeWidth="1.6" />
    </svg>
  );
}

export function Wordmark({ stacked = false, className = '' }: { stacked?: boolean; className?: string }) {
  return (
    <span className={`mx-wordmark${stacked ? ' mx-wordmark--stacked' : ''} ${className}`} aria-label="MARTIALDEX" role="img">
      <MatMark size={stacked ? 30 : 20} />
      <span className="mx-wordmark__type" aria-hidden="true">
        <span>MARTIAL</span>
        <span className="mx-wordmark__dex">DEX</span>
      </span>
    </span>
  );
}

/** Catalogue index numeral: 01, 02 … */
export function IndexNo({ n, className = '' }: { n: number | string; className?: string }) {
  const v = typeof n === 'number' ? String(n).padStart(2, '0') : n;
  return <span className={`mx-index ${className}`}>{v}</span>;
}

/** Registration corners around a plate (image or block) */
export function Plate({ children, className = '', style, label }: { children: ReactNode; className?: string; style?: CSSProperties; label?: string }) {
  return (
    <figure className={`mx-plate ${className}`} style={style}>
      <span className="mx-plate__corner mx-plate__corner--tl" aria-hidden="true" />
      <span className="mx-plate__corner mx-plate__corner--tr" aria-hidden="true" />
      <span className="mx-plate__corner mx-plate__corner--bl" aria-hidden="true" />
      <span className="mx-plate__corner mx-plate__corner--br" aria-hidden="true" />
      {children}
      {label && <figcaption className="mx-plate__label">{label}</figcaption>}
    </figure>
  );
}

/** Hairline rule with a centred mat jewel */
export function JewelRule({ className = '' }: { className?: string }) {
  return (
    <div className={`mx-jewel-rule ${className}`} aria-hidden="true">
      <span />
      <MatMark size={14} />
      <span />
    </div>
  );
}
