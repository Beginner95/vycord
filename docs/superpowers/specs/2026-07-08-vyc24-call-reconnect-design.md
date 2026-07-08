# VYC-24: Авто-переподключение группового звонка при смене сети

Дата: 2026-07-08
Статус: одобрено (brainstorming 2026-07-08)
Ветка: VYC-24-reconnect (от main, после мержа VYC-23-coturn)

## Проблема

Смена сети посреди звонка (включение/выключение VPN, wifi→LTE, перезапуск SFU)
рвёт и медиапоток (UDP, все ICE-пары умирают), и сигналинг-WebSocket (TCP).
Текущее поведение: `pc.connectionState === 'failed'` даёт только `onError`,
`ws.onclose` делает полный teardown и `onCallEnded` — участника выкидывает из
встречи, вернуться можно только ручным перезаходом.

«Чистый» ICE restart по живому WS сценарий не покрывает: жизнь серверной сессии
привязана к WS (`handler.go`: `defer rs.Leave()`), а при смене сети WS умирает
вместе с медиа. Поэтому выбран авто-rejoin на клиенте.

## Цель / критерий успеха

Участник включает VPN посреди звонка → клиент показывает «переподключение…» →
в течение нескольких секунд звук/видео восстановлены, мьют и активная
демонстрация экрана сохранены. Если сеть не вернулась за ~30 секунд — честный
`onCallEnded`. Обычный выход из звонка reconnect не триггерит.

## Рассмотренные подходы

1. **Авто-rejoin на клиенте** (выбран) — клиент сам перезаходит: новый WS,
   новый PC, свежие TURN-креды, ретраи с backoff. Сервер — только вытеснение
   старой сессии того же user_id. Покрывает VPN, смену сети, рестарт SFU.
   Минус: остальные участники на 2–5 с видят выход/вход.
2. ICE restart (`restart_ice` + `CreateOffer({ICERestart: true})`) + rejoin как
   fallback — быстрее, когда WS выжил, но это редкий случай; двойная
   тест-матрица. Отложено.
3. Session resume на сервере (PC переживает обрыв WS, resume-токены) — лучший
   UX, но большая переделка сервера (расцепить жизнь сессии и WS, буферизация
   offer'ов, таймауты). Отложено.

## Дизайн

### Клиент: детекция обрыва (`client/src/services/groupCall.ts`)

Три триггера запускают единый `reconnect()`:

- `pc.connectionState === 'failed'` — немедленно;
- `pc.connectionState === 'disconnected'` дольше **3 секунд** (таймер,
  отменяется при возврате в `connected`) — при VPN браузер может сидеть в
  `disconnected` десятки секунд до `failed`, а WS висит полуоткрытым и
  `onclose` не приходит;
- `ws.onclose` при `inCall === true`, если выход не инициирован пользователем.

Новые поля состояния:

- `intentionalLeave: boolean` — ставится в `leaveGroupCall()`; при нём
  `ws.onclose` ведёт себя как сейчас (teardown + `onCallEnded`);
- `reconnecting: boolean` — защита от двойного запуска (pc failed и ws.onclose
  срабатывают оба).

### Клиент: процедура reconnect

1. `reconnecting = true`; колбэк `onReconnecting()` → UI-баннер.
2. Запомнить состояние: mute аудио/видео (`track.enabled`),
   `_isScreenSharing` + ссылка на `screenStream`.
3. **Частичный teardown**: закрыть PC и WS, очистить `remoteStreams` и
   `pendingCandidates`, остановить `dummyVideoTrack` (новый PC создаст свой
   через `createDummyVideoTrack`). НЕ трогать `localStream`, `audioCtx`
   (+keepalive), `screenStream`, noise cancellation — локальные медиатреки
   переживают смену сети.
4. Цикл ретраев с backoff **0.5с, 1с, 2с, 4с, 8с, 8с… (суммарно ~30с)**.
   Каждая попытка: свежий `getIceServers()` (TURN-креды эфемерные) → новый WS →
   новый PC (существующие `connectSignaling` / `createPeerConnection`).
5. После `joined`: восстановить mute (`track.enabled`); если была
   демонстрация — `replaceTrack(screenTrack)` на video-sender +
   `requestKeyframeWithRetry()` (тот же путь, что `startScreenShare`).
6. Успех → `onReconnected()`, баннер убирается. Исчерпаны ретраи → полный
   teardown + `onCallEnded()`.

Рефакторинг: из `joinGroupCall` выделяется внутренний
`connect(roomId, userId)` (ICE-серверы + WS + PC) — общий для первого входа и
reconnect. Захват медиа (`acquireMedia`, WebAudio-обвязка) остаётся только в
`joinGroupCall`.

### Сервер: вытеснение старой сессии (`room_session.go`)

Единственное серверное изменение. При VPN серверный WS тоже висит полуоткрытым
до `disconnectedTimeout` (30с); при быстром rejoin в комнате оказывается
призрак с тем же `user_id`: его треки форвардятся новому клиенту (echo guard
клиента их отбрасывает, но m-line'ы копятся), остальные видят дубль участника.

Решение: в `RoomSession.Join` перед добавлением участника — если в комнате уже
есть сессия с тем же `UserID`, вызвать для неё `Leave` (лог
`evicting stale session for reconnecting user`). Существующий `Leave` уже
корректно снимает форвардящиеся треки у подписчиков и рассылает
`participant_left`.

### UI (`client/src/components/GroupCallUI.tsx`)

- В `GroupCallCallbacks` два новых колбэка: `onReconnecting` /
  `onReconnected`.
- В UI — состояние `isReconnecting`, баннер «Переподключение…» поверх сетки
  участников.
- Кнопка «выйти» активна во время ретраев и прерывает их (через
  `intentionalLeave`).

## Крайние случаи

- **Выход пользователя во время ретраев** — `leaveGroupCall` ставит
  `intentionalLeave`, цикл прерывается, обычный teardown + `onCallEnded`.
- **SFU лежит** — все ретраи фейлятся, через ~30с `onCallEnded`.
- **API недоступен для `getIceServers`** — вызов внутри тела ретрая,
  покрывается тем же backoff.
- **Комната опустела за время обрыва** — rejoin создаёт её заново, участник
  один; корректно.
- **Screen-трек умер за время обрыва** — перед восстановлением проверить
  `screenTrack.readyState === 'live'`; иначе не восстанавливать демонстрацию и
  вызвать `onScreenShareEnded`.
- **Двойной триггер (pc failed + ws.onclose)** — гасится флагом
  `reconnecting`.

## Тестирование

- **Go-тест** (application): два `Join` в одну комнату с одинаковым `user_id` →
  первая сессия закрыта, в комнате один участник с этим `user_id`,
  подписчикам отправлен `participant_left`.
- **Ручной прогон** (основной):
  1. Звонок из двух участников; у одного включается VPN → баннер
     «Переподключение…» → звук восстановился за секунды, мьют и демонстрация
     на месте.
  2. `docker restart` SFU посреди звонка → оба участника переподключаются.
  3. Обычный «выйти» → reconnect НЕ запускается, обычный `onCallEnded`.

## Вне scope

- ICE restart по живому WS (`restart_ice`) — возможное ускорение позже.
- Session resume на сервере (участник не «мигает» для остальных) — отдельная
  задача, если UX «выход/вход на 2–5 с» окажется мешающим.
- Автопереподключение основного чат-WS (не SFU) — не относится к звонкам.
