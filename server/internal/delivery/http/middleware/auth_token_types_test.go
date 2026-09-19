package middleware_test

import (
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/authtoken"
)

const tokenTypesSecret = "middleware-token-types-secret"

// forbiddenUserRepo fails the test if RequireAuth ever reaches the database:
// a token of the wrong kind must be rejected on its claims alone.
type forbiddenUserRepo struct {
	domain.UserRepository
	t *testing.T
}

func (r forbiddenUserRepo) GetByID(uuid.UUID) (*domain.User, error) {
	r.t.Fatal("RequireAuth reached the user repository for a token of the wrong type")
	return nil, nil
}

// Н1, Н2, Н6: neither a guest session token, nor a guest room token, nor an
// account voice token is an access token.
func TestRequireAuth_RejectsNonAccessTokens(t *testing.T) {
	sessionToken, err := authtoken.GenerateOpaqueSecret()
	require.NoError(t, err)
	guestRoomToken, err := authtoken.GenerateGuestRoomToken(tokenTypesSecret, uuid.New(), uuid.New(), time.Minute)
	require.NoError(t, err)
	voiceToken, err := authtoken.GenerateRoomToken(tokenTypesSecret, uuid.New(), uuid.New(), time.Minute)
	require.NoError(t, err)

	for name, token := range map[string]string{
		"guest session token (Н1)": sessionToken,
		"guest room token (Н2)":    guestRoomToken,
		"account voice token (Н6)": voiceToken,
		"garbage":                  "not-a-token",
	} {
		t.Run(name, func(t *testing.T) {
			authUC := usecase.NewAuthUseCase(forbiddenUserRepo{t: t}, nil, tokenTypesSecret, time.Hour, time.Hour)
			mid := middleware.NewAuthMiddleware(authUC, slog.New(slog.NewTextHandler(io.Discard, nil)))

			called := false
			h := mid.RequireAuth(func(http.ResponseWriter, *http.Request) { called = true })
			req := httptest.NewRequest(http.MethodGet, "/api/v1/auth/me", nil)
			req.Header.Set("Authorization", "Bearer "+token)
			rec := httptest.NewRecorder()
			h(rec, req)

			assert.Equal(t, http.StatusUnauthorized, rec.Code)
			assert.Contains(t, rec.Body.String(), `"code":"invalid_or_expired_token"`)
			assert.False(t, called)
		})
	}
}

// guestSessionRepo records the hash GuestAuth looked up and finds nothing.
type guestSessionRepo struct {
	domain.GuestRepository
	lookedUp []byte
}

func (r *guestSessionRepo) GetSessionByHash(hash []byte) (*domain.GuestContext, error) {
	r.lookedUp = hash
	return nil, domain.ErrGuestSessionInvalid
}

// Н5: an account access token is not a guest session — it is hashed, looked up
// and not found, exactly like any other string.
func TestGuestAuth_RejectsAccountAccessToken(t *testing.T) {
	repo := &guestSessionRepo{}
	guestUC := usecase.NewGuestUseCase(usecase.GuestUseCaseDeps{Repo: repo, JWTSecret: tokenTypesSecret})
	mid := middleware.NewGuestAuth(guestUC, slog.New(slog.NewTextHandler(io.Discard, nil)))

	accessToken, err := authtoken.GenerateRoomToken(tokenTypesSecret, uuid.New(), uuid.New(), time.Minute)
	require.NoError(t, err)

	called := false
	h := mid.Require(func(http.ResponseWriter, *http.Request) { called = true })
	req := httptest.NewRequest(http.MethodPost, "/api/v1/guest/voice-token", nil)
	req.Header.Set("Authorization", "Bearer "+accessToken)
	rec := httptest.NewRecorder()
	h(rec, req)

	assert.Equal(t, http.StatusUnauthorized, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"guest_session_invalid"`)
	assert.False(t, called)
	assert.Equal(t, authtoken.HashOpaqueSecret(accessToken), repo.lookedUp)
}
