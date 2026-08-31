#!/usr/bin/env node
// Headless visual-smoke harness for the vycord redesign work.
//
// Drives the system Chrome over CDP. It logs the smoke user in against the
// API, seeds localStorage for the localhost:3000 dev origin, then screenshots
// the app and/or injects probe scripts into the page.
//
// Usage:
//   node smoke.mjs --out shot.png [--theme light|dark] [--path /app] [--wait 3000]
//                  [--anon] [--click "selector"] [--size 1440x900] [--screen 1440x900]
//
// Credentials come from the environment — see README.md in this directory:
//   VYCORD_SMOKE_EMAIL / VYCORD_SMOKE_PASSWORD  (required unless --anon)
//   VYCORD_SMOKE_API                            (optional API host override)
// Never hardcode credentials here: this file is committed.

import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const API = process.env.VYCORD_SMOKE_API || 'https://api.vycord.webvaha.ru';
const APP = 'http://localhost:3000';
const CREDS = { email: process.env.VYCORD_SMOKE_EMAIL, password: process.env.VYCORD_SMOKE_PASSWORD };

function arg(name, fallback = null) {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const flag = (name) => process.argv.includes(`--${name}`);

const out = arg('out');
if (!out) {
  console.error('missing --out <file.png>');
  process.exit(2);
}
const theme = arg('theme', 'light');
const routePath = arg('path', '/');
const waitMs = Number(arg('wait', '3500'));
const anon = flag('anon');
const clickSel = arg('click');
const [vw, vh] = arg('size', '1440x900').split('x').map(Number);

async function login() {
  if (!CREDS.email || !CREDS.password) {
    console.error(
      'Set VYCORD_SMOKE_EMAIL and VYCORD_SMOKE_PASSWORD (see client/tools/verify/README.md), or pass --anon.'
    );
    process.exit(2);
  }
  const r = await fetch(`${API}/api/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: APP },
    body: JSON.stringify(CREDS),
  });
  if (!r.ok) throw new Error(`login failed: HTTP ${r.status} ${await r.text()}`);
  return r.json();
}

// Minimal CDP client over the DevTools websocket.
class CDP {
  constructor(ws) {
    this.ws = ws;
    this.id = 0;
    this.pending = new Map();
    this.events = [];
    ws.addEventListener('message', (ev) => {
      const msg = JSON.parse(ev.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
      } else if (msg.method) {
        this.events.push(msg);
      }
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`CDP timeout: ${method}`));
        }
      }, 30000);
    });
  }
  // userGesture: Runtime.evaluate can grant TRANSIENT USER ACTIVATION to the
  // evaluated script. Without it `el.click()` from --click is an untrusted
  // synthetic click (the M3 T4 brief's claim that --click is a "trusted CDP
  // Input.dispatchMouseEvent" is false), and gesture-gated APIs —
  // Element.requestFullscreen() above all — reject. Activation is transient
  // (~5s), so a probe that needs it must call the gated API early.
  async eval(expression, userGesture = false) {
    const r = await this.send('Runtime.evaluate', {
      expression,
      returnByValue: true,
      awaitPromise: true,
      userGesture,
    });
    if (r.exceptionDetails) throw new Error(`eval threw: ${JSON.stringify(r.exceptionDetails)}`);
    return r.result?.value;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', () => reject(new Error(`ws failed: ${wsUrl}`)), { once: true });
  });
  return new CDP(ws);
}

let profileDir, chrome;
try {
  const auth = anon ? null : await login();

  profileDir = await mkdtemp(join(tmpdir(), 'vycord-smoke-'));
  const port = 9333 + Math.floor((Date.now() / 1000) % 200);

  chrome = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profileDir}`,
    `--window-size=${vw},${vh}`,
    // --screen <WxH> (M6 T11): headless Chrome's VIRTUAL SCREEN is 800x600
    // regardless of --window-size, and requestFullscreen() sizes the viewport to
    // the SCREEN, not the window. Measured: --size 1440x900 gave a 1440x757
    // viewport that became 800x544 the moment .call-stage went fullscreen —
    // under the 900px responsive band, where AppPage.css sets
    // `[data-mobile-panel="chat"] .call-stage { display: none }`. Any probe that
    // enters fullscreen and then measures layout is measuring the mobile band
    // unless it sets this. Opt-in, so no existing probe's behaviour changes.
    ...(arg('screen') ? [`--screen-info={${arg('screen')}}`] : []),
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--force-device-scale-factor=1',
    // --fake-media: synthetic mic/camera + auto-granted permission, so a smoke
    // run can actually JOIN a voice channel and exercise voice-session UI
    // (the voice card, participant rows, mic states) instead of only styling it.
    ...(flag('fake-media')
      ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
         '--autoplay-policy=no-user-gesture-required']
      : []),
    'about:blank',
  ], { stdio: 'ignore' });

  // Wait for the DevTools endpoint.
  let version = null;
  for (let i = 0; i < 60; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
      break;
    } catch {
      await sleep(250);
    }
  }
  if (!version) throw new Error('Chrome DevTools endpoint never came up');

  const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = targets.find((t) => t.type === 'page');
  if (!page) throw new Error('no page target');

  const cdp = await connect(page.webSocketDebuggerUrl);
  await cdp.send('Page.enable');
  await cdp.send('Runtime.enable');
  await cdp.send('Log.enable').catch(() => {});

  // --focus-emulation (M4 T5): headless Chrome reports document.hasFocus() ===
  // false, so `:focus` NEVER matches even when document.activeElement is the
  // right element (measured: activeIsInput true, matches(':focus') false,
  // box-shadow "none"). Any focus-RING assertion is unmeasurable without this.
  // Opt-in flag so no existing probe's behaviour changes.
  if (flag('focus-emulation')) {
    await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch((e) => {
      console.log('focus-emulation unavailable: ' + e.message);
    });
  }

  // Origin must exist before localStorage is writable.
  await cdp.send('Page.navigate', { url: APP });
  await sleep(1200);

  const seed = anon
    ? `localStorage.clear(); localStorage.setItem('vycord_theme', ${JSON.stringify(theme)}); 'anon'`
    : `
      localStorage.setItem('vycord_access_token', ${JSON.stringify(auth.access_token)});
      localStorage.setItem('vycord_refresh_token', ${JSON.stringify(auth.refresh_token)});
      localStorage.setItem('vycord_user', ${JSON.stringify(JSON.stringify(auth.user))});
      localStorage.setItem('vycord_theme', ${JSON.stringify(theme)});
      'seeded'`;
  await cdp.eval(seed);

  // TitleBar only renders its window controls when window.electronAPI exists, which
  // it never does in a browser. Injecting a stub BEFORE any page script runs lets us
  // verify the lucide icons actually render without launching Electron.
  if (flag('fake-electron')) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: `window.electronAPI = {
        minimizeWindow(){}, maximizeWindow(){}, closeWindow(){},
        setLocale(){}, setTheme(){},
      };`,
    });
  }

  // --preload <file.js>: run a script before any page script (e.g. the WebSocket
  // recorder in inject-voice-ws.js, which lets --push-ws drive server-pushed UI).
  const preloadFile = arg('preload');
  if (preloadFile) {
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
      source: await readFile(preloadFile, 'utf8'),
    });
  }

  // --reduced-motion (M6 T6): emulate `prefers-reduced-motion: reduce` at the
  // MEDIA-FEATURE level. This is NOT --focus-emulation: they are unrelated flags
  // (--focus-emulation forces document.hasFocus() true and is opt-in for
  // focus-ring work only). Unlike hover/pointer — which setEmulatedMedia cannot
  // override, see the --touch note below — prefers-reduced-motion IS overridable
  // this way. Any probe using this MUST assert
  // matchMedia('(prefers-reduced-motion: reduce)').matches === true before
  // asserting anything else: an emulation that silently failed to apply makes
  // every downstream assertion meaningless in the PASSING direction.
  if (flag('reduced-motion')) {
    await cdp.send('Emulation.setEmulatedMedia', {
      features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
    });
  }

  // --touch: emulate a coarse, hover-incapable pointer so `@media (hover: none)`
  // branches actually apply. Headless Chrome otherwise reports a hover-capable
  // mouse, which makes every touch-only CSS branch unreachable in a smoke run —
  // exactly how a dark-theme touch regression slipped past M1's per-task probes.
  if (flag('touch')) {
    // The media FEATURES are what CSS branches on — setEmitTouchEventsForMouse
    // alone does not change them (verified: `matchMedia('(hover: none)')` stayed
    // false). setEmulatedMedia overrides the features themselves.
    // hover/pointer are NOT overridable via setEmulatedMedia (tried: the call
    // succeeds but matchMedia('(hover: none)') stays false). Real device
    // emulation — mobile metrics + touch — is what flips those media features.
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: vw, height: vh, deviceScaleFactor: 1, mobile: true,
    });
  }

  await cdp.send('Page.navigate', { url: APP + routePath });
  await sleep(waitMs);

  // --push-ws '<type>:<json payload>': feed a synthetic server frame through the
  // app's real WebSocket onmessage handler. Requires --preload inject-voice-ws.js.
  const pushWs = arg('push-ws');
  if (pushWs) {
    const idx = pushWs.indexOf(':');
    const wsType = pushWs.slice(0, idx);
    const wsPayload = pushWs.slice(idx + 1);
    const pushed = await cdp.eval(
      `String(window.__pushWS ? window.__pushWS(${JSON.stringify(wsType)}, ${wsPayload}) : 'NO __pushWS (missing --preload?)')`
    );
    console.log(`push-ws(${wsType}) -> delivered to ${pushed} socket(s)`);
    await sleep(1200);
  }

  if (clickSel) {
    const clicked = await cdp.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(clickSel)});
        if (!el) return 'NOT FOUND: ' + ${JSON.stringify(clickSel)};
        el.click();
        return 'clicked';
      })()`);
    console.log(`click(${clickSel}): ${clicked}`);
    // --after <ms>: post-click settle. The 1500ms default is fine for opening a
    // menu but far too short for a WebRTC/SFU join to reach connected state.
    await sleep(Number(arg('after', '1500')));
  }

  // --click2 <selector>: a second click after the first has settled, for
  // two-step interactions (e.g. open a context menu, then click an item in it).
  const clickSel2 = arg('click2');
  if (clickSel2) {
    const clicked2 = await cdp.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(clickSel2)});
        if (!el) return 'NOT FOUND: ' + ${JSON.stringify(clickSel2)};
        el.click();
        return 'clicked';
      })()`);
    console.log(`click2(${clickSel2}): ${clicked2}`);
    await sleep(Number(arg('after2', '800')));
  }

  // Type into a field (React-safe: set via the native setter so React's
  // onChange actually fires), used to drive the message-search panel.
  const typeInto = arg('type-into');
  const typeText = arg('type-text', '');
  if (typeInto) {
    const typed = await cdp.eval(`
      (() => {
        const el = document.querySelector(${JSON.stringify(typeInto)});
        if (!el) return 'NOT FOUND: ' + ${JSON.stringify(typeInto)};
        const setter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype, 'value').set;
        setter.call(el, ${JSON.stringify(typeText)});
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        return 'typed';
      })()`);
    console.log(`type(${typeInto}): ${typed}`);
    await sleep(2500);
  }

  // --eval-file <file.js>: run an arbitrary in-page setup script (e.g. to build
  // scratch elements) before --force-hover / --probe. Evaluated the same way
  // --probe is (expression form, IIFE required); its return value is logged.
  const evalFile = arg('eval-file');
  if (evalFile) {
    const evalSrc = await readFile(evalFile, 'utf8');
    const evalOut = await cdp.eval(`(async () => { try { return JSON.stringify(await (${evalSrc})); } catch (e) { return 'EVAL ERROR: ' + e.message; } })()`);
    console.log(`eval-file(${evalFile}): ${evalOut}`);
  }

  // --force-hover <selector>[,<selector>...]: force the CSS `:hover`
  // pseudo-class on each matching element via CDP's protocol-level
  // CSS.forcePseudoState, since a headless run has no real pointer and
  // `el.click()` never makes `:hover` match (M4 T11's
  // probe-m4t11-calldock-danger.js documents the same gap). Comma-separated
  // so a probe's element-under-test and its positive control can both be
  // forced in the same page load. getComputedStyle() read after this
  // reflects the TRUE cascade under :hover for that element, not an
  // approximation from CSSOM rule text.
  const forceHoverArg = arg('force-hover');
  if (forceHoverArg) {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    for (const sel of forceHoverArg.split(',').map((s) => s.trim()).filter(Boolean)) {
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) {
        console.log(`force-hover: NOT FOUND: ${sel}`);
      } else {
        await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: ['hover'] });
        console.log(`force-hover: forced :hover on ${sel} (nodeId ${nodeId})`);
      }
    }
    // .panel-icon-btn declares `transition: color var(--transition)` (0.16s);
    // reading getComputedStyle immediately can return a mid-interpolation
    // rgb() matching neither endpoint. Settle past the transition budget
    // (250ms max in this codebase) before anything reads computed style.
    await sleep(350);
  }

  // --force-state '<selector>=<state>[|<state>…][,<selector>=…]' (M6 T13):
  // the general form of --force-hover, which is kept unchanged above because
  // eight probes already pass it.
  //
  // *** DO NOT PASS --force-hover AND --force-state IN THE SAME RUN. ***
  // MEASURED, T13: this block's own `DOM.getDocument` rebuilds the node map and
  // DISCARDS every pseudo-state --force-hover forced a moment earlier. The run
  // does not error — it prints both blocks' cheerful `forced :hover on …` lines
  // and then the probe reads the REST values for everything --force-hover
  // touched. Caught because `.title-bar button.title-bar-close:hover` read
  // colour rgb(138,144,162) / background transparent (the rest state) in a run
  // whose log said :hover had been forced on it. Put every selector in
  // --force-state instead; `sel=hover` is exactly what --force-hover did.
  //
  // States are CDP's forced pseudo-classes —
  // hover, active, focus, focus-within, focus-visible, target, enabled,
  // disabled, visited.
  //
  // WHY THIS EXISTS: `el.focus()` is NOT enough to make `:focus` match in this
  // harness. MEASURED, T13: the scratch input reported
  // `document.activeElement === el` true, and `.form-group input:focus`
  // STILL did not apply — border-color read --line-strong (the rest value) and
  // box-shadow read `none`, in both themes and on the REAL page element as well
  // as the scratch one. A headless page whose window never takes OS focus does
  // not match :focus. A probe that calls .focus() and reads a rest-state value
  // reports "no focus ring" as a fact about the CSS; it is a fact about the
  // harness. Every :focus / :focus-visible read must come through here.
  //
  // Multiple selectors may be forced in one run, and one selector may carry
  // several states, so a rule under test and its cascade neighbours can all be
  // measured in a single page load — which is what makes a before/after diff a
  // diff of the CSS rather than of two page loads.
  const forceStateArg = arg('force-state');
  if (forceStateArg) {
    await cdp.send('DOM.enable');
    await cdp.send('CSS.enable');
    const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
    for (const pair of forceStateArg.split(',').map((s) => s.trim()).filter(Boolean)) {
      const eq = pair.lastIndexOf('=');
      if (eq === -1) {
        console.log(`force-state: MALFORMED (expected <selector>=<state>): ${pair}`);
        continue;
      }
      const sel = pair.slice(0, eq).trim();
      const states = pair.slice(eq + 1).split('|').map((s) => s.trim()).filter(Boolean);
      const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
      if (!nodeId) {
        // NOT FOUND is printed, never swallowed: a silently skipped selector
        // makes a probe read rest-state values and call them the state's.
        console.log(`force-state: NOT FOUND: ${sel}`);
        continue;
      }
      await cdp.send('CSS.forcePseudoState', { nodeId, forcedPseudoClasses: states });
      console.log(`force-state: forced :${states.join(' :')} on ${sel} (nodeId ${nodeId})`);
    }
    await sleep(350); // same transition-settle reason as --force-hover above
  }

  // Report what actually rendered, so a blank screenshot is never mistaken for success.
  const report = await cdp.eval(`
    (() => {
      const seen = new Set();
      document.querySelectorAll('*').forEach(e => e.className &&
        typeof e.className === 'string' && e.className.split(/\\s+/).forEach(c => c && seen.add(c)));
      const cs = getComputedStyle(document.body);
      return JSON.stringify({
        url: location.href,
        theme: document.documentElement.getAttribute('data-theme'),
        bodyFont: cs.fontFamily,
        bodyBg: cs.backgroundColor,
        bodyColor: cs.color,
        // NOTE: fonts.check('14px Inter') is useless as a gate on this machine —
        // Inter is installed system-wide, so it returns true even with nothing
        // loaded. What proves self-hosting is a @font-face rule whose src points
        // at a bundled/served file.
        interFits: document.fonts ? document.fonts.check('14px Inter') : null,
        loadedFaces: (() => {
          const faces = [];
          document.fonts.forEach(f => faces.push(\`\${f.family} \${f.weight} \${f.status}\`));
          return faces.length;
        })(),
        interFaces: (() => {
          const out = [];
          document.fonts.forEach(f => { if (/Inter/i.test(f.family)) out.push(f.weight); });
          return [...new Set(out)].sort();
        })(),
        monoFaces: (() => {
          const out = [];
          document.fonts.forEach(f => { if (/JetBrains/i.test(f.family)) out.push(f.weight); });
          return [...new Set(out)].sort();
        })(),
        // Does any stylesheet actually declare a self-hosted Inter face?
        fontFaceSrcs: (() => {
          const srcs = [];
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            for (const r of rules || []) {
              if (r.constructor.name === 'CSSFontFaceRule') {
                const fam = r.style.getPropertyValue('font-family').replace(/["']/g, '');
                const src = r.style.getPropertyValue('src');
                const m = src.match(/url\\(([^)]+)\\)/);
                srcs.push(fam + ' -> ' + (m ? m[1].replace(/["']/g, '').slice(-60) : '?'));
              }
            }
          }
          return [...new Set(srcs)].slice(0, 6);
        })(),
        fontFaceCount: (() => {
          let n = 0;
          for (const sheet of document.styleSheets) {
            let rules;
            try { rules = sheet.cssRules; } catch { continue; }
            for (const r of rules || []) if (r.constructor.name === 'CSSFontFaceRule') n++;
          }
          return n;
        })(),
        accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
        // WAS \`bgPrimaryAlias\`, which reported the legacy --bg-primary into
        // every run's header while the alias layer existed. M6 T13 deleted all
        // 47 legacy names, so this is inverted into a standing sentinel: any
        // name listed here that still RESOLVES has been re-introduced. It rides
        // on every smoke run, which happens often enough to catch a regression
        // early.
        // getPropertyValue is correct for an ABSENCE claim (it returns the
        // declared string, so '' proves nothing declares it) — not for a
        // presence claim, where client/docs/verification.md's ban applies.
        legacyAliasesResurrected: ['--bg-primary', '--text-primary', '--brand-color',
          '--border-subtle', '--radius-md', '--radius-lg', '--shadow-lg', '--brand-subtle']
          .filter(n => getComputedStyle(document.documentElement).getPropertyValue(n).trim() !== ''),
        textLen: document.body.innerText.length,
        // Avatar initials fallback: a div (not img) whose background should be one of
        // the 8 palette hexes, deterministic per username.
        // M6 T9 collapsed the member-list avatar from the compound
        // .user-avatar.list to the single class .user-avatar-list; M6 T10 did the
        // same to ChannelSidebar's .user-avatar.small, which is now
        // .user-avatar-small. The bare .user-avatar token therefore matches
        // NOTHING as of T10 and has been removed from this selector — leaving it
        // in would have made the census silently under-count with no error.
        // (NB: this whole block is inside a JS template literal that is eval'd over
        // CDP — a backtick in a comment here terminates the string and the probe
        // dies with a bare "X is not defined". Measured, T9.)
        avatars: [...document.querySelectorAll(
          '.message-avatar, .user-avatar-list, .user-avatar-small, .member-avatar, .profile-avatar-large')]
          .map(e => ({
            tag: e.tagName,
            initial: e.textContent || null,
            bg: e.tagName === 'IMG' ? '(image)' : getComputedStyle(e).backgroundColor,
            weight: e.tagName === 'IMG' ? null : getComputedStyle(e).fontWeight,
          }))
          .slice(0, 6),
        // Search-result initials are hand-rolled (not <Avatar>); after the
        // final-review fix they must show the SAME hash colour as above.
        searchAvatars: [...document.querySelectorAll('.message-search-result-avatar')]
          .map(e => ({ initial: e.textContent, bg: getComputedStyle(e).backgroundColor }))
          .slice(0, 4),
        titleBar: (() => {
          const tb = document.querySelector('.title-bar');
          if (!tb) return 'absent';
          const svgs = tb.querySelectorAll('svg');
          return {
            height: getComputedStyle(tb).height,
            background: getComputedStyle(tb).backgroundColor,
            buttons: tb.querySelectorAll('button').length,
            svgIcons: svgs.length,
            // lucide renders <svg class="lucide lucide-minus"> etc.
            iconClasses: [...svgs].map(s => s.getAttribute('class') || '').slice(0, 4),
            strokeWidths: [...new Set([...svgs].map(s => s.getAttribute('stroke-width')))],
          };
        })(),
        markers: ['app-layout','server-list','channel-sidebar','chat-area','user-list',
                  'title-bar','modal','modal-overlay','auth-page','login']
                  .filter(m => seen.has(m)),
      }, null, 2);
    })()`);
  console.log(report);

  // --probe <file.js>: task-specific DOM assertions. The file's contents are
  // evaluated in the page as an expression and printed. Keeps per-task checks
  // out of this harness while reusing its login/seed/navigate machinery.
  // --probe2 / --probe3 run AFTER --probe, each as its own Runtime.evaluate.
  // That matters for anything gesture-gated: requestFullscreen requires transient
  // user activation AND CONSUMES it, so a single evaluation can enter fullscreen
  // exactly once. One probe file per activation is the only way to measure a
  // multi-step fullscreen sequence in-page. Share state across steps via a
  // window global (the page is not reloaded between them).
  for (const slot of ['probe', 'probe2', 'probe3']) {
    const probeFile = arg(slot);
    if (!probeFile) continue;
    const probeSrc = await readFile(probeFile, 'utf8');
    const probeOut = await cdp.eval(`(async () => { try { return JSON.stringify((await (${probeSrc})), null, 2); } catch (e) { return 'PROBE ERROR: ' + e.message; } })()`, true);
    console.log(`${slot.toUpperCase()}:\n` + probeOut);
  }

  const errors = cdp.events
    .filter((e) => e.method === 'Runtime.exceptionThrown' || e.method === 'Log.entryAdded')
    .map((e) => e.params?.exceptionDetails?.text || e.params?.entry?.text)
    .filter(Boolean)
    .filter((t) => !/favicon|DevTools|Autofill/i.test(t));
  if (errors.length) console.log('CONSOLE ERRORS:\n' + errors.slice(0, 15).join('\n'));

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await writeFile(out, Buffer.from(shot.data, 'base64'));
  console.log(`screenshot -> ${out}`);
} catch (err) {
  console.error('SMOKE FAILED:', err.message);
  process.exitCode = 1;
} finally {
  if (chrome) chrome.kill();
  if (profileDir) await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}
