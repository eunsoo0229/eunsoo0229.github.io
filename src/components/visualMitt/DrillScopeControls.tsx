import Icon from '../Icon';
import { useEffect, useMemo, useState } from 'react';
import { DRILL_RANGE_LABEL, drillProfile, type DrillProfile, type DrillRange } from '../../lib/visualMitt/artDrills';
import { playableShared, useSharedCombos } from '../../lib/visualMitt/sharedMitt';
import type { MittCombo } from '../../lib/visualMitt/combos';
import { getMartialArt } from '../../lib/loadData';

export interface DrillScope {
  profile: DrillProfile;
  range: DrillRange;
  withKicks: boolean;
  withDefense: boolean;
  withShared: boolean;
  /** 사용자 공유 콤보 the mitt can play as written (empty while loading / when off). */
  shared: MittCombo[];
  sharedLoading: boolean;
  set: (patch: Partial<Pick<DrillScope, 'range' | 'withKicks' | 'withDefense' | 'withShared'>>) => void;
}

/** The art's drill format + the user's scope choices (reset to the art's defaults when the art changes). */
export function useDrillScope(art: string | null | undefined): DrillScope {
  const profile = useMemo(() => drillProfile(art), [art]);
  const defaults = () => ({ range: 'basic' as DrillRange, withKicks: profile.kicks === 'on', withDefense: profile.defenseDefault, withShared: true });
  const [s, setS] = useState(defaults);
  useEffect(() => setS(defaults()), [profile]); // eslint-disable-line react-hooks/exhaustive-deps
  const sharedList = useSharedCombos(null, s.withShared);
  const shared = useMemo(() => (s.withShared ? playableShared(sharedList.list) : []), [s.withShared, sharedList.list]);
  return { profile, ...s, shared, sharedLoading: s.withShared && sharedList.loading, set: (patch) => setS((x) => ({ ...x, ...patch })) };
}

/** 종목 형식 · 기술 범위 · 킥/방어/사용자 콤보 switches, shared by 공격 지시 and 반응 훈련. */
export default function DrillScopeControls({ scope, disabled, testIdPrefix }: { scope: DrillScope; disabled?: boolean; testIdPrefix: string }) {
  const { profile } = scope;
  const artName = profile.id === 'art' && profile.art ? getMartialArt(profile.art)?.nameKo ?? profile.art : profile.label;
  return (
    <>
      <p className="video-status-message" style={{ margin: '0 0 6px' }} data-testid={`${testIdPrefix}-style`} data-style={profile.id}>
        <strong>종목: {artName}</strong> — {profile.summary}
      </p>
      <div className="chip-row">
        <span className="field-label" style={{ margin: 0 }}>기술 범위</span>
        {(Object.keys(DRILL_RANGE_LABEL) as DrillRange[]).map((r) => (
          <button key={r} type="button" className={`chip${scope.range === r ? ' active' : ''}`} onClick={() => scope.set({ range: r })} disabled={disabled} data-testid={`${testIdPrefix}-range-${r}`}>
            {DRILL_RANGE_LABEL[r]}
          </button>
        ))}
        {profile.kicks !== 'off' && (
          <label className="chip" style={{ cursor: 'pointer' }}>
            <input type="checkbox" checked={scope.withKicks} onChange={(e) => scope.set({ withKicks: e.target.checked })} disabled={disabled} data-testid={`${testIdPrefix}-kicks`} /> 킥·니 포함
          </label>
        )}
        <label className="chip" style={{ cursor: 'pointer' }} title={profile.id === 'wrestling' ? '코치가 태클을 들어오면 스프롤·다운블락·점프 스프롤·위저로 막기' : '코치가 공격을 뻗으면 피하거나 막고, 바로 카운터'}>
          <input type="checkbox" checked={scope.withDefense} onChange={(e) => scope.set({ withDefense: e.target.checked })} disabled={disabled} data-testid={`${testIdPrefix}-defense`} /> <Icon name="shield" /> {profile.id === 'wrestling' ? '태클 방어 포함' : '방어 포함'}
        </label>
        <label className="chip" style={{ cursor: 'pointer' }} title="MARTIALDEX 사용자들이 공유한 콤보·셋업 중 이 종목 동작만으로 된 것">
          <input type="checkbox" checked={scope.withShared} onChange={(e) => scope.set({ withShared: e.target.checked })} disabled={disabled} data-testid={`${testIdPrefix}-shared`} /> <Icon name="book" /> 사용자 콤보 포함{scope.sharedLoading ? ' (불러오는 중…)' : ''}
        </label>
      </div>
    </>
  );
}
