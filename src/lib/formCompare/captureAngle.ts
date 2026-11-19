import type { CameraView, ReferenceVideo } from './types';

// Phase 6 — 기준 영상의 촬영 각도와 사용자 촬영의 시점 일치 여부.
//
// 원칙: 각도를 고르는 것은 사용자이고, 사용자 영상도 사용자가 그 각도에 맞춰 직접 촬영한다.
// 이 모듈은 (1) 기준 각도를 알려 주고 (2) 촬영된 영상이 그 각도와 맞는지 "확인"만 한다.
// 영상의 시점을 바꾸거나 맞추는 일은 하지 않는다.
//
// 로컬 자세 추정(estimateCameraView: 어깨 너비 / 몸통 길이)은 카메라 위치가 아니라
// 카메라에 대한 "몸통 방향"을 잰다. 복싱 스탠스처럼 몸을 비스듬히 세우면 값이 밀린다.
// 실측(Phase 6): 3D 녹화 front→front, diagonal→side, side→diagonal, back→front.
// 그래서 사용자 영상의 추정값은 명목 각도가 아니라 "같은 추정기로 잰 기준 영상의 값"과
// 비교하고(같은 편향끼리), 분명히 다를 때(정면 ↔ 측면)만 불일치로 의심한다.

export type ViewStatus = 'match' | 'mismatch' | 'unknown';
export type LocalViewRelation = 'consistent' | 'unclear' | 'mismatch' | 'unknown';
export type AiViewRelation = 'same' | 'different' | 'uncertain';

export const ANGLE_NAME: Record<CameraView, string> = { front: '정면', diagonal: '45° 대각선', side: '측면', back: '후면', unknown: '알 수 없음' };

export interface AngleGuide {
  /** Where to put the camera, relative to the direction the user faces. */
  placement: string;
  /** What the user should see on screen once placed correctly. */
  onScreen: string;
}

export const ANGLE_GUIDE: Record<Exclude<CameraView, 'unknown'>, AngleGuide> = {
  front: {
    placement: '카메라를 내가 바라보는 방향 정면에 두고, 카메라를 마주 보고 섭니다.',
    onScreen: '얼굴과 몸 앞면이 보이고, 양어깨가 화면에 거의 같은 크기로 보입니다.',
  },
  diagonal: {
    placement: '정면에서 앞손 쪽(오소독스 스탠스면 왼쪽)으로 45° 비켜선 위치에 카메라를 둡니다. 나는 원래 바라보던 방향을 그대로 봅니다.',
    onScreen: '얼굴과 몸 앞면이 비스듬히 보이고, 앞손이 뻗는 길이가 화면에서 보입니다.',
  },
  side: {
    placement: '앞손 쪽(오소독스 스탠스면 왼쪽) 옆에 카메라를 둡니다. 나는 카메라를 보지 않고 원래 바라보던 방향을 봅니다.',
    onScreen: '옆모습이 보이고, 앞손이 화면 가로 방향으로 뻗습니다.',
  },
  back: {
    placement: '내 뒤쪽에 카메라를 두고, 카메라를 등지고 섭니다.',
    onScreen: '등과 뒤통수가 보이고, 얼굴은 보이지 않습니다.',
  },
};

export const CAPTURE_CHECKLIST = [
  '머리부터 발까지 몸 전체가 화면에 들어오나요?',
  '카메라가 흔들리지 않게 고정되어 있나요? (가슴 높이 권장)',
  '밝은 곳에서, 몸과 배경이 구분되나요?',
  '기준 영상과 같은 스탠스(앞손·앞발)로 서 있나요?',
];

/**
 * The reference's camera angle and how it is known.
 *  - motion3d: the angle the user picked for the 3D preview — exact.
 *  - profile: what Gemini saw in the reference (file / YouTube).
 *  - stated: what the user said when registering a file / YouTube reference.
 */
export function referenceAngle(ref: ReferenceVideo): { view: CameraView; source: 'motion3d' | 'profile' | 'stated' } {
  if (ref.source.kind === 'motion3d') {
    const a = ref.source.angle as CameraView;
    return { view: a in ANGLE_NAME ? a : ref.cameraView, source: 'motion3d' };
  }
  if (ref.profile && ref.profile.cameraView !== 'unknown') return { view: ref.profile.cameraView, source: 'profile' };
  return { view: ref.cameraView, source: 'stated' };
}

const ORDER: Record<'front' | 'diagonal' | 'side', number> = { front: 0, diagonal: 1, side: 2 };

/**
 * Local check: the user's pose-estimated view against the SAME estimator's reading of the
 * reference (when the reference has local media), or the reference's stated angle otherwise.
 * Back views cannot be told from front views by shoulder width, so they are "unknown".
 */
export function localViewRelation(referenceEstimate: CameraView, userEstimate: CameraView): LocalViewRelation {
  if (referenceEstimate === 'unknown' || userEstimate === 'unknown' || referenceEstimate === 'back' || userEstimate === 'back') return 'unknown';
  const d = Math.abs(ORDER[referenceEstimate] - ORDER[userEstimate]);
  return d === 0 ? 'consistent' : d === 1 ? 'unclear' : 'mismatch';
}

export interface ViewCheck {
  status: ViewStatus;
  referenceView: CameraView;
  referenceViewSource: 'motion3d' | 'profile' | 'stated';
  local: LocalViewRelation;
  userViewLocal: CameraView;
  ai: AiViewRelation | null;
  userViewAi: CameraView | null;
  aiNote: string | null;
  /** User-facing text (null when the views match). */
  message: string | null;
}

/**
 * Combines the two signals. Mismatch when EITHER says the views clearly differ (a suspicion is
 * enough to warn). Match only when nothing contradicts it AND at least one signal confirms it.
 * Everything else is "unknown" — it is never silently treated as a match.
 */
export function combineViewCheck(input: {
  referenceView: CameraView;
  referenceViewSource: ViewCheck['referenceViewSource'];
  local: LocalViewRelation;
  userViewLocal: CameraView;
  ai: AiViewRelation | null;
  userViewAi: CameraView | null;
  aiNote: string | null;
}): ViewCheck {
  const { local, ai } = input;
  const status: ViewStatus =
    ai === 'different' || local === 'mismatch'
      ? 'mismatch'
      : ai === 'same'
        ? 'match'
        : ai === null && local === 'consistent'
          ? 'match'
          : 'unknown';
  const ref = ANGLE_NAME[input.referenceView];
  const seen = input.userViewAi && input.userViewAi !== 'unknown' ? input.userViewAi : input.userViewLocal !== 'unknown' ? input.userViewLocal : null;
  const message =
    status === 'match'
      ? null
      : status === 'mismatch'
        ? `기준 영상은 ${ref}에서 촬영되었는데, 내 영상은 ${seen ? `${ANGLE_NAME[seen]} 등 ` : ''}다른 방향에서 촬영된 것으로 보입니다${input.aiNote ? ` (${input.aiNote})` : ''}. 방향이 다르면 보이지 않는 동작이 생겨 판정이 부정확해질 수 있어 신뢰도를 '높음'으로 표시하지 않았습니다. 기준 각도(${ref})에 맞춰 카메라를 다시 배치하고 촬영해 주세요.`
        : `촬영 방향을 확인할 수 없습니다${input.aiNote ? ` (${input.aiNote})` : ''}. 기준 각도(${ref})와 같은지 확인되지 않아 신뢰도를 '높음'으로 표시하지 않았습니다. 기준 각도에 맞춰 촬영했는지 확인해 주세요.`;
  return { ...input, status, message };
}

const AI_RELATIONS: AiViewRelation[] = ['same', 'different', 'uncertain'];
const VIEWS: CameraView[] = ['front', 'side', 'diagonal', 'back', 'unknown'];

/** Gemini's view comparison, parsed defensively (anything malformed → null = not answered). */
export function parseAiViewCheck(v: unknown): { relation: AiViewRelation; userView: CameraView; note: string } | null {
  const o = v as { relation?: unknown; userView?: unknown; note?: unknown } | null;
  if (!o || typeof o !== 'object' || !AI_RELATIONS.includes(o.relation as AiViewRelation)) return null;
  return {
    relation: o.relation as AiViewRelation,
    userView: VIEWS.includes(o.userView as CameraView) ? (o.userView as CameraView) : 'unknown',
    note: typeof o.note === 'string' ? o.note.trim().slice(0, 160) : '',
  };
}
