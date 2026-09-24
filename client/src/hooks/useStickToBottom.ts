import { useEffect, useLayoutEffect, useRef, type RefObject } from 'react';

/** Расстояние до низа, в пределах которого список считается «прилипшим». */
export const STICK_THRESHOLD_PX = 80;

interface Options {
  /** Смена значения = вход в другой список (канал): прилипание включается заново. */
  resetKey: unknown;
  /** Содержимое отрисовано (не скелетон, не чужой список): можно прыгать вниз. */
  ready: boolean;
  /** true — не трогаем прокрутку (просмотр истории, экран скрыт под другим). */
  disabled?: boolean;
  /** Смена значения = пришло новое содержимое: плавно докручиваем к низу. */
  followKey?: unknown;
  /** Плавная прокрутка к низу для нового содержимого. */
  smoothToBottom?: () => void;
}

const distanceToBottom = (el: HTMLElement) => el.scrollHeight - el.scrollTop - el.clientHeight;

/**
 * Держит прокрутку контейнера у низа, пока пользователь сам не ушёл вверх.
 *
 * Плавный `scrollIntoView` при входе в канал срабатывает, пока вложения
 * (картинки, стикеры) ещё не догрузились: список после этого вырастает, и
 * прокрутка останавливается посередине. Поэтому: (1) первая прокрутка после
 * отрисовки — мгновенная; (2) ResizeObserver на контейнере и его прямых детях
 * возвращает низ, пока флаг «прилип» поднят; (3) флаг гасится, когда
 * пользователь прокрутил вверх дальше порога, и поднимается, когда вернулся.
 */
export function useStickToBottom(
  ref: RefObject<HTMLElement | null>,
  { resetKey, ready, disabled = false, followKey, smoothToBottom }: Options,
): void {
  const stuckRef = useRef(true);
  const settledRef = useRef(false); // мгновенный прыжок для этого resetKey уже сделан
  const jumpedRef = useRef(false); // прыжок случился в текущем коммите
  const disabledRef = useRef(disabled);
  useLayoutEffect(() => { disabledRef.current = disabled; }, [disabled]);

  // Объявлен раньше прыжка: в одном коммите сначала сброс, потом прыжок.
  useLayoutEffect(() => {
    stuckRef.current = true;
    settledRef.current = false;
  }, [resetKey]);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !ready || disabled || settledRef.current) return;
    settledRef.current = true;
    jumpedRef.current = true;
    stuckRef.current = true;
    el.scrollTop = el.scrollHeight;
  }, [ref, resetKey, ready, disabled]);

  // Экран был скрыт/в истории (disabled), пока приходили сообщения и
  // догружались вложения: ни follow, ни ResizeObserver тогда не работали, и
  // после возврата список остался бы на старом низу.
  const wasDisabledRef = useRef(disabled);
  useLayoutEffect(() => {
    const el = ref.current;
    const resumed = wasDisabledRef.current && !disabled;
    wasDisabledRef.current = disabled;
    if (!el || !resumed || !ready || !settledRef.current || !stuckRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [ref, disabled, ready]);

  // Новое содержимое: как раньше — плавно, но не поверх только что сделанного
  // мгновенного прыжка.
  const prevFollowRef = useRef(followKey);
  useEffect(() => {
    const changed = prevFollowRef.current !== followKey;
    prevFollowRef.current = followKey;
    const jumped = jumpedRef.current;
    jumpedRef.current = false;
    if (!changed || jumped || disabled || !ready) return;
    stuckRef.current = true;
    smoothToBottom?.();
  });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // scrollTop уменьшился и мы дальше порога от низа — пользователь ушёл вверх.
    // Рост scrollTop (в том числе промежуточные кадры плавной прокрутки) флаг не гасит.
    let lastTop = el.scrollTop;
    const onScroll = () => {
      const top = el.scrollTop;
      const near = distanceToBottom(el) <= STICK_THRESHOLD_PX;
      if (near) stuckRef.current = true;
      else if (top < lastTop) stuckRef.current = false;
      lastTop = top;
    };
    el.addEventListener('scroll', onScroll, { passive: true });

    if (typeof ResizeObserver === 'undefined') {
      return () => el.removeEventListener('scroll', onScroll);
    }

    // Первая доставка для строки, добавленной уже после старта, — это её
    // появление, а не рост: на неё не реагируем, чтобы новое сообщение
    // по-прежнему приезжало плавно. Дальнейшие изменения размера (догрузилась
    // картинка) — рост, возвращаем низ.
    const observed = new Set<Element>();
    const fresh = new Set<Element>();
    const ro = new ResizeObserver((entries) => {
      let grew = false;
      for (const e of entries) {
        if (fresh.delete(e.target)) continue;
        grew = true;
      }
      if (grew && stuckRef.current && !disabledRef.current) el.scrollTop = el.scrollHeight;
    });
    const watch = (node: Element, isFresh: boolean) => {
      if (observed.has(node)) return;
      observed.add(node);
      if (isFresh) fresh.add(node);
      ro.observe(node);
    };
    const sync = (isFresh: boolean) => {
      for (const node of observed) {
        if (node.parentElement === el) continue;
        ro.unobserve(node);
        observed.delete(node);
        fresh.delete(node);
      }
      for (const child of Array.from(el.children)) watch(child, isFresh);
    };
    ro.observe(el); // ресайз самого контейнера (клавиатура, поворот, показ скрытого экрана)
    sync(false);
    const mo = typeof MutationObserver !== 'undefined' ? new MutationObserver(() => sync(true)) : null;
    mo?.observe(el, { childList: true });

    return () => {
      el.removeEventListener('scroll', onScroll);
      mo?.disconnect();
      ro.disconnect();
    };
  }, [ref, resetKey]);
}
