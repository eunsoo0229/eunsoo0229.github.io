import { Link } from 'react-router-dom';
import { IndexNo } from '../components/brand/BrandMarks';

export default function NotFound() {
  return (
    <div className="page">
      <div className="container mx-notfound" data-testid="not-found">
        <span className="mx-eyebrow">ENTRY NOT IN THE INDEX</span>
        <div className="mx-notfound__code" aria-hidden="true">4<b>0</b>4</div>
        <p className="mx-lede">페이지를 찾을 수 없습니다. 주소가 바뀌었거나 삭제된 항목일 수 있습니다.</p>
        <div className="mx-row">
          <Link to="/" className="btn btn-primary">홈으로 돌아가기</Link>
          <Link to="/techniques" className="btn btn-secondary"><IndexNo n="01" /> 기술 색인 열기</Link>
        </div>
      </div>
    </div>
  );
}
