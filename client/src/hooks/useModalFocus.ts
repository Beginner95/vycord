import { useEffect, useRef, type RefObject } from 'react';

const FOCUSABLE = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

function focusablesIn(container: HTMLElement | null): HTMLElement[] {
  return Array.from(container?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? []).filter(
    (el) => !el.hasAttribute('disabled'),
  );
}

/** Куда встаёт фокус, когда поверхность появляется: `[data-autofocus]`, а если
 *  его нет — первый доступный фокусируемый элемент.
 *
 *  Экспортируется, чтобы CommandPalette при смене хоста портала возвращал фокус
 *  ПО ТОМУ ЖЕ правилу, что и useModalFocus при открытии. Своя копия без запасного
 *  варианта работала бы ровно до того дня, когда `[data-autofocus]` уедет с
 *  инпута: начальный фокус продолжил бы работать, а восстановление после
 *  переезда портала молча стало бы no-op — именно тот отказ, ради которого тот
 *  эффект и существует. */
export function focusInitialIn(container: HTMLElement | null): void {
  const initial =
    container?.querySelector<HTMLElement>('[data-autofocus]') ?? focusablesIn(container)[0];
  initial?.focus();
}

// Стек активных ПОВЕРХНОСТЕЙ: Escape/Tab обрабатывает только верхняя. Вложенные
// модалки реальны (Settings → ConfirmModal выхода) — без стека один Escape
// закрыл бы обе, потому что слушатель нижней зарегистрирован раньше.
//
// M6 T11: стек стал слоёным. Раньше в нём лежали только адоптеры useModalFocus,
// а пять поверхностей (контекстное меню, поповер громкости, два пикера экрана,
// плавающий тулбар выделения) держали СВОИ document-слушатели Escape без всякой
// очерёдности — один Escape закрывал и их, и модалку над ними. Теперь они
// регистрируются здесь же через useEscapeDismiss.
//
// `blocking` отделяет «модальную» поверхность от «лёгкой»: только blocking-слои
// поднимают isBlockingOverlayOpen(). Это сознательно сохраняет сегодняшнее
// поведение гейта — контекстное меню и поповер громкости НЕ должны глушить ⌘K,
// а пикеры экрана глушат (и глушили до этой задачи, через .screen-picker-backdrop
// в селекторе ниже).
//
// ВНИМАНИЕ, стек арбитрирует НЕ ТОЛЬКО Escape. `useModalFocus.onKey` спрашивает
// isTopLayer ДО разбора клавиши, то есть верхний слой забирает и Tab. Значит
// лёгкий слой (useEscapeDismiss), положенный поверх открытой модалки, на своё
// время отключает у неё ЛОВУШКУ TAB, а не только Escape. Сегодня это
// недостижимо — ContextMenu рендерится только из ServerMenu.tsx и
// ChannelSidebar.tsx (ни один не внутри модалки), а поповер громкости и тулбар
// выделения закрываются по mousedown снаружи раньше, чем модалка успеет
// открыться, — но расширение семантики реально, и любой новый вызов
// useEscapeDismiss внутри модалки его разбудит.
interface Layer {
  token: symbol;
  blocking: boolean;
}
const layerStack: Layer[] = [];

function pushLayer(token: symbol, blocking: boolean): void {
  layerStack.push({ token, blocking });
}
function popLayer(token: symbol): void {
  const i = layerStack.findIndex((l) => l.token === token);
  if (i !== -1) layerStack.splice(i, 1);
}
function isTopLayer(token: symbol): boolean {
  return layerStack.length > 0 && layerStack[layerStack.length - 1].token === token;
}

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
    pushLayer(token, true);
    const prev = document.activeElement as HTMLElement | null;
    // containerRef.current читается ЛЕНИВО, а не захватывается один раз. M6 T11
    // научило палитру переезжать порталом в document.fullscreenElement: смена
    // хоста портала пересоздаёт DOM-узлы, эффект при этом не перезапускается
    // (deps — [active, containerRef]), и захваченный container оказался бы
    // отсоединён — focusables() вернул бы [], а container.contains(activeElement)
    // всегда false, то есть ловушка Tab тихо перестала бы работать.
    const containerEl = () => containerRef.current;
    const focusables = () => focusablesIn(containerEl());
    focusInitialIn(containerEl());

    const onKey = (e: KeyboardEvent) => {
      if (!isTopLayer(token)) return; // not the top surface
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
      if (e.shiftKey && (current === first || !containerEl()?.contains(current))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (current === last || !containerEl()?.contains(current))) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(token);
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
      const movedElsewhere = !!cur && cur !== document.body && !containerEl()?.contains(cur);
      if (!movedElsewhere && prev && document.contains(prev)) prev.focus();
    };
  }, [active, containerRef]);
}

/** Escape для НЕмодальных (и полумодальных) поверхностей — через тот же стек.
 *
 *  Пять поверхностей держали собственный `document.addEventListener('keydown')`
 *  и закрывались по любому Escape, включая тот, что предназначался модалке над
 *  ними: ContextMenu, VolumeControlPopover, ScreenSourcePicker,
 *  ScreenQualityPicker, useFloatingSelectionToolbar (M6 T11, шаг 4).
 *
 *  Хук НЕ даёт ловушки Tab, автофокуса и восстановления фокуса — это
 *  сознательно: поповер или контекстное меню, забирающие фокус на себя, увели
 *  бы каретку из композера. Нужен полный модальный контракт — берите
 *  useModalFocus.
 *
 *  Но «не даёт ловушки Tab» не значит «Tab не трогает». Слой этого хука, лёгший
 *  ПОВЕРХ открытой модалки, на своё время отключает ловушку Tab у неё:
 *  useModalFocus проверяет isTopLayer до разбора клавиши и выходит из обработчика
 *  для Tab так же, как для Escape. Не вызывайте этот хук из поверхности,
 *  живущей ВНУТРИ модалки, — см. развёрнутое замечание у layerStack выше.
 *
 *  `blocking` по умолчанию false. Поднимать его должна только поверхность,
 *  которая и раньше глушила глобальные хоткеи: `.screen-picker-backdrop`.
 *  blocking по умолчанию тихо заставил бы контекстное меню глушить ⌘K.
 *
 *  onEscape живёт в ref, а deps — только [active, blocking]: у ContextMenu
 *  колбэк пересоздаётся на каждом рендере родителя, и подписка с deps [onEscape]
 *  снимала бы и заново клала токен НАВЕРХ стека, перехватывая Escape у модалки
 *  над меню. */
export function useEscapeDismiss(
  active: boolean,
  onEscape: () => void,
  blocking = false,
): void {
  const onEscapeRef = useRef(onEscape);
  onEscapeRef.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const token = Symbol('layer');
    pushLayer(token, blocking);
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (!isTopLayer(token)) return;
      onEscapeRef.current();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      popLayer(token);
    };
  }, [active, blocking]);
}

/** Открыт ли сейчас блокирующий оверлей. Нужен глобальным хоткеям: ⌘K не
 *  должен открывать палитру поверх модалки (решение 8), а Ctrl+Shift+F —
 *  переключать панель поиска под оверлеем (решение 11).
 *
 *  Тройная проверка не избыточна. Стек знает только про адоптеров useModalFocus
 *  — а это ровно ConfirmModal, FindServerModal, Settings, CommandPalette и
 *  MediaLightbox; остальные восемь модалок приложения к нему не подключены
 *  (адоптация app-wide — отдельный бэклог-пункт, см. ниже).
 *  `.modal-overlay` рисуют ВСЕ адоптеры примитива, включая саму палитру, — что
 *  заодно даёт «только открывает» без отдельного флага.
 *  `.screen-picker-backdrop` (ScreenSourcePicker/ScreenQualityPicker) — третий,
 *  отдельный случай: это системная модальная поверхность (fixed inset + scrim +
 *  blur, `--z-popover`), но она сознательно НЕ надета на примитив
 *  `.modal-overlay` (унаследовала бы его `--z-overlay`, flex-центрирование и
 *  анимацию поверх source-order-конфликта той же специфичности).
 *  Без неё в селекторе гейт был бы false, пока пикер экрана открыт — что
 *  реально достижимо на обеих платформах (CallStage.tsx: неэлектронная ветка
 *  шаринга экрана и electron-ветка после выбора источника).
 *  `.p2p-overlay.is-incoming` (CallUI.tsx:165) — четвёртый случай, найденный на
 *  ревью M6 T11: входящий 1:1-звонок кладёт var(--scrim) + blur(6%) поверх всего
 *  приложения, но живёт на `position: fixed; inset: 40px 0 0` (40px — под
 *  TitleBar) и примитив не носит. До этой правки ⌘K открывал палитру ПОВЕРХ
 *  входящего звонка (--z-palette 1150 над --z-overlay 1000), а Ctrl+Shift+F
 *  переключал поиск под ним.
 *  Гейт называет именно СОСТОЯНИЕ `.is-incoming`, а не базовое `.p2p-overlay`:
 *  `.p2p-overlay.is-active` — это вид активного звонка, скрима у него нет, и
 *  глушить над ним ⌘K было бы изменением поведения, которого никто не просил.
 *  На примитив он не переводится сознательно: `.modal-overlay` навязал бы
 *  inset: 0, центрирование, blur и fade-in — то есть сдвинул и перекрасил бы
 *  оверлей.
 *
 *  ЧЕГО ЭТА ФУНКЦИЯ НЕ ГАРАНТИРУЕТ (M6 T11, шаг 3). DOM-половина держится на
 *  СОГЛАШЕНИИ «каждый блокирующий scrim носит .modal-overlay», а не на
 *  контракте, и соглашение уже ломали дважды. Соглашение теперь проверяется
 *  статически — `src/styles/__tests__/overlay-scrim-contract.test.ts` падает,
 *  если в CSS появился третий fixed-inset scrim без `.modal-overlay`.
 *  Но эта проверка закрывает ровно ПОЛОВИНУ дыры: контрфактический замер CF-4b
 *  (M5.5) показал, что при снятом вызове useModalFocus и сохранённом классе
 *  гейт ниже продолжает возвращать true — класса достаточно. То есть ни гейт,
 *  ни проверка scrim'ов не поймают модалку без Escape/ловушки Tab. Это и есть
 *  оставшийся бэклог-пункт: app-wide адоптация useModalFocus. */
export function isBlockingOverlayOpen(): boolean {
  return (
    layerStack.some((l) => l.blocking) ||
    document.querySelector(
      '.modal-overlay, .screen-picker-backdrop, .p2p-overlay.is-incoming',
    ) !== null
  );
}
