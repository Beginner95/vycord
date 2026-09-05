package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

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

func (m *mockFriendUseCase) SendRequest(fromID uuid.UUID, username string) (*domain.FriendRequest, *domain.UserBrief, *domain.UserBrief, bool, error) {
	args := m.Called(fromID, username)
	var req *domain.FriendRequest
	var target *domain.UserBrief
	var self *domain.UserBrief
	if args.Get(0) != nil {
		req = args.Get(0).(*domain.FriendRequest)
	}
	if args.Get(1) != nil {
		target = args.Get(1).(*domain.UserBrief)
	}
	if args.Get(2) != nil {
		self = args.Get(2).(*domain.UserBrief)
	}
	return req, target, self, args.Bool(3), args.Error(4)
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
	uc.On("SendRequest", me, "other").Return(nil, nil, nil, false, domain.ErrInteractionForbidden)

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
	uc.On("SendRequest", me, "ghost").Return(nil, nil, nil, false, domain.ErrUserNotFound)

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

// Регрессия на асимметрию с SendRequest: принимая заявку, AcceptRequest
// обязан уведомить friend_added ОБЕ стороны — не только того, кто отправил
// заявку изначально (otherID), но и того, кто её принял (userID). У
// принявшего может быть открыта вторая вкладка, которую HTTP-ответ этого
// запроса не обновит — ровно та же причина, по которой SendRequest шлёт
// friend_added обеим сторонам во встречной ветке через notifyFriendAdded.
// Использует registerFakeClient/readChanUntilType из server_test.go
// (тот же пакет handler) — реального WS-апгрейда не требуется.
func TestFriendHandler_AcceptRequest_NotifiesBothSides(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	me := uuid.New()    // тот, кто нажал "принять"
	other := uuid.New() // тот, кто изначально отправил заявку

	meClient := registerFakeClient(t, hub, me)
	otherClient := registerFakeClient(t, hub, other)

	requestID := uuid.New()
	profile := &domain.FriendProfile{
		UserBrief:    domain.UserBrief{UserID: other, Username: "other"},
		FriendsSince: time.Now(),
	}

	uc := new(mockFriendUseCase)
	uc.On("AcceptRequest", me, requestID).Return(profile, other, nil)

	h := NewFriendHandler(uc, hub, log)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests/"+requestID.String()+"/accept", nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))
	req.SetPathValue("id", requestID.String())

	rec := httptest.NewRecorder()
	h.AcceptRequest(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}

	// Тот, кто отправил заявку, узнаёт, что её приняли.
	readChanUntilType(t, otherClient.Send, "friend_added", time.Second)
	// Тот, кто принял, тоже получает событие — вторая вкладка того же
	// пользователя не узнает об этом из HTTP-ответа.
	readChanUntilType(t, meClient.Send, "friend_added", time.Second)
}

// Регрессия C1: WS-пуш friend_request, который получает АДРЕСАТ заявки,
// обязан описывать отправителя заявки (self), а не самого адресата (target).
// req.User (собранный use case'ом из target) годится только для HTTP-ответа
// вызывающему — если SendRequest-хендлер по ошибке переиспользует req для
// WS-пуша, адресат увидит в заявке собственный профиль вместо профиля того,
// кто её прислал.
func TestFriendHandler_SendRequest_WSPushToTargetCarriesCallerIdentity(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	caller := uuid.New() // тот, кто шлёт заявку (fromID)
	target := uuid.New() // адресат заявки

	targetClient := registerFakeClient(t, hub, target)

	callerBrief := &domain.UserBrief{UserID: caller, Username: "caller"}
	targetBrief := &domain.UserBrief{UserID: target, Username: "target"}

	requestID := uuid.New()
	req := &domain.FriendRequest{
		ID:        requestID,
		User:      *targetBrief, // с точки зрения вызывающего — верно
		CreatedAt: time.Now(),
	}

	uc := new(mockFriendUseCase)
	uc.On("SendRequest", caller, "target").Return(req, targetBrief, callerBrief, false, nil)

	h := NewFriendHandler(uc, hub, log)
	httpReq := httptest.NewRequest(http.MethodPost, "/api/v1/friends/requests",
		strings.NewReader(`{"username":"target"}`))
	httpReq = httpReq.WithContext(context.WithValue(httpReq.Context(), "user_id", caller))

	rec := httptest.NewRecorder()
	h.SendRequest(rec, httpReq)

	if rec.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", rec.Code, rec.Body.String())
	}

	data := readChanUntilType(t, targetClient.Send, "friend_request", time.Second)
	var msg ws.Message
	if err := json.Unmarshal(data, &msg); err != nil {
		t.Fatalf("unmarshal ws.Message: %v", err)
	}
	var payload domain.FriendRequest
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		t.Fatalf("unmarshal payload: %v", err)
	}
	if payload.User.UserID != caller {
		t.Fatalf("expected WS push to carry caller id %s, got %s (target's own id would be %s)",
			caller, payload.User.UserID, target)
	}
}

// Регрессия I2: RemoveFriend и Block обязаны уведомлять обе стороны, а не
// только «другую» — у актора тоже может быть открыта вторая вкладка.
func TestFriendHandler_RemoveFriend_NotifiesBothSides(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	me := uuid.New()
	friend := uuid.New()

	meClient := registerFakeClient(t, hub, me)
	friendClient := registerFakeClient(t, hub, friend)

	uc := new(mockFriendUseCase)
	uc.On("RemoveFriend", me, friend).Return(nil)

	h := NewFriendHandler(uc, hub, log)
	req := httptest.NewRequest(http.MethodDelete, "/api/v1/friends/"+friend.String(), nil)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))
	req.SetPathValue("user_id", friend.String())

	rec := httptest.NewRecorder()
	h.RemoveFriend(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	readChanUntilType(t, friendClient.Send, "friend_removed", time.Second)
	readChanUntilType(t, meClient.Send, "friend_removed", time.Second)
}

func TestFriendHandler_Block_NotifiesBothSides(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	hub := ws.NewHub(log)
	go hub.Run()

	me := uuid.New()
	target := uuid.New()

	meClient := registerFakeClient(t, hub, me)
	targetClient := registerFakeClient(t, hub, target)

	uc := new(mockFriendUseCase)
	uc.On("Block", me, target).Return(nil)

	h := NewFriendHandler(uc, hub, log)
	req := httptest.NewRequest(http.MethodPost, "/api/v1/friends/block",
		strings.NewReader(`{"user_id":"`+target.String()+`"}`))
	req = req.WithContext(context.WithValue(req.Context(), "user_id", me))

	rec := httptest.NewRecorder()
	h.Block(rec, req)

	if rec.Code != http.StatusNoContent {
		t.Fatalf("expected 204, got %d: %s", rec.Code, rec.Body.String())
	}

	readChanUntilType(t, targetClient.Send, "friend_removed", time.Second)
	readChanUntilType(t, meClient.Send, "friend_removed", time.Second)
}
