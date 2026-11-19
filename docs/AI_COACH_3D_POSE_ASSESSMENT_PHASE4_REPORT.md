# Phase 4 — 3D 녹화 UI 연결 및 End-to-End 검증

작성 2026-11-15 · 작업 위치 `/Users/swcho/Documents/MARTIALDEX` (원본)
백업 `/Users/swcho/Documents/MARTIALDEX_backups/phase4-3dui-20261115-141657` (SHA-256 검증, 837/837 파일, 읽기전용)

> 각 항목을 **① 코드 구현 ② 자동화 테스트 ③ 실제 플랫폼 검증**으로 구분한다.
> 실행하지 못한 것은 미완료로 적었다.

---

## 0. 요약

| | 상태 |
|---|---|
| 실제 UI 연결 | **완료** — 실제 클릭 흐름 10/10 |
| 실제 녹화·기준 영상 등록 | **완료** — 3회 연속 안정 |
| 기존 엔진의 점수 산출 | **부분** — `scoreComparison` 실측 완료, AI 판정 2단계는 유료 Gemini라 **미실행** |
| Electron | 검증 완료 |
| Android / Web | **미검증** |

---

## 1. 실제 UI 연결

### 구조상 발견 — 연결 위치를 바꿨다

Phase 3 보고서는 `PoseAnalysisModal`을 연결 지점으로 적었지만, 코드를 다시 확인하니
**영상 유사도 채점은 그 모달에 없다.**

```
PoseAnalysisModal   카메라 촬영 + 관절 채점 (3D면 poseCompare3d, 아니면 규칙 기반 analyzeTechnique)
FormCompareModal    기준 영상 등록 + 영상 유사도 채점  ← 요구사항이 말하는 "기존 영상 비교 엔진"
```

`PoseAnalysisModal`의 `video` 기준도 `analyzeTechnique`(규칙 기반)로 가며 영상 비교 엔진을
쓰지 않는다. 따라서 3D 녹화를 기존 영상 비교 엔진에 태우려면 **기준 영상을 등록하는
`FormCompareModal`에 붙이는 것이 맞다.** 그곳의 YouTube·파일 등록과 나란히 세 번째 종류로 추가했다.

### 사용자 흐름

```
기술 상세 → 자세 분석 → "기준 시연 영상과 비교해 평가하기 (AI 비교)"
  → 기준 시연 영상 등록: [YouTube 주소] [영상 파일] [3D 시연 녹화]   ← 3D 클립이 있는 기술에만 표시
      → 각도 선택 (정면 / 측면 / 대각선)
      → "측면에서 3D 기준 영상 녹화"
      → 준비 중 → 3D 미리보기를 녹화하는 중 → 녹화를 마무리하는 중
        → 녹화한 영상을 검증하는 중 → 기준 영상으로 등록하는 중 → 등록 완료
  → (기존 흐름 그대로) 평가 기준 생성 → 촬영 → 분석 → 결과
```

### 변경 파일

| 파일 | 변경 |
|---|---|
| `src/components/formCompare/Motion3dReferenceRecorder.tsx` | **신규** — 각도 선택, 3D 미리보기, 녹화 버튼, 단계 표시 |
| `src/components/formCompare/FormCompareModal.tsx` | 등록 종류에 `motion3d` 추가 (3D 클립이 있을 때만) |
| `src/lib/motion3d/recorder.ts` | 프레임 수동 푸시로 안정화 (아래 3절) |

Phase 3의 `recordPreviewOnce()` / `registerMotion3dReference()` / `isPreviewRecordingSupported()` /
`hasLocalMedia()`를 **그대로 재사용**했다. 별도 녹화 엔진이나 등록 모듈을 만들지 않았다.

### 안전장치

- **중복 클릭 방지** — `runningRef` 가드 + 진행 중 버튼 비활성화. 실측: 녹화 버튼을 두 번 눌러도 기준 영상은 **정확히 1개**만 등록됨.
- **모달 종료 시 정리** — `AbortController`를 `recordPreviewOnce`의 `signal`로 전달.
- **3D 없는 기술** — `motionClipsFor(id).length === 0`이면 "3D 시연 녹화" 선택지 자체를 띄우지 않음.
- **녹화 미지원 환경** — `isPreviewRecordingSupported()`가 false면 명확한 오류를 표시하고 등록하지 않음.
- **조용한 fallback 없음** — 녹화가 실패하면 실패 메시지만 띄우고 관절 비교 엔진으로 넘어가지 않는다. 기존 관절 비교 엔진(`poseCompare3d`)은 삭제하지 않았고 `PoseAnalysisModal`에서 기존처럼 동작한다.

---

## 2. 실제 녹화 및 기준 영상 등록

`.devtools/qa-motion3d-record-integration.mjs` — 실제 Electron(Chromium)의 WebGL·MediaRecorder·IndexedDB.
**3회 연속 실행 모두 20/20 통과.**

- 녹화 Blob 4096B 초과, 디코딩 가능, 길이가 애니메이션(1200ms)과 일치
- `motion3d` 종류로 등록, 클립 id·각도 보존
- `sampleVideoBlob`이 실제로 프레임 샘플링
- 재조회 시 `motion3d`로 식별, 프레임·포즈·**원본 파일 보존** (Blob URL 만료와 무관)

---

## 3. 이번에 발견·수정한 결함 — 녹화 길이 불안정

Phase 3 직후 같은 테스트를 다시 돌리자 1200ms 클립이 **396ms**로 녹화됐다
(Phase 3 첫 실행에선 35ms). 같은 코드가 통과와 실패를 오갔다.

원인: 숨겨진 창에서 브라우저가 페이지를 **합성(composite)하지 않으면**,
`captureStream(30)`의 자동 샘플링이 새 프레임을 받지 못한다. rAF도 같은 이유로 멈추거나 느려진다.

수정 (`recorder.ts`):
1. `captureStream(0)` + 렌더할 때마다 `track.requestFrame()` — **프레임을 직접 밀어 넣는다.** 합성 여부와 무관하다. 캔버스 녹화의 표준 방식이다.
2. 프레임 간격을 rAF 대신 `setTimeout`으로 구동.
3. `requestFrame()`이 없는 런타임을 위한 자동 샘플링 폴백 유지.

수정 후 3회 연속 안정. ~~**사용자가 녹화 도중 앱을 다른 창 뒤로 보내도 녹화가 잘리지 않는다.**~~

> **정정 (Phase 5, 2026-11-15):** 위 문장은 틀렸다. "3회 연속 안정"은 파일 길이가 당시의 느슨한 기준(동작 길이의 0.5배 이상)을 통과했다는 뜻일 뿐이었다. Phase 5 실측에서 1200ms 동작이 728ms 파일로 녹화되었다 — MediaRecorder가 인코더 초기화 중(약 400ms) 받은 프레임을 버려 준비 동작이 잘리고 약 1.6배 빠른 영상이 되었다. 백그라운드 창 여부와 무관하게 발생했고, 백그라운드 상태에서 녹화가 온전하다는 것은 검증된 적이 없다. 수정과 재검증은 `AI_COACH_3D_POSE_ASSESSMENT_PHASE5_FINAL_VALIDATION_REPORT.md` 참고.
잘렸더라도 `validating` 단계가 `duration_mismatch`로 거부해 잘못된 기준 영상은 등록되지 않는다.

---

## 4. 기존 영상 비교 엔진의 점수 산출

### 유료 호출 때문에 일부를 실행하지 않았다

```
buildReferenceProfile()   askGeminiForJson()  ← 유료 Gemini   (ai.ts:97)
judgeAttempt()            askGeminiForJson()  ← 유료 Gemini   (ai.ts:204)
```

새 유료 호출을 자동 실행하지 않는다는 원칙에 따라 이 두 단계는 **실행하지 않았다.**
기획서 §5 "AI 호출을 실행하지 못했다면 점수 산출 완료로 보고하지 않는다"에 따라
**점수 산출 완료로 보고하지 않는다.**

### 실행한 것 — AI 경계 양쪽을 실제 데이터로

| 단계 | 실행 | 데이터 |
|---|---|---|
| 녹화 → File | **실제** | 실제 WebGL 렌더 |
| `registerMotion3dReference` → `sampleVideoBlob` | **실제** | 실제 녹화 파일 |
| 저장·재조회 (`getMedia`) | **실제** | 실제 IndexedDB |
| `buildReferenceProfile` | **미실행** (유료) | 평가 기준을 스텁으로 대체 |
| `prepareComparison` → `alignTimes` | **실제** | 실제 녹화 미디어 |
| `judgeAttempt` | **미실행** (유료) | AI 판정을 스텁으로 대체 |
| `scoreComparison` | **실제** | 스텁 판정 + 실제 시그널 |

결과: `prepareComparison`이 녹화 미디어로 실제 정렬(단계별 시각 생성)을 수행했고,
`scoreComparison`이 **실제 숫자 점수**를 반환했다. 즉 기존 엔진은 `motion3d` 기준 영상을
**일반 파일 기준 영상과 구분 없이** 처리한다.

남은 한 칸은 "실제 Gemini가 녹화 영상으로 평가 기준을 만들고 판정한다"이다.
이것은 YouTube·파일 기준 영상도 똑같이 거치는 **기존 설계의 단계**이며, 이번 작업이 새로 만든 의존성은 아니다.

### 사용자 촬영 영상

테스트 환경에 카메라가 없어, 같은 파이프라인(`sampleVideoBlob`)으로 추출된 실제 미디어를
사용자 클립 자리에 넣었다. 프레임·포즈·시그널의 **형태와 처리 경로는 실제 촬영과 동일**하지만,
**사람이 실제로 촬영한 영상으로 돌린 것은 아니다.**

---

## 5. 자동화 테스트 결과

| 테스트 | 종류 | 결과 |
|---|---|---|
| `qa-motion3d-record-integration` | 실브라우저 통합 (녹화·등록·재조회·엔진) | **20/20** ×3회 |
| `qa-motion3d-record-ui` | 실브라우저 UI 클릭 흐름 | **10/10** |
| `test-motion3d` | 회귀 | 228/228 |
| `test-pose-compare3d` | 회귀 (기존 관절 엔진) | 42/42 |
| `test-pose-coach` | 회귀 | 17/17 |
| `tsc --noEmit` | 타입 | 0 오류 |
| `npm run build` | 빌드 | 성공 |

UI 테스트에서 처음 2건이 실패했는데 둘 다 **테스트 쪽 오류**였다.
- 진입 버튼 개수를 렌더 전에 셌음 → `waitFor`로 수정
- `boxing__jab`으로 들어갔는데 `kickboxing__jab`으로 저장됨 → 기존 `technique-canonical.json`이 두 id를 `kickboxing__jab`으로 합친다. 기존 YouTube·파일 기준 영상도 같은 규칙으로 저장되므로 **제품 동작이 맞고 테스트 기대값이 틀렸다.**

### 테스트 안전성

UI 테스트의 첫 버전이 자동 승인에서 거부됐다 — `localStorage`의 기준 영상 목록을 **통째로 지우는**
코드였고, Electron은 **사용자의 실제 프로필**로 실행된다. 비파괴 방식으로 다시 썼다:
시작 시 기존 id를 기록하고, **테스트가 만든 id만** `deleteReference()`로 지운다.
실행 후 "기존 기준 영상 유지" 확인을 출력한다. 실행 전 읽기 전용으로 확인한 결과 실제 프로필의
기준 영상은 0건이었고, 앞선 테스트들이 남긴 흔적도 없었다.

---

## 6. 플랫폼별 검증

| | 코드 구현 | 자동화 테스트 | 실기기 |
|---|---|---|---|
| **Electron (macOS)** | 완료 | **통과** (통합 20/20, UI 10/10) | **완료** — 실제 Electron에서 실행 |
| **Web** | 완료 | 미실행 | **미검증** |
| **Android WebView** | 완료 | 미실행 | **미검증** |

- `MediaStreamTrack.requestFrame()`과 `canvas.captureStream()`의 Android WebView 지원은
  **실기기에서 확인하지 않았다.** 미지원이면 `requestFrame` 없음 → 자동 샘플링 폴백,
  `captureStream` 없음 → "녹화를 지원하지 않습니다" 표시 후 등록 거부. 어느 경우에도 잘못된 기준 영상은 등록되지 않는다.
- Web은 Electron과 같은 Chromium 계열이면 동일하게 동작할 가능성이 높지만, 별도로 확인하지 않았다.

---

## 7. 회귀

| 항목 | 결과 |
|---|---|
| 기존 자세 측정 (PoseAnalysisModal) | 변경 없음, 관련 테스트 통과 |
| 기존 관절 비교 엔진 | 42/42, 삭제하지 않음 |
| 파일·YouTube 기준 등록 UI | 코드 변경 없음 (종류 선택에 칩 하나 추가) |
| 3D 없는 기술 | 함수 수준 확인 — 선택지 미표시 |
| 중복 클릭 | UI 테스트로 확인 — 1건만 등록 |
| 저장된 기준 영상 재사용 | 통합 테스트로 확인 — 재조회 시 원본 파일 포함 |

**실제 YouTube·파일 기준 영상으로의 채점 회귀는 실행하지 않았다** — 그 경로도 유료 Gemini 두 단계를 거친다.
해당 경로의 코드는 이번에 `hasLocalMedia()` 분기(Phase 3)와 등록 칩 추가 외에 바뀌지 않았다.

---

## 8. 남은 문제 및 위험

1. **점수 산출의 AI 판정 단계 미실행.** 실제 Gemini 호출 한 번이면 확인된다. 실행 여부는 사용자가 정할 일이다.
2. **사람이 직접 촬영한 영상으로 미검증.** 카메라 있는 환경에서 한 번 돌려봐야 한다.
3. **Android / Web 실기기 미검증.**
4. **3D 없는 기술의 UI 확인은 함수 수준.** 자세 분석을 지원하면서 3D 클립이 없는 기술로 UI를 열어보지 못했다(테스트에 쓴 `boxing__shoulder-roll`은 자세 분석 진입이 없었다).
5. **녹화본은 원본보다 해상도가 고정**된다(뷰어 크기). `sampleVideoBlob(fps: 12)`가 다시 샘플링하므로 실용상 문제는 작을 것으로 보이나 측정하지 않았다.
