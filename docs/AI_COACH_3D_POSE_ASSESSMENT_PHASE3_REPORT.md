# Phase 3 — 3D 프리뷰 실제 녹화 · 기존 영상 비교 엔진 통합

작성 2026-11-15 · 작업 위치 `/Users/swcho/Documents/MARTIALDEX` (원본)
백업 `/Users/swcho/Documents/MARTIALDEX_backups/phase3-3drecord-20261115-140127` (SHA-256 검증, 836/836 파일, 읽기전용)

> 본 보고서는 **① 코드 구현 완료 ② 자동화 테스트 통과 ③ 실제 플랫폼 검증 완료**를
> 구분해 적는다. ③을 충족하지 못한 항목은 미완료로 명시했다.

---

## 1. 수정한 파일

| 파일 | 변경 |
|---|---|
| `src/lib/motion3d/recorder.ts` | **신규** — 캔버스 녹화, 상태 전이, 검증 |
| `src/lib/motion3d/engine.ts` | `canvas` / `isPlaying` / `currentTime` 접근자, **`renderAt()`** 추가 |
| `src/lib/formCompare/types.ts` | `ReferenceSource`에 `motion3d` 추가, **`hasLocalMedia()`** 판별 함수 |
| `src/lib/formCompare/service.ts` | **`registerMotion3dReference()`** 추가, 로컬 미디어 분기 2곳 수정 |
| `src/components/formCompare/FormCompareModal.tsx` | 기준 영상 재생 분기 수정 |
| `.devtools/qa-motion3d-record-integration.mjs` | **신규** — 실브라우저 통합 검증 |

백업과 직접 대조해 위 5개 외 `src/` 변경이 없음을 확인했다.

---

## 2. 녹화부터 점수 산출까지 실제 호출 흐름

```
PoseAnalysisModal (3D 기준 선택 + 각도 선택)
  └ motion3d/recorder.ts  recordPreviewOnce(engine, { angle })
      preparing   pickRecordMimeType() / canvas.captureStream 지원 확인
                  engine.setCamera(angle) · setLoop(false) · seek(0) · renderAt(0)
      recording   canvas.captureStream(fps) → 비디오 트랙만 → MediaRecorder.start(100)
                  rAF 루프가 실시간으로 engine.renderAt(elapsed) 호출 (0 → duration, 1회)
      finalizing  recorder.stop() → Blob
      validating  크기 ≥ 4096B · 디코딩 가능 · 길이 대조
                  → File(`motion3d-<angle>-<ts>.webm`)
  └ formCompare/service.ts  registerMotion3dReference(t, { file, clipId, angle, … })
      registering sampleVideoBlob(file, { fps: 12 })   ← 기존 파일 기준 영상과 동일 함수
                  putMedia({ frames, poses, signals, file })
                  saveReference({ source: { kind: 'motion3d', … } })
      ready
  └ 이후 채점 (기존 경로 그대로)
      ensureProfile()      hasLocalMedia → getMedia → cropToPerson → buildReferenceProfile
      compareAttempt()
        prepareComparison()  hasLocalMedia → getMedia → alignTimes()
        judgeAttempt()
        scoreComparison()
```

**`poseCompare3d/compare.ts`는 이 경로에 등장하지 않는다.**

---

## 3. 기존 채점 엔진 재사용 근거

`registerMotion3dReference()`는 `registerFileReference()`와 **같은 함수들을 같은 순서로**
호출한다 — `sampleVideoBlob` → `putMedia` → `saveReference`. 이후 채점은 기존
`ensureProfile` / `prepareComparison` / `compareAttempt`가 그대로 처리한다.
`scoreComparison()`에 손대지 않았으므로 **점수 체계가 동일하다.**

분기가 `kind === 'file'`로 흩어져 있어 motion3d가 조용히 누락되던 지점 3곳을
`hasLocalMedia(source)` 한 함수로 모았다. 종류를 더 추가해도 같은 버그가 재발하지 않는다.

---

## 4. 실제 생성 파일 검증 결과

통합 테스트가 실제 Electron(Chromium) 안에서 확인한 값:

- 녹화 성공, 상태 전이 `preparing → recording → finalizing → validating` 설계와 일치
- Blob 크기 4096B 초과 (빈 녹화 아님)
- 디코딩된 길이가 애니메이션 길이(1200ms)와 허용 범위 내 일치
- 파일명에 선택 각도 반영 (`motion3d-front-…`)
- `sampleVideoBlob`이 실제로 프레임을 샘플링 (progress 콜백 발생)
- 저장 후 재조회 시 `kind === 'motion3d'`로 식별, 프레임·포즈·**원본 파일 보존**

원본 File을 IndexedDB에 함께 저장하므로 **Blob URL 만료와 무관**하다.

---

## 5. 구현 중 발견·수정한 실제 결함

첫 실행에서 1200ms 클립이 **35ms 파일**로 녹화됐다.

원인: `engine.startLoop()`이 `suspended.hidden || suspended.offscreen`이면 조기 반환한다.
창이 숨겨져 있거나 뷰어가 화면 밖이면 **렌더 루프가 아예 돌지 않아** 캔버스가 갱신되지
않고, MediaRecorder는 사실상 빈 영상을 만든다.

수정: 녹화 중에는 레코더가 `engine.renderAt(t)`로 **프레임을 직접 구동**한다. 덕분에
사용자가 녹화 도중 앱을 백그라운드로 보내도 녹화가 조용히 잘리지 않는다.
(`clipExtractor.ts:26`이 기록한 "Electron MediaRecorder가 조용히 빈 녹화를 만든다"와
같은 계열의 함정이다.)

이 결함이 잡히지 않았다면 **짧고 깨진 기준 영상이 등록됐을 것이다.** 검증 단계가
`duration_mismatch`로 거부해 잘못된 기준 영상 등록을 막았다.

---

## 6. 테스트 결과

### 통합 (실브라우저 — Electron/Chromium, 실제 WebGL·MediaRecorder·IndexedDB)
`.devtools/qa-motion3d-record-integration.mjs` — **17/17 통과**

### 회귀 (기존 기능)
| 테스트 | 결과 |
|---|---|
| `test-motion3d` | 228/228 |
| `test-pose-compare3d` (기존 관절 비교 엔진) | 42/42 |
| `test-pose-coach` | 17/17 |

### 타입·빌드
`npx tsc --noEmit` 오류 0 · `npm run build` 성공 (1m 3s)

---

## 7. 플랫폼별 검증 수준

| | 코드 구현 | 자동화 테스트 | 실기기 검증 |
|---|---|---|---|
| **Electron (macOS)** | 완료 | **통과 (17/17)** | 완료 — 실제 Electron에서 실행 |
| **Web (브라우저)** | 완료 | 미실행 | **미검증** |
| **Android WebView** | 완료 | 미실행 | **미검증** |

- Electron은 Chromium이므로 Web도 동일하게 동작할 가능성이 높지만 **별개로 확인하지 않았다.**
- Android WebView의 `canvas.captureStream()`은 **코드베이스에 선례가 없고 실기기에서
  확인하지 않았다.** 지원하지 않으면 `isPreviewRecordingSupported()`가 false를 반환하고
  "이 환경에서는 3D 미리보기 녹화를 지원하지 않습니다"를 표시하며, **잘못된 기준 영상을
  등록하지 않는다.**

---

## 8. 완료 판정 (§9 기준)

| 기준 | 상태 |
|---|---|
| 1. 실제 3D 렌더링 화면 녹화 | **충족** (Electron 실측) |
| 2. 실제 영상 파일 생성 | **충족** |
| 3. motion3d 기준 영상 등록 | **충족** |
| 4. 저장 후 재조회 | **충족** |
| 5. 사용자 영상과 함께 기존 파이프라인 전달 | **부분** — 기준 영상 측 전달은 실측 확인. 사용자 촬영 영상과의 **실제 대조 실행은 미검증**(아래 9절) |
| 6. 기존 엔진에서 점수 산출 | **미검증** — 코드 경로는 연결됐으나 end-to-end 점수 산출을 실행하지 않음 |
| 7. 기존 기능 유지 | **충족** (회귀 287건 통과) |

---

## 9. 남은 문제 및 위험

1. **end-to-end 점수 산출 미검증.** 사용자 촬영 영상이 필요한데 테스트 환경에 카메라가
   없다. `compareAttempt()`는 `judgeAttempt()`에서 AI 호출을 하므로, 검증하려면 실제
   촬영 + 모델 호출이 필요하다. **"기존 엔진에서 점수가 나온다"를 실측하지 못했다.**
2. **PoseAnalysisModal UI 미연결.** 녹화 → 등록 함수는 완성했지만, 모달에서 "3D 기준으로
   녹화하기"를 누르는 **UI 흐름은 붙이지 않았다.** 현재 3D 선택 시에는 여전히 기존 관절
   비교 경로(`poseCompare3d`)가 동작한다. 이것이 사용자가 체감하는 동작을 바꾸는
   마지막 단계이며 **미완료다.**
3. Android/Web 실기기 미검증 (7절).
4. 녹화 fps가 `captureStream(30)` 고정이다. 저사양 기기에서 실제 렌더가 30fps에 못 미치면
   파일 길이는 맞지만 프레임이 성길 수 있다. `sampleVideoBlob(fps: 12)`가 다시 샘플링하므로
   실용상 문제는 작을 것으로 보이나 측정하지 않았다.

---

## 10. 다음 작업 제안

가장 중요한 것은 **2번(UI 연결)**이다. 이것이 없으면 사용자 입장에서는 아무것도 바뀌지
않는다. 그 다음이 1번(실제 점수 산출 확인), 그 다음이 플랫폼 검증이다.
