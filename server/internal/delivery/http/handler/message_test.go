package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockMessageUseCase struct{ mock.Mock }

func (m *mockMessageUseCase) CreateMessage(channelID, userID uuid.UUID, content string, stickerID *uuid.UUID) (*domain.Message, error) {
	args := m.Called(channelID, userID, content, stickerID)
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
func (m *mockMessageUseCase) SearchMessages(channelID, userID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	args := m.Called(channelID, userID, query, limit, offset)
	results, _ := args.Get(0).([]*domain.MessageWithAuthor)
	return results, args.Int(1), args.Error(2)
}
func (m *mockMessageUseCase) GetMessagesAround(channelID, messageID, userID uuid.UUID, limit int) ([]*domain.Message, error) {
	args := m.Called(channelID, messageID, userID, limit)
	msgs, _ := args.Get(0).([]*domain.Message)
	return msgs, args.Error(1)
}

func TestMessageHandler_CreateMessage_LogsRequestIDOnInternalError(t *testing.T) {
	var buf bytes.Buffer
	log := slog.New(slog.NewTextHandler(&buf, nil))

	mockUC := new(mockMessageUseCase)
	channelID := uuid.New()
	userID := uuid.New()
	mockUC.On("CreateMessage", channelID, userID, "hello", (*uuid.UUID)(nil)).Return(nil, errors.New("db down"))

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

func TestMessageHandler_SearchMessages_ShortQuery_BadRequest(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)
	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	channelID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/search?q=a", nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.SearchMessages(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
	mockUC.AssertNotCalled(t, "SearchMessages", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}

func TestMessageHandler_SearchMessages_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)

	channelID, userID := uuid.New(), uuid.New()
	results := []*domain.MessageWithAuthor{
		{Message: domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "нашёл баг"}, Username: "petya"},
	}
	// limit в запросе не задан -> хендлер передаёт 0, нормализация в usecase
	mockUC.On("SearchMessages", channelID, userID, "баг", 0, 0).Return(results, 1, nil)

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/search?q="+url.QueryEscape("баг"), nil)
	req.SetPathValue("channel_id", channelID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.SearchMessages(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var resp SearchMessagesResponse
	if err := json.Unmarshal(rec.Body.Bytes(), &resp); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if resp.Total != 1 || len(resp.Results) != 1 || resp.Results[0].Username != "petya" {
		t.Fatalf("unexpected response: %+v", resp)
	}
}

func TestMessageHandler_GetMessagesAround_InvalidMessageID_BadRequest(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)
	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	channelID := uuid.New()
	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/around/not-a-uuid", nil)
	req.SetPathValue("channel_id", channelID.String())
	req.SetPathValue("message_id", "not-a-uuid")
	req = req.WithContext(context.WithValue(req.Context(), "user_id", uuid.New()))

	rec := httptest.NewRecorder()
	h.GetMessagesAround(rec, req)

	if rec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d", rec.Code)
	}
}

func TestMessageHandler_GetMessagesAround_Success(t *testing.T) {
	log := slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))
	mockUC := new(mockMessageUseCase)

	channelID, userID, messageID := uuid.New(), uuid.New(), uuid.New()
	msgs := []*domain.Message{{ID: messageID, ChannelID: channelID, Content: "старое"}}
	// limit в запросе не задан -> хендлер передаёт 0, нормализация в usecase
	mockUC.On("GetMessagesAround", channelID, messageID, userID, 0).Return(msgs, nil)

	h := NewMessageHandler(mockUC, ws.NewHub(log), log)

	req := httptest.NewRequest(http.MethodGet, "/api/v1/channels/"+channelID.String()+"/messages/around/"+messageID.String(), nil)
	req.SetPathValue("channel_id", channelID.String())
	req.SetPathValue("message_id", messageID.String())
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))

	rec := httptest.NewRecorder()
	h.GetMessagesAround(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", rec.Code, rec.Body.String())
	}
	var got []*domain.Message
	if err := json.Unmarshal(rec.Body.Bytes(), &got); err != nil {
		t.Fatalf("invalid json: %v", err)
	}
	if len(got) != 1 || got[0].ID != messageID {
		t.Fatalf("unexpected response: %+v", got)
	}
}
