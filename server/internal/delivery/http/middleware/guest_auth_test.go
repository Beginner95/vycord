package middleware

import (
	"errors"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
)

type stubGuestAuth struct {
	token string
	guest *domain.GuestContext
	err   error
}

func (s *stubGuestAuth) Authenticate(sessionToken string) (*domain.GuestContext, error) {
	s.token = sessionToken
	return s.guest, s.err
}

func newGuestAuthFixture(guest *domain.GuestContext, err error) (*GuestAuth, *stubGuestAuth) {
	stub := &stubGuestAuth{guest: guest, err: err}
	return NewGuestAuth(stub, slog.New(slog.NewTextHandler(io.Discard, nil))), stub
}

func TestGuestAuth_PutsGuestInContext(t *testing.T) {
	guest := &domain.GuestContext{Guest: domain.CallGuest{ID: uuid.New(), Status: domain.GuestStatusAdmitted}}
	m, stub := newGuestAuthFixture(guest, nil)

	var seen *domain.GuestContext
	h := m.Require(func(w http.ResponseWriter, r *http.Request) {
		g, ok := GuestFromContext(r.Context())
		require.True(t, ok)
		seen = g
		w.WriteHeader(http.StatusNoContent)
	})

	req := httptest.NewRequest(http.MethodPost, "/api/v1/guest/leave", nil)
	req.Header.Set("Authorization", "Bearer session-token")
	rec := httptest.NewRecorder()
	h(rec, req)

	assert.Equal(t, http.StatusNoContent, rec.Code)
	assert.Equal(t, "session-token", stub.token)
	assert.Equal(t, guest.Guest.ID, seen.Guest.ID)

	// The guest never lands under the user_id key the account handlers read.
	assert.Nil(t, req.Context().Value("user_id"))
}

func TestGuestAuth_Rejects(t *testing.T) {
	cases := map[string]struct {
		header string
		err    error
		status int
		code   string
	}{
		"no header":        {"", nil, http.StatusUnauthorized, "guest_session_invalid"},
		"not bearer":       {"session-token", nil, http.StatusUnauthorized, "guest_session_invalid"},
		"empty token":      {"Bearer ", nil, http.StatusUnauthorized, "guest_session_invalid"},
		"invalid session":  {"Bearer x", domain.ErrGuestSessionInvalid, http.StatusUnauthorized, "guest_session_invalid"},
		"repository error": {"Bearer x", errors.New("db is down"), http.StatusInternalServerError, "internal_error"},
	}
	for name, c := range cases {
		t.Run(name, func(t *testing.T) {
			m, _ := newGuestAuthFixture(nil, c.err)
			called := false
			h := m.Require(func(http.ResponseWriter, *http.Request) { called = true })

			req := httptest.NewRequest(http.MethodPost, "/api/v1/guest/leave", nil)
			if c.header != "" {
				req.Header.Set("Authorization", c.header)
			}
			rec := httptest.NewRecorder()
			h(rec, req)

			assert.Equal(t, c.status, rec.Code)
			assert.Contains(t, rec.Body.String(), `"code":"`+c.code+`"`)
			assert.False(t, called)
		})
	}
}
