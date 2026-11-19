import { Link } from 'react-router-dom';
import { useGeminiQuota } from '../../lib/monetization/useGeminiQuota';

/** "Gemini 오늘 3/5회 남음" — shown wherever the user picks Gemini. Nothing for signed-out users (the app counts those on-device). */
export default function GeminiQuotaBadge({ compact }: { compact?: boolean }) {
  const q = useGeminiQuota();
  if (!q) return null;
  if (q.unlimited) return <span className="eco-pill eco-pill--good" data-testid="gemini-quota">Gemini 무제한</span>;
  const left = q.remaining ?? 0;
  return (
    <span className={`eco-pill ${left > 0 ? 'eco-pill--muted' : 'eco-pill--warn'}`} data-testid="gemini-quota">
      Gemini 오늘 {left}/{q.limit}회 남음
      {left === 0 && !compact && (
        <> · <Link to="/membership">PRO 무제한</Link></>
      )}
    </span>
  );
}
