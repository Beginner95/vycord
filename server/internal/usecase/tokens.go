package usecase

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

// tokenIssuer выдаёт пару access+refresh. Выделен из authUseCase, потому что
// ровно та же выдача нужна otpUseCase: после успешной проверки кода с почты
// пользователь получает такую же сессию, как после входа по паролю.
// Дублировать сборку claims в двух юзкейсах нельзя — любое изменение формата
// токена пришлось бы вносить дважды, и расхождение обнаружилось бы только на
// проде.
type tokenIssuer struct {
	refreshRepo       domain.RefreshTokenRepository
	jwtSecret         string
	jwtExpiration     time.Duration
	refreshExpiration time.Duration
}

func newTokenIssuer(refreshRepo domain.RefreshTokenRepository, jwtSecret string, jwtExpiration, refreshExpiration time.Duration) *tokenIssuer {
	return &tokenIssuer{
		refreshRepo:       refreshRepo,
		jwtSecret:         jwtSecret,
		jwtExpiration:     jwtExpiration,
		refreshExpiration: refreshExpiration,
	}
}

// issuePair открывает новую сессию: access-токен и refresh-токен в новой
// family. Используется везде, где пользователь только что доказал, кто он —
// логин по паролю, регистрация, подтверждение кода с почты.
func (ti *tokenIssuer) issuePair(user *domain.User) (string, string, error) {
	accessToken, err := ti.generateAccessToken(user)
	if err != nil {
		return "", "", fmt.Errorf("failed to generate token: %w", err)
	}

	refreshToken, _, err := ti.issueRefreshToken(user.ID, uuid.New())
	if err != nil {
		return "", "", fmt.Errorf("failed to issue refresh token: %w", err)
	}

	return accessToken, refreshToken, nil
}

func (ti *tokenIssuer) issueRefreshToken(userID, familyID uuid.UUID) (string, *domain.RefreshToken, error) {
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
		ExpiresAt: now.Add(ti.refreshExpiration),
	}

	if err := ti.refreshRepo.Create(record); err != nil {
		return "", nil, err
	}

	return token, record, nil
}

func (ti *tokenIssuer) generateAccessToken(user *domain.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id":  user.ID.String(),
		"username": user.Username,
		"exp":      time.Now().Add(ti.jwtExpiration).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(ti.jwtSecret))
}
