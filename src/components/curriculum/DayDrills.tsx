import Icon from '../Icon';
import type { CurriculumDrill } from '../../lib/curriculum/types';
import { DRILL_KIND_LABEL } from '../../lib/martialdexKnowledge/drills';
import { SEQUENCE_ORIGIN_LABEL } from '../../lib/martialdexKnowledge/types';

// Setup / combo / connection drills of a curriculum Day (CurriculumDay.drills).
// Shows where each one is recorded so the learner can tell DB records from
// other users' shared combos.
export default function DayDrills({ drills, compact = false }: { drills?: CurriculumDrill[]; compact?: boolean }) {
  if (!drills?.length) return null;
  if (compact) {
    return (
      <p className="video-status-message" style={{ margin: 0 }} data-testid="day-drills-compact">
        연습: {drills.map((d) => `${DRILL_KIND_LABEL[d.kind]} ${d.steps.map((s) => s.name).join('→')}`).join(' · ')}
      </p>
    );
  }
  return (
    <div className="card info-card" data-testid="day-drills">
      <h3><Icon name="link" /> 셋업 · 콤보 · 연결</h3>
      <div className="stack gap-2">
        {drills.map((d) => (
          <div key={d.sequenceId} className="day-drill">
            <div>
              <span className="chip">{DRILL_KIND_LABEL[d.kind]}</span> <strong>{d.steps.map((s) => s.name).join(' → ')}</strong>
            </div>
            {d.purpose && <p className="video-status-message" style={{ margin: '4px 0 0' }}>{d.purpose}</p>}
            {d.steps.some((s) => s.opponentReaction || s.note) && (
              <ul style={{ margin: '4px 0 0' }}>
                {d.steps
                  .filter((s) => s.opponentReaction || s.note)
                  .map((s, i) => (
                    <li key={i}>
                      {s.name}
                      {s.note ? ` — ${s.note}` : ''}
                      {s.opponentReaction ? ` (상대 반응: ${s.opponentReaction})` : ''}
                    </li>
                  ))}
              </ul>
            )}
            <p className="video-status-message" style={{ margin: '4px 0 0', fontSize: 12 }}>
              출처: {d.sequenceId.startsWith('follow:') ? 'MARTIALDEX 기술 DB의 연결 동작 기록' : SEQUENCE_ORIGIN_LABEL[d.origin]}
              {d.newStepIds?.length ? ' · 새 동작 1개 포함' : ''}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
