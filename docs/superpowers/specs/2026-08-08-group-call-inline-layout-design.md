# Групповой звонок внутри layout (реальные сайдбары)

**Дата:** 2026-08-08
**Область:** только клиент (`client/src/pages/AppPage.tsx`, `AppPage.css`, `client/src/components/GroupCallUI.tsx`, `GroupCallUI.css`). Бэкенд и СФУ не меняются.

## Проблема

Групповой звонок рендерится `<GroupCallUI />` последним в `AppPage.tsx` как полноэкранный фиксированный оверлей (`.group-call-overlay { position: fixed; top:40px; left:0; right:0; z-index:1000 }`). Он полностью перекрывает весь интерфейс приложения — сайдбар серверов, сайдбар каналов и список участников. Во время звонка пользователь не видит и не может кликнуть основное меню приложения.

## Цель

Во время группового звонка сайдбары остаются **реальными DOM-элементами** (как панель чата в звонке): слева видны и кликабельны сайдбары серверов (`ServerList`) и каналов (`ChannelSidebar`), звонок (видео + чат) занимает область контента канала. Список участников (`UserList`) остаётся видимым и управляется кнопкой «Участники» рядом со счётчиком участников в шапке звонка.

## Новое состояние в AppPage

```ts
const [inGroupCall, setInGroupCall] = useState(false);
const [showCallMembers, setShowCallMembers] = useState(false);
```

- `inGroupCall` — активно ли звонковое UI. Управляется из `GroupCallUI` через проп-колбэк `onInCallChange`.
- `showCallMembers` — видимость `UserList` во время звонка.
- `showCallMembers` **сбрасывается в `false` при каждом входе и выходе из звонка** (в `onInCallChange` при переходе в звонок и при выходе).

## Изменения в `GroupCallUI.tsx`

1. Новый проп: `onInCallChange: (active: boolean) => void`.
2. Везде, где сейчас вызывается `setIsInGroupCall(true/false)` (~16 точек: `handleJoinGroupCall`, `onCallEnded`, `onError` и пр.), дополнительно вызвать `onInCallChange(sameValue)`. Реализовать аккуратно, чтобы не сломать существующую локику внутреннего состояния `isInGroupCall` (оно остаётся источником истины для тела компонента).
3. Проп `showMembers: boolean`, `onToggleMembers: () => void`.
4. В шапку звонка (`.group-call-header-right`, рядом со `.participant-count`) добавить кнопку «Участники»:
   ```tsx
   <button className="call-members-toggle" onClick={onToggleMembers}>
     👥 {tp('call.participants', totalParticipants)}
   </button>
   ```
   Кнопка имеет `active`-класс, когда `showMembers` истинно.

## Изменения в `AppPage.tsx` (разметка)

Заменить блок внутри `.app-layout` (сейчас строки ~465–498):

```jsx
<div className="app-layout" data-mobile-panel={mobilePanel}>
  <ServerList ... />
  <ChannelSidebar ... />
  {inGroupCall ? (
    <GroupCallUI
      onInCallChange={handleInCallChange}
      showMembers={showCallMembers}
      onToggleMembers={() => setShowCallMembers((v) => !v)}
    />
  ) : (
    <ChatArea ... />
  )}
  {inGroupCall ? <UserList ... /> : null}
</div>
```

Логика `handleInCallChange`:
```ts
const handleInCallChange = (active: boolean) => {
  setInGroupCall(active);
  setShowCallMembers(false); // сброс при входе и выходе
};
```

## Изменения в `GroupCallUI.css`

`.group-call-overlay` — из полноэкранного оверлея в обычный flex-элемент layout:

```css
.group-call-overlay {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  background: var(--bg-base);
}
```

(Убрать `position: fixed; top: 40px; left: 0; right: 0; z-index: 1000`.)

## Мобильная адаптация

`ServerList` / `ChannelSidebar` / `ChatArea` / `UserList` на мобильном показываются по `data-mobile-panel` (`servers` / `channels` / `chat` / `members`). Групповой звонок встраивается в область контента (панель `chat`). Нужно проверить, что на мобильном при вступлении в звонок устройство переходит на панель `chat` (или звонок корректно отображается) и что кнопки показа/скрытия не ломают мобильную навигацию.

## Что сознательно не делаем (вне скоупа)

- **Не выносим состояние звонка в отдельную глобальную стору** (zustand). Состояние остаётся локальным в `GroupCallUI`; наружу передаётся только реактивное «активен ли звонок» через колбэк. Меньше изменений, чем подъём всех ~16 `setIsInGroupCall` наверх.
- **Личный звонок 1-на-1** (`CallUI`) — не трогаем, он вне области этой задачи и остаётся как есть.
- **Поведение «выйти из звонка» без явных кнопок** — не добавляем новых способов завершения звонка, кроме существующих.

## Проверка

Юнит-тестов на клиенте нет (нет vitest/config). Проверка — вручную: запустить dev-сервер, войти двумя пользователями в один сервер, вступить в голосовой канал. Убедиться, что:
1. Сайдбары серверов и каналов остаются видимыми и кликабельными во время звонка.
2. Звонок (видео + чат) занимает область контента, чат канала (`ChatArea`) скрыт.
3. `UserList` виден по умолчанию; кнопка «Участники» скрывает/показывает его.
4. При выходе из звонка состояние «Участники» сбрасывается в видимое, и весь layout возвращается к обычному виду (звонковый слой полностью исчезает).
5. Мобильная навигация (панели `servers`/`channels`/`chat`/`members`) не сломана.