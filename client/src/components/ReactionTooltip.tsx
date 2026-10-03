import { createPortal } from 'react-dom';

const EDGE = 8;

/** Подсказка над пилюлей реакции. Позиция — от прямоугольника якоря,
 *  по горизонтали прижата к краям окна. Не интерактивна. */
export function ReactionTooltip({ anchor, children }: { anchor: DOMRect; children: React.ReactNode }) {
  const left = Math.min(Math.max(anchor.left + anchor.width / 2, EDGE + 60), window.innerWidth - EDGE - 60);
  return createPortal(
    <div className="reaction-tooltip" role="tooltip" style={{ left, top: anchor.top }}>
      {children}
    </div>,
    document.body,
  );
}
