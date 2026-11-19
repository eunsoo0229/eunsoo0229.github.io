// The recording gauge: a horizontal bar that drains from full to empty over the capture window, with the
// remaining seconds. Shown only while recording (after the countdown).

export default function CaptureGauge({ remainingMs, durationMs }: { remainingMs: number; durationMs: number }) {
  const fraction = durationMs > 0 ? Math.min(1, Math.max(0, remainingMs / durationMs)) : 0;
  return (
    <div className="capture-gauge" data-testid="capture-gauge" data-remaining-ms={Math.round(remainingMs)} data-duration-ms={Math.round(durationMs)}>
      <div className="capture-gauge__head">
        <span className="capture-gauge__rec">● 촬영 중</span>
        <span className="capture-gauge__left" data-testid="capture-gauge-left">
          {(remainingMs / 1000).toFixed(1)}초 남음
        </span>
      </div>
      <div className="capture-gauge__track" role="progressbar" aria-label="남은 촬영 시간" aria-valuemin={0} aria-valuemax={Math.round(durationMs)} aria-valuenow={Math.round(remainingMs)}>
        <div className="capture-gauge__fill" style={{ width: `${fraction * 100}%` }} />
      </div>
    </div>
  );
}
