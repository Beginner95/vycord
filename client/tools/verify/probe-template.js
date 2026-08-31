// probe-template.js — the shape a smoke.mjs probe must have. Copy, rename, edit.
//
// Run it (dev server must be up on :3000 — `npm run dev:vite`, NOT `npm run dev`):
//   node smoke.mjs --out /tmp/shot.png --probe probe-template.js --wait 3000
//
// Contract:
//  - The file is evaluated in the page as ONE expression via Runtime.evaluate:
//    smoke.mjs interpolates it inside `(await (<file>))`. So it must be an
//    async IIFE that RETURNS a serialisable summary — and it must NOT end with
//    a trailing semicolon, which is a parse error inside that paren group and
//    kills the run before the screenshot.
//  - Every assertion goes through a THROWING fail(). A probe that only collects
//    results into an object and returns them is a reporter, not a gate — its
//    verdicts read as green whatever the page does (see README, "reporters").
//  - A probe is evidence only once you have watched it FAIL against a broken
//    page. Break the thing on purpose once, see it throw, then trust it.
(async () => {
  const fail = (msg) => { throw new Error(`PROBE FAIL: ${msg}`); };

  // Example 1: assert a token is LIVE by resolving it on a scratch element.
  // Never getComputedStyle(root).getPropertyValue('--x') for a presence claim:
  // it returns the declared string whether or not anything consumes it.
  // The negative control keeps the check from passing on two empty reads.
  const scratch = (decl, prop) => {
    const el = document.createElement('div');
    el.style.cssText = decl;
    document.body.appendChild(el);
    const v = getComputedStyle(el)[prop];
    el.remove();
    return v;
  };
  const accent = scratch('background: var(--accent);', 'backgroundColor');
  const control = scratch('background: var(--no-such-token);', 'backgroundColor');
  if (accent === control) fail('--accent does not resolve (matches the negative control)');

  // Example 2: assert an element EXISTS and HAS A BOX before measuring it.
  // A display:none element measures 0×0, and 0×0 can read as "perfectly
  // centred" to arithmetic on its box — a measured false pass.
  const el = document.querySelector('#root');
  if (!el) fail('#root missing');
  const box = el.getBoundingClientRect();
  if (box.width === 0 || box.height === 0) fail('#root has no box');

  return { ok: true, accent, root: { w: box.width, h: box.height } };
})()
