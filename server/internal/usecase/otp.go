package usecase

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha256"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"strings"
	"time"

	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/vycord/server/internal/domain"
)

// OTPPolicy — параметры стойкости, приходящие из конфигурации.
// 4-значный код держится не на своей энтропии (10 000 вариантов), а на этих
// числах: MaxAttempts попыток на код и не более MaxPerHour кодов в час дают
// максимум MaxAttempts*MaxPerHour попыток в час на email. При значениях по
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

func (uc *otpUseCase) RequestCode(email string) error {
	// Нормализация ДО любого обращения к репозиторию/HMAC: без неё
	// Foo@bar.com и foo@bar.com — два разных email с точки зрения БД
	// (сравнение без LOWER()), и identifier-first тихо заводит вторую
	// учётку на одном и том же почтовом ящике.
	email = strings.ToLower(strings.TrimSpace(email))

	now := time.Now()

	// Ошибка здесь неотличима от «не найден» (см. userRepository.GetByEmail) —
	// и не должна быть отличима: идентификатор-first требует одинакового
	// поведения для существующего и несуществующего email.
	user, _ := uc.userRepo.GetByEmail(email)

	last, err := uc.otpRepo.LastIssuedAt(email)
	if err != nil {
		return fmt.Errorf("failed to read last otp issue time: %w", err)
	}
	if last != nil {
		if elapsed := now.Sub(*last); elapsed < uc.policy.ResendCooldown {
			return &domain.OTPThrottledError{RetryAfter: uc.policy.ResendCooldown - elapsed}
		}
	}

	issued, err := uc.otpRepo.CountIssuedSince(email, now.Add(-time.Hour))
	if err != nil {
		return fmt.Errorf("failed to count issued otp codes: %w", err)
	}
	if issued >= uc.policy.MaxPerHour {
		return &domain.OTPThrottledError{RetryAfter: time.Hour, Hourly: true}
	}

	if err := uc.otpRepo.InvalidateActive(email); err != nil {
		return fmt.Errorf("failed to invalidate previous otp codes: %w", err)
	}

	code, err := generateOTPCode()
	if err != nil {
		return err
	}

	// purpose — вычисляется, не принимается от клиента: подтверждённый
	// пользователь получает код «login-вида», иначе — «registration-вида».
	// Это чистая информация для письма и логов; поиск кода при verify идёт
	// по email независимо от значения.
	var userID *uuid.UUID
	purpose := domain.OTPPurposeRegistration
	if user != nil && user.EmailVerifiedAt != nil {
		id := user.ID
		userID = &id
		purpose = domain.OTPPurposeLogin
	}

	record := &domain.OTPCode{
		ID:        uuid.New(),
		UserID:    userID,
		Email:     email,
		Purpose:   purpose,
		CodeHash:  hashOTPCode(uc.policy.Secret, email, purpose, code),
		CreatedAt: now,
		ExpiresAt: now.Add(uc.policy.TTL),
	}

	// Порядок существенный: код сохраняется ДО отправки. При обратном
	// порядке упавшая посередине отправка оставила бы пользователя с письмом
	// на руках и без кода в базе.
	if err := uc.otpRepo.Create(record); err != nil {
		return fmt.Errorf("failed to store otp code: %w", err)
	}

	if err := uc.mailer.Send(renderOTPMessage(email, code, purpose, uc.policy.TTL)); err != nil {
		// В лог идут только purpose и email: код и его HMAC не логируются
		// нигде и никогда.
		uc.log.Error("otp mail send failed", "email", email, "purpose", purpose, "error", err)
		return domain.ErrMailSendFailed
	}

	return nil
}

func (uc *otpUseCase) VerifyCode(email, code, username string) (*domain.User, string, string, error) {
	// См. комментарий в RequestCode — нормализация обязана произойти до
	// первого использования email, иначе один и тот же ящик в разном
	// регистре проходит мимо GetActive/GetByEmail как будто это два адреса.
	email = strings.ToLower(strings.TrimSpace(email))

	stored, err := uc.otpRepo.GetActive(email)
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

	// Попытка расходуется ДО сравнения кода, и расходуется атомарно — см.
	// комментарий у domain.OTPRepository.IncrementAttempts.
	attempts, err := uc.otpRepo.IncrementAttempts(stored.ID, uc.policy.MaxAttempts)
	if err != nil {
		if errors.Is(err, domain.ErrOTPNotFound) {
			if err := uc.otpRepo.InvalidateActive(email); err != nil {
				return nil, "", "", fmt.Errorf("failed to burn otp code: %w", err)
			}
			return nil, "", "", domain.ErrOTPAttemptsExceeded
		}
		return nil, "", "", fmt.Errorf("failed to increment otp attempts: %w", err)
	}

	if !hmac.Equal(stored.CodeHash, hashOTPCode(uc.policy.Secret, email, stored.Purpose, code)) {
		if attempts >= uc.policy.MaxAttempts {
			if err := uc.otpRepo.InvalidateActive(email); err != nil {
				return nil, "", "", fmt.Errorf("failed to burn otp code: %w", err)
			}
			return nil, "", "", domain.ErrOTPAttemptsExceeded
		}
		return nil, "", "", &domain.OTPAttemptError{AttemptsLeft: uc.policy.MaxAttempts - attempts}
	}

	// Код доказанно верный. Ветвление вход-или-регистрация решается здесь,
	// перечитывая состояние заново — оно могло измениться с момента
	// RequestCode (кто-то другой мог тем временем зарегистрировать этот
	// email через параллельный verify).
	user, _ := uc.userRepo.GetByEmail(email)

	if user != nil {
		now := time.Now()
		if err := uc.otpRepo.Consume(stored.ID, now); err != nil {
			if errors.Is(err, domain.ErrOTPNotFound) {
				return nil, "", "", domain.ErrOTPInvalid
			}
			return nil, "", "", fmt.Errorf("failed to consume otp code: %w", err)
		}
		if user.EmailVerifiedAt == nil {
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

	// email ещё никому не принадлежит — регистрационная ветка.
	if username == "" {
		return nil, "", "", domain.ErrUsernameRequired
	}

	if _, err := uc.userRepo.GetByUsername(username); err == nil {
		return nil, "", "", domain.ErrUsernameTaken
	}

	now := time.Now()
	// Consume ДО Create: это единственное, что мешает двум одновременным
	// verify для одного и того же нового email создать двух пользователей —
	// тот же приём, что уже защищает существующих пользователей выше.
	if err := uc.otpRepo.Consume(stored.ID, now); err != nil {
		if errors.Is(err, domain.ErrOTPNotFound) {
			return nil, "", "", domain.ErrOTPInvalid
		}
		return nil, "", "", fmt.Errorf("failed to consume otp code: %w", err)
	}

	newUser, err := uc.createVerifiedUser(email, username, now)
	if err != nil {
		return nil, "", "", err
	}

	accessToken, refreshToken, err := uc.issuePair(newUser)
	if err != nil {
		return nil, "", "", err
	}
	newUser.Password = ""
	return newUser, accessToken, refreshToken, nil
}

// createVerifiedUser материализует аккаунт, дошедший до этой точки только
// доказав владение почтой одноразовым кодом. Пароль — случайные байты,
// прогнанные через bcrypt: колонка password_hash остаётся NOT NULL, а
// identifier-first-аккаунты паролем не пользуются вовсе (см. дизайн-спеку,
// раздел «Пароль»). Случайность делает результат непредсказуемым: сравнение
// с ним по паролю не совпадёт математически никогда.
func (uc *otpUseCase) createVerifiedUser(email, username string, now time.Time) (*domain.User, error) {
	randomPassword := make([]byte, 32)
	if _, err := rand.Read(randomPassword); err != nil {
		return nil, fmt.Errorf("failed to generate random password: %w", err)
	}
	hashedPassword, err := bcrypt.GenerateFromPassword(randomPassword, bcrypt.DefaultCost)
	if err != nil {
		return nil, fmt.Errorf("failed to hash random password: %w", err)
	}

	user := &domain.User{
		ID:              uuid.New(),
		Username:        username,
		Email:           email,
		Password:        string(hashedPassword),
		Status:          domain.StatusOffline,
		CreatedAt:       now,
		UpdatedAt:       now,
		EmailVerifiedAt: &now,
	}
	if err := uc.userRepo.Create(user); err != nil {
		// Гонка на username между двумя РАЗНЫМИ новыми email: оба проходят
		// GetByUsername до Create (см. VerifyCode), проигравший ловит здесь
		// нарушение уникальности username. Пробрасываем сентинел как есть —
		// не оборачиваем — чтобы handler'ский errors.Is(err, ErrUsernameTaken)
		// (уже маппится в 409) сработал; всё остальное по-прежнему 500.
		if errors.Is(err, domain.ErrUsernameTaken) || errors.Is(err, domain.ErrEmailTaken) {
			return nil, err
		}
		return nil, fmt.Errorf("failed to create user: %w", err)
	}
	return user, nil
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

// hashOTPCode — HMAC-SHA256 на серверном секрете. В вход входят email и
// purpose, а не только код: строка из дампа БД не переносится на другой
// email или в другой поток, даже если коды совпали. email вместо userID —
// единственный ключ, стабильно известный на обоих концах жизни кода (до и
// после появления пользователя).
func hashOTPCode(secret, email string, p domain.OTPPurpose, code string) []byte {
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(email))
	mac.Write([]byte(p))
	mac.Write([]byte(code))
	return mac.Sum(nil)
}
