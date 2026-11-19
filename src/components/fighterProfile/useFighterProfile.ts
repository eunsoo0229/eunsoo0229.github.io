import { useCallback, useEffect, useState } from 'react';
import { FIGHTER_PROFILE_EVENT, getProfile, saveProfile } from '../../lib/fighterProfile/store';
import type { FighterProfile } from '../../lib/fighterProfile/types';

/** The stored profile, re-read whenever it changes (this tab, another tab, a cloud pull). */
export function useFighterProfile(): [FighterProfile, (p: FighterProfile) => void] {
  const [profile, setProfile] = useState<FighterProfile>(() => getProfile());
  useEffect(() => {
    const on = () => setProfile(getProfile());
    window.addEventListener(FIGHTER_PROFILE_EVENT, on);
    window.addEventListener('storage', on);
    return () => {
      window.removeEventListener(FIGHTER_PROFILE_EVENT, on);
      window.removeEventListener('storage', on);
    };
  }, []);
  const save = useCallback((p: FighterProfile) => setProfile(saveProfile(p)), []);
  return [profile, save];
}
