import { useEffect } from 'react';
import { usePaletteStore } from '@/stores/paletteStore';
import { isBlockingOverlayOpen } from '@/hooks/useModalFocus';

// Board 2c: ⌘K/Ctrl+K ОТКРЫВАЕТ, esc закрывает. Не тумблер: открытая палитра
// сама рисует .modal-overlay, поэтому второй ⌘K гасится тем же гейтом.
// e.code, а не e.key: интерфейс русский, при кириллической раскладке эта
// физическая клавиша приходит как 'л' (ChatArea уже использует e.code).

// macOS ли это. userAgentData.platform — только Chromium; navigator.platform
// формально deprecated, но в Electron и во всех целевых браузерах жив и
// остаётся единственным общим источником.
function isMacPlatform(): boolean {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  return /mac/i.test(nav.userAgentData?.platform ?? navigator.platform ?? '');
}

// Редактируемая ли цель события. Кнопки/чекбоксы/слайдеры — это тоже <input>,
// но текста в них нет и killing-строки там не существует.
const NON_TEXT_INPUT = new Set([
  'button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file', 'color', 'image',
]);
function isEditableTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.tagName !== 'string') return false;
  if (el.isContentEditable) return true;
  if (el.tagName === 'TEXTAREA') return true;
  if (el.tagName === 'INPUT') return !NON_TEXT_INPUT.has((el as HTMLInputElement).type);
  return false;
}

export function usePaletteHotkey(): void {
  const open = usePaletteStore((s) => s.open);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.code !== 'KeyK') return;

      // РЕШЕНИЕ M6 T11 (шаг 5) — сознательное, а не исправление бага.
      //
      // Раньше preventDefault() стоял ДО гейта и безусловно, поэтому Ctrl+K
      // проглатывался в КАЖДОМ текстовом поле приложения. На macOS Ctrl+K —
      // это emacs-биндинг «убить до конца строки», живой в любом нативном
      // текстовом поле; композер чата, который автофокусится при входе в канал
      // (см. useModalFocus.ts), терял его целиком.
      //
      // Правило: на macOS Ctrl+K БЕЗ ⌘ внутри редактируемого поля — не наш
      // аккорд. Пропускаем событие нетронутым: ни preventDefault, ни open.
      // ⌘K на macOS и Ctrl+K везде остальное ведут себя ровно как раньше.
      //
      // ЦЕНА, ЕСЛИ ПРАВИЛО НЕВЕРНО. Единственный вход — определение платформы,
      // а оно строится на UA. Ложноположительный «мак» (iPadOS, который
      // представляется Macintosh; подменённый UA; будущий Chromium, убравший
      // navigator.platform без userAgentData) стоит одного: на такой платформе
      // Ctrl+K из текстового поля перестанет открывать палитру, и её придётся
      // открывать, убрав фокус из поля (или ⌘K, если Cmd есть). Палитра при
      // этом не становится недостижимой — остаётся ⌘K и мышь. Ложноотрицательный
      // «не мак» просто сохраняет сегодняшнее поведение. Ни один из исходов не
      // ломает данные и не создаёт тупика.
      //
      // Отвергнуто: снимать preventDefault для всех редактируемых целей без
      // проверки платформы. На Windows/Linux Ctrl+K — ЕДИНСТВЕННЫЙ аккорд
      // палитры, а дефолтное состояние фокуса в канале — редактируемый
      // композер, так что палитра стала бы недостижима с клавиатуры в самом
      // частом случае.
      if (e.ctrlKey && !e.metaKey && isEditableTarget(e.target) && isMacPlatform()) return;

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
