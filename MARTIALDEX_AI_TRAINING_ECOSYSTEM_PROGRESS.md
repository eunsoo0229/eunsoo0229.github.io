# MARTIALDEX AI 개인 맞춤 훈련 생태계 — 진행 기록

이 파일은 세션이 끊겨도 다음 세션이 이어서 작업할 수 있도록 남기는 기록이다.

- 작업 위치: 원본 `/Users/swcho/Documents/MARTIALDEX` (복제본 개발 금지 — 사양 §1-1)
- 시작 전 백업: `MARTIALDEX_backups/ecosystem-20261116-160445` (복구용 — 수정 금지)
- 담당 세션: martialdex-b3 (2026-11-16 시작)
- 다른 세션 작업 중인 파일 (건드리지 않음 — martialdex-6c, 공유·기술 평가 버튼):
  - `supabase/migrations/0060_share_attachments.sql` (이 작업의 마이그레이션은 0061부터)
  - `src/lib/social/types.ts`, `src/components/social/*`, `src/components/icons/PaperPlane.tsx`, `src/components/techniqueEvaluation/{EvaluationPreview,EvaluationStartSheet}.tsx`
  - `src/components/community/PostCard.tsx`, `src/pages/{Shorts,CurriculumDayList,MarketplaceCurriculumDetail,SharedComboDetail}.tsx`, `src/pages/gyms/GymListingDetail.tsx`, `src/pages/gear/GearDetail.tsx`
  - `src/styles/brand/components.css`
- 내비게이션: `Header.tsx`는 더 이상 쓰이지 않음. 새 화면은 `src/components/brand/AppShell.tsx` + `navConfig.ts` 에 등록.

## 단계
- [x] 0. 백업 · 진행 파일 · 다른 세션과 조율
- [x] 1. 기존 시스템 조사 (커리큘럼 · 학습 상태 · 평가 · 통계 · AI 근거 · 안전 정보)
- [x] 2. 기능 1 — 적응형 개인 커리큘럼
- [x] 3. 기능 2 — 성과 대시보드 + AI 성장 리포트
- [x] 4. 기능 3 — AI 코치 근거·출처 UI 보강
- [x] 5. 기능 4 — 기술 안전 가이드 + 훈련 전 체크리스트
- [x] 6. 통합 흐름 + AI 코치 연동
- [x] 7. 테스트 · 회귀 · 빌드
- [x] 8. 최종 보고서 `MARTIALDEX_AI_TRAINING_ECOSYSTEM_REPORT.md`

## 기록
- 2026-11-16 16:04 백업 생성, 다른 세션과 조율 완료.

## 조사 결과 (2026-11-16)
### 이미 있는 것 (재사용)
- 기술 상태: `skillProgress/computeAllSkillProgress` (MasteryStatus 5단계: not_started/learning/average/proficient/needs_improvement, 근거 = 자세 점수 > 수업 평가 > 연습 기록, 사용자 지정 우선), `personalCoach/loadLearnerModel` (LearningState 7단계), `learnedTechniques`.
- 다음 기술 추천: `personalAnswers.nextToLearn`, 선행 관계 `techniqueGraph.getTechniqueConnections().prerequisite`, 수업 가능 여부 `coachLesson/lessonReadiness`.
- 커리큘럼: `curriculum/*` (Day 기반, 진도만 증가), `aiCurriculum` (목표 → 여러 Day, 생성 후 고정), `aiCoachCurriculum` (수업 1회분), `trainingProgram` (주간 — 완료율에 따라 다음 주 조정하는 유일한 적응형), `todayTraining` (오늘 계획 → 훈련 기록·Day 완료).
- 목표: `goals/store.ts` 자유 텍스트 (주/월/년/장기) — 달성률 필드 없음.
- 통계: `statsHub` (기간 7/30/90/전체, 추세, 무술별, AI 요약 — 출처 기록 표시 없음), `trainingAnalytics`, `progressReport/analysis.ts` (기술 × 측정 방식별 성장 — 방식 섞지 않음, 신뢰도 표시), 차트 = 자체 SVG (`TrendChart`, `DonutChart`, `ScoreHistoryChart`). 내보내기(PDF/이미지) 없음.
- AI 근거: `selfAi/evidenceCheck` (문장별 근거 대조), `guard` (없는 출처·링크 제거), `compositeResearch.externalVsDb` (DB ↔ 외부), 출처 신뢰도(높음/보통/낮음). 출처 유형은 학술/공식/기록/백과/웹/영상/블로그/커뮤니티 — 사양의 "전문 지도자·교육기관", "전문 매체", "확인 불가" 구분 없음. 출처 간 상충 비교 없음. CoachChat 출처 목록은 접기 불가. 헤더 "AI에게 묻기" 는 출처를 제목·링크만 표시(유형·신뢰도 없음), Gemini 경로는 출처 없음.
- 안전: 기술 데이터에 안전 필드 없음(일부 설명 문장에만 언급). 그래플링 `giNoGi` 의 `StylePosture.safety`(692개 기술, 일반 문구), 코치 `safetyAnswer`. 훈련 전 체크리스트 없음.
- 체육관·지도자 관리: 이미 구현 — 이번 작업에서 다루지 않음.

### 만들 것
1. `lib/trainingEcosystem/learningState.ts` — 사양의 6단계 학습 상태(학습 전/학습 중/학습 완료/반복 학습 필요/평가 필요/숙련도 확인 완료) + "평가 데이터 부족" 구분, 기존 상태에서 계산.
2. `lib/trainingEcosystem/personalCurriculum.ts` — 목표 → 단계별 로드맵(선행 기술·난이도 순서, 평가 방법, 다음 단계 조건) + 결과에 따른 자동 조정(조정 이력, 학습 기록은 건드리지 않음) + 사용자 수정. 오늘의 학습은 기존 커리큘럼 Day/훈련 실행으로 연결.
3. `lib/trainingEcosystem/performance.ts`, `growthReport.ts` — 기간별 집계(기존 statsHub·progressReport 재사용) + 근거 기록 id를 인용하는 성장 리포트 + 이미지/PDF 내보내기.
4. 근거 UI: 출처 6분류, 근거 상태(충분/일부/상충/없음/판단 어려움), 접는 출처 목록, 헤더 AI에도 같은 정보.
5. `lib/safety/*` — 기술 분류 기반 안전 가이드(검증 안 된 내용은 "정보 확인 필요"), 사용자 수준별 안내, 훈련 전 체크리스트(저장·조회·훈련 기록과 날짜로 연결), AI 코치 연동.

## 구현 기록 (2026-11-16)
- 새 파일: `src/lib/trainingEcosystem/{learningState,personalCurriculum,curriculumStore,performance,growthReport,reportExport,coachBridge,useEco}.ts`, `src/lib/safety/{techniqueSafety,checklist}.ts`, `src/lib/selfAi/evidenceSummary.ts`, `src/components/coach/EvidencePanel.tsx`, `src/components/safety/{SafetySection,SafetyChecklistCard}.tsx`, `src/pages/{MyCurriculum,PerformanceDashboard}.tsx`, `src/styles/eco-training.css`, `.devtools/test-training-ecosystem.mjs`.
- 수정: `App.tsx`(라우트 /my-curriculum, /performance), `brand/navConfig.ts`(메뉴 2개), `main.tsx`(CSS), `TechniqueDetail.tsx`(안전 섹션), `TodayTraining.tsx`(훈련 전 체크), `CoachChat.tsx`·`AiAskModal.tsx`(근거 패널), `selfAi/{coachAgent,deps,types}.ts`(상충 감지·커리큘럼/성과 질문·안전 문장), `ai/{types,martialdexAsk}.ts`(헤더 AI에 근거 전달).
- DB: 새 테이블 없음 — 커리큘럼·체크리스트는 `martialdex:*` 로컬 저장 + 기존 계정 백업(user_backups)으로 동기화. 마이그레이션 없음.
- 오프라인 테스트 `test-training-ecosystem.mjs` 65/65.
- 다음: 화면 확인(숨김 Electron), 전체 회귀, 빌드, 보고서.
- 2026-11-16 17:13 완료: 새 테스트 66/66, tsc 0, 회귀 63개 통과(실패 3건은 백업에서도 똑같이 실패), 카탈로그에 2개 기능 등록, 웹·mac·Android debug 빌드 성공. 보고서 작성.
