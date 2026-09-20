import { useEffect, useId, useRef } from 'react';
import { useMobileNav, latestStack } from '@/mobile/nav/useMobileNav';

// id → число живых монтирований. StrictMode монтирует эффект дважды
// (mount → cleanup → mount синхронно): счётчик и отложенная до микрозадачи
// очистка не дают запушить запись дважды и не делают лишний back().
const registry = new Map<string, number>();

const isMine = (id: string) => {
  const s = latestStack();
  const top = s && s.length > 0 ? s[s.length - 1] : undefined;
  return top?.kind === 'sheet' && top.id === id;
};

/** Спека §4.2: открытый sheet = запись в истории. Системное «назад» её
 *  снимает → onClose(). Закрытие иным путём (скрим, свайп, Escape, выбор
 *  пункта) → back(), чтобы запись не висела. Переход вперёд из sheet'а
 *  заменяет его запись (navReducer.push), и тогда back() не нужен. */
export function useBackDismiss(open: boolean, onClose: () => void): void {
  const id = useId();
  const nav = useMobileNav();
  const navRef = useRef(nav);
  navRef.current = nav;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const seen = useRef(false);

  useEffect(() => {
    if (!open) return;
    const refs = registry.get(id);
    if (refs === undefined) {
      registry.set(id, 1);
      navRef.current.push({ kind: 'sheet', id });
    } else {
      registry.set(id, refs + 1);
    }
    return () => {
      const n = registry.get(id);
      if (n === undefined) return;
      registry.set(id, n - 1);
      queueMicrotask(() => {
        if (registry.get(id) !== 0) return;
        registry.delete(id);
        seen.current = false;
        if (isMine(id)) navRef.current.back();
      });
    };
  }, [open, id]);

  const inStack = nav.stack.some((s) => s.kind === 'sheet' && s.id === id);
  // Длина стека в момент, когда наша запись последний раз реально была
  // наверху истории. Одного inStack мало: navReducer.push ЗАМЕНЯЕТ верхнюю
  // sheet-запись — это происходит и при переходе вперёд из НАШЕГО sheet'а
  // (кейс 4), и когда поверх нас монтируется ЧУЖОЙ sheet (вложенный
  // ActionSheet/BottomSheet). В обоих случаях длина стека не меняется — в
  // отличие от настоящего back() (system back/pop), который стек укорачивает.
  // Без этой проверки чужой push()сверху выглядел бы для нас как «меня смыло
  // системным назад» и звал бы onClose() у ЧУЖОГО закрытия — ровно то, что
  // наблюдается в тесте «only the top sheet reacts to Escape» на двух
  // одновременно открытых BottomSheet.
  const prevLen = useRef(0);
  useEffect(() => {
    if (!open) return;
    if (inStack) {
      seen.current = true;
      prevLen.current = nav.stack.length;
      return;
    }
    if (!seen.current) return;
    seen.current = false;
    if (nav.stack.length < prevLen.current) {
      // Запись снята не нами — системный «назад» / свайп браузера.
      registry.delete(id);
      onCloseRef.current();
    }
    // Иначе запись просто заняли (чужой push с тем же слотом) — не наше дело.
  }, [open, inStack, id]);
}
