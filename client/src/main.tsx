import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/primitives.css';
import App from './App';
import './stores/themeStore';
import './stores/localeStore';
import { initErrorReporting } from './services/errorReporting';
import { apiService } from './services/api';
import { forceMobileViewport } from './mobile/forceMobileViewport';

// Телефон в режиме «Версия для ПК» получает десктопный viewport (~980px) —
// чиним до монтирования React, чтобы граница `width < 900px` сработала.
forceMobileViewport();

initErrorReporting();
// На странице гостя аккаунта нет: обновлять токены и ходить в /auth/me незачем,
// а лишний 401 в консоли только путает.
if (!window.location.pathname.startsWith('/guest')) {
  apiService.initAuthLifecycle();
}

// Ссылки на файлы из public/ ставятся в рантайме: при base: './' Vite
// переписал бы их href в относительные, и на маршруте с вложенным путём
// (например /app/) манифест и иконки перестали бы находиться. В Electron
// (file://) манифест не нужен вовсе.
if (!window.electronAPI) {
  const link = (rel: string, href: string, type?: string) => {
    const el = document.createElement('link');
    el.rel = rel;
    el.href = href;
    if (type) el.type = type;
    document.head.appendChild(el);
  };
  link('manifest', '/manifest.webmanifest');
  link('apple-touch-icon', '/icons/apple-touch-icon.png');
  link('icon', '/favicon.png', 'image/png');
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
