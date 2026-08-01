# Уникальность имени сервера (без учёта регистра) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Нельзя создать или переименовать сервер в имя, уже занятое другим сервером (сравнение без учёта регистра).

**Architecture:** Слойная защита: проверка `GetByName` в usecase (`CreateServer`, `UpdateServer`) + уникальный индекс `LOWER(name)` в БД (накатывается вручную на проде, в репозиторий не входит) + перевод unique violation (23505) в `ErrServerNameTaken` в postgres-репозитории для защиты от гонки. HTTP-слой транслирует `ErrServerNameTaken` в 409 с кодом `server_name_taken`; клиент показывает переведённое сообщение.

**Tech Stack:** Go (pgx v5), React/TS, zustand, i18n.

## Global Constraints

- Сравнение имён без учёта регистра — через `LOWER(name) = LOWER($1)` в SQL и уникальный индекс `CREATE UNIQUE INDEX idx_servers_name_lower ON servers (LOWER(name));` (выполняется пользователем на проде вручную, в коммиты не включается).
- Переименование сервера в своё же имя с другим регистром («Webvaha» → «webvaha») — успех, не ошибка.
- HTTP-статус конфликта: `409 Conflict`, код `server_name_taken`.
- Клиентские переводы добавляются в ОБА файла `ru.ts` и `en.ts` — скрипт `npm run check:i18n` падает при рассинхроне.
- Ветка: `VYC-57-server-is-unique` (уже создана, содержит дизайн-док).

---

### Task 1: Доменная ошибка, метод интерфейса и мок репозитория

**Files:**
- Modify: `server/internal/domain/errors.go:6-39`
- Modify: `server/internal/domain/server.go:53-68`
- Modify: `server/internal/usecase/message_test.go:88-143`

**Interfaces:**
- Consumes: ничего (базовый слой).
- Produces: `domain.ErrServerNameTaken`; `ServerRepository.GetByName(name string) (*Server, error)` (при отсутствии — `ErrServerNotFound`); `MockServerRepository.GetByName` для тестов usecase.

- [ ] **Step 1: Добавить сентинел-ошибку**

В `server/internal/domain/errors.go`, в конец блока `var ( ... )` (после строки `ErrInvalidRoleName`):

```go
	// ErrServerNameTaken — сервер с таким именем уже существует (без учёта регистра).
	ErrServerNameTaken = errors.New("server with this name already exists")
```

- [ ] **Step 2: Добавить метод в интерфейс репозитория**

В `server/internal/domain/server.go`, в `ServerRepository` (после строки с `GetByID`):

```go
	GetByID(id uuid.UUID) (*Server, error)
	// GetByName возвращает сервер с таким именем без учёта регистра.
	// ErrServerNotFound — если сервер с таким именем не существует.
	GetByName(name string) (*Server, error)
```

- [ ] **Step 3: Добавить метод в мок**

В `server/internal/usecase/message_test.go` (файл содержит `MockServerRepository`), сразу после метода `GetByID`:

```go
func (m *MockServerRepository) GetByName(name string) (*domain.Server, error) {
	args := m.Called(name)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Server), args.Error(1)
}
```

- [ ] **Step 4: Проверить сборку и тесты**

Run (workdir `server`): `go build ./... && go test ./...`
Expected: сборка и все тесты зелёные (мок реализует интерфейс, новых вызовов пока нет).

- [ ] **Step 5: Commit**

```bash
git add server/internal/domain/errors.go server/internal/domain/server.go server/internal/usecase/message_test.go
git commit -m "feat(server): сентинел ErrServerNameTaken и GetByName в интерфейсе репозитория"
```

---

### Task 2: Usecase `CreateServer` — проверка уникальности (TDD)

**Files:**
- Modify: `server/internal/usecase/server.go:41-66`
- Test: `server/internal/usecase/server_test.go`

**Interfaces:**
- Consumes: `domain.ErrServerNameTaken`, `serverRepo.GetByName(name string) (*Server, error)` из Task 1.
- Produces: `CreateServer` возвращает `domain.ErrServerNameTaken` при занятом имени (до `serverRepo.Create`).

- [ ] **Step 1: Написать падающий тест**

В `server/internal/usecase/server_test.go`, в конец файла (рядом с другими `TestCreateServer_*`):

```go
func TestCreateServer_NameTaken_ReturnsErr(t *testing.T) {
	ownerID := uuid.New()

	srvRepo := new(MockServerRepository)
	usrRepo := new(MockUserRepository)

	usrRepo.On("GetByID", ownerID).Return(&domain.User{ID: ownerID}, nil)
	srvRepo.On("GetByName", "Webvaha").Return(&domain.Server{ID: uuid.New(), Name: "Webvaha"}, nil)

	perms := new(MockPermissionUseCase)
	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), usrRepo, new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.CreateServer("Webvaha", ownerID)

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNameTaken)
	srvRepo.AssertNotCalled(t, "Create", mock.Anything)
}
```

- [ ] **Step 2: Обновить существующие тесты CreateServer**

В `server/internal/usecase/server_test.go` в ЧЕТЫРЁХ тестах, вызывающих `uc.CreateServer("Мой сервер", ...)` — `TestCreateServer_AddsOwnerAsMember` (строка ~31), `TestCreateServer_DefaultRoleCreationFails_ReturnsError` (~60), `TestCreateServer_DefaultRoleCreationFails_CompensatesByDeletingServer` (~90), `TestCreateServer_AddMemberFails_CompensatesByDeletingServer` (~121) — добавить после строки `srvRepo := new(MockServerRepository)`:

```go
	srvRepo.On("GetByName", "Мой сервер").Return(nil, domain.ErrServerNotFound)
```

И в ДВУХ компенсационных тестах поправить проверку порядка вызовов — `GetByName` теперь первый вызов, `Create` — второй:

```go
	require.Len(t, srvRepo.Calls, 4, "GetByName, Create, AddMember, Delete")
	createdServer := srvRepo.Calls[1].Arguments.Get(0).(*domain.Server)
```

(Замена строк `require.Len(t, srvRepo.Calls, 3, "Create, AddMember, Delete")` и `srvRepo.Calls[0]` в обоих тестах.)

- [ ] **Step 3: Запустить тесты — убедиться, что падают**

Run (workdir `server`): `go test ./internal/usecase/ -run 'TestCreateServer' -v`
Expected: FAIL — новый тест `TestCreateServer_NameTaken_ReturnsErr` не проходит (usecase пока не проверяет имя).

- [ ] **Step 4: Реализовать проверку в usecase**

В `server/internal/usecase/server.go`:

1. Добавить импорт `"errors"` в блок импортов.
2. В `CreateServer`, сразу после проверки владельца (`uc.userRepo.GetByID`), перед созданием структуры `server`:

```go
	existing, err := uc.serverRepo.GetByName(name)
	if err != nil && !errors.Is(err, domain.ErrServerNotFound) {
		return nil, fmt.Errorf("failed to check server name: %w", err)
	}
	if existing != nil {
		return nil, domain.ErrServerNameTaken
	}
```

(Обратите внимание: внутри функции переменная `err` уже объявлена на строке `_, err := uc.userRepo.GetByID(ownerID)` — переиспользуем её через `:=` с новой переменной `existing`.)

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run (workdir `server`): `go test ./internal/usecase/ -run 'TestCreateServer' -v`
Expected: PASS — все тесты `TestCreateServer_*` зелёные, включая новые.

- [ ] **Step 6: Commit**

```bash
git add server/internal/usecase/server.go server/internal/usecase/server_test.go
git commit -m "feat(server): запрет создания сервера с занятым именем (без учёта регистра)"
```

---

### Task 3: Usecase `UpdateServer` — проверка уникальности (TDD)

**Files:**
- Modify: `server/internal/usecase/server.go:304-320`
- Test: `server/internal/usecase/server_test.go`

**Interfaces:**
- Consumes: `serverRepo.GetByName` из Task 1, `ErrServerNameTaken` из Task 1.
- Produces: `UpdateServer` возвращает `ErrServerNameTaken`, если найденный по имени сервер имеет другой `ID`; переименование в своё же имя (другой регистр) — успех.

- [ ] **Step 1: Написать падающие тесты**

В `server/internal/usecase/server_test.go`, после `TestUpdateServer_Owner_Success`:

```go
func TestUpdateServer_NameTaken_ReturnsErr(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()
	takenID := uuid.New()

	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "old"}, nil)
	srvRepo.On("GetByName", "Webvaha").Return(&domain.Server{ID: takenID, Name: "Webvaha"}, nil)

	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.UpdateServer(serverID, ownerID, "Webvaha")

	assert.Nil(t, got)
	assert.ErrorIs(t, err, domain.ErrServerNameTaken)
	srvRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateServer_RenameToOwnNameDifferentCase_Success(t *testing.T) {
	serverID, ownerID := uuid.New(), uuid.New()

	srvRepo := new(MockServerRepository)
	perms := permsOwner(serverID, ownerID)

	srvRepo.On("GetByID", serverID).Return(&domain.Server{ID: serverID, OwnerID: ownerID, Name: "Webvaha"}, nil)
	srvRepo.On("GetByName", "webvaha").Return(&domain.Server{ID: serverID, Name: "webvaha"}, nil)
	srvRepo.On("Update", serverID, map[string]interface{}{"name": "webvaha"}).Return(nil)

	uc := usecase.NewServerUseCase(srvRepo, new(MockChannelRepository), new(MockUserRepository), new(MockRoleRepository), new(MockStorage), perms)
	got, err := uc.UpdateServer(serverID, ownerID, "webvaha")

	assert.NoError(t, err)
	assert.Equal(t, "webvaha", got.Name)
}
```

- [ ] **Step 2: Обновить существующий тест успеха**

В `TestUpdateServer_Owner_Success` (строка ~200) добавить мок свободного имени — после строки `srvRepo.On("GetByID", ...)`:

```go
	srvRepo.On("GetByName", "new").Return(nil, domain.ErrServerNotFound)
```

- [ ] **Step 3: Запустить тесты — убедиться, что падают**

Run (workdir `server`): `go test ./internal/usecase/ -run 'TestUpdateServer' -v`
Expected: FAIL — новые тесты не проходят (проверки имени в usecase нет).

- [ ] **Step 4: Реализовать проверку в usecase**

В `server/internal/usecase/server.go`, в `UpdateServer`, после блока `server, err := uc.serverRepo.GetByID(serverID)` и его обработки ошибок, перед `uc.serverRepo.Update(...)`:

```go
	existing, err := uc.serverRepo.GetByName(name)
	if err != nil && !errors.Is(err, domain.ErrServerNotFound) {
		return nil, fmt.Errorf("failed to check server name: %w", err)
	}
	if existing != nil && existing.ID != serverID {
		return nil, domain.ErrServerNameTaken
	}
```

(Импорт `"errors"` добавлен в Task 2, шаг 4.)

- [ ] **Step 5: Запустить тесты — убедиться, что проходят**

Run (workdir `server`): `go test ./internal/usecase/ -run 'TestUpdateServer' -v`
Expected: PASS — все тесты `TestUpdateServer_*` зелёные.

- [ ] **Step 6: Commit**

```bash
git add server/internal/usecase/server.go server/internal/usecase/server_test.go
git commit -m "feat(server): запрет переименования сервера в занятое имя"
```

---

### Task 4: Postgres-репозиторий — `GetByName` и перевод 23505

**Files:**
- Modify: `server/internal/repository/postgres/server.go`

**Interfaces:**
- Consumes: `domain.ErrServerNameTaken`, `domain.ErrServerNotFound` (из Task 1), интерфейс `GetByName` (Task 1).
- Produces: `serverRepository.Create` и `serverRepository.Update` возвращают `domain.ErrServerNameTaken` при unique violation (`23505`) — защита от гонки между проверкой в usecase и INSERT/UPDATE.

- [ ] **Step 1: Добавить импорт pgconn**

В `server/internal/repository/postgres/server.go`, в блок импортов, после строки с `"github.com/jackc/pgx/v5/pgxpool"`:

```go
	"github.com/jackc/pgx/v5/pgconn"
```

(Порядок импортов в gofmt-сортировке: `pgconn` идёт перед `pgx`, поправьте, если `gofmt`/`goimports` потребует.)

- [ ] **Step 2: Реализовать `GetByName`**

В `server/internal/repository/postgres/server.go`, после функции `GetByID` (строка ~80), добавить:

```go
func (r *serverRepository) GetByName(name string) (*domain.Server, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, name, icon_url, owner_id, created_at, updated_at
		FROM servers
		WHERE LOWER(name) = LOWER($1)
	`

	server := &domain.Server{}
	err := r.db.QueryRow(ctx, query, name).Scan(
		&server.ID,
		&server.Name,
		&server.IconURL,
		&server.OwnerID,
		&server.CreatedAt,
		&server.UpdatedAt,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("server name %s: %w", name, domain.ErrServerNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get server by name: %w", err)
	}

	return server, nil
}
```

- [ ] **Step 3: Добавить хелпер определения unique violation**

В тот же файл, после `GetByName` (или перед `Create`):

```go
// isUniqueNameViolation определяет, что ошибка — нарушение уникального
// индекса idx_servers_name_lower (CREATE UNIQUE INDEX ... LOWER(name)),
// который накатывается на проде вручную. Других уникальных ограничений
// в таблице servers нет, поэтому 23505 в Create/Update однозначно
// означает занятое имя.
func isUniqueNameViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
}
```

- [ ] **Step 4: Применить перевод в `Create`**

В `Create`, заменить блок обработки ошибки:

```go
	if err != nil {
		if isUniqueNameViolation(err) {
			return domain.ErrServerNameTaken
		}
		return fmt.Errorf("failed to create server: %w", err)
	}
```

- [ ] **Step 5: Применить перевод в `Update`**

В `Update`, заменить блок:

```go
	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		if isUniqueNameViolation(err) {
			return domain.ErrServerNameTaken
		}
		return fmt.Errorf("failed to update server: %w", err)
	}
```

- [ ] **Step 6: Проверить сборку и тесты**

Run (workdir `server`): `go build ./... && go vet ./... && go test ./...`
Expected: сборка и все юнит-тесты зелёные (postgres-слой юнит-тестами не покрыт — проверяется e2e в Task 7 и вручную на проде).

- [ ] **Step 7: Commit**

```bash
git add server/internal/repository/postgres/server.go
git commit -m "feat(server): GetByName и перевод 23505 в ErrServerNameTaken"
```

---

### Task 5: HTTP-слой — 409 Conflict и код `server_name_taken`

**Files:**
- Modify: `server/internal/delivery/http/httperr/httperr.go:62-68`
- Modify: `server/internal/delivery/http/handler/server.go:51-55, 467-487`

**Interfaces:**
- Consumes: `domain.ErrServerNameTaken` (Task 1), usecase из Tasks 2-3.
- Produces: `POST /api/v1/servers` и `PATCH /api/v1/servers/{id}` возвращают `409` с `{"error": "...", "code": "server_name_taken"}`.

- [ ] **Step 1: Добавить код ошибки**

В `server/internal/delivery/http/httperr/httperr.go`, в секцию «Серверы», после `CodeServerNameTooLong`:

```go
	CodeServerNameTaken   = "server_name_taken"
```

- [ ] **Step 2: Перевести `CreateServer` на `writeUseCaseError`**

В `server/internal/delivery/http/handler/server.go`, в `CreateServer`, заменить блок:

```go
	server, err := h.serverUseCase.CreateServer(req.Name, userID)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, err.Error())
		return
	}
```

на:

```go
	server, err := h.serverUseCase.CreateServer(req.Name, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
```

- [ ] **Step 3: Добавить кейс в `writeUseCaseError`**

В `writeUseCaseError`, после кейса `ErrServerNotFound`:

```go
	case errors.Is(err, domain.ErrServerNameTaken):
		h.sendError(w, http.StatusConflict, httperr.CodeServerNameTaken, "server with this name already exists")
```

- [ ] **Step 4: Проверить сборку и тесты**

Run (workdir `server`): `go build ./... && go test ./...`
Expected: сборка и тесты зелёные.

- [ ] **Step 5: Commit**

```bash
git add server/internal/delivery/http/httperr/httperr.go server/internal/delivery/http/handler/server.go
git commit -m "feat(api): 409 Conflict с кодом server_name_taken при занятом имени"
```

---

### Task 6: Клиент — переводы i18n и сообщение об ошибке в модалке создания

**Files:**
- Modify: `client/src/i18n/locales/ru.ts` (секция `errors`, ~строка 320)
- Modify: `client/src/i18n/locales/en.ts` (секция `errors`, ~строка 315)
- Modify: `client/src/pages/AppPage.tsx`

**Interfaces:**
- Consumes: HTTP-код `server_name_taken` (Task 5); `apiErrorText(err, t)` и класс `.modal-error` — уже существуют в клиенте (`client/src/services/api.ts:26`, `client/src/pages/AppPage.css:127`).
- Produces: пользователь видит «Сервер с таким именем уже существует» в модалке создания сервера; `EditServerModal` работает без изменений (уже использует `apiErrorText`).

- [ ] **Step 1: Добавить перевод в `ru.ts`**

В `client/src/i18n/locales/ru.ts`, в секцию `errors`, сразу после строки `server_name_too_long: 'Название сервера не длиннее 100 символов',`:

```ts
    server_name_taken: 'Сервер с таким именем уже существует',
```

- [ ] **Step 2: Добавить перевод в `en.ts`**

В `client/src/i18n/locales/en.ts`, в секцию `errors`, сразу после строки `server_name_too_long: 'Server name must be 100 characters or fewer',`:

```ts
    server_name_taken: 'A server with this name already exists',
```

- [ ] **Step 3: Обновить импорт в `AppPage.tsx`**

Строка 6 `import { apiService } from '@/services/api';` → 

```ts
import { apiService, apiErrorText } from '@/services/api';
```

- [ ] **Step 4: Добавить стейт ошибки**

Строка ~79, после `const [newServerName, setNewServerName] = useState('');`:

```ts
  const [createServerError, setCreateServerError] = useState('');
```

- [ ] **Step 5: Обновить `handleCreateServer`**

Заменить тело функции целиком (строки ~421-434):

```ts
  const handleCreateServer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;
    setCreateServerError('');

    try {
      const server = await apiService.createServer(newServerName.trim()) as Server;
      setServers([...servers, server]);
      setNewServerName('');
      setShowCreateServer(false);
      handleSelectServer(server);
    } catch (err) {
      setCreateServerError(apiErrorText(err, t));
    }
  };
```

- [ ] **Step 6: Обновить модалку**

В JSX модалки создания сервера (строки ~473-502):

1. Overlay (закрытие по клику на фон) — сброс ошибки:
```tsx
        <div className="modal-overlay" onClick={() => { setShowCreateServer(false); setCreateServerError(''); }}>
```
2. Input — сброс ошибки при вводе:
```tsx
                  onChange={(e) => { setNewServerName(e.target.value); setCreateServerError(''); }}
```
3. После закрывающего `</div>` form-group, перед `modal-actions`, вывод ошибки (паттерн `EditServerModal.tsx:131`):
```tsx
              {createServerError && <p className="modal-error">{createServerError}</p>}
```

- [ ] **Step 7: Проверить типы, сборку и i18n**

Run (workdir `client`): `npm run build:vite && npm run check:i18n`
Expected: `tsc` без ошибок, vite-сборка успешна, скрипт `check:i18n` не находит рассинхрона ключей (в `ru.ts` и `en.ts`).

- [ ] **Step 8: Commit**

```bash
git add client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts client/src/pages/AppPage.tsx
git commit -m "feat(client): сообщение о занятом имени сервера при создании"
```

---

### Task 7: E2E-тест дубликата имени

**Files:**
- Modify: `server/tests/e2e_test.go:71-93`

**Interfaces:**
- Consumes: `doJSON(t, method, path, token, body)` (уже есть, `server/tests/e2e_test.go:367`); API из Task 5.
- Produces: E2E-сценарий «повторное создание с тем же именем → 409 + code server_name_taken». Работает и без индекса в БД (проверка в usecase срабатывает первой).

- [ ] **Step 1: Добавить субтест**

В `TestServerFlow` (`server/tests/e2e_test.go`), после существующего субтеста `"create server"` (строки 78-92), до закрывающей `}` функции:

```go
	t.Run("duplicate server name rejected", func(t *testing.T) {
		status, body := doJSON(t, http.MethodPost, "/api/v1/servers", token, map[string]any{"name": "test server"})
		assert.Equal(t, http.StatusConflict, status)

		var resp struct {
			Code string `json:"code"`
		}
		require.NoError(t, json.Unmarshal(body, &resp))
		assert.Equal(t, "server_name_taken", resp.Code)
	})
```

- [ ] **Step 2: Проверить сборку**

Run (workdir `server`): `go vet ./tests/ && go build ./...`
Expected: без ошибок. Запуск e2e требует живого сервера с БД (`RUN_E2E=true`) — локально пропускается, запускается вручную/на CI.

- [ ] **Step 3: Commit**

```bash
git add server/tests/e2e_test.go
git commit -m "test(e2e): повторное создание сервера с тем же именем отклоняется (409)"
```

---

## Self-Review

**Спека → план:** ошибка/интерфейс (Task 1), usecase Create/Update (Tasks 2-3), репозиторий + 23505 (Task 4), httperr + handler 409 (Task 5), клиент i18n + AppPage (Task 6), e2e (Task 7). Без миграции — по решению пользователя. Все пункты спеки покрыты.
**Заполнители:** кода нет, каждая команда с ожидаемым результатом.
**Типы:** `GetByName(name string) (*Server, error)` одинаков во всех задачах; `ErrServerNameTaken`, `server_name_taken`, `createServerError`, `setCreateServerError` названы единообразно.

## Проверка после всех задач (финальная)

Run (workdir `server`): `go build ./... && go vet ./... && go test ./...`
Run (workdir `client`): `npm run build:vite && npm run check:i18n`

На проде (вручную, пользователем): `CREATE UNIQUE INDEX idx_servers_name_lower ON servers (LOWER(name));` — индекс НЕ входит в коммиты, накатывается отдельно.
