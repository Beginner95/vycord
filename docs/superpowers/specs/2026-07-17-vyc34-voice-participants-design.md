# VYC-34 — Количество и список участников голосового канала

**Задача:** Под голосовым каналом в сайдбаре показывать, кто сейчас находится в звонке, и число участников рядом с названием канала (`General (3)`), в реальном времени, для всех участников сервера — не только для тех, кто сам в звонке.

**Дата:** 2026-07-17
**Ветка:** `VYC-34-show-users-counts`

## Проблема

Сейчас в `ChannelSidebar.tsx` голосовые каналы рендерятся как обычные строки с названием — никакой информации о том, кто сейчас в звонке, нет. Узнать это можно только зайдя в сам канал.

Похожая фича проектировалась ранее (VYC-22), но реализация не попала ни в одну ветку и утеряна; архитектура ниже спроектирована заново с учётом текущего состояния кода, при этом переиспользует то же основное решение (push-трекинг через хаб), которое показало себя рабочим на бумаге.

Данные о presence в звонке принципиально отличаются от уже существующего `Client.CurrentChannelID` в хабе — это «канал, который сейчас просматривается» (обновляется при клике на любой канал, текстовый или голосовой), а не «в каком звонке состоит пользователь». Пользователь может быть в голосовом звонке и одновременно листать текстовые каналы — `CurrentChannelID` в этот момент укажет на текстовый канал. Поэтому нужен отдельный трекинг.

## Решение

Push-трекинг presence через основной WS-хаб (`server/internal/delivery/ws/hub.go`), симметрично уже существующему паттерну `online_users`/`user_joined`/`user_left`. Клиент явно сигнализирует о входе/выходе из звонка в моменты, где уже есть чёткие lifecycle-хуки (`GroupCallUI.tsx`), хаб хранит ростер по каналам и рассылает изменения всем клиентам сервера.

Альтернативы (источник правды — SFU-сервис; поллинг через HTTP) отклонены: SFU — отдельный процесс с отдельной JWT-авторизацией, для который придётся вводить кросс-сервисную связь ради данных, которые уже можно получить дешевле через основной хаб; поллинг противоречит уже принятому в проекте паттерну push-обновлений (online-статусы, сообщения).

### Поток данных

```
Клиент A: успешный join в звонок (GroupCallUI.handleJoinGroupCall)
  → WS "voice_joined" {channel_id}
  → Hub.JoinVoiceChannel(userID, channelID)
  → broadcast "voice_participants" {channel_id, user_ids} всем клиентам сервера

Клиент A: выход из звонка (handleLeaveGroupCall / onCallEnded / onError)
  → WS "voice_left" {channel_id}
  → Hub.LeaveVoiceChannel(userID)  — идемпотентно
  → broadcast "voice_participants" {channel_id, user_ids}

Любой клиент: (пере)подключение к основному WS
  → Hub отправляет "voice_state" {channels: {channel_id: user_ids[]}} — полный снепшот
```

### Сервер — `server/internal/delivery/ws/hub.go`

Новое состояние `Hub`:
```go
voiceChannels      map[uuid.UUID]map[uuid.UUID]struct{} // channelID → set(userID)
clientVoiceChannel map[uuid.UUID]uuid.UUID              // userID → channelID
```

Новые методы:
- `JoinVoiceChannel(userID, channelID uuid.UUID) []uuid.UUID` — добавляет в ростер канала, обновляет обратный индекс, возвращает актуальный список участников
- `LeaveVoiceChannel(userID uuid.UUID) (channelID uuid.UUID, participants []uuid.UUID, ok bool)` — убирает из ростера; если пользователя там не было (повторный вызов) — `ok == false`, без побочных эффектов
- `GetVoiceState() map[uuid.UUID][]uuid.UUID` — снепшот всех непустых голосовых каналов

Очистка при обрыве соединения — в `unregister`-ветке `Hub.Run()` (там же, где чистится online-статус): если у клиента была запись в `clientVoiceChannel`, вызвать `LeaveVoiceChannel` и разослать `voice_participants`.

При регистрации нового клиента (`register`-ветка) — отправить ему `voice_state` тем же способом, что сейчас `sendOnlineUsersToClient`.

### Сервер — `server/internal/delivery/http/handler/websocket.go`

Новые кейсы в `handleMessage`:
```go
case "voice_joined":
    h.handleVoiceJoined(client, msg)
case "voice_left":
    h.handleVoiceLeft(client, msg)
```

`handleVoiceJoined` / `handleVoiceLeft` — парсят `{channel_id}`, вызывают соответствующий метод хаба, при успехе рассылают `voice_participants` через `hub.BroadcastMessage`. Невалидный `channel_id` — молча игнорируется (как и в существующем `handleJoinChannel`).

### Клиент — точки отправки событий (`client/src/components/GroupCallUI.tsx`)

Переиспользуют существующие lifecycle-хуки:
- `handleJoinGroupCall` — после успешного `groupCallService.joinGroupCall()` → `wsService.send('voice_joined', { channel_id: roomId })`
- `handleLeaveGroupCall` — рядом с уже существующим `voice_call_cancel` → `wsService.send('voice_left', { channel_id: channelId })`
- `onCallEnded` (неожиданное закрытие SFU-соединения) → `wsService.send('voice_left', { channel_id: groupCallService.currentRoomIdState })`
- `onError` → **захватить `channelId` до** вызова `groupCallService.leaveGroupCall()` (он сбрасывает `currentRoomIdState`), затем отправить `voice_left`

Двойная отправка `voice_left` (например, добровольный выход → `handleLeaveGroupCall` → закрытие SFU WS → `onCallEnded`) безопасна: второй вызов `LeaveVoiceChannel` на сервере — no-op, broadcast не происходит.

### Клиент — состояние (`client/src/pages/AppPage.tsx`)

```ts
const [voiceParticipants, setVoiceParticipants] = useState<Map<string, string[]>>(new Map());
```
- Подписка на `voice_state` → заменяет всю карту (`new Map(Object.entries(payload.channels))`)
- Подписка на `voice_participants` → заменяет запись для одного `channel_id`
- Прокидывается в `ChannelSidebar` новым пропом `voiceParticipants`

### Клиент — резолв имён

Используется уже загруженный `members: MemberWithUser[]` из `serverStore` (`user_id → username`, тот же источник, что и `UserList.tsx`) — новых запросов к API не требуется. Если `userId` не найден в `members` (участник покинул сервер, пока был в звонке) — fallback на первые 8 символов ID, по аналогии с `userCache` в `GroupCallUI.tsx`.

### Клиент — UI (`client/src/components/ChannelSidebar.tsx` + `.css`)

```
General (3)
  🟣 Alex
  🟣 Vaha
  🟣 Artur
```

- Счётчик: `{channel.name}` + `<span className="voice-count">({N})</span>`, рендерится только при `N > 0`; при `N === 0` — просто название канала, без скобок
- Список участников — блок сразу под строкой канала, рендерится только при `N > 0`, всегда развёрнут (без сворачивания)
- Каждая строка участника: маленький avatar-инициал (по образцу `.user-avatar.small`, компактнее — ~20px, та же цветовая заливка) + username
- Своя строка (`userId === currentUser.id`) — выделяется акцентным цветом/полужирным начертанием
- Клик по строке участника вызывает тот же `onSelectChannel(channel)`, что и клик по каналу — присоединяет/переключает на этот голосовой канал
- Отступ слева для визуальной вложенности под родительским каналом; приглушённый цвет текста, лёгкий hover

## Edge cases

- Пустой канал — ни счётчика, ни списка
- Креш вкладки / потеря сети без явного `voice_left` — чистится на сервере при `unregister` в хабе (тот же путь, что и online-статус)
- Двойной `voice_left` — идемпотентен, второй вызов не создаёт лишний broadcast
- Переключение между серверами — `voiceParticipants` матчится по `channel.id`; список каналов уже отфильтрован по текущему серверу, утечки между серверами нет
- Участник вышел из `members` сервера, но остался в звонке — fallback на укороченный ID
- Реконнект основного WS — новое подключение получает свежий `voice_state`, полностью восстанавливая состояние независимо от пропущенных incremental-событий

## Тестирование

- Новый `server/internal/delivery/ws/hub_test.go`: `JoinVoiceChannel`/`LeaveVoiceChannel` (включая идемпотентность повторного `Leave`), `GetVoiceState`
- Расширение `server/internal/delivery/http/handler/websocket_test.go`: `handleVoiceJoined`/`handleVoiceLeft` рассылают корректный `voice_participants` payload
- Ручной QA (несколько браузерных сессий): вход/выход из звонка, обновление счётчика и списка у наблюдателя не в звонке, очистка при закрытии вкладки, изоляция между серверами, выделение своей строки

## Вне скоупа

- Индикатор статуса микрофона (замьючен/нет) в списке участников — отдельная нереализованная фича (VYC-21), не смержена в main
- Сворачивание/разворачивание списка участников по клику
- Аватары-изображения (`avatar_url`) — поле есть в типах, но нигде в клиенте не используется; список участников использует тот же letter-avatar паттерн, что и весь остальной проект
