import { useState } from 'react';
import * as Sentry from '@sentry/react';
import './ErrorBoundary.css';

interface CrashFallbackProps {
  eventId: string;
}

function CrashFallback({ eventId }: CrashFallbackProps) {
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
        <div className="error-boundary-icon">⚠️</div>
        <h1>Что-то пошло не так</h1>
        <p>Мы уже знаем об этой ошибке. Попробуйте перезагрузить приложение.</p>
        <button className="error-boundary-reload-btn" onClick={handleReload}>
          Перезагрузить
        </button>
        <div className="error-boundary-event-row">
          <span>ID: {eventId}</span>
          <button className="error-boundary-copy-btn" onClick={handleCopyId}>
            Скопировать
          </button>
        </div>
        <details className="error-boundary-feedback">
          <summary>Что вы делали, когда это произошло?</summary>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            placeholder="Необязательно, но очень помогает разобраться"
            disabled={submitted}
          />
          <button
            className="error-boundary-feedback-submit"
            onClick={handleSubmitFeedback}
            disabled={submitted || !comment.trim()}
          >
            {submitted ? 'Спасибо, отправлено ✓' : 'Отправить'}
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
