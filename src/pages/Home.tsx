import Icon from '../components/Icon';
import { useState, type CSSProperties } from 'react';
import { Link } from 'react-router-dom';
import SearchBar from '../components/SearchBar';
import MartialArtCard from '../components/MartialArtCard';
import TechniqueRow from '../components/TechniqueRow';
import EmptyState from '../components/EmptyState';
import AiAskModal from '../components/AiAskModal';
import { IndexNo, JewelRule, MatMark, Plate } from '../components/brand/BrandMarks';
import { IMAGERY } from '../components/brand/imagery';
import { Reveal, CountUp } from '../components/brand/Motion';
import { getUnifiedMartialArtSummaries, getUnifiedTechniqueCount, resolveTechniquesByIds } from '../lib/userTechniques/service';
import { useAddTeqLibraryVersion } from '../lib/addTeq/useAddTeqLibrary';
import { useFavorites, useRecentlyViewedSynced } from '../lib/userData';
import { useTodayTraining } from '../lib/todayTraining/useTodayTraining';
import { useAllSkillProgress } from '../lib/skillProgress/useSkillProgress';
import { summarizeCoachStats } from '../lib/skillProgress/weaknessEngine';
import { useMyActiveProgress } from '../lib/curriculum/useCurriculum';
import { useReviewSession } from '../lib/reviewSystem/useReviewSession';
import { REVIEW_TIER_ICON } from '../lib/reviewSystem/types';
import { useProfileStats } from '../lib/profileStats/useProfileStats';
import { useMyStyle } from '../lib/myStyle/useMyStyle';
import { useNutritionMeals } from '../lib/nutrition/useNutritionMeals';
import { useNutritionProfile } from '../lib/nutrition/useNutritionProfile';
import { formatKcal, sumMealsTotals } from '../lib/nutrition/calc';
import { todayDateKey } from '../lib/dateUtil';

/**
 * Home — the cover of the Index. A full-bleed cinematic hero, then the reader's own day as an editorial
 * spread (training · review · nutrition), the coach plate, the disciplines catalogue, the platform
 * (gyms · market · community) and the reader's shelf (recent · favourites). All data is the same as before.
 */
export default function Home() {
  const [aiOpen, setAiOpen] = useState(false);
  useAddTeqLibraryVersion();
  const { favorites } = useFavorites();
  const recent = useRecentlyViewedSynced();
  const { plan } = useTodayTraining();
  const skillEntries = useAllSkillProgress();
  const coachStats = summarizeCoachStats(skillEntries);
  const activeProgress = useMyActiveProgress();
  const todayTechniques = resolveTechniquesByIds(plan.techniqueIds).slice(0, 4);
  const { plan: reviewPlan } = useReviewSession();
  const reviewTodayCount = reviewPlan.actionable.filter((c) => c.tier === 'today').length;
  const reviewSoonCount = reviewPlan.actionable.filter((c) => c.tier === 'soon').length;
  const { stats: profileStats, level } = useProfileStats();
  const { summary: myStyleSummary, analysis: myStyleAnalysis } = useMyStyle();
  const hasAnyActivity = profileStats.learnedCount > 0 || profileStats.sparringSessionCount > 0;
  const nutritionMeals = useNutritionMeals();
  const nutritionProfile = useNutritionProfile();
  const todayMeals = nutritionMeals.filter((m) => m.date === todayDateKey());
  const todayNutritionTotals = sumMealsTotals(todayMeals);
  const favoriteTechniques = resolveTechniquesByIds(favorites);
  const recentTechniques = resolveTechniquesByIds(recent);
  const martialArtSummaries = getUnifiedMartialArtSummaries();
  const totalTechniqueCount = getUnifiedTechniqueCount();
  const today = new Date();

  return (
    <div className="mx-home" data-testid="home">
      {/* ================= COVER ================= */}
      <section className="mx-cover" aria-label="MARTIALDEX">
        <div className="mx-cover__img mx-cover__img--ko" style={{ backgroundImage: `url(${IMAGERY.koHero})` }} aria-hidden="true" />
        <div className="mx-cover__veil mx-cover__veil--ko" aria-hidden="true" />
        <div className="mx-cover__inner">
          <div className="mx-cover__meta">
            <span className="mx-eyebrow">THE MARTIAL ARTS INDEX</span>
            <span className="mx-eyebrow mx-eyebrow--dim">
              ED. {today.getFullYear()} · {String(today.getMonth() + 1).padStart(2, '0')}
            </span>
          </div>
          <h1 className="mx-cover__title">
            <span>MARTIAL</span>
            <span className="mx-cover__title-dex">DEX</span>
          </h1>
          <p className="mx-cover__lede">
            {martialArtSummaries.length}개 무술 · {totalTechniqueCount}개 기술을 하나의 색인으로. 배우고, 측정하고, 코칭받고, 함께 훈련하는 격투 스포츠 플랫폼.
          </p>
          <div className="mx-cover__search">
            <SearchBar variant="hero" />
          </div>
          <div className="mx-cover__cta">
            <Link to="/learning" className="btn btn-primary btn-lg">
              학습 시작 <Icon name="chevron-right" />
            </Link>
            <button type="button" className="btn btn-secondary btn-lg" onClick={() => setAiOpen(true)}>
              <Icon name="spark" /> AI에게 기술 질문
            </button>
          </div>
          <dl className="mx-cover__stats">
            <div>
              <dt>DISCIPLINES</dt>
              <dd><CountUp to={martialArtSummaries.length} /></dd>
            </div>
            <div>
              <dt>TECHNIQUES</dt>
              <dd><CountUp to={totalTechniqueCount} /></dd>
            </div>
            <div>
              <dt>FAVOURITES</dt>
              <dd><CountUp to={favorites.length} /></dd>
            </div>
          </dl>
        </div>
        <div className="mx-cover__caption" aria-hidden="true">
          <MatMark size={12} /> PLATE 01 — IN THE CAGE.
        </div>
      </section>

      <div className="container">
        {/* ================= TODAY ================= */}
        <Reveal as="section" className="mx-spread" aria-label="오늘">
          <header className="mx-spread__head">
            <IndexNo n={1} />
            <h2 className="mx-display">TODAY</h2>
            <span className="mx-spread__date">{today.toLocaleDateString('ko-KR', { month: 'long', day: 'numeric', weekday: 'long' })}</span>
          </header>
          <div className="mx-spread__grid">
            <article className="mx-feature">
              <div className="mx-feature__kicker"><Icon name="flame" /> 오늘의 훈련</div>
              {plan.mode === 'no_data' ? (
                <>
                  <h3 className="mx-feature__title">아직 학습 기록이 없습니다</h3>
                  <p className="mx-feature__body">커리큘럼을 만들면 오늘 할 기술과 예상 시간이 여기에 펼쳐집니다.</p>
                  <Link to="/learning" className="btn btn-primary">커리큘럼 만들기</Link>
                </>
              ) : (
                <>
                  <h3 className="mx-feature__title">
                    {plan.curriculumTitle ?? '오늘의 추천 학습'}
                    {plan.day !== null && <span className="mx-feature__day">DAY {plan.day}</span>}
                  </h3>
                  {plan.dayTitle && <p className="mx-feature__body">{plan.dayTitle}</p>}
                  {todayTechniques.length > 0 && (
                    <ol className="mx-numbered">
                      {todayTechniques.map((t, i) => (
                        <li key={t.id}>
                          <IndexNo n={i + 1} />
                          <Link to={`/arts/${t.martialArt}/techniques/${t.id}`}>{t.name}</Link>
                        </li>
                      ))}
                    </ol>
                  )}
                  <div className="mx-figures">
                    <div><strong>{plan.estimatedMinutes}</strong><span>MIN · 예상 시간</span></div>
                    {plan.weaknessNote && (
                      <div><strong>{plan.weaknessNote.score}</strong><span>최근 약점 · {plan.weaknessNote.techniqueName}</span></div>
                    )}
                    {activeProgress[0] && (
                      <div><strong>{Math.round(activeProgress[0].progress.progress)}%</strong><span>커리큘럼 진행</span></div>
                    )}
                  </div>
                  {activeProgress[0] && (
                    <div className="progress-track mx-feature__progress">
                      <div className="progress-fill" style={{ width: `${activeProgress[0].progress.progress}%` }} />
                    </div>
                  )}
                  <Link to="/today-training" className="btn btn-primary">훈련 시작</Link>
                </>
              )}
            </article>

            <div className="mx-sidebar-list">
              <div className="mx-side-item">
                <div className="mx-side-item__head"><Icon name="repeat" /> 오늘의 복습</div>
                {reviewPlan.actionable.length > 0 ? (
                  <>
                    <div className="mx-side-item__value">{reviewPlan.estimatedMinutes}<small>MIN</small></div>
                    <div className="chip-row">
                      {reviewTodayCount > 0 && <span className="chip active">{REVIEW_TIER_ICON.today} 오늘 {reviewTodayCount}개</span>}
                      {reviewSoonCount > 0 && <span className="chip">{REVIEW_TIER_ICON.soon} 곧 {reviewSoonCount}개</span>}
                    </div>
                    <Link to="/review/ai" className="mx-link-arrow">복습 시작 <Icon name="chevron-right" /></Link>
                  </>
                ) : (
                  <p className="mx-side-item__note">오늘 복습할 기술이 없습니다.</p>
                )}
              </div>
              <div className="mx-side-item">
                <div className="mx-side-item__head"><Icon name="bowl" /> 오늘의 영양</div>
                {todayMeals.length === 0 ? (
                  <>
                    <p className="mx-side-item__note">아직 오늘 등록된 식사가 없습니다.</p>
                    <Link to="/nutrition" className="mx-link-arrow">식사 기록하기 <Icon name="chevron-right" /></Link>
                  </>
                ) : (
                  <>
                    <div className="mx-side-item__value">{formatKcal(todayNutritionTotals.calories)}</div>
                    <p className="mx-side-item__note">
                      섭취{nutritionProfile.calorieGoal != null ? ` / 목표 ${formatKcal(nutritionProfile.calorieGoal)}` : ''} · 단백질 {Math.round(todayNutritionTotals.proteinG)}g
                      {nutritionProfile.proteinGoalG != null ? ` / ${nutritionProfile.proteinGoalG}g` : ''}
                    </p>
                    <Link to="/nutrition" className="mx-link-arrow">영양 화면 보기 <Icon name="chevron-right" /></Link>
                  </>
                )}
              </div>
              {hasAnyActivity && (
                <div className="mx-side-item">
                  <div className="mx-side-item__head"><Icon name="user" /> 나의 성장</div>
                  <div className="mx-side-item__value mx-ceremonial">LEVEL {level.level}</div>
                  <p className="mx-side-item__note">
                    {level.label}
                    {profileStats.currentStreak > 0 && ` · ${profileStats.currentStreak}일 연속 학습`}
                    {myStyleSummary.hasEnoughData && ` · 스타일: ${myStyleAnalysis ? myStyleAnalysis.styleName : '분석 가능'}`}
                  </p>
                  <Link to="/profile" className="mx-link-arrow">프로필 보기 <Icon name="chevron-right" /></Link>
                </div>
              )}
            </div>
          </div>
        </Reveal>

        {/* ================= COACH ================= */}
        <Reveal as="section" className="mx-coach-plate" aria-label="AI 개인 코치">
          <Plate className="mx-coach-plate__img mx-coach-plate__img--ko" label="PLATE 02 — AI COACH">
            <img
              src={IMAGERY.koCoach}
              alt=""
              loading="lazy"
              decoding="async"
              onError={(e) => {
                // a failed load falls back to the previous plate instead of a broken-image box
                if (e.currentTarget.src !== IMAGERY.coachStudy) e.currentTarget.src = IMAGERY.coachStudy;
              }}
            />
          </Plate>
          <div className="mx-coach-plate__text">
            <IndexNo n={2} />
            <h2 className="mx-display">AI COACH</h2>
            <p className="mx-lede">당신의 기록을 읽는 코치. 배운 기술, 자세 측정, 수업 기록을 바탕으로 오늘의 코칭을 설계합니다.</p>
            <div className="mx-figures mx-figures--4">
              <div><strong><CountUp to={coachStats.learnedCount} /></strong><span>학습 기술</span></div>
              <div><strong><CountUp to={coachStats.proficientCount} /></strong><span>숙련</span></div>
              <div><strong><CountUp to={coachStats.averageCount} /></strong><span>보통</span></div>
              <div><strong><CountUp to={coachStats.needsImprovementCount} /></strong><span>개선 필요</span></div>
            </div>
            <div className="mx-row">
              <Link to="/coach" className="btn btn-primary">오늘의 코칭 받기</Link>
              <Link to="/coach/chat" className="btn btn-secondary">코치와 대화</Link>
            </div>
          </div>
        </Reveal>

        {/* ================= DISCIPLINES ================= */}
        <Reveal as="section" aria-label="무술">
          <header className="mx-spread__head">
            <IndexNo n={3} />
            <h2 className="mx-display">DISCIPLINES</h2>
            <Link to="/arts" className="mx-link-arrow">전체 무술 <Icon name="chevron-right" /></Link>
          </header>
          <div className="mx-art-rail">
            {martialArtSummaries.map((art, i) => (
              <MartialArtCard key={art.id} art={art} index={i} />
            ))}
          </div>
        </Reveal>

        {/* ================= PLATFORM ================= */}
        <Reveal as="section" aria-label="플랫폼">
          <header className="mx-spread__head">
            <IndexNo n={4} />
            <h2 className="mx-display">THE PLATFORM</h2>
          </header>
          <div className="mx-triptych">
            <Link to="/gyms" className="mx-tile mx-tile--ko" style={{ '--mx-tile-img': `url(${IMAGERY.koGym})` } as CSSProperties}>
              <span className="mx-tile__no">04.1</span>
              <span className="mx-tile__title">GYMS</span>
              <span className="mx-tile__ko">체육관 찾기 · 가격 비교 · 제휴 할인</span>
            </Link>
            <Link to="/gear" className="mx-tile mx-tile--ko" style={{ '--mx-tile-img': `url(${IMAGERY.koMarket})` } as CSSProperties}>
              <span className="mx-tile__no">04.2</span>
              {/* the image already carries the MARKET wordmark — the title stays for screen readers only */}
              <span className="mx-tile__title sr-only">MARKET</span>
              <span className="mx-tile__ko">격투기 장비 중고거래 · 택배 결제</span>
            </Link>
            <Link to="/community" className="mx-tile mx-tile--ko" style={{ '--mx-tile-img': `url(${IMAGERY.koCommunity})` } as CSSProperties}>
              <span className="mx-tile__no">04.3</span>
              {/* the image already carries the COMMUNITY wordmark — the title stays for screen readers only */}
              <span className="mx-tile__title sr-only">COMMUNITY</span>
              <span className="mx-tile__ko">숏폼 · 게시물 · 기술 평가 · 클랜</span>
            </Link>
          </div>
        </Reveal>

        <JewelRule />

        {/* ================= SHELF ================= */}
        <section className="mx-shelf" aria-label="내 기술">
          <div>
            <header className="mx-shelf__head">
              <IndexNo n={5} />
              <h2>최근 본 기술</h2>
            </header>
            {recentTechniques.length === 0 ? (
              <EmptyState icon="🕘" text="아직 살펴본 기술이 없습니다. 기술을 클릭해서 상세 페이지를 확인해보세요." />
            ) : (
              <div className="stack">
                {recentTechniques.map((t) => <TechniqueRow key={t.id} technique={t} />)}
              </div>
            )}
          </div>
          <div>
            <header className="mx-shelf__head">
              <IndexNo n={6} />
              <h2>즐겨찾기</h2>
              <Link to="/favorites" className="mx-link-arrow">전체 보기 <Icon name="chevron-right" /></Link>
            </header>
            {favoriteTechniques.length === 0 ? (
              <EmptyState icon="★" text="아직 즐겨찾기한 기술이 없습니다. 기술 상세 페이지에서 별표를 눌러 추가해보세요." />
            ) : (
              <div className="stack">
                {favoriteTechniques.map((t) => <TechniqueRow key={t.id} technique={t} />)}
              </div>
            )}
          </div>
        </section>
      </div>
      {aiOpen && <AiAskModal onClose={() => setAiOpen(false)} />}
    </div>
  );
}
