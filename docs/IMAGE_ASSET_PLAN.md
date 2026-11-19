# MARTIALDEX 이미지 에셋 제작 명세서

이모지로 대체되어 있는 UI 요소 전수 조사 결과와, 직접 제작할 이미지의 종류·용도·권장 크기·비율 명세.

조사일: 2026-11-07 / 조사 범위: `src/**` (tsx 202 + ts 502), `src/styles/global.css`, `index.html`, `electron/`, `android/app/src/main/res/`

---

## 0. 조사 요약

| 항목 | 수치 |
|---|---|
| 이모지가 쓰인 파일 | 182개 |
| 이모지 출현 총 횟수 | 828회 (주석·console 제외 실제 UI 렌더링 **750회**) |
| 고유 이모지 종류 | **142종** |
| `EmptyState` 호출 | 79곳 / 고유 아이콘 41종 |
| 이모지로 시작하는 `<h2>/<h3>` 섹션 헤더 | 169곳 |
| CSS의 `url()` 이미지 참조 | **0건** |
| 프로젝트 내 실제 UI 이미지 자산 | **2개** (`src/assets/logo.png`, 루트 `body.png`) |

즉 앱 화면에 들어가는 그래픽은 헤더 로고와 인체 회복도 이미지 단 2장뿐이고, 나머지 모든 시각 요소(아이콘·배지·아바타·커버·빈 화면)는 이모지 문자로 대체되어 있습니다.

**제작 필요량 집계: 래스터(PNG) 약 94장 + 단색 라인 아이콘(SVG) 약 60종 + 앱 아이콘 파생본 12개**

---

## 1. 우선순위 요약

| 우선순위 | 그룹 | 이유 |
|---|---|---|
| **P0** | A. 앱 아이덴티티 (파비콘·PWA·Electron·Android 어댑티브 아이콘 투명도 결함) | 현재 웹 빌드에 파비콘 자체가 없음, Android 아이콘 전경 레이어가 불투명 |
| **P0** | B. 사용자 아바타 / C. 무술 아이콘 / P. 숏폼·미디어 플레이스홀더 | 소셜·숏폼 확장의 전제 |
| **P1** | D. AI 기능 아이콘 / E. 업적 배지 / F. 랭크 배지 / L. 빈 화면 일러스트 | 사용자 눈에 가장 많이 띄는 영역 |
| **P1** | N+O. 통합 SVG 아이콘 세트 | 169개 섹션 헤더 + 컨트롤 버튼을 한 번에 정리 |
| **P2** | H. 커리큘럼 커버 / I. 훈련 소스 / J. 복습 모드 / K. 파이터 프로필 섹션 / M. 코치 식별 / Q~T | 기능별 세부 아이콘 |

---

## 2. 공통 제작 규칙

- **포맷**
  - 단색/라인 아이콘 → **SVG** (`fill="currentColor"`, 테마 전환 대응). 래스터로 만들지 말 것.
  - 컬러 일러스트·배지·커버 → **PNG-24 (알파 포함)**. 사진성 이미지는 WebP 병행.
- **해상도 배수**: 표시 크기의 **3배**로 제작(Android xxxhdpi 대응). 예) 48px 표시 → 144px 이상, 실무적으로 256 또는 512 정사각 권장.
- **테마**: 앱은 `light / dark / system` 3테마 (`src/components/Header.tsx:13-15`). 컬러 배지는 밝은 배경·어두운 배경 양쪽에서 대비가 유지되도록 외곽선 또는 1px 라이트 림 적용.
- **여백(Safe area)**: 정사각 아이콘은 캔버스 대비 **중앙 80%** 안에 그래픽을 배치(원형 크롭·마스킹 대비).
- **배치 위치 제안**
  - `public/` → 파비콘, PWA 아이콘, 매니페스트 (빌드 시 그대로 복사)
  - `src/assets/icons/` → SVG 아이콘 세트
  - `src/assets/art/` → 무술 아이콘
  - `src/assets/badges/` → 업적·랭크 배지
  - `src/assets/empty/` → 빈 화면 일러스트
  - `src/assets/placeholder/` → 아바타·커버·포스터 기본 이미지
- **파일명**: 소문자 kebab-case, 코드의 id와 1:1 일치시킬 것 (예: 업적 `first-technique-learned.png`, 무술 `muay-thai.svg`). id가 일치해야 교체 시 코드 변경이 매핑 한 줄로 끝납니다.

---

## A. 앱 아이덴티티 (P0)

현재 상태: 루트 `LOGO.png`, `assets/logo.png`, `src/assets/logo.png` 세 곳에 **동일한 1254×1254 PNG(RGB, 955KB)** 가 중복 존재.

| # | 항목 | 현재 상태 | 필요한 이미지 | 권장 크기 / 비율 | 비고 |
|---|---|---|---|---|---|
| A-1 | **웹 파비콘** | **없음** (`index.html`에 `<link rel="icon">` 자체가 없음 → 브라우저 기본 아이콘) | 마스터 1장 → ico/png 파생 | 마스터 **512×512 (1:1)** → `favicon.ico`(16/32/48 멀티), `favicon-32.png` | 작게 줄여도 식별되는 단순화 버전 필요 |
| A-2 | **Apple 터치 아이콘** | 없음 | PNG (불투명, 둥근 모서리 없이) | **180×180 (1:1)** | iOS가 자동으로 라운딩 |
| A-3 | **PWA / 매니페스트 아이콘** | 없음 (`manifest.json` 자체 없음) | PNG 2종 + maskable 1종 | **192×192**, **512×512**, maskable **512×512**(중앙 80% 안전영역) | |
| A-4 | **Electron 앱 아이콘** | `LOGO.png` 1254×1254 를 그대로 사용 (`electron-builder.config.cjs:21`) | macOS `.icns`, Windows `.ico` | 마스터 **1024×1024 (1:1)** PNG → icns/ico 변환 | PNG 직접 지정보다 네이티브 포맷이 선명 |
| A-5 | **Android 런처 아이콘(전경)** | `ic_launcher_foreground.png` 432×432 **RGB(알파 없음)** → 어댑티브 아이콘 배경 레이어를 덮는 불투명 사각형 | **투명 PNG**로 재제작 | **432×432 (1:1)**, 그래픽은 중앙 **264×264** 안에 | 현재 결함. 가장자리 108dp 중 66dp만 항상 보임 |
| A-6 | **Android 스플래시** | `splash.png` 존재 (320×480 ~ 1280×1920, 포트/랜드 전체 세트) | 중앙 로고형 마스터 1장 | **2732×2732 (1:1)**, 로고는 중앙 **1200×1200** 이내 | capacitor-assets로 전 밀도 재생성 |
| A-7 | **헤더 브랜드 마크** | `src/assets/logo.png` 1254px(955KB)를 **34×34로 렌더**(`global.css:274`) | 소형 전용 비트맵 또는 SVG | **SVG 권장**. PNG 시 `102×102` (34px @3x) | 955KB → 수 KB. 초기 로딩 체감에 직접 영향 |
| A-8 | **히어로 로고** | `src/pages/Home.tsx:56` `hero__logo` (현재 텍스트) | 가로형 로고 | **SVG** 또는 PNG **960×240 (4:1)** | 라이트/다크 2벌 또는 단색 SVG |

---

## B. 사용자 아바타 / 프로필 이미지 (P0)

현재 전부 **닉네임 첫 글자 텍스트**로 대체되어 있고, 기본 아바타 이미지가 없습니다.

| # | 위치 | 현재 | 표시 크기 | 필요한 이미지 | 권장 크기 / 비율 |
|---|---|---|---|---|---|
| B-1 | `src/components/community/PostCard.tsx:149` 게시물 작성자 | 닉네임 첫 글자 | 40px (모바일 36px) 원형 | **기본 아바타** | **256×256 (1:1)**, 원형 크롭 안전영역 |
| B-2 | `src/components/community/CommentsSheet.tsx:54,267` 댓글 | 닉네임 첫 글자 | 34px / 답글 26px 원형 | 위와 동일 자산 재사용 | — |
| B-3 | `src/pages/Shorts.tsx:91` 숏폼 작성자 | 닉네임 첫 글자 | 44px 원형, 흰 테두리 | 위와 동일 자산 재사용 | — |
| B-4 | `src/components/Header.tsx:256` 로그인 버튼 | `👤` | 38px 버튼 | 라인 아이콘 | **SVG** 24×24 |
| B-5 | 섹션 헤더 "프로필 / 나의 성장" (`Dashboard.tsx:79`, `Home.tsx:204`, `Profile.tsx:177`) | `👤` | 본문 크기 | 라인 아이콘 | **SVG** 24×24 |

> 기본 아바타는 **2~4종 변형**(색상 바리에이션)을 만들어 사용자 id 해시로 분배하면 피드가 단조로워지지 않습니다. 무술 테마(도복 실루엣·글러브 실루엣)로 제작 권장.

---

## C. 무술 아이콘 (P0) — 10종

현재 `src/lib/sparringAnalysis/martialArtCriteria.ts:15-24`. **태권도·가라테·유도·삼보·BJJ 5종이 전부 `🥋` 하나를 공유**해 구분이 전혀 안 됩니다. `data/processed/`에 실제 존재하는 무술 10종과 1:1로 맞춥니다.

| id | 무술 | 현재 이모지 | 제작 방향 제안 |
|---|---|---|---|
| `boxing` | 복싱 | 🥊 | 글러브 |
| `kickboxing` | 킥복싱 | 🦵 | 글러브 + 로우킥 실루엣 |
| `muay-thai` | 무에타이 | 🇹🇭 (국기 — 부적절) | 몽콘(머리띠) 또는 엘보 실루엣 |
| `taekwondo` | 태권도 | 🥋 | 하이킥 실루엣 |
| `karate` | 가라테 | 🥋 | 정권 지르기 실루엣 |
| `wrestling` | 레슬링 | 🤼 | 싱글렛 / 태클 실루엣 |
| `judo` | 유도 | 🥋 | 깃 잡기(구미카타) 실루엣 |
| `sambo` | 삼보 | 🥋 | 삼보 재킷 + 레그락 실루엣 |
| `bjj` | 브라질리언 주짓수 | 🥋 | 가드 포지션 실루엣 |
| `mixed-martial-arts` | MMA | 🥊 | 오픈핑거 글러브 / 케이지 |

- **종류**: 단색 실루엣 아이콘 (SVG) + 컬러 원형 뱃지형(PNG) 2벌 권장
  - SVG: 목록·칩 inline 표시용, 24×24 뷰박스, `currentColor`
  - PNG: 무술 선택 카드·필터 타일용, **512×512 (1:1)** 투명
- **사용처**: 스파링 분석 무술 선택, 무술별 훈련 밸런스(`Dashboard.tsx:161`), 기술 목록 필터, 커리큘럼 카드, 프로필 주력 무술

---

## D. AI 기능 카드 아이콘 (P1) — 29종

`src/lib/aiCoach/aiFeatureCatalog.ts` — AI 코치 탭 전체 카드 그리드(`src/components/coach/AiFeatureCatalog.tsx:56`)에서 제목 앞에 인라인으로 출력됩니다.

| # | id | 현재 | 기능명 |
|---|---|---|---|
| 1 | `self-ai-chat` | 💬 | MARTIALDEX 자체 AI 코치와 대화 |
| 2 | `fighter-profile` | 🧑‍🥋 | 개인 파이터 프로필 (AI 인터뷰) |
| 3 | `oneoff-lesson` | ✍️ | 수업하고 싶은 거 입력하기 |
| 4 | `personal-analysis` | 📊 | 내 기록 분석·추천 |
| 5 | `coach-class` | 🧑‍🏫 | AI 코치 수업 (집·체육관) |
| 6 | `visual-mitt` | 🥊 | AI Visualizing Mitt |
| 7 | `ask` | ✦ | AI 코치에게 질문 |
| 8 | `ai-combo` | 🥋 | AI 콤비네이션 생성 |
| 9 | `situation` | 🎯 | 상황별 기술 추천 |
| 10 | `tactic-feedback` | 🧩 | 전술 셋업 AI 피드백 |
| 11 | `technique-request` | 🔎 | 없는 기술 요청 |
| 12 | `art-request` | 🌏 | 새 무술 추가 |
| 13 | `video-verify` | ▶ | 기술 영상 확인·추가 |
| 14 | `pose` | 📷 | AI 자세 분석 (카메라) |
| 15 | `ai-curriculum` | 📘 | AI 맞춤 커리큘럼 |
| 16 | `fighter-style` | 🏆 | 선수 스타일 학습 |
| 17 | `review` | 🔁 | AI 추천 복습 |
| 18 | `sparring` | 🎥 | 스파링 영상 AI 분석 |
| 19 | `training-analysis` | 📈 | 훈련 기록 AI 분석 |
| 20 | `stats-summary` | 📊 | 나의 통계 AI 요약 |
| 21 | `my-style` | 🧭 | 나의 스타일 분석 |
| 22 | `home-curriculum` | 🏠 | 홈트 AI 맞춤 커리큘럼 |
| 23 | `home-request` | 🧘 | 홈트 운동 요청 |
| 24 | `gym-trainer` | 🏋️ | AI 트레이너 |
| 25 | `gym-request` | 🏋️ | 헬스 운동 요청 |
| 26 | `meal-gen` | 🍱 | AI 식단 만들기 |
| 27 | `meal-text` | 📝 | 말로 식사 기록 |
| 28 | `meal-photo` | 📸 | 사진으로 식사 기록 |
| 29 | `ai-history` | 🗂 | AI 질문 기록 |

- ⚠️ **중복**: #4·#20이 둘 다 📊, #24·#25가 둘 다 🏋️ → 반드시 구분되는 그림으로 제작
- **종류**: 그룹 컬러가 들어간 사각/라운드 타일 아이콘
- **권장 크기**: **256×256 (1:1)** 투명 PNG (카드에서 **48×48** 표시 가정), 또는 SVG
- **그룹 색 구분**(6개 그룹): 수업·코칭 / 기술·콤보·전술 / 커리큘럼·복습 / 분석 / 홈트·헬스·영양 / 기록

---

## E. 업적 배지 (P1) — 15종

`src/lib/achievements/definitions.ts:18-32`. **9개가 전부 `🏆` 하나를 공유**합니다. 표시 위치: `src/pages/Profile.tsx:447` 업적 목록(잠금 시 `opacity: 0.55`).

| # | id | 현재 | 업적명 | 조건 |
|---|---|---|---|---|
| 1 | `first-technique-learned` | 🏆 | 첫 번째 기술 학습 | 기술 1개 |
| 2 | `first-curriculum-complete` | 🏆 | 첫 커리큘럼 완료 | 커리큘럼 1개 |
| 3 | `first-sparring-analysis` | 🏆 | 첫 스파링 분석 | 분석 1회 |
| 4 | `ten-techniques-proficient` | 🏆 | 10개 기술 숙련 | 숙련 10개 |
| 5 | `fifty-techniques-learned` | 🏆 | 50개 기술 학습 | 학습 50개 |
| 6 | `ten-training-sessions` | 🏆 | 10회 훈련 | 세션 10회 |
| 7 | `ten-sparring-analyses` | 🏆 | 10회 스파링 분석 | 분석 10회 |
| 8 | `seven-day-streak` | 🏆 | 7일 연속 학습 | 연속 7일 |
| 9 | `first-style-curriculum-complete` | 🏆 | 첫 목표 스타일 커리큘럼 완료 | 1개 |
| 10 | `iron-man` | 💪 | 철인 | 연속 30일 |
| 11 | `technique-explorer` | 🧭 | 기술 탐험가 | 무술 5종 |
| 12 | `analysis-master` | 🔬 | 분석 마스터 | 자세 분석 30회 |
| 13 | `ai-disciple` | 🤖 | AI 수제자 | AI 피드백 5회 |
| 14 | `combo-master` | 🥊 | 콤보 마스터 | 콤보 훈련 10회 |
| 15 | `tactician` | 🧩 | 전략가 | 전술 5개 |

- **종류**: 원형 또는 방패형 컬러 배지 (금속 질감 권장)
- **권장 크기**: **512×512 (1:1)** 투명 PNG — 목록 **64×64** 표시 기준 @8x, 업적 달성 모달/공유 이미지 재활용 고려
- **잠금 상태**: 별도 제작 불필요 (코드에서 그레이스케일 + opacity 처리). 단, 그레이스케일 변환 후에도 형태가 식별되도록 명도 대비 확보
- **등급 색 제안**: 1~3(브론즈) / 4~9(실버) / 10~15(골드)

---

## F. 랭크 배지 (P1) — 7종

`src/lib/rank/rankEngine.ts:12-20`의 7단계 타이틀. 현재 `Dashboard.tsx:81`, `Profile.tsx:359`에서 `🥋 {rank.title}` 칩 하나로만 표시되어 **7단계가 시각적으로 전혀 구분되지 않습니다.**

| 단계 | 타이틀 |
|---|---|
| 1 | 도장 입문자 |
| 2 | 성실한 수련생 |
| 3 | 다재다능 수련자 |
| 4 | 헌신적인 무도인 |
| 5 | 고급 수련자 |
| 6 | 베테랑 파이터 |
| 7 | 그랜드마스터 후보 |

- **권장 크기**: **512×512 (1:1)** 투명 PNG (칩 inline **20×20**, 프로필 헤더 **96×96** 표시 가정)
- ⚠️ **주의**: 코드 주석에 명시된 대로 **실제 띠·단 체계(백띠/검은띠/초단 등)를 연상시키는 디자인 금지**. 실제 승단으로 오인될 수 있습니다. 엠블럼·문장(crest) 계열로 제작할 것.

---

## G. 숙련도 / 상태 인디케이터 (P1) — 5종

색 원 이모지가 4개 모듈에서 중복 정의되어 있습니다.

| 상태 | 현재 | 정의 위치 |
|---|---|---|
| 미시작 / 관측불가 | ⚪ | `skillProgress/types.ts:11`, `poseAnalysis/scoring.ts:27`, `formCompare/FormCompareModal.tsx:23` |
| 학습 중 / 선택됨 | 🔵 | `skillProgress/types.ts:12`, `SparringAnalysis.tsx:601` |
| 보통 / 부분 일치 / 곧 복습 | 🟡 | `skillProgress/types.ts:13`, `poseAnalysis/scoring.ts:25`, `reviewSystem/types.ts:15` |
| 숙련 / 일치 / 유지됨 | 🟢 | `skillProgress/types.ts:14`, `poseAnalysis/scoring.ts:24`, `reviewSystem/types.ts:16` |
| 개선 필요 / 불일치 / 오늘 복습 | 🔴 | `skillProgress/types.ts:15`, `poseAnalysis/scoring.ts:26`, `reviewSystem/types.ts:14` |

- **종류**: **SVG 5종** (색 + 형태를 함께 다르게 — 색각 이상 대응). 예: 빈원 / 반원 / 삼각 / 체크원 / 느낌표원
- **권장 크기**: 16×16 뷰박스, 표시 12~16px
- 래스터 제작 불필요

---

## H. 커리큘럼 커버 이미지 (P2)

`coverIcon`은 **DB에 저장되는 문자열 필드**입니다(`src/lib/curriculum/types.ts:116`, `marketplace/types.ts:23`). 현재 이모지 한 글자가 들어갑니다.

| 항목 | 현재 | 위치 |
|---|---|---|
| 마켓 게시 시 선택 프리셋 8종 | `🥋 🥊 🧠 🔥 ⭐ 🏆 🛡️ ⚔️` | `src/pages/MarketplacePublish.tsx:9` |
| 스파링 기반 자동 생성 | 🥊 | `sparringAnalysis/sparringToCurriculum.ts:275` |
| 스타일 커리큘럼 | 🥋 | `fighterStyle/styleCurriculumService.ts:71` |
| 약점 보완 | 🎯 | `aiCoach/weaknessCurriculum.ts:58` |
| 채팅 수업 | 💬 | `selfAi/chatLesson.ts:69` |
| 홈트 | 💪 | `homeTraining/service.ts:177` |
| AI 맞춤 | 🧠 | `aiCurriculum/service.ts:1028` |
| 위치별(집/체육관/제한) | 🏠 / 🥊 / 📍 | `aiCoachCurriculum/location.ts:5` |

- **필요 이미지 2종류**
  1. **커버 아트 8~12종**: 마켓 리스트·커리큘럼 카드 썸네일 → **1280×720 (16:9)** JPG/WebP. 제목 텍스트가 위에 얹히므로 상단 40% 는 저대비 영역으로 비워둘 것
  2. **커버 아이콘 12종**(위 표의 자동 생성 종류별): **256×256 (1:1)** 투명 PNG
- **기본 커버 1장** 필수 (coverIcon 미지정 커리큘럼용)

---

## I. 훈련 기록 소스 아이콘 (P2) — 11종

`src/components/TrainingEntryRow.tsx:10-22`. 훈련 기록 목록·캘린더·대시보드에서 공통 사용.

| source | 현재 | 의미 |
|---|---|---|
| `curriculum` | 📘 | 커리큘럼 |
| `coach_today` | 🔥 | 오늘의 훈련 |
| `sparring` | 🥊 | 스파링 |
| `review` | 🔁 | 복습 |
| `combo` | 🔗 | 콤보 |
| `shadow` | 🌀 | 섀도 (제거된 기능, 과거 기록만) |
| `free_training` | 🏃 | 자유 훈련 |
| `gym_class` | 🥋 | 체육관 수업 |
| `sparring_session` | 🤼 | 스파링 세션 |
| `ground_battle` | ⚔️ | 그라운드 배틀 (제거된 기능, 과거 기록만) |
| `visual_mitt` | 🥊 | 비주얼 미트 |
| (헬스 수업) | 🏋 | `gym_class` + 헬스 무술 id인 경우 |

- ⚠️ `sparring`과 `visual_mitt`가 둘 다 🥊 → 구분 필요
- **종류**: 단색 라인 **SVG 12종**, 20×20 뷰박스 (목록 행 좌측 16~20px 표시)
- 제거된 기능 2종(`shadow`, `ground_battle`)도 과거 기록 표시를 위해 필요

---

## J. 복습 모드 아이콘 (P2) — 5종

`src/pages/ReviewModes.tsx:93-98`

| mode | 현재 | 라벨 |
|---|---|---|
| `training` | 📒 | 훈련 기록 복습 |
| `lesson` | 🎓 | 수업 복습 |
| `gym` | 🥋 | 체육관 기록 복습 |
| `weak` | 🩹 | 부족 기술 복습 |
| `ai` | 🤖 | AI 추천 복습 |

- **권장**: **256×256 (1:1)** 투명 PNG (모드 카드 **56×56** 표시) 또는 SVG 32×32

---

## K. 파이터 프로필 섹션 아이콘 (P2) — 8종

`src/lib/fighterProfile/catalog.ts:46-53`

| id | 현재 | 라벨 |
|---|---|---|
| `training` | 🎯 | 훈련 경험·목표 |
| `body` | 📏 | 기본 신체 정보 |
| `striking` | 🥊 | 타격 |
| `defense` | 🛡️ | 가드·방어 |
| `movement` | 👣 | 이동·경기 습관 |
| `grappling` | 🤼 | 그래플링 |
| `positions` | 🧩 | 포지션 |
| `style` | ⭐ | 개인 스타일 |

- **종류**: 단색 라인 **SVG 8종**, 24×24 뷰박스

---

## L. 빈 화면(EmptyState) 일러스트 (P1)

`src/components/EmptyState.tsx` — `font-size: 34px; opacity: 0.6` 으로 이모지 하나만 표시. 호출 **79곳**, 사용 이모지 **41종**.

41종을 전부 그릴 필요는 없고, **의미 기준 12종으로 통합**하는 것을 권장합니다.

| 통합 일러스트 | 대체하는 현재 이모지 | 대표 사용처 (파일:라인) |
|---|---|---|
| L-1 기록 없음 (빈 노트) | 🕘 🕓 🕑 📜 📒 📋 | `Home.tsx:275`, `Dashboard.tsx:126`, `TrainingHistoryList.tsx:84`, `ReviewModes.tsx:250` |
| L-2 기술 없음 (도복/글러브) | 🥋 🥊 (16곳) | `TrainingHub.tsx:219`, `ComboList.tsx:72`, `TodayTraining.tsx:83,309,315`, `FreeTraining.tsx:505,508` |
| L-3 체육관 없음 | 🏛 (8곳) | `GymHub.tsx:56,67,142`, `GymAdminHub.tsx:54,98`, `GymAdminDetail.tsx:91` |
| L-4 게시물/피드 없음 | 📭 🌐 📱 | `CommunityFeed.tsx:129`, `GymHub.tsx:121`, `Community.tsx:206` |
| L-5 커리큘럼 없음 | 📘 🏗 ✏️ 📚 | `Dashboard.tsx:100`, `LearningHub.tsx:43`, `CurriculumList.tsx:137,174` |
| L-6 검색 결과 없음 | 🔍 🔎 | `LearnedTechniques.tsx:237`, `PostDetail.tsx:52`, `SituationRecommend.tsx:206` |
| L-7 복습 없음 | 🔁 🩹 🎓 | `TodayReview.tsx:142,306`, `ReviewModes.tsx:301,342,424,616` |
| L-8 로딩 중 | ⏳ | `GymLiveControl.tsx:46`, `GymLiveSession.tsx:17`, `MarketplacePaymentResult.tsx:61` |
| L-9 로그인 필요 (자물쇠) | 🔒 | `GymLiveSession.tsx:16` |
| L-10 마켓/결제 | 🛒 💳 💰 | `Marketplace.tsx:70,130`, `MarketplacePaymentResult.tsx:61` |
| L-11 분석 데이터 없음 | 📊 📈 💡 ✅ | `MyStats.tsx:89`, `TrainingAnalytics.tsx:86`, `AiCoach.tsx:162`, `Dashboard.tsx:173` |
| L-12 즐겨찾기/태그 없음 | ★ ☆ 🔗 🏷 🌳 🧩 | `Home.tsx:293`, `TechniqueGraph.tsx:319`, `SkillTree.tsx:219` |
| (추가) 오류 상태 | ⚠️ | `src/components/ErrorState.tsx:5` |

- **권장 크기**: **480×480 (1:1)** 투명 PNG — 화면 표시 **120~160px** 기준 @3x
- **스타일**: 선 굵기 일정한 단색 또는 2색 라인 일러스트. 현재 `opacity: 0.6`으로 흐리게 처리되므로 과한 디테일 금지
- 다크 테마에서도 보이도록 **단색 + currentColor SVG**가 가장 안전 (PNG로 만들 경우 라이트/다크 2벌)

---

## M. AI 코치 / 제공자 식별 이미지 (P2) — 4종

| 대상 | 현재 | 위치 |
|---|---|---|
| MARTIALDEX 자체 AI 코치 | 🥋 | `CoachPicker.tsx:90`, `CurriculumCoachSession.tsx:993`, `OneOffCoachLesson.tsx:662` |
| Gemini 코치 | ✨ | `CoachPicker.tsx:106`, `OneOffCoachLesson.tsx:634` |
| 알 수 없음 | ❔ | `CurriculumCoachSession.tsx:993`, `OneOffCoachLesson.tsx:662` |
| AI 코치 캐릭터(수업 화면 헤더) | 🧑‍🏫 | `AiCoachClass.tsx:80`, `CurriculumCoachSession.tsx:910,925` |
| AI 봇(식단·복습) | 🤖 | `AiMealGenModal.tsx:68`, `LearnSheet.tsx:40`, `ReviewModes.tsx` |

- **코치 캐릭터 아바타**가 가장 가치 큼: 채팅 말풍선 좌측 아바타로 재사용 가능 → **512×512 (1:1)** 투명 PNG, 원형 크롭 대응
- 제공자 구분 뱃지는 **SVG 24×24**

---

## N + O. 통합 SVG 아이콘 세트 (P1) — 약 60종

섹션 헤더 169곳과 컨트롤 버튼에 쓰인 이모지·기호는 **래스터 이미지로 만들지 말고 하나의 SVG 아이콘 세트**로 제작하는 것이 유지보수·성능·테마 대응 모두에서 유리합니다.

**N. 미디어 / 컨트롤 (24×24 뷰박스, stroke 1.5~2)**

| 글리프 | 의미 | 대표 위치 |
|---|---|---|
| ▶ (56회) | 재생 / 시작 | `Shorts.tsx:82`, `PostCard.tsx:34`, `MotionViewer.tsx`, `VisualMitt.tsx:823` |
| ⏸ (13회) | 일시정지 | `CoachVoiceBar.tsx:75,91`, `WorkoutPanel.tsx:155`, `CommandDrill.tsx:247` |
| ◀ (10회) | 이전 | `TrainingCalendarView.tsx:33`, `NutritionCalendarView.tsx:42`, `VisualMitt.tsx:815` |
| ⏭ / ⏮ / ⏹ / ■ | 다음 / 처음 / 정지 | `GymLiveControl.tsx:118`, `VisualMitt.tsx:843,765` |
| 🔊 / 🔇 | 소리 켬 / 끔 | `Shorts.tsx:111`, `CoachVoiceBar.tsx:73,146` |
| 🎙 / 🎤 | 음성 입력 / 마이크 테스트 | `CoachVoiceBar.tsx:122`, `useVoiceInput.tsx:250`, `MicTestPanel.tsx:65` |
| 📷 / 📸 / 📹 / 🤳 / 📼 | 촬영·카메라·전면·녹화목록 | `PoseAnalysisModal.tsx:281`, `SparringRecord.tsx:466,496`, `SparringAnalysis.tsx:410` |
| 📁 | 파일 업로드 | `FormCompareModal.tsx:590`, `SparringVideoList.tsx:250` |
| ♥ / ♡ | 좋아요 on/off | `Shorts.tsx:98`, `PostCard.tsx:217`, `CommentsSheet.tsx:76`, `SharedComboCard.tsx:52` |
| 💬 | 댓글 | `Shorts.tsx:104`, `PostCard.tsx:220` |
| 🔖 / 📑 | 저장 on/off | `Shorts.tsx:101`, `PostCard.tsx:223` |
| 🔁 | 리포스트 | `PostCard.tsx:227,258` |
| ☰ / ⌕ / ✦ / ⎋ | 메뉴 / 검색 / AI 질문 / 로그아웃 | `Header.tsx:208,240,...` |
| 🖥 / ☀ / ☾ | 테마 시스템/라이트/다크 | `Header.tsx:13-15` |
| ☑ / ☐ | 완료 / 미완료 체크 | `ComboTraining.tsx:214`, `FreeTraining.tsx:609`, `GymClassSession.tsx:219` |
| ✅ / ❌ / ⚠ / ℹ️ | 검증 결과 배너 | `VideoPickerModal.tsx:225-227`, `ResearchResultsCard.tsx:33-59`, `ErrorState.tsx:5` |
| ➕ / ✕ / ⚙ / ↩ / ➡ / ↗ | 추가 / 닫기 / 설정 / 되돌아가기 / 다음 / 외부링크 | `RequestGymExercise.tsx:114`, `VisualMitt.tsx:565`, `CurriculumEditor.tsx:410` |

**O. 섹션 헤더 아이콘 (24×24 뷰박스)** — 169개 헤더에서 쓰이는 고유 글리프 약 45종

🏠 대시보드 · 🥋 훈련 · 👤 프로필 · 📘 커리큘럼 · 📅 캘린더 · 💡 인사이트 · 🔥 오늘의 훈련 · 🍚 영양 · 🧠 AI 엔진 · 🔊 음성 · 🕑 기록 · 🏆 업적 · 🛍 구매 · 💰 판매 · 🎯 목표 · 📊 통계 · 📈 숙련도 · 🎥 영상 · 🔍 조사 · 🧩 전술 · 🔗 연계 · 🕸 그래프 · 🌳 기술트리 · 🤼 그래플링 · 🧍 자세 · 🎬 기준영상 · 📺 기준보기 · 🦴 관절 · 📐 촬영각도 · 🛡 방어 · ⚔ 카운터 · 🧭 핵심원리 · 📖 설명 · 🏷 태그 · 🌐 다른 무술 · 🔀 묶음 · 🎓 수업 · 🙋 답변차례 · 🎉 완료 · ⏱ 시간 · 🧑‍🤝‍🧑 사용자추가 · 🗂️ 카테고리 · 👥 학생 · 🏛 체육관 · 📍 위치 · 🔑 핵심포인트 · ⚡ 연속실행 · 👀 상대반응 · 👍 잘한점 · 🔻 개선필요 · ⚖️ 장단점 · 🧪 테스트결제 · 💳 결제 · ☁️ 백업 · ⌨️ 키보드 입력

- 상당수가 **C~K 그룹과 중복**되므로 먼저 C~K를 SVG로 만들고, 남는 것만 추가 제작하면 실제 신규 제작량은 **35~40종** 수준입니다.

---

## P. 숏폼 / 미디어 플레이스홀더 (P0)

| # | 위치 | 현재 | 필요한 이미지 | 권장 크기 / 비율 |
|---|---|---|---|---|
| P-1 | `src/pages/Shorts.tsx:80` `short__placeholder` | **검은 사각형** (`global.css:3796` `background:#111`) | 숏폼 로딩 포스터 | **1080×1920 (9:16)**, 10~30KB 수준의 저용량 블러/패턴 |
| P-2 | `src/components/community/PostCard.tsx:32` `community-post-media__video-poster-fallback` | 빈 div | 영상 썸네일 대체 | **1280×720 (16:9)** |
| P-3 | 게시물 이미지 로드 실패 시 | 없음 | 깨진 이미지 대체 | **800×800 (1:1)** |
| P-4 | `src/components/YouTubeLite.tsx:17` | YouTube `hqdefault.jpg` (외부) | 404 시 폴백 | **480×360 (4:3)** |

> 숏폼 체감 속도 개선(요구사항 4번)과 직결됩니다. P-1은 **최대한 가벼운 단일 이미지**로, 영상 디코딩 전에 즉시 표시되는 용도입니다.

---

## Q. 체육관 (P2)

현재 체육관을 나타내는 모든 요소가 `🏛` 하나입니다 (11곳).

| # | 용도 | 필요한 이미지 | 권장 크기 / 비율 |
|---|---|---|---|
| Q-1 | 체육관 기본 로고 (로고 미등록 시) | 투명 PNG | **512×512 (1:1)** |
| Q-2 | 체육관 프로필 배너 기본 | JPG/WebP | **1200×400 (3:1)** |
| Q-3 | 체육관 뱃지 (게시물 `📍 체육관 태그`, `PostCard.tsx:213`) | SVG | 16×16 |

---

## R. 마켓 · 결제 (P2)

| 용도 | 현재 | 위치 | 필요한 이미지 / 크기 |
|---|---|---|---|
| 마켓 홈 | 🛒 | `Marketplace.tsx:63,70,130` | SVG 24×24 |
| 결제하기 | 💳 | `MarketplaceCurriculumDetail.tsx:273` | SVG 24×24 |
| 테스트 결제 안내 | 🧪 | `PaymentModal.tsx:11` | SVG 24×24 |
| 구매/판매 섹션 | 🛍 / 💰 | `Profile.tsx:382,402` | SVG 24×24 |
| 평점 | ⭐ | `Marketplace.tsx:144` | SVG 16×16 (채움/빈 2종) |

---

## S. 영양 (P2)

| 용도 | 현재 | 위치 | 필요한 이미지 / 크기 |
|---|---|---|---|
| 오늘의 영양 섹션 | 🍚 | `Home.tsx:145`, `Nutrition.tsx:131,234` | SVG 24×24 |
| AI 식단 생성 | 🍱 / 🤖 | `aiFeatureCatalog.ts:317`, `AiMealGenModal.tsx:68` | D그룹과 공유 |
| 식사 기본 사진 (사진 미등록 식사) | 없음 | `MealFormModal.tsx` | **600×600 (1:1)** PNG |

---

## T. 자세 분석 / 3D (P2)

| 용도 | 현재 | 위치 | 필요한 이미지 / 크기 |
|---|---|---|---|
| 자세 잡기 섹션 | 🧍 | `PostureSection.tsx:27`, `GrapplingStylePanel.tsx:31,153` | SVG 24×24 |
| 캐릭터 / 관절 보기 전환 | 🧍 / 🦴 | `MotionViewer.tsx:201` | SVG 24×24 2종 |
| 기준 영상 구간 / 3D 시연 기준 | 🎬 / 🧍 | `PoseAnalysisModal.tsx:310` | SVG 24×24 |
| 촬영 각도 안내 | 📐 | `FormCompareModal.tsx:568` | **촬영 가이드 일러스트 3종** (정면/측면/45도) **800×600 (4:3)** |
| 3D 모델 로딩 썸네일 | 없음 | `motion3d/` | **512×512 (1:1)** |

> T의 촬영 가이드 일러스트는 자세 분석 정확도에 직접 영향을 주는 항목이라 실사용 가치가 높습니다. `assets/3d/fighter/renders/`에 이미 렌더 PNG 17장이 있으므로 이를 가공해 쓸 수 있습니다.

---

## U. 소셜·클랜 확장 시 추가로 필요해질 이미지 (선제작 권장)

현재 코드에는 없지만, 진행 예정인 확장(프로필/팔로우/DM/클랜)에서 즉시 필요합니다.

| 용도 | 권장 크기 / 비율 |
|---|---|
| 사용자 프로필 배너 기본 | **1200×400 (3:1)** |
| 클랜 프로필 이미지 기본 | **512×512 (1:1)** |
| 클랜 배너 기본 | **1200×400 (3:1)** |
| 알림 타입 아이콘 (팔로우/좋아요/댓글/리포스트/DM/공지) 6종 | SVG 24×24 |
| 비공개 계정 잠금 표시 | SVG 24×24 |
| 빈 DM 목록 / 빈 알림 일러스트 2종 | **480×480 (1:1)** |
| 역할 뱃지 (관장/코치/학생/방장/부방장) 5종 | SVG 20×20 |

---

## 3. 제작 수량 총계

| 구분 | 수량 |
|---|---|
| 앱 아이덴티티 마스터 | 3장 (정사각 로고 / 가로 로고 / 스플래시) → 파생 12개 |
| 컬러 래스터 (PNG) | 무술 10 + AI기능 29 + 업적 15 + 랭크 7 + 빈화면 13 + 커버 12 + 복습 5 + 코치 2 + 아바타 4 + 플레이스홀더 4 + 체육관 2 + 촬영가이드 3 = **106장** |
| 단색 SVG 아이콘 | 컨트롤 24 + 섹션헤더 38 + 상태 5 + 훈련소스 12 + 파이터프로필 8 ≈ **87종** (중복 제거 후 실제 60~70종) |
| 확장 대비 선제작 | 래스터 5 + SVG 12 |

---

## 4. 교체 작업 시 참고 (코드 측)

이모지가 **데이터 필드 문자열**로 들어가 있는 곳은 이미지 교체 시 타입 변경이 필요합니다.

- `AiFeature.icon: string` — `src/lib/aiCoach/aiFeatureCatalog.ts:27`
- `AchievementDef.icon: string` — `src/lib/achievements/definitions.ts:5`
- `Curriculum.coverIcon?: string` — `src/lib/curriculum/types.ts:116` (**Supabase `cover_icon` 컬럼에 저장됨** → 기존 데이터 마이그레이션 필요)
- `MarketplaceListing.coverIcon: string | null` — `src/lib/marketplace/types.ts:23` (동일)
- `SOURCE_ICON: Record<TrainingSource, string>` — `src/components/TrainingEntryRow.tsx:10`
- `MASTERY_ICON` / `REVIEW_TIER_ICON` / `VERDICT_ICON` / `LOCATION_ICON` — `skillProgress/types.ts`, `reviewSystem/types.ts`, `formCompare/FormCompareModal.tsx:23`, `aiCoachCurriculum/location.ts:5`
- `EmptyState({ icon = '🥋' })` — `src/components/EmptyState.tsx:1` (79곳 호출부 전체 영향)

권장: 파일명 대신 **icon key**(`'boxing'`, `'first-technique-learned'`)를 저장하고, `src/assets/iconMap.ts` 같은 단일 매핑 모듈에서 실제 에셋으로 해석하는 구조. 그래야 DB에 저장된 기존 값(이모지)도 fallback으로 계속 렌더됩니다.
