package handler

import (
	"context"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/domain"
)

func callTokenRequest(t *testing.T, calls *mockCallUseCase, userID uuid.UUID, rawCallID string) *httptest.ResponseRecorder {
	t.Helper()
	h := NewCallHandler(calls, slog.New(slog.NewTextHandler(io.Discard, nil)))
	req := httptest.NewRequest(http.MethodPost, "/api/v1/calls/"+rawCallID+"/voice-token", nil)
	req.SetPathValue("call_id", rawCallID)
	req = req.WithContext(context.WithValue(req.Context(), "user_id", userID))
	rec := httptest.NewRecorder()
	h.IssueVoiceToken(rec, req)
	return rec
}

func TestCallVoiceToken(t *testing.T) {
	user, callID := uuid.New(), uuid.New()

	calls := &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("tok", nil)
	rec := callTokenRequest(t, calls, user, callID.String())
	assert.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"token":"tok"}`, rec.Body.String())

	calls = &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("", domain.ErrCallNotFound)
	assert.Equal(t, http.StatusNotFound, callTokenRequest(t, calls, user, callID.String()).Code)

	calls = &mockCallUseCase{}
	calls.On("IssueRoomToken", user, callID).Return("", domain.ErrCallInvalidState)
	assert.Equal(t, http.StatusConflict, callTokenRequest(t, calls, user, callID.String()).Code)

	assert.Equal(t, http.StatusBadRequest, callTokenRequest(t, &mockCallUseCase{}, user, "nope").Code)
}
