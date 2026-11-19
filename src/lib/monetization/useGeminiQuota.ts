import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../supabase/client';
import { useAuth } from '../auth/AuthProvider';
import { GEMINI_QUOTA_EVENT } from '../ai/provider';
import { MEMBERSHIP_CHANGED_EVENT } from './useMembership';

export interface GeminiQuota {
  unlimited: boolean;
  used: number;
  limit: number;
  remaining: number | null;
  resets_at: string;
}

/** The signed-in user's Gemini daily uses as the server counts them (my_gemini_quota). Display only — the gate is server-side. */
export function useGeminiQuota(): GeminiQuota | null {
  const { user, isConfigured } = useAuth();
  const [quota, setQuota] = useState<GeminiQuota | null>(null);
  const reload = useCallback(() => {
    if (!isConfigured || !user || !supabase) {
      setQuota(null);
      return;
    }
    void supabase.rpc('my_gemini_quota').then(({ data, error }) => setQuota(error ? null : (data as GeminiQuota | null)));
  }, [isConfigured, user?.id]);
  useEffect(() => {
    reload();
    window.addEventListener(GEMINI_QUOTA_EVENT, reload);
    window.addEventListener(MEMBERSHIP_CHANGED_EVENT, reload);
    return () => {
      window.removeEventListener(GEMINI_QUOTA_EVENT, reload);
      window.removeEventListener(MEMBERSHIP_CHANGED_EVENT, reload);
    };
  }, [reload]);
  return quota;
}
