import { useMemo, useState } from 'react';
import Icon from '../Icon';
import { checklistItems, localDate, saveChecklist, useChecklistsOn } from '../../lib/safety/checklist';
import { safetyGuide, STOP_RULE, type SafetyKind } from '../../lib/safety/techniqueSafety';
import { resolve } from '../../lib/trainingEcosystem/useEco';

// 훈련 전 안전 체크리스트 (사양 §5-3). Saved per day (linked to that day's training records by date). Skipping it never
// blocks training — the important items are just stated plainly.

export default function SafetyChecklistCard({ techniqueIds, compact = false }: { techniqueIds: string[]; compact?: boolean }) {
  const today = localDate();
  const saved = useChecklistsOn(today);
  const [withPartner, setWithPartner] = useState(false);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [pain, setPain] = useState<boolean | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const { kinds, equipment } = useMemo(() => {
    const k = new Set<SafetyKind>();
    const eq = new Set<string>();
    for (const id of techniqueIds) {
      const t = resolve(id);
      if (!t) continue;
      const g = safetyGuide(t);
      g.kinds.forEach((x) => k.add(x));
      g.equipment.forEach((x) => eq.add(x));
    }
    return { kinds: [...k], equipment: [...eq] };
  }, [techniqueIds]);
  const items = checklistItems({ kinds, withPartner, equipment });
  const last = saved[0];

  function save() {
    saveChecklist({ techniqueIds, withPartner, checked, pain, note: null });
    setMsg(pain ? '통증·이상 증상이 있다고 기록했습니다. 오늘은 무리하지 말고, 증상이 계속되면 의료 전문가와 상담하세요.' : '오늘의 안전 체크를 저장했습니다 — 오늘 훈련 기록과 함께 확인할 수 있습니다.');
  }

  return (
    <section className={`card eco-checklist${compact ? ' eco-checklist--compact' : ''}`} data-testid="safety-checklist">
      <h3>
        <Icon name="check" /> 훈련 전 안전 체크
      </h3>
      {last && <p className="muted">오늘 {last.at.slice(11, 16)}에 체크함 · {Object.values(last.checked).filter(Boolean).length}개 확인{last.pain ? ' · 통증·이상 증상 있음으로 기록' : ''}</p>}
      <label className="eco-checklist__row">
        <input type="checkbox" checked={withPartner} onChange={(e) => setWithPartner(e.target.checked)} /> 오늘 파트너와 연습합니다
      </label>
      {items.map((it) => (
        <label key={it.id} className={`eco-checklist__row${it.important ? ' eco-checklist__row--important' : ''}`}>
          <input type="checkbox" checked={!!checked[it.id]} onChange={(e) => setChecked((c) => ({ ...c, [it.id]: e.target.checked }))} /> {it.label}
          {it.important && <span className="chip">중요</span>}
        </label>
      ))}
      <div className="eco-checklist__row">
        통증이나 이상 증상이 있나요?{' '}
        <button type="button" className={`chip${pain === false ? ' active' : ''}`} onClick={() => setPain(false)}>
          없음
        </button>
        <button type="button" className={`chip${pain === true ? ' active' : ''}`} onClick={() => setPain(true)}>
          있음
        </button>
      </div>
      {pain === true && <p className="eco-safety__stop">{STOP_RULE}</p>}
      <button type="button" className="btn btn-secondary btn-sm" onClick={save} data-testid="safety-checklist-save">
        체크 저장
      </button>
      {msg && <p className="muted">{msg}</p>}
      {!compact && <p className="muted">체크하지 않아도 훈련은 시작할 수 있습니다. 다만 준비운동과(파트너 연습이라면) 탭·강도 합의는 꼭 확인해 주세요.</p>}
    </section>
  );
}

