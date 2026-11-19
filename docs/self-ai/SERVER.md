# MARTIALDEX 자체 AI 서버 (Android·웹·다른 컴퓨터용)

> 코드: `server/self-ai/` · 클라이언트 연결: `src/lib/selfAi/transport.ts` · 테스트: `.devtools/test-self-ai-server.mjs`, `qa-web-self-ai-server.mjs`, `qa-android-self-ai-server.mjs`, 측정 `bench-self-ai-server.mjs`

## 1. 구조

```
 클라이언트 (같은 코드: src/lib/selfAi/* — 의도 분류·도구 선택·DB 답변·수업 엔진·선수 분석)
   macOS / Windows (Electron)  ──IPC──▶ 메인 프로세스 (electron/selfAi.cjs, electron/selfSearch)
   Android (Capacitor) / Web   ──HTTPS + 토큰──▶ MARTIALDEX 자체 AI 서버 (server/self-ai/server.cjs)
                                                   ├─ 인증·사용자 구분 (토큰, 해시만 저장)
                                                   ├─ 모델 대기열 (한 번에 1개 생성, 사용자당 1개)
                                                   ├─ 검색 요청 한도 (사용자별)
                                                   ├─ 모델 실행기 ── Ollama (현재) │ OpenAI 호환 서버 (llama.cpp llama-server 등)
                                                   │                  └─ Qwen2.5:3B
                                                   └─ 자체 검색 ── SearXNG + 본문 추출 + 이름 확인 (electron/selfSearch 재사용)
```

- **무엇이 서버에 있고 무엇이 클라이언트에 있나**: 서버는 폰·브라우저가 직접 할 수 없는 두 가지(모델 실행, 검색·본문 추출)만 제공합니다. 질문 의도 분류, 도구 선택, MARTIALDEX DB 답변, 수업 엔진, 선수 분석 보고서는 데스크톱과 같은 클라이언트 코드가 그대로 실행합니다(플랫폼마다 다른 AI 로직 없음). 수업 기록·대화·사용자 데이터는 서버로 보내지 않습니다.
- **Qwen과 실행기 분리**: 서버는 `runners.cjs`의 계약(`status / chat / cancel`)으로만 모델을 부릅니다. `SELF_AI_RUNNER=ollama`(기본) 또는 `openai-compatible` + `SELF_AI_RUNNER_URL`. 모델 이름은 `SELF_AI_MODEL`.
- **세션**: 사용자 = 토큰. 요청 id는 서버에서 사용자별 이름공간으로 바뀌어, 다른 사용자의 요청을 취소할 수 없습니다. 대화 기록은 각 기기에 저장(서버는 상태 없음).

## 2. 실행 방법 (이 Mac, 로컬 전용)

```bash
node server/self-ai/auth.cjs add <사용자id> [설명]   # 토큰 발급(한 번만 표시, 해시만 ~/.martialdex-ai/server-tokens.json 에 저장)
node server/self-ai/server.cjs                        # 127.0.0.1:8787 (+ ::1) 에서만 수신
```
앱(웹·Android) → AI 코치 대화 화면 → "자체 AI 서버" → 주소와 토큰 → "연결 확인".
- Android 에뮬레이터 / USB로 연결한 폰: `adb reverse tcp:8787 tcp:8787` 후 주소 `http://localhost:8787`. 앱은 기기 자신의 localhost에만 평문 HTTP를 허용합니다(`android/app/src/main/res/xml/network_security_config.xml`).
- 웹(개발 서버): `http://localhost:8787`. 페이지 CSP는 이 주소와 빌드 시 지정한 HTTPS 주소(`VITE_SELF_AI_SERVER_ORIGIN`)만 허용합니다.

환경 변수: `SELF_AI_SERVER_HOST`(127.0.0.1) `SELF_AI_SERVER_PORT`(8787) `SELF_AI_SERVER_TOKENS_FILE` `SELF_AI_SERVER_ORIGINS`(CORS 허용 출처) `SELF_AI_MAX_PARALLEL`(1) `SELF_AI_MAX_WAITING`(6) `SELF_AI_SEARCH_PER_MIN`(30) `SELF_AI_RUNNER` `SELF_AI_RUNNER_URL` `SELF_AI_MODEL` `OLLAMA_HOST_URL` `SEARXNG_URL`.

## 3. 오류·대기 처리
| 상황 | 동작 |
|---|---|
| 토큰 없음·틀림 | 401 → 앱: "토큰이 올바르지 않습니다" |
| 서버 꺼짐 | 앱: "자체 AI 서버에 연결할 수 없습니다" — 검색했다고 말하지 않음, 다른 모델·검색으로 대체하지 않음. 서버가 다시 켜지면 같은 화면에서 바로 동작 |
| 모델 실행기 꺼짐 | `NOT_RUNNING` → 데이터만 답변 + 안내, 상태 표시 "로컬 AI: 꺼짐" |
| 모델 로딩(첫 토큰 지연) | 5초마다 `waiting` 알림 → 앱 상태 줄 "모델이 답변을 준비하는 중 (n초)" |
| 다른 사용자 처리 중 | 대기열 `queued` n번째 → 앱 상태 줄 "자체 AI 서버 대기 중 (n번째)" / 대기열이 차면 `BUSY` |
| 같은 사용자가 답변 중 또 질문 | `BUSY` "이전 질문의 답변을 아직 만드는 중입니다" |
| 검색 과다 | 사용자별 분당 한도 → 429 |

## 4. 이 Mac에서의 측정 (`data/audit/self-ai/server-bench.json`, Intel i5-7600K 4코어·8GB·GPU 없음)
| 항목 | 결과 |
|---|---|
| 서버 프로세스 메모리 | 49–51MB (모델 제외) |
| 모델 상주 | qwen2.5:3b 2.17GB (Ollama) |
| 답변 1개 (프롬프트 약 300자, 출력 50–77토큰) | 8.4–18.9s, 첫 토큰 0.9s(모델이 이미 올라와 있을 때) / 모델 로딩 포함 첫 요청 17.9–20.8s |
| 두 사용자 동시 (대기열 1) | A 9.0s, B 27.2s(대기 후 시작), 전체 27.2s |
| 두 사용자 동시 (병렬 2로 Ollama에 함께 전달) | A 7.0s, B 19.7s — **B의 첫 토큰이 A가 끝난 뒤(7.3s)에야 나옴: Ollama가 이 CPU에서 한 번에 하나씩 생성** |
| 서버 경유 영상 검색 | 1.2–2.4s |

→ 이 Mac 한 대로는 **동시에 답변을 만드는 사용자 1명**, 대기 포함 2–3명이 현실적인 한계입니다(생성 약 5–9 토큰/초, CPU 공유). 병렬 설정은 처리량을 늘리지 못해 기본값을 1(대기 순번을 알려 줄 수 있음)로 둡니다. Android 에뮬레이터를 함께 띄웠을 때는 메모리 부족(스왑)으로 모델 답변이 89s 걸렸습니다.

### llama.cpp 등 다른 실행기
- 현재 Ollama 0.40.6도 내부적으로 llama.cpp의 `llama-server` 프로세스로 모델을 실행합니다(프로세스 확인). 같은 GGUF·같은 CPU 연산이라 llama.cpp를 직접 쓰는 것만으로 속도 이점은 작을 것으로 예상하지만, **이 Mac에서 llama.cpp 단독 실행은 측정하지 않았습니다**(설치하지 않음).
- 직접 실행의 장점: OpenAI 호환 API, 병렬 슬롯(-np)·연속 배치 같은 세부 설정, 모델 관리자 없이 단일 바이너리. 단점: 모델 내려받기·버전 관리·자동 해제(keep_alive)를 직접 해야 함.
- 서버는 두 방식 모두 지원(`runners.cjs`, OpenAI 호환 실행기는 가짜 서버로 계약 테스트 S17–S18 통과). 여러 사용자 동시 처리가 필요하면 실행기 교체보다 **GPU가 있는 컴퓨터**로 서버를 옮기는 것이 효과가 큽니다.

## 5. 외부 공개 — 승인 필요 (이번 작업에서 하지 않음)
지금은 127.0.0.1에서만 수신합니다. 폰을 Wi-Fi·외부망에서 쓰려면 아래가 필요하고, 모두 소유자 결정 사항입니다.
1. **HTTPS**: 리버스 프록시(예: Caddy·nginx)로 TLS 종료 후 127.0.0.1:8787로 전달. 도메인과 인증서 필요. (Android 앱은 localhost 외 평문 HTTP를 허용하지 않음)
   - 또는 Tailscale 같은 사설망(기기 간 암호화, 공용 인터넷 노출 없음).
2. **방화벽·공유기 설정**: 공용 인터넷에 열 경우 포트 포워딩·방화벽 변경 — 하지 않았음.
3. **토큰 관리**: 사람·기기별 토큰, 분실 시 `auth.cjs revoke`. 로그에는 질문 내용·토큰을 남기지 않음.
4. **CORS**: 실제 웹 주소를 `SELF_AI_SERVER_ORIGINS`에, 앱 빌드 시 `VITE_SELF_AI_SERVER_ORIGIN=https://…`.
5. **Supabase Edge Function `web-search`**: 코드에 자체 검색 경로를 추가함(`SELF_AI_SERVER_URL`·`SELF_AI_SERVER_TOKEN` 비밀값이 있을 때만, 없으면 기존 동작). **배포하지 않음** — 서버가 HTTPS로 공개된 뒤, 승인 후 `supabase secrets set` + `supabase functions deploy web-search`.
6. 이 Mac을 서버로 쓰면 Mac이 꺼지거나 잠들면 모바일의 자체 AI도 멈춥니다(앱은 "연결할 수 없습니다"로 안내).
