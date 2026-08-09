# Отправка эмодзи и стикеров

**Тип**: feature
**Дата**: 2026-08-09

## Цель

Дать пользователям возможность отправлять смайлики (стандартные Unicode) и
стикеры (серверные картинки) в текстовых каналах. Иконки входа в оба пикера
размещаются в панели форматирования рядом с кнопкой «Маркированный список».

## Требования

- **Эмодзи** — только стандартный Unicode, встраиваются в текст как обычные
  символы. Бэкенд для эмодзи не меняется. Пикер с категориями, без поиска.
- **Стикеры** — серверные изображения. Загружает и удаляет владелец сервера и
  администраторы (право `PermManageServer`). Видны всем участникам сервера.
- Стикер отправляется как самостоятельное сообщение (картинка вместо текста).
- Иконки «Эмодзи» и «Стикеры» — рядом с «Маркированным списком» и в поле ввода,
  и в режиме редактирования.

## Решения

### 1. Хранение и представление стикер-сообщения

Выбран подход — отдельная колонка `sticker_id` на `messages`:

- Чистая семантика («сообщение-стикер»), рендер различает текст/стикер без
  догадок, стикер приходит вместе с метаданными для отображения.
- Побочный эффект — `messages.content` становится nullable.

### 2. Реализация пикеров

Самописные компоненты без сторонних зависимостей: вендоренный JSON-набор
эмодзи с категориями + грид картинок стикеров сервера. Подходит офлайн-native
Electron-приложению и минимализму проекта.

## Бэкенд

### Миграция `015_create_stickers`

```sql
-- \+migrate Up
CREATE TABLE IF NOT EXISTS stickers (
    id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    server_id   UUID NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
    name        TEXT NOT NULL,
    image_url   TEXT NOT NULL,
    created_by  UUID NOT NULL REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stickers_server_id ON stickers(server_id);

ALTER TABLE messages ADD COLUMN IF NOT EXISTS sticker_id UUID REFERENCES stickers(id) ON DELETE CASCADE;
ALTER TABLE messages ALTER COLUMN content DROP NOT NULL;
-- \+migrate Down
ALTER TABLE messages ALTER COLUMN content SET NOT NULL;
ALTER TABLE messages DROP COLUMN IF EXISTS sticker_id;
DROP TABLE IF EXISTS stickers;
```

### Домен

- `domain/sticker.go`:
  - `Sticker` entity: `ID`, `ServerID`, `Name`, `ImageURL`, `CreatedBy`, `CreatedAt`.
  - `StickerRepository`: `Create`, `ListByServer(serverID)`, `Delete(id)`.
- `domain/message.go`: `Message` получает полям
  `StickerID *uuid.UUID json:"sticker_id,omitempty"` и
  `Sticker *Sticker json:"sticker,omitempty"` (для рендера в ленте).

### Usecase

- `usecase/sticker.go`: `CreateSticker`, `ListStickers`, `DeleteSticker`.
  Все проверяют `perms.Resolve(serverID, userID).Has(PermManageServer)` —
  это даёт владельцу (обход `IsOwner`) и админам (обход `PermAdministrator`).
  Новое право вводить не требуется.
- `usecase/message.go`: `CreateMessage` принимает опциональный `stickerID`:
  - если задан — проверить, что стикер существует и принадлежит серверу канала,
    `content` при этом пустой;
  - иначе — как сейчас.

### REST API

| Метод | Endpoint | Описание |
|---|---|---|
| POST | `/api/v1/servers/{id}/stickers` | multipart «image» + поле «name». `PermManageServer`. Сохраняет файл через `filestorage`, создаёт строку |
| GET | `/api/v1/servers/{id}/stickers` | Список стикеров сервера |
| DELETE | `/api/v1/servers/{id}/stickers/{sticker_id}` | Удаление. `PermManageServer`. Удаляет файл и строку |

Отправка стикер-сообщения — расширение `POST /channels/{id}/messages`:
`{ "content": "", "sticker_id": "..." }`. Сервер включает вложенный
`sticker` в ответ и в WS-событие `chat_message`, чтобы все клиенты сервера
могли отрисовать картинку.

Валидация в handler: пустое `content` **и** пустой `sticker_id` → 400
`message content is required`; заданный `sticker_id` при непустом `content` → 400.

### Лента сообщений

`GET messages`, `getAround`, `search` перечисляют колонки явно —
добавляются чтение `sticker_id` и JOIN на `stickers` для вложенного объекта.
CASCADE по `sticker_id` гарантирует: удалённый стикер возвращается как `null`,
клиент показывает плейсхолдер вместо изображения.

## Клиент

- Иконки «Эмодзи» и «Стикеры» — рядом с «Маркированным списком»
  (`ChatArea.tsx`): в поле ввода (~стр. 837) и в режиме редактирования (~стр. 747).

### Эмодзи (только клиент)

- `src/utils/emojis.ts` — вендоренный JSON-набор `{ категория: [символы] }`
  с категориями: smileys, жесты, животные, еда, активности, объекты,
  символы, флаги.
- `src/components/EmojiPicker.tsx` — попап с табами категорий; клик вставляет
  символ в текстarea в позицию каретки (`setSelectionRange`), аналогично
  `insertLink`/`wrapSelection`. Доступен в составлении и редактировании.

### Стикеры

- `src/components/StickerPicker.tsx` — попап-грид стикеров текущего сервера,
  загружает список через `GET /servers/{id}/stickers`. Клик по стикеру →
  `sendSticker` → `POST /messages` с `{content:"", sticker_id}`.
  Расширение сигнатуры `apiService.createMessage(channelId, content, stickerID?)`.
- `src/components/StickerManager.tsx` — управление: список, удаление, загрузка
  нового файла. Доступен только при
  `can(permissions, PERMISSIONS.MANAGE_SERVER)`.
- Рендер: если `msg.sticker_id` — `<img className="message-sticker"
  src={msg.sticker.image_url}>` вместо `content`. Стикер-сообщения не
  редактируются (`startEdit` недоступен), удаление работает как обычно.

### Файлы клиента

- `src/components/EmojiPicker.tsx`
- `src/components/StickerPicker.tsx`
- `src/components/StickerManager.tsx`
- `src/utils/emojis.ts`
- CSS — в `ChatArea.css`

## Тесты

### Бэкенд (Go)

- `usecase/sticker` — права: владелец/админ создают, обычный участник — 403;
  создание, список, удаление.
- `usecase/message` — стикер-сообщение: несуществующий стикер и стикер чужого
  сервера → ошибка; `sticker_id` + непустой `content` → ошибка.
- `handler/sticker` — upload: слишком большой файл, неверный формат, без файла
  (по образцу `user_test.go` для аватара).
- `handler/message` — валидация body: пустое без стикера → 400; стикер с
  текстом → 400.

### Клиент (vitest)

- `emojis.ts` — набор корректен (значения непустые, категории непустые).
- Утилита вставки эмодзи по позиции каретки (при вынесении отдельно).

### E2E / граничные случаи

- Удалённый стикер: `sticker: null` → плейсхолдер «стикер удалён» в рендере.
- Повторный клик отключён на время запроса отправки.
- Пустой список стикеров → текст «В этом сервере пока нет стикеров».

## Open questions

- Нет открытых вопросов.

## Не входит в объём

- Кастомные эмодзи сервера (в тексте) — только стандартный Unicode.
- Встраивание стикеров в середину текста — только сообщение-стикер.
- Внутренние стикеры пользователя.