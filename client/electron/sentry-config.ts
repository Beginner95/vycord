// Public GlitchTip DSN for the Electron main process — DSNs are not secrets
// (they're meant to be embedded in client bundles), so this is safe to
// commit. Must be the same project/value as VITE_SENTRY_DSN in
// client/.env.production (see README.md "Error reporting (GlitchTip)").
export const SENTRY_DSN = 'REPLACE_WITH_GLITCHTIP_DSN';
