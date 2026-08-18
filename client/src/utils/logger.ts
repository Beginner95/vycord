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

  /**
   * Reports a non-exception diagnostic to Sentry/GlitchTip. Unlike `error`
   * there is no throwable involved — this is for measured conditions the code
   * detected deliberately (a metric out of range, an anomaly in a sampler).
   *
   * `message` MUST be a fixed string with no numbers or ids interpolated into
   * it: GlitchTip groups events by `fingerprint`, which defaults to the
   * message, so a message carrying live values would open a brand-new issue on
   * every single report and bury the signal. All varying data belongs in
   * `extra` (queryable) or `tags` (filterable/aggregatable).
   *
   * No-op unless error reporting was initialized (services/errorReporting.ts),
   * so dev builds send nothing.
   */
  report(
    message: string,
    tags: Record<string, string> = {},
    extra: Record<string, unknown> = {},
    level: 'info' | 'warning' | 'error' = 'warning',
  ): void {
    console.warn(message, extra);
    Sentry.captureMessage(message, {
      level,
      tags,
      extra,
      // Pin grouping to the message alone. Without this, GlitchTip folds in the
      // capture stack trace, which differs per call site and per bundle build.
      fingerprint: [message],
    });
  },
};
