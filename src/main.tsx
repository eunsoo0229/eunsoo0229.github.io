import React from 'react';
import ReactDOM from 'react-dom/client';
import { HashRouter } from 'react-router-dom';
import App from './App';
import './styles/global.css';
// Forge design layer (colour / surface / type / component finish) — after the base sheet.
import './styles/forge.css';
import './styles/ecosystem.css';
import './styles/eco-gear.css';
import './styles/eco-gyms.css';
import './styles/eco-gymadmin.css';
import './styles/eco-training.css';
// 2026-11 brand identity — loaded last so it re-skins every screen
import './styles/brand/tokens.css';
import './styles/brand/base.css';
import './styles/brand/components.css';
import './styles/brand/shell.css';
import './styles/brand/editorial.css';
import './styles/brand/monetization.css';
// user / admin categories hang under the technique taxonomy everywhere it is shown
import './lib/categoryRegistry/taxonomy';

// Ground Battle (그라운드 배틀) was removed — drop its leftover local state so
// it no longer rides along in cloud backups / "local data to back up" checks.
// Past training-history entries it wrote are user records and are kept.
try {
  window.localStorage.removeItem('martialdex:ground-battle-matches');
  window.localStorage.removeItem('martialdex:ground-battle-run');
} catch {
  // localStorage unavailable — nothing to clean up.
}

// 무술 추가 (custom_martial_arts) was removed — this key was only a local copy
// of that shared registry (backed up server-side by migration 0048), never
// user data. Personal records mentioning 우슈·택견 are left untouched.
try {
  window.localStorage.removeItem('martialdex:custom-martial-arts-cache');
} catch {
  // localStorage unavailable — nothing to clean up.
}


ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>
);

requestAnimationFrame(() => {
  requestAnimationFrame(() => {
  });
});
