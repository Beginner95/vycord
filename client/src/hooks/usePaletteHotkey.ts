import { useEffect } from 'react';
import { usePaletteStore } from '@/stores/paletteStore';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

// Board 2c: ⌘K/Ctrl+K ОТКРЫВАЕТ, esc закрывает. Не тумблер: открытая палитра
// сама рисует .modal-overlay, поэтому второй ⌘K гасится тем же гейтом.
// e.code, а не e.key: интерфейс русский, при кириллической раскладке эта
// физическая клавиша приходит как 'л' (ChatArea уже использует e.code).
export function usePaletteHotkey(): void {
  const open = usePaletteStore((s) => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return;
      // preventDefault ДО гейта: иначе заглушённый ⌘K в вебе провалится
      // в адресную строку браузера.
      e.preventDefault();
      if (isBlockingOverlayOpen()) return;
      open();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);
}
