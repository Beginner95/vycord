package usecase

import (
	"errors"
	"fmt"
	"time"

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
	*tokenIssuer
	userRepo domain.UserRepository
}

func NewAuthUseCase(userRepo domain.UserRepository, refreshRepo domain.RefreshTokenRepository, jwtSecret string, jwtExpiration, refreshExpiration time.Duration) domain.AuthUseCase {
	return &authUseCase{
		tokenIssuer: newTokenIssuer(refreshRepo, jwtSecret, jwtExpiration, refreshExpiration),
		userRepo:    userRepo,
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

	accessToken, refreshToken, err := uc.issuePair(user)
	if err != nil {
		return nil, "", "", err
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

	accessToken, refreshToken, err := uc.issuePair(user)
	if err != nil {
		return nil, "", "", err
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
//
// Одного возраста отзыва мало: grace выдаётся только если преемник токена
// САМ ещё не отозван. RevokeFamily трогает лишь строки с revoked_at IS NULL,
// поэтому логаут не задевает уже ротированный токен — без проверки преемника
// его можно было бы предъявить внутри grace-окна и получить живой токен
// в только что погашенной логаутом family, отменив логаут.
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
		lostResponseRetry := false
		if stored.ReplacedBy != nil && time.Since(*stored.RevokedAt) < refreshGraceWindow {
			// Возраст подходит — остаётся убедиться, что family не погасили
			// уже ПОСЛЕ этой ротации (логаут, reuse-detect).
			alive, err := uc.successorIsAlive(*stored.ReplacedBy)
			if err != nil {
				return nil, "", "", err
			}
			lostResponseRetry = alive
		}
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

// successorIsAlive сообщает, жив ли (не отозван) преемник ротированного
// токена — условие выдачи grace-окна в Refresh. Ошибку инфраструктуры
// возвращает как есть (обёрнутой), а НЕ как ErrRefreshTokenInvalid: сбой
// похода в БД — не вердикт о безопасности токена, и путать их здесь нельзя.
func (uc *authUseCase) successorIsAlive(successorID uuid.UUID) (bool, error) {
	successor, err := uc.refreshRepo.GetByID(successorID)
	if err != nil {
		// Защитная ветка: replaced_by обязан ссылаться на реальную строку.
		// Если её всё же нет — живого преемника нет, grace не выдаём.
		if errors.Is(err, domain.ErrRefreshTokenNotFound) {
			return false, nil
		}
		return false, fmt.Errorf("failed to look up successor refresh token: %w", err)
	}
	return successor.RevokedAt == nil, nil
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
