# Redesign M0 — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Lay the redesign's foundation — new token layer with aliases, real fonts, lucide icons, extracted primitives, avatar color system, Electron launch-background fix — with minimal visible change.

**Architecture:** Replace `src/index.css` with a three-file `src/styles/` layer (tokens → base → primitives) where new handoff-named tokens carry the values and a clearly-marked alias block keeps every old `--var` name working. Shared modal styles move out of `pages/AppPage.css` into `primitives.css`; `.title-bar` styles move out of `ChatArea.css` into a new `TitleBar.css`. All work happens on a new long-lived `redesign` branch.

**Tech Stack:** React 19, TypeScript, Vite 8, plain CSS with custom properties, `@fontsource/inter` + `@fontsource/jetbrains-mono`, `lucide-react`, vitest (node environment), Electron 41.

**Spec:** `docs/superpowers/specs/2026-08-25-frontend-redesign-design.md` (read it first; this plan implements its milestone M0). Design reference: `design_handoff_discord_redesign/README.md`.

## Global Constraints

- **No backend changes.** Nothing under `server/` is touched. No API/WS contract changes.
- All commands run from `client/` unless stated otherwise.
- All work lands on the `redesign` branch (created in Task 1), one commit per task.
- UI copy is Russian-first: any new user-facing string goes into `src/i18n/locales/ru.ts` (source of truth) **and** `src/i18n/locales/en.ts`; `npm run check:i18n` must stay green. (M0 adds no new strings.)
- Old token names (`--bg-primary`, `--brand-color`, …) must keep working after every task — they are aliased, not removed. Alias removal is milestone M6, not M0.
- Verification loop for every task: `npx tsc --noEmit` (type check), `npm test` (vitest), and where stated a visual smoke via `npm run dev:vite` (web build at http://localhost:3000 is enough; no Electron needed except Task 7).
- Icons: `lucide-react` components used directly, `strokeWidth={1.8}`, sizes 15–21px.
- Dark-theme values marked `/* refine in M6 */` are deliberate interpolations — the board (`2d`) is the reference for the M6 parity pass; do not bikeshed them now.

---

### Task 1: Branch + dead-file cleanup

**Files:**
- Delete: `client/src/style.css`, `client/src/main.ts`, `client/src/counter.ts`, `client/src/assets/hero.png`, `client/src/assets/typescript.svg`, `client/src/assets/vite.svg`, `client/public/icons.svg`
- (No file references these — verified by grep during research; `main.tsx` is the only entry, `index.html` loads `/src/main.tsx`.)

**Interfaces:**
- Consumes: nothing.
- Produces: the `redesign` branch all later tasks commit to.

- [ ] **Step 1: Create the branch** (repo root)

```bash
git -C /Users/nm/Projects/experiments/vycord checkout -b redesign main
```

- [ ] **Step 2: Delete the dead files**

```bash
cd /Users/nm/Projects/experiments/vycord/client
git rm src/style.css src/main.ts src/counter.ts src/assets/hero.png src/assets/typescript.svg src/assets/vite.svg public/icons.svg
```

- [ ] **Step 3: Verify nothing referenced them**

Run: `rg -n "style\.css|from '\./counter'|from '\./main'|icons\.svg|hero\.png|typescript\.svg|/vite\.svg" src index.html` — expect zero matches.
Run: `npx tsc --noEmit` — expect clean.
Run: `npm test` — expect pass.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: remove dead Vite-template files"
```

---

### Task 2: Token layer — `src/styles/tokens.css` + `base.css`, retire `index.css`

**Files:**
- Create: `client/src/styles/tokens.css`, `client/src/styles/base.css`
- Delete: `client/src/index.css`
- Modify: `client/src/main.tsx` (imports)

**Interfaces:**
- Consumes: nothing.
- Produces: every new token name (`--accent`, `--ink`, `--panel`, `--canvas`, `--rail`, `--line`, `--shadow-modal`, `--radius-modal`, `--focus-ring`, `--font-mono`, …) used by Tasks 4–6 and all later milestones; alias block keeping every old name from `index.css` working.

- [ ] **Step 1: Create `src/styles/tokens.css`** with exactly this content:

```css
/* ═══════════════════════════════════════════════════════
   VYCORD — Design tokens (handoff: design_handoff_discord_redesign/README.md)
   ═══════════════════════════════════════════════════════ */

:root {
  /* ── Accent ── */
  --accent:        #4F46E5;
  --accent-hover:  #4338CA;
  --accent-text:   #4F46E5;
  --accent-soft:   #EEF2FF;
  --accent-border: #DDE2FF;
  --own-msg-bg:    #F4F5FE;

  /* ── Text ── */
  --ink:     #101322;
  --muted:   #5A6178;
  --muted-2: #8A90A2;
  --faint:   #A8AEBF;

  /* ── Lines & surfaces ── */
  --line:         #E5E8F0;
  --line-strong:  #D8DCE7;
  --panel:        #EBEEF6;
  --panel-line:   #DCE1EE;
  --panel-footer: #E2E6F1;
  --canvas:       #FFFFFF;
  --canvas-2:     #F6F7FB;
  --canvas-3:     #FBFCFE;
  --composer:     #FFFFFF;
  --rail:         #171B29;
  --rail-item:    rgba(255, 255, 255, 0.07);
  --rail-line:    rgba(255, 255, 255, 0.14);

  /* ── Status ── */
  --online:      #12B76A;
  --online-soft: #ECFDF3;
  --online-text: #067647;
  --danger:      #E7444A;
  --danger-soft: #FEF0F0;
  --danger-text: #C1272D;

  /* ── Call stage ── */
  --stage:        #0E1017;
  --stage-tile:   #1A1E2B;
  --stage-tile-2: #20252F;

  /* ── Avatar palette (deterministic hash, see utils/avatarColor.ts) ── */
  --avatar-1: #4F46E5;
  --avatar-2: #E8590C;
  --avatar-3: #0F766E;
  --avatar-4: #B4145A;
  --avatar-5: #1D4ED8;
  --avatar-6: #7C3AED;
  --avatar-7: #0E7490;
  --avatar-8: #A16207;

  /* ── Shadows ── */
  --shadow-row:     0 1px 2px rgba(16, 19, 34, 0.06);
  --shadow-card:    0 2px 10px rgba(16, 19, 34, 0.07);
  --shadow-popover: 0 4px 14px rgba(16, 19, 34, 0.10);
  --shadow-menu:    0 14px 34px rgba(16, 19, 34, 0.14);
  --shadow-modal:   0 18px 46px rgba(16, 19, 34, 0.14);
  --shadow-palette: 0 22px 50px rgba(16, 19, 34, 0.16);

  /* ── Radii ── */
  --radius-chip:     6px;
  --radius-row:      9px;
  --radius-btn:      10px;
  --radius-card:     11px;
  --radius-tile:     13px;
  --radius-composer: 14px;
  --radius-modal:    16px;
  --radius-bar:      18px;
  --radius-pill:     999px;

  /* ── Focus ── */
  --focus-ring: 0 0 0 3px rgba(79, 70, 229, 0.13);

  /* ── Motion ── */
  --ease-out:   cubic-bezier(0.16, 1, 0.3, 1);
  --transition: 0.16s var(--ease-out);

  /* ── Fonts ── */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, Consolas, monospace;
}

/* ── Dark theme (board option 2d; values marked refine-in-M6 are interpolations) ── */
[data-theme="dark"] {
  --accent:        #6366F1;
  --accent-hover:  #818CF8;
  --accent-text:   #A5B4FC;
  --accent-soft:   rgba(99, 102, 241, 0.14);
  --accent-border: rgba(99, 102, 241, 0.35);
  --own-msg-bg:    rgba(99, 102, 241, 0.12); /* refine in M6 */

  --ink:     #E4E7F0;
  --muted:   #9AA2B4;
  --muted-2: #8A93A8; /* refine in M6 */
  --faint:   #6E778C;

  --line:         rgba(255, 255, 255, 0.07);
  --line-strong:  rgba(255, 255, 255, 0.12);
  --panel:        #131722;
  --panel-line:   rgba(255, 255, 255, 0.08);
  --panel-footer: #0F131D;
  --canvas:       #0E1017;
  --canvas-2:     #151926; /* refine in M6 */
  --canvas-3:     #131722; /* refine in M6 */
  --composer:     #171B26;
  --rail:         #0A0C12;

  --online:      #4ADE96;
  --online-soft: rgba(18, 183, 106, 0.14);
  --online-text: #5BE39B;
  --danger-soft: rgba(231, 68, 74, 0.14);  /* refine in M6 */
  --danger-text: #F87A7E;                  /* refine in M6 */

  --shadow-row:     0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-card:    0 2px 10px rgba(0, 0, 0, 0.35);
  --shadow-popover: 0 4px 14px rgba(0, 0, 0, 0.4);
  --shadow-menu:    0 14px 34px rgba(0, 0, 0, 0.5);
  --shadow-modal:   0 18px 46px rgba(0, 0, 0, 0.5);
  --shadow-palette: 0 22px 50px rgba(0, 0, 0, 0.55);

  --focus-ring: 0 0 0 3px rgba(99, 102, 241, 0.25);
}

/* ═══════════════════════════════════════════════════════
   LEGACY ALIASES — DELETE IN M6.
   Every pre-redesign token name maps onto the new system so
   not-yet-migrated CSS keeps rendering coherently.
   ═══════════════════════════════════════════════════════ */
:root, [data-theme="dark"] {
  --bg-base:      var(--canvas-2);
  --bg-primary:   var(--canvas);
  --bg-secondary: var(--panel);
  --bg-tertiary:  var(--line);
  --bg-elevated:  var(--canvas);
  --bg-hover:     var(--canvas-2);
  --bg-active:    var(--accent-soft);

  --brand-color:  var(--accent);
  --brand-hover:  var(--accent-hover);
  --brand-subtle: rgba(79, 70, 229, 0.10);
  --brand-50:     var(--accent-soft);
  --brand-100:    #E0E7FF;
  --brand-200:    var(--accent-border);
  --brand-300:    #A5B4FC;
  --brand-400:    #818CF8;
  --brand-500:    #6366F1;
  --brand-600:    var(--accent);
  --brand-700:    #4338CA;

  --green-50:    var(--online-soft);
  --green-500:   var(--online);
  --green-600:   var(--online-text);
  --green-color: var(--online);
  --red-50:      var(--danger-soft);
  --red-500:     var(--danger);
  --red-600:     var(--danger-text);
  --red-color:   var(--danger);
  --yellow-50:   #FFFBEB;
  --yellow-500:  #F59E0B;
  --yellow-color:#F59E0B;
  --blue-500:    #3B82F6;
  --blue-color:  #3B82F6;

  --text-primary:   var(--ink);
  --text-secondary: var(--muted);
  --text-muted:     var(--muted-2);
  --text-link:      var(--accent);
  --text-inverse:   #FFFFFF;

  --border-color:  var(--line-strong);
  --border-subtle: var(--line);

  --shadow-sm: var(--shadow-row);
  --shadow-md: var(--shadow-card);
  --shadow-lg: var(--shadow-menu);
  --shadow-xl: var(--shadow-modal);

  --radius-sm:   6px;
  --radius-md:   9px;
  --radius-lg:   12px;
  --radius-xl:   16px;
  --radius-full: 999px;
}

[data-theme="dark"] {
  --brand-100:    rgba(99, 102, 241, 0.20);
  --brand-subtle: rgba(99, 102, 241, 0.15);
  --yellow-50:    rgba(245, 158, 11, 0.1);
}
```

- [ ] **Step 2: Create `src/styles/base.css`** (successor of the non-token half of `index.css`):

```css
/* ── Reset ── */
*, *::before, *::after {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

html, body, #root {
  height: 100%;
  overflow: hidden;
}

body {
  font-family: var(--font-sans);
  background: var(--canvas-2);
  color: var(--ink);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  font-size: 14px;
  line-height: 1.5;
}

/* ── Scrollbar ── */
::-webkit-scrollbar {
  width: 6px;
}

::-webkit-scrollbar-track {
  background: transparent;
}

::-webkit-scrollbar-thumb {
  background: var(--line-strong);
  border-radius: var(--radius-chip);
}

::-webkit-scrollbar-thumb:hover {
  background: var(--muted-2);
}

/* ── Selection ── */
::selection {
  background: var(--accent-soft);
  color: var(--accent);
}

/* ── Focus Ring ── */
:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ── Element resets ── */
button {
  font-family: inherit;
  cursor: pointer;
}

input, select, textarea {
  font-family: inherit;
}

a {
  color: var(--accent);
  text-decoration: none;
}

a:hover {
  text-decoration: underline;
}

/* ── Reduced motion ── */
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

- [ ] **Step 3: Swap imports in `src/main.tsx`**

Replace the line `import './index.css';` with:

```tsx
import './styles/tokens.css';
import './styles/base.css';
```

Then delete the old file: `git rm src/index.css`

- [ ] **Step 4: Verify**

Run: `npx tsc --noEmit` and `npm test` — expect clean/pass.
Run: `rg -n "index.css" src index.html` — expect no matches.
Visual smoke: `npm run dev:vite`, open http://localhost:3000 — app renders; palette shifts slightly (indigo accent `#4F46E5`, cooler panels) but nothing is unstyled/broken. Toggle dark theme in Настройки → Внешний вид — dark renders without regressions.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redesign): new token layer with legacy aliases, split base styles"
```

---

### Task 3: Load real fonts (Inter + JetBrains Mono)

**Files:**
- Modify: `client/package.json` (deps), `client/src/main.tsx` (imports)

**Interfaces:**
- Consumes: `--font-sans`/`--font-mono` definitions from Task 2.
- Produces: actually-loaded Inter 400/500/600/700/800 (with Cyrillic subsets) and JetBrains Mono 500; later milestones rely on weights 700/800 existing.

- [ ] **Step 1: Install fontsource packages**

```bash
npm install @fontsource/inter @fontsource/jetbrains-mono
```

(Fontsource = self-hosted via node_modules + Vite bundling, satisfying the spec's "self-host through the Vite pipeline"; each weight css carries `unicode-range` subsets including Cyrillic.)

- [ ] **Step 2: Import weights in `src/main.tsx`** — add above the styles imports:

```tsx
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';
import '@fontsource/inter/800.css';
import '@fontsource/jetbrains-mono/500.css';
```

- [ ] **Step 3: Verify**

Run: `npm run dev:vite`, open the app; in devtools run `document.fonts.check('14px Inter')` → `true`, and confirm Russian text (е.g. sidebar labels) renders in Inter, not the system fallback (devtools → Elements → Computed → Rendered Fonts shows "Inter").
Run: `npx tsc --noEmit` && `npm test` — clean.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "feat(redesign): self-host Inter + JetBrains Mono via fontsource"
```

---

### Task 4: Primitives — extract modal shell from `AppPage.css`, add button/input roles

**Files:**
- Create: `client/src/styles/primitives.css`
- Modify: `client/pages/AppPage.css` → remove lines 94–326 (`/* ── Modal ── */` through `.modal-error`), `client/src/main.tsx` (import)

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces: `.btn`, `.btn-primary`, `.btn-secondary`, `.btn-ghost`, `.btn-danger-soft`, `.btn-danger`, `.input`, `.kbd` classes (used from M1 onward), and the restyled `.modal-overlay`/`.modal`/`.form-group`/`.modal-actions`/`.modal-error`/`.form-checkbox`/`.channel-type-options`/`.modal-hint` selectors (same class names — **zero JSX changes** in this task; every existing modal keeps working).

- [ ] **Step 1: Create `src/styles/primitives.css`**

Part A — new primitives (verbatim):

```css
/* ═══════════════════════════════════════════════════════
   VYCORD — Shared primitives (buttons, inputs, modal shell)
   Four button roles + one disabled state, per design handoff.
   ═══════════════════════════════════════════════════════ */

.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  height: 34px;
  padding: 0 14px;
  border-radius: var(--radius-btn);
  font-family: var(--font-sans);
  font-size: 13px;
  font-weight: 600;
  border: 1px solid transparent;
  cursor: pointer;
  transition: background var(--transition), border-color var(--transition), color var(--transition);
}

.btn:disabled {
  opacity: 0.5;
  pointer-events: none;
}

.btn-primary {
  background: var(--accent);
  color: #FFFFFF;
}

.btn-primary:hover {
  background: var(--accent-hover);
}

.btn-secondary {
  background: var(--canvas);
  color: var(--ink);
  border-color: var(--line-strong);
}

.btn-secondary:hover {
  background: var(--canvas-2);
}

.btn-ghost {
  background: transparent;
  color: var(--muted);
}

.btn-ghost:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.btn-danger-soft {
  background: var(--danger-soft);
  color: var(--danger-text);
}

.btn-danger-soft:hover {
  background: var(--danger);
  color: #FFFFFF;
}

.btn-danger {
  background: var(--danger);
  color: #FFFFFF;
}

.btn-danger:hover {
  filter: brightness(0.94);
}

.input {
  width: 100%;
  padding: 11px 14px;
  border: 1.5px solid var(--line-strong);
  border-radius: var(--radius-card);
  background: var(--canvas);
  color: var(--ink);
  font-size: 14px;
  outline: none;
  transition: border-color var(--transition), box-shadow var(--transition);
}

.input::placeholder {
  color: var(--faint);
}

.input:focus {
  border-color: var(--accent);
  box-shadow: var(--focus-ring);
}

.kbd {
  display: inline-block;
  padding: 2px 6px;
  border-radius: var(--radius-chip);
  background: var(--canvas-2);
  border: 1px solid var(--line);
  font-family: var(--font-mono);
  font-size: 11px;
  color: var(--muted);
}
```

Part B — the modal shell **moved** from `AppPage.css` lines 94–326. Copy that whole block (from `/* ── Modal ── */` down to and including the `.modal-error` rule) into `primitives.css` below Part A, then apply exactly these restyles to the moved copy:

1. `.modal-overlay`: `background: rgba(16, 19, 34, 0.5);` (was `rgba(15, 17, 23, 0.5)`), `animation: fadeIn 0.18s var(--ease-out);`
2. Replace the `scaleIn` keyframes and its uses with the design's rise:

```css
@keyframes modalIn {
  from { opacity: 0; transform: translateY(4px); }
  to   { opacity: 1; transform: translateY(0); }
}
```

   `.modal` gets `animation: modalIn 0.18s var(--ease-out);`. The two radio/checkbox rules that used `animation: scaleIn 0.15s var(--ease-out)` switch to `modalIn`.
3. `.modal`: `border-radius: var(--radius-modal); padding: 24px; box-shadow: var(--shadow-modal); border: 1px solid var(--line);`
4. `.modal h2`: `font-size: 19px; font-weight: 800; line-height: 1.25; letter-spacing: -0.01em;`
5. `.modal .form-group input`: replace the focus rule body with `border-color: var(--accent); box-shadow: var(--focus-ring); background: var(--canvas);` and the base border with `1.5px solid var(--line-strong)`; `background: var(--canvas-3);`
6. `.modal-actions button` (default/non-primary): keep selector, body becomes the secondary role: `background: var(--canvas); color: var(--ink); border: 1px solid var(--line-strong); border-radius: var(--radius-btn); font-size: 13px; font-weight: 600; padding: 0 14px; height: 34px;` — hover `background: var(--canvas-2);`
7. `.modal-actions button.primary`: `background: var(--accent); color: #FFFFFF; border: 1px solid var(--accent);` — hover `background: var(--accent-hover); border-color: var(--accent-hover); box-shadow: none;`
8. `.modal-error`: `color: var(--danger-text);`
9. Everywhere in the moved block replace legacy var names with new ones: `--bg-primary`→`--canvas`, `--bg-base`→`--canvas-2`, `--bg-hover`→`--canvas-2`, `--border-color`→`--line-strong`, `--border-subtle`→`--line`, `--text-primary`→`--ink`, `--text-secondary`→`--muted`, `--text-muted`→`--muted-2`, `--brand-color`→`--accent`, `--brand-hover`→`--accent-hover`, `--brand-400`→`--accent`, `--brand-subtle`→`var(--focus-ring)` only in box-shadows (otherwise `--accent-soft`), `--red-500`→`--danger`, `--radius-md`→`--radius-row`, `--radius-xl`→`--radius-modal`, `--shadow-xl`→`--shadow-modal`.

- [ ] **Step 2: Remove the moved block from `AppPage.css`**

Delete lines 94–326 of `client/src/pages/AppPage.css` (from `/* ── Modal ── */` up to but **not** including `/* ── Call notification banner ── */`). The call-notif banner, mobile block, and layout rules stay.

- [ ] **Step 3: Import in `src/main.tsx`** — after `./styles/base.css`:

```tsx
import './styles/primitives.css';
```

- [ ] **Step 4: Verify**

Run: `rg -c "modal-overlay|modal-actions|form-group" src/pages/AppPage.css` — expect 0.
Run: `npx tsc --noEmit` && `npm test` — clean.
Visual smoke: open the app → «Создать сервер» modal (rail +), create-channel modal, logout confirm — all render with r16 corners, 19px/800 titles, indigo primary buttons, working checkbox/radio. `Ctrl+Shift+F`? Not needed — modals are the surface under test.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat(redesign): shared primitives; move modal shell out of AppPage.css"
```

---

### Task 5: TitleBar — own CSS file + lucide icons

**Files:**
- Create: `client/src/components/TitleBar.css`
- Modify: `client/src/components/TitleBar.tsx`, `client/src/components/ChatArea.css` (remove `.title-bar` block, lines 356–387), `client/package.json` (lucide)

**Interfaces:**
- Consumes: tokens from Task 2.
- Produces: `lucide-react` dependency (used by every later milestone); `.title-bar` selector unchanged for `AppPage.css`'s mobile `display:none` override and `UpdateBanner.css`'s 40px-height assumption — **height stays 40px**.

- [ ] **Step 1: Install lucide**

```bash
npm install lucide-react
```

- [ ] **Step 2: Create `src/components/TitleBar.css`**

```css
/* Height is fixed at 40px — UpdateBanner.css positions itself at top: 40px
   against this, and AppPage.css hides .title-bar on mobile. Keep in sync. */
.title-bar {
  height: 40px;
  background: var(--canvas);
  border-bottom: 1px solid var(--line);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  -webkit-app-region: drag;
}

.title-bar button {
  -webkit-app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  background: none;
  border: none;
  color: var(--muted-2);
  width: 46px;
  height: 40px;
  cursor: pointer;
  transition: background var(--transition), color var(--transition);
}

.title-bar button:hover {
  background: var(--canvas-2);
  color: var(--ink);
}

.title-bar button.close:hover {
  background: var(--danger);
  color: #FFFFFF;
}
```

- [ ] **Step 3: Rewrite `src/components/TitleBar.tsx`**

```tsx
import { Minus, Square, X } from 'lucide-react';
import { useT } from '@/i18n';
import './TitleBar.css';

export function TitleBar() {
  const t = useT();
  const isElectron = typeof window !== 'undefined' && window.electronAPI;

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow();
  };

  const handleMaximize = () => {
    window.electronAPI?.maximizeWindow();
  };

  const handleClose = () => {
    window.electronAPI?.closeWindow();
  };

  return (
    <div className="title-bar">
      {isElectron && (
        <>
          <button onClick={handleMinimize} title={t('common.minimize')}>
            <Minus size={15} strokeWidth={1.8} />
          </button>
          <button onClick={handleMaximize} title={t('common.maximize')}>
            <Square size={13} strokeWidth={1.8} />
          </button>
          <button className="close" onClick={handleClose} title={t('common.close')}>
            <X size={15} strokeWidth={1.8} />
          </button>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Remove the `.title-bar` block from `ChatArea.css`**

Delete the block starting at the `/* ── Title Bar ── */` comment (line 356) through the `.title-bar button.close:hover` rule (line 387). The `/* ── Error Toast ── */` section that follows stays.

- [ ] **Step 5: Verify**

Run: `rg -n "title-bar" src/components/ChatArea.css` — expect 0 matches.
Run: `npx tsc --noEmit` && `npm test` — clean.
Visual smoke (web is fine): the bar renders empty in the browser (no `electronAPI`), which matches current behavior. Full check happens with `npm run dev` (Electron) in Task 7's verification.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(redesign): TitleBar owns its CSS, lucide window controls"
```

---

### Task 6: Avatar color system (TDD)

**Files:**
- Create: `client/src/utils/avatarColor.ts`, `client/src/utils/avatarColor.test.ts`
- Modify: `client/src/components/Avatar.tsx`

**Interfaces:**
- Consumes: nothing (pure function + inline style).
- Produces: `avatarColor(name: string): string` returning one of the 8 handoff hex colors — M1 (member list, voice cards) and M3 (call tiles' 74px avatars) call this exact function.

- [ ] **Step 1: Write the failing test** — `src/utils/avatarColor.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { AVATAR_COLORS, avatarColor } from './avatarColor';

describe('avatarColor', () => {
  it('always returns a palette color', () => {
    for (const name of ['joe', 'shaldashk', 'Вася', 'a', '', '🦊']) {
      expect(AVATAR_COLORS).toContain(avatarColor(name));
    }
  });

  it('is deterministic for the same name', () => {
    expect(avatarColor('shaldashk')).toBe(avatarColor('shaldashk'));
    expect(avatarColor('Вася')).toBe(avatarColor('Вася'));
  });

  it('distributes across the palette', () => {
    const names = Array.from({ length: 64 }, (_, i) => `user-${i}`);
    const used = new Set(names.map(avatarColor));
    expect(used.size).toBeGreaterThan(4);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run src/utils/avatarColor.test.ts`
Expected: FAIL — cannot resolve `./avatarColor`.

- [ ] **Step 3: Implement** — `src/utils/avatarColor.ts`:

```ts
// Deterministic username → color mapping (design handoff, option 2b).
// Same 8 hex values as the --avatar-1..8 tokens in styles/tokens.css.
export const AVATAR_COLORS = [
  '#4F46E5',
  '#E8590C',
  '#0F766E',
  '#B4145A',
  '#1D4ED8',
  '#7C3AED',
  '#0E7490',
  '#A16207',
] as const;

export function avatarColor(name: string): string {
  let hash = 0;
  for (const ch of name) {
    hash = (hash * 31 + (ch.codePointAt(0) ?? 0)) >>> 0;
  }
  return AVATAR_COLORS[hash % AVATAR_COLORS.length];
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run src/utils/avatarColor.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Use it in `Avatar.tsx`** — the initials fallback gets the hash color (uploaded images unchanged):

```tsx
import { useEffect, useState } from 'react';
import { API_BASE_URL } from '@/services/api';
import { avatarColor } from '@/utils/avatarColor';

interface AvatarProps {
  url?: string;
  username: string;
  className: string;
}

function resolveAvatarUrl(url: string): string {
  return url.startsWith('/') ? `${API_BASE_URL}${url}` : url;
}

export function Avatar({ url, username, className }: AvatarProps) {
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setFailed(false);
  }, [url]);

  if (url && !failed) {
    return <img className={className} src={resolveAvatarUrl(url)} alt={username} onError={() => setFailed(true)} />;
  }

  return (
    <div
      className={className}
      style={{ background: avatarColor(username), color: '#FFFFFF', fontWeight: 700 }}
    >
      {username.charAt(0).toUpperCase() || '?'}
    </div>
  );
}
```

- [ ] **Step 6: Verify + commit**

Run: `npx tsc --noEmit` && `npm test` — clean.
Visual smoke: member list / messages show colored initials, same user always the same color.

```bash
git add -A && git commit -m "feat(redesign): deterministic avatar colors (handoff 2b)"
```

---

### Task 7: Electron launch background follows theme

**Files:**
- Modify: `client/electron/main.ts`, `client/electron/preload.ts`, `client/src/types/electron.d.ts`, `client/src/stores/themeStore.ts`

**Interfaces:**
- Consumes: theme values `'light' | 'dark'` from `themeStore`.
- Produces: `window.electronAPI.setTheme?: (theme: string) => void`; `ui-prefs.json` in Electron `userData` with shape `{"theme":"dark"}`.

- [ ] **Step 1: Persist + read theme in `electron/main.ts`**

Add to the imports: `import * as fs from 'fs';` and add `nativeTheme` to the existing `electron` import list. Above `createWindow`, add:

```ts
// Тема окна до загрузки рендерера: renderer localStorage главному процессу
// недоступен, поэтому renderer зеркалит выбор темы в ui-prefs.json (IPC
// 'theme:changed' ниже). До первой записи — системная тема (nativeTheme),
// как и getInitialTheme() в stores/themeStore.ts.
function windowBackgroundColor(): string {
  const prefsPath = path.join(app.getPath('userData'), 'ui-prefs.json');
  try {
    const prefs = JSON.parse(fs.readFileSync(prefsPath, 'utf-8')) as { theme?: string };
    if (prefs.theme === 'dark') return '#0E1017';
    if (prefs.theme === 'light') return '#FFFFFF';
  } catch {
    // no prefs yet — fall through to system theme
  }
  return nativeTheme.shouldUseDarkColors ? '#0E1017' : '#FFFFFF';
}
```

In `createWindow`, replace `backgroundColor: '#313338',` with `backgroundColor: windowBackgroundColor(),`.

Next to the existing `ipcMain.on('locale:changed', …)` handler add:

```ts
ipcMain.on('theme:changed', (_event, theme: unknown) => {
  if (theme !== 'dark' && theme !== 'light') return;
  const prefsPath = path.join(app.getPath('userData'), 'ui-prefs.json');
  try {
    fs.writeFileSync(prefsPath, JSON.stringify({ theme }));
  } catch {
    // non-fatal: worst case is a wrong launch background next start
  }
});
```

- [ ] **Step 2: Expose in `electron/preload.ts`** — next to `setLocale`:

```ts
  setTheme: (theme: string) => ipcRenderer.send('theme:changed', theme),
```

- [ ] **Step 3: Type it in `src/types/electron.d.ts`** — next to `setLocale?`:

```ts
  // Опционально по той же причине, что и setLocale: старые сборки клиента
  // и веб-сборка этого метода не имеют.
  setTheme?: (theme: string) => void;
```

- [ ] **Step 4: Mirror from `src/stores/themeStore.ts`** — extend `applyTheme` so both the initial call and `setTheme` notify Electron:

```ts
function applyTheme(theme: Theme) {
  document.documentElement.setAttribute('data-theme', theme);
  window.electronAPI?.setTheme?.(theme);
}
```

- [ ] **Step 5: Verify**

Run: `npx tsc --noEmit` && `npx tsc -p electron/tsconfig.json --noEmit` && `npm test` — clean.
Electron smoke: `npm run dev`; switch theme to dark in settings, quit, relaunch — the window appears dark from the first frame (no `#313338`-vs-white flash either way). Check `ui-prefs.json` exists in the userData dir.

- [ ] **Step 6: Commit**

```bash
git add -A && git commit -m "feat(redesign): window launch background follows persisted theme"
```

---

### Task 8: M0 closeout verification

**Files:** none (verification only).

**Interfaces:**
- Consumes: everything above.
- Produces: a green M0 baseline every M1 task builds on.

- [ ] **Step 1: Full verification suite**

```bash
npx tsc --noEmit && npm test && npm run check:i18n && npm run build:vite
```

Expected: all green; `vite build` completes.

- [ ] **Step 2: Manual smoke checklist** (`npm run dev:vite`, both themes)

- Login/register pages render (Inter, tokens applied).
- Main screen: rail, sidebar, chat, member list all render; no unstyled regions.
- Modals: create server, create channel, logout confirm — new shell (r16, 800 titles).
- Messages send/receive; context menus open; settings modal opens; theme toggle works both ways.
- Colored avatar initials stable per user.

- [ ] **Step 3: Push the branch**

```bash
git push -u origin redesign
```

---

## Self-review notes

- Spec coverage (M0 bullet list): dead files → Task 1; `src/styles/` + tokens + aliases → Task 2; fonts → Task 3; lucide → Task 5 (install) — usage expands in M1+; modal-shell extraction → Task 4; `.title-bar` move incl. `UpdateBanner`/`AppPage` couplings → Task 5 (height kept at 40px, selector unchanged); Avatar colors → Task 6; Electron backgroundColor → Task 7. "Visual change minimal by design" holds: only accent hue, fonts, modal chrome, and avatar colors shift.
- M1–M6 get their own plans at each milestone boundary; this plan deliberately stops at the foundation.
