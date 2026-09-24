# VYC-95 — этап 4: звонки. План реализации

> **Для агентов:** ОБЯЗАТЕЛЬНЫЙ САБ-СКИЛЛ: superpowers:subagent-driven-development.
> Шаги помечены чекбоксами (`- [ ]`).

**Цель:** заменить смонтированный на этапе 1 десктопный `CallStage` (в экране
`call`) настоящим мобильным экраном группового звонка (сетка/фокус/PiP, нижняя
панель с подписями, «⋯»-шторки: гости, демонстрация, качество, громкость
участников, динамик), дать `CallPill` заменить `CallDock` на мобиле, а p2p
(`CallUI`) и `CallNotifBanner` — мобильную CSS-раскладку. Десктоп не меняется
ни на пиксель.

**Архитектура:** `CallStage.tsx` разрезается на `useCallStageModel()` (всё
состояние/эффекты/обработчики — рефы на видео, фуллскрин, экранка, лобби,
качество, громкость) + презентационные плитки в `src/components/call/`
(`ConnectionIndicator`, `StageTimer`, `RemoteParticipantTile`). Десктопный
`CallStage` становится тонкой компоновкой поверх хука с **тем же DOM**,
проверяемым файловыми снимками (по образцу этапа 3). Новый экран
`MobileCallScreen` использует тот же хук и те же плитки, но свою раскладку
(`mobileGridLayout`) и свою панель. `GuestInvitePopover` и `ScreenQualityPicker`
получают `*Body`-компоненты (паттерн этапа 3: `ExpressionBody`), которые
мобильные шторки оборачивают в `BottomSheet`; десктопные поповеры используют те
же `*Body` без изменений своего DOM. `CallUI` (p2p) и `CallNotifBanner`
получают **только CSS**-раскладку под `< 900px` — их TSX не меняется вовсе
(спека §6.4: «Логика не меняется»).

**Стек:** React 19, TypeScript, Zustand 5, react-router-dom 7, Vitest 4 +
@testing-library/react, lucide-react, обычный CSS на компонент.

**Спека:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`
(§1 таблица швов, §6, §9 этап 4; строки покрытия 20 (остаток), 37, 45–64, 88–89
не относятся — только 45–64).

**Предыдущий этап:** `docs/superpowers/plans/2026-09-20-mobile-stage3-chat.md`
(закоммичен, `1b42c40`).

## Global Constraints

- **Десктоп (≥ 900px) не меняется ни на пиксель и ни на узел DOM.** Любая
  правка в `src/components/CallStage.tsx`/`CallUI.tsx`/`CallDock.tsx`/
  `CallNotifBanner.tsx`/`GuestInvitePopover.tsx`/`ScreenSharePicker.tsx` —
  либо чистый вынос кода без смены порядка/классов узлов, либо CSS **только**
  внутри `@media (width < 900px)`. Гарантия: файловые снимки DOM из T1
  остаются зелёными на КАЖДОЙ задаче, затрагивающей `CallStage.tsx`/`CallUI.tsx`;
  T9 — скриншоты 1280×800 против нетронутого оригинала.
- **Один брейкпоинт.** Новые CSS-файлы под `src/mobile/` не содержат
  `@media (width …)` вообще (рендерятся только на мобиле); правила под
  `.mobile-call-screen`/`.call-pill` и т.п. классами-предками не нуждаются в
  медиа-условии — этих классов не существует на десктопе. Новые блоки в
  `CallUI.css`/`CallNotifBanner.css` — сразу `@media (width < 900px)` (не
  `<= 768px`): это НОВЫЕ блоки, а не перевод легаси, allowlist не трогаем.
  `CallStage.css`'ные блоки `<= 768px`/`<= 640px` (6+1, из
  `breakpoint-contract.test.ts`) **не трогаем** — они станут мёртвыми, когда
  `MobileCallScreen` заменит `CallStage` в экране `call` (T7), и это
  фиксируется в «Этап 4 — отложено» (зачистка — этап 7), а не переводится.
- **Токены только ролевые.** Ни одного literal-цвета вне `tokens.css`. Радиусы
  — из шкалы (`--radius-chip|row|btn|card|tile|composer|modal|bar|pill`), 12px
  в шкале нет. Анимации — `--transition` / `--ease-out` +
  `@media (prefers-reduced-motion: reduce)`.
- **Иконки** — lucide, явный `size` и `strokeWidth={1.8}`.
- **Классы** — `component-thing` / `is-*`, без числовых z-index, без новых
  систем оверлеев: только `.modal-overlay` + `useModalFocus` (шторки —
  `BottomSheet`/`ActionSheet` этапа 1).
- **`var(--x, fallback)` только там, где это оговорено** (`--keyboard-inset`).
- **i18n:** ни одной пользовательской строки в коде. Новые ключи — в оба
  `src/i18n/locales/ru.ts` и `en.ts`, в секцию `call:` (переиспользуемые с
  десктопом понятия — те же ключи, что уже есть) или `mobile:` (новые, чисто
  мобильные строки — панель, «⋯», шторки). Гейт: `npm run check:i18n`.
- **Тач-цели ≥ 44×44** (панель звонка — 56×56 по спеке §6.2, что превышает
  минимум сознательно — крупные цели в стрессовом UI звонка).
- **Гейты (из `client/`):** `npx tsc --noEmit` — exit 0, ноль байт;
  `npx stylelint "src/**/*.css"` — exit 0, ноль байт; `npm run check:i18n` —
  «непереведённых строк не найдено.»; `npm test` — ровно 3 падения, все в
  `api.network-retry.test.ts`. **Этот файл не чинить.** **Скрипты гейтов и
  конфиги не править.**
- **Коммиты и пуши делает пользователь.** Исполнители НЕ выполняют
  `git commit`, `git add`, `git push`, `git stash`, не мёржат и не ребейзят.
  Никогда не добавлять Claude как co-author.
- **Никогда `git add -A` / `git add .`**.
- Все `npm` / `npx` / `node` — из `client/`. Dev-сервер — `npm run dev:vite`.
- **Снимки DOM никогда не обновлять** (`vitest -u`, `--update` запрещены).
- **Electron недостижим на мобильной оболочке** (`minWidth: 900`, спека §0) —
  мобильный код никогда не проверяет `window.electronAPI`; источник экрана
  (`ScreenSourcePicker`) и Electron-ветка `getScreenSources` мобиле не нужны,
  только браузерный `getDisplayMedia` (feature-detect).

## Решения этого плана (приняты автором плана, менять только с обоснованием)

- **D1. Граница шва `CallStage`.** `useCallStageModel({ onLeave })` в
  `src/components/useCallStageModel.ts` (рядом с `useMemberList.ts` этапа 3 —
  тот же прецедент: общий хук лежит рядом с десктопным компонентом, откуда
  вынесен, а не в `src/hooks/` или `src/mobile/`). Хук отдаёт ВСЁ состояние,
  рефы на `<video>` и обработчики; JSX (десктопный `CallStage` и новый
  `MobileCallScreen`) сами решают, как это расположить и в каком виде смонтировать
  `<video>`-элементы на свои рефы. `ConnectionIndicator`, `StageTimer`,
  `RemoteParticipantTile` переезжают в `src/components/call/*.tsx` как есть
  (те же классы `.stage-conn`/`.stage-tip`/`.stage-tile`/`.stage-thumb` — их
  стили остаются в `CallStage.css`, которая продолжает грузиться глобально,
  потому что `CallStage.tsx` всегда в бандле десктопной оболочки). Хук и
  плитки без правок мобилизируются `MobileCallScreen` (T7) вместе с этими же
  стилями — мобильная CSS (T7) добавляет только **другую геометрию** под
  предком `.mobile-call-screen`, не переопределяя `.stage-tile` глобально.
- **D2. `useCallStageModel` — механический вынос, без переписывания.**
  Реализация — построчный перенос из `CallStage.tsx` (эффекты фуллскрина,
  ватчер экранки, подгрузка имён, обработчики мьюта/видео/шаринга/громкости,
  ошибки, `mediaWarning`) в хук; комментарии (включая ruling'и M6/T4-e про
  Electron-фуллскрин) переносятся вместе с кодом, который они объясняют —
  это тот же код, просто в другом файле. Мобильный `getScreenSources`/
  `api?.toggleFullscreen`-ветки Electron остаются в хуке НЕТРОНУТЫМИ (общий
  код с десктопом) — `MobileCallScreen` их просто никогда не проверяет
  (Constraints: Electron недостижим на мобиле), а не потому что хук их прячет.
- **D3. Плитки в сетке звонка — общий компонент, разная геометрия.**
  `MobileCallScreen` рендерит те же `<RemoteParticipantTile layout="grid">` /
  `"thumbnail"`, что и десктоп; `mobileGridLayout(count, orientation)` решает
  только `grid-template-columns` и включённость прокрутки — сам компонент
  плитки не меняется. Это описано в §6.1 явно («Плитки → src/components/call/»
  без разделения на desktop/mobile варианты).
- **D4. PiP — только на групповой сетке, не в p2p.** Спека §6.2 просит
  перетаскиваемый PiP «своей» плитки при ≥2 участников на экране `call`
  (групповой звонок). §6.4 для p2p (`CallUI`) говорит только «CSS-раскладка по
  правилам §6.2 (вертикальная, PiP, нижняя панель)» — читаем как «тот же
  визуальный язык» (маленькое превью поверх собеседника), а не «тот же
  перетаскиваемый компонент»: у p2p ровно одна локальная плитка и никогда не
  бывает выбора угла. `CallUI.tsx` остаётся без правок (Constraints), PiP там
  — фиксированный CSS-угол, без перетаскивания.
- **D5. «⋯»-меню — шесть пунктов, три ведут к готовым `*Body`.** Пригласить/
  «Гости в звонке» (спека, строки 62 и 64) открывают ОДНУ шторку
  (`GuestInviteBody` уже показывает и выпуск ссылки, и список гостей с кик —
  десктопный `GuestInvitePopover` их не разделяет, см. его код). Пункт виден,
  когда `guestLinksEnabled && !isGuestMode`, ИЛИ когда `channelGuests` канала
  не пусты (гостя, зашедшего до отключения ссылок, всё ещё можно выгнать).
  Демонстрация экрана — виден только при `'getDisplayMedia' in navigator.mediaDevices`;
  качество и громкость участников — всегда.
- **D6. Качество связи — один sheet, два входа.** Тап по индикатору в шапке
  (строка 53) и пункт «Качество связи» в «⋯» открывают ОДИН И ТОТ ЖЕ
  `CallQualitySheet`, показывающий `model.localQuality` (свой аплинк — то же,
  что десктопный тултип `ConnectionIndicator` показывает по наведению).
- **D7. Динамик — `setSinkId`, кнопка на самой панели (не в «⋯»).** Спека
  перечисляет кнопки панели явно: «Микрофон · Камера · Динамик · Чат · «⋯» ·
  Выйти». Поведение (спека не детализирует «переключает на что именно»):
  кнопка циклически переключает `navigator.mediaDevices.enumerateDevices()`
  устройства `kind === 'audiooutput'` (порядок как отдаёт браузер, с
  «дефолтным» первым), применяя `setSinkId` ко всем текущим удалённым
  `<video>`. Скрыта, если `!('setSinkId' in HTMLMediaElement.prototype)`
  (спека: «при наличии (Android Chrome), иначе скрыт»). `title`/`aria-label`
  — название текущего устройства (или `call.speakerDefault`, если `label`
  пуст — часто из-за отсутствия разрешения на перечисление меток).
- **D8. Экран `call` в стеке не свайпается назад.** Уже верно на этапе 1
  (`enabled: !root && nav.top.kind !== 'call'` в `MobileShell.tsx`) — этап 4
  ничего не меняет в этом контракте, только явно подтверждает пробой в T9.
- **D9. `CallPill` — один инстанс в `MobileShell`, без свайпа.** Заменяет
  `CallDock` (та же точка монтирования: сиблинг `.mobile-stage`/`TabBar`) —
  видна ВСЕГДА, кроме `nav.top.kind === 'call'`; класс `.is-root` (над
  таб-баром, как раньше `CallDock`) против `.is-stacked` (`position: fixed`,
  `top: calc(env(safe-area-inset-top) + 56px)` — 56px это `min-height`
  `.screen-header`, спека сама не даёт пиксель, это первая непротиворечивая
  величина). Перекрытие верхней части контента на некорневых экранах —
  осознанный компромисс (как у Telegram/Discord мобильных клиентов);
  визуально подтверждается T9 и правится там, если наедет на что-то важное
  (жёсткого требования «не перекрывать» спека не даёт).
- **D10. `.mobile-screen > .call-stage` селектор в `MobileShell.css` — снести.**
  Строка была нужна только пока `call` монтировал десктопный `CallStage`
  напрямую (этап 1); с T7 это больше не происходит. `.chat-area`/`.home-view`
  в том же правиле остаются — их всё ещё используют этапы 5+.

## Структура файлов

**Создаются:**

| Файл | Ответственность |
|---|---|
| `src/components/__tests__/callHarness.tsx`, `CallStage.dom.test.tsx`, `CallUI.dom.test.tsx` + `__snapshots__/*.html` | T1: снимки DOM десктопа, снятые ДО правок |
| `src/components/useCallStageModel.ts` + `__tests__/useCallStageModel.test.ts` | T2: вынесенное состояние/обработчики звонка |
| `src/components/call/ConnectionIndicator.tsx`, `StageTimer.tsx`, `RemoteParticipantTile.tsx` | T2: презентационные плитки (вынос без изменений) |
| `src/utils/callStage.ts` (правка) + `callStage.test.ts` (правка) | T3: `mobileGridLayout(count, orientation)` |
| `src/mobile/gestures/pinchZoom.ts`, `usePinchZoom.ts` + `__tests__/pinchZoom.test.ts` | T4: чистое решение зума + хук |
| `src/mobile/screens/MobileCallScreen.tsx` + `.css` + `__tests__/MobileCallScreen.test.tsx` | T5: экран `call` |
| `src/mobile/hooks/useAudioOutput.ts` + `__tests__/useAudioOutput.test.ts` | T6: циклический выбор устройства вывода |
| `src/components/GuestInviteBody.tsx` | T6: тело `GuestInvitePopover` без поверхности |
| `src/components/ScreenQualityBody.tsx` | T6: тело `ScreenQualityPicker` без поверхности |
| `src/mobile/call/useCallOverflowItems.ts` + `.test.ts` | T6: пункты «⋯»-шторки |
| `src/mobile/call/CallQualitySheet.tsx`, `CallVolumeSheet.tsx`, `MobileGuestSheet.tsx`, `MobileScreenQualitySheet.tsx` (+ тесты) | T6: содержимое подшторок |
| `src/mobile/components/CallPill.tsx` + `.css` + `__tests__/CallPill.test.tsx` | T7: замена `CallDock` на мобиле |
| тесты рядом с каждым модулем (см. задачи) | |

**Меняются:** `src/components/CallStage.tsx` (+ `.css` не трогается),
`src/components/CallUI.css` (только новый `@media` блок), `CallNotifBanner.css`
(только новый `@media` блок), `src/components/GuestInvitePopover.tsx`,
`src/components/ScreenSharePicker.tsx`, `src/mobile/MobileShell.tsx` + `.css`,
`src/mobile/screens/renderScreen.tsx`, `src/i18n/locales/{ru,en}.ts`,
`docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`.

**Порядок задач важен:** T1 (снимки) → T2 (модель + плитки) → T3
(`mobileGridLayout`) → T4 (`usePinchZoom`) → T5 (`MobileCallScreen`, ядро) →
T6 («⋯»-шторки и звук) → T7 (`CallPill` + сшивка `renderScreen`) → T8 (p2p +
баннер, CSS) → T9 (приёмка).

---

### Task 1: снимки DOM десктопа с нетронутого кода

**Файлы:**
- Создать: `client/src/components/__tests__/callHarness.tsx`
- Создать: `client/src/components/__tests__/CallStage.dom.test.tsx`
- Создать: `client/src/components/__tests__/CallUI.dom.test.tsx`
- Создаются тестами: `client/src/components/__tests__/__snapshots__/CallStage.*.html`, `CallUI.*.html`

**Интерфейсы:**
- Потребляет: ничего (`src/components/CallStage.tsx`/`CallUI.tsx` НЕ трогать
  — задача снимает их как есть).
- Производит: `callHarness.tsx` — `stubBrowser()`, фикстуры участников/
  каналов/сторов; их берёт T2 при ручной сверке (снимки сравниваются
  файлово тестом, а не читаются implementer'ом заново).

Цель: зафиксировать DOM `CallStage`/`CallUI` ДО разреза на хук, чтобы T2
проверялась diff'ом снимка, а не глазами.

- [ ] **Шаг 1: прочитать нужное.** `src/components/CallStage.tsx` целиком,
  `src/components/CallUI.tsx` целиком, `src/stores/callStore.ts` (форма
  состояния и `join`/`leave`/`reset`), `src/components/__tests__/chatHarness.tsx`
  и `ChatArea.dom.test.tsx` этапа 3 — как устроены `stubBrowser`/`toMatchFileSnapshot`
  в этом репо.

- [ ] **Шаг 2: `callHarness.tsx`.**

```tsx
import { vi } from 'vitest';
import type { RemoteParticipant } from '@/stores/callStore';

export function stubBrowser(): void {
  process.env.TZ = 'UTC';
  window.matchMedia = vi.fn((q: string) => ({
    matches: false, media: q, addEventListener() {}, removeEventListener() {},
  })) as unknown as typeof window.matchMedia;
  // CallStage измеряет getBoundingClientRect для тултипов/поповеров — jsdom
  // возвращает нули по умолчанию, этого достаточно (снимок не зависит от чисел).
  Element.prototype.requestFullscreen = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(document, 'fullscreenElement', { value: null, configurable: true, writable: true });
  HTMLMediaElement.prototype.play = vi.fn().mockResolvedValue(undefined);
}

export function participant(userId: string, over: Partial<RemoteParticipant> = {}): RemoteParticipant {
  return { userId, stream: null, ...over };
}
```

- [ ] **Шаг 3: `CallStage.dom.test.tsx`.**

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from 'vitest';
import { render, cleanup, act } from '@testing-library/react';
import { CallStage } from '../CallStage';
import { useAuthStore } from '@/stores/authStore';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { stubBrowser, participant } from './callHarness';

vi.mock('@/services/groupCall', () => ({
  groupCallService: { localStreamState: null, screenStreamState: null, toggleMuteAudio: vi.fn(), toggleMuteVideo: vi.fn(), stopScreenShare: vi.fn(), startScreenShare: vi.fn(), watchShare: vi.fn(), unwatchShare: vi.fn() },
}));
vi.mock('@/services/callBus', () => ({ callBus: { send: vi.fn(), on: vi.fn(() => () => {}) } }));
vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return { ...actual, apiService: { ...actual.apiService, getUserById: vi.fn(async () => ({ id: 'u2', username: 'boris' })) } };
});

beforeAll(stubBrowser);
beforeEach(() => {
  useAuthStore.setState({ user: { id: 'u1', username: 'anna' } as never });
  useServerStore.setState({ servers: [{ id: 's1', guest_links_enabled: true } as never] });
  useCallStore.setState({
    callChannelId: 'c1', callChannelName: 'general', callServerId: 's1', status: 'connected',
    startedAt: Date.now(), isMuted: false, isVideoOff: true, isMicAvailable: true,
    participants: [participant('u2'), participant('u3')], directory: {}, guestSelf: null,
  });
});
afterEach(() => { cleanup(); useCallStore.getState().reset(); });

const snap = (name: string) => expect(document.body.innerHTML).toMatchFileSnapshot(`./__snapshots__/CallStage.${name}.html`);

describe('CallStage DOM (desktop parity, снято до VYC-95 этапа 4)', () => {
  it('grid, 2 remote participants', async () => { render(<CallStage />); await act(async () => {}); await snap('grid'); });
  it('reconnecting', async () => { useCallStore.setState({ status: 'reconnecting' }); render(<CallStage />); await snap('reconnecting'); });
  it('focused participant', async () => { useCallStore.setState({ focusedUserId: 'u2' }); render(<CallStage />); await snap('focused'); });
  it('screen sharing self', async () => { useCallStore.setState({ isScreenSharing: true }); render(<CallStage />); await snap('sharing'); });
  it('solo (no remote participants)', async () => { useCallStore.setState({ participants: [] }); render(<CallStage />); await snap('solo'); });
});
```

  Довести до зелёного, добавляя заглушки в `callHarness.stubBrowser` по одной
  (та же дисциплина, что этап 3 T1) — не трогая `CallStage.tsx` ни для чего,
  кроме диагностики (откатить любую случайную правку перед снимком).

- [ ] **Шаг 4: `CallUI.dom.test.tsx`** — аналогично, через
  `window.dispatchEvent(new CustomEvent('discrod:incoming_call', { detail: {...} }))`
  и `'discrod:call_started'` (события, которые слушает `CallUI`, см. файл) для
  входящего/активного состояния; мокнуть `@/services/call` (`callService.init`,
  `localStreamState`), `@/services/audio`, `@/services/websocket` аналогично
  `CallStage`. Состояния: `incoming`, `active` (с `remoteStream`), `active +
  remoteMuted`.

- [ ] **Шаг 5: прогнать `npx vitest run src/components/__tests__/Call*.dom.test.tsx`**
  — зелёные, снимки записаны. `git status --short client/src/components/__tests__/`
  — только новые файлы.

- [ ] **Отчёт:** DONE, список снятых снимков, что потребовалось в `stubBrowser`.

---

### Task 2: `useCallStageModel` и `src/components/call/*`

**Файлы:**
- Создать: `client/src/components/useCallStageModel.ts`
- Создать: `client/src/components/useCallStageModel.test.ts` (только чистые
  части — форматирование, производные булевы; полный цикл эффектов уже
  покрыт T1's DOM-тестами транзитивно через `CallStage`)
- Создать: `client/src/components/call/ConnectionIndicator.tsx`
- Создать: `client/src/components/call/StageTimer.tsx`
- Создать: `client/src/components/call/RemoteParticipantTile.tsx`
- Изменить: `client/src/components/CallStage.tsx`

**Интерфейсы:**
- Потребляет: ничего нового (те же сторы/сервисы, что уже импортирует
  `CallStage.tsx`).
- Производит:

```ts
// src/components/useCallStageModel.ts
export interface CallStageModel {
  // Идентичность/права
  user: User | null;
  isGuestMode: boolean;
  isInGroupCall: boolean;
  guestLinksEnabled: boolean;
  callChannelId: string | null;
  callChannelName: string | null;
  totalParticipants: number;
  nameFor: (id: string) => string;

  // Состояние звонка (зеркало callStore, для удобства консюмеров)
  status: CallStatus;
  isReconnecting: boolean;
  isMuted: boolean;
  isMicAvailable: boolean;
  isVideoOff: boolean;
  isScreenSharing: boolean;
  participants: RemoteParticipant[];
  screenSharers: Set<string>;
  remoteScreenStreams: Map<string, MediaStream>;
  remoteMicMuted: Map<string, boolean>;
  qualityByUser: Record<string, ConnectionQualityMetrics>;
  localQuality: ConnectionQualityMetrics | undefined;
  focusedUserId: string | null;
  setFocusedUserId: (id: string | null) => void;
  bannerDismissed: boolean;
  dismissBanner: () => void;
  participantVolumes: Record<string, number>;
  volumePopoverUserId: string | null;
  toggleVolumePopover: (userId: string) => void;
  closeVolumePopover: () => void;
  onVolumeChange: (userId: string, value: number) => void;

  // Рефы <video> — консюмер монтирует свои элементы на эти рефы; эффекты
  // хука сами приаттачат стримы, откуда бы ни рендерился элемент.
  localVideoRef: React.RefObject<HTMLVideoElement | null>;
  focusedVideoRef: React.RefObject<HTMLVideoElement | null>;
  setRemoteVideoRef: (userId: string, el: HTMLVideoElement | null) => void;
  stageRef: React.RefObject<HTMLDivElement | null>;
  screenShareMainRef: React.RefObject<HTMLDivElement | null>;

  // Фуллскрин (решение 24 / ruling T4-e — перенесено без изменений)
  fullscreenTarget: 'stage' | 'focus' | null;
  stageFullscreenActive: boolean;
  focusFullscreenActive: boolean;
  fullscreenEl: Element | null;
  handleStageFullscreen: () => Promise<void>;
  handleFocusFullscreen: () => Promise<void>;

  // Обработчики
  handleToggleMute: () => void;
  handleToggleVideo: () => void;
  handleToggleScreenShare: () => Promise<void>;
  handleSelectSource: (sourceId: string) => void;
  handleSelectQuality: (quality: ScreenQuality) => Promise<void>;
  handleLeaveGroupCall: () => void;

  // Экранка: источники (Electron) и пикеры
  screenSources: DesktopCapturerSource[];
  showSourcePickerModal: boolean;
  closeSourcePicker: () => void;
  showQualityPicker: boolean;
  closeQualityPicker: () => void;

  // Приглашение гостя (позиция — десктопный поповер; мобиль игнорирует)
  invitePosition: { top: number; left: number } | null;
  inviteBtnRef: React.RefObject<HTMLButtonElement | null>;
  toggleInvitePopover: () => void;
  closeInvitePopover: () => void;

  // Ошибки/предупреждения
  stageError: string | null;
  setStageError: (msg: string | null) => void;

  micLevel: number;

  // Только для передачи в применение sinkId (D7, T6)
  applySinkId: (deviceId: string) => void;
}

export function useCallStageModel({ onLeave }: { onLeave?: () => void } = {}): CallStageModel;
```

- [ ] **Шаг 1: прочитать весь `CallStage.tsx`** (1257 строк) — уже сделано на
  этапе планирования; исполнитель должен прочитать его тоже, целиком, прежде
  чем резать: нельзя пропустить ни один `useEffect`.

- [ ] **Шаг 2: создать `useCallStageModel.ts`.** Перенести ДОСЛОВНО (тот же
  код, включая все комментарии-ruling'и) из `CallStage.tsx`:
  - Все хуки состояния строк 460–573 (`authUser`…`localQuality`), КРОМЕ
    `invitePosition`/`inviteBtnRef`, которые остаются (тоже переносятся, они
    нужны и десктопу, и мобилу — тип позиции просто не используется мобилом).
  - Все `useEffect` строк 575–743 (attach local/remote streams, fullscreen
    tracking, auto-dismiss toast, media warning funnel, focus attach, watch
    subscription, self-heal retry, clear focus on leave).
  - Все обработчики строк 746–903 (`handleFocusFullscreen` …
    `fetchUsernames`-эффект).
  - `nameFor`, `userCache`/`userCacheRef`/`pendingUserFetchesRef`.
  - Хвостовые производные (`totalParticipants`, `focusedName`, `firstSharer`,
    `showSourcePickerModal`) — как `useMemo` или простые `const` в теле хука
    (пересчитываются на каждый рендер хука, как раньше пересчитывались в теле
    компонента — поведение идентично).

  Добавить НОВОЕ (не было в `CallStage.tsx`):
  ```ts
  const remoteVideoRefsMap = remoteVideoRefs; // уже существует как useRef<Map<...>>
  const setRemoteVideoRef = useCallback((userId: string, el: HTMLVideoElement | null) => {
    if (el) remoteVideoRefsMap.current.set(userId, el);
    else remoteVideoRefsMap.current.delete(userId);
  }, []);
  const applySinkId = useCallback((deviceId: string) => {
    const els = [focusedVideoRef.current, ...remoteVideoRefsMap.current.values()].filter(
      (el): el is HTMLVideoElement => el !== null,
    );
    for (const el of els) {
      const withSink = el as HTMLVideoElement & { setSinkId?: (id: string) => Promise<void> };
      withSink.setSinkId?.(deviceId).catch(() => {});
    }
  }, []);
  ```
  Возвращаемый объект собирает всё перечисленное выше в форму
  `CallStageModel`. `toggleVolumePopover`/`closeVolumePopover`/`onVolumeChange`
  — тонкие обёртки над существующими `setCall({ volumePopoverUserId: … })` /
  `handleVolumeChange` (тот же код, просто с явным именем вместо инлайна в
  JSX).

- [ ] **Шаг 3: вынести презентационные компоненты.**
  `src/components/call/ConnectionIndicator.tsx` — строки 84–241 `CallStage.tsx`
  (весь блок «Connection Indicator», включая `QUALITY_KEY` и функцию
  `enterFullscreen`, если она используется только тут — если используется
  также в хуке, `enterFullscreen` остаётся в `useCallStageModel.ts`, а
  `ConnectionIndicator.tsx` её не импортирует). `StageTimer.tsx` — строки
  248–258. `RemoteParticipantTile.tsx` — строки 260–437 (интерфейс +
  компонент), с импортом `VolumeControlPopover` из `../VolumeControlPopover`
  (относительный путь меняется на `../`, сам компонент не трогается). Каждый
  файл — `export function <Name>(...)` один в один с вырезанным кодом,
  импорты (`useT`, `useMicLevel`, иконки lucide, `Avatar`, типы) — только те,
  что реально нужны вынесенному куску.

- [ ] **Шаг 4: переписать `CallStage.tsx`.** Импортировать
  `useCallStageModel` и три компонента из `./call/*`. Тело функции:
  ```tsx
  export function CallStage({ onMobileBackToChat, onLeave, extraControls }: CallStageProps) {
    const t = useT();
    const tp = useTp();
    const m = useCallStageModel({ onLeave });
    if (!m.isInGroupCall) return null;
    // …тот же JSX, что был (строки 918–1255), с заменой каждой локальной
    // переменной/обработчика на m.<то же имя> — БЕЗ изменения структуры,
    // атрибутов, текста или порядка узлов.
  ```
  Практическая проверка на каждом шаге: после переписывания JSX прогнать T1's
  `CallStage.dom.test.tsx` — зелёный означает побайтовое совпадение.
  `invitePosition`/`inviteBtnRef`/`toggleInvitePopover`/`closeInvitePopover`
  используются здесь как раньше (`m.invitePosition ? m.closeInvitePopover() : …`
  — сохранить оригинальную логику клика на кнопку приглашения дословно, только
  через `m.`).

- [ ] **Шаг 5: `useCallStageModel.test.ts`** — чистые куски, не требующие
  полного DOM-рендера (по образцу `src/utils/callStage.test.ts`): например,
  `applySinkId` не бросает, если рефы пусты; `nameFor` резолвит по
  `directory`/`channelGuests`/`userCache` в нужном порядке (замокать сторы
  через `useCallStore.setState`, вызвать `renderHook`).

- [ ] **Шаг 6: прогнать T1's снимки + гейты.**
  `npx vitest run src/components/__tests__/CallStage.dom.test.tsx` — зелёный,
  `git diff --stat client/src/components/__tests__/__snapshots__/` — пусто.
  `npx tsc --noEmit`, `npx stylelint "src/**/*.css"` (CallStage.css не
  менялась — 0 байт ожидаемо), `npm run check:i18n`, `npm test`.

- [ ] **Отчёт:** DONE, подтверждение, что снимки `CallStage.*.html` не
  изменились (diff пуст), какие файлы созданы/изменены.

---

### Task 3: `mobileGridLayout`

**Файлы:**
- Изменить: `client/src/utils/callStage.ts`
- Изменить: `client/src/utils/callStage.test.ts`

**Интерфейсы:**
- Потребляет: ничего.
- Производит: `mobileGridLayout(count, orientation)`, использует T5
  (`MobileCallScreen`).

Спека §6.2: «Сетка — `mobileGridLayout(count, orientation)` (чистая, TDD):
1 → весь экран; 2 → вертикально (landscape — горизонтально); 3–4 → 2×2;
≥ 5 → 2 колонки с прокруткой».

- [ ] **Шаг 1: написать падающие тесты** в `callStage.test.ts` (файл уже
  существует с тестами `formatCallDuration`/`stageGridClass` — добавить рядом):

```ts
import { mobileGridLayout } from './callStage';

describe('mobileGridLayout', () => {
  it('1 участник — весь экран, без прокрутки', () => {
    expect(mobileGridLayout(1, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
  it('2 участника, портрет — одна колонка (вертикально)', () => {
    expect(mobileGridLayout(2, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
  it('2 участника, пейзаж — две колонки (горизонтально)', () => {
    expect(mobileGridLayout(2, 'landscape')).toEqual({ columns: 2, scroll: false });
  });
  it('3 участника — 2×2, без прокрутки', () => {
    expect(mobileGridLayout(3, 'portrait')).toEqual({ columns: 2, scroll: false });
  });
  it('4 участника — 2×2, без прокрутки', () => {
    expect(mobileGridLayout(4, 'portrait')).toEqual({ columns: 2, scroll: false });
  });
  it('5 участников — 2 колонки, с прокруткой', () => {
    expect(mobileGridLayout(5, 'portrait')).toEqual({ columns: 2, scroll: true });
  });
  it('12 участников, пейзаж — тоже 2 колонки, прокрутка', () => {
    expect(mobileGridLayout(12, 'landscape')).toEqual({ columns: 2, scroll: true });
  });
  it('0 участников — как 1 (не бывает в звонке без себя, защитный случай)', () => {
    expect(mobileGridLayout(0, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
});
```

- [ ] **Шаг 2: прогнать, убедиться, что падают** (`mobileGridLayout` не
  экспортируется): `npx vitest run src/utils/callStage.test.ts`.

- [ ] **Шаг 3: реализация** в `callStage.ts`:

```ts
export interface MobileGridLayout {
  columns: number;
  scroll: boolean;
}

/** Board §6.2: 1 → весь экран; 2 → вертикально (портрет) / горизонтально
 *  (пейзаж); 3–4 → 2×2; ≥5 → 2 колонки с прокруткой. */
export function mobileGridLayout(count: number, orientation: 'portrait' | 'landscape'): MobileGridLayout {
  const n = Math.max(1, count);
  if (n <= 1) return { columns: 1, scroll: false };
  if (n === 2) return { columns: orientation === 'landscape' ? 2 : 1, scroll: false };
  if (n <= 4) return { columns: 2, scroll: false };
  return { columns: 2, scroll: true };
}
```

- [ ] **Шаг 4: прогнать снова** — зелёные.

- [ ] **Шаг 5: гейты.** `npx tsc --noEmit`, `npm test`.

- [ ] **Отчёт:** DONE, `npx vitest run src/utils/callStage.test.ts` — все
  тесты (старые + новые) зелёные.

---

### Task 4: `usePinchZoom`

**Файлы:**
- Создать: `client/src/mobile/gestures/pinchZoom.ts`
- Создать: `client/src/mobile/gestures/usePinchZoom.ts`
- Создать: `client/src/mobile/gestures/__tests__/pinchZoom.test.ts`

**Интерфейсы:**
- Потребляет: ничего (те же принципы, что `lightboxSwipe.ts`/
  `useLightboxSwipe.ts` этапа 3 — чистое решение + тонкий хук).
- Производит: `usePinchZoom()`, использует T5 для просмотра демонстрации в
  фокусе.

Спека §6.2: «`usePinchZoom` (двумя пальцами, двойной тап — сброс; TDD) на
видео, `touch-action: none` на нём при активном зуме».

- [ ] **Шаг 1: прочитать `src/mobile/gestures/lightboxSwipe.ts` и
  `useLightboxSwipe.ts`** — тот же файл-пара паттерн (чистая функция решения
  + хук на пойнтер-событиях) переиспользуется здесь.

- [ ] **Шаг 2: падающие тесты решения** (`pinchZoom.test.ts`):

```ts
import { describe, it, expect } from 'vitest';
import { pinchZoomReducer, type PinchZoomState } from '../pinchZoom';

const idle: PinchZoomState = { scale: 1, x: 0, y: 0 };

describe('pinchZoomReducer', () => {
  it('два пальца раздвигаются — увеличение пропорционально дистанции', () => {
    const next = pinchZoomReducer(idle, { type: 'pinch', startDist: 100, dist: 200, midX: 0, midY: 0 });
    expect(next.scale).toBeCloseTo(2, 5);
  });
  it('масштаб зажат в [1, 4]', () => {
    const huge = pinchZoomReducer(idle, { type: 'pinch', startDist: 100, dist: 1000, midX: 0, midY: 0 });
    expect(huge.scale).toBe(4);
    const shrink = pinchZoomReducer({ scale: 2, x: 0, y: 0 }, { type: 'pinch', startDist: 100, dist: 10, midX: 0, midY: 0 });
    expect(shrink.scale).toBeGreaterThanOrEqual(1);
  });
  it('scale=1 после pinch до <1 сбрасывает смещение в 0', () => {
    const next = pinchZoomReducer({ scale: 2, x: 40, y: 40 }, { type: 'pinch', startDist: 100, dist: 50, midX: 0, midY: 0 });
    expect(next).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it('двойной тап сбрасывает в исходное состояние', () => {
    expect(pinchZoomReducer({ scale: 3, x: 50, y: -20 }, { type: 'doubleTap' })).toEqual(idle);
  });
  it('reset — то же, что двойной тап', () => {
    expect(pinchZoomReducer({ scale: 3, x: 50, y: -20 }, { type: 'reset' })).toEqual(idle);
  });
  it('pan сдвигает x/y только когда scale > 1', () => {
    expect(pinchZoomReducer(idle, { type: 'pan', dx: 30, dy: 10 })).toEqual(idle);
    expect(pinchZoomReducer({ scale: 2, x: 0, y: 0 }, { type: 'pan', dx: 30, dy: 10 })).toEqual({ scale: 2, x: 30, y: 10 });
  });
});
```

- [ ] **Шаг 3: реализация `pinchZoom.ts`.**

```ts
export interface PinchZoomState {
  scale: number;
  x: number;
  y: number;
}

export type PinchZoomEvent =
  | { type: 'pinch'; startDist: number; dist: number; midX: number; midY: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'doubleTap' }
  | { type: 'reset' };

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const IDLE: PinchZoomState = { scale: 1, x: 0, y: 0 };

/** Чистая машина состояния зума видео демонстрации (спека §6.2). midX/midY
 *  зарезервированы для будущего зума «от точки», сейчас не используются —
 *  зум всегда от центра, а pan двигает изображение отдельным жестом. */
export function pinchZoomReducer(state: PinchZoomState, event: PinchZoomEvent): PinchZoomState {
  switch (event.type) {
    case 'pinch': {
      const ratio = event.startDist > 0 ? event.dist / event.startDist : 1;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * ratio));
      if (scale <= MIN_SCALE) return IDLE;
      return { ...state, scale };
    }
    case 'pan':
      if (state.scale <= MIN_SCALE) return state;
      return { ...state, x: state.x + event.dx, y: state.y + event.dy };
    case 'doubleTap':
    case 'reset':
      return IDLE;
    default:
      return state;
  }
}

export { IDLE as PINCH_ZOOM_IDLE };
```

  (Примечание для исполнителя: тест «два пальца раздвигаются» вызывает
  `pinchZoomReducer` с `startDist:100, dist:200` из `idle` — `ratio=2`,
  `scale = 1*2 = 2` — тест ожидает `2`, совпадает.)

- [ ] **Шаг 4: `usePinchZoom.ts`** — хук на пойнтер-событиях по образцу
  `useLightboxSwipe.ts`:

```tsx
import { useCallback, useMemo, useRef, useState } from 'react';
import { pinchZoomReducer, PINCH_ZOOM_IDLE, type PinchZoomState } from './pinchZoom';

interface Point { id: number; x: number; y: number }

export interface PinchZoomHandlers {
  onPointerDown(e: React.PointerEvent): void;
  onPointerMove(e: React.PointerEvent): void;
  onPointerUp(e: React.PointerEvent): void;
  onPointerCancel(e: React.PointerEvent): void;
}

/** Двумя пальцами — зум/пан; двойной тап — сброс. `touch-action: none`
 *  консюмер ставит сам на элемент, пока `state.scale > 1` (спека §6.2). */
export function usePinchZoom(): { state: PinchZoomState; handlers: PinchZoomHandlers; reset: () => void } {
  const [state, setState] = useState<PinchZoomState>(PINCH_ZOOM_IDLE);
  const points = useRef<Map<number, Point>>(new Map());
  const startDist = useRef(0);
  const lastMid = useRef<{ x: number; y: number } | null>(null);
  const lastTap = useRef(0);

  const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
  const mid = (a: Point, b: Point) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

  const reset = useCallback(() => setState(PINCH_ZOOM_IDLE), []);

  const handlers = useMemo<PinchZoomHandlers>(() => ({
    onPointerDown(e) {
      points.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        startDist.current = dist(a, b);
        lastMid.current = mid(a, b);
      } else if (points.current.size === 1) {
        const now = e.timeStamp;
        if (now - lastTap.current < 300) {
          setState((s) => pinchZoomReducer(s, { type: 'doubleTap' }));
        }
        lastTap.current = now;
      }
    },
    onPointerMove(e) {
      if (!points.current.has(e.pointerId)) return;
      points.current.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY });
      if (points.current.size === 2) {
        const [a, b] = [...points.current.values()];
        const d = dist(a, b);
        setState((s) => pinchZoomReducer(s, { type: 'pinch', startDist: startDist.current, dist: d, midX: 0, midY: 0 }));
        startDist.current = d;
      } else if (points.current.size === 1 && lastMid.current) {
        const p = points.current.get(e.pointerId)!;
        setState((s) => pinchZoomReducer(s, { type: 'pan', dx: p.x - lastMid.current!.x, dy: p.y - lastMid.current!.y }));
        lastMid.current = { x: p.x, y: p.y };
      }
    },
    onPointerUp(e) {
      points.current.delete(e.pointerId);
      lastMid.current = null;
    },
    onPointerCancel(e) {
      points.current.delete(e.pointerId);
      lastMid.current = null;
    },
  }), []);

  return { state, handlers, reset };
}
```

- [ ] **Шаг 5: прогнать `pinchZoom.test.ts`** — зелёные. Хук не тестируется
  напрямую в этой задаче (потребует полноценного pointer-events рендера) —
  его поведение проверяется в T5's `MobileCallScreen.test.tsx` через прямой
  вызов `pinchZoomReducer`-путей и в T9's пробе через CDP.

- [ ] **Шаг 6: гейты.** `npx tsc --noEmit`, `npm test`.

- [ ] **Отчёт:** DONE, путь к обоим файлам, число тестов.

---

### Task 5: `MobileCallScreen`

**Файлы:**
- Создать: `client/src/mobile/screens/MobileCallScreen.tsx`
- Создать: `client/src/mobile/screens/MobileCallScreen.css`
- Создать: `client/src/mobile/screens/__tests__/MobileCallScreen.test.tsx`
- Изменить: `client/src/i18n/locales/ru.ts`, `en.ts` (секция `mobile:`)

**Интерфейсы:**
- Потребляет: `useCallStageModel` (T2), `ConnectionIndicator`/`StageTimer`/
  `RemoteParticipantTile` из `src/components/call/*` (T2), `mobileGridLayout`
  (T3), `usePinchZoom` (T4).
- Производит: `<MobileCallScreen onBack={() => void} />` — использует T7
  (`renderScreen.tsx`), «⋯»-кнопка — заглушка `onOpenOverflow` до T6 (в этой
  задаче кнопка есть и вызывает пропс, шторка подключается в T6).

Спека §6.2: верх (safe-area) с «свернуть»/названием/таймером/индикатором
качества; плашка «Переподключение…»; баннер демонстрации; сетка/фокус с PiP;
нижняя панель 56px с подписями; предупреждения медиа; лобби гостей.

- [ ] **Шаг 1: прочитать** финальный `CallStage.tsx` (после T2 — тонкая
  компоновка), `src/mobile/components/ScreenHeader.tsx` (не используется тут
  напрямую — верх звонка не `ScreenHeader`, у него своя safe-area плашка, как
  в спеке), `src/mobile/sheets/BottomSheet.tsx`/`ActionSheet.tsx`,
  `client/docs/design-system.md` («safe-area», «touch-цели»).

- [ ] **Шаг 2: `MobileCallScreen.tsx`.**

```tsx
import { useEffect, useRef, useState } from 'react';
import {
  ChevronDown, Mic, MicOff, Video, VideoOff, Speaker, MessageSquare,
  MoreHorizontal, PhoneOff, LayoutGrid, MonitorUp, X,
} from 'lucide-react';
import { useCallStageModel } from '@/components/useCallStageModel';
import { RemoteParticipantTile } from '@/components/call/RemoteParticipantTile';
import { ConnectionIndicator } from '@/components/call/ConnectionIndicator';
import { StageTimer } from '@/components/call/StageTimer';
import { GuestLobbyToast } from '@/components/GuestLobbyToast';
import { Avatar } from '@/components/Avatar';
import { mobileGridLayout } from '@/utils/callStage';
import { usePinchZoom } from '@/mobile/gestures/usePinchZoom';
import { useAudioOutput } from '@/mobile/hooks/useAudioOutput';
import { useT, useTp } from '@/i18n';
import './MobileCallScreen.css';

interface MobileCallScreenProps {
  onBack: () => void;
  onOpenChat: () => void;
  onOpenOverflow: (model: ReturnType<typeof useCallStageModel>) => void;
}

function useOrientation(): 'portrait' | 'landscape' {
  const [o, setO] = useState<'portrait' | 'landscape'>(
    () => (window.matchMedia('(orientation: landscape)').matches ? 'landscape' : 'portrait'),
  );
  useEffect(() => {
    const mq = window.matchMedia('(orientation: landscape)');
    const onChange = () => setO(mq.matches ? 'landscape' : 'portrait');
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return o;
}

export function MobileCallScreen({ onBack, onOpenChat, onOpenOverflow }: MobileCallScreenProps) {
  const t = useT();
  const tp = useTp();
  const m = useCallStageModel();
  const orientation = useOrientation();
  const audioOutput = useAudioOutput(m.applySinkId);
  const pinch = usePinchZoom();
  const pipRef = useRef<HTMLDivElement>(null);
  const [pipCorner, setPipCorner] = useState<'tl' | 'tr' | 'bl' | 'br'>('br');

  if (!m.isInGroupCall) return null;

  const { columns, scroll } = mobileGridLayout(m.totalParticipants, orientation);
  const firstSharer = m.screenSharers.size > 0 ? [...m.screenSharers][0] : null;
  const showSharingBanner = firstSharer && !m.focusedUserId && !m.bannerDismissed;

  const dragPip = (e: React.PointerEvent) => {
    const start = { x: e.clientX, y: e.clientY };
    const onMove = (ev: PointerEvent) => {
      const dx = ev.clientX - start.x;
      const dy = ev.clientY - start.y;
      // Ближайший угол по знаку смещения от точки начала жеста относительно
      // экрана — простая эвристика, без пиксельной математики боксов.
      const right = ev.clientX > window.innerWidth / 2;
      const bottom = ev.clientY > window.innerHeight / 2;
      if (Math.hypot(dx, dy) > 24) setPipCorner(`${bottom ? 'b' : 't'}${right ? 'r' : 'l'}` as typeof pipCorner);
    };
    const onUp = () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  return (
    <div className="mobile-call-screen">
      <div className="mcs-topbar">
        <button type="button" className="mcs-collapse-btn" onClick={onBack} aria-label={t('call.collapseCall')}>
          <ChevronDown size={22} strokeWidth={1.8} />
        </button>
        <div className="mcs-title">
          <span className="mcs-title-name">{m.callChannelName ? `#${m.callChannelName}` : t('call.groupCallTitle')}</span>
          <span className="mcs-title-timer"><StageTimer /></span>
        </div>
        <button
          type="button"
          className="mcs-quality-btn"
          onClick={() => onOpenOverflow(m)}
          aria-label={t('call.qualityLoss')}
        >
          <ConnectionIndicator metrics={m.localQuality} />
        </button>
      </div>

      {m.isReconnecting && <div className="mcs-reconnecting">{t('call.reconnecting')}</div>}

      {showSharingBanner && (
        <div className="mcs-share-banner">
          <MonitorUp size={16} strokeWidth={1.8} />
          <span className="mcs-share-banner-text">{t('call.isSharingScreen', { name: m.nameFor(firstSharer!) })}</span>
          <button type="button" className="mcs-share-banner-btn" onClick={() => m.setFocusedUserId(firstSharer)}>
            {t('call.view')}
          </button>
          <button type="button" className="mcs-share-banner-dismiss" onClick={m.dismissBanner} title={t('call.dismiss')}>
            <X size={14} strokeWidth={1.8} />
          </button>
        </div>
      )}

      {m.stageError && <div className="mcs-toast">{m.stageError}</div>}

      <div className="mcs-body">
        {m.focusedUserId ? (
          <div
            className="mcs-focus"
            style={pinch.state.scale > 1 ? { touchAction: 'none' } : undefined}
            {...pinch.handlers}
            onDoubleClick={pinch.reset}
          >
            <video
              ref={m.focusedVideoRef}
              autoPlay
              playsInline
              className="mcs-focus-video"
              style={{ transform: `translate(${pinch.state.x}px, ${pinch.state.y}px) scale(${pinch.state.scale})` }}
            />
            <button type="button" className="mcs-focus-back" onClick={() => m.setFocusedUserId(null)} title={t('call.backToGrid')}>
              <LayoutGrid size={16} strokeWidth={1.8} />
            </button>
          </div>
        ) : (
          <div
            className={`mcs-grid mcs-grid-cols-${columns}${scroll ? ' is-scroll' : ''}`}
          >
            <div ref={pipRef} className={`mcs-tile mcs-pip is-${pipCorner}`} onPointerDown={dragPip}>
              <video ref={m.localVideoRef} autoPlay playsInline muted className={m.isScreenSharing ? 'is-screen' : 'is-mirrored'} />
              {m.isVideoOff && !m.isScreenSharing && <Avatar username={m.user?.username ?? '?'} url={m.user?.avatar_url ?? undefined} className="mcs-tile-avatar" />}
            </div>
            {m.participants.map((p) => (
              <RemoteParticipantTile
                key={p.userId}
                participant={p}
                displayName={m.nameFor(p.userId)}
                muted={m.remoteMicMuted.get(p.userId) ?? false}
                isSharing={m.screenSharers.has(p.userId)}
                layout="grid"
                onFocus={() => m.setFocusedUserId(p.userId)}
                videoRefSetter={(el) => m.setRemoteVideoRef(p.userId, el)}
                volume={m.participantVolumes[p.userId] ?? 100}
                isVolumePopoverOpen={false}
                onToggleVolumePopover={() => {}}
                onCloseVolumePopover={() => {}}
                onVolumeChange={(v) => m.onVolumeChange(p.userId, v)}
                quality={m.qualityByUser[p.userId]}
              />
            ))}
          </div>
        )}
      </div>

      <GuestLobbyToast />

      <div className="mcs-panel">
        <button type="button" className={`mcs-panel-btn${m.isMuted ? ' is-off' : ''}`} onClick={m.handleToggleMute} disabled={!m.isMicAvailable} aria-label={m.isMuted ? t('call.micOn') : t('call.micOff')}>
          {m.isMuted ? <MicOff size={22} strokeWidth={1.8} /> : <Mic size={22} strokeWidth={1.8} />}
        </button>
        <button type="button" className={`mcs-panel-btn${m.isVideoOff ? ' is-off' : ''}`} onClick={m.handleToggleVideo} disabled={m.isScreenSharing} aria-label={m.isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
          {m.isVideoOff ? <VideoOff size={22} strokeWidth={1.8} /> : <Video size={22} strokeWidth={1.8} />}
        </button>
        {audioOutput.supported && (
          <button type="button" className="mcs-panel-btn" onClick={audioOutput.cycle} aria-label={audioOutput.currentLabel} title={audioOutput.currentLabel}>
            <Speaker size={22} strokeWidth={1.8} />
          </button>
        )}
        <button type="button" className="mcs-panel-btn" onClick={onOpenChat} aria-label={t('call.showCall')}>
          <MessageSquare size={22} strokeWidth={1.8} />
        </button>
        <button type="button" className="mcs-panel-btn" onClick={() => onOpenOverflow(m)} aria-label={tp('call.participants', m.totalParticipants)}>
          <MoreHorizontal size={22} strokeWidth={1.8} />
        </button>
        <button type="button" className="mcs-panel-btn is-danger" onClick={m.handleLeaveGroupCall} aria-label={t('call.leaveCall')}>
          <PhoneOff size={22} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
```

  Примечания:
  - `onOpenOverflow` получает саму модель (T6 строит из неё пункты «⋯» и
    контент подшторок — не дублирует подписки на сторы).
  - Фокус на демонстрации: автоматический fullscreen+landscape-lock (спека
    «Просмотр демонстрации: фокус → «на весь экран»») добавляется ЗДЕСЬ
    отдельным эффектом на `m.focusedUserId`/`m.screenSharers`:
    ```tsx
    useEffect(() => {
      const sharing = m.focusedUserId !== null && m.screenSharers.has(m.focusedUserId);
      if (!sharing) return;
      const container = document.querySelector('.mcs-focus');
      if (container instanceof HTMLElement) container.requestFullscreen?.().catch(() => {});
      screen.orientation?.lock?.('landscape').catch(() => {});
      return () => { screen.orientation?.unlock?.(); };
    }, [m.focusedUserId, m.screenSharers]);
    ```
    (добавить этот эффект в компонент, не в `useCallStageModel` — чисто
    мобильное поведение, десктоп фокус не блокирует ориентацию).

- [ ] **Шаг 3: `MobileCallScreen.css`.** Без `@media` (правило файлов под
  `src/mobile/`). Опорные размеры: `.mcs-panel-btn` 56×56 (спека), `.mcs-topbar`
  с `padding-top: env(safe-area-inset-top)` (свой, компонент вне
  `ScreenHeader`), `.mcs-grid` — `display: grid; grid-template-columns: repeat(var(--cols), 1fr); gap: 8px;`
  через инлайн-класс `mcs-grid-cols-1`/`-2` (без `--cols` var — просто два
  явных класса, проще для stylelint's `value-no-unknown-custom-properties`),
  `.mcs-grid.is-scroll { overflow-y: auto; }`, `.mcs-pip` — `position: absolute`
  с `.is-tl/.is-tr/.is-bl/.is-br` смещениями (`top`/`bottom`×`left`/`right`,
  12px от края), `width: 96px; height: 128px; z-index: 2;` (в этом файле нет
  других слоёв — числовой z-index здесь локален внутри одного стекингового
  контекста экрана, не глобальный — см. design-system.md «слои — `--z-*` или
  порядок DOM»: **если stylelint блокирует числовой z-index без исключений —
  заменить на порядок DOM** (`.mcs-pip` рендерится последним в `.mcs-grid`,
  `position: absolute` достаточно без z-index, т.к. остальные плитки в потоке
  grid — убрать `z-index` из правила). Цвета — `--stage-*` роли (те же, что
  `CallStage.css` уже определяет глобально в `:root`/theme — переиспользовать
  без редефайна). Токены форматирования (радиусы, transition) — как в
  Global Constraints.

- [ ] **Шаг 4: i18n.** Новые ключи в `ru.ts`/`en.ts`:
  - `call.collapseCall`: 'Свернуть звонок' / 'Minimize call'.
  Остальные строки экрана переиспользуют существующие `call.*` (проверено
  выше — `micOn/micOff/cameraOn/cameraOff/leaveCall/showCall/reconnecting/
  isSharingScreen/view/dismiss/backToGrid/qualityLoss/groupCallTitle`).

- [ ] **Шаг 5: `MobileCallScreen.test.tsx`.** По образцу
  `src/mobile/screens/__tests__/ChatScreen.test.tsx` (этап 3): мок
  `useCallStageModel` целиком (`vi.mock('@/components/useCallStageModel')`) —
  этот экран не должен повторно тестировать эффекты модели, только свою
  раскладку/вызовы колбэков. Кейсы: рендер сетки при 3 участниках (проверить
  `mcs-grid-cols-2` класс), рендер фокуса при `focusedUserId` (видео с
  `mcs-focus-video`), клик «свернуть» зовёт `onBack`, клик «⋯» зовёт
  `onOpenOverflow` с моделью, клик чата зовёт `onOpenChat`, кнопка «Динамик»
  скрыта когда `useAudioOutput` возвращает `supported:false`,
  «Переподключение…» рендерится при `status:'reconnecting'`.

- [ ] **Шаг 6: гейты.** `npx tsc --noEmit`, `npx stylelint "src/**/*.css"`,
  `npm run check:i18n`, `npm test`.

- [ ] **Отчёт:** DONE_WITH_CONCERNS (ожидаемо — `onOpenOverflow`/`onOpenChat`
  пока не подключены к реальным шторкам, это T6/T7), список созданных файлов.

---

### Task 6: «⋯»-шторки и вывод звука

**Файлы:**
- Создать: `client/src/components/GuestInviteBody.tsx`
- Создать: `client/src/components/ScreenQualityBody.tsx`
- Изменить: `client/src/components/GuestInvitePopover.tsx`
- Изменить: `client/src/components/ScreenSharePicker.tsx`
- Создать: `client/src/mobile/call/useCallOverflowItems.ts` + `.test.ts`
- Создать: `client/src/mobile/call/CallQualitySheet.tsx`
- Создать: `client/src/mobile/call/CallVolumeSheet.tsx`
- Создать: `client/src/mobile/call/MobileGuestSheet.tsx`
- Создать: `client/src/mobile/call/MobileScreenQualitySheet.tsx`
- Создать: `client/src/mobile/hooks/useAudioOutput.ts` + `__tests__/useAudioOutput.test.ts`
- Изменить: `client/src/i18n/locales/ru.ts`, `en.ts`

**Интерфейсы:**
- Потребляет: `CallStageModel` (T2), `useCallOverflowItems` строится из
  модели + локального состояния «какая подшторка открыта».
- Производит: `<CallOverflowSheets model open sub onOpenSub onClose />` —
  используется T7 внутри `renderScreen`'а обёртки экрана `call` как соседний
  к `MobileCallScreen` рендер (решение — экран сам не знает про шторки,
  обёртка их держит, зеркалит паттерн `ChatScreen`+`MessageActionsSheet`
  этапа 3, где шторка живёт рядом с экраном, не внутри него).

- [ ] **Шаг 1: `GuestInviteBody.tsx`.** Вырезать из `GuestInvitePopover.tsx`
  всё ТЕЛО (строки 24–143 без `createPortal(...)`/`position`/`containerRef`):

```tsx
import { useEffect, useState } from 'react';
import { Copy, Check, Link2Off, UserMinus, Ban } from 'lucide-react';
import { useGuestManagementStore } from '@/stores/guestManagementStore';
import { apiErrorText } from '@/services/api';
import { useT } from '@/i18n';

export interface GuestInviteBodyProps {
  channelId: string;
}

/** Тело управления гостями звонка без поверхности: `GuestInvitePopover`
 *  оборачивает его в поповер-портал, мобильная шторка — в `BottomSheet`. */
export function GuestInviteBody({ channelId }: GuestInviteBodyProps) {
  const t = useT();
  const links = useGuestManagementStore((s) => s.links);
  const guests = useGuestManagementStore((s) => s.guests);
  const lastLink = useGuestManagementStore((s) => s.lastLink);
  const createLink = useGuestManagementStore((s) => s.createLink);
  const refresh = useGuestManagementStore((s) => s.refresh);
  const revoke = useGuestManagementStore((s) => s.revoke);
  const kick = useGuestManagementStore((s) => s.kick);

  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void refresh(channelId).catch(setError);
  }, [channelId, refresh]);

  const create = async () => {
    setBusy(true);
    try {
      const link = await createLink(channelId);
      if (link) {
        await navigator.clipboard?.writeText(link.url).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!lastLink) return;
    await navigator.clipboard?.writeText(lastLink.url).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="guest-invite-body">
      <p className="guest-invite-hint">{t('guestInvite.hint')}</p>
      {lastLink ? (
        <div className="guest-invite-link">
          <input className="input" readOnly value={lastLink.url} onFocus={(e) => e.target.select()} />
          <button type="button" className="btn btn-primary guest-invite-copy" onClick={() => void copy()}>
            {copied ? <Check size={16} strokeWidth={1.8} /> : <Copy size={16} strokeWidth={1.8} />}
          </button>
        </div>
      ) : (
        <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void create()}>
          {t('guestInvite.create')}
        </button>
      )}
      {links.length > 0 && (
        <div className="guest-invite-section">
          <div className="guest-invite-section-title">{t('guestInvite.myLinks')}</div>
          {links.map((link) => (
            <div key={link.id} className="guest-invite-row">
              <span className="guest-invite-row-name">
                {link.closed_at ? t('guestInvite.linkClosed') : t('guestInvite.linkActive')}
              </span>
              <button type="button" className="btn btn-ghost guest-invite-action" title={t('guestInvite.revoke')} onClick={() => void revoke(link.id).catch(setError)}>
                <Link2Off size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      {guests.length > 0 && (
        <div className="guest-invite-section">
          <div className="guest-invite-section-title">{t('guestInvite.guests')}</div>
          {guests.map((guest) => (
            <div key={guest.id} className="guest-invite-row">
              <span className="guest-invite-row-name">{guest.display_name}</span>
              <span className="guest-invite-badge">{t('guest.guestBadge')}</span>
              <button type="button" className="btn btn-ghost guest-invite-action" title={t('guestInvite.kick')} onClick={() => void kick(guest.id, false).catch(setError)}>
                <UserMinus size={15} strokeWidth={1.8} />
              </button>
              <button type="button" className="btn btn-ghost guest-invite-action" title={t('guestInvite.kickAndBan')} onClick={() => void kick(guest.id, true).catch(setError)}>
                <Ban size={15} strokeWidth={1.8} />
              </button>
            </div>
          ))}
        </div>
      )}
      {error != null && <p className="guest-invite-error">{apiErrorText(error, t)}</p>}
    </div>
  );
}
```

  (Убран `{t('guestInvite.title')}` заголовок — он переезжает в
  `BottomSheet`'ный `title` пропс на мобиле и остаётся отдельной строкой в
  `GuestInvitePopover`, см. следующий шаг — не удалять ключ `guestInvite.title`
  из локалей, он всё ещё используется десктопом.)

- [ ] **Шаг 2: переписать `GuestInvitePopover.tsx`**, чтобы использовать
  `GuestInviteBody`, сохранив ИДЕНТИЧНЫЙ DOM (та же обёртка-портал,
  `guest-invite-head`, тот же `containerRef`):

```tsx
import { createPortal } from 'react-dom';
import { useT } from '@/i18n';
import { useDismissOnOutside } from '@/hooks/useDismissOnOutside';
import { GuestInviteBody } from './GuestInviteBody';
import './GuestInvitePopover.css';

interface GuestInvitePopoverProps {
  channelId: string;
  position: { top: number; left: number };
  onClose: () => void;
}

export function GuestInvitePopover({ channelId, position, onClose }: GuestInvitePopoverProps) {
  const t = useT();
  const containerRef = useDismissOnOutside<HTMLDivElement>(onClose);
  return createPortal(
    <div className="guest-invite-popover" ref={containerRef} style={{ top: position.top, left: position.left }}>
      <div className="guest-invite-head">{t('guestInvite.title')}</div>
      <GuestInviteBody channelId={channelId} />
    </div>,
    document.body,
  );
}
```

  **Важно:** `guest-invite-hint`, ссылка, секции и ошибка теперь рендерятся
  ВНУТРИ `<div className="guest-invite-body">`, которого раньше в DOM не было
  — это меняет структуру десктопного дерева (новая обёртка). Так как
  `GuestInvitePopover` не покрыт снимком DOM (T1 не снимал его — не входит в
  `CallStage`/`CallUI`), прямой byte-diff недоступен; вместо этого:
  прочитать `GuestInvitePopover.css` и убедиться, что ни один селектор не
  зависит от того, что эти узлы — прямые дети `.guest-invite-popover` (обычно
  `.guest-invite-popover .guest-invite-section` работает одинаково и через
  дополнительный уровень вложенности). Если найдётся селектор вида
  `.guest-invite-popover > .guest-invite-section` (прямой потомок) — либо
  расширить его на `, .guest-invite-popover .guest-invite-body > .guest-invite-section`,
  либо (проще и безопаснее) сделать `GuestInviteBody` рендерить `<>...</>`
  (React Fragment) без обёртки `div.guest-invite-body` — тогда структура
  ROOT-детей `.guest-invite-popover` не меняется вовсе. **Предпочесть
  Fragment**, если grep не находит причин держать обёртку.

- [ ] **Шаг 3: `ScreenQualityBody.tsx`** — аналогично, вырезать список
  пресетов из `ScreenQualityPicker`:

```tsx
import { SCREEN_QUALITY_PRESETS } from '@/services/groupCall';
import type { ScreenQuality, ScreenQualityPreset } from '@/services/groupCall';

export interface ScreenQualityBodyProps {
  onSelect: (quality: ScreenQuality) => void;
}

export function ScreenQualityBody({ onSelect }: ScreenQualityBodyProps) {
  const entries = Object.entries(SCREEN_QUALITY_PRESETS) as [ScreenQuality, ScreenQualityPreset][];
  return (
    <div className="screen-quality-list">
      {entries.map(([key, preset]) => (
        <button key={key} className="screen-quality-item" onClick={() => onSelect(key)}>
          <span className="screen-quality-label">{preset.label}</span>
          <span className="screen-quality-desc">{preset.width} × {preset.height} · {preset.frameRate} fps</span>
        </button>
      ))}
    </div>
  );
}
```

  Переписать `ScreenQualityPicker` в `ScreenSharePicker.tsx`, чтобы
  рендерить `<ScreenQualityBody onSelect={onSelect} />` вместо инлайн-списка
  — обёртка (`screen-picker-backdrop`/`screen-quality-modal`/шапка/Escape)
  остаётся как есть, `div.screen-quality-list` был и раньше прямым потомком
  `.screen-quality-modal` — структура не меняется.

- [ ] **Шаг 4: `useAudioOutput.ts`** (D7):

```ts
import { useCallback, useEffect, useRef, useState } from 'react';
import { useT } from '@/i18n';

const SUPPORTED = typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export function useAudioOutput(applySinkId: (deviceId: string) => void) {
  const t = useT();
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [index, setIndex] = useState(0);
  const mounted = useRef(true);
  useEffect(() => () => { mounted.current = false; }, []);

  const refresh = useCallback(async () => {
    if (!SUPPORTED || !navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices().catch(() => []);
    if (!mounted.current) return;
    setDevices(all.filter((d) => d.kind === 'audiooutput'));
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const cycle = useCallback(() => {
    if (devices.length === 0) return;
    const next = (index + 1) % devices.length;
    setIndex(next);
    applySinkId(devices[next].deviceId);
  }, [devices, index, applySinkId]);

  const current = devices[index];
  const currentLabel = current?.label || t('call.speakerDefault');

  return { supported: SUPPORTED && devices.length > 1, cycle, currentLabel };
}
```

  (`supported` требует >1 устройства — с одним циклический переключатель
  бессмыслен, кнопка скрывается так же, как при отсутствии `setSinkId`.)

- [ ] **Шаг 5: `useAudioOutput.test.ts`** — мок `navigator.mediaDevices.enumerateDevices`,
  проверить: `supported:false` без `setSinkId` в прототипе (замокать через
  `Object.defineProperty(HTMLMediaElement.prototype, 'setSinkId', { value: vi.fn(), configurable: true })`
  в отдельном describe), `cycle()` идёт по кругу и зовёт `applySinkId` с
  правильным `deviceId`, `supported:false` при ровно одном устройстве.

- [ ] **Шаг 6: `useCallOverflowItems.ts`** — строит `ContextMenuItem[]` для
  `ActionSheet`, по образцу `useServerMenuItems`/`useChannelMenuItems` этапа
  2:

```ts
import { Radio, Users, MonitorUp, Volume2 } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';

export type CallOverflowSub = 'quality' | 'volume' | 'guests' | 'screenQuality' | null;

const CAN_SHARE = typeof navigator !== 'undefined' && 'getDisplayMedia' in (navigator.mediaDevices ?? {});

export function useCallOverflowItems(
  m: Pick<CallStageModel, 'guestLinksEnabled' | 'isGuestMode' | 'isScreenSharing' | 'handleToggleScreenShare'>,
  guestsPresent: boolean,
  onOpenSub: (sub: CallOverflowSub) => void,
): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [
    { label: t('call.qualityDetails'), icon: <Radio size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('quality') },
    { label: t('mobile.callVolumeAction'), icon: <Volume2 size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('volume') },
  ];
  if ((m.guestLinksEnabled && !m.isGuestMode) || guestsPresent) {
    items.push({ label: t('call.ctlGuests'), icon: <Users size={18} strokeWidth={1.8} />, onClick: () => onOpenSub('guests') });
  }
  if (CAN_SHARE) {
    items.push({
      label: m.isScreenSharing ? t('call.stopScreenShare') : t('call.shareScreen'),
      icon: <MonitorUp size={18} strokeWidth={1.8} />,
      onClick: () => { if (m.isScreenSharing) void m.handleToggleScreenShare(); else onOpenSub('screenQuality'); },
    });
  }
  return items;
}
```

  (Начать демонстрацию на мобиле = выбрать качество, затем
  `handleSelectQuality` из модели вызовет `groupCallService.startScreenShare()`
  → `getDisplayMedia` → системный пикер; остановить — сразу
  `handleToggleScreenShare()`, без подшторки.)

- [ ] **Шаг 7: `CallQualitySheet.tsx`** — читает `m.localQuality`, рендерит
  ровно ту же таблицу строк, что десктопный тултип `ConnectionIndicator`
  (потери/пинг/битрейт), в `BottomSheet`:

```tsx
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';
import { useT, type TKey } from '@/i18n';

const QUALITY_KEY: Record<QualityLevel, TKey> = {
  good: 'call.qualityGood', medium: 'call.qualityMedium', poor: 'call.qualityPoor', unknown: 'call.qualityUnknown',
};

export function CallQualitySheet({ open, onClose, metrics }: { open: boolean; onClose: () => void; metrics?: ConnectionQualityMetrics }) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('call.qualityDetails')}>
      {metrics ? (
        <div className="call-quality-sheet-body">
          <div className="call-quality-sheet-level">{t(QUALITY_KEY[metrics.level])}</div>
          {metrics.level !== 'unknown' && (
            <div className="call-quality-sheet-rows">
              <div className="call-quality-sheet-row"><span>{t('call.qualityLoss')}</span><span>{metrics.packetLoss}{t('call.unitPercent')}</span></div>
              <div className="call-quality-sheet-row"><span>{t('call.qualityPing')}</span><span>{metrics.rtt} {t('call.unitMs')}</span></div>
              <div className="call-quality-sheet-row"><span>{t('call.qualityBitrate')}</span><span>{metrics.bitrate} {t('call.unitKbps')}</span></div>
            </div>
          )}
        </div>
      ) : (
        <div className="call-quality-sheet-level">{t('call.qualityUnknown')}</div>
      )}
    </BottomSheet>
  );
}
```

- [ ] **Шаг 8: `CallVolumeSheet.tsx`** — слайдер на каждого участника
  (переиспользует `participantVolumes`/`onVolumeChange` из модели, а не
  `VolumeControlPopover` — тот позиционируется как поповер над одной кнопкой,
  здесь нужен простой список):

```tsx
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';

export function CallVolumeSheet({ open, onClose, m }: { open: boolean; onClose: () => void; m: CallStageModel }) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('mobile.callVolumeAction')}>
      <div className="call-volume-sheet-body">
        {m.participants.length === 0 && <p className="call-volume-sheet-empty">{t('mobile.callVolumeEmpty')}</p>}
        {m.participants.map((p) => (
          <div key={p.userId} className="call-volume-sheet-row">
            <span className="call-volume-sheet-name">{m.nameFor(p.userId)}</span>
            <input
              type="range"
              min={0}
              max={100}
              value={m.participantVolumes[p.userId] ?? 100}
              aria-label={t('call.participantVolume')}
              onChange={(e) => m.onVolumeChange(p.userId, Number(e.target.value))}
            />
          </div>
        ))}
      </div>
    </BottomSheet>
  );
}
```

- [ ] **Шаг 9: `MobileGuestSheet.tsx`** и `MobileScreenQualitySheet.tsx`** —
  по образцу `MobileExpressionSheet.tsx` (этап 3):

```tsx
// MobileGuestSheet.tsx
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { GuestInviteBody } from '@/components/GuestInviteBody';
import { useT } from '@/i18n';

export function MobileGuestSheet({ open, onClose, channelId }: { open: boolean; onClose: () => void; channelId: string }) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('guestInvite.title')}>
      <GuestInviteBody channelId={channelId} />
    </BottomSheet>
  );
}
```

```tsx
// MobileScreenQualitySheet.tsx
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { ScreenQualityBody } from '@/components/ScreenQualityBody';
import type { ScreenQuality } from '@/services/groupCall';
import { useT } from '@/i18n';

export function MobileScreenQualitySheet({ open, onClose, onSelect }: { open: boolean; onClose: () => void; onSelect: (q: ScreenQuality) => void }) {
  const t = useT();
  return (
    <BottomSheet open={open} onClose={onClose} title={t('call.selectQuality')}>
      <ScreenQualityBody onSelect={(q) => { onClose(); onSelect(q); }} />
    </BottomSheet>
  );
}
```

- [ ] **Шаг 10: сборочный компонент `CallOverflowSheets`** — в тот же файл
  `useCallOverflowItems.ts` не кладём (это хук), создать
  `client/src/mobile/call/CallOverflowSheets.tsx`, который держит
  `sub: CallOverflowSub` состояние, рендерит `ActionSheet` (пункты из
  `useCallOverflowItems`) плюс все четыре подшторки, каждая `open={sub === '…'}`
  и `onClose={() => setSub(null)}` (что также закрывает верхний `ActionSheet`,
  если он был открыт — паттерн двух уровней шторок уже есть в
  `BottomSheet`'а стек-совместимом `useBackDismiss`, ничего специального
  делать не нужно):

```tsx
import { useState } from 'react';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { CallQualitySheet } from './CallQualitySheet';
import { CallVolumeSheet } from './CallVolumeSheet';
import { MobileGuestSheet } from './MobileGuestSheet';
import { MobileScreenQualitySheet } from './MobileScreenQualitySheet';
import { useCallOverflowItems, type CallOverflowSub } from './useCallOverflowItems';
import type { CallStageModel } from '@/components/useCallStageModel';
import { useT } from '@/i18n';

interface CallOverflowSheetsProps {
  open: boolean;
  onClose: () => void;
  model: CallStageModel;
  guestsPresent: boolean;
}

export function CallOverflowSheets({ open, onClose, model: m, guestsPresent }: CallOverflowSheetsProps) {
  const t = useT();
  const [sub, setSub] = useState<CallOverflowSub>(null);
  const items = useCallOverflowItems(m, guestsPresent, (s) => setSub(s));
  const closeAll = () => { setSub(null); onClose(); };
  return (
    <>
      <ActionSheet open={open && sub === null} onClose={onClose} title={t('mobile.msgActions')} items={items} />
      <CallQualitySheet open={sub === 'quality'} onClose={closeAll} metrics={m.localQuality} />
      <CallVolumeSheet open={sub === 'volume'} onClose={closeAll} m={m} />
      {m.callChannelId && <MobileGuestSheet open={sub === 'guests'} onClose={closeAll} channelId={m.callChannelId} />}
      <MobileScreenQualitySheet open={sub === 'screenQuality'} onClose={closeAll} onSelect={(q) => { closeAll(); void m.handleSelectQuality(q); }} />
    </>
  );
}
```

  (Заголовок `ActionSheet` `mobile.msgActions` — переиспользуется неверно
  («Действия с сообщением»); завести отдельный ключ `mobile.callActions` =
  «Действия звонка» / 'Call actions' и использовать его здесь вместо
  `mobile.msgActions`.)

- [ ] **Шаг 11: i18n.** Новые ключи:
  - `call.speakerDefault`: 'Динамик по умолчанию' / 'Default speaker'.
  - `call.qualityDetails`: 'Качество связи' / 'Connection quality'.
  - `mobile.callVolumeAction`: 'Громкость участников' / 'Participant volume'.
  - `mobile.callVolumeEmpty`: 'В звонке больше никого нет' / 'No one else is in the call'.
  - `mobile.callActions`: 'Действия звонка' / 'Call actions'.

- [ ] **Шаг 12: тесты.** `useCallOverflowItems.test.ts` — пункт «Гости»
  появляется/не появляется по `guestLinksEnabled`/`guestsPresent`; пункт
  «Демонстрация» появляется только если `navigator.mediaDevices.getDisplayMedia`
  замокан в `describe`-блоке (и отсутствует в соседнем без мока). CSS-файлы
  для новых шторок (`call-quality-sheet-*`, `call-volume-sheet-*`) —
  создать рядом (`CallQualitySheet.css`, импортированный из файла) с
  токенами дизайн-системы (без `@media`).

- [ ] **Шаг 13: гейты.** `npx tsc --noEmit`, `npx stylelint "src/**/*.css"`,
  `npm run check:i18n`, `npm test`. Дополнительно: прогнать
  `npx vitest run src/components/__tests__/CallStage.dom.test.tsx` (T1) —
  **обязан остаться зелёным**, т.к. `GuestInvitePopover.tsx` и
  `ScreenSharePicker.tsx` менялись, а они используются `CallStage.tsx`.

- [ ] **Отчёт:** DONE, подтверждение, что снимок `CallStage.*.html` не
  изменился, список файлов, решение по Fragment/обёртке из Шага 2.

---

### Task 7: `CallPill` и сшивка экрана `call`

**Файлы:**
- Создать: `client/src/mobile/components/CallPill.tsx`
- Создать: `client/src/mobile/components/CallPill.css`
- Создать: `client/src/mobile/components/__tests__/CallPill.test.tsx`
- Изменить: `client/src/mobile/MobileShell.tsx`
- Изменить: `client/src/mobile/MobileShell.css`
- Изменить: `client/src/mobile/screens/renderScreen.tsx`
- Изменить: `client/src/i18n/locales/ru.ts`, `en.ts`

**Интерфейсы:**
- Потребляет: `useCallStore` (тот же, что `CallDock`), `MobileCallScreen` (T5),
  `CallOverflowSheets` (T6).
- Производит: смонтированный `<CallPill>` в `MobileShell`, экран `call`
  собирается через `MobileCallScreen` вместо десктопного `CallStage`.

- [ ] **Шаг 1: `CallPill.tsx`** (D9) — переиспользует ту же логику видимости,
  что была у `CallDock`, плюс класс по контексту:

```tsx
import { Mic, MicOff, PhoneOff, Video, VideoOff } from 'lucide-react';
import { useCallStore } from '@/stores/callStore';
import { useServerStore } from '@/stores/serverStore';
import { useT } from '@/i18n';
import './CallPill.css';

interface CallPillProps {
  variant: 'root' | 'stacked';
  onGoToCall: (serverId: string | null, channelId: string) => void;
}

export function CallPill({ variant, onGoToCall }: CallPillProps) {
  const t = useT();
  const { callChannelId, callChannelName, callServerId, callServerName, status, isMuted, isVideoOff } = useCallStore();
  const currentServerId = useServerStore((s) => s.currentServer?.id ?? null);

  if (!callChannelId || status === 'idle') return null;
  const otherServer = callServerId !== null && callServerId !== currentServerId;

  return (
    <div className={`call-pill is-${variant}`}>
      <button type="button" className="call-pill-target" onClick={() => onGoToCall(callServerId, callChannelId)} title={t('call.goToCall')}>
        <span className="call-pill-status">{status === 'reconnecting' ? t('call.reconnecting') : t('call.inCallAt')}</span>
        <span className="call-pill-channel">
          #{callChannelName}
          {otherServer && callServerName && <span className="call-pill-server"> · {callServerName}</span>}
        </span>
      </button>
      <div className="call-pill-actions">
        <button type="button" className={`panel-icon-btn${isMuted ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleMute()} title={isMuted ? t('call.micOn') : t('call.micOff')}>
          {isMuted ? <MicOff size={16} strokeWidth={1.8} /> : <Mic size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className={`panel-icon-btn${isVideoOff ? ' is-off' : ''}`} onClick={() => useCallStore.getState().toggleVideo()} title={isVideoOff ? t('call.cameraOn') : t('call.cameraOff')}>
          {isVideoOff ? <VideoOff size={16} strokeWidth={1.8} /> : <Video size={16} strokeWidth={1.8} />}
        </button>
        <button type="button" className="panel-icon-btn is-danger" onClick={() => useCallStore.getState().leave()} title={t('call.leaveCall')}>
          <PhoneOff size={16} strokeWidth={1.8} />
        </button>
      </div>
    </div>
  );
}
```

- [ ] **Шаг 2: `CallPill.css`** (без `@media` — мобильный файл):

```css
.call-pill {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px;
  border-radius: var(--radius-card);
  border: 1px solid var(--panel-line);
  background: var(--panel-footer);
}

.call-pill.is-root {
  margin: 0 12px 8px;
}

.call-pill.is-stacked {
  position: fixed;
  left: 12px;
  right: 12px;
  top: calc(env(safe-area-inset-top) + 56px + 8px);
  box-shadow: var(--shadow-card, 0 4px 12px rgb(0 0 0 / 0.24));
}

.call-pill-target {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  gap: 1px;
  padding: 0;
  border: none;
  background: transparent;
  cursor: pointer;
  text-align: left;
}

.call-pill-status {
  font-size: 11px;
  font-weight: 600;
  color: var(--online-text);
}

.call-pill-channel {
  max-width: 100%;
  font-size: 13px;
  font-weight: 700;
  color: var(--ink);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.call-pill-server {
  font-weight: 500;
  color: var(--muted-2);
}

.call-pill-actions {
  display: flex;
  gap: 6px;
}
```

  (`--shadow-card` — если токена с таким именем нет в `tokens.css`, взять
  существующий теневой токен оттуда вместо fallback-литерала: проверить
  `grep -n "shadow" client/src/styles/tokens.css` и использовать точное имя;
  fallback после запятой — только если этот же паттерн `var(--x, fallback)`
  уже используется для теней в другом мобильном файле, иначе убрать fallback
  и требовать токен.)

- [ ] **Шаг 3: `CallPill.test.tsx`** — по образцу `CallDock`'а (если у него
  есть тест — проверить `src/components/__tests__/`; если нет, писать с нуля):
  не рендерится при `status:'idle'`, рендерится с `.is-root`/`.is-stacked` по
  пропу, клики на mic/video/leave зовут методы стора, клик на «цель» зовёт
  `onGoToCall`.

- [ ] **Шаг 4: `renderScreen.tsx`** — заменить `CallScreen`-обёртку:

```tsx
// было: import { CallStage } from '@/components/CallStage'; function CallScreen…
import { MobileCallScreen } from '@/mobile/screens/MobileCallScreen';
import { CallOverflowSheets } from '@/mobile/call/CallOverflowSheets';
import { useCallStageModel } from '@/components/useCallStageModel';
import { useGuestManagementStore } from '@/stores/guestManagementStore';

function CallScreen({ ctx }: { ctx: ScreenCtx }) {
  const callChannelId = useCallStore((s) => s.callChannelId);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overflowModel, setOverflowModel] = useState<ReturnType<typeof useCallStageModel> | null>(null);
  const guestsPresent = useGuestManagementStore((s) => (callChannelId ? (s.channelGuests.get(callChannelId)?.length ?? 0) > 0 : false));
  if (!callChannelId || callChannelId !== ctx.c.currentChannel?.id) return <div className="mobile-screen-loading" />;
  return (
    <>
      <MobileCallScreen
        onBack={ctx.nav.back}
        onOpenChat={() => ctx.nav.push({ kind: 'chat', channelId: callChannelId })}
        onOpenOverflow={(m) => { setOverflowModel(m); setOverflowOpen(true); }}
      />
      {overflowModel && (
        <CallOverflowSheets open={overflowOpen} onClose={() => setOverflowOpen(false)} model={overflowModel} guestsPresent={guestsPresent} />
      )}
    </>
  );
}
```

  Требует `import { useState } from 'react';` в файле (проверить, что ещё не
  импортирован — если да, не дублировать).

  **Важно:** `onOpenOverflow` в `MobileCallScreen` (T5) передаёт `m` —
  `CallStageModel` из ЕГО ИНСТАНСА `useCallStageModel()`. `CallOverflowSheets`
  получает эту же ссылку через `overflowModel` — НЕ вызывает
  `useCallStageModel()` заново (второй вызов хука означал бы второй набор
  эффектов/рефов, рассинхронизированный с видимыми `<video>` элементами
  `MobileCallScreen`). Это единственная причина, по которой `onOpenOverflow`
  в сигнатуре T5 принимает модель параметром, а не просто `() => void`.

- [ ] **Шаг 5: `MobileShell.tsx`** — заменить `CallDock`→`CallPill`,
  подключить `variant`:

```tsx
// было: import { CallDock } from '@/components/CallDock';
import { CallPill } from './components/CallPill';
// …
const showPill = callStatus !== 'idle' && nav.top.kind !== 'call';
// …
{showPill && (
  <div className={root ? 'mobile-call-dock' : undefined}>
    <CallPill
      variant={root ? 'root' : 'stacked'}
      onGoToCall={(serverId, channelId) => serverId && openChannelDeep(serverId, channelId, true)}
    />
  </div>
)}
```

  Убрать старый `{root && callStatus !== 'idle' && <div className="mobile-call-dock"><CallDock .../></div>}`
  блок целиком, заменить на вариант выше. `.mobile-call-dock` CSS-класс
  остаётся (уже стилизует отступ снизу для root-варианта — читать
  `MobileShell.css` строки вокруг `.mobile-call-dock`, если он даёт
  `margin`/`border-radius`, которые дублируют `.call-pill.is-root` — тогда
  убрать дубликат из ОДНОГО места, предпочтительно из `.call-pill.is-root` в
  `CallPill.css`, оставив позиционирование в `MobileShell.css`, т.к.
  `.mobile-call-dock` — это про место в потоке `.mobile-shell`, а
  `.call-pill.is-root` — про сам компонент; не должно быть двух источников
  правды для одного отступа).

- [ ] **Шаг 6: `MobileShell.css`** — снести строку `.call-stage` из
  правила `.mobile-screen > .chat-area, .mobile-screen > .call-stage,
  .mobile-screen > .home-view` (D10):

```css
.mobile-screen > .chat-area,
.mobile-screen > .home-view {
```

- [ ] **Шаг 7: i18n.** Проверить, что все использованные в `CallPill.tsx`
  ключи уже существуют (переиспользованы из `call.*`, ничего нового).

- [ ] **Шаг 8: тесты `MobileShell`.** Прогнать существующие
  `MobileShell.stage2.test.tsx`/`stage3.test.tsx` — не должны сломаться
  (`CallDock` больше не импортируется этим файлом, но тесты не должны были
  завязываться на конкретный компонент дока, только на текст/роль — если
  завязывались, поправить селектор на новый текст/класс `call-pill`).

- [ ] **Шаг 9: гейты.** Все четыре, плюс `npx vitest run src/mobile/__tests__/MobileShell.stage2.test.tsx src/mobile/__tests__/MobileShell.stage3.test.tsx`.

- [ ] **Отчёт:** DONE, список изменённых файлов, подтверждение, что
  `CallDock.tsx`/`.css` НЕ изменены (десктоп продолжает их использовать).

---

### Task 8: p2p (`CallUI`) и `CallNotifBanner` — мобильная CSS-раскладка

**Файлы:**
- Изменить: `client/src/components/CallUI.css`
- Изменить: `client/src/components/CallNotifBanner.css`

**Интерфейсы:**
- Потребляет: ничего (чистый CSS, `CallUI.tsx`/`CallNotifBanner.tsx` НЕ
  трогаются — Global Constraints).
- Производит: ничего нового для других задач — терминальная CSS-задача.

Спека §6.4: «Входящий: `.p2p-overlay.is-incoming` на мобиле — `inset: 0`,
крупные «Принять»/«Отклонить», safe-area. Активная p2p — CSS-раскладка по
правилам §6.2 (вертикальная, PiP, нижняя панель). `CallNotifBanner`: плашка
сверху с safe-area».

- [ ] **Шаг 1: прочитать** `CallUI.tsx` (уже прочитан на этапе планирования —
  классы: `.p2p-overlay.is-incoming`, `.p2p-modal`, `.p2p-modal-tile`,
  `.p2p-actions`, `.p2p-reject-btn`/`.p2p-accept-btn`, `.p2p-overlay.is-active`,
  `.p2p-videos`, `.p2p-remote`, `.p2p-local`, `.p2p-timer`, `.p2p-plate`,
  `.p2p-controls`, `.p2p-ctl`/`.p2p-ctl-btn`/`.p2p-ctl-label`,
  `.p2p-leave-btn`), `CallUI.css` целиком (336 строк, ноль текущих `@media`),
  `CallNotifBanner.tsx`/`.css` (36/? строк).

- [ ] **Шаг 2: добавить блок в `CallUI.css`** (в конец файла, новый —
  Constraints разрешают `< 900px` без allowlist):

```css
@media (width < 900px) {
  .p2p-overlay.is-incoming {
    inset: 0;
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .p2p-accept-btn,
  .p2p-reject-btn {
    width: 64px;
    height: 64px;
  }

  .p2p-overlay.is-active {
    padding-top: env(safe-area-inset-top);
    padding-bottom: env(safe-area-inset-bottom);
  }

  .p2p-videos {
    position: relative;
  }

  .p2p-remote {
    width: 100%;
    height: 100%;
  }

  /* PiP — фиксированный угол, без перетаскивания (решение D4: у p2p ровно
     одна локальная плитка, выбор угла не нужен). */
  .p2p-local {
    position: absolute;
    right: 12px;
    bottom: 100px;
    width: 96px;
    height: 128px;
    z-index: 2;
  }

  .p2p-controls {
    padding-bottom: env(safe-area-inset-bottom);
  }

  .p2p-ctl-btn {
    width: 56px;
    height: 56px;
  }
}
```

  Точные значения (64px кнопки приёма/отказа, 96×128 PiP, 56px кнопки
  панели) — согласовать с `MobileCallScreen.css`/`mcs-panel-btn` (56px,
  Global Constraints) для визуальной последовательности между групповым и
  p2p звонком; PiP-размер — тот же, что `.mcs-pip` в T5. Если базовые
  (небрейкпойнт) правила `.p2p-remote`/`.p2p-local`/`.p2p-videos` уже
  задают `position`/`width` через flex-колонку (читать текущий CSS перед
  правкой!) — мобильный блок должен ПЕРЕОПРЕДЕЛЯТЬ ровно то, что нужно
  сменить на abs-позиционирование, не дублируя неизменные свойства.

- [ ] **Шаг 3: добавить блок в `CallNotifBanner.css`:**

```css
@media (width < 900px) {
  .call-notif-banner {
    top: env(safe-area-inset-top);
    left: 12px;
    right: 12px;
    width: auto;
  }
}
```

  (Точные базовые свойства, которые переопределяются — читать текущий CSS:
  если баннер уже `position: fixed; top: 16px; left: 50%; transform:
  translateX(-50%);` — мобильный блок должен согласованно заменить `top` на
  safe-area-aware значение и, если ширина завязана на `transform`/`left:50%`,
  переключить на `left/right: 12px` без `transform`, чтобо не ловить дробные
  сдвиги на разных viewport'ах.)

- [ ] **Шаг 4: гейты.** `npx stylelint "src/**/*.css"` (0 байт),
  `npx tsc --noEmit` (файлы не TS — но прогнать вместе с остальными как
  обычно), `npm test`.

- [ ] **Шаг 5: ручная проверка** (клик-проход, обе темы, 390×844 и 844×390):
  открыть входящий p2p (проще всего эмулировать событием
  `discrod:incoming_call`/`discrod:call_started`, как в T1's тесте, через
  консоль браузера на `npm run dev:vite`) и глазами свериться со спекой.

- [ ] **Отчёт:** DONE, подтверждение, что `CallUI.tsx`/`CallNotifBanner.tsx`
  не тронуты (`git diff --stat` по ним — пусто).

---

### Task 9: приёмка этапа

**Файлы:** правка `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`;
скриншоты/пробы — только в `.superpowers/vyc95/s4/` (git-ignored, свидетельство).

Это задача контролёра плана (не исполнителя): требует браузера и решений.
Схема — как на этапах 2–3.

- [ ] **Шаг 1: полные гейты** из `client/`: `npx tsc --noEmit` (0 байт),
  `npx stylelint "src/**/*.css"` (0 байт), `npm run check:i18n`, `npm test`
  (ровно 3 падения в `api.network-retry.test.ts`). `git status --short`: нет
  `M` вне ожидаемых файлов; `git diff --stat` по
  `src/components/__tests__/__snapshots__/` — пусто (снимки `CallStage.*`/
  `CallUI.*` из T1 не менялись, снимки этапа 3 — тем более).

- [ ] **Шаг 2: десктоп против нетронутого оригинала.** `/tmp/vyc95-base`
  (pre-VYC-95, :3101) и рабочее дерево (:3100), оба dev-серверы свежие.
  14+42 состояния этапов 1–3 (из `desktop-identity.md`) + новые звонковые:
  групповой звонок сетка (2/3/5 участников — фикстура через
  `inject-voice-ws.js`), фокус на участнике, демонстрация экрана своя,
  просмотр чужой демонстрации, поповер приглашения гостя открыт, попап
  выбора качества экрана открыт, поповер громкости участника открыт, p2p
  входящий, p2p активный. `compare -metric AE`; шум ≤ 2 px; >2 — разбирать.

- [ ] **Шаг 3: мобильная матрица** `--touch`, `--theme light|dark`,
  375×812 / 390×844 / 768×1024 (портрет) + **844×390** (пейзаж, для сетки
  ≥2 участников и фокуса демонстрации): групповой звонок — 1/2/3/5
  участников (проверить `mobileGridLayout` реально даёт 1/1/2/2 колонки),
  фокус на участнике, демонстрация в фокусе (landscape-lock), «⋯»-шторка,
  подшторки (качество/громкость/гости/качество демонстрации), баннер
  «Переподключение…» (эмулировать `status:'reconnecting'` через preload),
  баннер демонстрации, `CallPill` в варианте root (над таб-баром) и stacked
  (под шапкой экрана `chat`/`channelInfo`), p2p входящий и активный,
  `CallNotifBanner` сверху с safe-area. Пробы создающие данные — удаляют их
  в `finally`. Каждый кадр — просмотреть.

- [ ] **Шаг 4: реальный браузер.** Пробы `probe-template.js`, каждая сначала
  красная: (а) экран `call` не свайпается «назад» краевым жестом (D8;
  `.mobile-stage` не переключает на предыдущий экран при drag от левого края
  во время `nav.top.kind === 'call'`); (б) системное «назад»
  (`popstate`/аппаратная кнопка через CDP) на открытой «⋯»-шторке закрывает
  только её, не выходит из звонка; (в) вложенная подшторка (например,
  «Гости») закрывается «назад» ДО закрытия самого «⋯»; повторное «назад»
  закрывает «⋯»; (г) `elementFromPoint` в ±0 от центра каждой кнопки панели
  звонка (56×56) и кнопок p2p (64×64/56×56) попадает в свою кнопку; (д)
  двойной тап по видео демонстрации в фокусе сбрасывает зум (эмуляция через
  два синтетических pointerdown/up с `pointerType:'touch'` — CDP
  `Input.dispatchTouchEvent` или прямой JS-вызов обработчиков, если CDP
  touch-эмуляция недоступна в окружении — задокументировать, какой путь
  сработал); (е) кнопка «Динамик» скрыта, когда
  `HTMLMediaElement.prototype.setSinkId` не определён (эмулировать через
  `--preload`, удаляющий свойство до монтирования); (ж) пункт «Демонстрация
  экрана» отсутствует в «⋯», когда `navigator.mediaDevices.getDisplayMedia`
  не определён.

- [ ] **Шаг 5: аудит hover-зависимого в звонковых компонентах (строка 92,
  закрывает диапазон 3–4).** `grep -n "opacity: 0\|visibility: hidden\|pointer-events: none"`
  рядом с `:hover`/`:focus-within` в `CallStage.css`, `CallUI.css`,
  `VolumeControlPopover.css`, `ScreenSharePicker.css`, `GuestInvitePopover.css`
  (то же упражнение, что этап 3 сделал для чатовых компонентов). Для каждого
  найденного — тач-путь есть (видимая кнопка на `MobileCallScreen`/подшторках
  вместо hover-реveal, или элемент вообще не используется мобильным путём,
  т.к. заменён своим мобильным аналогом) или явный минус в ledger. Список
  найденного и вердикт по каждому — в ledger.

- [ ] **Шаг 6: обновить спеку.** Строки покрытия 20 (закрыть остаток —
  «экран `call` сам» теперь ✅), 37 (если ещё не отмечена — проверить), 45–64
  — «✅ этап 4 + свидетельство» (или «⏳» там, где решения D4/D7/D9 сузили
  спеку — явно указать какое решение), 92 — «✅ этап 3+4» с ссылкой на Шаг 5.
  Строка 97 («Десктоп не изменился») — дописать состояния этапа 4 (сколько
  дополнительных 1280×800-состояний добавлено, шум/находки, как это уже
  делалось для этапов 1 и 3). В «Follow-ups»/новый раздел «Этап 4 —
  отложено и найдено по пути» — записать минимум: `CallDock`'ные легаси-блоки
  `CallStage.css` (`<= 768px`×6, `<= 640px`×1) стали мёртвым кодом — зачистка
  этапа 7 (добавить `components/CallStage.css` в список файлов, чьи
  LEGACY-записи стираются на этапе 7, не раньше — allowlist в этой задаче не
  трогается); PiP в p2p — фиксированный угол, не перетаскивается (D4, отличие
  от группового звонка — сознательное, но зафиксировать); реальное
  устройство с несколькими audio-output не проверено (эмуляция
  `enumerateDevices` — не то же самое, что настоящий Bluetooth-гарнитура);
  `screen.orientation.lock('landscape')` — по спеке в `try`, но браузер может
  игнорировать вне полноэкранного режима на некоторых Android-версиях, не
  проверено на устройстве.

- [ ] **Шаг 7: закрыть ledger** (`STAGE 4 COMPLETE`) и подготовить сообщение
  пользователю с перечнем файлов для `git add` (явные пути, без `-A`/`.`;
  `git add -f` для этого плана — каталог `docs/superpowers/plans/` в
  `.gitignore`), предложенным сообщением коммита (без `Co-Authored-By`),
  списком решений, принятых за пользователя, отложенным и непроверенным.
  Предложение сообщения:

```
VYC-95 Мобильный звонок: групповой экран, p2p, гости, качество

- CallStage разрезан на useCallStageModel + src/components/call/* — десктоп
  не изменён (файловые снимки DOM), MobileCallScreen переиспользует то же
  состояние и те же плитки со своей раскладкой
- экран call: сетка/фокус/PiP (mobileGridLayout), нижняя панель 56px,
  «⋯» → шторки (качество связи, громкость участников, гости, качество
  демонстрации), pinch-zoom на видео демонстрации (usePinchZoom)
- CallPill заменяет CallDock на мобиле (над таб-баром / под шапкой экрана)
- p2p (CallUI) и CallNotifBanner получили мобильную раскладку только CSS'ом
- кнопка «Динамик» — циклический выбор audio-output через setSinkId,
  скрыта без поддержки браузера
```

---
