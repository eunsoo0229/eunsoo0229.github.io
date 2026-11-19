import Icon from '../Icon';
import type { CoachAction } from '../../lib/coachKnowledge/featureCatalog';

// 자체 AI 코치가 MARTIALDEX 기능을 열기 직전의 카드. A feature that can be
// opened shows what will open and asks (inside a lesson the student leaves
// the lesson screen); one that can't says why and offers real choices.

export default function CoachActionCard({ action, onOpen, onChoose, onDismiss }: { action: CoachAction; onOpen: (route: string) => void; onChoose: (text: string) => void; onDismiss: () => void }) {
  return (
    <div className="card info-card" data-testid="coach-action" data-feature={action.featureId ?? ''} data-ok={action.ok ? '1' : '0'} style={{ margin: '8px 0' }}>
      <p style={{ margin: '0 0 8px' }} data-testid="coach-action-message">
        {action.ok && <><Icon name="forward" /> {action.title}: </>}
        {action.message}
      </p>
      <div className="modal-actions modal-actions--start" style={{ flexWrap: 'wrap' }}>
        {action.ok && (
          <button type="button" className="btn btn-primary btn-sm" data-testid="coach-action-open" onClick={() => onOpen(action.route)}>
            열기
          </button>
        )}
        {!action.ok &&
          action.choices?.map((c) => (
            <button key={c.text} type="button" className="btn btn-secondary btn-sm" data-testid="coach-action-choice" onClick={() => onChoose(c.text)}>
              {c.label}
            </button>
          ))}
        <button type="button" className="btn btn-ghost btn-sm" data-testid="coach-action-dismiss" onClick={onDismiss}>
          {action.ok ? '수업 계속하기' : '닫기'}
        </button>
      </div>
    </div>
  );
}
