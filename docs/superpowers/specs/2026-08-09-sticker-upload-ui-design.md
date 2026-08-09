# Кастомизация загрузки стикеров и поддержка GIF

**Тип**: feature
**Дата**: 2026-08-09

## Цель

Заменить нативный `<input type="file">` в менеджере стикеров на кастомную
drag-and-drop зону с предпросмотром и клиентской валидацией, а также расширить
поддерживаемые сервером и клиентом форматы стикеров с PNG/JPEG до PNG/JPEG/GIF.

## Требования

- Кастомная **drop-зона** (drag & drop + клик) для выбора файла стикера.
- **Предпросмотр** выбранного файла перед загрузкой (миниатюра + имя файла).
- Явный показ поддерживаемых форматов: **PNG, JPG, GIF** и лимита размера.
- **Клиентская валидация** до отправки: тип (`image/png`, `image/jpeg`,
  `image/gif`) и размер (≤ 2&nbsp;МБ). Ошибка показывается под зоной, файл не
  принимается.
- Сервер принимает **GIF** в дополнение к PNG/JPEG для стикеров.

## Решения

### 1. Поддержка GIF на сервере

`validateImage` (usecase/image.go) используется тремя целями: аватар
пользователя (`user.go`), иконка сервера (`server.go`) и стикер (`sticker.go`).
Расширение валидатора на GIF затронет все три — это приемлемо и согласовано:
аватары и иконки тоже становятся способны принимать GIF. Изменение единое и
обратно совместимое (GIF не ломает существующие PNG/JPEG-загрузки).

### 2. Формат определяется по содержимому

Сервер определяет тип по `http.DetectContentType(data)`, а не по имени файла в
multipart. Клиентский `uploadSticker` жёстко подставляет `sticker-<ts>.png` в
качестве имени — это не влияет на результат, но для корректности передаём
фактическое имя файла (`blob.name`).

## Бэкенд

### Валидатор `usecase/image.go`

- Добавить blank-импорт `_ "image/gif"` (чтобы `image.DecodeConfig` распознавал
  GIF).
- В `switch contentType` добавить case:
  ```go
  case "image/gif":
      ext = "gif"
  ```
- `image/gif` поддерживает `DecodeConfig`, то есть проверки размеров
  (32–4096&nbsp;px по каждой стороне) продолжают работать.
- Лимит размера файла (≤ 2&nbsp;МБ) и `contentType` без изменений для PNG/JPEG;
  для GIF возвращается `image/gif`.
- Обновить doc-комментарий функции и sentinel-ошибку `ErrUnsupportedAvatarFormat`
  (errors.go:22): текст «не PNG и не JPEG» → «не PNG, не JPEG и не GIF».

### Тест серверного валидатора GIF

Тест на уровне usecase: маленький валидный GIF (например, 1×1) проходит
`validateImage` → `ext == "gif"`, `contentType == "image/gif"`, без ошибки.
Невалидный/неподдерживаемый формат по-прежнему даёт `ErrUnsupportedAvatarFormat`.

## Клиент

### `StickerManager.tsx`

Заменить нативный `<input type="file" accept="image/png,image/jpeg">` на drop-зону:

- **Drop-зона** — скрытый `<input type="file" accept="image/png,image/jpeg,image/gif">`,
  по клику вызывается `.click()`; на `onDragOver`/`onDrop` принимается первый
  файл из `dataTransfer.files`. При drag-over добавляется класс активности.
- **Валидация при выборе**: проверяем `file.type` ∈ {`image/png`, `image/jpeg`,
  `image/gif`} и `file.size ≤ 2 * 1024 * 1024`. При несоответствии — ошибка под
  зоной, файл не сохраняется в state.
- **Предпросмотр**: при валидном файле показываем миниатюру
  (`URL.createObjectURL(file)` в `useEffect` с очисткой через `revokeObjectURL`)
  + имя файла.
- **Разделение выбора и отправки**: выбор файла кладёт файл в state; отправка
  идёт по кнопке (поля имени + превью), переиспользуя сохранённый `File`.
- **Состояния**: пусто / drag-over / файл выбран / ошибка / busy (кнопка
  отправки disabled).

### `api.ts`

`uploadSticker(serverId, name, blob)` — передавать фактическое имя файла:
`formData.append('image', blob, blob.name)`. Сигнатуру менять не требуется.

### `ChatArea.css`

Стили: `.sticker-dropzone`, `.sticker-dropzone.active`, `.sticker-dropzone.error`,
`.sticker-dropzone-hint`, `.sticker-dropzone-restrictions`, `.sticker-preview`,
`.sticker-preview img`, `.sticker-preview-info`, `.sticker-preview-actions`.

### i18n (`ru.ts` / `en.ts`)

Новые ключи в секции `chat:`:
- `stickerDropHint` — «Перетащите файл сюда или нажмите для выбора».
- `stickerFormats` — «PNG, JPG или GIF · до 2 МБ» / «PNG, JPEG or GIF · up to 2 MB».
- `stickerChooseFile` — «Выбрать файл».
- `stickerRemoveFile` — «Убрать».
- `stickerUpload` — «Загрузить».
- ошибки: `stickerInvalidFormat` — «Формат не поддерживается…»,
  `stickerFileTooLarge` — «Файл больше 2 МБ…» (или переиспользовать
  существующий `errors.sticker_file_too_large`; новое значение для локальной
  клиентской проверки).

## Файлы

- `server/internal/usecase/image.go`
- `server/internal/usecase/image_test.go` (новый)
- `server/internal/domain/errors.go`
- `client/src/components/StickerManager.tsx`
- `client/src/services/api.ts`
- `client/src/components/ChatArea.css`
- `client/src/i18n/locales/ru.ts`
- `client/src/i18n/locales/en.ts`

## Тесты

- **Сервер**: `go test ./internal/usecase/` — GIF-валидный проходит, PNG/JPEG не
  регрессируют.
- **Клиент**: `npx tsc --noEmit` и `npx vitest run` — существующие тесты (в т.ч.
  emojis) не ломаются. Чистая логика валидации файла выносится в отдельную
  функцию и покрывается unit-тестом (тип/размер).

## Не входит в объём

- Анимация/оптимизация GIF на сервере (пережатие, кадры).
- Другие форматы (WebP, APNG, SVG).
- Валидация типа аватара/иконки сервера отдельно от GIF (GIF принимается и там,
  это осознанное следствие единого валидатора).