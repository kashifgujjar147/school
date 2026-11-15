import { create } from 'zustand';
import type { PublicConfig, SessionUser, Permission } from '@sms/shared';

interface AuthState {
  user: SessionUser | null;
  /** true when signed in with the offline verifier — no server session exists. */
  offlineSession: boolean;
  /** server session expired while offline work is queued */
  needsReauth: boolean;
  config: PublicConfig | null;
  ready: boolean;
  setUser: (u: SessionUser | null, offline?: boolean) => void;
  setConfig: (c: PublicConfig) => void;
  setReady: () => void;
  onUnauthorized: () => void;
  can: (p: Permission) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  user: null,
  offlineSession: false,
  needsReauth: false,
  config: null,
  ready: false,
  setUser: (user, offline = false) => set({ user, offlineSession: offline, needsReauth: false }),
  setConfig: (config) => set({ config }),
  setReady: () => set({ ready: true }),
  onUnauthorized: () => {
    // Keep an offline session alive (cached data, queued work); just flag that sign-in is needed to sync.
    if (get().offlineSession) { set({ needsReauth: true }); return; }
    set({ user: null });
  },
  can: (p) => Boolean(get().user?.permissions.includes(p))
}));
