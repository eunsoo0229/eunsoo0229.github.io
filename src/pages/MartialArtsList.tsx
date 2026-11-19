import { Link } from 'react-router-dom';
import MartialArtCard from '../components/MartialArtCard';
import { getUnifiedMartialArtSummaries, getUnifiedTechniqueCount } from '../lib/userTechniques/service';
import { useAddTeqLibraryVersion } from '../lib/addTeq/useAddTeqLibrary';
import BackButton from '../components/BackButton';

/** Disciplines — the catalogue cover for every art, as image plates. */
export default function MartialArtsList() {
  useAddTeqLibraryVersion();
  const martialArtSummaries = getUnifiedMartialArtSummaries();
  const totalTechniqueCount = getUnifiedTechniqueCount();
  return (
    <div className="page">
      <div className="container">
        <BackButton />
        <div className="breadcrumb">
          <Link to="/">홈</Link>
          <span>/</span>
          <span>무술 목록</span>
        </div>
        <header className="mx-page-masthead">
          <div>
            <span className="mx-eyebrow">CHAPTER 01 · DISCIPLINES</span>
            <h1>THE DISCIPLINES</h1>
            <p>전체 무술 {martialArtSummaries.length}개. 무술을 고르면 포지션·카테고리별로 정리된 기술 색인이 열립니다.</p>
          </div>
          <div className="mx-page-masthead__figure">
            <strong>{totalTechniqueCount}</strong>
            <span>TECHNIQUES INDEXED</span>
          </div>
        </header>
        <div className="mx-art-rail">
          {martialArtSummaries.map((art, i) => (
            <MartialArtCard key={art.id} art={art} index={i} />
          ))}
        </div>
      </div>
    </div>
  );
}
