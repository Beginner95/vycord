package usecase

import (
	"fmt"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
	"golang.org/x/crypto/bcrypt"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

type authUseCase struct {
	userRepo      domain.UserRepository
	jwtSecret     string
	jwtExpiration time.Duration
}

func NewAuthUseCase(userRepo domain.UserRepository, jwtSecret string, jwtExpiration time.Duration) domain.AuthUseCase {
	return &authUseCase{
		userRepo:      userRepo,
		jwtSecret:     jwtSecret,
		jwtExpiration: jwtExpiration,
	}
}

func (uc *authUseCase) Register(username, email, password string) (*domain.User, string, error) {
	// Check if user already exists
	_, err := uc.userRepo.GetByEmail(email)
	if err == nil {
		return nil, "", domain.ErrEmailTaken
	}

	_, err = uc.userRepo.GetByUsername(username)
	if err == nil {
		return nil, "", domain.ErrUsernameTaken
	}

	// Hash password
	hashedPassword, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return nil, "", fmt.Errorf("failed to hash password: %w", err)
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
		return nil, "", fmt.Errorf("failed to create user: %w", err)
	}

	// Generate token
	token, err := uc.generateToken(user)
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}

	// Clear password before returning
	user.Password = ""
	return user, token, nil
}

func (uc *authUseCase) Login(email, password string) (*domain.User, string, error) {
	user, err := uc.userRepo.GetByEmail(email)
	if err != nil {
		return nil, "", domain.ErrInvalidCredentials
	}

	// Compare password
	if err := bcrypt.CompareHashAndPassword([]byte(user.Password), []byte(password)); err != nil {
		return nil, "", domain.ErrInvalidCredentials
	}

	// Generate JWT token
	token, err := uc.generateToken(user)
	if err != nil {
		return nil, "", fmt.Errorf("failed to generate token: %w", err)
	}

	// Clear password before returning
	user.Password = ""
	return user, token, nil
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

func (uc *authUseCase) generateToken(user *domain.User) (string, error) {
	claims := jwt.MapClaims{
		"user_id":  user.ID.String(),
		"username": user.Username,
		"exp":      time.Now().Add(uc.jwtExpiration).Unix(),
		"iat":      time.Now().Unix(),
	}

	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	return token.SignedString([]byte(uc.jwtSecret))
}
