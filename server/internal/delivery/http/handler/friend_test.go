package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockFriendUseCase struct{ mock.Mock }

func (m *mockFriendUseCase) ListFriends(userID uuid.UUID) ([]*domain.FriendProfile, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.FriendProfile), args.Error(1)
}

func (m *mockFriendUseCase) ListRequests(userID uuid.UUID) ([]*domain.FriendRequest, []*domain.FriendRequest, error) {
	args := m.Called(userID)
	var in, out []*domain.FriendRequest
	if args.Get(0) != nil {
		in = args.Get(0).([]*domain.FriendRequest)
	}
	if args.Get(1) != nil {
		out = args.Get(1).([]*domain.FriendRequest)
	}
	return in, out, args.Error(2)
}

func (m *mockFriendUseCase) SendRequest(fromID uuid.UUID, username string) (*domain.FriendRequest, *domain.UserBrief, bool, error) {
	args := m.Called(fromID, username)
	var req *domain.FriendRequest
	var brief *domain.UserBrief
	if args.Get(0) != nil {
		req = args.Get(0).(*domain.FriendRequest)
	}
	if args.Get(1) != nil {
		brief = args.Get(1).(*domain.UserBrief)
	}
	return req, brief, args.Bool(2), args.Error(3)
}

func (m *mockFriendUseCase) AcceptRequest(userID, requestID uuid.UUID) (*domain.FriendProfile, uuid.UUID, error) {
	args := m.Called(userID, requestID)
	if args.Get(0) == nil {
		return nil, uuid.Nil, args.Error(2)
	}
	return args.Get(0).(*domain.FriendProfile), args.Get(1).(uuid.UUID), args.Error(2)
}

func (m *mockFriendUseCase) DeleteRequest(userID, requestID uuid.UUID) (uuid.UUID, error) {
	args := m.Called(userID, requestID)
	return args.Get(0).(uuid.UUID), args.Error(1)
}

func (m *mockFriendUseCase) RemoveFriend(userID, friendID uuid.UUID) error {
	return m.Called(userID, friendID).Error(0)
}

func (m *mockFriendUseCase) ListBlocks(userID uuid.UUID) ([]*domain.UserBrief, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).([]*domain.UserBrief), args.Error(1)
}

func (m *mockFriendUseCase) Block(userID, targetID uuid.UUID) error {
	return m.Called(userID, targetID).Error(0)
}

func (m *mockFriendUseCase) Unblock(userID, targetID uuid.UUID) error {
	return m.Called(userID, targetID).Error(0)
}

func (m *mockFriendUseCase) CanDM(fromID, toID uuid.UUID) error {
	return m.Called(fromID, toID).Error(0)
}

// Ключевой тест приватности: блокировка и настройка приватности обязаны
// давать НЕРАЗЛИЧИМЫЙ ответ. Различие здесь — утечка, по которой перебором
// вычисляется, кто тебя заблокировал.
func TestFriendHandler_SendRequest_ForbiddenIsOpaque(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()
	uc.On("SendRequest", me, "other").Return(nil, nil, false, domain.ErrInteractionForbidden)

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"username":"other"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, req)

	if rec.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", rec.Code)
	}
	body := rec.Body.String()
	for _, leak := range []string{"block", "Block", "заблок", "privacy", "settings"} {
		if strings.Contains(body, leak) {
			t.Fatalf("ответ раскрывает причину отказа (%q): %s", leak, body)
		}
	}
	if !strings.Contains(body, "interaction_forbidden") {
		t.Fatalf("expected code interaction_forbidden, got: %s", body)
	}
}

func TestFriendHandler_SendRequest_EmptyUsernameRejected(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"username":"   "}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	uc.AssertNotCalled(t, "SendRequest", mock.Anything, mock.Anything)
}

// Регрессия на баг GetByUsername: postgres-репозиторий сравнивал ошибку с
// sql.ErrNoRows вместо pgx.ErrNoRows (драйвер — pgx) и никогда не совпадал,
// так что заявка несуществующему username улетала в default/500 вместо 404.
// Этот тест проверяет только слой хендлера — что ErrUserNotFound от
// use case транслируется в 404 user_not_found, а не в 500. Сам фикс в
// postgres.GetByUsername (pgx.ErrNoRows -> domain.ErrUserNotFound) проверен
// отдельно живым запросом к БД, см. отчёт задачи.
func TestFriendHandler_SendRequest_UnknownUsernameIs404(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := new(mockFriendUseCase)
	me := uuid.New()
	uc.On("SendRequest", me, "ghost").Return(nil, nil, false, domain.ErrUserNotFound)

	h := NewFriendHandler(uc, ws.NewHub(log), log)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"username":"ghost"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, req)

	if rec.Code != http.StatusNotFound {
		t.Fatalf("expected 404, got %d: %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "user_not_found") {
		t.Fatalf("expected code user_not_found, got: %s", rec.Body.String())
	}
}
