# MARTIALDEX 자체 AI 개편 — 진행 기록 (이어서 작업할 때 먼저 읽기)

마지막 갱신: 2026-10-31 · 브랜치 `ai/self-hosted-overhaul` · 설계: [ARCHITECTURE.md](ARCHITECTURE.md)

## 0. 백업 (완료·검증됨 — 절대 수정 금지)

| 항목 | 값 |
|---|---|
| 백업 | `/Users/swcho/Documents/MARTIALDEX_BACKUP_20261031` (읽기 전용 `chmod -R a-w`) |
| 내용 | `MARTIALDEX/` = 원본 전체 ditto 복제(.git·.env·node_modules·dist·release·android·mma-mocap), `meta/` = git 번들(--all)·미커밋 패치·미추적 목록·SHA-256 매니페스트·`RESTORE.md` |
| 원본 | `/Users/swcho/Documents/MARTIALDEX` — 이번 작업에서 수정하지 않음 (main, c21770e + 미커밋 159건) |
| 개발용 복제본 | `/Users/swcho/Documents/MARTIALDEX_AI_DEV` — 백업에서 복원해 만듦, 브랜치 `ai/self-hosted-overhaul` |

검증 결과: 파일 목록 57,121개 일치 · SHA-256 28,933개(mma-mocap 제외) 전부 일치 · `git fsck` 정상 · `git bundle verify` 완전 · 번들+패치 복원 시 추적 파일 1,129개 일치·미추적 120개 존재 · 복원본에서 `tsc --noEmit` 통과·`vite build` 통과(38.5초).
재확인(2026-11-01): 체크섬 불일치 1건 = `.git/index`. 잠금 전 검증 단계에서 백업본에 `git status`를 실행해 git이 파일 상태 캐시를 갱신한 것(수정 시각 22:53, 잠금 전). `git ls-files -s` 항목과 `git status` 결과는 원본과 동일 — 내용 변화 없음.
백업에 포함되지 않는 것: Supabase 실서버 데이터·스키마 덤프(접속 정보가 필요하고 실서버 접근을 하지 않았음). 마이그레이션 SQL 파일은 포함.

## 1. 커밋 (복구 지점)

| 커밋 | 내용 |
|---|---|
| fd3d0ce | 개편 전 작업 트리 그대로의 기준점 |
| 698f89b | 자체 검색 파이프라인 (SearXNG + 추출), 백엔드 선택, IPC research:* |
| 597e322 | 내부 지식 인덱스·신규 후보 분류, 0042 마이그레이션 초안 |
| a08b3a3 | 커리큘럼 셋업·콤보·연결 드릴 |
| dde7b4b | 대화형 코치, 대화→수업, 수업 중 검색·추가, 근거 기반 선수 스타일 |
| (이번) | 라이브 검증에서 나온 품질 문제 수정 + 문서 |

## 모델 비교

이 Mac(Intel i5-7600K 4코어, RAM 8GB, GPU 가속 없음)에서 Ollama 0.40.6으로 실측. `.devtools/bench-local-models.mjs`, 원자료 `data/audit/self-ai/local-models-round1.json`, `-round2.json`.
과제 10개: 한국어 설명, 격투기 사실 4문항, 추론 1문항, 지시 이행(정확히 3개 목록), 근거 JSON 추출(인용문이 원문에 실제로 있는지), 자료 없음 거절, 6턴 대화 기억.

| 모델 | 통과 | 속도 | 첫 로딩 | 상주 메모리 | 근거 JSON | 거절 | 기억 | 비고 |
|---|---|---|---|---|---|---|---|---|
| **qwen2.5:3b** | 4/10 | 4.9 tok/s | 31초 | 2.07GB | ✅ 4/4 원문 인용 | ✅ | ✗(스탠스를 "왼스탠스"로 바꿔 말함) | 기본값 |
| gemma3:4b | 6/10 | 4.3 tok/s | 76초 | 2.76GB | ✅ 4/4 | ✅ | ✅ | 품질 최고, 느리고 무거움 |
| gemma2:2b | 6/10 | 4.9 tok/s | 21초 | 1.84GB | ✅(문단 통째 인용) | ✅ | ✅ | 한국어 문장 어색 |
| exaone3.5:2.4b | 4/10 | 4.6 tok/s | 32초 | 1.94GB | ✗ 인용을 한국어로 번역해 원문 대조 불가 | ✅ | ✅ | 한국어는 자연스러움 |
| llama3.2:1b | 5/10 | 7.7 tok/s | 15초 | 1.45GB | ✗ | ✅ | ✅ | 반복 출력 |
| qwen2.5:1.5b | 2/10 | 12.2 tok/s | 6.5초 | 1.12GB | ✗ | ✗ 지어냄 | ✗ | 부적합 |
| qwen3:4b | 4/10 | 5.9 tok/s | 39초 | 3.04GB | ✅ | ✅ | ✅ | 이 Ollama에서 사고 과정(영어)이 답변에 섞임 → 대화 부적합 |

- 모든 모델이 격투기 사실 문항 대부분을 틀림(예: 기무라 → "무릎·팔꿈치", 팁 → "펀치"). → **모델을 지식원으로 쓰지 않고, DB·원문 근거로만 쓰게 설계.**
- 기본 `SELF_AI_MODEL=qwen2.5:3b`: 근거 JSON 추출(선수 스타일·후보 추출의 핵심)이 정확하고, 4B보다 가볍고 빠름. 메모리 여유가 있으면 `gemma3:4b`가 한국어·대화 품질이 더 좋음(로딩 76초 감수).
- 1차 측정 중 일부 구간에 빌드/테스트가 동시에 돌아 속도 수치에 영향이 있을 수 있음(2차는 유휴 상태).
- EXAONE은 한국어가 자연스러우나 인용을 번역해 버려 원문 대조 검증이 불가 — 근거 추출 용도로는 부적합.

## 2. 테스트 결과

### 개편 전 기준선 (개발용 복제본, 오프라인 스크립트 28개)
25개 전부 통과. 개편 전부터 있던 실패 3건:
- `test-ai-feature-catalog` 7/8 — `coachLesson/lessonAssessment`, `formCompare/ai`, `visualMitt/mittSourcing`이 AI 코치 탭 목록에 없음
- `test-coach-eval100` 100/101 — "기본 풋워크 핵심 뭐임?"(무에타이)
- `test-coach-validation` 56/57 — "기무라는 왜 이름이 기무라야?" 응답 문구
- `test-local-model-bridge` — 실행 중인 Ollama가 포트를 써서 SKIP (Ollama를 끄고 다시 실행해야 함)

### 개편 후 회귀 (같은 28개 + `test-local-model-bridge`)
기준선과 동일하게 25개 전부 통과, 기존 실패 3건은 같은 항목·같은 내용 그대로(새 회귀 0건). `test-local-model-bridge` 8/8(Ollama 끈 상태). `tsc --noEmit` 통과, `vite build` 통과.

### 새 테스트
| 스크립트 | 결과 | 내용 |
|---|---|---|
| `test-self-search.mjs` | 29/29 | URL 정규화·중복 제거·순위·출처 유형·신뢰도·날짜 미추정·robots·CAPTCHA 차단·검색 서버 꺼짐 처리·기존 계약 형태 |
| `test-martialdex-knowledge.mjs` | 29/29 | 실제 DB로 셋업·콤보·다음 동작, 후보 5개 상태, 저장소 병합, 커리큘럼 드릴(단계적 난이도·중복 없음·없으면 안 만듦) |
| `test-self-coach-agent.mjs` | 30/30 | 도구 선택, 인용 검사, 검색 불가·실패 명시, 로컬 AI 꺼짐 시 Gemini 미사용, 수업 제안, 대화 기억 |
| `test-self-ai-lesson-style.mjs` | 23/23 | 대화→수업 커리큘럼, 수업 중 추가 시 index·step·완료 기록 불변, 선수 스타일 근거 분류 |
| `test-curriculum-evidence.mjs` (기존) | 103/103 | 커리큘럼 근거 기준 회귀 없음 |
| `bench-searxng-engines.mjs` | 측정 | ARCHITECTURE.md §2 |
| `live-self-coach.mjs` | 아래 §3 | 실제 Ollama + SearXNG |

## 3. 라이브 검증 (`live-self-coach.mjs`, 실제 qwen2.5:3b + 실제 SearXNG, 결과 `data/audit/self-ai/live-self-coach-qwen2.5-3b.json`)

최종 6/6 통과. 단, 처음 두 번의 실행에서 판정은 통과였지만 **답변 내용이 잘못된 것**을 발견해 판정 기준을 강화하고 고쳤습니다:

| 발견 | 수정 |
|---|---|
| 인사에 "합쇼체이시, 안녕합쇼" (프롬프트 용어 흉내) | 프롬프트에서 용어 제거 |
| 암바 질문에 DB 자료를 줬는데도 "백 컨트롤(Passive Mount)" 등 틀린 설명 생성 | 검색이 필요 없는 기술 질문은 기존 검증된 데이터 답변 엔진(`answerCoachQuestion`)이 답함 → "고관절을 지면에서 들어 올려(다리 브릿지)…" |
| 복싱 질문에 "킥복싱" (잽 정규 id가 kickboxing__jab) | 프롬프트에 질문한 무술 이름 명시 |
| 논문 6건을 찾고도 "논문 없음"이라고 답함 | 영상·논문 요청은 코드가 번호 목록 작성 (모델 미사용) |
| 논문 결과에 무관한 한국어 논문(아이콘 개발 등) | 질의어 겹침 하한 0.34, 질문 형식어 제외, 같은 제목 논문 병합 |
| 영상 결과에 Kobe Bryant·축구 영상 (영어 보조 질의에서 선수 이름 누락) | 번역 안 되는 한글 주제어를 보조 질의에 유지 |
| 답변에 한자("负荷") 혼입 | 가드가 감지해 안내 |

최종 측정(CPU, 모델 예열 후): 인사 3.2초 · 기술 질문(데이터 엔진) 1.9초 · 영상 3.4초 · 논문 9.4초 · 셋업/콤보 질문(검색 6건+본문 4건+모델 작성) **143초, 첫 글자 46초** · 동기부여 13.7초.

남은 품질 한계:
- 검색 자료를 쓴 긴 답변에서 모델이 출처 번호 [n]을 거의 달지 않음 → 가드가 "출처 번호 없음"을 안내하고 출처 목록은 코드가 붙임. 문장 단위 근거 대조는 아직 없음.
- **근거 기반 선수 스타일(로마첸코) 결과 0항목**: 페이지 4곳 분석 중 1곳은 모델 반복 출력으로 중단, 3건은 MARTIALDEX 기술로 확인되지 않아 제외. 근거를 지어내지 않고 빈 결과와 사유를 보여 주는 것은 의도대로지만, 3B 모델의 추출 능력이 실사용에 부족함 — gemma3:4b 비교 또는 규칙 기반 기술명 추출 보강 필요.

## 3-1. Electron 시작 시 ERR_REQUIRE_ESM 수정 (2026-11-01)

- **증상:** `npm run electron` → 메인 프로세스 Uncaught Exception `ERR_REQUIRE_ESM` (linkedom/cjs/shared/matches.js → css-select/dist/index.js). 창이 뜨기 전에 종료.
- **원인:** `linkedom@^0.18.14`가 0.18.13부터 `css-select@^7`(ESM 전용, `"type":"module"`)에 의존. linkedom의 CJS 빌드는 이를 `require()`함. Electron 32.3.3 내장 Node는 **20.18.1**이라 ESM을 `require()`할 수 없음(Node 20.19 / 22.12부터 기본 지원). 테스트는 시스템 Node **24.19**로만 돌려 통과했음. 또 `main.cjs`가 시작 시 `selfSearch/index.cjs` → `extract.cjs` → linkedom을 즉시 로드해 선택 기능의 의존성 하나가 앱 전체를 멈춤.
- **수정:**
  - `linkedom` `^0.18.14` → **`0.18.12` 정확 고정**(css-select 7.0.0 → 5.2.2, CJS). `npm install --save-exact`로 package.json·lockfile 함께 갱신, node_modules 직접 수정 없음. 0.18.12→14 차이는 css-select 메이저·cssom 교체이며 사용하는 API(`parseHTML`, `querySelector(All)`, `matches`, Readability)는 Electron Node에서 확인.
  - `extract.cjs`: linkedom·Readability를 첫 본문 추출 때 로드. 로드 실패 시 앱은 정상 시작하고 해당 추출만 `failed`(`본문 추출기 로드 실패(코드)`).
  - 동적 `import()`는 검토 후 미채택: 동작은 하지만 같은 결함(시스템 Node와 Electron Node의 차이)을 숨기고 extract 경로 전체를 비동기 로딩으로 바꿔야 함. 버전 고정이 더 작고 명확함.
- **재발 방지:** `.devtools/test-electron-runtime-requires.mjs` — `electron/**`이 require하는 npm 패키지 전부를 **Electron의 Node**(`ELECTRON_RUN_AS_NODE`, 창 없음)로 로드. 0.18.14로는 ERR_REQUIRE_ESM 재현 확인(별도 임시 폴더). linkedom을 올릴 때는 이 테스트를 먼저 돌릴 것.
- **실제 Electron 확인:** `.devtools/qa-electron-selfai-launch.mjs`(숨김·음소거, 별도 user-data-dir) 14/14 — 창 생성·렌더링, 실제 SearXNG 검색 + linkedom/Readability 본문 추출, 자체 AI 상태, `/coach/chat`·`/coach`·`/coach/class`·`/learning` 렌더링, 메인 로그에 Uncaught 없음.
- **주의:** 기존 `test-detail/search/videos/youtube.mjs`는 `APP_DIR`이 원본 저장소로 고정되고 `--user-data-dir`이 없어 실제 앱 프로필을 씀 → 개발용 복제본 회귀에서 제외할 것.

## 4. 미검증 · 미완료 (정직하게)

- **Electron 앱 화면 안에서 실제 클릭 QA 미실행.** (시작·렌더링·검색 IPC는 위 3-1에서 확인, 대화·수업 상호작용 클릭은 아직) `/coach/chat`, 수업 화면 훅, 선수 스타일 패널은 타입체크·오프라인 테스트·라이브(Node에서 같은 모듈 실행)로만 확인. 기존 QA 관례(`.devtools/qa-*.mjs`, 숨김·음소거 Electron)로 `qa-self-ai-chat.mjs` 작성 필요.
- **Android 실기기 미검증.** Android에는 로컬 LLM·SearXNG가 없어 "이 기기 미지원"으로 표시되는 것까지만 코드상 처리. 서버 분리 구조(ARCHITECTURE §5)는 설계만.
- **Supabase Edge Function `web-search`는 아직 Tavily.** `SEARXNG_URL` 지원 추가·배포는 승인 후.
- **마이그레이션 `0042_knowledge_candidates.sql` 초안 — 실서버 미적용.** 후보는 현재 로컬(`martialdex:knowledge-candidates`)에만 저장.
- AI 맞춤 커리큘럼의 **웹 검색에서 셋업·콤보 자체를 추출**하는 단계는 아직 없음(현재 드릴은 MARTIALDEX 기록에서만 구성 — 웹 신규 셋업·콤보는 대화 코치·선수 스타일 경로에서 후보로만 생성).
- JS 렌더링 페이지용 Electron 숨김 창 추출(Crawl4AI 대안) 미구현.
- 후보 검토 화면(사람이 후보를 확인해 add_teq/shared_combos로 올리는 단계) 미구현.
- 대화 기록 클라우드 동기화: `martialdex:*` 키라 계정 백업(`user_backups`)에는 포함되지만 전용 테이블 동기화는 없음.

## 5. 이어서 할 일 (순서)
1. 선수 스타일 추출 보강 (gemma3:4b 비교, 원문에서 DB 기술명을 규칙으로 찾아 모델 추출과 교차 확인)
2. `qa-self-ai-chat.mjs` — 실제 Electron(숨김·음소거)에서 대화·출처·수업 시작·수업 중 질문/추가
3. 커리큘럼 웹 근거에서 셋업·콤보 추출 → `classifyCandidate` → 미리보기에 "신규 후보" 표시
4. 후보 검토 화면
5. 서버 분리(SearXNG를 사용자 서버로) + Edge Function `SEARXNG_URL` (승인 필요)
