import { Link } from 'react-router-dom';
import type { MartialArtSummary } from '../types';
import ArtIcon, { hasArtIcon } from './ArtIcon';
import { artFocusX, artImage } from './brand/imagery';
import { IndexNo } from './brand/BrandMarks';

/** Discipline plate — a catalogue entry: index numeral, bout photo, condensed name, counts. (class names kept for existing QA) */
export default function MartialArtCard({ art, index }: { art: MartialArtSummary; index?: number }) {
  const mark = hasArtIcon(art.id);
  return (
    <Link to={`/arts/${art.id}`} className="art-card mx-art-plate">
      <span
        className="mx-art-plate__img"
        aria-hidden="true"
        style={{ backgroundImage: `url(${artImage(art.id)})`, ['--mx-art-x' as string]: `${artFocusX(art.id)}%` }}
      />
      <span className="mx-art-plate__shade" aria-hidden="true" />
      <span className="mx-art-plate__top">
        {index !== undefined ? <IndexNo n={index + 1} /> : <span />}
        <span className={`art-card__initial${mark ? ' art-card__initial--mark' : ''}`} aria-hidden="true">
          {mark ? <ArtIcon art={art.id} size={22} /> : art.nameKo.slice(0, 1)}
        </span>
      </span>
      <span className="mx-art-plate__body">
        <span className="art-card__name-en">{art.nameEn ?? art.id}</span>
        <span className="art-card__name-ko">{art.nameKo}</span>
        <span className="art-card__count">
          <strong>{art.techniqueCount}</strong> TECHNIQUES · {art.categories.length} CATEGORIES
        </span>
      </span>
    </Link>
  );
}
