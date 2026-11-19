# Phase 2 — 3D 프리뷰 기반 자세 측정 실사 보고서

작성 2026-11-15 · 작업 위치 `/Users/swcho/Documents/MARTIALDEX` (원본)
백업 `/Users/swcho/Documents/MARTIALDEX_backups/phase2-3dpose-20261115-135654` (SHA-256 검증, 읽기전용)

> **이 보고서는 조사 결과만 담는다.** 기획서 §작업원칙 "조사 결과를 확인하기 전에
> 새로운 구현을 시작하지 않는다"에 따라 **코드는 한 줄도 수정하지 않았다.**

---

## 1. 결론부터

**요구한 방식은 구현되어 있지 않다.** UI·각도 선택·측정·점수는 모두 동작하지만,
채점 방식이 요구사항과 근본적으로 다르다.

| 요구사항 | 실제 구현 |
|---|---|
| 3D 프리뷰 **렌더링 영상을 녹화** | **녹화 없음** — 캔버스 캡처 코드가 존재하지 않음 |
| 녹화 파일을 **기준 영상으로 등록** | 등록 없음 — `ReferenceSource`에 `motion3d` 종류 자체가 없음 |
| **기존 영상 유사도 파이프라인** 재사용 | 재사용 안 함 — **별도의 관절 좌표 비교 엔진**이 동작 |

기획서 §2가 명시적으로 금지한 **"관절 좌표를 직접 비교하는 별도 채점 방식"** 이
현재 구현된 방식이다.

---

## 2. 기존 구현 구조 (실제 코드 추적)

### 2-1. 두 개의 독립된 채점 경로

```
[경로 A] 기준 영상 비교  ─ 요구사항이 말하는 "기존 방식"
  FormCompareModal.tsx
    └ formCompare/service.ts
        registerYoutubeReference() / registerFileReference()
        └ clipCapture.sampleVideoBlob()   영상 → 프레임 + 포즈 샘플링
        └ ai.buildReferenceProfile()      기준 영상에서 평가 기준 생성
        └ compareAttempt()
            ├ motion.alignTimes()         두 영상 시간 정렬
            ├ ai.judgeAttempt()           프레임 쌍 비교 (AI)
            └ scoring.scoreComparison()   점수 산출
  기준 영상 종류: formCompare/types.ts
    ReferenceSource = { kind: 'youtube' … } | { kind: 'file' … }
                      ↑ motion3d 없음

[경로 B] 3D 기준 관절 비교  ─ 현재 3D 프리뷰가 쓰는 방식
  PoseAnalysisModal.tsx:129
    if (reference.kind === 'motion3d' && pick3d) {
      const track = engineRef.current.referencePose(angle, REF_SAMPLE_FPS)
                    ↑ 3D 클립의 관절 좌표를 뽑는다 (영상 아님)
      compareToReference({ frames, …, reference: track, … })
                    ↑ poseCompare3d/compare.ts — DTW 관절 비교
      toAnalysisResult() → saveAnalysisResult(method: 'reference_3d')
    } else {
      analyzeTechnique(…)  → method: 'landmark'   (규칙 기반)
    }
```

**두 경로는 서로 호출하지 않는다.** 경로 B는 경로 A의 전처리(`sampleVideoBlob`),
정렬(`alignTimes`), 채점(`scoreComparison`)을 전혀 쓰지 않는다.

### 2-2. 경로 B가 실제로 하는 일

`src/lib/poseCompare3d/compare.ts` 파일 상단 주석이 그대로 설명한다.

> "the learner's MediaPipe joints (one capture window) against **the clip's own joints**
> (referencePose.ts, same camera angle, same length) … normalised … resampled onto one
> 0–1 timeline and aligned with **banded DTW**"

즉 **사용자 관절 ↔ 3D 클립 관절**의 직접 비교다. 영상은 어느 쪽에도 등장하지 않는다.
점수는 `ERR_FULL 0.08 / ERR_ZERO 0.4` (torso-length 단위)로 산출되며, 경로 A의
`scoreComparison()`과 **다른 점수 체계**다.

---

## 3. §3 검증 항목별 결과

| 검증 항목 | 결과 | 근거 |
|---|---|---|
| 카메라 각도가 실제 렌더링에 적용되는가 | **예** | `engine.ts` `PRESET_OFFSET = ANGLE_OFFSET_DEG`, 프리뷰와 기준 관절이 같은 표를 공유 |
| 애니메이션이 정확히 1회 재생되는가 | **해당 없음** | 재생은 미리보기용이고, 채점은 재생과 무관하게 `referencePose()`가 관절을 샘플링한다 |
| 재생 중 실제 영상 캡처가 이루어지는가 | **아니오** | `canvas.captureStream` 호출이 코드베이스에 **0건** |
| 캡처 결과가 영상 파일로 생성되는가 | **아니오** | 위와 동일 |
| 파일이 기준 영상으로 등록되는가 | **아니오** | `ReferenceSource`에 `motion3d` 종류 없음 |
| 기존 채점 파이프라인에 전달되는가 | **아니오** | 경로 B가 `formCompare/*`를 import하지 않음 |
| 사용자 영상과 동일한 전처리·비교 | **아니오** | 사용자 쪽도 영상이 아니라 MediaPipe 관절 프레임을 쓴다 |
| 프레임 속도·길이·해상도 차이 처리 | **부분** | 관절 기준으로는 처리됨 (`BINS 40` 리샘플 + DTW, `aspect` 보정). 영상 차원에서는 해당 없음 |
| 녹화 실패와 저장 실패 구분 | **해당 없음** | 녹화가 없다. 대신 "3D 기준 관절을 만들지 못했습니다" 오류 1종만 존재 |

### 플랫폼별

| | 3D 프리뷰(WebGL) | `canvas.captureStream` | `MediaRecorder` |
|---|---|---|---|
| Electron | 동작 | 미사용(가능) | 사용 중(카메라·스파링 클립) |
| Web | 동작 | 미사용(가능) | 사용 중 |
| Android(WebView) | 동작 | 미사용(가능) | 사용 중 |

`isLowEndDevice()`와 `MotionLoadErrorKind: 'webgl'`로 WebGL 미지원 기기는 이미 구분해
안내한다. **녹화 미지원 안내는 없다 — 녹화 기능 자체가 없기 때문이다.**

---

## 4. 구현한다면 — 조사로 확인된 접착 지점

(아직 구현하지 않았다. 승인 후 진행할 사항.)

1. **녹화원**: `MotionEngine`이 `WebGLRenderer`를 직접 보유하고
   `renderer.domElement`(`data-testid="motion3d-canvas"`)를 컨테이너에 붙인다
   (`engine.ts:163–170`). 이 캔버스에 `captureStream()`을 걸 수 있다.
   렌더 루프는 `engine.ts:438`의 `renderer.render()`다.
2. **등록 경로**: `formCompare/service.ts:70 registerFileReference()`가
   `{ file: File … }`를 받는다. 녹화 Blob을 `File`로 감싸면 **기존 경로 A에
   그대로 투입**된다 — `sampleVideoBlob` → `buildReferenceProfile` → `compareAttempt`.
3. **타입**: `ReferenceSource`에 `{ kind: 'motion3d'; clipId; angle; … }`를 추가해
   출처를 구분해야 한다(파일로 위장하면 재생성이 불가능해진다).
4. **기존 기능 보존**: 경로 B(`poseCompare3d`)는 **제거하지 않는다.** 기획서 §18-2가
   "관절 분석을 보조 기능으로 쓰는 것은 별도 검토 가능"이라 했고, 3D 애니메이션이
   없는 기술은 기존 방식을 유지해야 한다(§18-4).

---

## 5. 수정한 파일

**없음.** 조사만 수행했다.

---

## 6. 미해결 / 추가 검증 필요

1. **요구사항의 핵심 기능이 미구현 상태다.** 위 4절이 구현 계획의 출발점이다.
2. `canvas.captureStream()`의 **Android WebView 실동작 미확인**. 코드베이스에
   선례가 없어 실기기 검증이 필요하다. `clipExtractor.ts:26` 주석에 Electron에서
   `MediaRecorder`가 조용히 빈 녹화를 만든 전례가 기록되어 있어, 같은 함정을
   캔버스 녹화에서도 확인해야 한다.
3. 녹화 영상과 사용자 촬영 영상의 **해상도·프레임률 차이**가 `sampleVideoBlob(fps: 12)`
   전처리에서 어떻게 흡수되는지 실측 필요.
4. 3D 클립에 `measure`가 없는 기술의 처리(현재 경로 B는 `pick3d.clip.measure!`로
   non-null 단언한다 — 녹화 방식으로 바꾸면 이 제약이 사라지는지 확인 필요).

---

## 7. UI만 보고 판단하지 않았다는 근거

기획서가 "UI만 확인한 것을 전체 기능 성공으로 보고하지 않는다"고 했으므로,
판단 근거를 코드 위치로 남긴다.

- 녹화 부재: `grep -rn "captureStream" src/` → `clipExtractor.ts`(영상 엘리먼트)와
  `sparringSessionService.ts`만 일치. 캔버스 캡처 0건.
- 경로 분리: `PoseAnalysisModal.tsx:129–149`의 `if/else`가 두 채점을 가른다.
- 타입 부재: `formCompare/types.ts:12–14`의 `ReferenceSource` 유니온.
- 관절 비교: `poseCompare3d/compare.ts:1–12` 주석 및 `compareToReference()` 본문.
