import type { ReactNode } from 'react';
import type { LongPressHandlers } from '@/mobile/gestures/useLongPress';
import './MobileListRow.css';

interface MobileListRowProps {
  /** Слот 48×48: аватар сервера, «#» канала, аватар пользователя. */
  avatar: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  /** Справа: время, бейдж непрочитанного, иконка. */
  meta?: ReactNode;
  /** Иконка после заголовка (замок приватного сервера). */
  titleIcon?: ReactNode;
  onClick?: () => void;
  longPress?: LongPressHandlers;
  className?: string;
}

/** Строка списка мобильных экранов (спека §5.1). Всегда <button>: тач-фидбек и
 *  доступность бесплатно, поэтому вложенных кнопок внутри строки быть не может —
 *  второстепенные действия живут в меню по длинному нажатию. */
export function MobileListRow({
  avatar, title, subtitle, meta, titleIcon, onClick, longPress, className,
}: MobileListRowProps) {
  return (
    <button
      type="button"
      className={`mobile-row${className ? ` ${className}` : ''}`}
      onClick={onClick}
      {...longPress}
    >
      <span className="mobile-row-avatar">{avatar}</span>
      <span className="mobile-row-text">
        <span className="mobile-row-title">
          <span className="mobile-row-title-text">{title}</span>
          {titleIcon}
        </span>
        {subtitle && <span className="mobile-row-sub">{subtitle}</span>}
      </span>
      {meta && <span className="mobile-row-meta">{meta}</span>}
    </button>
  );
}
