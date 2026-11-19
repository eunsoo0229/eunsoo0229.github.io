import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthProvider';
import { getMyMembership, type MyMembership } from './service';

/** Fired after a purchase/subscription change so every screen re-reads the server's answer. */
export const MEMBERSHIP_CHANGED_EVENT = 'martialdex:membership-changed';
export function notifyMembershipChanged() {
  window.dispatchEvent(new CustomEvent(MEMBERSHIP_CHANGED_EVENT));
}

/**
 * The signed-in user's plan as the SERVER reports it (my_membership). Display only — every paid action is
 * re-checked server-side (has_entitlement / RLS), so hiding a button here is never the protection.
 */
export function useMembership(): { membership: MyMembership | null; loading: boolean; reload: () => void } {
  const { user, isConfigured } = useAuth();
  const [membership, setMembership] = useState<MyMembership | null>(null);
  const [loading, setLoading] = useState(false);
  const reload = useCallback(() => {
    if (!isConfigured || !user) {
      setMembership(null);
      return;
    }
    setLoading(true);
    void getMyMembership().then((r) => {
      setMembership(r.ok ? r.data : null);
      setLoading(false);
    });
  }, [isConfigured, user?.id]);
  useEffect(() => {
    reload();
    window.addEventListener(MEMBERSHIP_CHANGED_EVENT, reload);
    return () => window.removeEventListener(MEMBERSHIP_CHANGED_EVENT, reload);
  }, [reload]);
  return { membership, loading, reload };
}

export function hasFeature(m: MyMembership | null, feature: string): boolean {
  return !!m && (m.privileged || m.features.includes(feature));
}
