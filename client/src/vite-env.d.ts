/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SENTRY_DSN?: string;
  // Домен веб-приложения для гостевых ссылок: в Electron location.origin —
  // это file://, поэтому ссылку строим по переменной сборки.
  readonly VITE_PUBLIC_WEB_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
