import Icon from './Icon';
import type { TrainingHistoryEntry } from '../lib/trainingHistory/types';
import { getMartialArt } from '../lib/loadData';
import { GYM_MARTIAL_ART_ID } from '../lib/gymTraining/library';
import { WEEKDAY_LABEL } from '../lib/dateUtil';
import { deriveEntryCurriculumTitle, deriveEntryMartialArt, deriveEntrySetsReps, deriveEntryTechniqueNames } from '../lib/trainingAnalytics/historyView';
import { SourceIcon } from './icons/BrandAssets';

// The source cue in front of each title is the Forge 'sources' glyph (SourceIcon) — the
// "🥊 체육관 복싱 수업 / 🏋 하체 근력 루틴" examples of spec item 12, as icons.

// One real TrainingHistoryEntry rendered as a clickable row — the exact
// markup previously duplicated across TrainingAnalytics.tsx (recent list +
// calendar day list) and TrainingHistoryList.tsx; now shared so Dashboard
// (28단계) can reuse it too without a fourth copy.
export default function TrainingEntryRow({
  entry,
  onClick,
  compact = false,
  onDelete,
}: {
  entry: TrainingHistoryEntry;
  onClick: () => void;
  compact?: boolean;
  /** Optional — when given, renders a small "✕" delete affordance as a SIBLING of the row's own button (never nested inside it, which would be invalid HTML). Every existing caller that omits this renders exactly as before. */
  onDelete?: () => void;
}) {
  // getMartialArt (not martialArtSummaries.find) so a home-training free-
  // training entry shows "홈트" instead of falling through to the generic
  // "훈련" label — getMartialArt resolves 'home-training' via loadData.ts's
  // Map even though it's deliberately excluded from the martialArtSummaries
  // array itself (see loadData.ts's comment for why).
  const derivedMartialArt = deriveEntryMartialArt(entry);
  const martialArtName = getMartialArt(derivedMartialArt ?? '')?.nameKo;
  const curriculumTitle = deriveEntryCurriculumTitle(entry);
  const techniqueNames = deriveEntryTechniqueNames(entry);
  const setsReps = deriveEntrySetsReps(entry);
  const duration = entry.actualMinutes ?? entry.estimatedMinutes;
  const baseTitle = entry.gymClassMeta
    ? `체육관 · ${entry.gymClassMeta.classTitle}`
    : entry.visualMitt
        ? `AI Visualizing Mitt · ${entry.visualMitt.comboName}`
      : entry.gymRoutine
        ? `${entry.gymRoutine.routineName} · ${WEEKDAY_LABEL[entry.gymRoutine.weekday]}요일 루틴${entry.gymRoutine.substituted ? ' 기반' : ''}`
      : curriculumTitle ?? martialArtName ?? '훈련';
  const fitness = entry.source === 'gym_class' && derivedMartialArt === GYM_MARTIAL_ART_ID;
  const title = (
    <>
      <SourceIcon source={entry.source} fitness={fitness} /> {baseTitle}
    </>
  );

  if (compact) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
        <button type="button" className="pose-history-row__main" style={{ width: '100%' }} onClick={onClick}>
          <span>{title}</span>
          <span>{duration}분</span>
        </button>
        {onDelete && (
          <button type="button" className="icon-action-btn" aria-label="삭제" onClick={onDelete}>
            <Icon name="close" />
          </button>
        )}
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', alignItems: 'stretch', gap: 4 }}>
      <button
        type="button"
        className="pose-history-row__main"
        style={{ width: '100%', flexDirection: 'column', alignItems: 'flex-start', gap: 4 }}
        onClick={onClick}
      >
        <strong>{title}</strong>
        {techniqueNames.length > 0 && <span>{techniqueNames.join(' · ')}</span>}
        <span>
          {setsReps ? `${setsReps.totalSets}세트${setsReps.totalReps !== null ? ` / ${setsReps.totalReps}회` : ''} · ` : ''}
          {duration}분{!entry.completed ? ' · 미완료' : ''}
        </span>
      </button>
      {onDelete && (
        <button type="button" className="icon-action-btn" aria-label="삭제" onClick={onDelete}>
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
