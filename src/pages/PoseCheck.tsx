import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useLocation, useParams } from 'react-router-dom';
import BackButton from '../components/BackButton';
import Icon from '../components/Icon';
import VideoResultCards from '../components/video/VideoResultCards';
import { resolveTechnique } from '../lib/userTechniques/service';
import { captureGuide, evaluatePoseFrames, pickReferenceVideos, poseSupport, type PoseCheckResult } from '../lib/poseCoach/poseCoach';
import { selfResearchProvider } from '../lib/selfResearch/provider';
import { toSources } from '../lib/selfAi/coachAgent';
import { saveAnalysisResult } from '../lib/poseAnalysis/recordsService';
import type { ChatSource } from '../lib/selfAi/types';

// 자세 확인 (자체 AI 코치 → "내 잽 자세가 맞는지 확인하고 싶어"). The existing measurement only:
// camera → PoseAnalysisModal (unchanged), or a video file → local frame sampling (formCompare's
// clipCapture, on this device) → the same rule engine (poseAnalysis/analyzeTechnique). The video
// file never leaves the device and is not stored. A record is saved only when a score was made.

const PoseAnalysisModal = lazy(() => import('../components/PoseAnalysisModal'));

export default function PoseCheck() {
  const { techniqueId = '' } = useParams();
  const location = useLocation() as { state?: { references?: ChatSource[] } };
  const technique = resolveTechnique(decodeURIComponent(techniqueId));
  const [refs, setRefs] = useState<ChatSource[] | null>(location.state?.references ?? null);
  const [refNote, setRefNote] = useState<string | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<PoseCheckResult | null>(null);
  const [saved, setSaved] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // opened directly (not from the coach): find the single-technique reference first
  useEffect(() => {
    if (refs || !technique || !poseSupport(technique).supported) return;
    let live = true;
    const sport = technique.martialArt.replace(/-/g, ' ');
    void selfResearchProvider.search({ query: `${technique.name} ${sport} technique tutorial`, queries: [`how to ${technique.name} ${sport}`], kind: 'video', maxResults: 8 }).then((o) => {
      if (!live) return;
      if (!o.ok) {
        setRefs([]);
        setRefNote(`기준 영상을 검색하지 못했습니다: ${o.message}`);
        return;
      }
      const { picked, rejected } = pickReferenceVideos(toSources(o.results), technique);
      setRefs(picked);
      if (!picked.length) setRefNote(`단일 기술 기준 영상을 찾지 못했습니다(${[...new Set(rejected.map((r) => r.why))].join(', ') || '결과 없음'}).`);
    });
    return () => {
      live = false;
    };
  }, [technique?.id]);

  if (!technique) return <div className="page"><BackButton /><p>기술을 찾지 못했습니다.</p></div>;
  const support = poseSupport(technique);
  const guide = captureGuide(technique);
  const ready = support.supported && !!refs?.length;

  async function onFile(file: File) {
    if (!technique) return;
    setBusy('영상에서 관절을 찾는 중… (이 기기에서만 처리)');
    setResult(null);
    setSaved(false);
    try {
      const { sampleVideoBlob } = await import('../lib/formCompare/clipCapture');
      const clip = await sampleVideoBlob(file, { fps: 10, endSeconds: 15, onProgress: (d, t) => setBusy(`영상 분석 중… ${Math.round((d / t) * 100)}%`) });
      const r = evaluatePoseFrames(technique, clip.poses, { visibleRatio: clip.signals.visibleRatio, fullBodyRatio: clip.signals.fullBodyRatio, issues: clip.signals.issues, cameraView: clip.signals.cameraView, segment: clip.signals.segment });
      setResult(r);
      if (r.ok && r.result) {
        saveAnalysisResult(technique.martialArt, r.result);
        setSaved(true);
      }
    } catch {
      setResult({ technique, ok: false, failure: '영상을 열지 못했습니다(지원하지 않는 형식이거나 손상된 파일). 다른 영상으로 시도해 주세요.', result: null, measured: [], unmeasured: [], reliability: { label: '낮음', reasons: [] }, nextTraining: [] });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="page" data-testid="pose-check">
      <BackButton />
      <div className="section-title">
        <h1><Icon name="camera" /> {technique.koreanName ?? technique.name} 자세 확인</h1>
      </div>
      {!support.supported ? (
        <div className="card info-card" data-testid="pose-check-unsupported">
          <p>{support.reason}</p>
          {support.alternatives.length > 0 && <p className="muted">같은 무술에서 측정할 수 있는 기술: {support.alternatives.map((a) => a.name).join(', ')}</p>}
        </div>
      ) : (
        <>
          <div className="card info-card" data-testid="pose-check-guide">
            <h3>촬영 안내</h3>
            <ul>
              <li>화면 범위: {guide!.bodyRange}</li>
              <li>카메라 높이: {guide!.cameraHeight} · 거리: {guide!.distance}</li>
              <li>위치: {guide!.placement}</li>
              <li>동작: {guide!.motion}</li>
              <li>방향: {guide!.direction}</li>
            </ul>
            <p className="muted">측정 항목(MARTIALDEX 자세 기준): {guide!.measures.join(', ')}. 기준 영상과 비교한 점수가 아닙니다.</p>
          </div>
          <div className="card info-card">
            <h3>기준 영상</h3>
            {refs === null ? <p className="muted">단일 기술 기준 영상을 찾는 중…</p> : refs.length ? (
              <>
                <p className="muted">제목·설명으로 고른 영상입니다. 영상 속 자세는 앱이 확인하지 않았습니다.</p>
                <VideoResultCards videos={refs} testId="pose-check-references" />
              </>
            ) : <p data-testid="pose-check-no-reference">{refNote ?? '기준 영상이 없습니다.'} 기준 영상이 없어 측정을 시작하지 않습니다.</p>}
          </div>
          <div className="card info-card coach-turn__quick">
            <button className="btn btn-primary" disabled={!ready || !!busy} onClick={() => setCameraOpen(true)} data-testid="pose-check-camera">카메라로 측정</button>
            <button className="btn btn-secondary" disabled={!ready || !!busy} onClick={() => fileRef.current?.click()} data-testid="pose-check-file">영상 파일로 측정</button>
            <input ref={fileRef} type="file" accept="video/*" hidden onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} data-testid="pose-check-file-input" />
            {busy && <p className="muted">{busy}</p>}
          </div>
          {result && (
            <div className="card info-card" data-testid="pose-check-result" data-ok={result.ok ? 'true' : 'false'}>
              <h3>결과 — {technique.koreanName ?? technique.name}</h3>
              {result.ok && result.result ? (
                <>
                  <p>측정 성공 · 종합 자세 점수 <strong>{result.result.overallScore}</strong> / 100 · 측정 신뢰도 {result.reliability.label}{result.reliability.reasons.length ? ` (${result.reliability.reasons.join(', ')})` : ''}</p>
                  <ul>
                    {result.measured.map((m) => (
                      <li key={m.name}>{m.name}: {m.score}점 — {m.detail}</li>
                    ))}
                  </ul>
                  {result.result.strengths.length > 0 && <p><Icon name="check" /> 잘한 부분: {result.result.strengths.join(', ')}</p>}
                  {result.result.improvements.length > 0 && <p><Icon name="warn" /> 개선할 부분: {result.result.improvements.join(', ')}</p>}
                  {result.unmeasured.length > 0 && <p className="muted">측정 불가(점수에 넣지 않음): {result.unmeasured.map((u) => u.name).join(', ')}</p>}
                  <p>다음 훈련: {result.nextTraining.join(' ')}</p>
                  <p className="muted">{saved ? '자세 점수 기록에 저장했습니다(학습 숙련도와 별도).' : ''}</p>
                </>
              ) : (
                <p role="alert">측정하지 못했습니다 — {result.failure} 점수와 기록은 바뀌지 않았습니다.</p>
              )}
            </div>
          )}
        </>
      )}
      {cameraOpen && (
        <Suspense fallback={null}>
          <PoseAnalysisModal technique={technique} onClose={() => setCameraOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
