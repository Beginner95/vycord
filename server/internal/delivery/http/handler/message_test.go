package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockMessageUseCase struct{ mock.Mock }

func (m *mockMessageUseCase) CreateMessage(channelID, userID uuid.UUID, content string) (*domain.Message, error) {
	args := m.Called(channelID, userID, content)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockMessageUseCase) GetMessages(channelID, userID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	args := m.Called(channelID, userID, limit, offset)
	msgs, _ := args.Get(0).([]*domain.Message)
	return msgs, args.Error(1)
}
func (m *mockMessageUseCase) UpdateMessage(channelID, messageID, userID uuid.UUID, content string) (*domain.Message, error) {
	args := m.Called(channelID, messageID, userID, content)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockMessageUseCase) DeleteMessage(channelID, messageID, userID uuid.UUID) error {
	return m.Called(channelID, messageID, userID).Error(0)
}

func TestMessageHandler_CreateMessage_LogsRequestIDOnInternalError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockMessageUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("CreateMessage", channelID, userID, "hello").Return(nil, errors.New("db down"))

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	body, _ := json.Marshal(CreateMessageRequest{Content: "hello"})
	req := httptest.NewRequest(http.MethodPost, "/api/v1/channels/"+channelID.String()+"/messages", bytes.NewReader(body))
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	chain := middleware.RequestID(http.HandlerFunc(h.CreateMessage))
	chain.ServeHTTP(rec, req)

	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("expected 500, got %d", rec.Code)
	}

	headerID := rec.Header().Get(middleware.RequestIDHeader)
	if headerID == "" {
		t.Fatal("expected X-Request-Id header to be set")
	}
	if !strings.Contains(buf.String(), "request_id="+headerID) {
		t.Fatalf("expected error log to contain request_id=%s, got: %s", headerID, buf.String())
	}
}
