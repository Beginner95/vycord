# Номер телефона пользователя — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Пользователь может сохранить номер телефона в настройках, искать других по номеру при отправке заявки в друзья и контролировать доступность такого поиска.

**Architecture:** Номер хранится ТОЛЬКО зашифрованным: `phone_index` (детерминированный HMAC-SHA256-ключ для поиска и уникальности) + `phone_cipher` (AES-256-GCM, случайный nonce). Ключ — `PHONE_ENC_KEY` в env. Сервер: новые эндпоинты PUT/DELETE `/users/me/phone`, расширение PATCH privacy, `SendRequest` принимает `username` ИЛИ `phone`. Клиент: строка в настройках профиля (маска с сервера), тумблер приватности, автодетект в `AddFriendForm`.

**Tech Stack:** Go (pgx, stdlib crypto), PostgreSQL, React 19 + TypeScript + Vitest, Zustand, i18n ru/en.

**Спека:** `docs/superpowers/specs/2026-09-26-phone-number-design.md`

## Global Constraints

- Номер никогда не хранится и не передаётся открытым текстом: БД — только `phone_index`/`phone_cipher`; наружу — только маска `phone_masked` в ответах «про себя».
- Ключ `PHONE_ENC_KEY` (env, 64 hex = 32 байта AES-256) обязателен — сервер не стартует без него.
- Гейты сервера (из корня репо): `make test`, `make vet`, `make lint`, `make build`.
- Гейты клиента (из `client/`): `npx tsc --noEmit` (0 байт), `npx stylelint "src/**/*.css"` (0 байт), `npm run check:i18n` («непереведённых строк не найдено.»), `npm test` (ровно 3 фейла, все в `api.network-retry.test.ts`, не чинить).
- i18n: ru и en меняются в одном коммите; `Dictionary` типизирован от `ru.ts`.
- Никогда `git add -A` — только явные пути (иначе в коммит уедет `design_handoff_discord_redesign/`).
- `phone_index` детерминирован (одинаковый ввод → одинаковое значение) — иначе UNIQUE и поиск сломаны. `phone_cipher` — каждый раз разный (случайный nonce).
- Проверочные строки: «8 912 345-67-89» → `+79123456789`; маска `+79123 ••• •• 89`.

---

### Task 1: Миграция 026 + PHONE_ENC_KEY

**Files:**
- Create: `server/migrations/026_phone.up.sql`, `server/migrations/026_phone.down.sql`
- Modify: `server/internal/config/config.go` (структура + `New()`), `server/internal/config/config_test.go`
- Modify: `.env`, `.env.example`, `.env.prod.example`

**Interfaces:**
- Produces: `config.Config.PhoneEncKey string` (hex, 64 символа, валидировано). Колонки `users.phone_index UNIQUE`, `users.phone_cipher`, `users.allow_search_by_phone BOOLEAN NOT NULL DEFAULT true`, `users.phone_verified_at TIMESTAMPTZ`.

- [ ] **Step 1: Написать падающие тесты конфига**

В `server/internal/config/config_test.go` — в `setRequiredEnv` добавить ключ (БЕЗ него все существующие тесты конфига упадут после обязательности):

```go
func setRequiredEnv(t *testing.T) {
	t.Helper()
	t.Setenv("JWT_SECRET", "x")
	t.Setenv("SMTP_HOST", "localhost")
	t.Setenv("SMTP_FROM", "noreply@example.com")
	t.Setenv("OTP_SECRET", "otp-test-secret")
	t.Setenv("PHONE_ENC_KEY", strings.Repeat("ab", 32)) // 64 hex-символа
}
```
(импорт `strings` добавить в import-блок, если его нет)

Новые тесты (в конец файла):

```go
func TestPhoneEncKeyRequired(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("PHONE_ENC_KEY", "")

	_, err := config.New()

	require.ErrorContains(t, err, "PHONE_ENC_KEY")
}

func TestPhoneEncKeyMustBe64Hex(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("PHONE_ENC_KEY", "abc")

	_, err := config.New()

	require.ErrorContains(t, err, "64 hex")
}

func TestPhoneEncKeyParsed(t *testing.T) {
	setRequiredEnv(t)
	t.Setenv("PHONE_ENC_KEY", strings.Repeat("cd", 32))

	cfg, err := config.New()

	require.NoError(t, err)
	assert.Equal(t, strings.Repeat("cd", 32), cfg.PhoneEncKey)
}
```

- [ ] **Step 2: Убедиться, что тесты падают**

Run: `go test ./internal/config/...` (из `server/`).
Expected: FAIL — ошибок про PHONE_ENC_KEY нет.

- [ ] **Step 3: Реализовать конфиг**

В `server/internal/config/config.go`: поле в структуру:

```go
	// PhoneEncKey — ключ AES-256 для шифрования номеров телефонов
	// (users.phone_cipher) и детерминированного поискового индекса
	// (users.phone_index). 64 hex-символа = 32 байта. Один на все номера;
	// ротация требует перешифрования всех номеров — не в скоупе.
	PhoneEncKey string
```

В `New()` рядом с проверками OTP_SECRET:

```go
	phoneEncKey := getEnv("PHONE_ENC_KEY", "")
	if phoneEncKey == "" {
		return nil, fmt.Errorf("PHONE_ENC_KEY environment variable is required")
	}
	if decoded, err := hex.DecodeString(phoneEncKey); err != nil || len(decoded) != 32 {
		return nil, fmt.Errorf("PHONE_ENC_KEY must be 64 hex characters (32 bytes)")
	}
```
(импорт `encoding/hex`)

В сборке `cfg`:

```go
		PhoneEncKey: phoneEncKey,
```

- [ ] **Step 4: Прогнать тесты конфига**

Run: `go test ./internal/config/...`
Expected: PASS (все три новых + существующие — существующие не сломались, потому что `setRequiredEnv` теперь ставит и PHONE_ENC_KEY).

- [ ] **Step 5: Создать миграции**

`server/migrations/026_phone.up.sql`:

```sql
-- +migrate Up
-- Номер телефона (VYC-97): только зашифрованный. phone_index — детерминированный
-- поисковый ключ (HMAC-SHA256), phone_cipher — AES-256-GCM значение.
-- Открытым текстом номер не хранится никогда.
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_index TEXT UNIQUE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_cipher TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS allow_search_by_phone BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verified_at TIMESTAMPTZ;
```

`server/migrations/026_phone.down.sql`:

```sql
-- +migrate Down
ALTER TABLE users
    DROP COLUMN IF EXISTS phone_index,
    DROP COLUMN IF EXISTS phone_cipher,
    DROP COLUMN IF EXISTS allow_search_by_phone,
    DROP COLUMN IF EXISTS phone_verified_at;
```

- [ ] **Step 6: Дописать env-файлы**

`.env` (пример реального значения — сгенерировать: `openssl rand -hex 32`):

```
PHONE_ENC_KEY=<64 hex символа, openssl rand -hex 32>
```

`.env.example` и `.env.prod.example` — та же строка с плейсхолдером `PHONE_ENC_KEY=CHANGE_ME_64_HEX_CHARS`, рядом комментарий:

```
# Ключ AES-256 для шифрования номеров телефонов (64 hex = 32 байта).
# Обязателен: сервер не стартует без него.
```

- [ ] **Step 7: Коммит**

```bash
git add server/migrations/026_phone.up.sql server/migrations/026_phone.down.sql server/internal/config/config.go server/internal/config/config_test.go .env .env.example .env.prod.example
git commit -m "VYC-97: миграция phone и обязательный PHONE_ENC_KEY"
```

---

### Task 2: pkg/phonecrypto

**Files:**
- Create: `server/pkg/phonecrypto/phonecrypto.go`, `server/pkg/phonecrypto/phonecrypto_test.go`

**Interfaces:**
- Consumes: ключ `[]byte` (32 байта).
- Produces (сигнатуры, на которые опираются Task 4–7):

```go
var ErrInvalidPhone = errors.New("invalid phone number")

func Normalize(raw string) (string, error)      // "+79123456789" или ErrInvalidPhone
func Index(key []byte, normalized string) (string, error) // hex HMAC-SHA256(key, "phone:"+normalized)
func Encrypt(key []byte, plain string) (string, error)    // base64(nonce||ct), AES-256-GCM
func Decrypt(key []byte, blob string) (string, error)
func Mask(normalized string) string              // "+79123 ••• •• 89"
```

- [ ] **Step 1: Написать падающие тесты**

`server/pkg/phonecrypto/phonecrypto_test.go`:

```go
package phonecrypto

import (
	"strings"
	"testing"
)

var keyBytes = []byte("0123456789abcdef0123456789abcdef") // 32 байта

func TestNormalize(t *testing.T) {
	cases := []struct{ in, want string }{
		{"8 912 345-67-89", "+79123456789"},
		{"+7 (912) 345-67-89", "+79123456789"},
		{"+79123456789", "+79123456789"},
		{"89123456789", "+79123456789"},
		{"+7 912 345 67 89", "+79123456789"},
	}
	for _, c := range cases {
		got, err := Normalize(c.in)
		if err != nil {
			t.Fatalf("Normalize(%q): %v", c.in, err)
		}
		if got != c.want {
			t.Errorf("Normalize(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

func TestNormalizeInvalid(t *testing.T) {
	for _, in := range []string{"", "   ", "abc", "123", "+12345", "8", "8-912-345-67-8a", "++7912", "+7 912 345 678 901 234 567"} {
		if _, err := Normalize(in); err == nil {
			t.Errorf("Normalize(%q) expected error", in)
		}
	}
}

func TestIndexDeterministic(t *testing.T) {
	a, err := Index(keyBytes, "+79123456789")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := Index(keyBytes, "+79123456789")
	if a != b {
		t.Fatal("index must be deterministic for the same number")
	}
	c, _ := Index(keyBytes, "+79998887766")
	if a == c {
		t.Fatal("different numbers must produce different indexes")
	}
}

func TestEncryptDecryptRoundTrip(t *testing.T) {
	blob, err := Encrypt(keyBytes, "+79123456789")
	if err != nil {
		t.Fatal(err)
	}
	plain, err := Decrypt(keyBytes, blob)
	if err != nil {
		t.Fatal(err)
	}
	if plain != "+79123456789" {
		t.Fatalf("round trip = %q", plain)
	}
}

func TestEncryptRandomized(t *testing.T) {
	a, _ := Encrypt(keyBytes, "+79123456789")
	b, _ := Encrypt(keyBytes, "+79123456789")
	if a == b {
		t.Fatal("ciphertexts must differ (random nonce)")
	}
}

func TestDecryptWrongKeyFails(t *testing.T) {
	blob, _ := Encrypt(keyBytes, "+79123456789")
	_, err := Decrypt([]byte(strings.Repeat("x", 32)), blob)
	if err == nil {
		t.Fatal("expected error on wrong key")
	}
}

func TestMask(t *testing.T) {
	if got := Mask("+79123456789"); got != "+79123 ••• •• 89" {
		t.Fatalf("Mask = %q", got)
	}
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `go test ./pkg/phonecrypto/...`
Expected: FAIL — «undefined: Normalize».

- [ ] **Step 3: Реализовать пакет**

`server/pkg/phonecrypto/phonecrypto.go`:

```go
// Package phonecrypto — шифрование номеров телефонов (VYC-97).
//
// Номер в открытом виде не хранится нигде: в users лежат только
// phone_index (детерминированный HMAC-SHA256-ключ — по нему идёт поиск и
// проверка уникальности) и phone_cipher (AES-256-GCM со случайным nonce —
// расшифровать можно только с ключом). Ключ — PHONE_ENC_KEY из окружения,
// ровно 32 байта, один на все номера (это секрет, не хранить в коде/БД).
package phonecrypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"regexp"
	"strings"
)

// ErrInvalidPhone — строка не является нормализуемым телефонным номером.
var ErrInvalidPhone = errors.New("invalid phone number")

// indexPrefix отделяет телефонные индексы от любых других HMAC-сущностей в
// будущем: один ключ на два разных применения — дыра в конструкциях HMAC.
const indexPrefix = "phone:"

var phoneRe = regexp.MustCompile(`^\+[0-9]{10,14}$`)

// Normalize приводит номер к каноничной форме E.164-фрагмента "+7XXXXXXXXXX":
// убирает пробелы/тире/скобки, заменяет ведущую 8 на +7, оставляет только
// допустимые символы. Итог обязан быть `+` + 10..14 цифр.
func Normalize(raw string) (string, error) {
	s := strings.TrimSpace(raw)
	if s == "" {
		return "", ErrInvalidPhone
	}
	var b strings.Builder
	for _, r := range s {
		switch {
		case r >= '0' && r <= '9', r == '+':
			b.WriteRune(r)
		case r == ' ' || r == '-' || r == '(' || r == ')':
			// разделители пропускаем
		default:
			return "", ErrInvalidPhone
		}
	}
	s = b.String()
	if strings.HasPrefix(s, "8") {
		s = "+7" + s[1:]
	}
	if !phoneRe.MatchString(s) {
		return "", ErrInvalidPhone
	}
	return s, nil
}

// Index — детерминированный поисковый ключ номера: hex(HMAC-SHA256(key,
// "phone:"+normalized)). Тот же ввод → то же значение, поэтому колонка
// users.phone_index может быть UNIQUE и по ней работает равенство в WHERE.
func Index(key []byte, normalized string) (string, error) {
	if len(key) != 32 {
		return "", errors.New("phone key must be 32 bytes")
	}
	mac := hmac.New(sha256.New, key)
	_, _ = mac.Write([]byte(indexPrefix + normalized))
	return hex.EncodeToString(mac.Sum(nil)), nil
}

// Encrypt шифрует нормализованный номер AES-256-GCM и возвращает
// base64(nonce || ciphertext). Nonce случайный на каждое шифрование —
// одинаковые номера неразличимы по шифротексту.
func Encrypt(key []byte, plain string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	nonce := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return "", err
	}
	sealed := gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(sealed), nil
}

// Decrypt расшифровывает значение, сохранённое Encrypt. Неверный ключ или
// повреждённые данные дают ошибку (GCM-тег).
func Decrypt(key []byte, blob string) (string, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}
	raw, err := base64.StdEncoding.DecodeString(blob)
	if err != nil {
		return "", err
	}
	if len(raw) < gcm.NonceSize() {
		return "", errors.New("cipher blob too short")
	}
	nonce, ct := raw[:gcm.NonceSize()], raw[gcm.NonceSize():]
	plain, err := gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}

// Mask прячет номер для показа: первые 6 символов (+7 + 4 цифры), затем
// " ••• •• " и последние 2 цифры.
func Mask(normalized string) string {
	if len(normalized) < 8 {
		return normalized
	}
	return normalized[:6] + " ••• •• " + normalized[len(normalized)-2:]
}
```

- [ ] **Step 4: Прогнать тесты**

Run: `go test ./pkg/phonecrypto/...`
Expected: PASS.

- [ ] **Step 5: Коммит**

```bash
git add server/pkg/phonecrypto/phonecrypto.go server/pkg/phonecrypto/phonecrypto_test.go
git commit -m "VYC-97: пакет phonecrypto (blind index + AES-256-GCM)"
```

---

### Task 3: domain + postgres-репозиторий для телефонных колонок

**Files:**
- Modify: `server/internal/domain/user.go`, `server/internal/domain/errors.go`
- Modify: `server/internal/repository/postgres/user.go`
- Modify: `server/internal/usecase/auth_test.go` (MockUserRepository)

**Interfaces:**
- Consumes: `phonecrypto` (Task 2).
- Produces — новые поля `domain.User`:

```go
PhoneIndex         *string    `json:"-"`
PhoneCipher        *string    `json:"-"`
PhoneVerifiedAt    *time.Time `json:"-"`
AllowSearchByPhone bool       `json:"-"`
PhoneMasked        *string    `json:"phone_masked,omitempty"`
```

Новые методы `UserRepository`:

```go
GetByPhoneIndex(index string) (*User, error) // ErrUserNotFound если нет
SetPhone(id uuid.UUID, index, cipher string) error // ErrPhoneTaken при 23505
ClearPhone(id uuid.UUID) error // идемпотентна
```

- [ ] **Step 1: Поля и ошибки в домене**

`server/internal/domain/user.go` — добавить в `User` (после `AllowDMFrom`, перед закрывающей скобкой), с доменными комментариями в стиле файла:

```go
	// PhoneIndex — детерминированный поисковый ключ номера телефона
	// (HMAC-SHA256 от нормализованного номера). UNIQUE (миграция 026).
	// json:"-": номер — личные данные, наружу идёт только маска.
	PhoneIndex *string `json:"-"`
	// PhoneCipher — зашифрованный AES-256-GCM номер (base64 nonce||ct).
	// Расшифровать можно только с PHONE_ENC_KEY.
	PhoneCipher *string `json:"-"`
	// PhoneVerifiedAt — задел под SMS-верификацию (VYC-97): всегда NULL,
	// пока верификация не реализована.
	PhoneVerifiedAt *time.Time `json:"-"`
	// AllowSearchByPhone — приватность: false → поиск по номеру при заявке
	// в друзья возвращает «не найден». Дефолт true (миграция 026).
	// json:"-": раздаётся только через meResponse — как AllowFriendRequests.
	AllowSearchByPhone bool `json:"-"`
	// PhoneMasked — презентационная маска номера, заполняется ТОЛЬКО в
	// usecase.GetMe/SetPhone/ClearPhone. Во всех остальных местах (GetByID,
	// SearchUsers) nil, и omitempty скрывает поле.
	PhoneMasked *string `json:"phone_masked,omitempty"`
```

В `UserRepository` (после `GetByUsername` / перед `Update`):

```go
	// GetByPhoneIndex ищет пользователя по детерминированному индексу
	// номера. ErrUserNotFound, если номера нет.
	GetByPhoneIndex(index string) (*User, error)
	// SetPhone пишет индекс и шифротекст номера. ErrPhoneTaken, если индекс
	// уже занят ДРУГИМ пользователем (users_phone_index_key).
	// Всегда сбрасывает phone_verified_at: повторная установка номера
	// аннулирует будущую верификацию.
	SetPhone(id uuid.UUID, index, cipher string) error
	// ClearPhone снимает номер (обе колонки в NULL). Идемпотентна.
	ClearPhone(id uuid.UUID) error
```

`server/internal/domain/errors.go` — в блок с friend-ошибками:

```go
	// ErrInvalidPhone — номер не прошёл нормализацию (phonecrypto).
	ErrInvalidPhone = errors.New("invalid phone number")
	// ErrPhoneTaken — номер уже привязан к другому аккаунту
	// (users.phone_index UNIQUE).
	ErrPhoneTaken = errors.New("user with this phone number already exists")
```

- [ ] **Step 2: Методы репозитория**

`server/internal/repository/postgres/user.go`:

a) список колонок трёх SELECT-запросов (`GetByID`, `GetByEmail`, `GetByUsername`) — добавить после `allow_dm_from`:

```sql
		       phone_index, phone_cipher, phone_verified_at, allow_search_by_phone
```

и в `Scan(...)` после `&user.AllowDMFrom`:

```go
		&user.PhoneIndex,
		&user.PhoneCipher,
		&user.PhoneVerifiedAt,
		&user.AllowSearchByPhone,
```

(во всех трёх: строки 77–79/117–119/155–157 и 99–100/137–138/176–177 — проверить по фактическому тексту файла).

b) новые методы (в конец файла):

```go
func (r *userRepository) GetByPhoneIndex(index string) (*domain.User, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT id, username, email, password_hash, avatar_url, status, created_at, updated_at, email_verified_at,
		       last_seen_at, show_last_seen, allow_friend_requests, allow_dm_from,
		       phone_index, phone_cipher, phone_verified_at, allow_search_by_phone
		FROM users
		WHERE phone_index = $1
	`

	user := &domain.User{}
	err := r.db.QueryRow(ctx, query, index).Scan(
		&user.ID,
		&user.Username,
		&user.Email,
		&user.Password,
		&user.AvatarURL,
		&user.Status,
		&user.CreatedAt,
		&user.UpdatedAt,
		&user.EmailVerifiedAt,
		&user.LastSeenAt,
		&user.ShowLastSeen,
		&user.AllowFriendRequests,
		&user.AllowDMFrom,
		&user.PhoneIndex,
		&user.PhoneCipher,
		&user.PhoneVerifiedAt,
		&user.AllowSearchByPhone,
	)

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrUserNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get user by phone: %w", err)
	}

	return user, nil
}

func (r *userRepository) SetPhone(id uuid.UUID, index, cipher string) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx,
		`UPDATE users SET phone_index = $2, phone_cipher = $3, phone_verified_at = NULL, updated_at = NOW() WHERE id = $1`,
		id, index, cipher)
	if err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23505" {
			return domain.ErrPhoneTaken
		}
		return fmt.Errorf("failed to set phone: %w", err)
	}
	return nil
}

func (r *userRepository) ClearPhone(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx,
		`UPDATE users SET phone_index = NULL, phone_cipher = NULL, phone_verified_at = NULL, updated_at = NOW() WHERE id = $1`,
		id)
	if err != nil {
		return fmt.Errorf("failed to clear phone: %w", err)
	}
	return nil
}
```

- [ ] **Step 3: Обновить MockUserRepository**

`server/internal/usecase/auth_test.go` — после `GetByUsername`:

```go
func (m *MockUserRepository) GetByPhoneIndex(index string) (*domain.User, error) {
	args := m.Called(index)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.User), args.Error(1)
}

func (m *MockUserRepository) SetPhone(id uuid.UUID, index, cipher string) error {
	return m.Called(id, index, cipher).Error(0)
}

func (m *MockUserRepository) ClearPhone(id uuid.UUID) error {
	return m.Called(id).Error(0)
}
```

- [ ] **Step 4: Проверка компиляции и тестов**

Run: `cd server && go build ./... && go test ./...`
Expected: PASS без новых фейлов (новые методы интерфейса добавлены везде; usecase пока не тронут и компилируется).

- [ ] **Step 5: Коммит**

```bash
git add server/internal/domain/user.go server/internal/domain/errors.go server/internal/repository/postgres/user.go server/internal/usecase/auth_test.go
git commit -m "VYC-97: домен и репозиторий для номера телефона"
```

---

### Task 4: userUseCase — GetMe / SetPhone / ClearPhone

**Files:**
- Modify: `server/internal/domain/usecase.go` (UserUseCase)
- Modify: `server/internal/usecase/user.go`
- Modify: `server/internal/delivery/http/handler/websocket_test.go` (mockUserUseCase)
- Create: `server/internal/usecase/user_phone_test.go`
- Modify: `server/cmd/api/main.go` (строка 130: `usecase.NewUserUseCase(userRepo, storage)`)

**Interfaces:**
- Consumes: `phonecrypto`, репо-методы Task 3.
- Produces:

```go
// domain.UserUseCase:
GetMe(id uuid.UUID) (*User, error)                     // как GetByID + PhoneMasked
SetPhone(id uuid.UUID, raw string) (*User, error)      // ErrInvalidPhone, ErrPhoneTaken
ClearPhone(id uuid.UUID) (*User, error)

// usecase:
NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage, phoneKey []byte) domain.UserUseCase
```

- [ ] **Step 1: Написать падающие тесты**

`server/internal/usecase/user_phone_test.go`:

```go
package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/phonecrypto"
)

var testPhoneKey = []byte("0123456789abcdef0123456789abcdef") // 32 байта, только для тестов

func mustCipher(t *testing.T, phone string) *string {
	t.Helper()
	blob, err := phonecrypto.Encrypt(testPhoneKey, phone)
	require.NoError(t, err)
	return &blob
}

func newUserPhoneUC(t *testing.T) (domain.UserUseCase, *MockUserRepository) {
	t.Helper()
	ur := new(MockUserRepository)
	return usecase.NewUserUseCase(ur, nil, testPhoneKey), ur
}

func TestSetPhone_InvalidNumberRejected(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	_, err := uc.SetPhone(id, "not-a-phone")

	require.ErrorIs(t, err, domain.ErrInvalidPhone)
	ur.AssertNotCalled(t, "SetPhone")
}

func TestSetPhone_NormalizesAndStoresEncrypted(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	// Нормализация проверяется через ожидаемый индекс: raw-ввод с разделителями
	// обязан привестись к индексу ОТ +79123456789 ИНАЧЕ мок не совпадёт.
	index, err := phonecrypto.Index(testPhoneKey, "+79123456789")
	require.NoError(t, err)
	ur.On("SetPhone", id, index, mock.Anything).Return(nil)
	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me", PhoneCipher: mustCipher(t, "+79123456789")}, nil)

	got, err := uc.SetPhone(id, "+7 (912) 345-67-89")

	require.NoError(t, err)
	require.NotNil(t, got.PhoneMasked)
	assert.Equal(t, "+79123 ••• •• 89", *got.PhoneMasked)
}

func TestSetPhone_Taken(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	index, _ := phonecrypto.Index(testPhoneKey, "+79123456789")
	ur.On("SetPhone", id, index, mock.Anything).Return(domain.ErrPhoneTaken)

	_, err := uc.SetPhone(id, "+79123456789")

	require.ErrorIs(t, err, domain.ErrPhoneTaken)
}

func TestClearPhone_ReturnsUserWithoutMask(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	ur.On("ClearPhone", id).Return(nil)
	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me"}, nil)

	got, err := uc.ClearPhone(id)

	require.NoError(t, err)
	assert.Nil(t, got.PhoneMasked)
}

func TestGetMe_FillsPhoneMasked(t *testing.T) {
	uc, ur := newUserPhoneUC(t)
	id := uuid.New()

	ur.On("GetByID", id).Return(&domain.User{ID: id, Username: "me", PhoneCipher: mustCipher(t, "+79123456789")}, nil)

	got, err := uc.GetMe(id)

	require.NoError(t, err)
	require.NotNil(t, got.PhoneMasked)
	assert.Equal(t, "+79123 ••• •• 89", *got.PhoneMasked)
}
```

- [ ] **Step 2: Убедиться, что падает**

Run: `go test ./internal/usecase/ -run 'TestSetPhone|TestClearPhone|TestGetMe'`
Expected: FAIL — `NewUserUseCase` не принимает третий аргумент, `GetMe/SetPhone/ClearPhone` не существуют.

- [ ] **Step 3: Интерфейс UserUseCase**

`server/internal/domain/usecase.go` — в `UserUseCase`, после `RemoveAvatar`:

```go
	// GetMe — «про себя»: как GetByID, но с заполненным PhoneMasked.
	// Единственный источник маски номера для клиента.
	GetMe(id uuid.UUID) (*User, error)
	// SetPhone нормализует, шифрует и сохраняет номер пользователя.
	// ErrInvalidPhone — невалидный ввод; ErrPhoneTaken — номер занят.
	SetPhone(id uuid.UUID, raw string) (*User, error)
	// ClearPhone снимает номер. Идемпотентна.
	ClearPhone(id uuid.UUID) (*User, error)
```

- [ ] **Step 4: Реализация usecase**

`server/internal/usecase/user.go`:

```go
import (…; "github.com/vycord/server/pkg/phonecrypto") // добавить импорт
```

структура и конструктор — третий аргумент:

```go
type userUseCase struct {
	userRepo domain.UserRepository
	storage  filestorage.Storage
	// phoneKey — PHONE_ENC_KEY (32 байта), шифрование номеров (VYC-97).
	phoneKey []byte
}

func NewUserUseCase(userRepo domain.UserRepository, storage filestorage.Storage, phoneKey []byte) domain.UserUseCase {
	return &userUseCase{userRepo: userRepo, storage: storage, phoneKey: phoneKey}
}
```

новые методы (после `GetByID`, до `Search`):

```go
// GetMe — как GetByID, но с PhoneMasked: расшифровывает phone_cipher и
// строит маску. Только для ответов «про себя».
func (uc *userUseCase) GetMe(id uuid.UUID) (*domain.User, error) {
	return uc.getMe(id)
}

func (uc *userUseCase) getMe(id uuid.UUID) (*domain.User, error) {
	user, err := uc.userRepo.GetByID(id)
	if err != nil {
		return nil, fmt.Errorf("failed to get user: %w", err)
	}
	user.Password = ""
	if user.PhoneCipher != nil {
		plain, err := phonecrypto.Decrypt(uc.phoneKey, *user.PhoneCipher)
		if err != nil {
			return nil, fmt.Errorf("decrypt phone: %w", err)
		}
		mask := phonecrypto.Mask(plain)
		user.PhoneMasked = &mask
	}
	return user, nil
}

// SetPhone — нормализация → индекс+шифротекст → сохранение → «про себя» с
// маской. Единственная точка, где открытый номер попадает в хранилище
// (только в зашифрованном виде).
func (uc *userUseCase) SetPhone(id uuid.UUID, raw string) (*domain.User, error) {
	normalized, err := phonecrypto.Normalize(raw)
	if err != nil {
		return nil, domain.ErrInvalidPhone
	}
	index, err := phonecrypto.Index(uc.phoneKey, normalized)
	if err != nil {
		return nil, fmt.Errorf("phone index: %w", err)
	}
	cipher, err := phonecrypto.Encrypt(uc.phoneKey, normalized)
	if err != nil {
		return nil, fmt.Errorf("encrypt phone: %w", err)
	}
	if err := uc.userRepo.SetPhone(id, index, cipher); err != nil {
		return nil, err
	}
	return uc.getMe(id)
}

// ClearPhone снимает номер (освобождает его для других).
func (uc *userUseCase) ClearPhone(id uuid.UUID) (*domain.User, error) {
	if err := uc.userRepo.ClearPhone(id); err != nil {
		return nil, fmt.Errorf("clear phone: %w", err)
	}
	return uc.getMe(id)
}
```

- [ ] **Step 5: Обновить mockUserUseCase**

`server/internal/delivery/http/handler/websocket_test.go` — после `GetByID`:

```go
func (m *mockUserUseCase) GetMe(id uuid.UUID) (*domain.User, error) {
	args := m.Called(id)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}
func (m *mockUserUseCase) SetPhone(id uuid.UUID, raw string) (*domain.User, error) {
	args := m.Called(id, raw)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}
func (m *mockUserUseCase) ClearPhone(id uuid.UUID) (*domain.User, error) {
	args := m.Called(id)
	u, _ := args.Get(0).(*domain.User)
	return u, args.Error(1)
}
```

- [ ] **Step 6: Поправить вызов в main**

`server/cmd/api/main.go:130` — читать ключ из конфига (рядом с балансом config.New(), после соединения с БД — где собираются юзкейсы):

```go
	phoneKey, err := hex.DecodeString(cfg.PhoneEncKey)
	if err != nil || len(phoneKey) != 32 {
		log.Error("PHONE_ENC_KEY must be 64 hex characters (32 bytes)", "error", err)
		os.Exit(1)
	}
```

затем:

```go
	userUseCase := usecase.NewUserUseCase(userRepo, storage, phoneKey)
```

(импорт `encoding/hex` добавить)

- [ ] **Step 7: Тесты зелёные + компиляция**

Run: `cd server && go build ./... && go test ./...`
Expected: PASS — новые тесты проходят, старые не сломались (в `user_phone_test.go` новые методы; `NewUserUseCase` обновлён во всех вызовах — main и тестах).

- [ ] **Step 8: Коммит**

```bash
git add server/internal/domain/usecase.go server/internal/usecase/user.go server/internal/usecase/user_phone_test.go server/internal/delivery/http/handler/websocket_test.go server/cmd/api/main.go
git commit -m "VYC-97: userUseCase — GetMe/SetPhone/ClearPhone"
```

---

### Task 5: Приватность allow_search_by_phone

**Files:**
- Modify: `server/internal/domain/user.go` (UpdatePrivacy сигнатура)
- Modify: `server/internal/domain/usecase.go` (SetPrivacy сигнатура)
- Modify: `server/internal/repository/postgres/user.go` (UpdatePrivacy)
- Modify: `server/internal/usecase/user.go` (SetPrivacy)
- Modify: `server/internal/usecase/auth_test.go` (MockUserRepository.UpdatePrivacy)
- Modify: `server/internal/delivery/http/handler/websocket_test.go` (mockUserUseCase.SetPrivacy)
- Modify: `server/internal/delivery/http/handler/user.go` (UpdatePrivacy хендлер, meResponse)
- Modify: `server/internal/delivery/http/handler/user_test.go`

**Interfaces:**
- Produces: `domain.PrivacyMode`... новое поле в `meResponse`:

```go
AllowSearchByPhone bool `json:"allow_search_by_phone"`
```

`SetPrivacy(id, showLastSeen *bool, friendRequests, dmFrom *PrivacyMode, allowSearchByPhone *bool)` — пятый параметр во всей цепочке.

- [ ] **Step 1: Обновить сигнатуры domain + реализаций**

`server/internal/domain/user.go`:

```go
	UpdatePrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *PrivacyMode, allowSearchByPhone *bool) error
```

`server/internal/domain/usecase.go`:

```go
	SetPrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *PrivacyMode, allowSearchByPhone *bool) error
```

`server/internal/usecase/user.go`:

```go
func (uc *userUseCase) SetPrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode, allowSearchByPhone *bool) error {
	if friendRequests != nil && !friendRequests.ValidForFriendRequests() {
		return domain.ErrInvalidPrivacyMode
	}
	if dmFrom != nil && !dmFrom.ValidForDM() {
		return domain.ErrInvalidPrivacyMode
	}
	return uc.userRepo.UpdatePrivacy(id, showLastSeen, friendRequests, dmFrom, allowSearchByPhone)
}
```

`server/internal/repository/postgres/user.go`:

```go
func (r *userRepository) UpdatePrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode, allowSearchByPhone *bool) error {
	query := `
		UPDATE users
		SET show_last_seen        = COALESCE($2, show_last_seen),
		    allow_friend_requests = COALESCE($3, allow_friend_requests),
		    allow_dm_from         = COALESCE($4, allow_dm_from),
		    allow_search_by_phone = COALESCE($5, allow_search_by_phone),
		    updated_at            = NOW()
		WHERE id = $1
	`
	_, err := r.db.Exec(ctx, query, id, showLastSeen, friendRequests, dmFrom, allowSearchByPhone)
	if err != nil {
		return fmt.Errorf("failed to update privacy: %w", err)
	}
	return nil
}
```

- [ ] **Step 2: Моки**

`server/internal/usecase/auth_test.go`:

```go
func (m *MockUserRepository) UpdatePrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode, allowSearchByPhone *bool) error {
	return m.Called(id, showLastSeen, friendRequests, dmFrom, allowSearchByPhone).Error(0)
}
```

`server/internal/delivery/http/handler/websocket_test.go`:

```go
func (m *mockUserUseCase) SetPrivacy(id uuid.UUID, showLastSeen *bool, friendRequests, dmFrom *domain.PrivacyMode, allowSearchByPhone *bool) error {
	return m.Called(id, showLastSeen, friendRequests, dmFrom, allowSearchByPhone).Error(0)
}
```

- [ ] **Step 3: Хендлер UpdatePrivacy + meResponse**

`server/internal/delivery/http/handler/user.go` — meResponse:

```go
type meResponse struct {
	*domain.User
	AllowFriendRequests domain.PrivacyMode `json:"allow_friend_requests"`
	AllowDMFrom         domain.PrivacyMode `json:"allow_dm_from"`
	AllowSearchByPhone  bool               `json:"allow_search_by_phone"`
}
```

UpdatePrivacy: тело и проверка «нет полей»:

```go
	var req struct {
		ShowLastSeen        *bool               `json:"show_last_seen"`
		AllowFriendRequests *domain.PrivacyMode `json:"allow_friend_requests"`
		AllowDMFrom         *domain.PrivacyMode `json:"allow_dm_from"`
		AllowSearchByPhone  *bool               `json:"allow_search_by_phone"`
	}
	// …
	if req.ShowLastSeen == nil && req.AllowFriendRequests == nil && req.AllowDMFrom == nil && req.AllowSearchByPhone == nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "no privacy fields provided")
		return
	}
	err := h.userUseCase.SetPrivacy(userID, req.ShowLastSeen, req.AllowFriendRequests, req.AllowDMFrom, req.AllowSearchByPhone)
```

- [ ] **Step 4: Помощник meResponse в user-хендлере**

Чтобы `AllowSearchByPhone` не оставался у молчащего `false` ни в одном ответе, собрать все построения meResponse через помощник:

```go
func (h *UserHandler) me(u *domain.User) meResponse {
	return meResponse{
		User:                u,
		AllowFriendRequests: u.AllowFriendRequests,
		AllowDMFrom:         u.AllowDMFrom,
		AllowSearchByPhone:  u.AllowSearchByPhone,
	}
}
```

Заменить построения в `GetMe`, `UploadAvatar`, `RemoveAvatar` на `h.me(user)`.

- [ ] **Step 5: Другие построители meResponse**

Найти все оставшиеся литералы: `grep -rn "meResponse{" server/internal/delivery/http/handler/` → это `auth.go` (Login, Refresh) и `otp.go` (Verify). В каждом добавить:

```go
		AllowSearchByPhone: user.AllowSearchByPhone,
```

- [ ] **Step 6: Поправить существующие тесты хендлера**

`server/internal/delivery/http/handler/user_test.go`: тесты privacy (≈строки 426–470) вызывают `mockUC.On("SetPrivacy", ...)` с 4 аргументами — добавить пятый nil. Найти все вызовы `SetPrivacy` в тестах и дописать `nil`:

```go
mockUC.On("SetPrivacy", userID, mock.Anything, mock.Anything, mock.Anything, (*bool)(nil)).Return(nil)
```

Новые тесты (в конец `user_test.go`):

```go
func TestUserHandler_UpdatePrivacy_AllowSearchByPhone(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	userID := uuid.New()
	falseVal := false
	mockUC.On("SetPrivacy", userID, (*bool)(nil), (*domain.PrivacyMode)(nil), (*domain.PrivacyMode)(nil), &falseVal).Return(nil)

	req := httptest.NewRequest(http.MethodPatch, "/api/v1/users/me/privacy",
		strings.NewReader(`{"allow_search_by_phone":false}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UpdatePrivacy(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}
}
```

(первый тест не использует none-режимы — это ок; второй проверяет и маску, и приватность в GetMe.)

- [ ] **Step 7: Прогон**

Run: `cd server && go build ./... && go test ./...`
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add server/internal/domain/user.go server/internal/domain/usecase.go server/internal/repository/postgres/user.go server/internal/usecase/user.go server/internal/usecase/auth_test.go server/internal/delivery/http/handler/websocket_test.go server/internal/delivery/http/handler/user.go server/internal/delivery/http/handler/user_test.go server/internal/delivery/http/handler/auth.go server/internal/delivery/http/handler/otp.go
git commit -m "VYC-97: настройка приватности allow_search_by_phone"
```

---

### Task 6: Хендлеры PUT/DELETE /users/me/phone + роуты

**Files:**
- Modify: `server/internal/delivery/http/httperr/httperr.go` (коды)
- Modify: `server/internal/delivery/http/handler/user.go` (UpdatePhone, DeletePhone)
- Modify: `server/internal/delivery/http/handler/user_test.go`
- Modify: `server/cmd/api/main.go` (роуты + ratelimit)

**Interfaces:**
- Consumes: `userUseCase.SetPhone/ClearPhone` (Task 4), `ratelimit` (существует).
- Produces: `PUT /api/v1/users/me/phone` (400 `phone_invalid`, 409 `phone_taken`), `DELETE /api/v1/users/me/phone` (идемпотентный 200). Лимит 10/час на пользователя на PUT.

- [ ] **Step 1: Коды ошибок**

`server/internal/delivery/http/httperr/httperr.go` — рядом с `CodeInvalidPrivacyValue`:

```go
	CodePhoneTaken   = "phone_taken"
	CodePhoneInvalid = "phone_invalid"
```

- [ ] **Step 2: Написать падающие тесты хендлера**

В конец `server/internal/delivery/http/handler/user_test.go`:

```go
func TestUserHandler_UpdatePhone_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	userID := uuid.New()
	mask := "+79123 ••• •• 89"
	user := &domain.User{ID: userID, Username: "alice", AllowSearchByPhone: true, PhoneMasked: &mask}
	mockUC.On("SetPhone", userID, "+79123456789").Return(user, nil)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/phone",
		strings.NewReader(`{"phone":"+79123456789"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UpdatePhone(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"phone_masked":"+79123 ••• •• 89"`) {
		t.Fatalf("expected phone_masked in body, got: %s", rec.Body.String())
	}
}

func TestUserHandler_UpdatePhone_Invalid(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	userID := uuid.New()
	mockUC.On("SetPhone", userID, "abc").Return(nil, domain.ErrInvalidPhone)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/phone",
		strings.NewReader(`{"phone":"abc"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UpdatePhone(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"phone_invalid"`) {
		t.Fatalf("expected phone_invalid, got: %s", rec.Body.String())
	}
}

func TestUserHandler_UpdatePhone_Taken(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	userID := uuid.New()
	mockUC.On("SetPhone", userID, "+79123456789").Return(nil, domain.ErrPhoneTaken)

	req := httptest.NewRequest(http.MethodPut, "/api/v1/users/me/phone",
		strings.NewReader(`{"phone":"+79123456789"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.UpdatePhone(rec, req)

	if rec.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"phone_taken"`) {
		t.Fatalf("expected phone_taken, got: %s", rec.Body.String())
	}
}

func TestUserHandler_DeletePhone_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	mockUC := new(mockUserUseCase)
	h := NewUserHandler(mockUC, hub, log)

	userID := uuid.New()
	user := &domain.User{ID: userID, Username: "alice"}
	mockUC.On("ClearPhone", userID).Return(user, nil)

	req := httptest.NewRequest(http.MethodDelete, "/api/v1/users/me/phone", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.DeletePhone(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
}
```

- [ ] **Step 3: Убедиться, что падает**

Run: `go test ./internal/delivery/http/handler/ -run TestUserHandler_UpdatePhone -v 2>&1 | head`
Expected: FAIL — `UpdatePhone` не существует.

- [ ] **Step 4: Реализация хендлеров**

`server/internal/delivery/http/handler/user.go` — после `UpdatePrivacy`:

```go
// UpdatePhone сохраняет номер пользователя. Нормализация и шифрование —
// в usecase.SetPhone; сюда приходит уже строка как была введена.
func (h *UserHandler) UpdatePhone(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	var body struct {
		Phone string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	user, err := h.userUseCase.SetPhone(userID, strings.TrimSpace(body.Phone))
	if errors.Is(err, domain.ErrInvalidPhone) {
		h.sendError(w, http.StatusBadRequest, httperr.CodePhoneInvalid, "invalid phone number")
		return
	}
	if errors.Is(err, domain.ErrPhoneTaken) {
		h.sendError(w, http.StatusConflict, httperr.CodePhoneTaken, "phone number is already in use")
		return
	}
	if err != nil {
		h.log.Error("failed to update phone", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal error")
		return
	}

	h.sendJSON(w, http.StatusOK, h.me(user))
}

// DeletePhone снимает номер. Идемпотентен: без номера — тот же 200.
func (h *UserHandler) DeletePhone(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	user, err := h.userUseCase.ClearPhone(userID)
	if err != nil {
		h.log.Error("failed to delete phone", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal error")
		return
	}

	h.sendJSON(w, http.StatusOK, h.me(user))
}
```

(`strings` импорт уже есть в файле — проверить.)

- [ ] **Step 5: GetMe переводится на uc.GetMe**

В `GetMe` заменить `h.userUseCase.GetByID(userID)` на `h.userUseCase.GetMe(userID)`, ответ — `h.me(user)`.

- [ ] **Step 6: Роуты + rate limit в main**

`server/cmd/api/main.go`, после блока user-роутов (после строки `PATCH /api/v1/users/me/privacy`):

```go
	// PHONE_ENDPOINT_LIMIT — 10 установок номера в час на пользователя:
	// свободного перебора чужих номеров не даёт, легитимной настройке не мешает.
	phoneLimiter := ratelimit.New(10, time.Hour)
	router.HandleFunc("PUT /api/v1/users/me/phone",
		authMid.RequireAuth(phoneLimiter.Middleware(func(r *http.Request) string {
			return r.Context().Value("user_id").(uuid.UUID).String()
		}, userHandler.UpdatePhone)))
	router.HandleFunc("DELETE /api/v1/users/me/phone", authMid.RequireAuth(userHandler.DeletePhone))
```

`ratelimit` и `uuid` уже импортированы (проверить: main.go строки 15, 16 импортируют `github.com/google/uuid` и `.../ratelimit`).

- [ ] **Step 7: Прогон**

Run: `cd server && go build ./... && go test ./... && go vet ./... && go run ./cmd/migrate "postgres://vycord:vycord_secret@localhost:5432/vycord?sslmode=disable" up` (при живом postgres — применить 026)
Expected: PASS, миграция применяется.

- [ ] **Step 8: Коммит**

```bash
git add server/internal/delivery/http/httperr/httperr.go server/internal/delivery/http/handler/user.go server/internal/delivery/http/handler/user_test.go server/cmd/api/main.go
git commit -m "VYC-97: PUT/DELETE /users/me/phone и rate limit"
```

---

### Task 7: Запрос в друзья по номеру

**Files:**
- Modify: `server/internal/domain/friend.go` (SendRequest сигнатура)
- Modify: `server/internal/usecase/friend.go`
- Modify: `server/internal/delivery/http/handler/friend.go`
- Modify: `server/internal/usecase/friend_test.go`
- Modify: `server/internal/delivery/http/handler/friend_test.go`
- Modify: `server/cmd/api/main.go` (NewFriendUseCase, строка ~135)

**Interfaces:**
- Consumes: `phonecrypto`, `GetByPhoneIndex` (Task 3).
- Produces:

```go
// domain.FriendUseCase:
SendRequest(fromID uuid.UUID, username, phone string) (*FriendRequest, *UserBrief, *UserBrief, bool, error)
// ровно один из username/phone непустой (гарантирует хендлер)

// usecase:
NewFriendUseCase(friendRepo domain.FriendRepository, blockRepo domain.BlockRepository, userRepo domain.UserRepository, serverRepo domain.ServerRepository, phoneKey []byte) domain.FriendUseCase
```

- [ ] **Step 1: Написать падающие тесты usecase**

`server/internal/usecase/friend_test.go` — обновить `newFriendUC`:

```go
func newFriendUC(t *testing.T) (domain.FriendUseCase, *MockFriendRepository,
	*MockBlockRepository, *MockUserRepository, *MockServerRepository) {
	t.Helper()
	fr := new(MockFriendRepository)
	br := new(MockBlockRepository)
	ur := new(MockUserRepository)
	sr := new(MockServerRepository)
	return usecase.NewFriendUseCase(fr, br, ur, sr, testPhoneKey), fr, br, ur, sr
}
```

(все существующие вызовы `uc.SendRequest(me, "other")` в этом файле становятся `uc.SendRequest(me, "other", "")` — заменить по всему файлу.)

Новые тесты (в конец файла):

```go
func TestSendRequest_ByPhone_FindsAndNormalizes(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()

	index, err := phonecrypto.Index(testPhoneKey, "+79123456789")
	require.NoError(t, err)
	target := userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends)
	target.AllowSearchByPhone = true
	ur.On("GetByPhoneIndex", index).Return(target, nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("GetByPair", me, other).Return(nil, domain.ErrFriendshipNotFound)
	fr.On("Create", mock.AnythingOfType("*domain.Friendship")).Return(nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)

	// Ввод с разделителями: "8 912 345-67-89" обязан искаться по индексу
	// ОТ +79123456789 — иначе mock GetByPhoneIndex не совпадёт.
	req, targetB, _, accepted, err := uc.SendRequest(me, "", "8 912 345-67-89")

	require.NoError(t, err)
	assert.False(t, accepted)
	assert.Equal(t, other, req.User.UserID)
	assert.Equal(t, other, targetB.UserID)
}

func TestSendRequest_ByPhone_SearchDisabled_ReturnsNotFound(t *testing.T) {
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()

	index, _ := phonecrypto.Index(testPhoneKey, "+79123456789")
	target := userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends)
	target.AllowSearchByPhone = false
	ur.On("GetByPhoneIndex", index).Return(target, nil)

	// Именно ErrUserNotFound, а не ErrInteractionForbidden: выключенная
	// настройка не должна выдавать факт существования номера.
	_, _, _, _, err := uc.SendRequest(me, "", "+79123456789")

	require.ErrorIs(t, err, domain.ErrUserNotFound)
	br.AssertNotCalled(t, "IsBlockedEither")
}

func TestSendRequest_ByPhone_InvalidNumber(t *testing.T) {
	uc, _, _, ur, _ := newFriendUC(t)
	me := uuid.New()

	_, _, _, _, err := uc.SendRequest(me, "", "not-a-phone")

	require.ErrorIs(t, err, domain.ErrInvalidPhone)
	ur.AssertNotCalled(t, "GetByPhoneIndex")
}
```

(импорты: `github.com/vycord/server/pkg/phonecrypto`.)

- [ ] **Step 2: Убедиться, что падает**

Run: `go test ./internal/usecase/ -run TestSendRequest_ByPhone 2>&1 | head`
Expected: FAIL — сигнатура не совпадает.

- [ ] **Step 3: Интерфейс + реализация**

`server/internal/domain/friend.go`:

```go
	// SendRequest шлёт заявку по username ЛИБО по номеру телефона — ровно
	// один из параметров непустой (гарантирует хендлер). ... (существующий
	// комментарий про accepted/self сохранить)
	SendRequest(fromID uuid.UUID, username, phone string) (req *FriendRequest, target *UserBrief, self *UserBrief, accepted bool, err error)
```

`server/internal/usecase/friend.go`:

```go
import (…; "github.com/vycord/server/pkg/phonecrypto") // добавить

type friendUseCase struct {
	friendRepo domain.FriendRepository
	blockRepo  domain.BlockRepository
	userRepo   domain.UserRepository
	serverRepo domain.ServerRepository
	// phoneKey — PHONE_ENC_KEY: индекс-поиск при заявке по номеру (VYC-97).
	phoneKey []byte
}

func NewFriendUseCase(
	friendRepo domain.FriendRepository,
	blockRepo domain.BlockRepository,
	userRepo domain.UserRepository,
	serverRepo domain.ServerRepository,
	phoneKey []byte,
) domain.FriendUseCase {
	return &friendUseCase{friendRepo: friendRepo, blockRepo: blockRepo, userRepo: userRepo, serverRepo: serverRepo, phoneKey: phoneKey}
}
```

`SendRequest` — заменить начало:

```go
func (uc *friendUseCase) SendRequest(fromID uuid.UUID, username, phone string) (*domain.FriendRequest, *domain.UserBrief, *domain.UserBrief, bool, error) {
	target, err := uc.lookupTarget(username, phone)
	if err != nil {
		return nil, nil, nil, false, err
	}
	// … остальной код без изменений (canInteract, self, GetByPair, Create…)
}
```

и добавить метод:

```go
// lookupTarget находит адресата заявки по имени или номеру. По номеру:
// нормализация → индекс → поиск. Выключенный allow_search_by_phone отдаёт
// ErrUserNotFound, а не ErrInteractionForbidden: «скрыт» и «не существует»
// неразличимы наружу.
func (uc *friendUseCase) lookupTarget(username, phone string) (*domain.User, error) {
	if phone == "" {
		return uc.userRepo.GetByUsername(username)
	}
	normalized, err := phonecrypto.Normalize(phone)
	if err != nil {
		return nil, domain.ErrInvalidPhone
	}
	index, err := phonecrypto.Index(uc.phoneKey, normalized)
	if err != nil {
		return nil, fmt.Errorf("phone index: %w", err)
	}
	target, err := uc.userRepo.GetByPhoneIndex(index)
	if err != nil {
		return nil, err
	}
	if !target.AllowSearchByPhone {
		return nil, domain.ErrUserNotFound
	}
	return target, nil
}
```

- [ ] **Step 4: Хендлер SendRequest**

`server/internal/delivery/http/handler/friend.go` — метод SendRequest:

```go
func (h *FriendHandler) SendRequest(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	var body struct {
		Username *string `json:"username"`
		Phone    *string `json:"phone"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	// ровно один ключ: оба — ошибка клиента, ни одного — как раньше.
	if body.Username != nil && body.Phone != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "provide exactly one of username or phone")
		return
	}
	username, phone := "", ""
	if body.Username != nil {
		username = strings.TrimSpace(*body.Username)
	}
	if body.Phone != nil {
		phone = strings.TrimSpace(*body.Phone)
	}
	if username == "" && phone == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeUsernameRequired, "username is required")
		return
	}

	req, target, self, accepted, err := h.friendUseCase.SendRequest(userID, username, phone)
	// … дальнейший код без изменений
}
```

`writeFriendError` — добавить случай (рядом с ErrUserNotFound):

```go
	case errors.Is(err, domain.ErrInvalidPhone):
		h.sendError(w, http.StatusBadRequest, httperr.CodePhoneInvalid, "invalid phone number")
```

- [ ] **Step 5: mockFriendUseCase + тесты хендлера**

`server/internal/delivery/http/handler/friend_test.go`:

```go
func (m *mockFriendUseCase) SendRequest(fromID uuid.UUID, username, phone string) (*domain.FriendRequest, *domain.UserBrief, *domain.UserBrief, bool, error) {
	args := m.Called(fromID, username, phone)
	var req *domain.FriendRequest
	var target *domain.UserBrief
	var self *domain.UserBrief
	if args.Get(0) != nil {
		req = args.Get(0).(*domain.FriendRequest)
	}
	if args.Get(1) != nil {
		target = args.Get(1).(*domain.UserBrief)
	}
	if args.Get(2) != nil {
		self = args.Get(2).(*domain.UserBrief)
	}
	return req, target, self, args.Bool(3), args.Error(4)
}
```

Существующие вызовы mock в тестах дополняются третьим аргументом `""`
(например `uc.On("SendRequest", me, "other", "")` — по всему файлу).

Новые тесты (в конец friend_test.go; харнесс — как в `TestFriendHandler_SendRequest_ForbiddenIsOpaque`: `NewFriendHandler(uc, ws.NewHub(log), log)` + `httptest.NewRequest` + контекст c `user_id`):

```go
func TestFriendHandler_SendRequest_ByPhone(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()
	target := &domain.UserBrief{UserID: uuid.New(), Username: "anna"}
	req := &domain.FriendRequest{ID: uuid.New(), User: *target}
	uc.On("SendRequest", me, "", "+79123456789").Return(req, target, nil, false, nil)

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	httpReq := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"phone":"+79123456789"}`))
	httpReq = httpReq.WithContext(context.WithValue(httpReq.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, httpReq)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"status":"pending"`) {
		t.Fatalf("expected pending status, got: %s", rec.Body.String())
	}
}

func TestFriendHandler_SendRequest_BothKeys_Rejected(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	httpReq := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"username":"alice","phone":"+79123456789"}`))
	httpReq = httpReq.WithContext(context.WithValue(httpReq.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, httpReq)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"invalid_request_body"`) {
		t.Fatalf("expected invalid_request_body, got: %s", rec.Body.String())
	}
}

func TestFriendHandler_SendRequest_InvalidPhone_400(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()
	uc.On("SendRequest", me, "", "abc").Return(nil, nil, nil, false, domain.ErrInvalidPhone)

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	httpReq := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"phone":"abc"}`))
	httpReq = httpReq.WithContext(context.WithValue(httpReq.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, httpReq)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), `"code":"phone_invalid"`) {
		t.Fatalf("expected phone_invalid, got: %s", rec.Body.String())
	}
}
```

(импорт `domain` уже есть в friend_test.go — проверен по существующим тестам.)

- [ ] **Step 6: main.go — ключ в friendUseCase**

```go
	friendUseCase := usecase.NewFriendUseCase(friendRepo, blockRepo, userRepo, serverRepo, phoneKey)
```

- [ ] **Step 7: Прогон**

Run: `cd server && go build ./... && go test ./... && go vet ./... && make lint && make build` (из корня — `make vet && make lint && make build`)
Expected: PASS.

- [ ] **Step 8: Коммит**

```bash
git add server/internal/domain/friend.go server/internal/usecase/friend.go server/internal/delivery/http/handler/friend.go server/internal/usecase/friend_test.go server/internal/delivery/http/handler/friend_test.go server/cmd/api/main.go
git commit -m "VYC-97: заявка в друзья по номеру телефона"
```

---

### Task 8: Клиент — типы, API, AddFriendForm

**Files:**
- Modify: `client/src/types/index.ts`
- Modify: `client/src/services/api.ts`
- Modify: `client/src/components/AddFriendForm.tsx`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`
- Create: `client/src/components/__tests__/AddFriendForm.test.tsx`

**Interfaces:**
- Consumes: сервер Task 6–7.
- Produces:

```ts
// types:
User.allow_search_by_phone?: boolean;
User.phone_masked?: string | null;

// api:
updatePhone(phone: string): Promise<User>
deletePhone(): Promise<User>
sendFriendRequest(input: { username?: string; phone?: string }): Promise<{ status: 'pending' | 'accepted'; request?: FriendRequest; user?: UserBrief }>
updatePrivacy(patch: { …; allow_search_by_phone?: boolean })
```

- [ ] **Step 1: Написать падающий тест AddFriendForm**

`client/src/components/__tests__/AddFriendForm.test.tsx`:

```tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { AddFriendForm } from '@/components/AddFriendForm';
import { apiService } from '@/services/api';

vi.mock('@/services/api', () => ({
  apiService: {
    sendFriendRequest: vi.fn(),
  },
  apiErrorText: () => 'err',
}));

vi.mock('@/stores/friendStore', () => ({
  useFriendStore: (selector: (s: { load: () => Promise<void> }) => unknown) =>
    selector({ load: vi.fn().mockResolvedValue(undefined) }),
}));

describe('AddFriendForm', () => {
  beforeEach(() => {
    cleanup();
    vi.mocked(apiService.sendFriendRequest).mockReset();
  });

  it('ввод, похожий на номер, уходит как { phone }', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'Анна' }, created_at: '' } });

    const { getByPlaceholderText, getByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: '89123456789' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    expect(apiService.sendFriendRequest).toHaveBeenCalledWith({ phone: '89123456789' });
  });

  it('обычный ввод уходит как { username }', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'anna' }, created_at: '' } });

    const { getByPlaceholderText, getByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: 'anna' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    expect(apiService.sendFriendRequest).toHaveBeenCalledWith({ username: 'anna' });
  });

  it('после успеха показывает имя найденного пользователя', async () => {
    vi.mocked(apiService.sendFriendRequest).mockResolvedValue({ status: 'pending', request: { id: 'r1', user: { user_id: 'u2', username: 'Анна' }, created_at: '' } });

    const { getByPlaceholderText, getByRole, findByRole } = render(<AddFriendForm />);
    fireEvent.change(getByPlaceholderText('Имя пользователя или номер телефона'), { target: { value: '89123456789' } });
    fireEvent.click(getByRole('button', { name: 'Отправить заявку' }));

    const msg = await findByRole('status');
    expect(msg.textContent).toContain('Анна');
  });
});
```

- [ ] **Step 2: Убедиться, что падает**

Run (из `client/`): `npx vitest run src/components/__tests__/AddFriendForm.test.tsx`
Expected: FAIL (компиляция/старый плейсхолдер).

- [ ] **Step 3: Типы**

`client/src/types/index.ts` — в `User`, после `allow_dm_from`:

```ts
  allow_search_by_phone?: boolean;
  /** Маска номера («+79123 ••• •• 89»), приходит только в ответах «про себя». */
  phone_masked?: string | null;
```

- [ ] **Step 4: api.ts**

`client/src/services/api.ts` — после `removeAvatar`:

```ts
  async updatePhone(phone: string) {
    return this.request<User>('/api/v1/users/me/phone', {
      method: 'PUT',
      body: JSON.stringify({ phone }),
    });
  }

  async deletePhone() {
    return this.request<User>('/api/v1/users/me/phone', {
      method: 'DELETE',
    });
  }
```

`sendFriendRequest`:

```ts
  async sendFriendRequest(input: { username?: string; phone?: string }) {
    return this.request<{ status: 'pending' | 'accepted'; request?: FriendRequest; user?: UserBrief }>(
      '/api/v1/friends/requests',
      { method: 'POST', body: JSON.stringify(input) },
    );
  }
```

`updatePrivacy` — добавить поле:

```ts
  async updatePrivacy(patch: {
    show_last_seen?: boolean;
    allow_friend_requests?: PrivacyMode;
    allow_dm_from?: PrivacyMode;
    allow_search_by_phone?: boolean;
  }) {
```

- [ ] **Step 5: AddFriendForm**

`client/src/components/AddFriendForm.tsx` — автодетект и сообщение с именем:

```tsx
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = username.trim();
    if (!value) return;

    // Ввод, похожий на номер (10+ цифр), уходит как phone, иначе — username.
    const looksLikePhone = value.replace(/\D/g, '').length >= 10;

    setStatus('sending');
    try {
      const res = await apiService.sendFriendRequest(
        looksLikePhone ? { phone: value } : { username: value },
      );
      setStatus('ok');
      const name = res.status === 'accepted' ? res.user?.username : res.request?.user.username;
      setMessage(
        res.status === 'accepted'
          ? t('friends.addAcceptedTo', { name: name ?? '' })
          : t('friends.addSentTo', { name: name ?? '' }),
      );
      setUsername('');
      await load();
    } catch (err) {
      setStatus('error');
      setMessage(apiErrorText(err, t));
    }
  };
```

плейсхолдер — `t('friends.addPlaceholder')` (значение меняется в i18n).

- [ ] **Step 6: i18n ru + en**

`ru.ts` — `friends`:

```ts
    addPlaceholder: 'Имя пользователя или номер телефона',
    addSentTo: 'Заявка в друзья отправлена: {{name}}',
    addAcceptedTo: 'Теперь вы друзья с {{name}}',
```

`errors` (рядом с friend_self):

```ts
    phone_taken: 'Этот номер уже привязан к другому аккаунту',
    phone_invalid: 'Некорректный номер телефона',
```

`en.ts` — те же ключи:

```ts
    addPlaceholder: 'Username or phone number',
    addSentTo: 'Friend request sent: {{name}}',
    addAcceptedTo: 'You are now friends with {{name}}',
    phone_taken: 'This number is already linked to another account',
    phone_invalid: 'Invalid phone number',
```

(интерполяция — `t(key, vars)` с `{{name}}`, сигнатура `TFunc = (key, vars?)` в `client/src/i18n/index.ts` — использование выше корректно.)

- [ ] **Step 7: Прогон**

Run (из `client/`): `npx vitest run src/components/__tests__/AddFriendForm.test.tsx && npx tsc --noEmit && npm run check:i18n`
Expected: PASS; tsc — 0 байт; check:i18n — «непереведённых строк не найдено.»

- [ ] **Step 8: Коммит**

```bash
git add client/src/types/index.ts client/src/services/api.ts client/src/components/AddFriendForm.tsx client/src/components/__tests__/AddFriendForm.test.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "VYC-97: клиент — автодетект номера в AddFriendForm"
```

---

### Task 9: Клиент — настройки (номер + тумблер)

**Files:**
- Modify: `client/src/components/settings/ProfileAccountBody.tsx`
- Modify: `client/src/components/settings/PrivacyBody.tsx`
- Modify: `client/src/components/settings/ProfileSettings.css`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`
- Modify: `client/src/components/settings/__tests__/Settings.dom.test.tsx`
- Modify: `client/src/components/settings/__tests__/__snapshots__/Settings.profile.html` (перегенерировать)

- [ ] **Step 1: i18n**

`ru.ts` — `settings`, в секции account:

```ts
    phoneLabel: 'Номер телефона',
    phoneNotSet: 'Не указан',
    phoneAdd: 'Добавить',
    phoneEdit: 'Изменить',
    phoneSave: 'Сохранить',
    phoneRemove: 'Удалить',
```

`settings`, в секции privacy (после `allowDmFromDescription`):

```ts
    allowSearchByPhone: 'Разрешить поиск по номеру телефона',
    allowSearchByPhoneDescription: 'Другие пользователи могут отправить вам заявку в друзья по номеру',
```

`en.ts`:

```ts
    phoneLabel: 'Phone number',
    phoneNotSet: 'Not set',
    phoneAdd: 'Add',
    phoneEdit: 'Edit',
    phoneSave: 'Save',
    phoneRemove: 'Remove',
    allowSearchByPhone: 'Allow searching by phone number',
    allowSearchByPhoneDescription: 'Others can send you a friend request by your phone number',
```

- [ ] **Step 2: Строка телефона в ProfileAccountBody**

`client/src/components/settings/ProfileAccountBody.tsx` — состояние:

```tsx
  const [phoneInput, setPhoneInput] = useState('');
  const [editingPhone, setEditingPhone] = useState(false);
  const [phoneSaving, setPhoneSaving] = useState(false);
  const [phoneError, setPhoneError] = useState<string | null>(null);

  const closePhoneEditor = () => {
    setEditingPhone(false);
    setPhoneInput('');
    setPhoneError(null);
  };

  const savePhone = async () => {
    const value = phoneInput.trim();
    if (!value) return;
    setPhoneSaving(true);
    setPhoneError(null);
    try {
      const updated = await apiService.updatePhone(value);
      updateUser({ phone_masked: updated.phone_masked ?? null });
      closePhoneEditor();
    } catch (err) {
      setPhoneError(apiErrorText(err, t));
    } finally {
      setPhoneSaving(false);
    }
  };

  const removePhone = async () => {
    setPhoneSaving(true);
    setPhoneError(null);
    try {
      const updated = await apiService.deletePhone();
      updateUser({ phone_masked: updated.phone_masked ?? null });
    } catch (err) {
      setPhoneError(apiErrorText(err, t));
    } finally {
      setPhoneSaving(false);
    }
  };
```

JSX — в секцию `Учётная запись`, после строки email:

```tsx
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.phoneLabel')}</span>
            <p className="setting-row-desc">
              {user?.phone_masked ?? t('settings.phoneNotSet')}
            </p>
          </div>
          {editingPhone ? (
            <div className="phone-edit-row">
              <input
                className="input"
                value={phoneInput}
                onChange={(e) => { setPhoneInput(e.target.value); setPhoneError(null); }}
                placeholder="+7 …"
                autoFocus
              />
              <button
                type="button"
                className="btn btn-primary"
                onClick={savePhone}
                disabled={phoneSaving || !phoneInput.trim()}
              >
                {t('settings.phoneSave')}
              </button>
              <button type="button" className="btn btn-ghost" onClick={closePhoneEditor}>
                {t('common.cancel')}
              </button>
            </div>
          ) : (
            <span className="phone-actions">
              <button type="button" className="btn btn-secondary" onClick={() => setEditingPhone(true)}>
                {user?.phone_masked ? t('settings.phoneEdit') : t('settings.phoneAdd')}
              </button>
              {user?.phone_masked && (
                <button type="button" className="btn btn-ghost" onClick={removePhone} disabled={phoneSaving}>
                  {t('settings.phoneRemove')}
                </button>
              )}
            </span>
          )}
        </div>
        {phoneError && <p className="setting-warning">{phoneError}</p>}
```

- [ ] **Step 3: CSS**

`client/src/components/settings/ProfileSettings.css` — в конец:

```css
.phone-actions {
  display: flex;
  gap: 10px;
}

.phone-edit-row {
  display: flex;
  gap: 8px;
}
```

(`phone-edit-row` — мультисегментный kebab-класс, допустимый дизайн-системой; кнопки — примитивы `.btn`. Токенов новых нет.)

- [ ] **Step 4: Тумблер в PrivacyBody**

`client/src/components/settings/PrivacyBody.tsx` — обработчик:

```tsx
  const handleAllowSearchByPhoneChange = async (checked: boolean) => {
    const previous = user?.allow_search_by_phone ?? true;
    updateUser({ allow_search_by_phone: checked });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ allow_search_by_phone: checked });
    } catch (err) {
      updateUser({ allow_search_by_phone: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };
```

JSX — первой строкой в секции privacy (до showLastSeen):

```tsx
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.allowSearchByPhone')}</span>
          <p className="setting-row-desc">{t('settings.allowSearchByPhoneDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            aria-label={t('settings.allowSearchByPhone')}
            checked={user?.allow_search_by_phone ?? true}
            onChange={(e) => { void handleAllowSearchByPhoneChange(e.target.checked); }}
          />
          <span className="toggle-track" />
        </label>
      </div>
```

- [ ] **Step 5: Обновить Settings.dom.test.tsx**

`client/src/components/settings/__tests__/Settings.dom.test.tsx` — в объект пользователя добавить поля:

```ts
      show_last_seen: true, allow_friend_requests: 'everyone', allow_dm_from: 'friends',
      allow_search_by_phone: true, phone_masked: null,
```

- [ ] **Step 6: Перегенерировать снапшот**

Run (из `client/`): `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx -u`
Expected: PASS; `__snapshots__/Settings.profile.html` переписан (внутри появятся «Номер телефона»/«Не указан»/«Добавить» и «Разрешить поиск по номеру телефона»).

- [ ] **Step 7: Прогон всех клиентских гейтов**

Run (из `client/`): `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test`
Expected: tsc 0 байт; stylelint 0 байт; check:i18n «непереведённых строк не найдено.»; `npm test` — ровно 3 фейла в `api.network-retry.test.ts` (не чинить!), остальное зелёное.

- [ ] **Step 8: Коммит**

```bash
git add client/src/components/settings/ProfileAccountBody.tsx client/src/components/settings/PrivacyBody.tsx client/src/components/settings/ProfileSettings.css client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts client/src/components/settings/__tests__/Settings.dom.test.tsx client/src/components/settings/__tests__/__snapshots__/Settings.profile.html
git commit -m "VYC-97: настройки — номер телефона и тумблер поиска"
```

---

### Task 10: Финальная проверка

**Files:** без изменений кода — только гейты и ручная проверка.

- [ ] **Step 1: Серверные гейты целиком**

Run (из корня): `make test && make vet && make lint && make build`
Expected: PASS.

- [ ] **Step 2: Клиентские гейты целиком**

Run (из `client/`): `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test`
Expected: как в Task 9 Step 7.

- [ ] **Step 3: Ручная проверка сценария**

1. `docker compose up -d postgres redis`; `make migrate-up`; запустить `make run` с `PHONE_ENC_KEY` в `.env` (Task 1).
2. В двух вкладках два пользователя (А и Б). А: Настройки → Профиль → «Добавить» → ввести `8 912 345-67-89` → сохранить → виден `+79123 ••• •• 89`.
3. А: Приватность → тумблер «Разрешить поиск по номеру» включён.
4. Б: Друзья → Ожидание → ввести `89123456789` → успех, сообщение «Заявка в друзья отправлена: <имя А>».
5. А: Приватность → выключить тумблер. Б повторяет поиск → «Пользователь не найден».
6. Б: DELETE через… (удаление номера проверяется в А): А → «Удалить» → строка «Не указан».
7. Обе темы (светлая/тёмная) и узкая ширина (mobile — `FriendsScreen`/`SettingsScreen` монтируют те же тела).
8. `npm run dev:vite` — не `npm run dev` (Electron-ловушка).

- [ ] **Step 4: Обновить README/доки при необходимости**

Если `README.md` или `docs/` явно перечисляют обязательные env — добавить `PHONE_ENC_KEY` (проверить `grep -rn "OTP_SECRET" README.md docs/`).

- [ ] **Step 5: Итоговый коммит (если были правки)**

```bash
git add <изменённые файлы>
git commit -m "VYC-97: финальные правки"
```