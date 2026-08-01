# Уникальность имени сервера (без учёта регистра)

**Дата:** 2026-08-01
**Область:** бэкенд (`server/`) + клиент (`client/src/`).

## Проблема

Сейчас можно создать сколько угодно серверов с одинаковым именем, отличающихся только регистром («Webvaha» и «webvaha»). Требование: имя сервера уникально по всей системе без учёта регистра — при создании и при переименовании.

## Решение

### Гарантия уникальности на уровне БД (без миграции)

Отдельной миграции нет — пользователь вручную выполнит на проде:

```sql
CREATE UNIQUE INDEX idx_servers_name_lower ON servers (LOWER(name));
```

Индекс не закоммичивается в репозиторий. Дублей в БД нет (проверено пользователем на проде), чистка не требуется.

### Бэкенд

1. **`server/internal/domain/errors.go`** — новый сентинел:
   ```go
   ErrServerNameTaken = errors.New("server with this name already exists")
   ```

2. **`server/internal/domain/server.go`** — в `ServerRepository` новый метод:
   ```go
   GetByName(name string) (*Server, error)
   ```
   Поиск по `WHERE LOWER(name) = LOWER($1)`, при отсутствии строк — `ErrServerNotFound`.

3. **`server/internal/repository/postgres/server.go`**:
   - реализация `GetByName`;
   - в `Create` и `Update`: ошибка unique violation (`pgconn.PgError`, `Code == "23505"`) → вернуть `ErrServerNameTaken`. Других уникальных ограничений в `servers` нет, срабатывание 23505 однозначно означает занятое имя. Защита от гонки «две проверки прошли → два INSERT».

4. **`server/internal/usecase/server.go`**:
   - `CreateServer`: перед вставкой `GetByName(name)`; если найден — `ErrServerNameTaken`. Ошибку из `serverRepo.Create` пробрасывать как есть (репозиторий уже переводит 23505 в `ErrServerNameTaken`).
   - `UpdateServer`: `GetByName(name)`; если найден **и `found.ID != serverID`** — `ErrServerNameTaken`. Переименование сервера в своё же имя с другим регистром («Webvaha» → «webvaha») — успех.
   - Репозиторий и другие шаги не меняются (компенсация при неудаче и пр.).

5. **`server/internal/delivery/http/httperr/httperr.go`** — новый код:
   ```go
   CodeServerNameTaken = "server_name_taken"
   ```

6. **`server/internal/delivery/http/handler/server.go`**:
   - `CreateServer`: вместо безусловного 500 — `writeUseCaseError` (или явный кейс);
   - в `writeUseCaseError` добавить:
     ```go
     case errors.Is(err, domain.ErrServerNameTaken):
         h.sendError(w, http.StatusConflict, httperr.CodeServerNameTaken, "server with this name already exists")
     ```
   - `UpdateServer` уже использует `writeUseCaseError` — заработает автоматически.

### Клиент

7. **`client/src/i18n/locales/ru.ts`** и **`en.ts`** — ключ `server_name_taken`:
   - ru: «Сервер с таким именем уже существует»
   - en: «A server with this name already exists»

8. **`client/src/pages/AppPage.tsx`** — модалка создания сервера: добавить `error`-стейт, в `handleCreateServer` на ошибке `setError(apiErrorText(err, t))` (сейчас — только `console.error`), выводить под полем ввода (по образцу `.auth-error`), сбрасывать при закрытии модалки и новом вводе.

9. **`client/src/components/EditServerModal.tsx`** — уже использует `apiErrorText(err, t)` и показывает ошибку; правок не требует.

## Тесты

- `server/internal/usecase/server_test.go` (моки, `MockServerRepository` — добавить `GetByName`):
  - создание сервера с занятым именем → `ErrServerNameTaken`;
  - создание со свободным именем → успех (существующий флоу, дополнить мок);
  - переименование в занятое имя → `ErrServerNameTaken`;
  - переименование в своё же имя с другим регистром → успех.
- `server/tests/e2e_test.go`: в `TestServerFlow` после создания сервера «Test Server» попытаться создать «test server» тем же пользователем → ожидается 409. Тест работает и без индекса в БД (use-case проверка срабатывает), индекс в БД тесту не нужен.
- Перевод 23505 → `ErrServerNameTaken` живёт в postgres-репозитории; unit-покрытие невозможно (мок подменяет сам репозиторий) — этот слой закрыт e2e/ручной проверкой после наката индекса.

## Что сознательно не делаем (вне скоупа)

- Миграция для индекса — по решению пользователя, индекс накатывается вручную на проде.
- Проверка имени на лишние пробелы в `CreateServer` (в `UpdateServer` `TrimSpace` уже есть) — не связано с уникальностью.
- Уникальность каналов — отдельная история, не трогаем.

## Проверка

- `go test ./...` в `server/` — все тесты зелёные.
- `npm run build` / `npm run lint` в `client/` — сборка и линт без ошибок.
- Ручная проверка на dev-БД: выполнить `CREATE UNIQUE INDEX idx_servers_name_lower ON servers (LOWER(name));`, создать сервер «Test», попытаться создать «test» — ожидается 409 с `server_name_taken` и сообщение в модалке; переименовать сервер «Test» в «TEST» — успех.
