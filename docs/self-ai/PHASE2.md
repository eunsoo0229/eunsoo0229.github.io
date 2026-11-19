# 자체 AI 2차 품질 개선 — 단계별 기록

브랜치 `ai/self-hosted-overhaul` (개발용 복제본만). 원본·백업 미수정. 기준선 실패 3건(`test-ai-feature-catalog` 7/8, `test-coach-eval100` 100/101, `test-coach-validation` 56/57)은 개편 전부터 있던 것으로 별도 유지.

문제 분류: **A** 코드·시스템 오류 / **B** 내부 DB·검색 자료 부족 / **C** Qwen 모델 자체 한계.

## Phase A — 조사와 재현

재현 도구: `.devtools/qa-self-ai-six.mjs` (실제 Electron 렌더러 + 실제 IPC·SearXNG·Ollama, 숨김·음소거, 단계별 시간 측정). 기준선 결과: `data/audit/self-ai/six-tests-baseline.json`.

| 테스트 | 증상 | 측정 | 원인 | 분류 |
|---|---|---|---|---|
| A 암바 설명 | 핵심 포인트·실수·설명이 두 번씩 | 6.1s (데이터 답변 2.6s, 모델 호출 없음) | 질문 항목마다 따로 쓰고, "방법"(대응 방법)을 수행 방법으로 읽어 howTo가 개요·핵심·실수를 다시 붙임. "원리"는 어떤 항목에도 연결 안 됨. 설명 후보 중 "십자 굳히기 --- …" 같은 별칭 조각도 그대로 사용 | A |
| B 그래플링 논문 | "찾지 못했습니다" | 7.1s (검색 3.7s) | 한국어 문장 + 쓰레기 영어 질의("찾아 제목 연도 … 정리해 study")만 보냄 → Crossref가 한국어 교육학 논문 65건 반환 → 관련성 필터가 57건 제거 → 0건. 영어 주제 질의 "grappling sports science"는 98건, 1위가 관련 논문(직접 확인). 0건과 "걸러짐"을 구분하지 않음. SearXNG가 주는 doi·authors·journal을 버림 | A |
| C 싱글렉 영상 | 제목 목록만, 5분 | 3.4s (검색 1.9s) — 이 측정에서는 5분 재현 안 됨 | 영상 카드·앱 내 재생 없음. "레슬링"을 무시하고 삼보 Single Leg로 해석. 질의에 "highlights"(교육 영상 요청인데) | A |
| D 싱글렉 수업 | 반복·무의미 | 111s (모델 107s, 첫 토큰 69s) | "레슬링" 무시 → 삼보 `sambo__single-leg`(설명·단계·핵심 포인트 전부 없음) + 가라테 Choku-zuki 선택. 수업 엔진이 빈 기록을 "X은 {분류} 분류의 기술입니다"로 채우고 단계마다 반복, 복습은 `핵심은 ""입니다`. 수업 전 품질 검사 없음. 대화 답변은 모델이 69초 뒤 막연한 문장 생성 | A + B(레슬링 Single Leg 기록 자체가 없음) + C(속도) |
| E 수업 중 방어 대응 | 관련 기술 목록만 | — | "찾아서 설명해 줘"를 검색 요청으로 보지 않음 → 수업 엔진의 데이터 답변 → 수업 기술(삼보 빈 기록)의 related 목록 | A + B |
| F 맥그리거 분석 | "논문을 찾지 못했습니다" | 10.5s | `PAPER` 정규식에 "근거 자료" 포함, 논문이 선수보다 먼저 판정 → 논문 검색. 선수 이름 영어 변환 없음 | A |

DB 현황(앱이 실제로 쓰는 통합 기술 1,138개): 설명(description) 빈 기록 756개, 핵심 포인트 없음 149개. 레슬링 175개 중 description 있는 것 4개(대부분 posture 쪽에 자료). 레슬링 "Single Leg" 테이크다운 자체 기록 없음 — `Single-Leg Position`, `Single-Leg Down Defense`만 자료 있음. 암바의 `purpose`는 클로즈드 가드 설명(기술명 불일치) → 기존 genericTexts 필터가 걸러냄.

## Phase B — 수업 생성 품질·반복 방지

수정 파일:
- `src/lib/coachLesson/lessonQuality.ts` (신규, 순수) — 같은 문장 반복, 유사 문장 반복(한국어 어미 차이 허용), 무의미 문장(분류 이름뿐인 문장, "---" 조각), 빈 인용 `""`, 너무 짧은 내용, 다른 기술의 정의를 설명으로 쓰는 경우 감지. `restate` 옵션: 일부러 다시 말하는 줄(정리하면/복습)만 반복 허용.
- `src/lib/coachLesson/lessonReadiness.ts` (신규) — 기록이 수업 가능한지(ready/thin/insufficient)와 없는 항목. 전체 DB: ready 989, insufficient 149.
- `src/lib/coachLesson/concepts.ts` — 분류 공통 문단·의미 없는 purpose/description을 기술 설명으로 쓰지 않음(genericTexts는 호출자가 전달 — 엔진 테스트 번들이 데이터 없이 돌도록). 재설명 변형 중 앞 내용을 반복하는 것 제거. 리드 문장("동작 순서로 보면 이 부분입니다.")을 내용 문장과 합침. 포지션의 "---" 정리.
- `src/lib/coachLesson/engine.ts` — 핵심 포인트가 없을 때 `핵심은 ""입니다` 대신 그 줄을 생략. 피드백 문구를 판정별 3개 중 차례로 사용(같은 문구 연속 반복 방지).
- `src/lib/coachLesson/service.ts`, `oneOff.ts` — genericTexts 전달.
- `src/lib/selfAi/lessonPlanner.ts` (신규) — "…배우고 싶어"를 코드가 계획: 질문의 무술 사용, 빈 기록은 같은 무술의 같은 이름 계열 기록으로(다른 무술로 대체하지 않음, 그 사실을 표시), 선행→핵심→응용(기술 그래프의 실제 연결), 기록된 셋업·콤보, 사용 상황, 카운터·탈출, 자료 부족 명시.
- `src/lib/selfAi/coachAgent.ts` — 수업 요청 답변 = 계획(코드 작성, 모델 호출 없음).
- `src/lib/selfAi/chatLesson.ts` — 수업 가능 기록만 수업에 넣음, 없으면 "자료 부족"으로 거절.
- `src/lib/coachKnowledge/answerability.ts` — 여러 항목 질문은 구역별 답변(■ 기술 설명/원리/수행 방법/핵심 포인트/흔한 실수와 대응), 자료 문장 1회만, 설명은 가장 적합한 1개. "원리", "실수 대응" 항목 추가. 대응은 "자료 항목이 아니라 같은 기술의 핵심 포인트를 짝지은 것"이라고 명시.

테스트: `.devtools/test-lesson-quality.mjs` 30/30 — 텍스트 검사 8, 준비도 3, 테스트 D 계획·실제 수업 진행(정답/모르겠어 두 경로) 10, 테스트 A 5, DB 기록 60개 표본 수업 전체 진행 시 반복·빈 인용·무의미 문장 0. 기존 수업·코치 테스트 전부 유지(기준선 실패 2건 동일 항목).

남은 것: 레슬링 "Single Leg" 테이크다운 기록 자체는 DB에 없음(B) — 계획은 있는 기록(Single-Leg Position/Down Defense)으로 만들고 그 사실을 표시.

## Phase C — 질문 의도 분류·도구 선택

수정 파일:
- `src/lib/selfAi/router.ts` (재작성) — 의도 15종(일반 대화·동기부여·기술 설명·기술 비교·셋업/콤보 연구·선수 분석·영상·논문·실시간 웹·커리큘럼·수업 시작·수업 중 질문·수업 추가·훈련·기타). 도구를 코드가 `tools`로 명시(db / web_search / video_search / paper_search / fighter_research / lesson_plan / lesson_engine / curriculum_builder). 판정 순서: 인사 → 수업 추가 → 영상 → **선수 분석 → 논문**(근거 자료는 논문 아님) → 수업 중 질문 → 커리큘럼 → 수업 → … 질문에 쓴 무술을 우선 사용. 선수 이름 추출. "최근" 표시(`recent`). 검색어: 요청어(제목·연도·원문·링크·정리·찾아…) 제거, 한→영 용어 사전, 번역 안 되는 주제어(선수 이름)는 영어 질의에도 유지, 논문은 영어 주제 질의 우선, 교육 영상은 tutorial/강좌.
- `src/lib/selfAi/coachAgent.ts` — 비교 질문도 데이터 엔진, 커리큘럼 요청은 기존 "AI 맞춤 커리큘럼" 화면으로 요청을 넘김(버튼), 메시지에 선택한 도구 기록.
- `src/lib/selfAi/types.ts`, `src/pages/CoachChat.tsx` — `action` 버튼, `tools`.

테스트: `.devtools/test-intent-routing.mjs` 48/48 — 32개 문장 분류(6개 사용자 테스트 포함), 테스트별 검색어 품질, 실제로 호출된 도구(가짜 검색·모델로 기록).

## Phase D — 논문 검색·영상 앱 내 재생

조사 결과(테스트 B): Crossref 등 학술 엔진은 실제로 실행됐지만(65건) 질의가 한국어 문장이라 한국어 교육학 논문만 반환 → 관련성 필터가 전부 제거. 추가로 발견한 결함 2개: ① 관련성 하한이 질의의 분야어("sports", "science")까지 세어, 그래플링 부상 논문은 "science"가 없어 떨어지고 수면 연구는 "스포츠 과학"으로 통과 ② 중복 제거(`core.cjs dedupResults`)가 결과를 다시 만들면서 저자·학술지·DOI·채널·길이를 버림(실측에서 저자·학술지가 비어 있던 원인).

수정 파일:
- `electron/selfSearch/searxng.cjs` — 엔진이 주는 author/length/doi/authors/journal/publisher/pdf_url 보존.
- `electron/selfSearch/core.cjs` — 중복 제거 시 위 필드 유지·병합.
- `electron/selfSearch/media.cjs` (신규) — YouTube id, 임베드 허용 여부(YouTube 공개 oEmbed: 200 재생 가능 / 401·403 소유자가 막음 / 404·400 삭제·비공개), DOI 정규화·doi.org 등록 확인. 정책 우회 없음.
- `electron/selfSearch/index.cjs` — 질의 병렬 실행(느린 엔진 시간 초과가 질의마다 더해지던 것), 논문은 주제어 기준 관련성, 같은 DOI = 같은 논문, `recent`면 최신순(날짜 추정 없음), 제외된 결과 제목 기록, 결과에 `video`/`paper` 정보.
- `src/lib/selfResearch/types.ts`, `provider.ts` — VideoInfo/PaperInfo, 같은 검색 10분 캐시(같은 영상 반복 검색 방지).
- `src/lib/selfAi/coachAgent.ts`, `types.ts` — 논문 답변: 제목·연도·저자·학술지·DOI(확인 여부)·색인 초록 일부·확인 수준·신뢰도, "본문은 읽지 않음" 명시. 영상 답변: 재생 가능 수, 채널·길이, 재생 불가 사유. 0건일 때 "엔진 결과 0건"과 "N건 찾았지만 주제와 맞지 않아 제외(예: …)"를 구분.
- `src/components/video/VideoResultCards.tsx` (신규) + `global.css` — 썸네일(CSP 허용 i.ytimg.com만)·제목·채널·게시일·길이·원본 링크·상태 배지, 누르면 목록 위 앱 내 플레이어(YouTube embed), 재생 불가/미지원은 원본 링크, 영상 id 기준 중복 제거, 모바일 2열. 다른 화면(수업·커리큘럼·기술 상세)에서 `videos` 배열만 넘기면 재사용 가능.
- `src/pages/CoachChat.tsx` — 영상 결과는 카드로, 논문 출처에 DOI 링크.

실측(라이브 SearXNG): 논문 "sports science grappling" 5.0s → 6건 모두 DOI doi.org 등록 확인, 저자·학술지·초록 표시. 영상 "레슬링 싱글렉 강좌"+"single leg wrestling tutorial" 2.3–2.5s(임베드 확인 포함) → 8건 모두 앱에서 재생 가능.

테스트: `.devtools/test-paper-video.mjs` 24/24 (가짜 네트워크: doi.org·oEmbed 응답 고정). `test-self-search` 29/29 유지.

## Phase E — 수업 중 질문·선수 분석

### 수업 중 질문 (테스트 E)
원인: "찾아서 설명해 줘"가 검색 요청으로 분류되지 않아 수업 엔진의 데이터 답변 → 수업 기술(당시 삼보 빈 기록)의 관련 기술 목록만 출력. 대화 코치에 지금 배우는 기술이 전달되지 않음.

수정:
- `src/lib/selfAi/lessonQuestion.ts` (신규) — 지금 배우는 기술 기준: ① MARTIALDEX 기록(코드 작성): 기록된 전환(Armbar → Triangle), 기술 그래프의 다음·연결·카운터·탈출, 기록 문장 중 상대의 반응을 다룬 문장("상대가 다리를 회수함"), 없으면 "없음"(관련 기술 묶음을 대응으로 쓰지 않음) ② 그 기술의 영어 이름 + 무술 + "when opponent defends counter" 검색 ③ 모델은 검색 자료만 3~4문장 요약, [n] 인용, 320토큰.
- `src/lib/selfAi/coachAgent.ts` — `lessonTechniqueId` 입력, 수업 중 질문 흐름, 끝에 "수업은 하던 단계에서 그대로 이어집니다".
- `src/pages/CurriculumCoachSession.tsx` — 현재 기술 id 전달(수업 상태는 기존처럼 건드리지 않음).

### 선수 분석 (테스트 F)
원인: 논문으로 잘못 라우팅(Phase C에서 수정) + 한글 이름 그대로 검색 + 3B 모델 추출이 0건(이전 라이브).

수정:
- `electron/selfSearch/entity.cjs` (신규) + IPC `research:entity` — 위키백과 한국어 문서의 영어 문서 연결로 영문 이름 확인("코너 맥그리거" → Conor McGregor, 실측 0.7–2.2s). 문서 없으면 실패 사유를 그대로 표시(추측 안 함).
- `src/lib/fighterStyle/ruleExtract.ts` (신규) — 모델 없이 원문 문장에서 MARTIALDEX 기술 이름 탐지(타격/그래플링 무술 범위), 문장 전체를 인용으로: 콤비네이션(순서어), 셋업, 카운터, 거리·스탠스, 주요 기술. 일반 동사("evade", "turn")·상대의 동작("opponent … slip")·선수 이름 없는 페이지 제외.
- `src/lib/fighterStyle/evidenceStyle.ts` — 규칙 추출 항상 실행, 모델 추출은 옵션(기존 패널은 기존대로 모델 사용), 웹·영상·인덱스 병렬, 결과에 원 검색 결과 포함. 4단계 근거 구분 유지.
- `src/lib/selfAi/fighterReport.ts` (신규) — 근거 수준별(여러 자료 공통 / 출처 1곳 / AI 추론 / 확인 못함) 코드 작성 보고서, 사이트가 다른 인용 우선, 요청 항목(셋업·콤비네이션·카운터)별 "N건 / 확인 못함", 영상은 카드(내용 미확인), 한계.
- `coachAgent.ts`·`deps.ts`·`types.ts`·`CoachChat.tsx` — 선수 분석 경로, `videos` 카드.

실측(라이브, Node 하네스로 같은 코드): McGregor 5–6s, 본문 읽은 자료 5곳 → 여러 자료 공통: Cross(evolve-mma, mmamania), 스탠스 / 출처 1곳: Lead Hook, Front Kick, Side Kick, Low Kick 등 원문 인용. 남은 오인식: 대명사("him")가 상대를 가리키는 문장의 기술(예: Slip) — 보고서 한계에 명시.

테스트: `.devtools/test-lesson-question-fighter.mjs` 30/30. `test-self-coach-agent` A13은 문구 변경("영상 내용 자체는 확인하지 않았습니다")만 반영, 검사 내용 동일.

## Phase F — Qwen(qwen2.5:3b) 유지·성능 개선

모델은 교체하지 않음. 측정 기준: 이 Mac(Intel i5-7600K, 8GB, CPU 전용), 프롬프트 읽기 약 40–60 tok/s, 생성 약 5–9 tok/s → **첫 토큰 시간은 프롬프트 길이, 총 시간은 출력 길이**가 좌우(C). 시스템 쪽 원인(A)은 큰 프롬프트와 사실을 모델이 자유 작성하던 경로.

수정:
- `src/lib/selfAi/sourceFocus.ts` (신규) — 검색 자료 중 질문 관련 문장만 모델에 전달. 수업 중 질문 요약은 실제로 읽은 본문만(검색 요약만 있으면 모델 호출 안 하고 이유 표시).
- `src/lib/selfAi/sequenceReport.ts` (신규) — 셋업·콤보 연구는 코드 작성(MARTIALDEX 기록 + 자료 원문 문장의 콤비네이션). 모델 자유 생성 제거.
- `coachAgent.ts` — 대화 기록 4턴·500자, 학습자 기록은 동기부여·훈련 질문만(600자), 출력 450토큰, 모델 출력의 반복 문장 제거 + 안내.
- `electron/selfAi.cjs` — 자유 텍스트에만 `repeat_penalty 1.1 / repeat_last_n 256`. JSON 추출에는 적용 안 함(아래 측정).
- `.devtools/bench-local-models.mjs` — 인용 정확도(cite-two-sources)·문장 반복(repeat-combos) 과제, `REPEAT_PENALTY` 옵션.
- `.devtools/qa-self-ai-six.mjs` — 모델 사용 턴(인사·동기부여·콤보 연구·수업 중 질문)과 프롬프트 크기·첫 토큰·출력 토큰·메모리 측정.

벤치마크 round 3 (`data/audit/self-ai/local-models-round3-*.json`, 과제별 1회, temperature 0.2 — 표본이 작아 경향만):

| | qwen 기본 | qwen + penalty 1.1 | gemma3:4b + penalty |
|---|---|---|---|
| 문장 반복 | 반복 4 ✗ | 0 ✓ | 0 ✓ |
| 출처 번호 인용 | 0/2 ✗ | 2/2, 오인용 0 ✓ | ✓ |
| JSON 원문 인용 | 4/4 ✓ | **0/3 ✗** | 4/4 ✓ |
| 한국어 설명 | ✓ | 한자 섞임 ✗ | ✓ |
| 자료 없는 사실 질문 5개 | 0/5 | 0/5 | 0/5 |
| 속도·메모리 | 7.7 tok/s · 2.07GB | 9.1 tok/s | 7.1 tok/s · 2.76GB · 로딩 43s |

→ penalty는 반복·인용에 도움, 원문 그대로 복사(JSON 인용)에는 해로움 → 자유 텍스트에만 적용. 세 설정 모두 격투기 사실 문제 0/5 → "사실은 DB·원문에서만" 설계 유지 근거.

실측 전후(`six-tests-before-F.json` → `after-F*.json`, `final.json`, 실제 Electron 렌더러):

| 턴 | 전 | 후 |
|---|---|---|
| G 인사 | 12.0s (프롬프트 816자) | 2.9–10.0s (473자; 첫 토큰 차이는 모델 재로딩 여부) |
| E 수업 중 질문 | 48.9s (모델이 "못 찾음") | 6.4–20.1s (읽은 본문 없으면 모델 생략·이유 표시) |
| I 콤보 연구 | 138s, 같은 문장 반복·잘못된 기술 설명 | 2.4–3.9s, MARTIALDEX 기록 6건(Catch → Jab, Jab → Cross 등) |
| H 동기부여 | 16.1s | 16.0–22.6s (출력 78–128토큰 — 생성 속도 한계) |
| 메모리 | qwen2.5:3b 2.17GB (Ollama ps) | 동일 |

## Phase G — 전체 회귀·실제 Electron 화면 검증

자동 테스트(오프라인, 개발용 복제본):
- 신규: test-lesson-quality 31/31, test-intent-routing 48/48, test-paper-video 24/24, test-lesson-question-fighter 32/32.
- 기존 자체 AI: test-self-search 29/29, test-martialdex-knowledge 29/29, test-self-coach-agent 31/31(라우팅 변경으로 질문 문장 1개·문구 1개 갱신, 검사 내용 유지 + 동기부여 검사 1개 추가), test-self-ai-lesson-style 23/23, test-electron-runtime-requires 3/3.
- 기존 앱 테스트 전부 통과, **기준선 실패 3건 동일**(ai-feature-catalog 7/8, coach-eval100 100/101, coach-validation 56/57).
- 제외: test-detail/search/videos/youtube(원본 저장소 경로 고정 — 실행 안 함), *-sql/*-live(실서버), test-local-model-bridge(사용자 Ollama 실행 중이라 SKIP).
- `tsc` 통과, `vite build` 통과.

실제 앱 화면(숨김·음소거 Electron, 별도 프로필, 사용자처럼 입력·클릭) — `.devtools/qa-self-ai-chat.mjs` 24/24:
영상 카드·썸네일·앱 내 플레이어(YouTube 플레이어 안에 video 요소 로드, 오류 없음)·원본 링크·모바일 380px 2열 / 논문 목록·DOI 링크 / 암바 구역별 답변 / 맥그리거 분석 / 커리큘럼 화면 연결 / 수업 계획 → 수업 시작 → 수업 엔진 / 수업 중 질문 후 단계·진행·결과·엔진 상태 동일 / 수업 중 추가 / SearXNG 끊김 → 실패 안내·상태 갱신 → 복구 / Ollama 끊김 → 로컬 AI 사용 불가 안내(다른 모델 대체 없음) → 복구 / 페이지 에러 0. 끊김은 사용자 서버 앞의 로컬 프록시를 끄고 켜서 재현(사용자 Ollama·SearXNG는 건드리지 않음).
UI 시간(보내기 → 표시): 영상 5.3s, 논문 9.3–15.3s, 기술 5.2s, 선수 9.6s, 수업 계획 5.8s, 수업 중 질문 7.6s, 검색 끊김 안내 0.6s, 모델 끊김 안내 1.0s.
`qa-electron-selfai-launch` 14/14.

영상 5분: 이번 측정(검색 1.9–2.5s, 임베드 확인 포함 UI 5.3s)에서는 재현되지 않음. 당시 원인은 확인하지 못함 — 측정 도구(qa-self-ai-six, qa-self-ai-chat)가 단계별 시간을 남기므로 재발 시 구간을 바로 확인 가능.

## 남은 문제 (2차 이후)
- **B 자료 부족**: 레슬링 "Single Leg" 테이크다운 기록 없음, 기술 1,138개 중 description 빈 기록 756개·수업 불가 149개. 수업 중 질문의 웹 자료는 영상·robots 차단으로 본문을 못 읽는 경우가 많음.
- **규칙 기반 선수 분석의 한계**: 대명사가 상대를 가리키는 문장 일부 오인식, 셋업·콤비네이션 문장이 적으면 "확인 못함". 모델 추출은 옵션(느림).
- **C 모델 한계**: 생성 5–9 tok/s → 모델이 쓰는 대화(동기부여 등)는 15–25s. 자료 없는 사실 질문은 세 모델 모두 0/5.
- 수업 화면 안 답변은 텍스트만(영상 카드 미표시). Android/웹은 자체 검색·로컬 모델 없음(미지원 안내만) — Edge Function 연결은 승인 필요.
