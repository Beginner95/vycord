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
