import * as Sentry from '@sentry/react';

export function toError(err: unknown): Error {
  if (err instanceof Error) return err;
  if (err instanceof Event) {
    const parts = [`Event: ${err.type}`];
    if ('code' in err && 'reason' in err) {
      const closeEvent = err as CloseEvent;
      parts.push(
        `code=${closeEvent.code}`,
        `reason=${closeEvent.reason || '(empty)'}`,
        `wasClean=${closeEvent.wasClean}`
      );
    }
    return new Error(parts.join(' '));
  }
  return new Error(String(err));
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
