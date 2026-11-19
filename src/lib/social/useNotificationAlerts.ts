import { useCallback, useEffect, useRef, useState } from 'react';
import { latestUnreadClanInvite, NOTIFICATIONS_READ_EVENT, unreadCount } from './notificationService';

// notifications is not in the Realtime publication, so the header checks for
// new ones itself: on sign-in, every POLL_MS, when the app comes back to the
// foreground and on every screen change. Without this nothing ever told the
// user an invitation had arrived — only opening 알림 by hand showed it.
const POLL_MS = 30_000;
const SEEN_KEY = 'martialdex:clan-invite-announced';

export interface ClanInviteAlert {
  id: string;
  clanId: string | null;
  clanName: string;
}

function announcedId(userId: string): string | null {
  try {
    return window.localStorage.getItem(`${SEEN_KEY}:${userId}`);
  } catch {
    return null;
  }
}

function rememberAnnounced(userId: string, id: string) {
  try {
    window.localStorage.setItem(`${SEEN_KEY}:${userId}`, id);
  } catch {
    // localStorage unavailable — the invite may be announced again next launch.
  }
}

export function useNotificationAlerts(userId: string | null, pathname: string): { unread: number; invite: ClanInviteAlert | null; dismissInvite: () => void } {
  const [unread, setUnread] = useState(0);
  const [invite, setInvite] = useState<ClanInviteAlert | null>(null);
  const busy = useRef(false);

  const refresh = useCallback(async () => {
    if (!userId || busy.current) return;
    busy.current = true;
    try {
      const [count, latest] = await Promise.all([unreadCount(userId), latestUnreadClanInvite(userId)]);
      setUnread(count);
      // each invitation is announced once; the badge keeps showing it until 알림 is opened
      if (latest && latest.id !== announcedId(userId)) {
        rememberAnnounced(userId, latest.id);
        setInvite({ id: latest.id, clanId: latest.clanId, clanName: latest.clanName });
      }
    } finally {
      busy.current = false;
    }
  }, [userId]);

  useEffect(() => {
    if (!userId) {
      setUnread(0);
      setInvite(null);
      return;
    }
    void refresh();
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh();
    }, POLL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh();
    };
    const onRead = () => {
      setUnread(0);
      setInvite(null);
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    window.addEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
      window.removeEventListener(NOTIFICATIONS_READ_EVENT, onRead);
    };
  }, [userId, refresh]);

  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);

  return { unread, invite, dismissInvite: () => setInvite(null) };
}
