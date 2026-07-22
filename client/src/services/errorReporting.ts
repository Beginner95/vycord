import * as Sentry from '@sentry/react';

// Strips `token=...` from a URL's query string — WS/SFU connection URLs
// (see services/call.ts, services/groupCall.ts) carry the JWT as a query
// param, and it must never leave the client in a breadcrumb or event.
function stripToken(url: string): string {
  return url.replace(/([?&]token=)[^&]+/i, '$1REDACTED');
}

function detectPlatform(): 'electron-renderer' | 'web' {
  return typeof window !== 'undefined' && Boolean(window.electronAPI) ? 'electron-renderer' : 'web';
}

/**
 * Initializes error reporting for the renderer (used identically by the web
 * build and the Electron renderer — both run the same bundle). No-ops when
 * VITE_SENTRY_DSN isn't set or the build isn't a production build, so local
 * dev never sends anything anywhere.
 */
export function initErrorReporting(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!dsn || !import.meta.env.PROD) {
    return;
  }

  Sentry.init({
    dsn,
    environment: 'production',
    release: __APP_VERSION__,
    tracesSampleRate: 0,
    beforeBreadcrumb(breadcrumb) {
      const url = breadcrumb.data?.url;
      if (typeof url === 'string') {
        breadcrumb.data!.url = stripToken(url);
      }
      return breadcrumb;
    },
    beforeSend(event) {
      if (event.request?.url) {
        event.request.url = stripToken(event.request.url);
      }
      return event;
    },
  });

  Sentry.setTag('platform', detectPlatform());
}
