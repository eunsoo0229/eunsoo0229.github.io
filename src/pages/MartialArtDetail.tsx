import { Link, Navigate, useParams } from 'react-router-dom';
import { getUnifiedMartialArt, getUnifiedTechniquesByMartialArt } from '../lib/userTechniques/service';
import { useAddTeqLibraryVersion } from '../lib/addTeq/useAddTeqLibrary';
import TechniqueRow from '../components/TechniqueRow';
import { techniqueCategoryInArt } from '../lib/techniqueCanonical';
import DifficultyBadge from '../components/DifficultyBadge';
import BackButton from '../components/BackButton';
import TaxonomyTree from '../components/TaxonomyTree';
import { getArtTaxonomy } from '../lib/techniqueTaxonomy';
import PositionTree from '../components/PositionTree';
import { getPositionTree } from '../lib/positionTaxonomy';

export default function MartialArtDetail() {
  const { martialArtId = '' } = useParams();
  useAddTeqLibraryVersion();
  const art = getUnifiedMartialArt(martialArtId);
  const techniques = getUnifiedTechniquesByMartialArt(martialArtId);

  if (!art) return <Navigate to="/arts" replace />;

  const categoryCounts = new Map<string, number>();
  // One count per canonical technique, under the category THIS art files it in.
  for (const t of techniques) {
    const c = techniqueCategoryInArt(t, martialArtId);
    categoryCounts.set(c, (categoryCounts.get(c) ?? 0) + 1);
  }
  const categories = Array.from(categoryCounts.entries()).sort((a, b) => b[1] - a[1]);
  // 계층형 분류 — built from the same techniques and the same per-art categories as above
  const taxonomy = getArtTaxonomy(martialArtId, techniques);
  // BJJ / MMA: position first (position → purpose → techniques); the hierarchy above stays available below it
  const positionTree = getPositionTree(martialArtId, techniques);

  const preview = techniques.slice(0, 8);

  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="breadcrumb">
          <Link to="/">홈</Link>
          <span>/</span>
          <Link to="/arts">무술 목록</Link>
          <span>/</span>
          <span>{art.nameKo}</span>
        </div>

        <div className="detail-hero">
          <div>
            <h1>{art.nameKo}</h1>
            <div className="detail-hero__korean">{art.nameEn ?? art.id}</div>
            <div className="chip-row">
              <span className="chip active">{art.techniqueCount}개 기술</span>
              <span className="chip active">
                {positionTree ? `${positionTree.stats.positions}개 포지션 · ` : ''}
                {taxonomy.roots.length}개 분류 · 기존 {categories.length}개 카테고리
              </span>
              {Object.entries(art.difficultyCounts)
                .filter(([k]) => k !== 'unknown')
                .map(([level, count]) => (
                  <span className="chip" key={level}>
                    <DifficultyBadge difficulty={level as any} /> &nbsp;{count}
                  </span>
                ))}
            </div>
          </div>
          <div className="detail-actions">
            <Link to={`/arts/${art.id}/techniques`} className="btn btn-primary">
              전체 기술 보기 →
            </Link>
          </div>
        </div>

        <section>
          <div className="section-title">
            <h2>카테고리</h2>
          </div>
          {positionTree ? (
            <>
              <PositionTree key={martialArtId} tree={positionTree} techniques={techniques} />
              <details className="taxonomy-legacy" data-testid="taxonomy-hierarchy-legacy">
                <summary>기존 계층 분류 보기 ({taxonomy.roots.length})</summary>
                <TaxonomyTree tax={taxonomy} />
              </details>
            </>
          ) : (
            <TaxonomyTree tax={taxonomy} />
          )}
          <details className="taxonomy-legacy">
            <summary>기존 카테고리 목록 ({categories.length})</summary>
            <div className="chip-row">
              {categories.map(([category, count]) => (
                <Link key={category} to={`/arts/${art.id}/techniques?category=${encodeURIComponent(category)}`} className="chip">
                  {category} ({count})
                </Link>
              ))}
            </div>
          </details>
        </section>

        <section>
          <div className="section-title">
            <h2>기술 미리보기</h2>
            <Link to={`/arts/${art.id}/techniques`} className="see-all">
              전체보기 →
            </Link>
          </div>
          <div className="stack gap-2">
            {preview.map((t) => (
              <TechniqueRow key={t.id} technique={t} contextArt={martialArtId} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
