package usecase

import (
	"errors"
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

// refreshGraceWindow — окно, в течение которого повторное предъявление уже
// ротированного refresh-токена трактуется как ретрай запроса, ответ на который
// не дошёл до клиента (обрыв сети, засыпание Electron посреди запроса), а не как
// reuse украденного токена. Без него потерянный ответ означал бы отзыв всей
// family и принудительный ре-логин — ровно тот сценарий, ради устранения
// которого refresh-токены и вводились. Это внутренний запас прочности,
// а не настройка: конфигурации/env-переменной сознательно нет.
const refreshGraceWindow = 30 * time.Second

type authUseCase struct {
	userRepo          domain.UserRepository
	refreshRepo       domain.RefreshTokenRepository
	jwtSecret         string
	jwtExpiration     time.Duration
	refreshExpiration time.Duration
}

func NewAuthUseCase(userRepo domain.UserRepository, refreshRepo domain.RefreshTokenRepository, jwtSecret string, jwtExpiration, refreshExpiration time.Duration) domain.AuthUseCase {
	return &authUseCase{
		userRepo:          userRepo,
		refreshRepo:       refreshRepo,
		jwtSecret:         jwtSecret,
		jwtExpiration:     jwtExpiration,
		refreshExpiration: refreshExpiration,
	}
}

func (uc *authUseCase) Register(username, email, password string) (*domain.User, string, string, error) {
	_, err := uc.userRepo.GetByEmail(email)
	if err == nil {
		return nil, "", "", domain.ErrEmailTaken
	}

	_, err = uc.userRepo.GetByUsername(username)
	if err == nil {
		return nil, "", "", domain.ErrUsernameTaken
	}

	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to hash password: %w", err)
	}

	now := time.Now()
	user := &domain.User{
		ID:        uuid.New(),
		Username:  username,
		Email:     email,
		Password:  string(hashedPassword),
		Status:    domain.StatusOffline,
		CreatedAt: now,
		UpdatedAt: now,
	}

	if err := uc.userRepo.Create(user); err != nil {
		return nil, "", "", fmt.Errorf("failed to create user: %w", err)
	}

	accessToken, err := uc.generateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate token: %w", err)
	}

	refreshToken, _, err := uc.issueRefreshToken(user.ID, uuid.New())
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to issue refresh token: %w", err)
	}

	user.Password = ""
	return user, accessToken, refreshToken, nil
}

func (uc *authUseCase) Login(email, password string) (*domain.User, string, string, error) {
	user, err := uc.userRepo.GetByEmail(email)
	if err != nil {
		return nil, "", "", domain.ErrInvalidCredentials
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, "", "", domain.ErrInvalidCredentials
	}

	accessToken, err := uc.generateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate token: %w", err)
	}

	refreshToken, _, err := uc.issueRefreshToken(user.ID, uuid.New())
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to issue refresh token: %w", err)
	}

	user.Password = ""
	return user, accessToken, refreshToken, nil
}

func (uc *authUseCase) ValidateToken(tokenString string) (*domain.User, error) {
	userID, err := authtoken.ValidateToken(uc.jwtSecret, tokenString)
	if err != nil {
		return nil, err
	}

	user, err := uc.userRepo.GetByID(userID)
	if err != nil {
		return nil, fmt.Errorf("user not found: %w", err)
	}

	return user, nil
}

// Refresh обменивает refreshToken на новую пару access+refresh. Ротация
// обязательна: старый токен помечается использованным при каждом успешном
// вызове. Если presented токен уже был помечен использованным раньше —
// это reuse украденного/дублированного токена, и вся его family
// отзывается целиком (см. docs/superpowers/specs/2026-08-11-vyc72-refresh-token-design.md).
//
// Исключение — grace-окно (refreshGraceWindow): токен, ротированный только что
// (RevokedAt свежий) и имеющий преемника (ReplacedBy != nil), почти наверняка
// предъявлен повторно потому, что ответ с новой парой не дошёл до клиента.
// Такой вызов обслуживается как обычная ротация. Токен, отозванный без
// преемника (ReplacedBy == nil, т.е. через Logout/RevokeFamily), под grace
// не попадает никогда — там повторное предъявление всегда подозрительно.
func (uc *authUseCase) Refresh(refreshToken string) (*domain.User, string, string, error) {
	hash := authtoken.HashRefreshToken(refreshToken)
	stored, err := uc.refreshRepo.GetByHash(hash)
	if err != nil {
		if errors.Is(err, domain.ErrRefreshTokenNotFound) {
			return nil, "", "", domain.ErrRefreshTokenInvalid
		}
		return nil, "", "", fmt.Errorf("failed to look up refresh token: %w", err)
	}

	// Проверка истечения идёт первой: протухший токен мёртв независимо от
	// grace-окна, и жечь из-за него всю family незачем.
	if time.Now().After(stored.ExpiresAt) {
		return nil, "", "", domain.ErrRefreshTokenInvalid
	}

	if stored.RevokedAt != nil {
		lostResponseRetry := stored.ReplacedBy != nil && time.Since(*stored.RevokedAt) < refreshGraceWindow
		if !lostResponseRetry {
			if err := uc.refreshRepo.RevokeFamily(stored.FamilyID); err != nil {
				return nil, "", "", fmt.Errorf("failed to revoke refresh token family: %w", err)
			}
			return nil, "", "", domain.ErrRefreshTokenInvalid
		}
		// Иначе проваливаемся в обычную ротацию ниже. Повторный MarkRotated по
		// той же строке безопасен: он просто перезапишет revoked_at/replaced_by
		// новыми значениями. Ребёнок из потерянного ответа остаётся сиротой
		// и тихо истечёт неиспользованным.
	}

	user, err := uc.userRepo.GetByID(stored.UserID)
	if err != nil {
		return nil, "", "", fmt.Errorf("user not found: %w", err)
	}

	newRefreshToken, newRecord, err := uc.issueRefreshToken(stored.UserID, stored.FamilyID)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to issue refresh token: %w", err)
	}

	if err := uc.refreshRepo.MarkRotated(stored.ID, newRecord.ID, time.Now()); err != nil {
		return nil, "", "", fmt.Errorf("failed to rotate refresh token: %w", err)
	}

	accessToken, err := uc.generateAccessToken(user)
	if err != nil {
		return nil, "", "", fmt.Errorf("failed to generate token: %w", err)
	}

	user.Password = ""
	return user, accessToken, newRefreshToken, nil
}

// Logout отзывает всю сессию (family), к которой принадлежит refreshToken.
// Не требует, чтобы access-токен был ещё валиден — логаут должен работать
// и когда он уже истёк. Неизвестный токен — не ошибка (уже разлогинен).
func (uc *authUseCase) Logout(refreshToken string) error {
	hash := authtoken.HashRefreshToken(refreshToken)
	stored, err := uc.refreshRepo.GetByHash(hash)
	if err != nil {
		if errors.Is(err, domain.ErrRefreshTokenNotFound) {
			return nil
		}
		return fmt.Errorf("failed to look up refresh token: %w", err)
	}
	return uc.refreshRepo.RevokeFamily(stored.FamilyID)
}

func (uc *authUseCase) issueRefreshToken(userID, familyID uuid.UUID) (string, *domain.RefreshToken, error) {
	token, err := authtoken.GenerateRefreshToken()
	if err != nil {
		return "", nil, err
	}

	now := time.Now()
	record := &domain.RefreshToken{
		ID:        uuid.New(),
		UserID:    userID,
		FamilyID:  familyID,
		TokenHash: authtoken.HashRefreshToken(token),
		CreatedAt: now,
		ExpiresAt: now.Add(uc.refreshExpiration),
	}

	if err := uc.refreshRepo.Create(record); err != nil {
		return "", nil, err
	}

	return token, record, nil
}

func (uc *authUseCase) generateAccessToken(user *domain.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id":  user.ID.String(),
		"username": user.Username,
		"exp":      time.Now().Add(uc.jwtExpiration).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(uc.jwtSecret))
}
