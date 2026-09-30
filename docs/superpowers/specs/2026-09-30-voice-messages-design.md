# ГОЛОСОВЫЕ СООБЩЕНИЯ В ЧАТЕ (VYC-101) — SPEC

- **Дата:** 2026-09-30
- **Ветка:** `VYC-101-audio-in-chat` (от `develop`, `5cf9d31`)
- **Статус:** утверждено брейнштормингом (все четыре секции одобрены)

## Контекст

Нужны голосовые сообщения как в Telegram/WhatsApp: удержание кнопки микрофона
в композере — запись, отпустил — сообщение сразу уходит в чат; свайп вверх —
закрепить запись, свайп влево — отменить. В ленте — отдельный пузырь с волной,
перемоткой, скоростью и отметкой «прослушано» у каждого получателя.

Опирается на уже существующее: вложения (миграция `018`, `attachments`,
`QuotaUseCase`, `pkg/attachlink`, уборщик), оптимистичную отправку сообщений
(`deliveryState`, `replaceMessage`, retry-чип), `chatMediaCoordinator`,
выбранный микрофон (`mediaDeviceStore` + `buildMicConstraints()`, VYC-99).

### Находки исследования, влияющие на скоуп

1. **Личных сообщений в коде нет** — ни серверного пути, ни UI; i18n упоминает
   их как «будущую фазу». Голосовые работают везде, где есть чат канала. Если
   DM будут построены на `channels`, голосовые заработают в них без доработок.
2. **Гостевой чат** (`pages/guest/`) рендерит ленту тем же `MessageRow`, а его
   композер — `textOnly`. Следствие без дополнительной работы: гость видит и
   может проиграть голосовое, но не записывает и не имеет отметки «прослушано»
   (у гостя нет `user_id`, поле `listened` ему не приходит). Больше ничего для
   гостей не делаем.
3. `Hub.SendToChannel` доставляет только клиентам, **смотрящим** канал. Событие
   «прослушано» доходит до отправителя в реальном времени, если у него открыт
   канал; иначе он увидит статус при следующей загрузке ленты. Этого достаточно.
4. `usecase/mediatype.go::DetectKind` считает EBML видео, если расширение не
   `.weba`; MediaRecorder в Chromium даёт `audio/webm`, в Safari — `audio/mp4`.

## Решения

| Вопрос | Решение |
|---|---|
| Запись во время звонка | **Запрещена.** Кнопка остаётся, нажатие даёт подсказку «Нельзя записать голосовое во время звонка». Трек звонка не трогается. |
| Конвейер отправки | Оптимистичная строка сразу, отдельная функция `sendVoice` (не трей черновиков, не отдельный серверный эндпоинт) |
| Хранение | Обычное вложение `kind='audio'` + `is_voice`, `duration_ms`, `waveform` в `attachments` |
| Волна | Ровно 64 байта (0–255), клиент ресемплирует |
| Длительность | 1 000 … 900 000 мс (1 с … 15 мин), лимит останавливает и отправляет |
| Доверие клиенту | Длительность и волна — косметика, сервер проверяет только диапазоны (обоснование ниже) |
| Ловушка WebM | Сервер сам выбирает имя голосового файла по сигнатуре контейнера |
| Голосовое сообщение | Ровно одно голосовое вложение, пустой `content`, не редактируется |
| «Прослушано» | Таблица `voice_listens`; одно поле `listened` на зрителя; WS `voice_listened` |
| Прерывание при удержании | `pointercancel`/`blur`/скрытие вкладки во время удержания **отменяют** запись; в закреплённой — игнорируются |
| Скорость | `1x → 1.5x → 2x`, глобальная, запоминается в `localStorage` |
| Вне скоупа | DM, запись гостями, авто-воспроизведение следующего, транскрипция, скачивание голосового |

## 1. Сервер

### 1.1 Миграция `027_voice_messages` (up + down)

```sql
-- up
ALTER TABLE attachments
    ADD COLUMN IF NOT EXISTS is_voice    BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS duration_ms INT,
    ADD COLUMN IF NOT EXISTS waveform    BYTEA;

ALTER TABLE attachments ADD CONSTRAINT attachments_voice_check CHECK (
    NOT is_voice OR (
        kind = 'audio'
        AND duration_ms BETWEEN 1000 AND 900000
        AND waveform IS NOT NULL
        AND octet_length(waveform) = 64
    )
);

CREATE TABLE IF NOT EXISTS voice_listens (
    attachment_id UUID NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
    user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    listened_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attachment_id, user_id)
);
```

Down: `DROP TABLE voice_listens`, `DROP CONSTRAINT attachments_voice_check`,
`DROP COLUMN` трёх колонок.

### 1.2 Домен

`domain.Attachment` получает:

```go
IsVoice    bool   `json:"is_voice,omitempty"`
DurationMs *int   `json:"duration_ms,omitempty"`
Waveform   []byte `json:"waveform,omitempty"` // base64 в JSON (штатный маршалинг []byte)
// Listened — вычисляется для конкретного зрителя, в БД не хранится;
// nil для не-голосовых и для гостей.
Listened   *bool  `json:"listened,omitempty"`
```

`domain.AttachmentUpload` получает `Voice *VoiceMeta{DurationMs int; Waveform []byte}`
(nil — обычное вложение).

Новые методы репозитория:

- `MarkListened(attachmentID, userID) (inserted bool, err error)` —
  `INSERT … ON CONFLICT DO NOTHING`, `inserted` по `RowsAffected`.
- `ListenedFor(viewerID uuid.UUID, attachmentIDs []uuid.UUID) (map[uuid.UUID]bool, error)` —
  одним запросом:
  ```sql
  SELECT a.id FROM attachments a
  WHERE a.id = ANY($2) AND a.is_voice
    AND EXISTS (SELECT 1 FROM voice_listens l
                WHERE l.attachment_id = a.id
                  AND (a.user_id = $1 OR l.user_id = $1))
  ```
  Для автора это «слушал хоть кто-то» (свои прослушивания автор не пишет —
  значит, другие), для остальных — «слушал я».

Новые коды ошибок (`httperr`, `400`): `voice_invalid`, `voice_message_invalid`.

### 1.3 Загрузка

Тот же `POST /api/v1/attachments`. Хендлер дополнительно читает (с `LimitReader`,
как `channel_id`) необязательные части формы: `voice` (`"1"`), `duration_ms`
(десятичное int), `waveform` (base64, после декодирования ровно 64 байта).
Порядок относительно `file` не важен; без `voice` поведение байт в байт прежнее.
Битые значения — `400 voice_invalid` (с `drainBody`, как во всём файле).

`attachmentUseCase.Upload`, если `in.Voice != nil`:

1. проверяет `DurationMs ∈ [1000, 900000]` и `len(Waveform) == 64`, иначе
   `ErrVoiceInvalid`;
2. после чтения `head` заменяет имя файла на `VoiceFileName(head)`:
   EBML → `voice.weba`, `ftyp` → `voice.m4a`, `OggS` → `voice.ogg`, иное →
   `ErrVoiceInvalid`;
3. вызывает обычный `DetectKind`; если вид не `audio` — `ErrVoiceInvalid`;
4. заполняет `IsVoice`, `DurationMs`, `Waveform`.

Так ловушка WebM закрыта на сервере независимо от имени, присланного клиентом.
`DetectKind` не меняется. Квота, подпись, хранилище, уборщик — без изменений.

**Почему достаточно доверия клиенту.** Длительность и волна влияют только на
внешний вид собственного сообщения отправителя. Сервер ограничивает диапазон и
размер (и дублирует это CHECK-ом), так что раздуть данные нельзя. Перемотка
опирается на реальную длительность `<audio>`, когда она конечна. Серверное
декодирование opus/aac без cgo — новая зависимость ради нулевой пользы.

### 1.4 Сообщения

- `messageUseCase.CreateMessage`: если среди `attachmentIDs` есть голосовое
  (проверка до `AttachToMessage`, через чтение вложений по id), то оно должно
  быть единственным, а `content` — пустым; иначе `ErrVoiceMessageInvalid`.
- `UpdateMessage` сообщения с голосовым вложением → `ErrVoiceMessageInvalid`.
- `attachToMessages(msgs, viewerID)` после `ListByMessageIDs` собирает id
  голосовых и одним вызовом `ListenedFor` проставляет `Listened` (для каждого
  голосового — `true`/`false`, никогда не nil). Вызывается из `GetMessages`,
  `SearchMessages`, `GetMessagesAround`, `UpdateMessage`. Ошибка `ListenedFor`
  не роняет выдачу: `Listened` остаётся nil (точки не будет) — как и сейчас
  вложения «не условие ленты».
- WS-рассылка `chat_message` нового сообщения: `Listened=false` верно для всех.

### 1.5 Прослушивания

`POST /api/v1/attachments/{id}/listen` (RequireAuth) → `204`.

`attachmentUseCase.MarkListened(id, userID) (event *VoiceListened, err)`:

1. вложение существует, `IsVoice`, `MessageID != nil` — иначе
   `ErrAttachmentNotFound`;
2. `PermViewChannels` на канале — иначе `ErrAttachmentNotFound` (как `GetForUser`);
3. `userID == att.UserID` → nil-событие, `204`;
4. `MarkListened` в репозитории; `inserted=false` → nil-событие, `204`;
5. иначе хендлер шлёт `hub.SendToChannel(channelID, voice_listened)` с
   payload `{channel_id, message_id, attachment_id, user_id}`.

Идемпотентен: повтор не пишет второй строки и не шлёт второго события.

## 2. Клиент: запись

### 2.1 `src/voice/voiceGesture.ts` — чистая state machine

`reduce(state, event) → { state, effects }`, без React и DOM.

- **Состояния:** `idle` · `starting{origin}` (ждём микрофон) ·
  `recording{origin, startedAt, dx}` (удерживают) · `locked{startedAt}`.
  Выход — эффект `send` или `discard`, после чего `idle`.
- **События:** `press{x, y, inCall}`, `move{x, y}`, `release`, `interrupt`,
  `recorderStarted{t}`, `recorderFailed{reason}`, `tick{t}`, `keyboardStart{inCall}`,
  `lockedSend`, `lockedDelete`.
- **Эффекты:** `startRecorder`, `send`, `discard`, `hint(kind)` где
  `kind ∈ hold | call | interrupted | mic_denied | mic_not_found | mic_failed`.
- **Константы:** `LOCK_DY = 60` px вверх, `CANCEL_DX = 100` px влево,
  `MIN_MS = 1000`, `MAX_MS = 900000`.
- **Переходы:**
  - `idle + press` при `inCall` → `hint(call)`, остаёмся в `idle`; иначе
    `starting` + `startRecorder`.
  - `starting + release` (короткий клик или отпустили, пока браузер спрашивал
    разрешение) → `discard` + `hint(hold)`.
  - `starting + recorderStarted` → `recording`.
  - `starting/recording + recorderFailed` → `idle` + `hint(reason)`.
  - `recording + move`: `dy ≤ −LOCK_DY` → `locked`; `dx ≤ −CANCEL_DX` →
    `discard` (срабатывает ещё до отпускания). Приоритет у отмены, если оба
    порога пройдены одним событием.
  - `recording + release`: `t − startedAt < MIN_MS` → `discard` + `hint(hold)`;
    иначе `send`.
  - `recording | locked + tick` с `t − startedAt ≥ MAX_MS` → `send`.
  - `starting | recording + interrupt` → `discard` + `hint(interrupted)`;
    `locked + interrupt` игнорируется.
  - `idle + keyboardStart` → как `press` без удержания: при `inCall` →
    `hint(call)`; иначе `starting` с флагом `keyboard`, и `recorderStarted`
    ведёт сразу в `locked`.
  - `locked + lockedSend` → `send` (при `< MIN_MS` → `discard` + `hint(hold)`);
    `locked + lockedDelete` → `discard`.

### 2.2 `src/voice/voiceRecorder.ts` — рекордер (не React)

- `start()`: `getUserMedia({ audio: buildMicConstraints() })`; на
  `OverconstrainedError` — повтор с `audio: true` (принцип `acquireUserMedia`).
- `pickMimeType(isTypeSupported)` — чистая: `audio/webm;codecs=opus` →
  `audio/ogg;codecs=opus` → `audio/mp4;codecs=mp4a.40.2` → `audio/mp4` → `''`
  (дефолт браузера). `audioBitsPerSecond: 32000` (15 мин ≈ 3.6 МБ).
- `AnalyserNode`: уровень (RMS) — раз в кадр для индикатора; пик — раз в
  100 мс в буфер волны.
- `stop() → { blob, mimeType, durationMs, waveform: number[64] }`. Длительность
  — по `performance.now()` (не `<audio>.duration`, она бывает `Infinity`),
  зажата в `[MIN_MS, MAX_MS]`.
- `downsampleWaveform(peaks, 64)` — чистая: максимум в бакете, нормализация к
  0–255 относительно максимума; пусто/тишина → нули, без деления на 0; меньше
  64 точек — растяжение.
- **Освобождение — одна функция `release()`**: `track.stop()` всех треков,
  `AudioContext.close()`, отписка таймеров. Вызывается в `stop`, `discard`, на
  любой ошибке (включая ошибку посреди старта) и при размонтировании.
- Ошибки: `NotAllowedError` → `mic_denied`, `NotFoundError` → `mic_not_found`,
  остальное → `mic_failed`. На mac текст запрета берётся из существующего
  `mediaPermissions.ts`.

### 2.3 `src/hooks/useVoiceRecording.ts` — связка

- Навешивает на кнопку микрофона Pointer Events: `setPointerCapture` на
  `pointerdown` (только основная кнопка/касание), `touch-action: none` на кнопке.
- `blur` и `visibilitychange→hidden` слушаются на `window` только пока
  состояние не `idle`, и превращаются в `interrupt`.
- `inCall` — из `callStore` (активный P2P или групповой звонок).
- Исполняет эффекты: рекордер, `sendVoice` (раздел 3), подсказки.
- На старте записи — `chatMediaCoordinator.pauseCurrent()`.
- При размонтировании в любом состоянии — `discard` + `release()`.

### 2.4 UI композера

- Кнопка микрофона (`Mic`, `aria-label`) стоит на месте «Отправить», когда
  `!canSend`, в обоих вариантах (`desktop`/`mobile`). При `textOnly` её нет.
- Во время записи строку ввода замещает полоса `composer-voice`: пульсирующая
  точка на `--danger` (при `prefers-reduced-motion` — статичная), таймер `m:ss`,
  уровень на примитиве `.level-meter` (`--meter-level`), подсказка «← Отмена»,
  смещающаяся за `dx`; над микрофоном — «↑» (закрепить).
- `locked`: таймер, уровень, кнопки «Удалить» (`Trash2`) и «Отправить»
  (`SendHorizontal`), обе с `aria-label`; Escape внутри композера = «Удалить»
  (обработчик на элементе полосы, не на `document`).
- Подсказки и ошибки — короткий тост в композере на примитиве `error-toast`.
- Классы `composer-voice-*`, иконки `lucide-react` с `strokeWidth={1.8}`,
  только токены.

## 3. Клиент: отправка и плеер

### 3.1 `src/voice/sendVoice.ts`

Чистая функция с внедрёнными зависимостями (`upload`, `createMessage`,
`addMessage`/`updateMessage`/`replaceMessage`, `deleteAttachment`).

- `ChatMessage` получает `pendingVoice?: { blob: Blob; objectUrl: string;
  durationMs: number; waveform: number[]; attachment?: Attachment }`.
- На `send`: строка `deliveryState: 'sending'` с синтетическим вложением
  (`is_voice`, `url = objectUrl`, `duration_ms`, `waveform`) — своё голосовое
  можно слушать, пока оно грузится.
- Шаги: `uploadAttachment` (файл `voice.<ext по mimeType>` + voice-поля) →
  сохранить `pendingVoice.attachment` → `createMessage(channel, '', undefined, [id])`
  → `replaceMessage` → `revokeObjectURL`.
- Ошибка → `failed`. `retrySend` понимает `pendingVoice`: есть `attachment` —
  только `createMessage`, нет — сначала загрузка.
- Удаление упавшей строки: `revokeObjectURL` + best-effort `deleteAttachment`
  загруженной сироты (как `cancel` в `useAttachmentUpload`).
- Уход из канала посреди загрузки: промис доезжает сам; если упал, а строки уже
  нет — тост `showSendError`, как у `sendMessage`. Молчаливой потери нет.
- Ошибки квоты/размера — текстом `apiErrorText` на failed-строке.
- `api.uploadAttachment` получает необязательный `voice?: { durationMs, waveform }`,
  добавляющий части формы.

### 3.2 Общий код, вынесенный из `AudioPlayer` (поведение не меняется)

- `hooks/useMediaPlayback.ts` — `ref`, `playing`, `current`, `duration`,
  `toggle()` (`notifyPlaying` **до** `play()`), `seek()`.
- `utils/formatTime.ts`.
- `hooks/useSelfHealingSrc.ts` — однократный `getAttachment` на `onError`
  (вынесено из `AttachmentImage`); пользуются картинка и оба плеера.
- `chatMediaCoordinator.pauseCurrent()`.

### 3.3 `components/VoiceMessage.tsx` + `VoiceMessage.css`

`MessageAttachments` отдаёт сюда вложения с `is_voice` (без ссылки скачивания).

- Play/pause (`aria-label`), волна, время, кнопка скорости.
- **Волна:** 64 `span`-столбика, высота из `waveform`; сыгранная часть — класс
  `is-played` по индексу; цвета на токенах (`--accent` / `--muted-2`).
  Перемотка кликом и перетаскиванием (Pointer Events + `setPointerCapture`);
  клавиатура — `role="slider"`, `aria-valuenow/min/max`, стрелки ±5 с.
- **Время:** в покое — `duration_ms`, при игре — текущее. Для математики
  перемотки — `<audio>.duration`, если конечна, иначе `duration_ms`.
- **Скорость:** `stores/voicePlaybackStore.ts` (zustand), `1x → 1.5x → 2x`,
  применяется к `playbackRate` всех пузырей; `localStorage` в try/catch, при
  недоступном хранилище — `1x`.
- **Точка «не прослушано»** видна только при `listened === false`. На реальный
  `onPlay`, если зритель не автор и `!listened`: локально `listened = true` +
  `POST …/listen`; сбой — в лог, без отката. Автор своим прослушиванием точку не
  гасит.
- **WS:** `ChatArea` подписан на `voice_listened`; `listened = true`, если
  `user_id` — я (синхронизация устройств) или я автор вложения и `user_id` не я;
  иначе игнор.

### 3.4 `MessageRow`

Для сообщения с голосовым вложением действие «Редактировать» скрыто.
Удаление — как обычно.

## 4. i18n и доступность

Все строки — `ru` и `en` в одном коммите: aria-метки (микрофон, записать,
удалить запись, отправить запись, воспроизвести/пауза голосового, позиция,
скорость), подсказки (`hold`, `call`, `interrupted`), ошибки микрофона,
«← Отмена», коды `voice_invalid` / `voice_message_invalid`. Клавиатурный путь
на десктопе: Enter/Space на микрофоне → закреплённая запись; Tab до
«Удалить»/«Отправить»; Escape → удалить.

## 5. Тестирование и гейты

**TDD, в этом порядке:**

1. `voiceGesture` — каждый переход и порог; короткий клик; `inCall`; лимит;
   `interrupt` в `recording` и `locked`; клавиатурный путь; приоритет отмены.
2. Чистые: `pickMimeType`, `downsampleWaveform`, `formatTime`.
3. `voiceRecorder.release()` на фейковых треках — на каждом пути, включая
   ошибку `getUserMedia` посреди старта.
4. `sendVoice` — успех, падение загрузки, падение создания, retry по обоим
   путям, revoke.
5. `VoiceMessage` (React) — точка, один POST на первый `onPlay`, автор не шлёт
   POST, скорость циклится и сохраняется.
6. Существующие тесты `AudioPlayer` / `MessageAttachments` зелёные после выноса.

**Сервер:** `mediatype_test.go` (EBML `.weba` → audio, EBML `.webm` → video —
фиксация ловушки, `ftyp` `.m4a` → audio) + тест `VoiceFileName`; usecase на
моках (валидация voice, `voice_invalid` для не-audio, правило сообщения, отказ
`UpdateMessage`, listen: автор — no-op, нет права — 404, повтор без второго
события); хендлер (парсинг voice-частей, `204`); интеграционный тест
репозитория по образцу `migration025_integration_test.go` (CHECK, `ListenedFor`
для автора и получателя).

**Гейты:** до любых правок замерить серверную базовую линию `make test` /
`make vet` / `make lint` и записать её в план. Клиент — четыре гейта из
`CLAUDE.md` с их инвариантами.

**Руками, обе темы, узкая ширина:** удержание → отпускание → отправлено;
закрепление → отправить / удалить; свайп влево → отмена; клик < 1 с →
подсказка; запись в звонке → подсказка; воспроизведение вторым аккаунтом → у
отправителя точка гаснет в реальном времени; скорость; перемотка; клавиатурный
путь; самопочинка протухшей ссылки.

## 6. Git

Коммиты — только явными путями (никогда `git add -A` / `git add .`: в корне
неотслеживаемый `design_handoff_discord_redesign/`), без пуша, без co-author.
