package usecase

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"time"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/domain"
)

// OTPPolicy — параметры стойкости, приходящие из конфигурации.
// 4-значный код держится не на своей энтропии (10 000 вариантов), а на этих
// числах: MaxAttempts попыток на код и не более MaxPerHour кодов в час дают
// максимум MaxAttempts*MaxPerHour попыток в час на аккаунт. При значениях по
// умолчанию (3 и 5) это 15 попыток — 0,15 % шанса подбора в час.
type OTPPolicy struct {
	Secret         string
	TTL            time.Duration
	MaxAttempts    int
	ResendCooldown time.Duration
	MaxPerHour     int
}

type otpUseCase struct {
	*tokenIssuer
	userRepo domain.UserRepository
	otpRepo  domain.OTPRepository
	mailer   domain.Mailer
	policy   OTPPolicy
	log      *slog.Logger
}

func NewOTPUseCase(
	userRepo domain.UserRepository,
	otpRepo domain.OTPRepository,
	mailer domain.Mailer,
	refreshRepo domain.RefreshTokenRepository,
	jwtSecret string,
	jwtExpiration, refreshExpiration time.Duration,
	policy OTPPolicy,
	log *slog.Logger,
) domain.OTPUseCase {
	return &otpUseCase{
		tokenIssuer: newTokenIssuer(refreshRepo, jwtSecret, jwtExpiration, refreshExpiration),
		userRepo:    userRepo,
		otpRepo:     otpRepo,
		mailer:      mailer,
		policy:      policy,
		log:         log,
	}
}

func (uc *otpUseCase) RequestCode(email string, p domain.OTPPurpose) error {
	// Пользователя нет или он не подходит под purpose — выходим успехом, не
	// отправляя писем. Иначе ответ API сообщал бы, существует ли аккаунт,
	// и заодно позволял бы слать письма на произвольные адреса.
	user, err := uc.userRepo.GetByEmail(email)
	if err != nil || !purposeFits(user, p) {
		return nil
	}

	now := time.Now()

	last, err := uc.otpRepo.LastIssuedAt(user.ID, p)
	if err != nil {
		return fmt.Errorf("failed to read last otp issue time: %w", err)
	}
	if last != nil {
		if elapsed := now.Sub(*last); elapsed < uc.policy.ResendCooldown {
			return &domain.OTPThrottledError{RetryAfter: uc.policy.ResendCooldown - elapsed}
		}
	}

	issued, err := uc.otpRepo.CountIssuedSince(user.ID, p, now.Add(-time.Hour))
	if err != nil {
		return fmt.Errorf("failed to count issued otp codes: %w", err)
	}
	if issued >= uc.policy.MaxPerHour {
		// Точное время освобождения слота потребовало бы хранить время
		// самого старого кода в окне. Час — заведомо достаточная и честная
		// верхняя оценка.
		return &domain.OTPThrottledError{RetryAfter: time.Hour, Hourly: true}
	}

	if err := uc.otpRepo.InvalidateActive(user.ID, p); err != nil {
		return fmt.Errorf("failed to invalidate previous otp codes: %w", err)
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}

	record := &domain.OTPCode{
		ID:        uuid.New(),
		UserID:    user.ID,
		Purpose:   p,
		CodeHash:  hashOTPCode(uc.policy.Secret, user.ID, p, code),
		CreatedAt: now,
		ExpiresAt: now.Add(uc.policy.TTL),
	}

	// Порядок существенный: код сохраняется ДО отправки. При обратном
	// порядке упавшая посередине отправка оставила бы пользователя с письмом
	// на руках и без кода в базе.
	if err := uc.otpRepo.Create(record); err != nil {
		return fmt.Errorf("failed to store otp code: %w", err)
	}

	if err := uc.mailer.Send(renderOTPMessage(user.Email, code, p, uc.policy.TTL)); err != nil {
		// В лог идут только user_id и purpose: код и его HMAC не логируются
		// нигде и никогда.
		uc.log.Error("otp mail send failed", "user_id", user.ID, "purpose", p, "error", err)
		return domain.ErrMailSendFailed
	}

	return nil
}

func (uc *otpUseCase) VerifyCode(email, code string, p domain.OTPPurpose) (*domain.User, string, string, error) {
	// Все ранние отказы отвечают одинаковым ErrOTPInvalid: нет пользователя,
	// не тот purpose, нет живого кода, код истёк. Различать их в ответе
	// значило бы подсказывать атакующему, на каком шаге он ошибся.
	user, err := uc.userRepo.GetByEmail(email)
	if err != nil || !purposeFits(user, p) {
		return nil, "", "", domain.ErrOTPInvalid
	}

	stored, err := uc.otpRepo.GetActive(user.ID, p)
	if err != nil {
		if errors.Is(err, domain.ErrOTPNotFound) {
			return nil, "", "", domain.ErrOTPInvalid
		}
		return nil, "", "", fmt.Errorf("failed to look up otp code: %w", err)
	}

	// Проверка срока идёт до инкремента попыток: истёкший код мёртв, и
	// тратить на него попытки незачем.
	if time.Now().After(stored.ExpiresAt) {
		return nil, "", "", domain.ErrOTPInvalid
	}

	if !hmac.Equal(stored.CodeHash, hashOTPCode(uc.policy.Secret, user.ID, p, code)) {
		attempts, err := uc.otpRepo.IncrementAttempts(stored.ID)
		if err != nil {
			return nil, "", "", fmt.Errorf("failed to increment otp attempts: %w", err)
		}
		if attempts >= uc.policy.MaxAttempts {
			if err := uc.otpRepo.InvalidateActive(user.ID, p); err != nil {
				return nil, "", "", fmt.Errorf("failed to burn otp code: %w", err)
			}
			return nil, "", "", domain.ErrOTPAttemptsExceeded
		}
		return nil, "", "", &domain.OTPAttemptError{AttemptsLeft: uc.policy.MaxAttempts - attempts}
	}

	now := time.Now()
	// Consume — точка сериализации: при двух одновременных проверках с
	// верным кодом строку задевает только один запрос, второй получает
	// ErrOTPNotFound и уходит с отказом. Иначе выдались бы две сессии.
	if err := uc.otpRepo.Consume(stored.ID, now); err != nil {
		if errors.Is(err, domain.ErrOTPNotFound) {
			return nil, "", "", domain.ErrOTPInvalid
		}
		return nil, "", "", fmt.Errorf("failed to consume otp code: %w", err)
	}

	if p == domain.OTPPurposeRegistration {
		if err := uc.userRepo.MarkEmailVerified(user.ID, now); err != nil {
			return nil, "", "", fmt.Errorf("failed to mark email verified: %w", err)
		}
		user.EmailVerifiedAt = &now
	}

	accessToken, refreshToken, err := uc.issuePair(user)
	if err != nil {
		return nil, "", "", err
	}

	user.Password = ""
	return user, accessToken, refreshToken, nil
}

// purposeFits проверяет, что поток кодов соответствует состоянию аккаунта.
// Код подтверждения регистрации бессмыслен для уже подтверждённого, а вход
// по коду закрыт для неподтверждённого — иначе OTP-вход обходил бы саму
// проверку почты.
func purposeFits(user *domain.User, p domain.OTPPurpose) bool {
	switch p {
	case domain.OTPPurposeRegistration:
		return user.EmailVerifiedAt == nil
	case domain.OTPPurposeLogin:
		return user.EmailVerifiedAt != nil
	}
	return false
}

// generateOTPCode возвращает 4 десятичные цифры из crypto/rand.
// math/rand здесь недопустим: его последовательность предсказуема по
// нескольким наблюдённым значениям, а наблюдать их может любой, кто
// запрашивает коды на собственный адрес.
func generateOTPCode() (string, error) {
	n, err := rand.Int(rand.Reader, big.NewInt(10000))
	if err != nil {
		return "", fmt.Errorf("failed to generate otp code: %w", err)
	}
	return fmt.Sprintf("%04d", n.Int64()), nil
}

// hashOTPCode — HMAC-SHA256 на серверном секрете. В вход входят userID и
// purpose, а не только код: так строка из дампа БД не переносится на другого
// пользователя или в другой поток, даже если коды совпали.
func hashOTPCode(secret string, userID uuid.UUID, p domain.OTPPurpose, code string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(userID.String()))
	mac.Write([]byte(p))
	mac.Write([]byte(code))
	return mac.Sum(nil)
}
