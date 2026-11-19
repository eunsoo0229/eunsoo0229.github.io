# 자체 AI 3차 통합 개선 — 단계별 기록

브랜치 `ai/self-hosted-overhaul` (개발용 복제본만). 원본·백업 미수정. 기준선 실패 3건(`test-ai-feature-catalog` 7/8, `test-coach-eval100` 100/101, `test-coach-validation` 56/57)은 별도 유지.

## Phase A — 전체 구조·데이터 조사

### 기존 문서와 구현 대조
ARCHITECTURE.md·PROGRESS.md·PHASE2.md의 모듈(router, coachAgent, lessonQuestion, sourceFocus, sequenceReport, fighterReport, ruleExtract, media.cjs, entity.cjs, VideoResultCards)이 모두 코드에 있고 문서 설명과 일치함을 확인. 문서와 다른 점: 없음. 2차 보고의 "레슬링 Single Leg 기록 없음"은 **부정확**했음(아래).

### DB 감사 (`.devtools/audit-technique-db.mjs` → `data/audit/knowledge-db/audit.json`)
앱이 실제로 쓰는 통합 기술 1,138개(공식). "해당 없음"(자세·그립 같은 포지션 기록의 셋업·콤보·카운터)은 누락으로 세지 않음.

| 항목 | 비어 있음 | 비고 |
|---|---|---|
| 한국어 이름(기록) | 835 (73.4%) | 기록 자체 자료(자세 개요)에서 찾을 수 있는 이름까지 포함하면 342 (30.1%) |
| description | 756 (66.4%) | **그중 641개는 자세 개요(posture.overview)가 있음** — 설명 자료가 없는 것은 115개, 그중 110개는 관계 감사에서 분리 생성된 기록 |
| 하위 분류(positions) | 905 (79.5%) | 원본 백과사전 `###` 소제목이 반영되지 않음 |
| 자세 개요·단계·핵심 포인트·실수 | 148–149 (13%) | 131개가 분리 생성 기록, 18개는 기술이 아닌 항목(품새·규칙·개념) |
| 난이도 | 134 (11.8%) | |
| 선수 지식(그래프) | 1,100 (96.7%) | |
| 셋업 | 720/720 동작 기록 | DB 콤보 기록은 콤보만 있음 |
| 콤보 | 666/720 | |
| 연결(전환·다음) | 712 (62.6%) | |
| 카운터·방어 | 706/720 | |
| 영상 | 970 (85.2%) | |
| 출처·검증 상태 | 1,138 (100%) | 공식 기록에 필드 자체가 없음 |

중복: 같은 무술 안 같은 이름 2건(무에타이 "스피닝 기술" 한국어 이름을 두 기록이 공유, 삼보 "counter" 이름 조각), 무술 간 같은 이름인데 연결 안 된 7건(Back Step, Bridge, Hand Fighting, Square Stance, 거리 관리, Collar Choke, Grip Fighting) — 자동 병합하지 않고 후보로 보고. 분류 오류·존재하지 않는 관계 ID: 0건.

### 레슬링 Single Leg — 2차 보고 정정
DB에 이미 **"싱글 레그" 분류 18개 기록**(High Single, High Crotch, Low Single, Outside/Inside Single, Sweep/Snatch Single, Near/Far Ankle, Running the Pipe, Knee Tap from Single, Crackdown Position, Back Trip, Lift and Return, Cutback, Switch-Off, Single to Double, Single to Back Take)과 Single-Leg Position, Single-Leg Down Defense, Re-Single, Sit-Out to Single, Front Headlock to Single, Single Ankle Pick이 있고 전부 자세 자료가 있음. 2차에서 "싱글렉"이 이 기록들로 연결되지 않은 원인은 **레슬링 기록 175개 중 174개에 한국어 이름이 없고, "싱글 레그"라는 계열(분류) 자체를 가리키는 이름·기록이 없기 때문**(A + B). 원본 백과사전 §4·§15·§17·§18에 계열 설명·상대 반응별 전환이 있음(내부 자료).

### 수업 중 자유 질문 구조
`CurriculumCoachSession.handleUserText`: 대화 코치(`runCoachTurn`)로 가는 것은 `isLessonSideRequest`(검색·추가 요청)뿐이고 나머지 질문은 수업 엔진 데이터 답변. 수업 맥락은 현재 기술 id만 전달(무술·단계·배운/배울 기술·목표·이전 질문 없음). 답변은 텍스트 한 덩어리(출처를 문자열로 붙임, 영상 카드 없음). "수업에 추가"는 확인 없이 즉시 추가.

### 서버 구조
`electron/selfAi.cjs`, `electron/selfSearch/*`는 Electron API를 쓰지 않는 순수 Node 모듈 → 독립 HTTP 서버에서 그대로 재사용 가능. 렌더러는 `window.martialdex.selfAi/research`에 직접 의존(4곳). Edge Function `web-search`는 Tavily.

환경: Intel i5-7600K 4코어, RAM 8GB, GPU 없음. Android SDK와 AVD `Pixel_3a_API_33_x86_64` 있음(헤드리스 실행 가능).

### 수정 계획
- B: 설명 후보 저장소(공식 DB와 분리, 출처·검증 상태), 계열(기술 패밀리)·하위 분류 구조와 검사기, 레슬링 싱글 레그 계열(내부 백과사전 근거) + 한국어 이름, 근거 있는 연결 관계만.
- C: 수업 중 입력 분류(수업 답변 vs 자유 질문), 수업 맥락 전체 전달, 대화 코치와 같은 도구, 상태 불변 검사, 추가는 제안 → 동의 후.
- D: 수업 메시지에 영상 카드·출처 구조화.
- E: 공통 자체 AI 서버(Node, 인증 토큰, 사용자별 세션, 모델 요청 대기열) + 렌더러 전송 계층(Electron IPC / 서버 HTTP).
- F: 문장 주어·행동 주체 판별.
- G: 전체 회귀·화면·Android(에뮬레이터)·웹.

## Phase B — 지식 DB 개선

원칙: 공식 DB(`data/processed`, 기존 `data/curated`)는 수정하지 않음. 새 자료는 **후보**(`data/curated/knowledge-candidates.json`)로만 만들고, 사람이 승인한 것(`data/curated/knowledge-review.json`)만 앱이 반영. 승인은 0건(사용자 결정 사항).

수정·추가 파일:
- `src/lib/knowledgeBase/types.ts` — 후보 종류(설명·한국어 이름·관계·하위 분류·새 기술), 6단계 상태(검증 완료/복수 자료 확인/단일 자료 확인/검토 필요/자료 부족/설명 생성 불가), 출처(내부 백과사전·내부 자세 자료·웹 본문).
- `src/lib/knowledgeBase/validate.ts` — 자동 검사: 중복 기술명(영·한·별칭), 다른 무술 오분류, 상위 분류 누락, 같은 이름 분류 중복, 하위 분류에 다른 분류 기록, 없는 연결 대상, 자기 연결, 빈 설명, 출처 누락, 상태 누락, 출처 수와 맞지 않는 상태, 스크립트가 만든 "검증 완료".
- `src/lib/knowledgeBase/encyclopedia.ts` — 원본 백과사전(data/raw)에서 파서가 버린 소제목·분류 문단·흐름도(→) 해석.
- `scripts/build-knowledge-curation.mjs` — 분류 계층(`data/curated/category-hierarchy.json`: 9개 무술 상위 분류 155개, 하위 분류 89개, 기록 405개 배치, id 불변) + 후보 생성 + 검사.
- `scripts/verify-candidates-web.mjs` — 자체 검색(SearXNG)으로 외부 본문 대조. 코드가 확인할 수 있는 것(기술 이름이 그 무술 맥락의 본문에 나오는지)만 기록, 설명 내용 일치는 사람 판단으로 남김.
- `scripts/review-knowledge-candidates.mjs` — 사람 검토(list/show/approve/reject/stats). 검사 오류·자료 부족·생성 불가는 승인 불가.
- `src/lib/knowledgeBase/approved.ts`, `src/lib/loadData.ts`, `src/types.ts` — 승인된 설명·한국어 이름만, 비어 있는 칸에만 반영(공식 문장 덮어쓰기 없음), `curation`에 출처·검토자.
- `src/lib/knowledgeBase/topics.ts` — 질문의 기술 계열(공식 분류) 인식: "싱글렉"→"싱글 레그"(렉/레그·띄어쓰기 차이), 일반어(방어·손기술 등 4자 미만) 제외.
- `src/lib/selfAi/lessonPlanner.ts` — 계열 수업: 계열 설명(백과사전 인용) → 선행 자세 → 쉬운 핵심 기술 → 전환 → 방어, 나머지 기록은 "이어서 배울 기록".
- `src/lib/selfAi/familyAnswer.ts`, `coachAgent.ts` — "레슬링 싱글렉이 뭐야?" → 계열 답변(코드 작성).

결과:
| 후보 | 수 | 상태 |
|---|---|---|
| 설명(빈 description 756개 전부) | 756 | 단일 자료 확인 486 · 검토 필요 243 · 자료 부족 22 · 설명 생성 불가 5 |
| 한국어 이름 | 481 | 단일 자료 확인(자세 자료가 부르는 이름) |
| 흐름도 연결 관계 | 67 | 단일 자료 확인(백과사전 흐름도), 그중 8개는 이미 기술 그래프에 있음 |
| 싱글 레그 하위 분류 | 3 | 검토 필요(분류 판단) |
| 새 기술 Single Leg Takedown | 1 | 복수 자료 확인 — 내부 백과사전 §4 + 외부 본문(fightscience.com) |

설명 후보 문장은 출처 문장을 그대로 옮긴 것(새로 쓴 문장 0). 외부 대조: 싱글 레그 계열 12개 실행 — 기술 이름이 외부 본문에 나온 곳 0–2곳, 설명 상태는 올리지 않음. 흐름도에서 기록으로 확정 못 한 이름 157개(예: "Single / Double", "Top Control")는 연결을 만들지 않음. 무술 간 같은 이름 7건은 자동 병합하지 않음.

레슬링 싱글 레그: 공식 18개 기록 + 다른 분류의 관련 기록(Single-Leg Position, Single-Leg Down Defense, Re-Single 등)으로 수업 계획: Single-Leg Position → High Single → High Crotch → Single to Double, 상대 대응 Single-Leg Down Defense, 나머지 15개 "이어서 배울 기록".

테스트: `.devtools/test-knowledge-db.mjs` 38/38 (빈 설명 조사 5, 중복 3, 분류 관계 4, 하위 분류 추가 5, 싱글 레그 8, 관계 4, 출처·상태 4, 승인 흐름 4(임시 검토 파일), 대화 1). 관련 회귀: test-lesson-quality 35/35(D2 기준을 "그 무술에 연결된 기록"으로 — BJJ와 병합된 레슬링 High Crotch), test-intent-routing 48/48, test-self-coach-agent 31/31, test-lesson-question-fighter 32/32, test-martialdex-knowledge 29/29, test-self-ai-lesson-style 23/23, test-paper-video 24/24, tsc 통과.

미완료: 후보 승인(사용자 검토 필요), 외부 대조는 싱글 레그 계열만 실행(전체 756개는 검색 엔진 부하 때문에 일괄 실행하지 않음 — 같은 스크립트로 접두어별 실행 가능).

## Phase C — 수업 중 자유 질문

구조: **수업 엔진은 상태(단계·대기 질문·이해도·진도·결과)를 소유**, 질문 처리는 그 상태를 읽기만 함. 수업 화면은 질문과 답변을 대화 기록에 덧붙일 뿐이고, 기술 추가는 제안 → 학습자 동의 → 수업 끝에 추가.

수정·추가 파일:
- `src/lib/selfAi/lessonSession.ts` (신규) — 수업 스냅숏(무술·주제·학습 목표·현재 기술·단계·배운/배울 기술·대기 질문·이전 질문 3개·이해도), 프롬프트용 수업 맥락, 입력 분기(`routeLessonInput`: 수업 엔진의 기존 의도 분류기 재사용 — 답변·모르겠어요·다시 설명·준비됐어는 엔진, 질문·검색·추가 요청은 코치), `lessonStateKey`(메시지 외 전체 상태 — 질문 전후 비교용), 추가 제안(방어·대응 / 연결 기술 / 선수 콤보 — 기록된 연결만, 근거 포함), 동의 해석.
- `src/lib/selfAi/lessonAnswers.ts` (신규) — 기록으로 바로 답하는 질문: 선행 지식(기술 그래프 선행 + 같은 계열 시작 자세), 연결 기술(다음·카운터·탈출·셋업·콤보·같은 분류), 복습(배운 기술의 핵심 포인트 + 엔진 판정, 진도 불변), 대상 없는 비교(같은 분류 후보 제시).
- `src/lib/selfAi/router.ts` — 수업 중 기술을 말하지 않은 질문("이 기술", "관련 영상")은 지금 기술 기준으로 검색·조회. 의도 추가: 선행 지식·연결 기술·복습. 수업 중 "…도 배우고 싶어" = 수업 추가 요청. 실제 활용 질문("선수들은 어떻게 활용해?") → 실전 활용 검색. "선수" 없이 사람 이름으로 시작하는 질문("코너 맥그리거는 어떤 콤보를 자주 써?")도 선수 분석.
- `src/lib/selfAi/coachAgent.ts` — `lesson` 스냅숏 입력, 수업 추가 제안(선수 콤보는 선수 분석 결과의 DB 기술만), 기록 답변 경로, 수업 중 일반 기술 질문은 데이터 엔진(원리·방법·실수)으로.
- `src/lib/selfAi/lessonQuestion.ts` — 실제 활용 질문 검색어.
- `src/lib/selfAi/chatLesson.ts` — `acceptLessonAddition`(동의한 제안만, 수업 끝에, Day 동기화).
- `src/lib/aiCoachDay/types.ts` — 수업 메시지에 선택 필드(side·sources·videos·model·proposal). 기존 저장 수업과 호환.
- `src/pages/CurriculumCoachSession.tsx`, `src/styles/global.css` — 자체 AI 코치 수업에서 질문은 대화 코치로(다른 코치의 기존 경로는 그대로), 답변 아래 출처 목록·영상 카드·추가 제안 버튼, "📍 수업 위치 … ↩ 수업 이어서 하기" 복귀 바, "이 수업에서 한 질문 n개" 기록, 진행 상태 표시, 모바일 버튼 전체 폭.

테스트: `.devtools/test-lesson-free-question.mjs` 27/27 — 실제 기술 DB·수업 엔진·세션 저장소(가짜 검색·모델): 3-1의 질문 10종 + 새 기술·선수·논문 질문의 도구 선택과 대상 기술, 질문마다 상태 동일, 12개 연속 질문 후 단계·위치·대기 질문·이해도·결과 동일, 질문·답변 기록 저장, 이후 수업 엔진 정상 진행, 검색 서버 꺼짐, 추가 제안(동의 전 불변, 동의 후 끝에 추가·기존 상태 불변, 거절, 선수 이름 없는 요청). 회귀: test-coach-* 15종 전부 기준선과 동일(eval100 100/101, validation 56/57), test-intent-routing 48/48, test-self-coach-agent 31/31, test-lesson-question-fighter 32/32, tsc 통과.
실제 화면 검증은 Phase D와 함께(수업 화면 영상 카드).

## Phase D — 수업 화면 영상 카드·앱 내 재생

수정·추가 파일:
- `src/pages/CurriculumCoachSession.tsx` — 수업 중 답변의 영상 결과를 공통 `VideoResultCards`로(썸네일·제목·채널·길이·게시일·재생 상태·앱 내 재생·원본 링크), 출처 목록(본문 확인 여부·신뢰도). 수업 고유 질문(복습·선행 지식·연결 기술)은 다른 화면으로 보내는 기능 바로가기보다 먼저 처리(복습 요청이 복습 화면 열기로 바뀌던 문제 — 실제 화면 테스트에서 발견).
- `src/components/video/SelfVideoSearch.tsx` (신규) — 기술 하나에 대한 "영상 더 찾기(자체 검색)" 버튼: 같은 검색·임베드 확인·카드. 누를 때만 검색(하루 계획 화면에서 기술마다 동시에 검색하지 않음). 자체 검색이 없는 기기에서는 그 이유 표시.
- `src/pages/TechniqueDetail.tsx`, `src/pages/CurriculumDayDetail.tsx` — 기존 큐레이션 영상(RelatedVideos)은 그대로 두고 아래에 `SelfVideoSearch` 추가.
- `src/lib/selfAi/router.ts`(`videoQueries` 공개), `coachAgent.ts`(`toSources` 공개) — 화면 간 같은 검색어·같은 카드 데이터.

공통 영상 카드 사용 화면: AI 코치와 대화하기, 수업 중 질문 답변(AI 코치와 수업하기), 기술 상세, 커리큘럼 Day(학습 자료). **기술 검색 결과 화면에는 넣지 않음**(검색 결과 목록마다 영상 검색이 붙으면 화면당 검색이 여러 번 실행됨 — 상세 화면에서 제공).

재생 정책: 임베드 허용(oEmbed 200)만 앱 내 재생, 금지(401/403)는 "외부 재생 불가 (소유자 설정)" + 원본, 삭제·비공개(404/400)는 "재생 불가" + 원본, 확인 못 함은 "재생 가능 여부 미확인". 우회 없음. 영상 검색·카드·재생은 수업 상태를 바꾸지 않음(화면 테스트로 확인).

실제 화면 테스트 `.devtools/qa-lesson-free-question.mjs` 18/18 (숨김·음소거 Electron, 실제 SearXNG·Ollama): 채팅에서 싱글렉 수업 시작 → 수업 중 질문 5종(원리·영상·상대 방어·선행 지식·복습) 각각 상태 동일 / 수업 중 영상 카드 / 앱 내 재생(YouTube 플레이어 안 video 요소, 오류 없음) / 두 번째 영상으로 전환(플레이어 1개, id 변경) / 임베드 금지·삭제 상태 표시(같은 렌더러에서 컴포넌트에 상태 데이터 주입 — 실제 검색에서 그런 영상이 나온다는 보장이 없어서) / 복귀 바·질문 기록 5개 / "수업 이어서 하기" / 추가 제안 → "수업에 추가" → 끝에만 추가(위치·단계·엔진 상태·결과 동일) / 질문 후 "모르겠어요" → 엔진 진행 / 모바일 380px(가로 스크롤 없음, 카드 1–2열) / 기술 상세 화면 영상 카드 / 페이지 에러 0.
UI 시간(보내기 → 표시): 원리 5.5s, 영상 5.1s, 상대 방어 6.6–47.0s(모델 요약·로딩 여부), 선행 4.5s, 복습 4.2s, 추가 제안 9.2s, 기술 상세 영상 4.0s.
수정: `.devtools/qa-self-ai-chat.mjs` E3 — 수업 중 추가가 즉시 추가에서 "제안 → 동의"로 바뀐 것을 반영(추가 전 불변 검사 추가).

## Phase E — 멀티플랫폼 자체 AI 서버

구조·보안·측정·공개 조건: [SERVER.md](SERVER.md). 요약: Android·웹은 모델과 검색을 직접 실행하지 않고 **MARTIALDEX 자체 AI 서버**(토큰 인증)를 통해 데스크톱과 같은 Qwen2.5:3B·SearXNG·본문 추출을 사용. AI 로직(의도·도구·DB 답변·수업 엔진·선수 분석)은 모든 플랫폼에서 같은 클라이언트 코드.

수정·추가 파일:
- `server/self-ai/server.cjs` (신규) — HTTP 서버: `/v1/health`(공개), `/v1/status`, `/v1/chat`(NDJSON 스트리밍: queued·started·waiting·delta·result), `/v1/chat/cancel`, `/v1/research/search`, `/v1/research/entity`. 기본 127.0.0.1(+::1)만 수신, CORS 허용 출처만, 256KB 제한, 모델 대기열(동시 1·사용자당 1·대기 한도), 사용자별 검색 한도, 사용자 이름공간 요청 id(남의 요청 취소 불가), 로그에 내용·토큰 없음.
- `server/self-ai/runners.cjs` (신규) — 모델 실행기 분리: Ollama(현재, `electron/selfAi.cjs` 재사용) / OpenAI 호환(llama.cpp `llama-server` 등).
- `server/self-ai/auth.cjs` (신규) — 사용자별 토큰 발급·폐기, SHA-256 해시만 저장(파일 권한 600, 저장소 밖), 상수 시간 비교.
- `src/lib/selfAi/transport.ts` (신규) — 플랫폼 공통 전송 계층(Electron IPC / 서버 / 없음). `selfResearch/provider.ts`, `selfAi/deps.ts`, `pages/CoachChat.tsx`가 이것을 사용(데스크톱 동작 동일).
- `src/components/coach/SelfAiServerSettings.tsx` (신규) + `CoachChat.tsx` — 서버 주소·토큰 입력, 연결 확인, 상태 줄("자체 AI 서버 · 로컬 AI … · 자체 검색 …"), 대기 순번·모델 준비 시간 표시.
- `vite.config.ts` — CSP `connect-src`에 루프백 8787과 빌드 시 지정한 HTTPS 주소(`VITE_SELF_AI_SERVER_ORIGIN`)만 추가(실제 브라우저 테스트에서 CSP 차단 발견).
- `android/app/src/main/res/xml/network_security_config.xml` (신규), `AndroidManifest.xml` — 평문 HTTP는 기기 자신의 localhost만(USB `adb reverse`·에뮬레이터), 나머지는 HTTPS만(에뮬레이터 테스트에서 `ERR_CLEARTEXT_NOT_PERMITTED` 발견).
- `supabase/functions/web-search/index.ts` — 비밀값 `SELF_AI_SERVER_URL`·`SELF_AI_SERVER_TOKEN`이 있으면 자체 검색으로, 없으면 기존 동작. **배포 안 함.**
- `src/lib/selfAi/types.ts` — 오류 코드 UNAUTHORIZED·BUSY.

테스트:
- 자동 `.devtools/test-self-ai-server.mjs` 25/25 (가짜 Ollama·SearXNG·llama.cpp — 사용자 서버 미접촉): 접근 제어, 토큰 해시 저장, 스트리밍, 두 사용자 대기열, 같은 사용자 중복, 대기열 가득, 취소 격리, 모델 로딩 대기 알림, 실행기 꺼짐→복구, 검색 형식·원문 URL 보존(실제 자체 검색 파이프라인), 이름 확인, 사용자별 검색 한도, CORS, 크기 제한, 로그 내용 없음, OpenAI 호환 실행기, 기본 바인딩 127.0.0.1(외부 주소 접속 불가), 클라이언트 전송 계층(미연결 UNSUPPORTED·연결 후 대화·검색·코치 한 턴·틀린 토큰·서버 꺼짐).
- **실제 웹 브라우저** `.devtools/qa-web-self-ai-server.mjs` 11/11 (헤드리스 Chrome, 실제 서버 → 사용자의 Ollama·SearXNG): 미연결 안내 → 틀린 토큰 거부 → 연결 → 영상 카드·앱 내 재생(video 요소 확인) → 기술 답변 → 모델 답변 → 서버 종료 안내 → 재시작 복구 → 두 번째 사용자(다른 프로필·토큰, 모바일 폭) 구분.
- **Android 에뮬레이터(실기기 아님)** `.devtools/qa-android-self-ai-server.mjs` 13/13: 디버그 APK(이번 코드로 빌드) → Pixel 3a API 33 에뮬레이터(헤드리스) → `adb reverse` → 실제 서버. 미연결 안내, 토큰 연결, 상태, 영상 카드·앱 내 플레이어 iframe, 원본 링크 보존, 계열 질문(같은 코드 답변), 서버 모델 답변, 서버 종료 안내, 재시작 복구, 폰 폭 레이아웃, 페이지 에러 0.
- 측정 `.devtools/bench-self-ai-server.mjs` → SERVER.md §4.
- 회귀: test-self-coach-agent 31/31, test-lesson-free-question 27/27, test-intent-routing 48/48, test-self-search 29/29, test-electron-runtime-requires 3/3, tsc 통과.

UI 시간: 웹 — 영상 5.3–6.6s, 기술 5.3–15.1s, 모델 23.1–48.4s, 서버 꺼짐 안내 0.6–0.7s, 복구 후 영상 3.6s. Android 에뮬레이터 — 영상 9.1s, 계열 답변 6.5s, 모델 89.0s(에뮬레이터 1.5GB + 모델 2.2GB로 메모리 부족·스왑), 꺼짐 안내 2.3s, 복구 6.0s.

미완료·미검증: 실제 Android 폰(USB·Wi-Fi), Windows(Electron 경로는 macOS와 같은 코드지만 실행 안 함), 외부 공개(HTTPS·도메인·방화벽 — 승인 필요), Edge Function 배포(승인 필요), llama.cpp 단독 실행 측정.

## Phase F — 선수 스타일 분석: 행동 주체 구분

문제(2차에서 남긴 것): 문장에 기술 이름이 나오기만 하면 선수 기술로 봄 → 상대의 동작(Slip)을 선수 스타일로 오인. 실제 페이지 재현에서 추가로 발견: 둥근 따옴표(’)로 쓴 소유격·"cause his opponent’s to slip", 대명사를 마지막으로 언급된 사람(상대)으로 연결, "against orthodox fighters"를 선수 스탠스로, 제목("Signature Strikes:")·"Celtic Cross"를 사람 이름으로, 훈련 글의 "end-range strength"·"Adjust volume"을 거리·경기 운영으로.

수정·추가 파일:
- `src/lib/fighterStyle/actor.ts` (신규, 순수) — 기술 언급마다 행동 주체(선수·상대·해설·일반·불명)와 근거 종류(실제 사용 서술 / 분석 자료의 설명 / 상대가 사용 / 일반 기술 설명 / 가정·조언 / 영상 제목·설명 / 주체 불명확). 규칙: 절 단위 주어(첫 번째로 가리키는 사람), 주어 없는 절은 앞 절의 주어, 대명사는 앞 문장의 **주절 주어**(앞의 "When …," 같은 종속절 제외), 사역("forced Aldo to slip", "causing him to"), 받는 쪽 동사("ate a jab", "was caught with"), 반응("over-reacting to the low kick" → 차는 쪽의 기술), 소유격("Aldo's jab"), "against …", 일반 주어("Fighters often …", "The jab is …"), 조언·조건("should", "if he"), 영상 페이지는 캡션. 상대 이름은 페이지의 경기 맥락("against Aldo", "Diaz bout", "met Poirier", 반복되는 전체 이름, 싸우는 동사의 주어)에서만.
- `src/lib/fighterStyle/ruleExtract.ts` — `ruleBasedAnalysis`: 선수가 한 것(실제 사용·분석)만 항목으로, 나머지는 문장·이유와 함께 "제외 목록". 페이지의 대명사 기본값은 분석 대상 선수. 경기 운영 특징 항목 추가. 기술 이름 없는 거리·경기 운영 문장은 선수 이름이나 he/his가 그 문장에 있어야 함.
- `src/lib/fighterStyle/evidenceStyle.ts` — 근거 수준 계산에 선수 문장만 사용, **같은 문장을 옮겨 실은 두 사이트는 독립 출처 1곳**, 제외 목록을 보고서에 포함.
- `src/lib/selfAi/fighterReport.ts` — 항목별 구성: 주요 타격 기술 / 주요 그래플링 기술 / 셋업 / 콤비네이션 / 카운터 / 거리 운영 / 경기 운영 특징 / 반복적으로 확인되는 패턴 / AI 추론 / 확인할 수 없는 항목 / 선수 기술에서 제외한 언급(상대가 사용·일반 설명·가정·영상 설명·주체 불명확) / 요청하신 항목. 근거 문장마다 근거 종류 표시. 콤보·셋업만 "→"(순서), 카운터 등은 쉼표.

정확도(`.devtools/test-fighter-attribution.mjs`, 라벨 문장 28개 — **이 테스트를 위해 작성한 문장이며 실제 페이지에서 모은 것이 아님**): 2차 규칙 17/28(선수 기술이 아닌 것을 선수 기술로 센 오류 11건) → 새 판별 28/28(오류 0). 결과 `data/audit/self-ai/fighter-attribution.json`.

실제 자료(라이브, 실제 Electron 렌더러, 테스트 F "코너 맥그리거 타격 스타일"): 본문 5곳 — Cross "여러 자료에서 공통 확인"(mma-ninja·mmamania, 서로 다른 문장), Front/Side/Low Kick 출처 1곳, Slip·Orthodox·Diaz의 low kick defense는 "상대가 사용한 기술"로 제외, 셋업·콤비네이션·카운터는 "확인할 수 없는 항목". 8.4s. 검색 결과는 실행마다 달라짐(같은 질문도 다른 페이지).

테스트: test-fighter-attribution 16/16 (라벨 세트 3, 문장 간 대명사, 셋업·콤보·카운터는 선수 문장에서, 일반·가정 제외, 근거 종류 기록, 영상 캡션 제외, 신디케이션은 독립 출처 아님, 서로 다른 문장 두 사이트는 공통 확인, 두 사이트 모두 상대 기술이면 제외, 보고서 구역·근거 문장·확인 불가·제외 목록·영상 미분석 명시·반복 패턴). test-lesson-question-fighter 32/32 — F3·F4는 보고서 구성 변경(근거 수준별 → 항목별)에 맞춰 같은 의미로 수정, F8은 강화(Slip이 분석 항목에 없고 "상대가 사용한 기술"에만 있어야 함).

남은 한계: 규칙 판별이라 복잡한 문장(삽입절, 비꼬기, 긴 인용)은 틀릴 수 있음 — 근거 문장과 이유를 함께 보여 줌. 기술 이름이 MARTIALDEX에 없는 표현("left hand", "head kick")은 항목이 되지 않음.

## Phase G — 통합 테스트·최종 검증

**자동 테스트(오프라인)**: `.devtools/test-*.mjs` 전체 실행 — 통과 37개, 실패 3개는 기준선과 같은 항목·같은 수(test-ai-feature-catalog 7/8, test-coach-eval100 100/101, test-coach-validation 56/57). 제외(실행 안 함): test-detail/search/videos/youtube(원본 저장소 경로 고정), *-sql·*-live(실서버), test-local-model-bridge(사용자 Ollama 실행 중). 3차 신규: test-knowledge-db 38/38, test-lesson-free-question 28/28, test-self-ai-server 25/25, test-fighter-attribution 16/16. `tsc` 통과, `vite build` 통과.

**실제 화면 테스트**(숨김·음소거 Electron / 헤드리스 Chrome / 헤드리스 에뮬레이터, 별도 프로필):
- `qa-electron-selfai-launch` 14/14
- `qa-self-ai-chat` 24/24 — F1은 보고서 구성 변경에 맞춰 같은 의미로 수정. **이 테스트에서 실제 버그 발견·수정**: 수업 엔진이 질문을 기다리는 중 "…대응해야 해? 관련 자료도 찾아서 설명해 줘."(물음표로 끝나지 않는 요청문)가 답변으로 채점되어 수업 상태(이해도·결과)가 바뀜 → 검색이 필요한 질문이나 "알려/설명해/찾아/보여 줘" 요청은 질문으로 분기(단, "다시/쉽게 설명해 줘"는 기존처럼 엔진의 재설명). 회귀 검사 B6b 추가.
- `qa-lesson-free-question` 18/18, `qa-web-self-ai-server` 11/11, `qa-android-self-ai-server` 13/13(에뮬레이터)
- `qa-self-ai-six` (phase3-final): A 6.7s, B 15.5s, C 4.9s, D 7.6s, F 7.9s, E 15.9s, I 3.2s, G 23.5s, H 55.9s. 모델이 쓰는 턴(G·H)이 2차보다 느림 — 측정 시점에 스왑 7.5GB 사용(에뮬레이터·여러 테스트 후 메모리 부족), 첫 토큰 15s.

원본 저장소: HEAD c21770e 그대로, 이번 작업 파일 없음(미커밋 변경 수는 다른 세션 작업으로 176줄).
