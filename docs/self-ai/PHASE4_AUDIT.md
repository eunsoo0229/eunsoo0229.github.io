# 자체 AI 4차 — 기존 구조 조사 (2026-11-01)

브랜치 `ai/self-hosted-overhaul`, 작업 시작 시 HEAD `6102fef`, 미커밋 변경 없음. 원본 저장소는 읽기만.

## 1. AI·의도 분류 경로 — 자체 AI가 두 갈래

| 경로 | 화면 | 엔진 | 상태 |
|---|---|---|---|
| `selfAi/coachAgent.ts` + `router.ts` | /coach/chat, 수업 중 질문 | 1–3차에서 개선한 자체 AI(코드 라우팅·DB·SearXNG·Qwen) | 유지·확장 |
| `ai/useAiChat` → `ai/martialdexAsk.ts` | 헤더 "AI에게 묻기"(AiAskModal), 기술 그래프 | 이전 자체 AI: `answerCoachQuestion` + **Tavily** 웹 검색(`webSearch/provider`) | **3차 개선이 적용되지 않은 별도 경로** |
| `personalCoach/service.ts` | 개인 코치 화면 | **Gemini** | 자체 AI 경로에서 재사용하지 않음 |
| `coachKnowledge/featureCatalog.ts` | 수업 화면의 기능 바로가기 | 코드(레슬링 솔로 드릴 구령 화면 열기 등) | 재사용 |

### "레슬링 솔로 드릴 훈련을 하고 싶어." 실패 재현
`planTurn` → intent `training`, art `wrestling`, 기술 0개 → 수업 계획·드릴 경로 없음 → **모델 자유 작성** + 학습자 기록 600자(여러 무술의 연습 이력) → 모델이 그 기록의 기술(Guillotine, Armbar, Gyaku-zuki, Jab …)을 나열하는 구조. 모델이 꺼져 있으면 "자료를 찾지 못했습니다". "레슬링 훈련하고 싶어" = training, "오늘 주짓수 연습하자" = general, "복싱 솔로 드릴 수업 만들어 줘" / "내가 부족한 기술 위주로 수업해 줘" = lesson → 기술 이름이 없어 "수업을 만들 수 있는 기록이 없습니다". 즉 **훈련 의도 → 수업 생성** 경로가 없음(A).

### 선수 분석 실패(토푸리아)
`resolvePerson('토푸리아')` → 위키백과 문서 없음(성만 입력), `'일리아 토푸리아'` → Ilia Topuria 확인. 이름을 못 찾으면 한국어 이름 그대로 검색 → 무관한 결과. 재검색·관련성 재평가·실패 원인 구분 없음(A).

## 2. 사용자 데이터 (모두 기존, 로컬 우선 + Supabase 동기화)

| 데이터 | 모듈 | 비고 |
|---|---|---|
| 숙련도(5단계: 미학습·학습 중·보통·숙련·개선 필요) | `skillProgress/*` | **자세 측정 기록이 있으면 자세 점수만으로 상태 결정**(computeSkillProgress) — 학습 숙련도와 자세 점수가 섞여 있음 |
| 배운 기술 | `learnedTechniques/service.ts` | 연습 기록·자세 측정·AI 코치 수업·직접 지정 |
| 약점·최근 향상·무술별 요약 | `skillProgress/weaknessEngine.ts` | 재사용 |
| 복습 예정 | `SkillProgress.nextReviewAt`, `reviewSystem/reviewEngine.ts`, `review/reviewLog.ts`(복습 결과) | 재사용 |
| AI 코치 수업 근거 | `skillProgress/coachEvidence.ts`(수업 기록의 이해도·실습, 날짜 수) | 재사용 |
| 수업 기록 | `coachLesson/lessonLog.ts` — `saveLessonLog`는 **같은 id면 덮어씀**(중복 저장 없음) | 멱등성 기반 |
| 연습 기록 | `trainingHistory/*` | |
| 내 콤보 | `combo/service.ts`(`listMyCombos`), 지식 인덱스의 `my_combo`·공유 콤보·셋업 | 재사용 |
| 직접 지정 상태 | `skillProgress/overrideStore.ts` | |
| 커리큘럼(학습 예정) | `curriculum/curriculumService.ts` | 앞으로의 Day = 학습 예정 |

사용자 분리: 로컬 저장소는 기기 단위이고, 다른 계정이 같은 기기에 로그인하면 `auth/deviceAccountGuard.ts`가 로컬 데이터를 지움 → 클라우드 동기화는 계정별(RLS). 자체 AI 서버에는 사용자 데이터가 가지 않음(3차). → 개인화 조회는 **클라이언트에서 현재 계정의 로컬 데이터만 읽기**로 하면 분리가 유지됨.

## 3. 자세 측정 (모두 기존)

| 시스템 | 동작 | 외부 의존 | 지원 기술 |
|---|---|---|---|
| `poseAnalysis/*` + `PoseAnalysisModal` | 카메라 4초 촬영 → MediaPipe(로컬) → 기술별 규칙 지표 점수 → 기록 저장 | 없음 | `data/curated/poseAnalysis.json` 18개: 복싱 잽·크로스·훅·어퍼컷·하이가드, 킥복싱 잽·크로스·라운드킥·프런트킥, 무에타이 티프·라운드킥 3종, 태권도 앞차기·돌려차기, 레슬링 스탠스·레벨 체인지·페네트레이션 스텝 |
| `formCompare/*` + `FormCompareModal` | 기준 영상(YouTube·파일) 대 사용자 영상 | **판정은 Gemini**(`askGeminiForJson`); 관절 추출·정렬·촬영 방향 추정·가림 검사(`clipCapture`, `motion.ts`)는 로컬 | 모든 기술(기준 영상 필요) |

- 싱글렉(High Single 등)은 로컬 측정 대상이 아님. 레슬링은 스탠스·레벨 체인지·페네트레이션 스텝만.
- poseAnalysis는 카메라만 받음(영상 파일 입력 없음). formCompare의 로컬 영상 관절 추출(`sampleVideoBlob`)을 쓰면 파일 → 같은 규칙 채점이 가능.
- YouTube 기준 영상은 브라우저에서 관절을 뽑을 수 없음(교차 출처) → 로컬로는 "기준 영상과의 관절 비교" 불가, 기준 영상은 보기용.

## 4. 수업 시스템 (3차 그대로)
수업 생성(`lessonPlanner`·`chatLesson`), 진행(`CurriculumCoachSession` + `coachLesson` 엔진), 완료 시 `saveLessonLog`, 수업 중 질문(`lessonSession`), 재개(세션 저장소), 영상 카드, 추가 제안·동의.

## 5. 새로 필요한 것 / 재사용
| 필요 | 방법 |
|---|---|
| 훈련 의도(솔로·파트너·종목·복습·약점·콤보·셋업·이어하기) → 수업 | 라우터 의도 + 코드 훈련 계획(무술 고정, 솔로 가능 기술은 기존 `soloDrill/moves` 등) → 기존 수업 시작 버튼 |
| AiAskModal을 같은 자체 AI로 | `martialdexAsk`를 `runCoachTurn`으로 교체(Tavily 제거) |
| 학습 상태 7종·학습 숙련도(자세 점수와 분리) | 기존 수업·연습·복습 기록으로 계산하는 읽기 전용 모델(기존 5단계 화면은 그대로) |
| 개인 질문(배운/안 배운/부족/향상/복습/콤보/다음) | 코드 답변 |
| 수업 중 자세 측정 제안·거절 | 로컬 지원 기술만, 기존 `PoseAnalysisModal` |
| 자세 확인 직접 요청 | 지원 여부 → 단일 기술 시연 영상 검색(보기용) → 촬영 안내(설정의 관절 요구) → 카메라 또는 영상 파일 → 기존 규칙 채점 → 기존 기록 |
| 선수 이름(성만·별칭)·재검색·관련성 | `entity.cjs` 보강, 검색 라운드·관련성 재평가 |

새 마이그레이션: 필요 없음(모두 기존 로컬 저장소·기존 테이블). 확인된 데이터 구조 변경 없음.
