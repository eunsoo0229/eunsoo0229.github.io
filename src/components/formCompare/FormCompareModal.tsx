import { motionClipsFor } from '../../lib/motion3d/catalog';
import { hasLocalMedia } from '../../lib/formCompare/types';
import Icon from '../Icon';
import { ensureCameraAccess } from '../../lib/media/cameraAccess';
import { SkillStatusGlyph, VerdictGlyph } from '../StatusGlyph';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Technique } from '../../types';
import { createPoseLandmarker, type PoseLandmarker } from '../../lib/poseAnalysis/poseEstimator';
import { LiveClipCollector, sampleVideoBlob } from '../../lib/formCompare/clipCapture';
import { blockingIssues, estimateCameraView, isFullBodyFrame, isUsableFrame, VIEW_LABEL } from '../../lib/formCompare/motion';
import { ANGLE_GUIDE, ANGLE_NAME, CAPTURE_CHECKLIST, localViewRelation, referenceAngle, type LocalViewRelation } from '../../lib/formCompare/captureAngle';
import type { PoseFrame } from '../../lib/poseAnalysis/types';
import { deleteReference, FORM_COMPARE_EVENT, getMedia, listCompareRecords, listReferences } from '../../lib/formCompare/referenceStore';
import { compareAttempt, ensureProfile, MAX_REFERENCE_SECONDS, registerFileReference, registerYoutubeReference, type CompareOutcome } from '../../lib/formCompare/service';
import Motion3dReferenceRecorder from './Motion3dReferenceRecorder';
import { RELIABILITY_LABEL } from '../../lib/formCompare/scoring';
import { ASPECT_LABEL, CAPTURE_ISSUE_LABEL, type CameraView, type CaptureIssue, type PreparedClip, type ReferenceVideo } from '../../lib/formCompare/types';
import { STATUS_LABEL, classifyScore } from '../../lib/poseAnalysis/scoring';
import ScoreHistoryChart from '../ScoreHistoryChart';
import YouTubeSegment from './YouTubeSegment';
import CaptureGauge from '../timedCapture/CaptureGauge';
import { referenceFromVideo } from '../../lib/timedCapture/reference';
import { useTimedCapture } from '../../lib/timedCapture/useTimedCapture';

// 🎬 기준 영상 비교 자세 평가 — reference video ↔ the user's attempt.
// Steps: reference (pick / register — criteria built automatically) →
// capture (camera or a video file) → AI comparison → result + history.
// The user's video stays in memory for playback on this screen only.

const VERDICT_LABEL = { match: '일치', partial: '부분 일치', mismatch: '다름', not_observable: '판단 불가' } as const;
const IMPORTANCE_LABEL = { core: '핵심', support: '중요', minor: '세부' } as const;
const VIEW_OPTIONS: CameraView[] = ['front', 'side', 'diagonal', 'back', 'unknown'];

/** "1:05" / "65" / "65.5" → seconds */
export function parseTime(s: string): number | null {
  const v = s.trim();
  if (!v) return null;
  const m = v.match(/^(\d+):(\d{1,2}(?:\.\d+)?)$/);
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}${s % 1 ? `.${Math.round((s % 1) * 10)}` : ''}`;

function useReferences(techniqueId: string) {
  const [refs, setRefs] = useState(() => listReferences(techniqueId));
  useEffect(() => {
    const on = () => setRefs(listReferences(techniqueId));
    window.addEventListener(FORM_COMPARE_EVENT, on);
    return () => window.removeEventListener(FORM_COMPARE_EVENT, on);
  }, [techniqueId]);
  return refs;
}

type Step = 'reference' | 'capture' | 'analyzing' | 'result';

export default function FormCompareModal(props: { technique: Technique; onClose: () => void }) {
  // Keyed by technique: switching technique starts a fresh modal, so the previous technique's
  // reference, angle or step can never be applied to the new one.
  return <FormCompareModalInner key={props.technique.id} {...props} />;
}

function FormCompareModalInner({ technique, onClose }: { technique: Technique; onClose: () => void }) {
  const refs = useReferences(technique.id);
  const [refId, setRefId] = useState<string | null>(() => refs.find((r) => r.profile)?.id ?? refs[0]?.id ?? null);
  const reference = refs.find((r) => r.id === refId) ?? null;
  const [step, setStep] = useState<Step>('reference');
  const [registering, setRegistering] = useState(refs.length === 0);
  // "다른 각도로 기준 다시 녹화" opens the registration directly on the 3D recorder.
  const [registerKind, setRegisterKind] = useState<'youtube' | 'file' | 'motion3d' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<CompareOutcome | null>(null);
  const [userVideoUrl, setUserVideoUrl] = useState<string | null>(null);
  const [refFileUrl, setRefFileUrl] = useState<string | null>(null);
  const [retake, setRetake] = useState<CaptureIssue[] | null>(null);

  // Reference file playback (file references keep the file on this device).
  useEffect(() => {
    let url: string | null = null;
    if (reference && hasLocalMedia(reference.source)) {
      void getMedia(reference.id).then((m) => {
        if (m?.file) {
          url = URL.createObjectURL(m.file);
          setRefFileUrl(url);
        } else setRefFileUrl(null);
      });
    } else setRefFileUrl(null);
    return () => {
      if (url) URL.revokeObjectURL(url);
    };
  }, [reference?.id]);
  useEffect(() => () => {
    if (userVideoUrl) URL.revokeObjectURL(userVideoUrl);
  }, [userVideoUrl]);

  async function buildCriteria(r: ReferenceVideo, force = false) {
    setBusy('기준 영상을 분석해 평가 기준을 만드는 중… (기술 단계와 확인할 점을 자동으로 정합니다)');
    setError(null);
    const res = await ensureProfile(technique, r, force);
    setBusy(null);
    if (!res.ok) setError(res.message);
  }

  async function runCompare(clip: PreparedClip, videoBlob: Blob | null) {
    if (!reference) return;
    if (videoBlob) setUserVideoUrl(URL.createObjectURL(videoBlob));
    setRetake(null);
    setError(null);
    const block = blockingIssues(clip.signals);
    if (block.length) {
      setRetake(block);
      setStep('capture');
      return;
    }
    setStep('analyzing');
    const res = await compareAttempt(technique, reference, clip);
    if (!res.ok) {
      if ('retake' in res && res.retake) setRetake(res.retake);
      else setError(res.message);
      setStep('capture');
      return;
    }
    setOutcome(res.outcome);
    setStep('result');
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-panel pose-modal form-compare" onClick={(e) => e.stopPropagation()} data-testid="form-compare" data-step={step}>
        <h3><Icon name="video" /> {technique.name} — 기준 영상과 비교해 자세 평가</h3>
        <div className="modal-note" style={{ marginTop: 0, marginBottom: 12 }}>
          기준 시연 영상과 내 수행 영상을 AI가 단계·평가 기준별로 비교합니다. 배경·복장·체격 차이는 평가하지 않습니다. 참고용 결과이며 실제 지도자의 피드백을 대신하지 않습니다. 내 영상은 이 화면에서만 재생되고 저장되지 않으며, 분석에 쓰인 몇 장의 정지 프레임만 AI에 전달됩니다.
        </div>

        {step === 'reference' && (
          <ReferenceStep
            technique={technique}
            refs={refs}
            reference={reference}
            registering={registering}
            setRegistering={setRegistering}
            onPick={(id) => {
              setRefId(id);
              setError(null);
            }}
            onRegistered={async (r) => {
              setRefId(r.id);
              setRegistering(false);
              setRegisterKind(null);
              await buildCriteria(r);
            }}
            onRebuild={(r) => void buildCriteria(r, true)}
            onDelete={async (r) => {
              if (!window.confirm('이 기준 영상을 삭제할까요? 이 기준으로 한 이전 평가 기록은 남습니다.')) return;
              await deleteReference(r.id);
              setRefId(null);
            }}
            onNext={() => setStep('capture')}
            initialKind={registerKind}
            refFileUrl={refFileUrl}
            busy={busy}
            setBusy={setBusy}
            setError={setError}
          />
        )}

        {step === 'capture' && reference?.profile && (
          <CaptureStep
            reference={reference}
            retake={retake}
            onClip={runCompare}
            refFileUrl={refFileUrl}
            onBack={() => {
              setRetake(null);
              setStep('reference');
            }}
            onReangle={() => {
              setRetake(null);
              setError(null);
              setRegisterKind('motion3d');
              setRegistering(true);
              setStep('reference');
            }}
          />
        )}

        {step === 'analyzing' && (
          <div className="card info-card text-center" data-testid="form-analyzing">
            <p style={{ margin: 0 }}>기준 영상과 내 수행을 단계별로 맞춰 비교하는 중입니다…</p>
          </div>
        )}

        {step === 'result' && outcome && reference && (
          <ResultView
            technique={technique}
            reference={reference}
            outcome={outcome}
            userVideoUrl={userVideoUrl}
            refFileUrl={refFileUrl}
            onRetry={() => {
              setOutcome(null);
              setStep('capture');
            }}
            onReangle={
              reference.source.kind === 'motion3d'
                ? () => {
                    setOutcome(null);
                    setRegisterKind('motion3d');
                    setRegistering(true);
                    setStep('reference');
                  }
                : undefined
            }
          />
        )}

        {busy && (
          <p className="video-status-message" data-testid="form-busy">
            {busy}
          </p>
        )}
        {error && (
          <div className="ai-error" role="alert" data-testid="form-error">
            {error}
          </div>
        )}
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onClose} data-testid="form-close">
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------- reference step

function ReferenceStep(props: {
  technique: Technique;
  refs: ReferenceVideo[];
  reference: ReferenceVideo | null;
  registering: boolean;
  setRegistering: (v: boolean) => void;
  onPick: (id: string) => void;
  onRegistered: (r: ReferenceVideo) => Promise<void>;
  onRebuild: (r: ReferenceVideo) => void;
  onDelete: (r: ReferenceVideo) => Promise<void>;
  onNext: () => void;
  initialKind: 'youtube' | 'file' | 'motion3d' | null;
  refFileUrl: string | null;
  busy: string | null;
  setBusy: (v: string | null) => void;
  setError: (v: string | null) => void;
}) {
  const { technique, refs, reference } = props;
  // 3D 녹화는 이 기술에 시연 클립이 있을 때만 제시한다 (§4: 없는 기술은 기존 방식 유지).
  const has3dClips = motionClipsFor(technique.id).length > 0;
  const [kind, setKind] = useState<'youtube' | 'file' | 'motion3d'>(() => (props.initialKind === 'motion3d' && !has3dClips ? 'youtube' : (props.initialKind ?? 'youtube')));
  const [url, setUrl] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [filePreview, setFilePreview] = useState<string | null>(null);
  const [start, setStart] = useState('0');
  const [end, setEnd] = useState('');
  const [view, setView] = useState<CameraView>('front');
  const [replaceId, setReplaceId] = useState<string | null>(null);
  const curatedVideos = technique.videos ?? [];

  useEffect(() => {
    if (!file) return setFilePreview(null);
    const u = URL.createObjectURL(file);
    setFilePreview(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);

  async function register() {
    const s = parseTime(start);
    const e = parseTime(end);
    if (s === null || e === null) {
      props.setError('기술이 나오는 구간의 시작·끝 시간을 입력해 주세요 (예: 0:12 ~ 0:18).');
      return;
    }
    props.setError(null);
    props.setBusy(kind === 'youtube' ? '영상이 재생 가능한지 확인하는 중…' : '영상에서 자세를 추출하는 중… (이 기기에서만 처리)');
    const res =
      kind === 'youtube'
        ? await registerYoutubeReference(technique, { url, startSeconds: s, endSeconds: e, cameraView: view, replaceId })
        : file
          ? await registerFileReference(technique, { file, startSeconds: s, endSeconds: e, cameraView: view, replaceId, onProgress: (d, t) => props.setBusy(`영상에서 자세를 추출하는 중… ${Math.round((d / t) * 100)}%`) })
          : { ok: false as const, message: '영상 파일을 선택해 주세요.' };
    props.setBusy(null);
    if (!res.ok) {
      props.setError(res.message);
      return;
    }
    setReplaceId(null);
    await props.onRegistered(res.reference);
  }

  if (props.registering) {
    return (
      <div className="card info-card" data-testid="form-ref-register">
        <h4 style={{ marginTop: 0 }}>{replaceId ? '기준 영상 교체' : '기준 시연 영상 등록'}</h4>
        <div className="chip-row">
          <button type="button" className={`chip${kind === 'youtube' ? ' active' : ''}`} onClick={() => setKind('youtube')} data-testid="form-ref-kind-youtube">
            YouTube 주소
          </button>
          <button type="button" className={`chip${kind === 'file' ? ' active' : ''}`} onClick={() => setKind('file')} data-testid="form-ref-kind-file">
            영상 파일 (사용 권한이 있는 영상)
          </button>
          {has3dClips && (
            <button type="button" className={`chip${kind === 'motion3d' ? ' active' : ''}`} onClick={() => setKind('motion3d')} data-testid="form-ref-kind-motion3d">
              3D 시연 녹화
            </button>
          )}
        </div>
        {kind === 'motion3d' ? (
          <Motion3dReferenceRecorder
            technique={technique}
            replaceId={replaceId}
            currentAngle={reference?.source.kind === 'motion3d' ? referenceAngle(reference).view : null}
            onError={props.setError}
            onRegistered={async (ref) => {
              setReplaceId(null);
              await props.onRegistered(ref);
            }}
          />
        ) : kind === 'youtube' ? (
          <>
            <input className="select" style={{ marginTop: 8 }} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." data-testid="form-ref-url" />
            {curatedVideos.length > 0 && (
              <div className="chip-row" style={{ marginTop: 6 }}>
                <span className="field-label" style={{ margin: 0 }}>MARTIALDEX 등록 영상:</span>
                {curatedVideos.slice(0, 4).map((v) => (
                  <button key={v.videoId} type="button" className="chip" onClick={() => setUrl(`https://www.youtube.com/watch?v=${v.videoId}`)} data-testid="form-ref-curated">
                    {v.title.slice(0, 40)}
                  </button>
                ))}
              </div>
            )}
            <p className="video-status-message" style={{ margin: '6px 0 0' }}>
              공개된 YouTube 영상만 사용할 수 있습니다. 영상은 내려받지 않으며, 분석 때 Gemini가 YouTube 영상을 직접 읽습니다.
            </p>
          </>
        ) : (
          <>
            <input type="file" accept="video/*" style={{ marginTop: 8 }} onChange={(e) => setFile(e.target.files?.[0] ?? null)} data-testid="form-ref-file" />
            {filePreview && <video src={filePreview} controls muted playsInline className="form-compare__video" data-testid="form-ref-file-preview" />}
          </>
        )}
        <div className="chip-row" style={{ marginTop: 8 }}>
          <label className="field-label" style={{ margin: 0 }}>
            기술 구간 시작 <input className="select form-compare__time" value={start} onChange={(e) => setStart(e.target.value)} placeholder="0:12" data-testid="form-ref-start" />
          </label>
          <label className="field-label" style={{ margin: 0 }}>
            끝 <input className="select form-compare__time" value={end} onChange={(e) => setEnd(e.target.value)} placeholder="0:18" data-testid="form-ref-end" />
          </label>
          <label className="field-label" style={{ margin: 0 }}>
            촬영 방향
            <select className="select" value={view} onChange={(e) => setView(e.target.value as CameraView)} data-testid="form-ref-view">
              {VIEW_OPTIONS.map((v) => (
                <option key={v} value={v}>
                  {VIEW_LABEL[v]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p className="video-status-message" style={{ margin: '4px 0 0' }}>
          기술 한 번(또는 몇 번)이 보이는 {MAX_REFERENCE_SECONDS}초 이하 구간을 골라 주세요. 평가 기준은 이 구간에서 자동으로 만들어집니다.
        </p>
        {kind === 'youtube' && parseYoutubeIdForPreview(url) && parseTime(end) !== null && (
          <YouTubeSegment videoId={parseYoutubeIdForPreview(url)!} start={parseTime(start) ?? 0} end={parseTime(end)!} title="기준 영상 미리보기" />
        )}
        <div className="modal-actions modal-actions--start">
          <button className="btn btn-primary" onClick={() => void register()} disabled={!!props.busy} data-testid="form-ref-save">
            확인하고 평가 기준 만들기
          </button>
          {refs.length > 0 && (
            <button className="btn btn-ghost" onClick={() => props.setRegistering(false)}>
              취소
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div data-testid="form-ref-step">
      {refs.length > 1 && (
        <div className="chip-row" style={{ marginBottom: 8 }}>
          {refs.map((r) => (
            <button key={r.id} type="button" className={`chip${r.id === reference?.id ? ' active' : ''}`} onClick={() => props.onPick(r.id)} data-testid="form-ref-pick">
              {r.source.kind === 'youtube' ? <><Icon name="play" /> {r.source.title.slice(0, 24)}</> : r.source.kind === 'motion3d' ? <><Icon name="video" /> 3D 시연</> : <><Icon name="file" /> {r.source.fileName.slice(0, 24)}</>} · {ANGLE_NAME[referenceAngle(r).view]}{r.source.kind === 'motion3d' ? '' : ` · ${fmtTime(r.startSeconds)}~${fmtTime(r.endSeconds)}`}
            </button>
          ))}
        </div>
      )}
      {reference && (
        <div className="card info-card" data-testid="form-ref-current" data-has-profile={String(!!reference.profile)} data-angle={referenceAngle(reference).view}>
          <h4 style={{ marginTop: 0 }}>
            기준 영상: {reference.source.kind === 'youtube' ? `${reference.source.title} (${reference.source.channel})` : reference.source.kind === 'motion3d' ? '3D 시연 녹화' : reference.source.fileName} · {fmtTime(reference.startSeconds)}~{fmtTime(reference.endSeconds)} ·{' '}
            <span data-testid="form-ref-angle">{reference.source.kind === 'motion3d' ? `내가 고른 각도: ${ANGLE_NAME[referenceAngle(reference).view]}` : ANGLE_NAME[referenceAngle(reference).view]}</span>
          </h4>
          {reference.source.kind === 'youtube' ? (
            <YouTubeSegment videoId={reference.source.videoId} start={reference.startSeconds} end={reference.endSeconds} title={reference.source.title} />
          ) : props.refFileUrl ? (
            <video src={`${props.refFileUrl}#t=${reference.startSeconds},${reference.endSeconds}`} controls muted playsInline className="form-compare__video" />
          ) : (
            <p className="video-status-message">영상 파일은 이 기기에 저장되지 않았습니다(용량 초과). 추출한 프레임으로 평가합니다.</p>
          )}
          {reference.profile ? (
            <div data-testid="form-profile">
              <p style={{ margin: '8px 0 4px' }}>
                <strong>자동으로 만든 평가 기준</strong> — {reference.profile.summary}
              </p>
              <p className="video-status-message" style={{ margin: 0 }}>
                단계: {reference.profile.phases.map((p) => p.name).join(' → ')}
              </p>
              <ul className="form-compare__criteria" data-testid="form-profile-criteria">
                {reference.profile.criteria.map((c) => (
                  <li key={c.id}>
                    <span className="chip">{IMPORTANCE_LABEL[c.importance]}</span> {c.description} <span className="video-status-message">({ASPECT_LABEL[c.aspect]})</span>
                  </li>
                ))}
              </ul>
              {reference.profile.excluded.length > 0 && (
                <p className="video-status-message" data-testid="form-profile-excluded">
                  기준 영상으로 판단할 수 없어 평가하지 않는 것: {reference.profile.excluded.map((x) => `${x.aspect}(${x.reason})`).join(', ')}
                </p>
              )}
              {!reference.profile.matchesTechnique && (
                <div className="ai-error" role="alert">
                  이 영상은 {technique.name}가 아닌 것으로 분석되었습니다({reference.profile.observedTechnique}). 다른 기준 영상을 등록해 주세요.
                </div>
              )}
            </div>
          ) : (
            <p className="video-status-message">아직 평가 기준이 없습니다.</p>
          )}
          <div className="modal-actions modal-actions--start">
            {reference.profile?.matchesTechnique ? (
              <button className="btn btn-primary" onClick={props.onNext} disabled={!!props.busy} data-testid="form-ref-next">
                이 기준으로 내 자세 촬영하기
              </button>
            ) : (
              <button className="btn btn-primary" onClick={() => props.onRebuild(reference)} disabled={!!props.busy} data-testid="form-ref-build">
                평가 기준 만들기
              </button>
            )}
            {reference.profile && (
              <button className="btn btn-ghost btn-sm" onClick={() => props.onRebuild(reference)} disabled={!!props.busy}>
                기준 다시 만들기
              </button>
            )}
            <button
              className="btn btn-ghost btn-sm"
              onClick={() => {
                setReplaceId(reference.id);
                props.setRegistering(true);
              }}
              data-testid="form-ref-replace"
            >
              기준 영상 교체
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => void props.onDelete(reference)} data-testid="form-ref-delete">
              삭제
            </button>
          </div>
        </div>
      )}
      <button className="btn btn-secondary btn-sm" onClick={() => props.setRegistering(true)} data-testid="form-ref-add">
        + 다른 기준 영상 등록
      </button>
    </div>
  );
}

function parseYoutubeIdForPreview(url: string): string | null {
  const m = url.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : /^[A-Za-z0-9_-]{11}$/.test(url.trim()) ? url.trim() : null;
}

// ---------------------------------------------------------------- capture step

const LIVE_VIEW_TEXT: Record<LocalViewRelation, string> = {
  consistent: '기준 영상과 비슷한 방향으로 보입니다.',
  unclear: '기준 각도와 같은지 판단하기 어렵습니다. 위 배치 그림대로 섰는지 확인해 주세요.',
  mismatch: '기준 영상과 다른 방향으로 보입니다. 카메라 위치를 기준 각도에 맞춰 주세요.',
  unknown: '방향을 확인할 수 없습니다. 위 배치 그림대로 섰는지 직접 확인해 주세요.',
};

/** Top-down sketch: the user (facing up), the direction they face, and where the camera goes. */
function AngleDiagram({ view }: { view: CameraView }) {
  // camera position around the user, degrees clockwise from "in front"; the 3D side/diagonal
  // presets are on the character's LEFT (lead-hand side for orthodox), i.e. screen-left here.
  const deg = { front: 0, diagonal: -45, side: -90, back: 180, unknown: null }[view];
  const cx = 60, cy = 62, r = 44;
  const cam = deg === null ? null : { x: cx + r * Math.sin((deg * Math.PI) / 180), y: cy - r * Math.cos((deg * Math.PI) / 180) };
  return (
    <svg viewBox="0 0 120 120" width="120" height="120" role="img" aria-label={`카메라 배치: ${ANGLE_NAME[view]}`} data-testid="form-capture-angle-diagram" style={{ flex: '0 0 auto' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="currentColor" strokeOpacity="0.2" strokeDasharray="3 4" />
      <circle cx={cx} cy={cy} r="11" fill="currentColor" fillOpacity="0.85" />
      <path d={`M${cx} ${cy - 13} L${cx} ${cy - 30} M${cx - 5} ${cy - 24} L${cx} ${cy - 31} L${cx + 5} ${cy - 24}`} stroke="currentColor" strokeWidth="2.5" fill="none" strokeLinecap="round" />
      <text x={cx} y={cy + 28} textAnchor="middle" fontSize="9" fill="currentColor" fillOpacity="0.75">나</text>
      <text x={cx} y="10" textAnchor="middle" fontSize="8" fill="currentColor" fillOpacity="0.6">바라보는 방향</text>
      {cam && (
        <g transform={`translate(${cam.x} ${cam.y}) rotate(${deg! + 180})`}>
          <rect x="-9" y="-6" width="18" height="12" rx="2" fill="var(--accent, #e5484d)" />
          <path d="M-4 -6 L4 -6 L2 -10 L-2 -10 Z" fill="var(--accent, #e5484d)" />
        </g>
      )}
    </svg>
  );
}

function CaptureStep({ reference, retake, onClip, onBack, onReangle, refFileUrl }: { reference: ReferenceVideo; retake: CaptureIssue[] | null; onClip: (clip: PreparedClip, blob: Blob | null) => void; onBack: () => void; onReangle: () => void; refFileUrl: string | null }) {
  const [mode, setMode] = useState<'camera' | 'file'>('camera');
  const [phase, setPhase] = useState<'idle' | 'starting' | 'ready' | 'countdown' | 'recording' | 'processing' | 'error'>('idle');
  const [message, setMessage] = useState<string | null>(null);
  // the capture is as long as the designated reference segment (one repetition) — no fixed length to pick
  const length = useMemo(() => referenceFromVideo(reference), [reference]);
  const [live, setLive] = useState<{ person: boolean; full: boolean }>({ person: false, full: false });
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const lmRef = useRef<PoseLandmarker | null>(null);
  const rafRef = useRef<number | null>(null);
  const collectorRef = useRef<LiveClipCollector | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const { view, source: viewSource } = referenceAngle(reference);
  // The user re-confirms the angle before filming (it is their camera placement, not ours).
  const [angleConfirmed, setAngleConfirmed] = useState(false);
  // Live direction hint: the same local estimator, compared with its reading of the reference.
  const [liveView, setLiveView] = useState<{ relation: LocalViewRelation; estimate: CameraView } | null>(null);
  const refEstimateRef = useRef<CameraView>(view);
  const recentPosesRef = useRef<PoseFrame[]>([]);
  const frameCountRef = useRef(0);
  useEffect(() => {
    let alive = true;
    if (hasLocalMedia(reference.source))
      void getMedia(reference.id).then((m) => {
        if (alive && m?.signals.cameraView && m.signals.cameraView !== 'unknown') refEstimateRef.current = m.signals.cameraView;
      });
    return () => {
      alive = false;
    };
  }, [reference.id]);
  const capture = useTimedCapture({
    durationMs: length.ok ? length.reference.durationMs : 0,
    onRecordStart: () => startRecording(),
    onRecordEnd: () => finishRecording(),
    onCancel: () => {
      collectorRef.current = null;
      const rec = recorderRef.current;
      recorderRef.current = null;
      if (rec && rec.state !== 'inactive') rec.stop();
      chunksRef.current = [];
      setPhase('ready');
      setMessage('촬영을 취소했습니다. 결과는 저장되지 않았습니다.');
    },
  });
  const recordingRef = capture.recordingRef;
  const clockRef = capture.clockRef;

  const stopAll = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    lmRef.current?.close();
    lmRef.current = null;
  }, []);
  useEffect(() => stopAll, [stopAll]);

  const loop = useCallback(() => {
    const v = videoRef.current;
    const lm = lmRef.current;
    if (v && lm && v.readyState >= 2) {
      const now = performance.now();
      const pose = lm.detect(v, now);
      setLive({ person: !!pose && isUsableFrame(pose), full: !!pose && isFullBodyFrame(pose) });
      if (pose && isUsableFrame(pose)) {
        const buf = recentPosesRef.current;
        buf.push(pose);
        if (buf.length > 30) buf.shift();
      }
      // re-estimate about twice a second (not every frame)
      if (++frameCountRef.current % 15 === 0 && !recordingRef.current) {
        const estimate = estimateCameraView(recentPosesRef.current);
        setLiveView({ relation: localViewRelation(refEstimateRef.current, estimate), estimate });
      }
      // only inside the recording window (the end time is fixed by the capture clock, not by this loop)
      if (collectorRef.current && recordingRef.current && clockRef.current && now <= clockRef.current.endAt) collectorRef.current.add(v, pose, now);
    }
    rafRef.current = requestAnimationFrame(loop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startCamera() {
    setPhase('starting');
    setMessage(null);
    try {
      const access = await ensureCameraAccess();
      if (!access.ok) throw new DOMException(access.message, 'NotAllowedError');
      const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 640, height: 480 }, audio: false });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      lmRef.current = await createPoseLandmarker();
    } catch (err) {
      const name = (err as DOMException)?.name;
      setPhase('error');
      setMessage(name === 'NotAllowedError' ? '카메라 접근 권한이 거부되었습니다. 설정에서 카메라 권한을 허용해 주세요.' : name === 'NotFoundError' ? '카메라를 찾을 수 없습니다.' : '카메라 또는 자세 분석 모듈을 열지 못했습니다.');
      stopAll();
      return;
    }
    setPhase('ready');
    rafRef.current = requestAnimationFrame(loop);
  }

  function startCountdown() {
    setMessage(null);
    setPhase('countdown');
    capture.start();
  }

  function startRecording() {
    collectorRef.current = new LiveClipCollector(100);
    chunksRef.current = [];
    try {
      if (streamRef.current && typeof MediaRecorder !== 'undefined') {
        const rec = new MediaRecorder(streamRef.current);
        rec.ondataavailable = (e) => e.data.size && chunksRef.current.push(e.data);
        rec.start();
        recorderRef.current = rec;
      }
    } catch {
      recorderRef.current = null; // playback is optional; the analysis does not need it
    }
    setPhase('recording');
  }

  function finishRecording() {
    const collector = collectorRef.current;
    collectorRef.current = null;
    if (!collector) return;
    setPhase('processing');
    const clip = collector.finish();
    const rec = recorderRef.current;
    recorderRef.current = null;
    const done = (blob: Blob | null) => {
      stopAll();
      onClip(clip, blob);
    };
    if (rec && rec.state !== 'inactive') {
      rec.onstop = () => done(chunksRef.current.length ? new Blob(chunksRef.current, { type: rec.mimeType || 'video/webm' }) : null);
      rec.stop();
    } else done(null);
  }

  async function useFile(file: File) {
    setPhase('processing');
    setMessage('영상에서 자세를 추출하는 중…');
    try {
      const clip = await sampleVideoBlob(file, { fps: 12, onProgress: (d, t) => setMessage(`영상에서 자세를 추출하는 중… ${Math.round((d / t) * 100)}%`) });
      setMessage(null);
      onClip(clip, file);
    } catch (e) {
      setPhase('error');
      setMessage(e instanceof Error ? e.message : '영상을 분석하지 못했습니다.');
    }
  }

  return (
    <div data-testid="form-capture" data-phase={phase}>
      <div className="card info-card" data-testid="form-capture-angle" data-angle={view} data-angle-source={viewSource}>
        <h4 style={{ marginTop: 0 }}>
          <Icon name="camera" /> 기준 각도: <strong data-testid="form-capture-angle-name">{ANGLE_NAME[view]}</strong>
          {viewSource === 'motion3d' && <span className="video-status-message"> (3D 기준 영상을 녹화할 때 내가 고른 각도)</span>}
        </h4>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <AngleDiagram view={view} />
          <div style={{ flex: '1 1 200px', minWidth: 0 }}>
            {view !== 'unknown' ? (
              <>
                <p style={{ margin: '0 0 4px' }} data-testid="form-capture-placement">
                  <strong>카메라 배치</strong> — {ANGLE_GUIDE[view].placement}
                </p>
                <p className="video-status-message" style={{ margin: 0 }}>
                  제대로 놓였다면: {ANGLE_GUIDE[view].onScreen}
                </p>
              </>
            ) : (
              <p style={{ margin: 0 }} data-testid="form-capture-placement">
                기준 영상의 촬영 방향을 알 수 없습니다. 아래 기준 영상을 보고 같은 방향에서 촬영해 주세요.
              </p>
            )}
          </div>
        </div>
        {(refFileUrl || reference.source.kind === 'youtube') && (
          <div style={{ marginTop: 8 }} data-testid="form-capture-ref-preview">
            <div className="field-label">기준 영상 미리보기 — 이 화면과 같은 방향에서 찍히도록 서 주세요</div>
            {reference.source.kind === 'youtube' ? (
              <YouTubeSegment videoId={reference.source.videoId} start={reference.startSeconds} end={reference.endSeconds} title={reference.source.title} />
            ) : (
              <video src={`${refFileUrl}#t=${reference.startSeconds},${reference.endSeconds}`} autoPlay loop muted playsInline className="form-compare__video" />
            )}
          </div>
        )}
        <p style={{ margin: '8px 0 4px' }}><strong>촬영 전 확인</strong></p>
        <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="form-capture-checklist">
          {CAPTURE_CHECKLIST.map((c) => (
            <li key={c}>{c}</li>
          ))}
          <li>기준 영상의 첫 단계({reference.profile?.phases[0]?.name ?? '준비 자세'})에서 시작해 기술을 수행하고, 끝난 뒤 자세를 회복합니다.</li>
        </ul>
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8, cursor: 'pointer' }}>
          <input type="checkbox" checked={angleConfirmed} onChange={(e) => setAngleConfirmed(e.target.checked)} data-testid="form-capture-angle-confirm" />
          <span>카메라를 <strong>{ANGLE_NAME[view]}</strong> 각도에 맞춰 배치했습니다</span>
        </label>
        {reference.source.kind === 'motion3d' && (
          <p className="video-status-message" style={{ margin: '6px 0 0' }}>
            다른 각도로 촬영하고 싶다면 기준 영상부터 그 각도로 다시 녹화해야 합니다.{' '}
            <button type="button" className="btn btn-ghost btn-sm" onClick={onReangle} disabled={phase === 'countdown' || phase === 'recording' || phase === 'processing'} data-testid="form-capture-reangle">
              다른 각도로 기준 영상 다시 녹화
            </button>
          </p>
        )}
      </div>
      {retake && (
        <div className="ai-error" role="alert" data-testid="form-retake">
          다시 촬영해 주세요: {retake.map((i) => CAPTURE_ISSUE_LABEL[i]).join(' ')}
        </div>
      )}
      <div className="chip-row" style={{ margin: '8px 0' }}>
        <button type="button" className={`chip${mode === 'camera' ? ' active' : ''}`} onClick={() => setMode('camera')} data-testid="form-capture-camera">
          <Icon name="camera" /> 카메라로 촬영
        </button>
        <button
          type="button"
          className={`chip${mode === 'file' ? ' active' : ''}`}
          onClick={() => {
            stopAll();
            setPhase('idle');
            setMode('file');
          }}
          data-testid="form-capture-file-mode"
        >
          <Icon name="upload" /> 촬영한 영상 파일 올리기
        </button>
      </div>
      {mode === 'camera' ? (
        <>
          <div className="pose-camera-frame">
            <video ref={videoRef} className="pose-video" muted playsInline />
            {phase === 'countdown' && (
              <div className="pose-countdown-overlay">
                <div className="pose-countdown-overlay__label">곧 촬영을 시작합니다</div>
                <div className="pose-countdown-overlay__number">{capture.countdownLeft}</div>
              </div>
            )}
            {phase === 'recording' && <div className="pose-overlay-badge">● 촬영 중 — 지금 기술을 수행하세요</div>}
            {(phase === 'ready' || phase === 'recording') && (
              <div className="form-compare__live" data-testid="form-live-check" data-person={String(live.person)} data-full={String(live.full)}>
                {live.full ? <><Icon name="check" /> 전신이 보입니다</> : live.person ? <><Icon name="warn" /> 발까지 보이도록 조금 뒤로 가 주세요</> : <><Icon name="warn" /> 사람이 보이지 않습니다</>}
                {phase === 'ready' && live.person && liveView && (
                  <div data-testid="form-live-view" data-relation={liveView.relation}>
                    {liveView.relation === 'consistent' ? <Icon name="check" /> : <Icon name="warn" />} 방향(추정): {LIVE_VIEW_TEXT[liveView.relation]}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="modal-actions" style={{ justifyContent: 'center' }}>
            {phase === 'idle' || phase === 'error' ? (
              <button className="btn btn-primary" onClick={() => void startCamera()} data-testid="form-camera-start">
                카메라 켜기
              </button>
            ) : phase === 'ready' ? (
              <button className="btn btn-primary" onClick={startCountdown} disabled={!length.ok || !angleConfirmed} title={angleConfirmed ? undefined : '기준 각도에 맞춰 배치했는지 먼저 확인해 주세요'} data-testid="form-record-start" data-capture-ms={length.ok ? length.reference.durationMs : ''}>
                <Icon name="play" /> 촬영 시작{length.ok ? ` (${(length.reference.durationMs / 1000).toFixed(2)}초 자동 촬영)` : ''}
              </button>
            ) : phase === 'countdown' || phase === 'recording' ? (
              <button className="btn btn-secondary" onClick={capture.cancel} data-testid="form-record-cancel">
                <Icon name="close" /> 촬영 취소
              </button>
            ) : null}
          </div>
        </>
      ) : (
        <div className="card info-card">
          <input type="file" accept="video/*" capture="environment" disabled={!angleConfirmed} onChange={(e) => e.target.files?.[0] && void useFile(e.target.files[0])} data-testid="form-capture-file" />
          <p className="video-status-message" style={{ margin: '6px 0 0' }}>
            휴대폰 카메라 앱 등으로 촬영한 영상을 올릴 수 있습니다. <strong>{ANGLE_NAME[view]}</strong> 각도에서 촬영한 영상이어야 합니다. 영상은 이 기기에서만 처리됩니다.
            {!angleConfirmed && ' 위에서 각도를 확인하면 파일을 고를 수 있습니다.'}
          </p>
        </div>
      )}
      {mode === 'camera' && phase === 'recording' && <CaptureGauge remainingMs={capture.remainingMs} durationMs={capture.durationMs} />}
      {mode === 'camera' && !length.ok && (
        <div className="ai-error" role="alert" data-testid="form-capture-length-error">
          {length.message} 촬영 길이를 정할 수 없어 카메라 촬영을 시작하지 않습니다.
        </div>
      )}
      {message && <p className="video-status-message">{message}</p>}
      <button
        className="btn btn-ghost btn-sm"
        onClick={() => {
          if (capture.phase === 'countdown' || capture.phase === 'recording') capture.cancel();
          onBack();
        }}
      >
        ← 기준 영상으로
      </button>
    </div>
  );
}

// ---------------------------------------------------------------- result

const VIEW_STATUS_TEXT = { match: '기준 영상과 같은 방향에서 촬영된 것으로 확인되었습니다.', mismatch: '촬영 방향이 기준 영상과 다를 수 있습니다', unknown: '촬영 방향을 확인할 수 없습니다' } as const;

function ResultView({ technique, reference, outcome, userVideoUrl, refFileUrl, onRetry, onReangle }: { technique: Technique; reference: ReferenceVideo; outcome: CompareOutcome; userVideoUrl: string | null; refFileUrl: string | null; onRetry: () => void; onReangle?: () => void }) {
  const { record, userFrames, refFrames } = outcome;
  const b = record.breakdown;
  const j = record.judgement;
  const crit = new Map(record.criteria.map((c) => [c.id, c]));
  const history = useMemo(() => listCompareRecords(technique.id).filter((r) => r.breakdown.score !== null), [technique.id, record.id]);
  const chartRecords = history.map((r) => ({ recordId: r.id, techniqueId: r.techniqueId, martialArtId: r.martialArt, score: r.breakdown.score!, status: classifyScore(r.breakdown.score!), metricScores: {}, analyzedAt: r.createdAt }));
  const prev = history.length >= 2 ? history[history.length - 2] : null;
  const statusText =
    b.status === 'scored'
      ? null
      : b.status === 'insufficient'
        ? '평가 불가 — 근거가 부족해 점수를 매기지 않았습니다.'
        : b.status === 'different_technique'
          ? '평가 불가 — 기준 영상과 다른 기술을 수행한 것으로 보입니다.'
          : '평가 불가 — 기술 수행 동작이 보이지 않습니다.';
  const phasesById = new Map(reference.profile?.phases.map((p) => [p.id, p]) ?? []);

  return (
    <div className="pose-result" data-testid="form-result" data-status={b.status} data-score={b.score ?? ''} data-reliability={b.reliability}>
      <div className="pose-result__score">
        {b.score !== null ? (
          <>
            <div className="pose-result__score-num" data-testid="form-score">
              {b.score} / 100
            </div>
            <div className="pose-result__status">
              <SkillStatusGlyph status={classifyScore(b.score)} /> {STATUS_LABEL[classifyScore(b.score)]}
              {prev?.breakdown.score != null && ` · 지난번 ${prev.breakdown.score}점 (${b.score - prev.breakdown.score >= 0 ? '+' : ''}${b.score - prev.breakdown.score})`}
            </div>
          </>
        ) : (
          <div className="pose-result__score-num" data-testid="form-score-none">
            {statusText}
          </div>
        )}
      </div>
      <p className="video-status-message" data-testid="form-reliability">
        분석 신뢰도: <strong>{RELIABILITY_LABEL[b.reliability]}</strong> ({Math.round(b.reliabilityValue * 100)}%) · 관찰 가능한 기준 {Math.round(b.coverage * 100)}% · 사람 인식 {Math.round(record.signals.visibleRatio * 100)}% ·{' '}
        {record.alignment.method === 'dtw' ? `시간 정렬(DTW) · 수행 시간 기준 대비 ${record.alignment.speedRatio}배` : '수행 구간 기준 시간 정렬'}
        {b.cap && ` · ${b.cap.reason} → 최대 ${b.cap.value}점`}
      </p>
      {b.reasons.map((r) => (
        <p key={r} className="video-status-message">
          {r}
        </p>
      ))}
      {record.viewCheck ? (
        <div
          className={record.viewCheck.status === 'match' ? 'video-status-message' : 'ai-error'}
          role={record.viewCheck.status === 'mismatch' ? 'alert' : undefined}
          data-testid="form-view-check"
          data-status={record.viewCheck.status}
          data-local={record.viewCheck.local}
          data-ai={record.viewCheck.ai ?? ''}
        >
          <p style={{ margin: 0 }}>
            {record.viewCheck.status === 'match' ? <Icon name="check" /> : <Icon name="warn" />} <strong>촬영 방향:</strong> 기준 {ANGLE_NAME[record.viewCheck.referenceView]} · {VIEW_STATUS_TEXT[record.viewCheck.status]}
          </p>
          {record.viewCheck.message && <p style={{ margin: '4px 0 0' }} data-testid={record.viewCheck.status === 'mismatch' ? 'form-view-warning' : 'form-view-unknown'}>{record.viewCheck.message}</p>}
          {(record.judgement.viewLimitedCriteria?.length ?? 0) > 0 && (
            <p style={{ margin: '4px 0 0' }} data-testid="form-view-limited">
              촬영 방향 때문에 확인하지 못해 틀린 것으로 판정하지 않은 기준: {record.judgement.viewLimitedCriteria!.map((id) => crit.get(id)?.description ?? id).join(' / ')}
            </p>
          )}
          {record.viewCheck.status !== 'match' && (
            <div className="modal-actions modal-actions--start" style={{ marginTop: 6 }}>
              <button className="btn btn-secondary btn-sm" onClick={onRetry} data-testid="form-view-retake">
                {ANGLE_NAME[record.viewCheck.referenceView]} 각도에 맞춰 다시 촬영
              </button>
              {onReangle && (
                <button className="btn btn-ghost btn-sm" onClick={onReangle}>
                  다른 각도로 기준 영상 다시 녹화
                </button>
              )}
            </div>
          )}
        </div>
      ) : (
        record.viewWarning && (
          <div className="ai-error" role="alert" data-testid="form-view-warning">
            {record.viewWarning}
          </div>
        )
      )}

      {b.phaseScores.some((p) => p.score !== null) && (
        <div className="pose-metric-list" data-testid="form-phase-scores">
          {b.phaseScores.map((p) => (
            <div key={p.phaseId} className="pose-metric-row">
              <span className="pose-metric-row__name">{p.name}</span>
              <div className="progress-track pose-metric-row__bar">
                <div className="progress-fill" style={{ width: `${p.score ?? 0}%` }} />
              </div>
              <span className="pose-metric-row__score">{p.score ?? '–'}</span>
            </div>
          ))}
        </div>
      )}

      <h4>기준 영상 ↔ 내 수행</h4>
      <div className="form-compare__side" data-testid="form-side-by-side">
        <div>
          <div className="field-label">기준</div>
          {reference.source.kind === 'youtube' ? (
            <YouTubeSegment videoId={reference.source.videoId} start={reference.startSeconds} end={reference.endSeconds} title={reference.source.title} />
          ) : refFileUrl ? (
            <video src={`${refFileUrl}#t=${reference.startSeconds},${reference.endSeconds}`} controls muted playsInline className="form-compare__video" />
          ) : null}
        </div>
        <div>
          <div className="field-label">나</div>
          {userVideoUrl ? <video src={userVideoUrl} controls muted playsInline className="form-compare__video" data-testid="form-user-video" /> : <p className="video-status-message">재생할 영상이 없습니다.</p>}
        </div>
      </div>
      <div className="form-compare__frames" data-testid="form-frames">
        {userFrames.map((f, i) => {
          const r = refFrames.length === userFrames.length ? refFrames[i] : (refFrames.find((x) => x.note === f.note) ?? null);
          return (
            <figure key={i} className="form-compare__pair">
              {r && <img src={r.image} alt={`기준 ${f.note}`} />}
              <img src={f.image} alt={`나 ${f.note}`} />
              <figcaption>
                U{i + 1} · {f.note} · {(f.tMs / 1000).toFixed(1)}초
              </figcaption>
            </figure>
          );
        })}
      </div>

      <h4>평가 기준별 비교</h4>
      <ul className="form-compare__criteria" data-testid="form-criteria-results">
        {j.criteria.map((c) => {
          const def = crit.get(c.criterionId);
          return (
            <li key={c.criterionId} data-verdict={c.verdict}>
              <VerdictGlyph verdict={c.verdict} /> <strong>{VERDICT_LABEL[c.verdict]}</strong> · {def ? `${IMPORTANCE_LABEL[def.importance]} · ${def.description}` : c.criterionId}
              {def?.phaseId && phasesById.get(def.phaseId) ? ` (${phasesById.get(def.phaseId)!.name})` : ''}
              <div className="video-status-message">
                나: {c.observation}
                {c.referenceObservation ? ` · 기준: ${c.referenceObservation}` : ''} · 확신도 {c.confidence === 'high' ? '높음' : c.confidence === 'medium' ? '보통' : '낮음'}
              </div>
            </li>
          );
        })}
      </ul>
      {j.strengths.length > 0 && <p className="pose-result__line" data-testid="form-strengths"><Icon name="check" /> 잘한 부분: {j.strengths.join(' / ')}</p>}
      {j.differences.length > 0 && (
        <div data-testid="form-differences">
          <p className="pose-result__line"><Icon name="warn" /> 기준 영상과 다른 부분</p>
          <ul>
            {j.differences.map((d, i) => (
              <li key={i}>
                {d.what}
                {d.why && <span className="video-status-message"> — 이유: {d.why}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {j.focus.length > 0 && <p className="pose-result__line" data-testid="form-focus"><Icon name="target" /> 다음에 집중할 점: {j.focus.join(' / ')}</p>}
      {j.drills.length > 0 && <p className="pose-result__line" data-testid="form-drills"><Icon name="dumbbell" /> 연습 제안: {j.drills.join(' / ')}</p>}
      {j.limitations.length > 0 && <p className="video-status-message">평가 한계: {j.limitations.join(' / ')}</p>}
      {(record.poseHints?.length ?? 0) > 0 && (
        <p className="video-status-message" data-testid="form-pose-hints">
          자세 추정 보조 신호(시간 정렬 후 기준과 위치 차이가 큰 부위, 점수에는 직접 쓰지 않음): {record.poseHints!.join(' / ')}
        </p>
      )}

      {chartRecords.length >= 2 && (
        <>
          <h4>점수 변화 (기준 영상 비교)</h4>
          <ScoreHistoryChart records={chartRecords} />
        </>
      )}
      <div className="modal-actions">
        <button className="btn btn-secondary" onClick={onRetry} data-testid="form-retry">
          다시 촬영해 비교
        </button>
      </div>
    </div>
  );
}
