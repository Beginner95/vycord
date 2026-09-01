package domain

import (
	"time"

	"github.com/google/uuid"
)

// OTPPurpose разделяет два независимых потока кодов. Код, выпущенный для
// подтверждения регистрации, не должен подходить для входа, и наоборот:
// иначе один поток обходил бы проверки другого.
type OTPPurpose string

const (
	OTPPurposeRegistration OTPPurpose = "registration"
	OTPPurposeLogin        OTPPurpose = "login"
)

// OTPCode — одноразовый код, отправленный на почту. Сам код нигде не
// хранится: в CodeHash лежит HMAC-SHA256 на серверном секрете. Простого
// хеша было бы мало — пространство 4-значного кода это 10 000 значений,
// и радужная таблица по дампу БД строится мгновенно.
type OTPCode struct {
	ID            uuid.UUID
	UserID        uuid.UUID
	Purpose       OTPPurpose
	CodeHash      []byte
	Attempts      int
	CreatedAt     time.Time
	ExpiresAt     time.Time
	ConsumedAt    *time.Time
	InvalidatedAt *time.Time
}

// OTPThrottledError — отказ по лимиту. Не сентинел, а тип, потому что
// хендлеру нужно число для заголовка Retry-After.
type OTPThrottledError struct {
	// RetryAfter — сколько ждать до следующей разрешённой отправки.
	RetryAfter time.Duration
	// Hourly различает два лимита: false — кулдаун между отправками,
	// true — часовой потолок. Клиент показывает разные тексты.
	Hourly bool
}

func (e *OTPThrottledError) Error() string {
	if e.Hourly {
		return "too many codes requested"
	}
	return "code was requested too recently"
}

// OTPAttemptError — неверный код с указанием, сколько попыток осталось до
// сжигания. Оборачивает ErrOTPInvalid, поэтому errors.Is(err, ErrOTPInvalid)
// продолжает работать, а хендлер дополнительно достаёт число через errors.As.
type OTPAttemptError struct {
	AttemptsLeft int
}

func (e *OTPAttemptError) Error() string { return ErrOTPInvalid.Error() }

func (e *OTPAttemptError) Unwrap() error { return ErrOTPInvalid }

type OTPRepository interface {
	Create(c *OTPCode) error
	// GetActive возвращает единственный живой код пары user+purpose:
	// не погашенный и не аннулированный. ErrOTPNotFound, если такого нет.
	// Истечение по времени НЕ проверяется здесь — это решение юзкейса,
	// репозиторий не должен знать про часы.
	GetActive(userID uuid.UUID, p OTPPurpose) (*OTPCode, error)
	// IncrementAttempts атомарно увеличивает счётчик и возвращает новое
	// значение. Обязан быть одним UPDATE ... RETURNING: read-modify-write
	// в юзкейсе позволил бы двум параллельным попыткам израсходовать
	// один и тот же слот.
	IncrementAttempts(id uuid.UUID) (int, error)
	// Consume гасит код. Обязан выполняться как UPDATE ... WHERE
	// consumed_at IS NULL и возвращать ErrOTPNotFound, если строк не
	// задето: это единственное, что мешает двум одновременным verify
	// с верным кодом выдать две сессии.
	Consume(id uuid.UUID, at time.Time) error
	// InvalidateActive гасит все живые коды пары user+purpose. Вызывается
	// и при исчерпании попыток, и перед выпуском нового кода — живой код
	// всегда ровно один.
	InvalidateActive(userID uuid.UUID, p OTPPurpose) error
	CountIssuedSince(userID uuid.UUID, p OTPPurpose, since time.Time) (int, error)
	// LastIssuedAt возвращает время выпуска последнего кода пары, либо nil,
	// если кодов не было. Основа кулдауна.
	LastIssuedAt(userID uuid.UUID, p OTPPurpose) (*time.Time, error)
	DeleteExpiredBefore(t time.Time) (int64, error)
}
