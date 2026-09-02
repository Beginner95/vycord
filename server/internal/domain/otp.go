package domain

import (
	"time"

	"github.com/google/uuid"
)

// OTPPurpose разделяет два независимых поводов кода — регистрация и вход —
// для писем и логов. Больше не входной параметр ни для RequestCode, ни для
// VerifyCode: юзкейс вычисляет его сам из состояния пользователя на момент
// Create и никогда не читает обратно из репозитория для поиска.
type OTPPurpose string

const (
	OTPPurposeRegistration OTPPurpose = "registration"
	OTPPurposeLogin        OTPPurpose = "login"
)

// OTPCode — одноразовый код, отправленный на почту. Сам код нигде не
// хранится: в CodeHash лежит HMAC-SHA256 на серверном секрете.
//
// UserID nullable: identifier-first не создаёт пользователя до подтверждения
// кода, так что код может существовать без строки в users. Email —
// единственный ключ, доступный на обоих концах жизни кода (до и после
// появления пользователя), поэтому весь репозиторий ключуется по нему.
type OTPCode struct {
	ID            uuid.UUID
	UserID        *uuid.UUID
	Email         string
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
	RetryAfter time.Duration
	Hourly     bool
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

// OTPRepository ключуется по email, а не по user_id — единственный ключ,
// доступный до появления пользователя. purpose убран из всех сигнатур,
// кроме Create: на email в любой момент живёт не больше одного не
// сожжённого кода (InvalidateActive гасит предыдущий перед каждым Create),
// так что фильтр по purpose для поиска избыточен.
type OTPRepository interface {
	Create(c *OTPCode) error
	// GetActive возвращает единственный живой код для email: не погашенный
	// и не аннулированный. ErrOTPNotFound, если такого нет.
	GetActive(email string) (*OTPCode, error)
	// IncrementAttempts атомарно проверяет остаток попыток И расходует один
	// слот, возвращая новое значение счётчика — одним UPDATE ... WHERE
	// attempts < maxAttempts ... RETURNING. Ноль задетых строк — ErrOTPNotFound.
	IncrementAttempts(id uuid.UUID, maxAttempts int) (int, error)
	// Consume гасит код. UPDATE ... WHERE consumed_at IS NULL, ErrOTPNotFound
	// при нуле задетых строк — единственное, что мешает двум одновременным
	// verify с верным кодом выдать два результата.
	Consume(id uuid.UUID, at time.Time) error
	InvalidateActive(email string) error
	CountIssuedSince(email string, since time.Time) (int, error)
	LastIssuedAt(email string) (*time.Time, error)
	DeleteExpiredBefore(t time.Time) (int64, error)
}
