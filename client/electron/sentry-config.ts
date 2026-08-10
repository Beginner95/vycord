// Public GlitchTip DSN for the Electron main process — DSNs are not secrets
// (they're meant to be embedded in client bundles), so this is safe to
// commit. Must be the same project/value as VITE_SENTRY_DSN in
// client/.env.production (see README.md "Error reporting (GlitchTip)").
export const SENTRY_DSN = 'https://16d644237e774c9dae28c62bcd0b752a@app.glitchtip.com/26232';
