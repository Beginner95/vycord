package middleware

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"strings"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/domain"
)

// guestCtxKey — СОБСТВЕННЫЙ тип ключа контекста. Аккаунтные хендлеры читают
// строковый ключ "user_id", поэтому увидеть гостя они не могут в принципе:
// граница проходит по типам, а не по флагу, который можно забыть проверить.
type guestCtxKey struct{}

// GuestAuthenticator — срез гостевого use case, нужный middleware.
type GuestAuthenticator interface {
	Authenticate(sessionToken string) (*domain.GuestContext, error)
}

// GuestAuth защищает /api/v1/guest/*. Токен непрозрачный (не JWT) и
// проверяется в БД на каждом запросе — поэтому кик, отзыв ссылки и конец
// звонка действуют мгновенно.
type GuestAuth struct {
	auth GuestAuthenticator
	log  *slog.Logger
}

func NewGuestAuth(auth GuestAuthenticator, log *slog.Logger) *GuestAuth {
	return &GuestAuth{auth: auth, log: log}
}

func (m *GuestAuth) Require(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		token, ok := strings.CutPrefix(r.Header.Get("Authorization"), "Bearer ")
		if !ok || strings.TrimSpace(token) == "" {
			m.unauthorized(w)
			return
		}

		guest, err := m.auth.Authenticate(strings.TrimSpace(token))
		if err != nil {
			if !errors.Is(err, domain.ErrGuestSessionInvalid) {
				m.log.Error("guest authentication failed",
					"request_id", RequestIDFromContext(r.Context()), "error", err)
				httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
				return
			}
			m.unauthorized(w)
			return
		}

		next(w, r.WithContext(WithGuest(r.Context(), guest)))
	}
}

func (m *GuestAuth) unauthorized(w http.ResponseWriter) {
	httperr.Write(w, http.StatusUnauthorized, httperr.CodeGuestSessionInvalid, "guest session invalid")
}

// WithGuest кладёт гостя в контекст. Экспортирован ради гостевого шлюза
// (план 3) и тестов хендлеров.
func WithGuest(ctx context.Context, guest *domain.GuestContext) context.Context {
	return context.WithValue(ctx, guestCtxKey{}, guest)
}

func GuestFromContext(ctx context.Context) (*domain.GuestContext, bool) {
	guest, ok := ctx.Value(guestCtxKey{}).(*domain.GuestContext)
	return guest, ok
}
