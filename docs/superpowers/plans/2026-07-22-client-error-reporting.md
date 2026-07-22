# Client Error Reporting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make production client bugs (web + Electron) reproducible by capturing crashes and instrumented errors into a self-hosted GlitchTip instance, with a polished ErrorBoundary fallback screen replacing the current silent `console.error`-only behavior.

**Architecture:** GlitchTip (Sentry-protocol-compatible, MIT, self-hosted) runs as three new Docker services in `docker-compose.prod.yml`, reusing the existing `postgres`/`redis` containers, behind a new `errors.vycord.webvaha.ru` nginx vhost. The React renderer (both the web build and the Electron renderer — they share one bundle) initializes `@sentry/react`; the Electron main process initializes `@sentry/electron/main` separately. A `logger.error()` wrapper replaces ~25 scattered `console.error` call sites so existing catch blocks actually report. A custom `Sentry.ErrorBoundary` fallback screen (styled with the app's existing CSS variables) replaces whatever currently happens on an uncaught render error (nothing — a blank screen), with an optional user-feedback field.

**Tech Stack:** `@sentry/react` (renderer, web + Electron), `@sentry/electron` (Electron main process only), GlitchTip (`glitchtip/glitchtip` Docker image) as the self-hosted ingestion/dashboard backend. No new client test framework is introduced — this codebase has no unit test runner for the client (only a Playwright-style `client/e2e` harness driving a real SFU); verification here follows the existing project convention of `tsc`/build checks plus a manual QA pass (see `docs/superpowers/plans/2026-07-21-user-avatar-upload.md` for precedent).

## Global Constraints

- Error reporting must be a no-op in local dev: only active when `VITE_SENTRY_DSN` is set **and** the build is `import.meta.env.PROD` (spec §2).
- JWT tokens embedded in WS/SFU connection URLs (`?token=...`) must never reach GlitchTip — strip them in `beforeSend`/`beforeBreadcrumb` (spec §2).
- No performance/tracing telemetry — `tracesSampleRate: 0` (spec §2, §"Вне рамок").
- The ErrorBoundary fallback must use the app's existing CSS variables (`--bg-*`, `--brand-*`, `--text-*`, `--border-*`, `--shadow-*`, `--radius-*`) and support both light/dark themes — no new design system (spec §3).
- Do not add new visual popups for non-crashing errors — existing UX for handled errors (toasts, inline `setSendError`, etc.) stays as-is; only the reporting side is added (spec §2).
- User feedback on the crash screen must NOT rely on `Sentry.captureUserFeedback` (GlitchTip compatibility with that specific endpoint is unverified) — send it as a plain `Sentry.captureMessage` tagged with the crashing event's ID instead (spec §3).
- GlitchTip reuses the existing `postgres` and `redis` containers — no second database/cache stack (spec §1).
- DSN values are not secrets — safe to commit in `client/.env.production` and `client/electron/sentry-config.ts` (spec §4).

---

## Task 1: GlitchTip infrastructure (docker-compose, nginx, env docs)

**Files:**
- Modify: `docker-compose.prod.yml`
- Create: `deploy/nginx/errors.vycord.webvaha.ru.conf`
- Modify: `.env.prod.example`
- Modify: `README.md`

**Interfaces:**
- Produces: a GlitchTip instance reachable at `https://errors.vycord.webvaha.ru` once deployed, with a Postgres database `glitchtip` and Redis db-index `1` on the existing containers. Later tasks assume a DSN obtained from this instance will be pasted into `client/.env.production` (`VITE_SENTRY_DSN`) and `client/electron/sentry-config.ts` (`SENTRY_DSN`).

- [ ] **Step 1: Add the three GlitchTip services to `docker-compose.prod.yml`**

Open `docker-compose.prod.yml`. Insert the following three new services immediately after the existing `coturn:` service block and before the `client:` service block:

```yaml
  glitchtip-migrate:
    # Pin to a specific tag before going to production (check
    # https://hub.docker.com/r/glitchtip/glitchtip/tags) — `latest` is used
    # here only because the exact current stable tag wasn't verifiable from
    # this environment; every other image in this file is pinned.
    image: glitchtip/glitchtip:latest
    container_name: vycord-glitchtip-migrate
    command: ["./manage.py", "migrate"]
    environment:
      DATABASE_URL: ${GLITCHTIP_DATABASE_URL}
      REDIS_URL: ${GLITCHTIP_REDIS_URL}
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${GLITCHTIP_DOMAIN}
      EMAIL_URL: ${EMAIL_URL}
    depends_on:
      postgres:
        condition: service_healthy
    restart: "no"

  glitchtip-web:
    image: glitchtip/glitchtip:latest
    container_name: vycord-glitchtip-web
    environment:
      DATABASE_URL: ${GLITCHTIP_DATABASE_URL}
      REDIS_URL: ${GLITCHTIP_REDIS_URL}
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${GLITCHTIP_DOMAIN}
      EMAIL_URL: ${EMAIL_URL}
      ENABLE_ORGANIZATION_CREATION: "true"
    ports:
      - "127.0.0.1:8000:8000"
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    restart: unless-stopped

  glitchtip-worker:
    image: glitchtip/glitchtip:latest
    container_name: vycord-glitchtip-worker
    # run-celery-with-beat.sh is GlitchTip's own bundled script for
    # single-node installs: it runs the celery worker with an embedded beat
    # scheduler (periodic tasks, incl. retention cleanup of old events) in
    # one process, so a fourth "beat" container isn't needed here.
    command: ["./bin/run-celery-with-beat.sh"]
    environment:
      DATABASE_URL: ${GLITCHTIP_DATABASE_URL}
      REDIS_URL: ${GLITCHTIP_REDIS_URL}
      SECRET_KEY: ${GLITCHTIP_SECRET_KEY}
      GLITCHTIP_DOMAIN: ${GLITCHTIP_DOMAIN}
      EMAIL_URL: ${EMAIL_URL}
    depends_on:
      glitchtip-migrate:
        condition: service_completed_successfully
      redis:
        condition: service_healthy
    restart: unless-stopped
```

Then find the `client:` service's `build.args` block:

```yaml
      args:
        VITE_API_URL: ${VITE_API_URL}
        VITE_WS_URL: ${VITE_WS_URL}
        VITE_SFU_URL: ${VITE_SFU_URL}
```

and add `VITE_SENTRY_DSN` to it:

```yaml
      args:
        VITE_API_URL: ${VITE_API_URL}
        VITE_WS_URL: ${VITE_WS_URL}
        VITE_SFU_URL: ${VITE_SFU_URL}
        VITE_SENTRY_DSN: ${VITE_SENTRY_DSN}
```

- [ ] **Step 2: Verify the compose file parses**

Run: `docker compose -f docker-compose.prod.yml config --quiet`
Expected: no output, exit code 0 (variable interpolation succeeds even without `.env.prod` present locally, since compose only warns — not errors — on unset variables by default; if it errors, create a throwaway `.env.prod` from `.env.prod.example` in the repo root first and re-run with `--env-file .env.prod`).

- [ ] **Step 3: Create the nginx vhost for GlitchTip**

Create `deploy/nginx/errors.vycord.webvaha.ru.conf`, modeled on the existing `deploy/nginx/api.vycord.webvaha.ru.conf`:

```nginx
server {
    listen 80;
    server_name errors.vycord.webvaha.ru;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name errors.vycord.webvaha.ru;

    ssl_certificate /etc/letsencrypt/live/errors.vycord.webvaha.ru/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/errors.vycord.webvaha.ru/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    client_max_body_size 20m;

    location / {
        proxy_pass http://127.0.0.1:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

- [ ] **Step 4: Add GlitchTip variables to `.env.prod.example`**

Open `.env.prod.example` and append at the end of the file:

```bash
# Error reporting (GlitchTip, self-hosted Sentry-protocol-compatible tracker).
# See README.md "Error reporting (GlitchTip)" for first-deploy steps.
GLITCHTIP_SECRET_KEY=CHANGE_ME_RANDOM_SECRET_openssl_rand_hex_32
GLITCHTIP_DOMAIN=https://errors.vycord.webvaha.ru
# Reuses the same Postgres instance as the app (separate `glitchtip` database)
# and the same Redis instance (separate db index) — no second stack.
GLITCHTIP_DATABASE_URL=postgres://${POSTGRES_USER}:${POSTGRES_PASSWORD}@postgres:5432/glitchtip
GLITCHTIP_REDIS_URL=redis://redis:6379/1
# consolemail:// disables outgoing email (org-invite/digest emails are not
# needed for MVP) — GlitchTip still works fully for event ingestion/viewing.
EMAIL_URL=consolemail://

# Client bundle: public DSN from the GlitchTip project created after first
# deploy (see README) — not a secret, safe to commit once known.
VITE_SENTRY_DSN=
```

- [ ] **Step 5: Document the manual first-deploy steps in `README.md`**

Open `README.md` and add a new section right after the existing `## TURN (prod)` section (same heading level, same style):

```markdown
## Error reporting (GlitchTip, prod)

Клиентские ошибки (веб + Electron) репортятся в self-hosted
[GlitchTip](https://glitchtip.com/) — Sentry-протокол-совместимый трекер,
поднимается в `docker-compose.prod.yml` (`glitchtip-migrate`,
`glitchtip-web`, `glitchtip-worker`), переиспользует существующие
Postgres/Redis.

### Первичная настройка (один раз)

1. DNS: A-запись `errors.vycord.webvaha.ru` → IP сервера.
2. Сертификат:
   ```bash
   sudo cp deploy/nginx/errors.vycord.webvaha.ru.conf /etc/nginx/sites-available/errors.vycord.webvaha.ru
   sudo ln -sf /etc/nginx/sites-available/errors.vycord.webvaha.ru /etc/nginx/sites-enabled/
   sudo nginx -t && sudo systemctl reload nginx
   sudo certbot --nginx -d errors.vycord.webvaha.ru --non-interactive --agree-tos -m admin@webvaha.ru
   sudo nginx -t && sudo systemctl reload nginx
   ```
3. Заполнить в `.env.prod`: `GLITCHTIP_SECRET_KEY` (`openssl rand -hex 32`),
   `GLITCHTIP_DATABASE_URL`, `GLITCHTIP_REDIS_URL`, `GLITCHTIP_DOMAIN`.
4. `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build`
5. Открыть `https://errors.vycord.webvaha.ru`, создать первого
   пользователя/организацию, затем проект `vycord-client` — скопировать
   выданный DSN.
6. Вписать DSN в `.env.prod` (`VITE_SENTRY_DSN=...`) и в
   `client/electron/sentry-config.ts` (`SENTRY_DSN`, см. Task 8), пересобрать:
   `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build client`
7. В настройках организации GlitchTip выключить `ENABLE_ORGANIZATION_CREATION`
   (убрать переменную/поставить `"false"` в `docker-compose.prod.yml`) —
   она нужна была только для создания первой организации.
```

- [ ] **Step 6: Commit**

```bash
git add docker-compose.prod.yml deploy/nginx/errors.vycord.webvaha.ru.conf .env.prod.example README.md
git commit -m "Add GlitchTip infrastructure for client error reporting"
```

---

## Task 2: Client dependencies + build-time version + env types

**Files:**
- Modify: `client/package.json`
- Modify: `client/vite.config.ts`
- Modify: `client/src/vite-env.d.ts`

**Interfaces:**
- Produces: `import.meta.env.VITE_SENTRY_DSN: string` (typed), global `__APP_VERSION__: string` constant available in all client TS/TSX files.
- Consumes: `client/package.json`'s `"version"` field (currently `"0.1.0"`).

- [ ] **Step 1: Install the Sentry SDKs**

Run: `cd client && npm install @sentry/react @sentry/electron`
Expected: `client/package.json`'s `dependencies` gains `@sentry/react` and `@sentry/electron`; `client/package-lock.json` updates.

- [ ] **Step 2: Expose the app version to the renderer bundle**

Open `client/vite.config.ts`. Add a `readFileSync`-based read of `package.json` and a `define` block:

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { readFileSync } from 'fs';

const pkg = JSON.parse(readFileSync(path.resolve(__dirname, './package.json'), 'utf-8'));

// https://vite.dev/config/
export default defineConfig({
  base: './',
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:8080',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:8080',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
});
```

- [ ] **Step 3: Declare the new env var and global constant in `vite-env.d.ts`**

Open `client/src/vite-env.d.ts` and replace its contents:

```ts
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL: string;
  readonly VITE_WS_URL: string;
  readonly VITE_SENTRY_DSN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare const __APP_VERSION__: string;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors (this only exercises config/type-declaration changes so far — the new deps aren't used by any source file yet).

- [ ] **Step 5: Commit**

```bash
cd client
git add package.json package-lock.json vite.config.ts src/vite-env.d.ts
git commit -m "Add Sentry SDK dependencies and build-time app version"
```

---

## Task 3: `errorReporting` service — Sentry.init for the renderer

**Files:**
- Create: `client/src/services/errorReporting.ts`
- Modify: `client/src/main.tsx`

**Interfaces:**
- Consumes: `__APP_VERSION__` (Task 2), `window.electronAPI` (existing, `client/src/types/electron.d.ts`).
- Produces: `initErrorReporting(): void` — called once at renderer startup. After this runs, `Sentry` (imported as `import * as Sentry from '@sentry/react'` anywhere else in the codebase, e.g. Task 4's `logger.ts` and Task 7's `ErrorBoundary.tsx`) is either fully initialized (prod + DSN set) or a safe no-op (dev, or DSN unset) — `Sentry.captureException`/`Sentry.ErrorBoundary` are always safe to call regardless.

- [ ] **Step 1: Write `errorReporting.ts`**

```ts
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
```

- [ ] **Step 2: Call it from `main.tsx` before rendering**

Open `client/src/main.tsx` and replace its contents:

```tsx
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './stores/themeStore';
import { initErrorReporting } from './services/errorReporting';

initErrorReporting();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
cd client
git add src/services/errorReporting.ts src/main.tsx
git commit -m "Initialize Sentry/GlitchTip error reporting in the renderer"
```

---

## Task 4: `logger` utility

**Files:**
- Create: `client/src/utils/logger.ts`

**Interfaces:**
- Consumes: `@sentry/react`'s `Sentry.captureException` (works as a safe no-op before `initErrorReporting()` runs or when reporting is disabled — Sentry SDK functions are always safe to call unconditionally).
- Produces: `logger.error(message: string, err: unknown, tags?: Record<string, string>): void` — used by Task 5 and Task 6 to replace existing `console.error` call sites.

- [ ] **Step 1: Write `logger.ts`**

```ts
import * as Sentry from '@sentry/react';

function toError(err: unknown): Error {
  return err instanceof Error ? err : new Error(String(err));
}

export const logger = {
  /**
   * Logs to the console (unchanged local-dev behavior) and reports the
   * error to Sentry/GlitchTip (no-op if error reporting wasn't initialized —
   * see services/errorReporting.ts). `tags` should include at least a
   * `module` entry (e.g. `{ module: 'ws' }`) to make events filterable in
   * the GlitchTip dashboard.
   */
  error(message: string, err: unknown, tags: Record<string, string> = {}): void {
    console.error(message, err);
    Sentry.captureException(toError(err), {
      tags,
      extra: { message },
    });
  },
};
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd client
git add src/utils/logger.ts
git commit -m "Add logger.error wrapper around Sentry.captureException"
```

---

## Task 5: Wire `logger.error` into services (websocket, call, groupCall, noiseCancellation)

**Files:**
- Modify: `client/src/services/websocket.ts:104-123`
- Modify: `client/src/services/call.ts:267-288`
- Modify: `client/src/services/groupCall.ts:1202-1263`
- Modify: `client/src/services/noiseCancellation.ts:310-315`

**Interfaces:**
- Consumes: `logger.error(message, err, tags?)` from Task 4 (`@/utils/logger`).

- [ ] **Step 1: `websocket.ts` — replace its 3 `console.error` call sites**

Add the import at the top of `client/src/services/websocket.ts`:

```ts
import type { WSMessage } from '@/types';
import { logger } from '@/utils/logger';
```

Replace:

```ts
    } catch (error) {
      console.error('Failed to parse WebSocket message:', error);
    }
```

with:

```ts
    } catch (error) {
      logger.error('Failed to parse WebSocket message:', error, { module: 'ws' });
    }
```

Replace:

```ts
      if (this.token) {
        this.connect(this.token).catch(console.error);
      }
```

with:

```ts
      if (this.token) {
        this.connect(this.token).catch((err) => logger.error('WebSocket reconnect failed:', err, { module: 'ws' }));
      }
```

Replace:

```ts
  private handleError = (error: Event): void => {
    console.error('WebSocket error:', error);
  };
```

with:

```ts
  private handleError = (error: Event): void => {
    logger.error('WebSocket error:', error, { module: 'ws' });
  };
```

- [ ] **Step 2: `call.ts` — replace its 3 `.catch(console.error)` call sites**

Add the import at the top of `client/src/services/call.ts`:

```ts
import { wsService } from './websocket';
import { noiseCancellationService } from './noiseCancellation';
import { getIceServers } from './iceConfig';
import { logger } from '@/utils/logger';
```

Replace:

```ts
      this.sendAnswer(data.sdp).catch(console.error);
```

with:

```ts
      this.sendAnswer(data.sdp).catch((err) => logger.error('Failed to send WebRTC answer:', err, { module: 'call' }));
```

Replace:

```ts
      this.peerConnection.setRemoteDescription(data.sdp).catch(console.error);
```

with:

```ts
      this.peerConnection.setRemoteDescription(data.sdp).catch((err) => logger.error('setRemoteDescription failed:', err, { module: 'call' }));
```

Replace:

```ts
      this.peerConnection.addIceCandidate(data.candidate).catch(console.error);
```

with:

```ts
      this.peerConnection.addIceCandidate(data.candidate).catch((err) => logger.error('addIceCandidate failed:', err, { module: 'call' }));
```

- [ ] **Step 3: `groupCall.ts` — replace its 2 `console.error` call sites**

Add the import at the top of `client/src/services/groupCall.ts`:

```ts
import { noiseCancellationService } from './noiseCancellation';
import { getIceServers, STUN_SERVERS } from './iceConfig';
import { logger } from '@/utils/logger';
```

Replace:

```ts
    } catch (err) {
      gcLog(this.currentUserId, 'setRemoteDescription ERROR', { error: String(err) });
      console.error('[GroupCall] setRemoteDescription failed:', err);
      // PC stays in stable — server will timeout and rollback on its side.
```

with:

```ts
    } catch (err) {
      gcLog(this.currentUserId, 'setRemoteDescription ERROR', { error: String(err) });
      logger.error('[GroupCall] setRemoteDescription failed:', err, { module: 'groupCall' });
      // PC stays in stable — server will timeout and rollback on its side.
```

Replace:

```ts
    } catch (err) {
      gcLog(this.currentUserId, 'createAnswer ERROR', { error: String(err) });
      console.error('[GroupCall] createAnswer/setLocalDescription failed:', err);
      // PC is in have-remote-offer — rollback so future offers can be processed.
```

with:

```ts
    } catch (err) {
      gcLog(this.currentUserId, 'createAnswer ERROR', { error: String(err) });
      logger.error('[GroupCall] createAnswer/setLocalDescription failed:', err, { module: 'groupCall' });
      // PC is in have-remote-offer — rollback so future offers can be processed.
```

- [ ] **Step 4: `noiseCancellation.ts` — replace its 2 `console.error` call sites**

`client/src/services/noiseCancellation.ts` has a single import line (its only import) at the top, right after the file's doc comment:

```ts
import { NC_MODELS, DEFAULT_NC_MODEL, type NcModelId } from './ncModels';
```

Replace it with:

```ts
import { NC_MODELS, DEFAULT_NC_MODEL, type NcModelId } from './ncModels';
import { logger } from '@/utils/logger';
```

Replace:

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : 'noise suppression init failed';
      console.error('[NC] pipeline init failed:', message, err);
      console.error('[NC] ASSETS_BASE resolved to:', new URL(ASSETS_BASE, document.baseURI).href);
      this.wireBypass(chain);
```

with:

```ts
    } catch (err) {
      const message = err instanceof Error ? err.message : 'noise suppression init failed';
      logger.error('[NC] pipeline init failed:', err, {
        module: 'nc',
        assetsBase: new URL(ASSETS_BASE, document.baseURI).href,
      });
      this.wireBypass(chain);
```

(`message` is still used below this point in the original function for other purposes — do not remove its declaration; only the two `console.error` lines are replaced.)

- [ ] **Step 5: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd client
git add src/services/websocket.ts src/services/call.ts src/services/groupCall.ts src/services/noiseCancellation.ts
git commit -m "Route service-layer console.error calls through logger.error"
```

---

## Task 6: Wire `logger.error` into components/pages (UserList, AudioSettings, GroupCallUI, ChatArea, AppPage)

**Files:**
- Modify: `client/src/components/UserList.tsx:44-48`
- Modify: `client/src/components/settings/AudioSettings.tsx:38-42`
- Modify: `client/src/components/GroupCallUI.tsx:421-425,687-691,736-740`
- Modify: `client/src/components/ChatArea.tsx:290-294,304-308,318-322,499-503,523-527`
- Modify: `client/src/pages/AppPage.tsx:90-94,192-196,240-244,251-255,276-280,313-317,328-332`

**Interfaces:**
- Consumes: `logger.error(message, err, tags?)` from Task 4 (`@/utils/logger`).

- [ ] **Step 1: `UserList.tsx`**

Add the import:

```ts
import { useState, useEffect } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { logger } from '@/utils/logger';
import type { User } from '@/types';
import './UserList.css';
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to load online users:', err);
    }
```

with:

```ts
    } catch (err) {
      logger.error('Failed to load online users:', err, { module: 'userList' });
    }
```

- [ ] **Step 2: `AudioSettings.tsx`**

Add the import:

```ts
import { useState, useEffect } from 'react';
import { noiseCancellationService, NoiseCancellationService } from '@/services/noiseCancellation';
import { audioService } from '@/services/audio';
import { logger } from '@/utils/logger';
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to toggle noise cancellation:', err);
    }
```

with:

```ts
    } catch (err) {
      logger.error('Failed to toggle noise cancellation:', err, { module: 'settings' });
    }
```

- [ ] **Step 3: `GroupCallUI.tsx` — replace its 3 `console.error` call sites**

Add the import:

```ts
import { useState, useEffect, useRef, useCallback, type FormEvent } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { groupCallService, SCREEN_QUALITY_PRESETS } from '@/services/groupCall';
import type { ScreenQuality, ScreenQualityPreset } from '@/services/groupCall';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import type { User, Message } from '@/types';
import type { DesktopCapturerSource } from '@/types/electron';
import { VolumeControlPopover } from './VolumeControlPopover';
import './GroupCallUI.css';
```

Replace:

```ts
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        console.error('[GroupCall] Error:', msg);
        setIsInGroupCall(false);
```

with:

```ts
        const channelId = groupCallService.currentRoomIdState;
        if (channelId) wsService.send('voice_left', { channel_id: channelId });
        setIsReconnecting(false);
        logger.error('[GroupCall] Error:', msg, { module: 'groupCallUI' });
        setIsInGroupCall(false);
```

Replace:

```ts
      setIsScreenSharing(true);
      wsService.send('screen_share_started', {});
    } catch (err) {
      console.error('[GroupCall] Screen share failed:', err);
      alert('Failed to start screen sharing. Please try again.');
```

with:

```ts
      setIsScreenSharing(true);
      wsService.send('screen_share_started', {});
    } catch (err) {
      logger.error('[GroupCall] Screen share failed:', err, { module: 'groupCallUI' });
      alert('Failed to start screen sharing. Please try again.');
```

Replace:

```ts
      addMessage(msg);
      setChatInput('');
    } catch (err) {
      console.error('Failed to send message:', err);
    }
```

with:

```ts
      addMessage(msg);
      setChatInput('');
    } catch (err) {
      logger.error('Failed to send message in group call:', err, { module: 'groupCallUI' });
    }
```

- [ ] **Step 4: `ChatArea.tsx` — replace its 5 `console.error` call sites**

Add the import:

```ts
import { useState, useEffect, useRef, type FormEvent, type KeyboardEvent, type ChangeEvent } from 'react';
import { useMessageStore } from '@/stores/messageStore';
import type { Message } from '@/types';
import { apiService } from '@/services/api';
import { wsService } from '@/services/websocket';
import { audioService } from '@/services/audio';
import { useServerStore } from '@/stores/serverStore';
import { tokenizeMentions, roleLabel } from '@/utils/mentions';
import { logger } from '@/utils/logger';
import { useMentionAutocomplete } from '@/hooks/useMentionAutocomplete';
import { useFloatingSelectionToolbar } from '@/hooks/useFloatingSelectionToolbar';
import { MessageSearch } from '@/components/MessageSearch';
import { Avatar } from '@/components/Avatar';
import type { Channel, User, MemberWithUser } from '@/types';
import './ChatArea.css';
```

Replace each of the following (five separate spots — match by surrounding context, since `console.error('Failed to send message:', err);` appears twice with different neighboring lines):

```ts
    } catch (err) {
      console.error('Failed to jump to message:', err);
      setSendError(err instanceof Error ? err.message : 'Не удалось перейти к сообщению');
```
→
```ts
    } catch (err) {
      logger.error('Failed to jump to message:', err, { module: 'chat' });
      setSendError(err instanceof Error ? err.message : 'Не удалось перейти к сообщению');
```

```ts
    } catch (err) {
      console.error('Failed to load latest messages:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to load latest messages:', err, { module: 'chat' });
    }
```

```ts
    } catch (err) {
      console.error('Failed to send message:', err);
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
```
→
```ts
    } catch (err) {
      logger.error('Failed to send message:', err, { module: 'chat' });
      setSendError(err instanceof Error ? err.message : 'Failed to send message');
```

```ts
    } catch (err) {
      console.error('Failed to update message:', err);
      setSendError(err instanceof Error ? err.message : 'Failed to update message');
```
→
```ts
    } catch (err) {
      logger.error('Failed to update message:', err, { module: 'chat' });
      setSendError(err instanceof Error ? err.message : 'Failed to update message');
```

```ts
    } catch (err) {
      console.error('Failed to delete message:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to delete message:', err, { module: 'chat' });
    }
```

- [ ] **Step 5: `AppPage.tsx` — replace its 7 `console.error` call sites**

Add the import:

```ts
import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useServerStore } from '@/stores/serverStore';
import { useMessageStore } from '@/stores/messageStore';
import { wsService } from '@/services/websocket';
import { apiService } from '@/services/api';
import { logger } from '@/utils/logger';
import { ServerList } from '@/components/ServerList';
import { ChannelSidebar } from '@/components/ChannelSidebar';
import { ChatArea } from '@/components/ChatArea';
import { UserList } from '@/components/UserList';
import { TitleBar } from '@/components/TitleBar';
import { CallUI } from '@/components/CallUI';
import { GroupCallUI } from '@/components/GroupCallUI';
import { groupCallService } from '@/services/groupCall';
import type { Server, Channel, Message, MemberWithUser } from '@/types';
import './AppPage.css';
```

Replace:

```ts
      wsService.connect(token).catch((err) => {
        console.error('Failed to reconnect WebSocket:', err);
      });
```
→
```ts
      wsService.connect(token).catch((err) => {
        logger.error('Failed to reconnect WebSocket:', err, { module: 'app' });
      });
```

Replace:

```ts
      .catch((err) => console.error('Failed to load server members:', err));
```
→
```ts
      .catch((err) => logger.error('Failed to load server members:', err, { module: 'app' }));
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to load servers:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to load servers:', err, { module: 'app' });
    }
```

Replace:

```ts
      if (!msg.includes('already') && !msg.includes('owner')) {
        console.error('Failed to join server:', err);
        return;
```
→
```ts
      if (!msg.includes('already') && !msg.includes('owner')) {
        logger.error('Failed to join server:', err, { module: 'app' });
        return;
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to load channels:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to load channels:', err, { module: 'app' });
    }
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to load messages:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to load messages:', err, { module: 'app' });
    }
```

Replace:

```ts
    } catch (err) {
      console.error('Failed to create server:', err);
    }
```
→
```ts
    } catch (err) {
      logger.error('Failed to create server:', err, { module: 'app' });
    }
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If `noUnusedLocals`/`noUnusedParameters` complains about anything, double check every replaced `catch` block still uses its bound `err`/`error` identifier (it does, in every replacement above).

- [ ] **Step 7: Commit**

```bash
cd client
git add src/components/UserList.tsx src/components/settings/AudioSettings.tsx src/components/GroupCallUI.tsx src/components/ChatArea.tsx src/pages/AppPage.tsx
git commit -m "Route component/page console.error calls through logger.error"
```

---

## Task 7: `ErrorBoundary` — crash fallback screen with optional feedback

**Files:**
- Create: `client/src/components/ErrorBoundary.tsx`
- Create: `client/src/components/ErrorBoundary.css`
- Modify: `client/src/App.tsx`

**Interfaces:**
- Consumes: `Sentry.ErrorBoundary` from `@sentry/react` (Task 2's dependency), `Sentry.captureMessage` for feedback submission.
- Produces: `<ErrorBoundary>{children}</ErrorBoundary>` — wraps `<AppRouter />` in `App.tsx`. No props beyond `children`.

- [ ] **Step 1: Write `ErrorBoundary.css`**

```css
.error-boundary-overlay {
  position: fixed;
  inset: 0;
  z-index: 9999;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-base);
  animation: error-boundary-fade-in 0.2s var(--ease-out);
}

.error-boundary-card {
  background: var(--bg-primary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  width: 92%;
  max-width: 440px;
  padding: 32px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  text-align: center;
  animation: error-boundary-scale-in 0.25s var(--ease-out);
}

.error-boundary-icon {
  width: 56px;
  height: 56px;
  border-radius: var(--radius-full);
  background: var(--red-50);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 28px;
  flex-shrink: 0;
}

.error-boundary-card h1 {
  font-size: 18px;
  font-weight: 700;
  color: var(--text-primary);
  margin: 0;
}

.error-boundary-card p {
  font-size: 14px;
  color: var(--text-secondary);
  margin: 0;
  line-height: 1.5;
}

.error-boundary-reload-btn {
  width: 100%;
  padding: 10px 16px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--brand-color);
  color: var(--text-inverse);
  font-size: 14px;
  font-weight: 600;
  cursor: pointer;
  transition: background var(--transition);
}

.error-boundary-reload-btn:hover {
  background: var(--brand-hover);
}

.error-boundary-event-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  color: var(--text-muted);
}

.error-boundary-copy-btn {
  border: 1px solid var(--border-color);
  background: transparent;
  color: var(--text-secondary);
  border-radius: var(--radius-sm);
  padding: 2px 8px;
  font-size: 12px;
  cursor: pointer;
}

.error-boundary-copy-btn:hover {
  background: var(--bg-hover);
}

.error-boundary-feedback {
  width: 100%;
  text-align: left;
  margin-top: 4px;
}

.error-boundary-feedback summary {
  font-size: 13px;
  color: var(--text-link);
  cursor: pointer;
  user-select: none;
}

.error-boundary-feedback textarea {
  width: 100%;
  margin-top: 10px;
  padding: 8px 10px;
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
  background: var(--bg-secondary);
  color: var(--text-primary);
  font-size: 13px;
  font-family: inherit;
  resize: vertical;
  min-height: 64px;
  box-sizing: border-box;
}

.error-boundary-feedback-submit {
  margin-top: 8px;
  padding: 6px 14px;
  border: none;
  border-radius: var(--radius-md);
  background: var(--bg-tertiary);
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
}

.error-boundary-feedback-submit:hover:not(:disabled) {
  background: var(--border-color);
}

.error-boundary-feedback-submit:disabled {
  cursor: default;
  color: var(--text-muted);
}

@keyframes error-boundary-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes error-boundary-scale-in {
  from { opacity: 0; transform: scale(0.96); }
  to { opacity: 1; transform: scale(1); }
}
```

- [ ] **Step 2: Write `ErrorBoundary.tsx`**

```tsx
import { useState } from 'react';
import * as Sentry from '@sentry/react';
import './ErrorBoundary.css';

interface CrashFallbackProps {
  eventId: string;
}

function CrashFallback({ eventId }: CrashFallbackProps) {
  const [comment, setComment] = useState('');
  const [submitted, setSubmitted] = useState(false);

  const handleReload = () => {
    window.location.reload();
  };

  const handleCopyId = () => {
    navigator.clipboard.writeText(eventId).catch(() => {
      /* clipboard permission denied — non-critical, no fallback needed */
    });
  };

  const handleSubmitFeedback = () => {
    if (!comment.trim()) return;
    // Not using Sentry.captureUserFeedback: GlitchTip's support for that
    // specific endpoint isn't verified. A plain tagged message is
    // guaranteed to ingest through the same protocol as regular events.
    Sentry.captureMessage('User feedback', {
      level: 'info',
      tags: { associated_event_id: eventId },
      extra: { comments: comment },
    });
    setSubmitted(true);
  };

  return (
    <div className="error-boundary-overlay">
      <div className="error-boundary-card">
        <div className="error-boundary-icon">⚠️</div>
        <h1>Что-то пошло не так</h1>
        <p>Мы уже знаем об этой ошибке. Попробуйте перезагрузить приложение.</p>
        <button className="error-boundary-reload-btn" onClick={handleReload}>
          Перезагрузить
        </button>
        <div className="error-boundary-event-row">
          <span>ID: {eventId}</span>
          <button className="error-boundary-copy-btn" onClick={handleCopyId}>
            Скопировать
          </button>
        </div>
        <details className="error-boundary-feedback">
          <summary>Что вы делали, когда это произошло?</summary>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно, но очень помогает разобраться"
            disabled={submitted}
          />
          <button
            className="error-boundary-feedback-submit"
            onClick={handleSubmitFeedback}
            disabled={submitted || !comment.trim()}
          >
            {submitted ? 'Спасибо, отправлено ✓' : 'Отправить'}
          </button>
        </details>
      </div>
    </div>
  );
}

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

export function ErrorBoundary({ children }: ErrorBoundaryProps) {
  return (
    <Sentry.ErrorBoundary fallback={({ eventId }) => <CrashFallback eventId={eventId ?? 'unknown'} />}>
      {children}
    </Sentry.ErrorBoundary>
  );
}
```

- [ ] **Step 3: Wrap `AppRouter` with `ErrorBoundary` in `App.tsx`**

Open `client/src/App.tsx` and replace its contents:

```tsx
import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter';
import { ErrorBoundary } from './components/ErrorBoundary';

function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <AppRouter />
      </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `cd client && npx tsc --noEmit`
Expected: no errors. If `@sentry/react`'s installed `ErrorBoundary` fallback-render-prop type doesn't match `{ eventId }` (field name/optionality), check `node_modules/@sentry/react/**/errorboundary.d.ts` for the exact shape and adjust the destructuring in `CrashFallback`'s call site accordingly — the rest of the component doesn't need to change.

- [ ] **Step 5: Manually verify the fallback renders**

Temporarily add `throw new Error('test crash')` at the top of the `AppRouter` function body (in `client/src/AppRouter.tsx`), run `npm run dev:vite`, open the app in a browser, and confirm the custom "Что-то пошло не так" card appears instead of a blank page or the default React error overlay. Remove the temporary `throw` line afterward — do not commit it.

- [ ] **Step 6: Commit**

```bash
cd client
git add src/components/ErrorBoundary.tsx src/components/ErrorBoundary.css src/App.tsx
git commit -m "Add ErrorBoundary crash fallback screen with optional user feedback"
```

---

## Task 8: Electron main-process error reporting

**Files:**
- Create: `client/electron/sentry-config.ts`
- Modify: `client/electron/main.ts:1-11`

**Interfaces:**
- Produces: `SENTRY_DSN: string` constant, imported only by `main.ts`.

- [ ] **Step 1: Create `sentry-config.ts`**

```ts
// Public GlitchTip DSN for the Electron main process — DSNs are not secrets
// (they're meant to be embedded in client bundles), so this is safe to
// commit. Must be the same project/value as VITE_SENTRY_DSN in
// client/.env.production (see README.md "Error reporting (GlitchTip)").
export const SENTRY_DSN = 'REPLACE_WITH_GLITCHTIP_DSN';
```

- [ ] **Step 2: Initialize Sentry at the top of `main.ts`**

Open `client/electron/main.ts`. The current top of the file reads:

```ts
import { app, BrowserWindow, ipcMain, Tray, Menu, session, desktopCapturer, systemPreferences } from 'electron';
import * as path from 'path';

// __dirname is available via CommonJS module output
const electronDistDir = __dirname;
const projectRoot = path.resolve(electronDistDir, '..');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development';
```

Replace it with:

```ts
import { app, BrowserWindow, ipcMain, Tray, Menu, session, desktopCapturer, systemPreferences } from 'electron';
import * as path from 'path';
import * as Sentry from '@sentry/electron/main';
import { SENTRY_DSN } from './sentry-config';

// __dirname is available via CommonJS module output
const electronDistDir = __dirname;
const projectRoot = path.resolve(electronDistDir, '..');

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;

const isDev = process.env.NODE_ENV === 'development';

// As early as possible, same PROD-only gating as the renderer
// (services/errorReporting.ts) — no reporting from local dev runs.
if (!isDev) {
  Sentry.init({
    dsn: SENTRY_DSN,
    environment: 'production',
    release: app.getVersion(),
  });
}
```

- [ ] **Step 3: Verify the Electron main process compiles**

Run: `cd client && npm run dev:electron:build`
Expected: no TypeScript errors; `electron-dist/main.cjs` and `electron-dist/preload.cjs` are produced.

- [ ] **Step 4: Commit**

```bash
cd client
git add electron/sentry-config.ts electron/main.ts
git commit -m "Initialize Sentry/GlitchTip error reporting in the Electron main process"
```

---

## Task 9: Wire the real DSN + end-to-end manual QA

**Files:**
- Modify: `client/.env.production`
- Modify: `client/electron/sentry-config.ts` (placeholder replaced once a real DSN exists — see Task 1 step 5 / Task 8 step 1)

**Interfaces:** None — this task only substitutes a value produced by Task 1's manual deploy steps and performs manual verification per spec §6 (`docs/superpowers/specs/2026-07-22-client-error-reporting-design.md`).

- [ ] **Step 1: Add the DSN placeholder to `client/.env.production`**

Open `client/.env.production` and append:

```bash
VITE_SENTRY_DSN=
```

(Leave it empty in this commit — it's filled in on the production server via `.env.prod`/Docker build args per Task 1 step 5, not baked into the repo's committed `.env.production` until the real DSN is known. Local `npm run build:vite` with this empty value naturally disables reporting per Task 3's `if (!dsn || ...)` guard.)

- [ ] **Step 2: Verify local dev sends nothing**

Run: `cd client && npm run dev:vite`, open the app in a browser, open devtools Network tab, and confirm there are no requests to any `errors.vycord.webvaha.ru`/`ingest` URL while using the app normally. This confirms the `!import.meta.env.PROD` guard in `initErrorReporting()` (Task 3) works.

- [ ] **Step 3: Verify the production build compiles end-to-end**

Run: `cd client && npm run build`
Expected: exits 0 (runs `build:vite` — `tsc && vite build` — then `build:electron-main`).

- [ ] **Step 4: (On the production server, after Task 1's GlitchTip instance is live) Wire the real DSN**

1. Follow Task 1 step 5 / README "Error reporting (GlitchTip)" to create the GlitchTip project and obtain a DSN.
2. Set `VITE_SENTRY_DSN=<real dsn>` in `.env.prod` on the server (used by `docker-compose.prod.yml`'s `client` build args from Task 1).
3. Replace `'REPLACE_WITH_GLITCHTIP_DSN'` in `client/electron/sentry-config.ts` (Task 8) with the same DSN value, commit that change separately (it's a real code change, not a server-only config value, since the Electron build isn't part of the Docker build pipeline).
4. Redeploy: `docker compose -f docker-compose.prod.yml --env-file .env.prod up -d --build client`.

- [ ] **Step 5: Verify an event reaches GlitchTip (production)**

On the deployed prod site, open devtools console and run:
```js
throw new Error('vycord error-reporting test');
```
Expected: the custom "Что-то пошло не так" fallback screen appears (confirms `ErrorBoundary` from Task 7 works in a real prod build). Then open the GlitchTip dashboard (`https://errors.vycord.webvaha.ru`) and confirm:
- The event appears in the `vycord-client` project.
- Its `release` tag matches the deployed `client/package.json` version.
- Its `platform` tag is `web` (or `electron-renderer` if tested from the packaged Electron app).
- No `token=` value appears anywhere in the event's request URL or breadcrumbs (spec §2 sanitizer check — join a voice channel first in the same session so a WS/SFU URL with a token is present in recent breadcrumbs, then trigger the test error).

- [ ] **Step 6: Verify the feedback flow**

On the same fallback screen (or by re-triggering the test error), expand "Что вы делали, когда это произошло?", type a comment, click "Отправить", confirm the button changes to "Спасибо, отправлено ✓", and confirm a second event (`User feedback`, level `info`) appears in GlitchTip tagged with the `associated_event_id` matching the crash event's ID from Step 5.

- [ ] **Step 7: Commit**

```bash
git add client/.env.production
git commit -m "Add VITE_SENTRY_DSN placeholder to production env"
```

(The `sentry-config.ts` DSN substitution from Step 4.3 above is committed separately, at actual deploy time, once the real value is known.)

---

## Self-Review

**Spec coverage:** GlitchTip infra + reused Postgres/Redis + new subdomain (Task 1) ✓; `@sentry/react`/`@sentry/electron` deps + release/version wiring (Task 2) ✓; renderer `Sentry.init` with PROD-only gating, platform tag, token sanitizer (Task 3) ✓; `logger.error` wrapper (Task 4) ✓; all ~25 identified `console.error` call sites replaced (Tasks 5–6) ✓; Electron main process separate `Sentry.init` (Task 8) ✓; custom `ErrorBoundary` fallback with event ID + optional feedback via tagged `captureMessage`, not `captureUserFeedback` (Task 7) ✓; DSN-is-not-a-secret handling in `.env.production`/`sentry-config.ts` (Tasks 1, 8, 9) ✓; verification steps for dev no-op, build, and prod event delivery incl. token-scrubbing check (Task 9) ✓; explicitly out of scope — tracing, source maps, email alerts, server-side reporting — untouched by any task ✓.

**Placeholder scan:** `'REPLACE_WITH_GLITCHTIP_DSN'` (Task 8) and `VITE_SENTRY_DSN=` empty value (Task 9) are intentional, spec-sanctioned deploy-time substitutions (mirrors the existing `CHANGE_ME_...` convention in `.env.prod.example`), each with an exact, concrete follow-up step (Task 9 Step 4) — not open-ended TODOs. No other placeholders found.

**Type consistency:** `logger.error(message: string, err: unknown, tags?: Record<string, string>)` (Task 4) is called with matching argument order and shape in every Task 5/6 call site. `initErrorReporting(): void` (Task 3) is called once, with no arguments, in Task 3 Step 2. `ErrorBoundary` (Task 7) takes only `children`, matching its single usage in `App.tsx`. `SENTRY_DSN` (Task 8) is a plain exported `string` constant, imported by name in `main.ts` — no signature mismatch possible.

---

## Post-implementation correction (found during final whole-branch review)

Task 1 as originally written above (three services: `glitchtip-migrate`,
`glitchtip-web`, `glitchtip-worker`, the latter running
`./bin/run-celery-with-beat.sh`) was based on an incorrect recollection of
GlitchTip's internals. During the final review the controller ran
`docker pull glitchtip/glitchtip:latest`, `docker inspect`, and
`docker run --entrypoint cat ... bin/start.sh` (plus neighboring scripts)
against the real image (`GLITCHTIP_VERSION=6.2.2`) and found:

- No Celery in the image at all (`pip show celery` → not found). Background
  jobs/periodic scheduling run through the bundled `django-vtasks` package
  (a Valkey/Postgres task backend — Valkey is Redis-protocol-compatible, so
  `REDIS_URL` is still correct and required).
- No `./bin/run-celery-with-beat.sh` script exists in the image.
- The image dispatches by a `SERVER_ROLE` env var (`web` / `worker` /
  `worker_with_beat` / `all_in_one`) via `bin/start.sh`. `all_in_one` is the
  image's own recommended single-node mode: it runs migrate +
  `maintain_partitions` + cache-table setup on every start (idempotent),
  embeds the background worker, and serves the web UI via `granian` on port
  8000 (confirmed the real default via `docker inspect`).

**As-built correction:** `glitchtip-migrate` + `glitchtip-web` +
`glitchtip-worker` were collapsed into a single service, `glitchtip`, with
`SERVER_ROLE: all_in_one`. `glitchtip-db-init` (added in Task 1's first fix
round, creates the `glitchtip` Postgres database before GlitchTip's own
migrate step runs) is unaffected and unchanged. Verified with a real
live-Docker test (`docker compose up -d postgres redis`, then
`glitchtip-db-init`, then `glitchtip`, then a real HTTP request against
`localhost:8000`) rather than just `docker compose config` — the whole
reason this bug wasn't caught earlier is that config validation only checks
YAML/interpolation syntax, not whether the referenced commands/scripts
actually exist inside the image.

`README.md`'s "Error reporting (GlitchTip, prod)" section and the spec
(`docs/superpowers/specs/2026-07-22-client-error-reporting-design.md`
§1) were updated to match.
