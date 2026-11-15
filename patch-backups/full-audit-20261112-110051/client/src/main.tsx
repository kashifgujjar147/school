import React from 'react';
import ReactDOM from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { bootstrap } from './services/session';
import { installConnectivityListeners } from './store/connectivity';
import { flushOutbox } from './sync/outbox';
import { NetworkError } from './services/api';
import './index.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 15_000,
      refetchOnWindowFocus: true,
      // Don't hammer an unreachable server; cached data is served by the API layer.
      retry: (n, e) => !(e instanceof NetworkError) && n < 2
    }
  }
});

installConnectivityListeners(() => {
  void flushOutbox();
  void queryClient.invalidateQueries();
});
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
