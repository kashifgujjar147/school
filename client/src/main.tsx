import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { bootstrap } from './services/session';
import { installConnectivityListeners } from './store/connectivity';
import { flushOutbox } from './sync/outbox';
import { warmOfflineCache } from './offline/warmup';
import { NetworkError } from './services/api';
// Self-hosted typefaces (bundled: work offline and under the server's strict CSP; each file carries a
// unicode-range, so browsers only download the subsets a page actually uses).
import '@fontsource-variable/inter';
import '@fontsource/cormorant-garamond/500.css';
import '@fontsource/cormorant-garamond/600.css';
import '@fontsource/playfair-display/500.css';
import '@fontsource/noto-nastaliq-urdu/400.css';
import '@fontsource/noto-nastaliq-urdu/700.css';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer an unreachable server; cached data is served by the API layer.
      retry: (n, e) => !(e instanceof NetworkError) && n < 2,
      // React Query would otherwise PAUSE every request while the browser is offline, so pages would
      // never reach the API layer that serves saved data offline.
      networkMode: 'always'
    },
    // Same for saving: the API layer queues changes made offline (services/api.ts → sync/outbox.ts).
    mutations: { networkMode: 'always' }
  }
});

installConnectivityListeners(() => {
  void flushOutbox().then(() => warmOfflineCache());
  void queryClient.invalidateQueries();
});
// Offline changes were delivered: refresh every page that may still show saved data.
window.addEventListener('sms:outbox-synced', () => { void queryClient.invalidateQueries(); });
// Periodic outbox flush while the app is open.
setInterval(() => { void flushOutbox(); }, 30_000);

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}

void bootstrap().finally(() => {
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </QueryClientProvider>
    </React.StrictMode>
  );
});
