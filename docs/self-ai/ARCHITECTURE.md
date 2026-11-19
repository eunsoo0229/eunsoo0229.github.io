# MARTIALDEX 자체 AI — 아키텍처 (2026-10-31)

> 작업 브랜치 `ai/self-hosted-overhaul` (개발용 복제본 `/Users/swcho/Documents/MARTIALDEX_AI_DEV`).
> 진행 상황·테스트 결과·남은 일은 [PROGRESS.md](PROGRESS.md).

## 1. 한눈에 보기

```
              ┌──────────── 렌더러 (React, src/lib) ────────────┐
 사용자 ─▶ /coach/chat (CoachChat)          수업 화면 (CurriculumCoachSession)
            │                                  │  수업 중 검색·추가 (상태 불변)
            ▼                                  ▼
       selfAi/coachAgent  ── router(도구 선택은 코드) ── guard(인용·검색 주장 검사)
            │            │                     │
            │      martialdexKnowledge         selfAi/chatLesson ─▶ 기존 수업 엔진
            │      (기술 DB·DB 콤보·사용자            (1-Day 대화 수업 커리큘럼,
            │       콤보/셋업·연결·내 콤보)           appendTechniquesToCoachDayRun)
            │            │
   IPC selfai:*     IPC research:*         (Android/웹: 자체 AI 서버 — §5)
            ▼            ▼
 ┌──── Electron 메인 프로세스 ────┐
 │ electron/selfAi.cjs  ─▶ Ollama 127.0.0.1:11434 (오픈소스 LLM, 스트리밍)
 │ electron/selfSearch/ ─▶ SearXNG 127.0.0.1:8888 (자체 호스팅 메타검색)
 │                      ─▶ 원문 페이지 (robots.txt 준수, Readability 추출)
 │ electron/webSearch.cjs  MARTIALDEX_SEARCH_BACKEND=auto|searxng|tavily
 └────────────────────────────────┘
   (Android/웹: 같은 두 기능을 server/self-ai 가 HTTP로 제공 — §5, SERVER.md)
```

원칙: **사실은 MARTIALDEX DB와 실제로 가져온 원문에서만, LLM은 문장 작성자.**
1~4B 로컬 모델 7종을 이 Mac에서 측정한 결과 모두 격투기 사실 문항을 틀렸습니다
(`data/audit/self-ai/local-models-round*.json`) — 모델을 지식원으로 쓰지 않는 근거입니다.

## 2. 실시간 검색 (Tavily 대체)

| 단계 | 구현 | 비고 |
|---|---|---|
| 질의 분석 | `selfAi/router.ts` `planTurn` | 검색 필요 여부·종류(web/video/paper)·영어 보조 질의 |
| 수집 | `electron/selfSearch/searxng.cjs` | 종류별 엔진 묶음, 실패 엔진 기록 |
| 중복 제거 | `core.cjs` `dedupResults` | URL 정규화(utm·www·youtu.be), 같은 사이트 같은 제목 병합, 엔진 합집합 |
| 관련성 | `core.cjs` `rankResults` | 질의어 겹침 + 엔진 합의 + 순위 |
| 원문 추출 | `extract.cjs` | robots.txt, CAPTCHA/401/403/429 → `blocked`(우회 없음), 2MB/10초 |
| 날짜·출처 | `extract.cjs` `metaDate`, `core.cjs` | 날짜는 검색엔진 또는 페이지 메타에 있을 때만, 추정 안 함 |
| 신뢰도 | `core.cjs` `assessReliability` | 높음/보통/낮음 + 관찰 사유(유형·엔진 수·본문 확인·게시일) |
| 전달 | IPC `research:search`, 기존 `websearch:search` 호환 | 원문 URL 항상 보존 |

### SearXNG 엔진 실측 (2026-10-31, 이 Mac의 IP, `.devtools/bench-searxng-engines.mjs`)

| 엔진 | 결과 | 조치 |
|---|---|---|
| bing, yahoo, naver | 6/6 성공 (bing 5/6) | 웹 기본 |
| brave | 1차 6/6 → 반복 호출 후 429 정지 | 켜 두되 예산 주의 |
| youtube, bing videos, dailymotion | 5/6 | 영상 |
| crossref 6/6, arxiv 4/6, semantic scholar·openalex 3/6 | | 논문 |
| google, google videos, qwant | access denied | 비활성 |
| duckduckgo | CAPTCHA | 비활성 (우회 안 함) |
| startpage | 작업증명 CAPTCHA | 비활성 |
| mojeek | access denied | 비활성 |

엔진 성공률은 IP·시간에 따라 바뀝니다. 같은 스크립트로 주기적으로 다시 측정하세요.

### 원문 추출: Crawl4AI 검토 결과
- 이 Mac(Intel macOS 13, Python 3.13)에서 `pip install crawl4ai` 실패: 고정된 `cryptography` 버전에 이 플랫폼용 바이너리가 없어 Rust+OpenSSL 빌드가 필요(수 GB 툴체인). **설치하지 않음.**
- 채택: 정적 요청 + Mozilla Readability(linkedom) — 브라우저 없이 메인 프로세스에서 동작, 추가 메모리 거의 없음.
- 대안(미구현, 다음 단계): `too_short`(스크립트로 그리는 페이지)일 때만 Electron 숨김 창(show:false, 음소거)으로 렌더링해 추출 — 이미 내장된 Chromium 사용, 추가 설치 없음. Python 3.11/3.12 환경이 생기면 Crawl4AI를 별도 프로세스로 같은 자리에 꽂을 수 있음.

### Tavily 처리
- 코드 삭제 없음. `electron/webSearch.cjs`의 `tavilySearch`로 이름만 바뀌어 남아 있음.
- 기본값 `MARTIALDEX_SEARCH_BACKEND=auto`: SearXNG가 켜져 있으면 SearXNG, 꺼져 있고 TAVILY_API_KEY가 있을 때만 Tavily(레거시). `searxng`로 두면 Tavily를 전혀 쓰지 않음.
- 그 결과 Electron에서 기존 하드 의존 5곳(입력 수업 생성, 무술 발견·검증, 누락 기술 검증, 다른 플랫폼 영상)과 AI 커리큘럼 웹 근거가 호출부 수정 없이 자체 검색을 사용.
- 남은 의존: Supabase Edge Function `web-search`(Android/웹 경로)는 여전히 Tavily. §5 참고.

## 3. 오픈소스 LLM

- 실행기: Ollama 0.40.6 (이미 설치되어 있었고 기존 `electron/ollama.cjs`가 사용). llama.cpp 직접 실행은 같은 GGUF·같은 CPU 경로라 속도 이점이 작고 모델 관리·스트리밍 API를 다시 만들어야 해서 채택하지 않음.
- 대화 브리지: `electron/selfAi.cjs` — 스트리밍, 취소, `num_ctx 4096`, 모델은 `SELF_AI_MODEL`(기본 `qwen2.5:3b`). Gemini로 넘기지 않음.
- 모델 비교표·선정 이유: [PROGRESS.md §모델 비교](PROGRESS.md#모델-비교).

## 4. 내부 DB 통합 · 커리큘럼 · 대화 · 수업 · 선수 스타일

| 영역 | 모듈 | 핵심 |
|---|---|---|
| 지식 인덱스 | `martialdexKnowledge/index.ts`, `loadIndex.ts` | 기술 DB 콤보 기록 + 사용자 콤보·셋업(상대 반응) + 연결 + 내 콤보 북. 기술별 셋업·콤보·다음/앞 동작 |
| 신규 후보 | `martialdexKnowledge/candidates.ts`, `candidateStore.ts` | 검증 완료 / 일부 정보 확인 / 검증 대기 / 자료 부족 / 기존 데이터와 중복. 인용문을 원문에서 코드로 재확인. 검증 DB와 분리된 로컬 저장소 |
| 커리큘럼 | `martialdexKnowledge/drills.ts`, `aiCurriculum/service.ts` 끝단 | `CurriculumDay.drills` (셋업·콤보·연결). 콤보는 그날까지 배운 기술만, 셋업은 새 동작 최대 1개. 기존 웹 근거 중단 조건·기준은 그대로 |
| 대화 코치 | `selfAi/*`, `pages/CoachChat.tsx` (`/coach/chat`) | 도구 선택은 코드, 출처는 코드가 첨부, 검색 안 했으면 검색했다고 말하지 못하게 검사, 대화 영구 저장 |
| 대화 → 수업 | `selfAi/chatLesson.ts` | 1-Day 대화 수업 커리큘럼 → 기존 수업 엔진. 출처·원문 링크 저장 |
| 수업 중 검색/추가 | `CurriculumCoachSession.tsx` 훅, `sessionStore.appendTechniquesToCoachDayRun` | 메시지만 추가, 단계·대기 질문·진행·완료 기록 불변. DB에 있는 기술만 수업에 추가 |
| 선수 스타일 | `fighterStyle/evidenceStyle.ts`, `components/fighterStyle/EvidenceStylePanel.tsx` | 여러 자료 공통 / 출처 1곳 / AI 추론 / 확인 못함. 영상 내용은 확인하지 않는다고 명시 |

## 5. 플랫폼별 실행 구조 (3차: 자체 AI 서버 추가)

| | Mac·Windows (Electron) | Android (Capacitor) | Web |
|---|---|---|---|
| AI 로직(의도·도구·DB 답변·수업 엔진·선수 분석) | 클라이언트 코드 | 같은 클라이언트 코드 | 같은 클라이언트 코드 |
| LLM | 메인 프로세스 → Ollama | **자체 AI 서버**(토큰) → 실행기 → Qwen2.5:3B | 동일(서버) |
| 검색 | 메인 프로세스 → SearXNG + 추출 | **자체 AI 서버** → SearXNG + 추출 | 동일(서버) |
| 서버 미연결 | — | "이 기기 미지원 — 자체 AI 서버 연결" 안내 | 동일 |

전송 계층 `src/lib/selfAi/transport.ts`: Electron IPC가 있으면 그것, 없으면 사용자가 연결한 서버, 둘 다 없으면 UNSUPPORTED. 서버 구조·보안·측정·공개 조건은 [SERVER.md](SERVER.md).

Mac 리소스 메모: 8GB에서 Ollama(3B ≈ 2.2GB 상주) + SearXNG(≈150MB) + 서버(≈50MB) + Electron 앱을 함께 실행. 모델은 `keep_alive 10m` 후 자동 해제.

## 6. 실행 방법 (개발)

```bash
ollama serve                                   # 로컬 LLM
ollama pull qwen2.5:3b                         # 기본 대화 모델
services/searxng/run.sh                        # 자체 검색 (최초 1회: ~/.martialdex-ai 에 설치 — PROGRESS.md)
# .env (값은 저장소에 넣지 않음)
#   SELF_AI_MODEL=qwen2.5:3b
#   MARTIALDEX_SEARCH_BACKEND=auto             # searxng 로 두면 Tavily 완전 미사용
npm run dev
```
