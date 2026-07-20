# VYC-39: Поиск сообщений по контенту — дизайн

Дата: 2026-07-20
Задача с борды: «Добавить поиск сообщений по контенту»

## Цель

Пользователь может искать сообщения по тексту в текущем канале: иконка-лупа в
шапке чата или `Ctrl+Shift+F` открывают панель поиска; клик по результату
переносит к сообщению в ленте.

## Решения (утверждены)

- **Охват:** только текущий канал (не весь сервер).
- **UI результатов:** панель справа (как в Discord), чат остаётся виден.
- **Переход:** полный — новый эндпоинт «сообщения вокруг ID», работает для
  сообщений любой давности.
- **Механизм поиска:** `ILIKE` подстрока + GIN-индекс `pg_trgm`.
  Предсказуемое поведение, простая подсветка на клиенте.

## Бэкенд

### Миграция `008_messages_search`

```sql
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE INDEX idx_messages_content_trgm ON messages USING GIN (content gin_trgm_ops);
```

Down: дроп индекса (extension не дропаем — может использоваться другими).

### Репозиторий (`internal/repository/postgres/message.go`)

- `Search(channelID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error)`
  - `WHERE channel_id = $1 AND content ILIKE '%' || $2 || '%'`
  - Спецсимволы `%`, `_`, `\` в запросе экранируются (`ESCAPE '\'`).
  - `ORDER BY created_at DESC`, limit/offset; вторым значением — общий счётчик
    (`COUNT(*)` тем же фильтром).
  - JOIN `users` → в результате сразу `username` (клиент не делает N запросов).
- `GetAround(channelID, messageID uuid.UUID, limit int) ([]*domain.Message, error)`
  - Контекст вокруг сообщения: до `limit` сообщений с `(created_at, id) <=`
    целевого + до `limit` после, отсортировано по возрастанию.
  - Если сообщение не найдено/из другого канала → `domain.ErrMessageNotFound`.

### Domain

- Тип `MessageWithAuthor` (`Message` + `Username string`).
- Расширение интерфейсов `MessageRepository` и `MessageUseCase`.

### Usecase (`internal/usecase/message.go`)

- `SearchMessages(channelID, userID, query, limit, offset)` —
  `requireMembership`, затем repo.Search.
- `GetMessagesAround(channelID, messageID, userID, limit)` —
  `requireMembership`, затем repo.GetAround.

### Handler + роуты (`cmd/api/main.go`)

- `GET /api/v1/channels/{channel_id}/messages/search?q=&limit=&offset=`
  → `200 {"results": [...], "total": N}`; `results` — `[]MessageWithAuthor`.
- `GET /api/v1/channels/{channel_id}/messages/around/{message_id}?limit=`
  → `200 []Message`.
- Валидация: `q` после trim — 2..100 символов (иначе 400), `limit` дефолт 25,
  кэп 50. Ошибки — через существующий `writeUseCaseError`.

## Клиент

### Новый компонент `MessageSearch.tsx` + `MessageSearch.css`

Отдельный файл (ChatArea.tsx уже 711 строк). Пропсы: `channel`,
`onJumpToMessage(messageId)`, `onClose`.

- **Открытие/закрытие:** иконка-лупа в `chat-header` справа; `Ctrl+Shift+F`
  toggle (keydown-слушатель в ChatArea); `Esc` и крестик закрывают. При
  открытии фокус в поле ввода.
- **Панель:** справа, ширина 360px, slide-in анимация; на мобильном (<768px)
  оверлей на всю ширину. Стили на существующих CSS-переменных темы.
- **Живой поиск:** debounce 300 мс, минимум 2 символа. Состояния: подсказка
  (idle), спиннер (loading), «Ничего не найдено» (empty), ошибка, счётчик
  «Найдено: N».
- **Карточка результата:** аватар-буква, автор (username из ответа), дата
  (`12 июл, 14:03`), текст с подсветкой совпадения через `<mark>`
  (регистронезависимо); длинный текст обрезается окном вокруг первого
  совпадения. Карточка кликабельна целиком.
- **Пагинация:** кнопка «Показать ещё» пока `results.length < total`.
- Смена канала сбрасывает и закрывает поиск.

### Переход к сообщению (ChatArea)

1. `apiService.getMessagesAround(channelId, messageId)` →
   `setMessages(контекст)`.
2. Скролл к сообщению (центр вьюпорта) + подсветка-вспышка ~2 сек
   (CSS-анимация фона).
3. Режим «просмотр истории»: плавающая кнопка «↓ К последним сообщениям»
   перезагружает свежие сообщения (существующий `getMessages`) и возвращает
   автоскролл.
4. Автоскролл-`useEffect` по `messages` получает guard-флаг, чтобы не
   утаскивать вниз после перехода; новые WS-сообщения в режиме истории ленту
   не дёргают (кнопка возврата остаётся).

### API-сервис (`services/api.ts`)

- `searchMessages(channelId, q, limit, offset)`
- `getMessagesAround(channelId, messageId)`

## Тесты

- Usecase: `SearchMessages`/`GetMessagesAround` — membership-проверка
  (ErrForbidden), прокидывание в repo (моки по образцу существующих).
- Handler: валидация `q` (пусто/короткое → 400), успешный ответ с
  `results`/`total`, невалидные UUID → 400.
- Repo (если есть интеграционные): экранирование `%`/`_` — сообщение `100%`
  находится по запросу `100%`, запрос `%` не матчит всё подряд.
- Клиент: ручная проверка — поиск, переход к старому сообщению, возврат вниз,
  хоткей, Esc, мобильная ширина.

## Вне скоупа (YAGNI)

Фильтры по автору/дате, поиск по всему серверу, морфология (tsvector),
infinite scroll ленты, подсветка всех совпадений в ленте.
