import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * M6 T11, step 3 — the overlay convention, made checkable.
 *
 * `isBlockingOverlayOpen()` (src/hooks/useModalFocus.ts) is what ⌘K,
 * Ctrl+Shift+F and `useDismissOnOutside` consult, and half of it reads the DOM:
 *
 *     modalStack -> layerStack.some(blocking) ||
 *     document.querySelector('.modal-overlay, .screen-picker-backdrop') !== null
 *
 * That half holds only while every blocking scrim renders `.modal-overlay`.
 * It is a CONVENTION, not a contract, and it had been broken three times before
 * this test existed — `.screen-picker-backdrop` (hard-coded into the selector as
 * a result); VYC-82's `MediaLightbox`, which shipped `position: fixed; inset: 0;
 * z-index: 1000` with no `.modal-overlay`, so ⌘K opened the palette BEHIND an
 * open lightbox (M5.5 T4 fixed it); and `.p2p-overlay.is-incoming`, which was
 * still live and uncaught when this file was first written, because the
 * predicate below only recognised `inset: 0` and that scrim is `inset: 40px 0 0`.
 * Nothing caught any of the three.
 *
 * This test is meant to catch the fourth, and the lesson from the third is why
 * `isFullViewportFixed` has already been widened once: a predicate that
 * recognises one geometry is a census of that geometry, not of blocking scrims.
 * It is NOT complete — read the KNOWN BOUNDARY note on that function before
 * reading a green run as "there are no others".
 *
 * WHAT THIS TEST DOES *NOT* CATCH, stated plainly. M5.5's CF-4b measured that
 * removing the `useModalFocus` call while keeping the `.modal-overlay` class
 * leaves the gate still returning true — the class alone satisfies it. So
 * neither the gate nor this test can see a modal that renders the class but has
 * no Escape, no Tab trap and no focus restore. Only app-wide `useModalFocus`
 * adoption closes that half (13 renderers vs 5 adopters today), and that is a
 * behavioural change, not a cleanup — it stays an honest backlog item. The
 * behavioural half is covered by probe-t11-escape-stack.js in the harness.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, '../..');
const GATE_FILE = join(SRC, 'hooks/useModalFocus.ts');

/**
 * Scrims that deliberately do not wear `.modal-overlay`. Each entry needs a
 * reason, and `inGate` records whether `isBlockingOverlayOpen()` must name it.
 *
 * The list length is asserted below, so adding a fourth blocking scrim cannot
 * be done by quietly appending here — it has to be a deliberate edit that
 * changes an expectation.
 */
const ALLOWED_NON_PRIMITIVE_SCRIMS: {
  /** The CSS selector exactly as the scanner reports it. */
  selector: string;
  /** What `isBlockingOverlayOpen()` must name, when that differs from the CSS
   *  rule — a scrim whose base rule is shared by a non-blocking state variant
   *  must be gated on the blocking variant only, never on the base. */
  gateSelector?: string;
  inGate: boolean;
  why: string;
}[] = [
  {
    selector: '.screen-picker-backdrop',
    inGate: true,
    why:
      'ScreenSourcePicker/ScreenQualityPicker. Opted out of the primitive on purpose — it would ' +
      'have inherited --z-overlay, flex centring and the modal animation over an equal-specificity ' +
      'source-order conflict. Hard-coded into isBlockingOverlayOpen() instead.',
  },
  {
    selector: '.p2p-overlay',
    gateSelector: '.p2p-overlay.is-incoming',
    inGate: true,
    why:
      'CallUI\'s 1:1 call surface — `position: fixed; inset: 40px 0 0` (the 40px clears the '
      + 'TitleBar). Only the `.is-incoming` STATE is a blocking scrim: it adds var(--scrim) + '
      + 'blur(6px) over the whole app (CallUI.css:17, rendered at CallUI.tsx:165), and ⌘K used to '
      + 'open the palette on top of it at --z-palette over --z-overlay. The gate therefore names '
      + '`.p2p-overlay.is-incoming`, NOT the base rule: `.p2p-overlay.is-active` is the in-call '
      + 'view, has no scrim, and blocking ⌘K there would be a behaviour change nobody asked for. '
      + 'It stays off the primitive on purpose — `.modal-overlay` would impose inset: 0, centring, '
      + 'blur and fade-in, i.e. move and restyle the overlay.',
  },
  {
    selector: '.error-boundary-overlay',
    inGate: false,
    why:
      'The crash card. Not an overlay OVER a live app: React has already unmounted the tree, so ' +
      'there are no global hotkeys left to gate and no surface underneath to trap focus against.',
  },
];

function cssFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...cssFiles(p));
    else if (p.endsWith('.css')) out.push(p);
  }
  return out.sort();
}

/** Comments become spaces so byte offsets — and therefore line numbers — hold. */
function blankComments(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
}

interface Block {
  /** Everything between the previous `}` and this block's `{`. */
  prelude: string;
  preludeStart: number;
  bodyStart: number;
  bodyEnd: number;
}

/**
 * Brace-matched scan of ONE nesting level, between [from, to). Offsets are
 * absolute into `css`, so recursion into an at-rule body needs no re-indexing.
 */
function blocks(css: string, from: number, to: number): Block[] {
  const out: Block[] = [];
  let depth = 0;
  let preludeStart = from;
  let bodyStart = 0;
  for (let i = from; i < to; i++) {
    const ch = css[i];
    if (ch === '{') {
      if (depth === 0) bodyStart = i + 1;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0) {
        out.push({
          prelude: css.slice(preludeStart, bodyStart - 1).trim(),
          preludeStart,
          bodyStart,
          bodyEnd: i,
        });
        preludeStart = i + 1;
      }
    }
  }
  return out;
}

interface Rule {
  selector: string;
  decls: Record<string, string>;
  /** Declarations in SOURCE order. `inset` and its longhands override each other
   *  by position, so a keyed map alone cannot resolve which edge value wins. */
  declOrder: [string, string][];
  line: number;
}

function rules(css: string): Rule[] {
  const out: Rule[] = [];
  const walk = (from: number, to: number) => {
    for (const b of blocks(css, from, to)) {
      if (b.prelude.startsWith('@')) {
        // @media / @supports / @layer wrap further rules. @keyframes wrap
        // frames; a frame declaring `position: fixed` is not a scrim rule, and
        // its "selector" (`from`/`to`/`50%`) can never match the allowlist or
        // contain `.modal-overlay`, so it would only ever produce a loud
        // false positive — never a silent false negative.
        walk(b.bodyStart, b.bodyEnd);
        continue;
      }
      const decls: Record<string, string> = {};
      const declOrder: [string, string][] = [];
      // Declarations only: anything belonging to a nested rule sits inside its
      // own braces, which this split would mangle, so brace-bearing chunks are
      // dropped rather than guessed at.
      for (const part of css.slice(b.bodyStart, b.bodyEnd).split(';')) {
        if (part.includes('{') || part.includes('}')) continue;
        const idx = part.indexOf(':');
        if (idx === -1) continue;
        const prop = part.slice(0, idx).trim();
        if (!/^-{0,2}[a-z][a-z0-9-]*$/i.test(prop)) continue;
        const value = part.slice(idx + 1).trim();
        decls[prop] = value;
        declOrder.push([prop, value]);
      }
      // The prelude starts right after the previous `}`, so it carries every
      // blank line and blanked-out comment in between. Report the line of the
      // SELECTOR itself — an offender reported at `CallUI.css:1` sends the
      // reader to a licence header instead of the rule.
      const raw = css.slice(b.preludeStart, b.bodyStart - 1);
      const selectorStart = b.preludeStart + (raw.length - raw.trimStart().length);
      out.push({
        selector: b.prelude.replace(/\s+/g, ' '),
        decls,
        declOrder,
        line: css.slice(0, selectorStart).split('\n').length,
      });
      // A rule body may itself contain nested rules (CSS nesting). Descend.
      walk(b.bodyStart, b.bodyEnd);
    }
  };
  walk(0, css.length);
  return out;
}

const isZeroEdge = (v: string) => /^0(px|%|r?em|v[hw])?$/.test(v.trim());

/** `inset` follows the margin shorthand: 1 = all, 2 = block/inline,
 *  3 = top / inline / bottom, 4 = top/right/bottom/left. */
function expandInset(value: string): [string, string, string, string] | null {
  // No `calc()` or other space-bearing functions in this tree; if one appears,
  // bail rather than mis-split it — a false negative here is loud (the rule
  // simply is not scanned) where a mis-split would be silent.
  if (value.includes('(')) return null;
  const v = value.trim().split(/\s+/);
  if (v.length === 1) return [v[0], v[0], v[0], v[0]];
  if (v.length === 2) return [v[0], v[1], v[0], v[1]];
  if (v.length === 3) return [v[0], v[1], v[2], v[1]];
  if (v.length === 4) return [v[0], v[1], v[2], v[3]];
  return null;
}

/**
 * "Fixed and covering the viewport in both axes."
 *
 * WIDENED at M6 T11's fix wave. The first version required `inset: 0` or four
 * zero offsets, and a live third violation walked straight through it:
 * `.p2p-overlay` (`CallUI.css:8`) is `position: fixed; inset: 40px 0 0` — 40px
 * down to clear the TitleBar — and `.p2p-overlay.is-incoming` paints
 * `var(--scrim)` + `blur(6px)` over the whole app for an incoming 1:1 call. A
 * predicate that only recognises one geometry is a census of that geometry, not
 * of blocking scrims.
 *
 * Two shapes count as a cover:
 *
 *  (a) all four edges anchored (via `inset`, longhands, or a mix — in SOURCE
 *      order, because they override each other by position), none `auto`, and
 *      **at most one** non-zero. One non-zero edge is a chrome inset (a title
 *      bar, a banner); two or more describes a box, not a cover.
 *  (b) pinned at `top: 0; left: 0` and sized `width: 100vw; height: 100vh`
 *      (or `dvh`/`svh`/`lvh`). No rule in the tree uses this spelling today — it
 *      is here because (a) alone is a census of ANCHORED-EDGE covers, and the
 *      whole lesson of `.p2p-overlay` is that a predicate matching one way of
 *      writing a cover reports on that spelling rather than on covers.
 *
 * KNOWN BOUNDARY, so the next reader does not have to rediscover it: these are
 * the only two spellings recognised. A cover written with percentage sizing,
 * `calc()`, `min-height`, or a transform-based stretch would still slip through.
 * If you add one, widen this — the point of the file is that the NEXT violation
 * is caught, not that today's four are listed.
 */
function isFullViewportFixed(r: Rule): boolean {
  if (r.decls.position !== 'fixed') return false;
  // (b) first: it needs no edge folding.
  if (isZeroEdge(r.decls.top ?? '') && isZeroEdge(r.decls.left ?? '')
    && /^100vw$/.test((r.decls.width ?? '').trim())
    && /^100(vh|dvh|svh|lvh)$/.test((r.decls.height ?? '').trim())) {
    return true;
  }
  const edge: Record<'top' | 'right' | 'bottom' | 'left', string | undefined> = {
    top: undefined, right: undefined, bottom: undefined, left: undefined,
  };
  for (const [prop, value] of r.declOrder) {
    if (prop === 'inset') {
      const e = expandInset(value);
      if (!e) return false;
      [edge.top, edge.right, edge.bottom, edge.left] = e;
    } else if (prop === 'top' || prop === 'right' || prop === 'bottom' || prop === 'left') {
      edge[prop] = value;
    }
  }
  const edges = [edge.top, edge.right, edge.bottom, edge.left];
  if (edges.some((v) => v === undefined)) return false;
  if (edges.some((v) => v!.trim() === 'auto')) return false;
  return edges.filter((v) => !isZeroEdge(v!)).length <= 1;
}

const files = cssFiles(SRC);
const scrims = files.flatMap((f) =>
  rules(blankComments(readFileSync(f, 'utf8')))
    .filter(isFullViewportFixed)
    .map((r) => ({ ...r, file: relative(SRC, f) })),
);

describe('overlay scrim contract', () => {
  it('the scanner actually reads CSS (guard against a vacuous pass)', () => {
    expect(files.length).toBeGreaterThan(10);
    // `.modal-overlay` itself must be found, or the detector is broken and every
    // assertion below would pass on an empty set.
    expect(scrims.map((s) => s.selector)).toContain('.modal-overlay');
  });

  it('every fixed full-viewport scrim carries .modal-overlay or is allowlisted', () => {
    const allowed = new Set(ALLOWED_NON_PRIMITIVE_SCRIMS.map((a) => a.selector));
    const offenders = scrims.filter(
      (s) => !s.selector.split(',').every((sel) =>
        sel.includes('.modal-overlay') || allowed.has(sel.trim())),
    );
    expect(
      offenders.map((o) => `${o.file}:${o.line} ${o.selector}`),
      'A fixed viewport-covering scrim without `.modal-overlay` is invisible to '
      + 'isBlockingOverlayOpen(), so ⌘K opens the palette behind it and '
      + 'Ctrl+Shift+F toggles search underneath it. Either adopt the primitive '
      + '(preferred) or add it to ALLOWED_NON_PRIMITIVE_SCRIMS *and* to the '
      + 'selector in useModalFocus.ts.',
    ).toEqual([]);
  });

  it('the allowlist has not grown quietly', () => {
    expect(ALLOWED_NON_PRIMITIVE_SCRIMS).toHaveLength(3);
  });

  it('every blocking allowlist entry is named in isBlockingOverlayOpen()', () => {
    const gate = readFileSync(GATE_FILE, 'utf8');
    // Tolerant of the multi-line, trailing-comma call shape the selector grew
    // into once it named three scrims.
    const selector = /document\.querySelector\(\s*'([^']+)'\s*,?\s*\)/.exec(gate)?.[1];
    expect(selector, 'isBlockingOverlayOpen() no longer queries a literal selector').toBeTruthy();
    expect(selector).toContain('.modal-overlay');
    for (const entry of ALLOWED_NON_PRIMITIVE_SCRIMS.filter((a) => a.inGate)) {
      expect(selector, entry.why).toContain(entry.gateSelector ?? entry.selector);
    }
  });
});
