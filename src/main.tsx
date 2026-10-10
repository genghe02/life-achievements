import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles/index.css';
import { texture } from './art/pixel';
import { setupPwa } from './pwa';
import { useStore } from './store/store';
import { App } from './ui/App';
import { useUi } from './ui/uiStore';

document.documentElement.style.setProperty('--dirt', `url(${texture('dirt')})`);
void useStore.getState().init();

// Dev-only handles for poking the app from the console or Playwright; stripped from builds.
if (import.meta.env.DEV) Object.assign(window, { __store: useStore, __ui: useUi });

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

setupPwa();
