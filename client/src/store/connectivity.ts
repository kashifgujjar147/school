import { create } from 'zustand';

interface ConnState {
  browserOnline: boolean;
  serverReachable: boolean;
  setBrowserOnline: (v: boolean) => void;
  setServerReachable: (v: boolean) => void;
}

/**
 * Two separate signals. navigator.onLine is unreliable (true on a Wi-Fi with no route), so we
 * also track whether the last real request reached our server. On a LAN install the browser
 * can be "offline" from the internet yet reach the school server — that counts as connected.
 */
export const useConnectivity = create<ConnState>((set) => ({
  browserOnline: typeof navigator === 'undefined' ? true : navigator.onLine,
  serverReachable: true,
  setBrowserOnline: (browserOnline) => set({ browserOnline }),
  setServerReachable: (serverReachable) => set((s) => (s.serverReachable === serverReachable ? s : { serverReachable }))
}));

export const isConnected = () => {
  const s = useConnectivity.getState();
  return s.serverReachable && s.browserOnline;
};

export function installConnectivityListeners(onReconnect: () => void) {
  const up = () => { useConnectivity.getState().setBrowserOnline(true); onReconnect(); };
  const down = () => useConnectivity.getState().setBrowserOnline(false);
  window.addEventListener('online', up);
  window.addEventListener('offline', down);
  // Periodic lightweight probe so we notice when a LAN server comes back.
  const timer = window.setInterval(async () => {
    try {
      const r = await fetch('/api/health', { cache: 'no-store' });
      const was = useConnectivity.getState().serverReachable;
      useConnectivity.getState().setServerReachable(r.ok || r.status === 503);
      if (!was && (r.ok || r.status === 503)) onReconnect();
    } catch { useConnectivity.getState().setServerReachable(false); }
  }, 20_000);
  return () => { window.removeEventListener('online', up); window.removeEventListener('offline', down); clearInterval(timer); };
}
