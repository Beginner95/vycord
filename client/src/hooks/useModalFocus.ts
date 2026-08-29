import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

// Стек активных модалок: Escape/Tab обрабатывает только верхняя. Вложенные
// модалки реальны (Settings → ConfirmModal выхода) — без стека один Escape
// закрыл бы обе, потому что слушатель нижней зарегистрирован раньше.
const modalStack: symbol[] = [];

/** Modal focus contract (board 1d + M2 deferred findings): trap Tab inside the
 * container, focus [data-autofocus] on open, close on Escape (top-most modal
 * only), restore focus on close. onClose lives in a ref so the listener binds
 * once per open — parent re-renders must not re-subscribe (the M2 ConfirmModal
 * finding). */
export function useModalFocus(
  active: boolean,
  containerRef: RefObject<HTMLElement | null>,
  onClose?: () => void,
): void {
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!active) return;
    const token = Symbol('modal');
    // "Верх стека" = "активирована последней". React выполняет эффекты
    // child-before-parent в рамках одного коммита, поэтому порядок здесь
    // корректен, только когда вложенная модалка активируется ПОЗЖЕ родителя
    // (отдельным коммитом) — как в реальном сценарии Settings → confirm
    // выхода. Если бы родитель и вложенный потомок стали active в ОДНОМ
    // коммите, эффект потомка отработал бы первым и его token оказался бы
    // НИЖЕ родительского — Escape закрыл бы родителя (и вместе с ним
    // потомка), а не потомка. Ни один адоптер M4 такого не создаёт.
    modalStack.push(token);
    const prev = document.activeElement as HTMLElement | null;
    const container = containerRef.current;
    const focusables = () =>
      Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
        (el) => !el.hasAttribute('disabled'),
      );
    const initial =
      container?.querySelector<HTMLElement>('[data-autofocus]') ?? focusables()[0];
    initial?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (modalStack[modalStack.length - 1] !== token) return; // not the top modal
      if (e.key === 'Escape') {
        onCloseRef.current?.();
        return;
      }
      if (e.key !== 'Tab') return;
      const els = focusables();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      const current = document.activeElement;
      if (e.shiftKey && (current === first || !container?.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !container?.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      modalStack.splice(modalStack.indexOf(token), 1);
      // Не возвращаем фокус, если он уже уехал куда-то ещё. Реальный случай
      // (M4 T5): «Создать свой» в FindServerModal делает onClose(); onCreateServer()
      // одним коммитом — commit-фаза React ставит autoFocus на поле новой
      // модалки, а этот cleanup выполняется ПОЗЖЕ, в passive-фазе, и утаскивал
      // фокус обратно в `prev`. А `prev` здесь — <textarea class="composer-input">
      // (Composer.tsx автофокусит его при входе в канал), который по Enter
      // ОТПРАВЛЯЕТ СООБЩЕНИЕ. Пользователь набирал бы имя сервера в невидимый
      // композер под оверлеем и Enter'ом публиковал бы его в канал.
      //
      // Проверка именно «фокус не на body и не внутри контейнера»: наивное
      // «фокус ушёл за пределы контейнера» отключило бы восстановление ВСЕГДА —
      // к моменту cleanup контейнер уже отсоединён в mutation-фазе, поэтому
      // activeElement при обычном закрытии равен body. Для ConfirmModal и
      // Settings (обе закрываются размонтированием) это body → восстановление
      // работает ровно как раньше.
      const cur = document.activeElement as HTMLElement | null;
      const movedElsewhere = !!cur && cur !== document.body && !container?.contains(cur);
      if (!movedElsewhere && prev && document.contains(prev)) prev.focus();
    };
  }, [active, containerRef]);
}

/** Открыт ли сейчас блокирующий оверлей. Нужен глобальным хоткеям: ⌘K не
 *  должен открывать палитру поверх модалки (решение 8), а Ctrl+Shift+F —
 *  переключать панель поиска под оверлеем (решение 11).
 *
 *  Двойная проверка не избыточна. Стек знает только про адоптеров хука — а это
 *  ровно ConfirmModal, FindServerModal и Settings; остальные восемь модалок
 *  приложения к нему не подключены (адоптация app-wide — за M6, ruling 13 M4).
 *  Зато `.modal-overlay` рисуют ВСЕ, включая саму палитру, — что заодно даёт
 *  «только открывает» без отдельного флага. */
export function isBlockingOverlayOpen(): boolean {
  return modalStack.length > 0 || document.querySelector('.modal-overlay') !== null;
}
