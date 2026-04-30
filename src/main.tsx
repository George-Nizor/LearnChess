import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

// chessground base CSS (positioning, sizing, animations) — always required.
// The brown board theme used to be imported here; it now ships as
// /board-themes/brown.css and is injected by ensureBoardThemeLink() so the
// Settings page can swap themes at runtime without bundling every variant.
// The cburnett piece-set CSS stays as a static import: it's the bundled
// default, and alternate sets layer over it via ensurePieceSetLink().
import 'chessground/assets/chessground.base.css';
import 'chessground/assets/chessground.cburnett.css';
import './styles/globals.css';

import { ensureBoardThemeLink } from '@/state/boardTheme';
import { ensurePieceSetLink } from '@/state/pieceSet';
import { App } from './App';

// Inject the persisted board theme + piece set BEFORE first render so the
// board doesn't flash with the default brown/cburnett look on cold load.
ensureBoardThemeLink();
ensurePieceSetLink();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000,
      retry: 1,
    },
  },
});

const rootEl = document.getElementById('root');
if (!rootEl) throw new Error('#root not found');

createRoot(rootEl).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
