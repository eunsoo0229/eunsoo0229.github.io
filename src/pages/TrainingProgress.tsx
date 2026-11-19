import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import BackButton from '../components/BackButton';
import EmptyState from '../components/EmptyState';
import Icon from '../components/Icon';
import { getAllRecords } from '../lib/poseAnalysis/recordsService';
import { getTechnique } from '../lib/loadData';
import { STORAGE_REPLACED_EVENT } from '../lib/storageEvents';

const POSE_EVENT = 'martialdex:pose-records-updated';
import { CONFIDENCE_LABEL, CONSISTENCY_LABEL, METHOD_LABEL, buildSeries, periodSummary, type SeriesReport } from '../lib/progressReport/analysis';

const PERIODS = [30, 90, 365];

function techName(id: string): string {
  const t = getTechnique(id);
  return t ? (t.koreanName && t.koreanName !== t.name ? `${t.name} (${t.koreanName})` : t.name) : id;
}

/** 훈련 성과 검증 — 기존 자세 측정 기록만으로 기술별 변화를 보여 준다. 새 점수를 만들지 않는다. */
export default function TrainingProgress() {
  const [records, setRecords] = useState(() => getAllRecords());
  const [period, setPeriod] = useState(90);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    const on = () => setRecords(getAllRecords());
    window.addEventListener(POSE_EVENT, on);
    window.addEventListener(STORAGE_REPLACED_EVENT, on);
    return () => {
      window.removeEventListener(POSE_EVENT, on);
      window.removeEventListener(STORAGE_REPLACED_EVENT, on);
    };
  }, []);

  const series = useMemo(() => buildSeries(records), [records]);
  const summary = useMemo(() => periodSummary(records, period), [records, period]);

  return (
    <div className="page">
      <div className="container">
        <BackButton fallback="/training" />
        <div className="eco-page-head">
          <div>
            <div className="eco-kicker">훈련 성과 검증</div>
            <h2>기술별 성장 기록</h2>
            <p>자세 측정 기록만 사용합니다. 점수는 분석 점수의 변화이며 실제 실력의 공식 평가가 아닙니다.</p>
          </div>
          <Link to="/program" className="btn btn-secondary btn-sm"><Icon name="calendar" /> 개인 훈련 프로그램</Link>
        </div>

        <div className="eco-notice">
          측정 방식(관절 지표 분석 · 기준 영상 비교 · 3D 기준 비교)마다 점수 척도가 달라 서로 섞어 비교하지 않습니다. 촬영 각도·거리·조명이 다르면 점수가 달라질 수 있으니, 같은 각도로 반복 측정할수록 비교가 정확해집니다.
        </div>

        {records.length === 0 ? (
          <>
            <EmptyState icon="🥋" text="아직 자세 측정 기록이 없습니다. 기술 상세 화면의 자세 분석에서 측정하면 여기에 성장 기록이 쌓입니다." />
            <VideoCompare />
          </>
        ) : (
          <>
            <div className="eco-tabs" role="tablist">
              {PERIODS.map((p) => (
                <button key={p} type="button" role="tab" className="eco-tab" aria-selected={period === p} onClick={() => setPeriod(p)} data-testid={`progress-period-${p}`}>
                  최근 {p === 365 ? '1년' : `${p}일`}
                </button>
              ))}
            </div>
            <div className="eco-metrics" data-testid="progress-summary">
              <div className="eco-metric"><div className="eco-metric__label">측정 횟수</div><div className="eco-metric__value">{summary.measurements}</div></div>
              <div className="eco-metric"><div className="eco-metric__label">측정한 기술</div><div className="eco-metric__value">{summary.techniques}</div></div>
              <div className="eco-metric"><div className="eco-metric__label">점수가 오른 기술</div><div className="eco-metric__value">{summary.improvedCount}</div><div className="eco-metric__sub">기간 안 2회 이상 측정, +5점 이상</div></div>
              <div className="eco-metric"><div className="eco-metric__label">점수가 내린 기술</div><div className="eco-metric__value">{summary.declinedCount}</div><div className="eco-metric__sub">-5점 이하</div></div>
            </div>
            {summary.changes.length === 0 && <p className="eco-meta">이 기간에 같은 기술을 2회 이상 측정한 기록이 없어 기간 변화를 계산할 수 없습니다.</p>}

            <div className="eco-section"><h3>기술별 변화</h3><span className="eco-meta">{series.length}개 기록 묶음</span></div>
            <div className="eco-stack" data-testid="progress-series">
              {series.map((s) => (
                <SeriesCard key={`${s.techniqueId}:${s.method}`} s={s} open={open === `${s.techniqueId}:${s.method}`} onToggle={() => setOpen(open === `${s.techniqueId}:${s.method}` ? null : `${s.techniqueId}:${s.method}`)} />
              ))}
            </div>
            <VideoCompare />
          </>
        )}
      </div>
    </div>
  );
}

function SeriesCard({ s, open, onToggle }: { s: SeriesReport; open: boolean; onToggle: () => void }) {
  const t = getTechnique(s.techniqueId);
  const max = 100;
  return (
    <div className="eco-card" data-testid="progress-series-card">
      <div className="eco-row eco-row--between">
        <div>
          <strong>{techName(s.techniqueId)}</strong>
          <div className="eco-meta">{METHOD_LABEL[s.method]} · 측정 {s.records.length}회 · {new Date(s.first.analyzedAt).toLocaleDateString('ko-KR')} → {new Date(s.latest.analyzedAt).toLocaleDateString('ko-KR')}</div>
        </div>
        <div className="eco-row">
          <span className="eco-pill">처음 {s.first.score} → 최근 {s.latest.score}</span>
          {s.records.length >= 2 && <span className={`eco-pill ${s.scoreDelta >= 5 ? 'eco-pill--good' : s.scoreDelta <= -5 ? 'eco-pill--accent' : ''}`}>{s.scoreDelta > 0 ? '+' : ''}{s.scoreDelta}</span>}
          <span className={`eco-pill ${s.confidence.level === 'moderate' ? 'eco-pill--good' : 'eco-pill--warn'}`} data-testid="progress-confidence">{CONFIDENCE_LABEL[s.confidence.level]}</span>
        </div>
      </div>
      <div className="eco-dist" style={{ height: 40, gridTemplateColumns: `repeat(${Math.min(20, s.records.length)}, 1fr)`, marginTop: 8 }} aria-label="측정 점수 추이">
        {s.records.slice(-20).map((r) => (
          <span key={r.recordId} style={{ height: `${Math.max(4, (r.score / max) * 100)}%`, opacity: r.reliability === 'low' ? 0.45 : 1 }} title={`${new Date(r.analyzedAt).toLocaleDateString('ko-KR')} ${r.score}점${r.reliability === 'low' ? ' (신뢰도 낮음)' : ''}`} />
        ))}
      </div>
      <div className="eco-meta" style={{ marginTop: 4 }}>반복 측정 일관성: {CONSISTENCY_LABEL[s.consistency]}{s.spread !== null ? ` (표준편차 ${s.spread})` : ''} · 흐린 막대 = 측정 신뢰도 낮음</div>
      {s.confidence.reasons.length > 0 && <ul className="eco-meta" style={{ margin: '6px 0 0', paddingLeft: 18 }}>{s.confidence.reasons.map((r) => <li key={r}>{r}</li>)}</ul>}
      <button type="button" className="btn btn-ghost btn-sm" onClick={onToggle} style={{ marginTop: 6 }} data-testid="progress-series-toggle">{open ? '접기' : '항목별 자세히'}</button>
      {open && (
        <div className="eco-stack" style={{ marginTop: 6 }}>
          {s.metrics.length === 0 ? (
            <p className="eco-meta">항목별 점수가 저장되지 않은 기록입니다.</p>
          ) : (
            <div className="eco-table-wrap">
              <table className="eco-table">
                <thead><tr><th>자세 항목</th><th>처음</th><th>최근</th><th>변화</th><th>60점 미만</th></tr></thead>
                <tbody>
                  {s.metrics.map((m) => (
                    <tr key={m.metricId}>
                      <td>{m.name}</td>
                      <td>{m.first}</td>
                      <td>{m.latest}</td>
                      <td className={m.samples < 2 ? 'eco-missing' : m.delta >= 5 ? 'eco-best' : ''}>{m.samples < 2 ? '1회 측정' : `${m.delta > 0 ? '+' : ''}${m.delta}`}</td>
                      <td>{m.weakCount}/{m.samples}회</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {s.improved.length > 0 && <div><strong className="eco-meta">개선된 항목</strong> <span className="eco-row">{s.improved.map((m) => <span key={m.metricId} className="eco-pill eco-pill--good">{m.name} +{m.delta}</span>)}</span></div>}
          {s.notImproved.length > 0 && <div><strong className="eco-meta">개선되지 않은 항목</strong> <span className="eco-row">{s.notImproved.map((m) => <span key={m.metricId} className="eco-pill">{m.name} {m.delta > 0 ? '+' : ''}{m.delta}</span>)}</span></div>}
          {s.recurringWeak.length > 0 && <div><strong className="eco-meta">반복되는 약점 (측정의 절반 이상에서 60점 미만)</strong> <span className="eco-row">{s.recurringWeak.map((m) => <span key={m.metricId} className="eco-pill eco-pill--accent">{m.name} {m.weakCount}/{m.samples}회</span>)}</span></div>}
          {t && (
            <div className="eco-row">
              <Link className="btn btn-secondary btn-sm" to={`/arts/${t.martialArt}/techniques/${t.id}?open=pose`}><Icon name="camera" /> 다시 측정하기</Link>
              <Link className="btn btn-ghost btn-sm" to={`/arts/${t.martialArt}/techniques/${t.id}`}><Icon name="gi" /> 기술 상세·3D 프리뷰</Link>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ANGLES = [
  { id: 'side', label: '측면' },
  { id: 'front', label: '정면' },
  { id: 'diagonal', label: '대각선' },
];

/**
 * 과거 영상 vs 최근 영상 — 앱은 사용자 촬영 영상을 서버에 올리거나 보관하지 않으므로, 기기에 있는 두 영상을
 * 직접 고른다(파일은 이 화면에서만 열리고 저장·전송되지 않음). 재생 동기화 · 비교 구간 · 촬영 각도 확인.
 * 각도가 다르면 경고만 하고 영상을 변환하지 않는다.
 */
function VideoCompare() {
  const a = useRef<HTMLVideoElement>(null);
  const b = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<{ a: string | null; b: string | null }>({ a: null, b: null });
  const [angle, setAngle] = useState<{ a: string; b: string }>({ a: 'side', b: 'side' });
  const [range, setRange] = useState<{ aStart: number; bStart: number; length: number }>({ aStart: 0, bStart: 0, length: 0 });
  const [dur, setDur] = useState<{ a: number; b: number }>({ a: 0, b: 0 });
  const [rate, setRate] = useState(1);
  const [playing, setPlaying] = useState(false);

  useEffect(() => () => {
    if (src.a) URL.revokeObjectURL(src.a);
    if (src.b) URL.revokeObjectURL(src.b);
  }, [src.a, src.b]);

  function pick(which: 'a' | 'b', f: File | undefined) {
    if (!f) return;
    if (!f.type.startsWith('video/')) return alert('영상 파일만 고를 수 있습니다.');
    setSrc((s) => {
      if (s[which]) URL.revokeObjectURL(s[which]!);
      return { ...s, [which]: URL.createObjectURL(f) };
    });
  }

  const seg = range.length > 0 ? range.length : Math.max(0, Math.min(dur.a - range.aStart, dur.b - range.bStart));

  function syncTo(start: boolean) {
    if (!a.current || !b.current) return;
    if (start) {
      a.current.currentTime = range.aStart;
      b.current.currentTime = range.bStart;
    }
    a.current.playbackRate = rate;
    b.current.playbackRate = rate;
  }
  async function play() {
    if (!a.current || !b.current) return;
    syncTo(true);
    await Promise.all([a.current.play().catch(() => null), b.current.play().catch(() => null)]);
    setPlaying(true);
  }
  function pause() {
    a.current?.pause();
    b.current?.pause();
    setPlaying(false);
  }
  // keep B locked to A's offset; stop at the segment end
  useEffect(() => {
    if (!playing) return;
    const id = window.setInterval(() => {
      if (!a.current || !b.current) return;
      const t = a.current.currentTime - range.aStart;
      if (seg > 0 && t >= seg) {
        pause();
        return;
      }
      const want = range.bStart + t;
      if (Math.abs(b.current.currentTime - want) > 0.08) b.current.currentTime = want;
    }, 100);
    return () => window.clearInterval(id);
  }, [playing, range.aStart, range.bStart, seg]);

  return (
    <section className="eco-card" style={{ marginTop: 18 }} data-testid="video-compare">
      <h3><Icon name="video" /> 과거 영상과 최근 영상 비교</h3>
      <p className="eco-meta">기기에 있는 영상 두 개를 고르세요. 영상은 이 화면에서만 열리며 저장되거나 업로드되지 않습니다.</p>
      <div className="eco-video-pair">
        {(['a', 'b'] as const).map((w) => (
          <div key={w} className="eco-stack" style={{ gap: 6 }}>
            <strong>{w === 'a' ? '과거 영상' : '최근 영상'}</strong>
            <input type="file" accept="video/*" onChange={(e) => pick(w, e.target.files?.[0])} data-testid={`video-compare-file-${w}`} />
            {src[w] ? (
              <video ref={w === 'a' ? a : b} src={src[w]!} muted playsInline controls={false} onLoadedMetadata={(e) => setDur((d) => ({ ...d, [w]: e.currentTarget.duration || 0 }))} />
            ) : (
              <div className="eco-card__media" style={{ margin: 0, borderRadius: 'var(--radius)' }}><Icon name="video" /></div>
            )}
            <label className="eco-meta">
              촬영 각도{' '}
              <select className="select" value={angle[w]} onChange={(e) => setAngle((x) => ({ ...x, [w]: e.target.value }))}>
                {ANGLES.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
              </select>
            </label>
            <label className="eco-meta">
              비교 시작 지점 {(w === 'a' ? range.aStart : range.bStart).toFixed(1)}초
              <input type="range" min={0} max={Math.max(0, (w === 'a' ? dur.a : dur.b) - 0.1)} step={0.1} value={w === 'a' ? range.aStart : range.bStart} onChange={(e) => setRange((r) => ({ ...r, [w === 'a' ? 'aStart' : 'bStart']: Number(e.target.value) }))} disabled={!src[w]} style={{ width: '100%' }} />
            </label>
          </div>
        ))}
      </div>
      {angle.a !== angle.b && (
        <div className="eco-notice" data-testid="video-compare-angle-warning">두 영상의 촬영 각도가 다릅니다. 앱은 영상 시점을 바꾸지 않으므로 같은 각도로 찍은 영상끼리 비교해야 자세 차이를 정확히 볼 수 있습니다.</div>
      )}
      <div className="eco-form-grid" style={{ marginTop: 8 }}>
        <label className="eco-meta">
          비교 구간 길이 {seg.toFixed(1)}초
          <input type="range" min={0} max={Math.max(0, Math.min(dur.a - range.aStart, dur.b - range.bStart))} step={0.1} value={range.length} onChange={(e) => setRange((r) => ({ ...r, length: Number(e.target.value) }))} disabled={!src.a || !src.b} style={{ width: '100%' }} />
        </label>
        <label className="eco-meta">
          재생 속도
          <select className="select" value={rate} onChange={(e) => setRate(Number(e.target.value))}>
            {[0.25, 0.5, 1].map((r) => <option key={r} value={r}>{r}x</option>)}
          </select>
        </label>
      </div>
      <div className="eco-row" style={{ marginTop: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={play} disabled={!src.a || !src.b} data-testid="video-compare-play"><Icon name="play" /> 구간 동시 재생</button>
        <button type="button" className="btn btn-secondary btn-sm" onClick={pause} disabled={!playing}><Icon name="pause" /> 정지</button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => syncTo(true)} disabled={!src.a || !src.b}>시작 지점으로</button>
      </div>
      <p className="eco-meta" style={{ marginTop: 8 }}>3D 기준 동작과 내 영상을 점수로 비교하려면 기술 상세의 자세 분석 → 기준 영상 비교에서 3D 기준 영상을 쓰세요.</p>
    </section>
  );
}
