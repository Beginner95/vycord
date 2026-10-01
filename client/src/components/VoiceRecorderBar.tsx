import { ChevronUp, SendHorizontal, Trash2 } from 'lucide-react';
import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react';
import { useT } from '@/i18n';
import { formatTime } from '@/utils/formatTime';
import type { GestureState } from '@/voice/voiceGesture';
import './VoiceRecorderBar.css';

interface Props { state: GestureState; elapsedMs: number; level: number; onDelete(): void; onSend(): void }

/** Полоса записи в композере (spec §2.4). В recording — таймер, уровень, «‹ Отмена» за пальцем; в locked — «Удалить»/«Отправить». */
export function VoiceRecorderBar({ state, elapsedMs, level, onDelete, onSend }: Props) {
  const t = useT();
  const deleteRef = useRef<HTMLButtonElement>(null);
  const locked = state.kind === 'locked';
  // Вход в закреплённую запись переносит фокус на «Удалить»: кнопка микрофона
  // в locked размонтирована, фокус иначе упал бы на body.
  useEffect(() => { if (locked) deleteRef.current?.focus(); }, [locked]);

  if (state.kind !== 'recording' && state.kind !== 'locked' && state.kind !== 'starting') return null;
  const dx = state.kind === 'recording' ? state.dx : 0;
  // Escape в закреплённой записи — «Удалить». Обработчик на самой полосе, не на document.
  // Автоповтор Enter/Space, которым запись начали с клавиатуры, долетает сюда
  // после переноса фокуса на «Удалить» — гасим его, иначе он «нажмёт» кнопку.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.repeat && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); return; }
    if (locked && e.key === 'Escape') { e.preventDefault(); onDelete(); }
  };

  return (
    <div className={`composer-voice${locked ? ' is-locked' : ''}`} role="group" aria-label={t('voice.recording')} onKeyDown={onKeyDown}>
      <span className="composer-voice-dot" aria-hidden="true" />
      <span className="composer-voice-time" aria-live="off">{formatTime(elapsedMs / 1000)}</span>
      <div className="level-meter composer-voice-level" aria-hidden="true">
        <div className="level-meter-fill" style={{ '--meter-level': `${Math.round(level * 100)}%` } as CSSProperties} />
      </div>
      {locked ? (
        <div className="composer-voice-actions">
          <button ref={deleteRef} type="button" className="composer-icon-btn composer-voice-delete" onClick={onDelete} aria-label={t('voice.deleteRecording')} title={t('voice.deleteRecording')}>
            <Trash2 size={17} strokeWidth={1.8} />
          </button>
          <button type="button" className="composer-send composer-voice-send" onClick={onSend} aria-label={t('voice.sendRecording')} title={t('voice.sendRecording')}>
            <SendHorizontal size={17} strokeWidth={1.8} />
          </button>
        </div>
      ) : (
        <>
          <span className="composer-voice-cancel" style={{ '--voice-drag-x': `${dx}px` } as CSSProperties}>{t('voice.slideToCancel')}</span>
          <span className="composer-voice-lock" aria-label={t('voice.lockHint')} title={t('voice.lockHint')}>
            <ChevronUp size={14} strokeWidth={1.8} />
          </span>
        </>
      )}
    </div>
  );
}
