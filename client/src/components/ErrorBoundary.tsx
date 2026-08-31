import { useState } from 'react';
import * as Sentry from '@sentry/react';
import { AlertTriangle, Check } from 'lucide-react';
import { useT } from '@/i18n';
import './ErrorBoundary.css';

interface CrashFallbackProps {
  eventId: string;
}

function CrashFallback({ eventId }: CrashFallbackProps) {
  const t = useT();
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
        <div className="error-boundary-tile">
          <AlertTriangle size={28} strokeWidth={1.8} />
        </div>
        <h1 className="error-boundary-title">{t('crash.title')}</h1>
        <p className="error-boundary-body">{t('crash.body')}</p>
        <button className="error-boundary-reload-btn btn btn-primary" onClick={handleReload}>
          {t('crash.reload')}
        </button>
        <div className="error-boundary-event-row">
          <span className="kbd">{t('crash.eventId', { id: eventId })}</span>
          <button className="error-boundary-copy-btn btn btn-ghost" onClick={handleCopyId}>
            {t('crash.copyId')}
          </button>
        </div>
        <details className="error-boundary-feedback">
          <summary>{t('crash.feedbackSummary')}</summary>
          <textarea
            className="error-boundary-feedback-input input"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder={t('crash.feedbackPlaceholder')}
            disabled={submitted}
          />
          <button
            className="error-boundary-feedback-submit btn btn-secondary"
            onClick={handleSubmitFeedback}
            disabled={submitted || !comment.trim()}
          >
            {submitted ? (
              <>
                <Check size={14} strokeWidth={1.8} />
                {t('crash.feedbackSent')}
              </>
            ) : (
              t('crash.feedbackSend')
            )}
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
