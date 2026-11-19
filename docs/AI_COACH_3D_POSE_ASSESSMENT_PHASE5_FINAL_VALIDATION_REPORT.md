# AI 코치 3D 자세 측정 — Phase 5 최종 검증 보고서 (실제 Gemini)

작성일: 2026-11-15 · 대상: 원본 프로젝트 `/Users/swcho/Documents/MARTIALDEX` · 이전 단계 백업: `MARTIALDEX_backups/phase4-3dui-20261115-141657`

## 요약

| 완료 기준 | 결과 |
|---|---|
| 실제 3D 렌더링 녹화 파일 사용 | ✅ `recordPreviewOnce`로 녹화한 VP9 WebM (147,401바이트, 1,419ms) |
| 실제 Gemini 평가 기준 생성 | ✅ `buildReferenceProfile` 실호출 → 잽으로 인식, 기준 5개 |
| 실제 Gemini 사용자 영상 판정 | ✅ `judgeAttempt` 실호출 → 기준 5개 모두 판정 |
| 실제 AI 판정으로 점수 계산 | ✅ `scoreComparison` → `status: scored` |
| 최종 점수 반환 | ✅ **50점** (원점수 57, 핵심 기준 불일치로 상한 50) |
| 기존 영상 비교 회귀 테스트 | ✅ 무료 회귀 테스트 전부 통과 (유료 `qa-form-compare.mjs`는 미실행 — 9절) |

**파이프라인 검증은 성공했다. 다만 이번 점수 50점은 정확하지 않을 가능성이 높다.** 테스트 사용자 영상은 정면에서 렌더링한 "올바른 잽"(정답 데이터상 팔꿈치 174.9°로 완전히 폄)인데, Gemini는 "앞손을 굽힌 채 멈췄다"(C2 불일치, 신뢰도 high)고 판정했다. 정면 카메라에서는 잽이 카메라 쪽으로 뻗어 팔 길이가 보이지 않는다. 1차 실행에서 기준 영상을 잘못 읽게 만든 바로 그 원인이다. 앱은 이 방향 차이(기준 대각선 / 사용자 정면)를 경고하지 않고 신뢰도를 "높음(0.98)"으로 표시했다. 11절에 남은 위험으로 정리했다.

---

## 1. 실제 Gemini 호출 여부

예. Mock 없이 실제 호출했다. Electron 메인 프로세스의 `fetch`를 계측해 `generativelanguage.googleapis.com`으로 나간 HTTP 요청을 직접 셌다. 계측은 URL에서 모델명만 정규식으로 뽑고 URL(API 키 포함)은 기록하지 않았다. 이 보고서와 로그에 API 키는 없다.

- 실행 스크립트: `.devtools/qa-motion3d-gemini-e2e.mjs` (`MARTIALDEX_QA_ALLOW_GEMINI=qa-motion3d-gemini-e2e` 없으면 SKIP)
- 결과 원본: `.devtools/qa-motion3d-gemini-e2e.last.json` (2차 실행)
- AI 엔진 기본값은 `local`이다. 로컬 엔진은 영상 입력을 `LOCAL_UNSUPPORTED_INPUT`으로 거부하므로 테스트 동안에만 `martialdex:ai-engine = gemini`로 두고 끝난 뒤 원래 값으로 복원했다. 새 Gemini 자동 fallback은 추가하지 않았다.

## 2. 사용한 모델

`gemini-3.6-flash` — 기존 설정(`electron/gemini.cjs`의 `GEMINI_MODEL`)을 그대로 썼다. 호출 3건 모두 HTTP 200이어서 기존 보조 모델(`gemini-3.1-flash-lite`, RATE_LIMIT/NETWORK 때만 사용)로는 한 번도 넘어가지 않았다. 재시도도 없었다.

## 3. 평가 기준 생성 결과 (buildReferenceProfile)

### 1차 실행 — 실패 (정면 각도)
- 결과: `matchesTechnique: false`, 관찰 동작 "Guard stance holds / Idle motion". 궤적·팔다리 움직임은 제외 처리.
- `compareAttempt`가 "기준 영상이 잽이 아닌 것으로 분석됨"으로 멈춰서 판정 호출은 나가지 않았다(정상 동작).

### 원인 분석 (추가 API 호출 없이 진행)
1. **녹화 앞부분 손실.** MediaRecorder가 인코더 초기화 중(약 400ms) 받은 프레임을 버렸다. 1,200ms 동작이 728ms 파일이 되어 준비 동작이 잘리고 약 1.6배 빠른 영상이 등록되었다. 프레임 타임스탬프를 직접 지정하는 `MediaStreamTrackGenerator`로도 같은 현상이 재현되었다(30프레임 → 18프레임). 길이 검증(≥ 0.5배)이 느슨해 이 파일이 통과했다.
2. **정면 각도.** 3D 클립을 정면·대각선·측면에서 같은 시각으로 렌더링해 비교했다. 대각선과 측면에서는 0.4–0.5초에 앞손이 완전히 뻗는 모습이 분명히 보였다. 정면에서는 팔이 카메라 쪽으로 뻗어 가드 자세와 거의 구별되지 않았다. 클립 자체(`boxing-jab-m2m-v2`)에는 문제가 없었다.

### 수정 (원본 프로젝트)
- `src/lib/motion3d/recorder.ts`
  - **인코더 예열:** `recorder.start()` 후 첫 데이터가 나올 때까지 첫 프레임을 계속 공급하고, 그다음에 동작을 시작한다. 잘려 나가던 구간은 짧은 정지 구간(lead-in)이 되며, 비교 파이프라인은 이 구간을 이미 idle로 처리한다.
  - 첫 청크까지 걸리는 시간은 새로 띄운 프로세스에서 146–1,268ms로 측정되었다. 처음 둔 1.5초 상한에서는 콜드 녹화 3회 중 2회가 실패해서 상한을 5초로 올리고, 실제로 기다린 시간을 `leadInMs`로 반환하게 했다.
  - **길이 검증 강화:** 파일 길이가 `동작 길이 × 0.9` 이상, `동작 길이 + leadInMs + 1초` 이하여야 한다(`durationAcceptable`). 0.5배 기준은 삭제했다.
- `src/components/formCompare/Motion3dReferenceRecorder.tsx`
  - 고정 목록(`front, side, diagonal`) 대신 클립의 `captureAngles`를 쓴다(후면 포함).
  - **기본 각도를 정면에서 45° 대각선으로** 바꿨다. 정면을 고르면 "정면에서는 카메라 쪽으로 뻗는 동작의 길이가 잘 보이지 않습니다"라는 안내를 표시한다.
- 수정 후 무료 재측정(Gemini 없음, 콜드 프로세스 3회): 3회 모두 성공. lead-in 746–2,322ms, 파일 1,636–1,963ms. 디코딩한 모든 프레임을 확인해 준비 → 뻗기(파일 0.78–0.97초) → 회수 → 가드 복귀가 실제 속도로 모두 들어 있음을 눈으로 확인했다.

> **정정 (Phase 6, 2026-11-15):** 아래 2차 실행의 성공은 일부 운이었다. 3D 마네킹에서는 MediaPipe가 동작 구간을 자주 찾지 못해(대각선 3회 중 3회), 평가 기준용 프레임 10장이 파일 전체에서 균등하게 뽑혔다. 팔을 뻗은 0.25초가 그 안에 들어갈지는 lead-in 길이에 달려 있었다(3회 중 1회는 0장). Phase 6의 같은 조건 실호출에서 실제로 "잽 아님"이 다시 나왔다. 수정과 재검증은 `AI_COACH_3D_POSE_ASSESSMENT_PHASE6_REPORT.md` 참고.

### 2차 실행 — 성공 (대각선, 수정 후 1회)
- 녹화: 대각선, VP9 WebM 147,401바이트, 동작 1,200ms / 파일 1,419ms / lead-in 676ms
- `matchesTechnique: true`, 관찰 동작 "Jab (잽)", `techniqueVisible: true`, 카메라 `diagonal`
- 단계: 준비 자세 → 펀치 뻗기 → 회수 및 복귀, 동작 구간 `active 0.23–0.65`
- 기준 5개:
  - C1 [core·시작 자세] 양손을 턱과 얼굴 높이로 올려 가드를 유지한다.
  - C2 [core·팔다리 움직임] 앞손 주먹이 턱 높이에서 앞으로 일직선에 가깝게 뻗어 나간다.
  - C3 [core·신체 상대 위치] 앞손을 뻗는 동안 뒷손은 턱 옆 가드를 유지한다.
  - C4 [core·궤적] 임팩트 후 앞손이 아래로 떨어지지 않고 같은 궤적으로 빠르게 돌아온다.
  - C5 [support·마무리] 동작 후 양손이 시작과 같은 가드로 완전히 복귀한다.
- 제외 항목: 팔꿈치 완전 신전 여부(사선 각도의 깊이 오차), 체중 이동(접지·전후 이동이 구분되지 않음)
- 저장 후 다시 불러와도 기준 수가 같았다(`profileReloaded: true`).

## 4. AI 판정 결과 (judgeAttempt)

- `sameTechnique: true`, `techniquePerformed: true`
- C1 match/high · **C2 mismatch/high** · C3 partial/medium · C4 partial/medium · C5 match/high
- 잘한 점: 뒷손 가드 유지, 마무리에서 양손이 가드로 정확히 복귀
- 차이점: "정점(U4)에서 앞손을 일직선으로 곧게 뻗지 않고 굽힌 채 멈추었습니다."
- 집중할 점: "앞손 팔꿈치를 과감하게 펴서 주먹을 일직선으로 멀리 뻗기"
- 시간 정렬: DTW, 속도 비 1.93 (속도 차이는 감점 사유가 아님)

**판정 정확도 검토:** 사용자 영상의 정답 데이터(`.devtools/fixtures-form/fixtures.json`, Blender 렌더 값)는 정점 프레임 55에서 앞손 팔꿈치 174.9°, 도달 비율 0.999로 완전히 편 잽이다. 렌더링 시트(`sheets/jab_good.png`)의 f55에서는 주먹이 카메라를 향해 팔이 짧아 보인다. 따라서 C2 불일치는 **정면 촬영 때문에 생긴 오판일 가능성이 높다.** 파이프라인은 정상 동작했지만, 이번 점수가 수행 품질을 정확히 반영한다고 보고하지 않는다.

## 5. 최종 점수 (scoreComparison)

- `status: scored`, **score 50**, rawScore 57, `cap: 50` ("핵심 기준 1개가 기준 영상과 다르고 2개는 부분적으로만 맞습니다.")
- 단계 점수: 준비 자세 100 · 펀치 뻗기 25 · 회수 및 복귀 70
- coverage 1.0, 신뢰도 high (0.98)
- 같은 판정을 `scoreComparison`에 다시 넣으면 50/57/상한 50이 그대로 나온다(`test-form-judgement-robustness.mjs` 마지막 검사). 점수는 AI 판정값으로 결정론적으로 계산된다.

## 6. 실제 호출 횟수와 확인 가능한 비용

| 실행 | 단계 | 모델 | HTTP | 소요 | 입력 토큰 | 출력 토큰 | 합계 |
|---|---|---|---|---|---|---|---|
| 1차 (정면) | 평가 기준 생성 | gemini-3.6-flash | 200 | 6,025ms | 9,869 | 580 | 10,449 |
| 2차 (대각선) | 평가 기준 생성 | gemini-3.6-flash | 200 | 14,736ms | 12,018 | 1,032 | 13,050 |
| 2차 (대각선) | 판정 | gemini-3.6-flash | 200 | 11,669ms | 13,168 | 1,188 | 14,356 |
| **합계** | | | **3건** | | **35,055** | **2,800** | **37,855** |

- 토큰 수는 응답의 `usageMetadata`에서 읽은 실측값이다. `thoughtsTokenCount`는 응답에 없었다.
- **비용(원화/달러)은 확인하지 못했다.** 이 모델의 단가를 검증된 출처로 확인하지 않았고, 청구 대시보드도 조회하지 않았다. 추정 금액을 실제 비용처럼 적지 않는다. Google AI Studio / Cloud Billing의 사용량 화면과 위 토큰 수를 대조해야 한다.
- 2차 실행은 1차 실패의 원인을 무료로 분석하고 수정한 뒤 딱 한 번만 실행했다. 재시도 루프는 없고, 판정 샘플 수는 기본값 1이다.

## 7. 테스트에 사용한 영상의 종류

| 역할 | 영상 | 성격 |
|---|---|---|
| 기준 영상 | 앱 3D 미리보기 녹화 (`boxing-jab-m2m-v2`, 대각선) | 실제 앱 코드로 렌더링·녹화한 파일. 애니메이션은 MARTIALDEX가 Blender에서 키 포즈로 직접 만든 것(모션 캡처 아님) |
| 사용자 영상 | `.devtools/fixtures-form/jab_good.webm` (정면, 4.08초, 24fps) | **Blender로 렌더링한 합성 테스트 영상** (`scripts/blender/form_fixtures/render_jab_fixtures.py`) |

**실제 사람이 카메라로 촬영한 영상으로는 검증하지 않았다.** 이 결과를 "실제 사용자 촬영 영상 검증"으로 표현하지 않는다. 사용자 영상은 업로드와 같은 경로(`sampleVideoBlob`, 12fps, 실제 MediaPipe 포즈 추정)를 거쳤다.

## 8. 기존 영상 비교 파이프라인 실행 결과

3D 기준 영상은 새 채점 경로를 만들지 않고 기존 경로를 그대로 탔다.

`recordPreviewOnce` → `registerMotion3dReference` (`sampleVideoBlob` + IndexedDB 저장) → `ensureProfile` → **`buildReferenceProfile` (실호출)** → 사용자 영상 `sampleVideoBlob` → `compareAttempt` → `blockingIssues` 검사 → `prepareComparison` (DTW 정렬, 프레임 짝, 자세 보조 신호) → **`judgeAttempt` (실호출)** → `finishComparison` → `scoreComparison`

- 사용자 영상: 50프레임 / 50포즈, 동작 구간 1,250–3,667ms (정점 2,833ms), 추정 방향 정면
- 비교 기록에는 `breakdown, judgement, criteria, signals, alignment, viewWarning, poseHints, poseRecordId`가 모두 채워졌다.

**사용자 데이터 보호:** 실제 Electron 프로필로 실행했기 때문에 기준 영상·비교 기록·자세 기록·AI 엔진 설정 4개 키를 시작할 때 원문 그대로 저장하고 끝난 뒤 복원했다. 테스트가 만든 기준 영상 1개는 IndexedDB 미디어까지 삭제했다. 결과: `네_개_키_원상복구: true`, 시작 시 있던 자세 기록 1개 유지. Supabase 요청은 페이지에서 차단해 테스트 기록이 클라우드로 나가지 않았다. 기존 사용자 데이터와 기준 영상은 지우지 않았다.

## 9. 회귀 테스트 결과

| 테스트 | 결과 | 비고 |
|---|---|---|
| `tsc --noEmit` | ✅ | |
| `npm run build` | ✅ | 청크 크기 경고만 (기존과 동일) |
| `test-motion3d.mjs` | ✅ 228/228 | |
| `test-pose-compare3d.mjs` | ✅ 42/42 | |
| `test-pose-coach.mjs` | ✅ 17/17 | |
| `test-coach-exclusive-intents.mjs` | ✅ 24/24 | |
| `qa-motion3d-record-integration.mjs` | ✅ 20/20 × 3회 연속 | 아래 참고 |
| `qa-motion3d-record-ui.mjs` | ✅ 10/10 | 기본 각도 변경 후에도 통과 (측면 선택·저장 확인) |
| **신규** `test-form-judgement-robustness.mjs` | ✅ 16/16 | 아래 참고 |
| `qa-form-compare.mjs` (기존 영상 비교 전체 E2E) | ⏸ 미실행 | 아래 참고 |

- **통합 테스트 수정:** 처음에는 `prepareComparison`에서 `segment`가 null이라 오류가 났다. 이 테스트는 기준 영상 미디어를 "사용자 클립"으로 재사용한다. 정면 녹화가 실제 속도로 녹화되자 MediaPipe가 정면에서 동작 구간을 찾지 못했다. 실제 앱에서는 `compareAttempt`의 `blockingIssues`(no_movement)가 이런 사용자 클립을 먼저 막으므로 앱 결함은 아니다. 테스트를 새 기본값인 대각선 녹화로 바꾸고, 동작 구간이 없으면 실제 앱처럼 막도록 고쳤다.
- **불완전한 AI 응답 처리(신규 테스트):** 라이브 경로의 검증기·파서·채점기를 그대로 써서 확인했다(네트워크 없음). 다음 경우 모두 점수가 나오지 않거나 기준이 상향되지 않는다.
  - 검증기 거부: null, 문자열, criteria 누락, criteria가 배열이 아님, 잘린 JSON → 호출 실패로 처리되어 점수 없음 (`judgeAttempt` → `ok: false` → `compareAttempt`가 그대로 반환)
  - 빈 판정 / 일부 기준만 판정 → 빠진 기준은 정답으로 간주하지 않고 `not_observable` → `insufficient`, 점수 없음
  - 알 수 없는 verdict·confidence → `not_observable` / `low`로 하향
  - 없는 기준 id·중복 id → 무시 / 첫 판정만 채택
  - `techniquePerformed: false`, `sameTechnique: false` → 점수 없음
  - 이를 위해 `src/lib/formCompare/ai.ts`에 테스트 전용 export `__judgementParsingForTests`를 추가했다(동작 변경 없음).
- **`qa-form-compare.mjs`를 실행하지 않은 이유:** 이 스크립트는 실제 Gemini를 여러 번 호출하고 운영 Supabase에 QA 계정을 가입시키며 보이는 Electron 창을 띄운다. Phase 5 변경은 3D 녹화(`recorder.ts`), 3D 녹화 UI, `ai.ts`의 테스트 전용 export뿐이다. 파일·YouTube 기준 영상의 비교 경로(`service.ts`, `scoring.ts`, `motion.ts`, `ai.ts`의 로직)는 바꾸지 않았다. 이 실행에서도 그 공유 경로 전체가 실제 Gemini로 돌았다. 유료 재실행이 필요하다고 판단하면 별도로 승인을 받아 실행한다.

## 10. Electron / Android / Web별 검증 상태

| 플랫폼 | 3D 녹화 | 실제 Gemini 기준 생성·판정·점수 |
|---|---|---|
| **Electron (macOS, Electron 32.3.3)** | ✅ 실제 검증 (자동화, 숨김 창) | ✅ 실제 검증 — 이 보고서 |
| Android (Capacitor WebView) | ❌ 미검증 | ❌ 미검증 (Edge Function `gemini-ask` 경로) |
| Web (브라우저) | ❌ 미검증 | ❌ 미검증 |

Android와 Web은 코드상 같은 경로(`captureStream` + `requestFrame`, 미지원 시 자동 샘플링 fallback)를 쓰지만 실기기·실브라우저 검증은 하지 않았다. 검증 완료로 표시하지 않는다. Android WebView의 `MediaRecorder` VP9/VP8 지원과 인코더 예열 시간은 기기마다 다를 수 있다.

## 11. 미완료 항목 및 남은 위험

1. **방향 차이로 인한 오판 (가장 큰 위험).** 기준이 대각선이고 사용자가 정면일 때 `viewWarning`은 "대각선은 정면·측면과 호환"으로 보고 경고하지 않는다. 신뢰도도 "높음"으로 남는다. 이번 실행에서 올바른 잽이 50점을 받았다. 대응 후보(채점 규칙 변경이므로 이번 단계에서는 임의로 바꾸지 않음):
   - 뻗는 동작(직선 타격)에서 사용자 영상이 정면이면 `limb_motion`·`trajectory` 기준의 신뢰도를 낮추거나 제외한다. 로컬 3D 비교(`test-pose-compare3d` "정면에서는 뻗은 길이를 판단하지 않음")에는 이미 이 규칙이 있다.
   - 촬영 안내에서 사용자에게도 대각선·측면 촬영을 권장한다.
2. **실제 사람 촬영 영상 미검증.** 사용자 영상은 Blender 합성 렌더다. 조명·옷·배경·손떨림이 있는 실제 촬영에서의 정확도는 모른다.
3. **비용 미확인.** 토큰 수만 실측했다(6절).
4. **Android / Web 미검증** (10절).
5. **녹화 lead-in 길이.** 콜드 프로세스의 첫 녹화는 최대 약 2.3초의 정지 구간이 앞에 붙는다. 프로필의 `active` 구간과 DTW가 처리하지만, 저사양 기기에서 5초 상한을 넘으면 "인코더가 프레임을 받지 못했습니다"로 실패한다(잘린 파일을 등록하지 않고 실패로 처리).
6. **백그라운드 녹화.** 녹화 중 창을 가리거나 최소화하는 경우는 검증하지 않았다. Phase 4 보고서의 "백그라운드에서도 잘리지 않는다"는 문장은 틀린 주장이어서 그 보고서에 정정을 달았다.
7. **AI 엔진 기본값이 `local`.** 영상 비교를 쓰려면 사용자가 Gemini 엔진을 직접 선택해야 한다. 로컬 엔진은 이유를 밝히고 거부한다. 의도된 동작(자동 fallback 금지)이지만 UI 안내가 충분한지는 따로 확인해야 한다.
8. **판정 샘플 1회.** 경계 사례는 실행마다 판정이 바뀔 수 있다(`samples: 2` 옵션이 있지만 할당량 때문에 기본값은 1).

## 변경 파일

- `src/lib/motion3d/recorder.ts` — 인코더 예열(적응형, 상한 5초), `leadInMs`, 길이 검증 강화
- `src/components/formCompare/Motion3dReferenceRecorder.tsx` — 클립의 `captureAngles` 사용, 기본 대각선, 정면 안내
- `src/lib/formCompare/ai.ts` — 테스트 전용 export
- `.devtools/qa-motion3d-gemini-e2e.mjs` — 각도 설정(기본 대각선), lead-in 기록
- `.devtools/qa-motion3d-record-integration.mjs` — 대각선 녹화, 실제 앱과 같은 동작 구간 차단
- `.devtools/test-form-judgement-robustness.mjs` — 신규
- `docs/AI_COACH_3D_POSE_ASSESSMENT_PHASE4_REPORT.md` — 백그라운드 녹화 주장 정정
