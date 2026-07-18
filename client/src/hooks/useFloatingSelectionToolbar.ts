import { useEffect, useRef, useState, type RefObject } from 'react';

export interface SelectionInfo {
  text: string;
  x: number;
  y: number;
}

interface UseFloatingSelectionToolbarArgs {
  containerRef: RefObject<HTMLElement | null>;
  getSelectionInfo: (e: MouseEvent) => SelectionInfo | null;
  onConfirm: (text: string) => void;
  /**
   * Extra value to re-run the subscription effect on. Needed whenever
   * containerRef.current mounts *after* this hook's first render (e.g. a
   * ref attached only inside a conditional branch) — passing the value
   * that changes when that branch becomes active (e.g. `channel?.id`,
   * `editingId`) re-attaches listeners to the freshly mounted node.
   */
  resubscribeKey?: unknown;
}

export function useFloatingSelectionToolbar({
  containerRef,
  getSelectionInfo,
  onConfirm,
  resubscribeKey,
}: UseFloatingSelectionToolbarArgs) {
  const [state, setState] = useState<SelectionInfo | null>(null);
  const getSelectionInfoRef = useRef(getSelectionInfo);
  const onConfirmRef = useRef(onConfirm);
  getSelectionInfoRef.current = getSelectionInfo;
  onConfirmRef.current = onConfirm;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleMouseUp = (e: MouseEvent) => {
      const info = getSelectionInfoRef.current(e);
      if (!info || info.text.trim().length === 0) {
        setState(null);
        return;
      }
      const clampedX = Math.max(70, Math.min(info.x, window.innerWidth - 70));
      setState({ ...info, x: clampedX });
    };

    const hide = () => setState(null);
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('input', hide);
    container.addEventListener('scroll', hide);
    document.addEventListener('mousedown', hide);
    document.addEventListener('keydown', handleKeyDown);
    window.addEventListener('resize', hide);

    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('input', hide);
      container.removeEventListener('scroll', hide);
      document.removeEventListener('mousedown', hide);
      document.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('resize', hide);
    };
  }, [containerRef, resubscribeKey]);

  const confirm = () => {
    if (!state) return;
    onConfirmRef.current(state.text);
    setState(null);
  };

  return { visible: state !== null, x: state?.x ?? 0, y: state?.y ?? 0, confirm };
}
