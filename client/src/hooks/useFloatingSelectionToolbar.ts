import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useEscapeDismiss } from '@/hooks/useModalFocus';

export interface SelectionInfo {
  text: string;
  x: number;
  y: number;
}

interface UseFloatingSelectionToolbarArgs {
  containerRef: RefObject<HTMLElement | null>;
  getSelectionInfo: (e?: MouseEvent) => SelectionInfo | null;
  onConfirm: (text: string) => void;
  /**
   * Extra value to re-run the subscription effect on. Needed whenever
   * containerRef.current mounts *after* this hook's first render (e.g. a
   * ref attached only inside a conditional branch) — passing the value
   * that changes when that branch becomes active (e.g. `channel?.id`,
   * `editingId`) re-attaches listeners to the freshly mounted node.
   */
  resubscribeKey?: unknown;
  /**
   * Where to listen for keyup-driven selection changes (e.g. Shift+arrows).
   * Textareas dispatch keyup to themselves while focused, so `containerRef`
   * ('container', the default) is the correct, naturally-scoped target
   * there. Plain rendered text (e.g. the chat message list) isn't a
   * keyboard event target — focus can remain elsewhere while the user
   * extends a selection there — so that usage opts into listening at the
   * document level instead; getSelectionInfo's own containment check
   * (only returning non-null for selections actually inside that
   * container) keeps that safe.
   */
  keyupTarget?: 'container' | 'document';
}

export function useFloatingSelectionToolbar({
  containerRef,
  getSelectionInfo,
  onConfirm,
  resubscribeKey,
  keyupTarget = 'container',
}: UseFloatingSelectionToolbarArgs) {
  const [state, setState] = useState<SelectionInfo | null>(null);
  const getSelectionInfoRef = useRef(getSelectionInfo);
  const onConfirmRef = useRef(onConfirm);
  getSelectionInfoRef.current = getSelectionInfo;
  onConfirmRef.current = onConfirm;

  // Escape — через стек поверхностей (M6 T11, шаг 4), и только пока тулбар
  // ВИДЕН. Раньше подписка жила внутри общего эффекта ниже и срабатывала на
  // любой Escape, в том числе адресованный модалке над чатом. Колбэк стабилен
  // (useCallback без зависимостей), так что токен кладётся в стек ровно один
  // раз на показ и не всплывает наверх при перерисовке родителя.
  const hideToolbar = useCallback(() => setState(null), []);
  useEscapeDismiss(state !== null, hideToolbar);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const show = (info: SelectionInfo | null) => {
      if (!info || info.text.trim().length === 0) {
        setState(null);
        return;
      }
      const clampedX = Math.max(70, Math.min(info.x, window.innerWidth - 70));
      const clampedY = Math.min(info.y, window.innerHeight - 40);
      setState({ ...info, x: clampedX, y: clampedY });
    };

    const handleMouseUp = (e: MouseEvent) => show(getSelectionInfoRef.current(e));
    const handleKeyUp = () => show(getSelectionInfoRef.current());

    const hide = () => setState(null);
    // `hide` on 'input' used to run synchronously, right on the container —
    // the same element React's own controlled <textarea> reconciles for that
    // very same event. Calling setState from it raced React's own commit of
    // the onChange-driven value update, and lost
    const hideAsync = () => setTimeout(hide, 0);

    const keyupTargetEl: Document | Element = keyupTarget === 'document' ? document : container;

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('input', hideAsync);
    container.addEventListener('scroll', hide);
    keyupTargetEl.addEventListener('keyup', handleKeyUp);
    document.addEventListener('mousedown', hide);
    window.addEventListener('resize', hide);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('input', hideAsync);
      container.removeEventListener('scroll', hide);
      keyupTargetEl.removeEventListener('keyup', handleKeyUp);
      document.removeEventListener('mousedown', hide);
      window.removeEventListener('resize', hide);
    };
  }, [containerRef, resubscribeKey, keyupTarget]);

  const confirm = () => {
    if (!state) return;
    onConfirmRef.current(state.text);
    setState(null);
  };

  return { visible: state !== null, x: state?.x ?? 0, y: state?.y ?? 0, confirm };
}
