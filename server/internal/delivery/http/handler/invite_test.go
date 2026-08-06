package handler

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type mockInviteUseCase struct{ mock.Mock }

func (m *mockInviteUseCase) CreateInvite(serverID, userID uuid.UUID) (*domain.Invite, error) {
	args := m.Called(serverID, userID)
	inv, _ := args.Get(0).(*domain.Invite)
	return inv, args.Error(1)
}
func (m *mockInviteUseCase) ListInvites(serverID, userID uuid.UUID) ([]*domain.Invite, error) {
	args := m.Called(serverID, userID)
	inv, _ := args.Get(0).([]*domain.Invite)
	return inv, args.Error(1)
}
func (m *mockInviteUseCase) RevokeInvite(serverID uuid.UUID, code string, userID uuid.UUID) error {
	return m.Called(serverID, code, userID).Error(0)
}
func (m *mockInviteUseCase) PreviewInvite(code string) (*domain.InvitePreview, error) {
	args := m.Called(code)
	p, _ := args.Get(0).(*domain.InvitePreview)
	return p, args.Error(1)
}
func (m *mockInviteUseCase) JoinViaInvite(code string, userID uuid.UUID) (*domain.Server, error) {
	args := m.Called(code, userID)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func newTestInviteHandler(t *testing.T) (*InviteHandler, *mockInviteUseCase) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := &mockInviteUseCase{}
	return NewInviteHandler(uc, log), uc
}

func inviteRequest(method, path string, serverID uuid.UUID, code string, userID uuid.UUID) *http.Request {
	req := httptest.NewRequest(method, path, nil)
	if serverID != uuid.Nil {
		req.SetPathValue("server_id", serverID.String())
	}
	if code != "" {
		req.SetPathValue("code", code)
	}
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

func TestInviteHandler_CreateInvite_Success(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("CreateInvite", serverID, userID).Return(&domain.Invite{Code: "abc123", ServerID: serverID}, nil)

	rec := httptest.NewRecorder()
	h.CreateInvite(rec, inviteRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/invites", serverID, "", userID))

	assert.Equal(t, http.StatusCreated, rec.Code)
}

func TestInviteHandler_CreateInvite_Forbidden(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("CreateInvite", serverID, userID).Return(nil, domain.ErrInviteForbidden)

	rec := httptest.NewRecorder()
	h.CreateInvite(rec, inviteRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/invites", serverID, "", userID))

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestInviteHandler_PreviewInvite_NotFound(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	userID := uuid.New()

	uc.On("PreviewInvite", "nope").Return(nil, domain.ErrInviteNotFound)

	rec := httptest.NewRecorder()
	h.PreviewInvite(rec, inviteRequest(http.MethodGet, "/api/v1/invites/nope", uuid.Nil, "nope", userID))

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestInviteHandler_JoinViaInvite_Success(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("JoinViaInvite", "abc123", userID).Return(&domain.Server{ID: serverID}, nil)

	rec := httptest.NewRecorder()
	h.JoinViaInvite(rec, inviteRequest(http.MethodPost, "/api/v1/invites/abc123/join", uuid.Nil, "abc123", userID))

	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestInviteHandler_RevokeInvite_Success(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("RevokeInvite", serverID, "abc123", userID).Return(nil)

	rec := httptest.NewRecorder()
	h.RevokeInvite(rec, inviteRequest(http.MethodDelete, "/api/v1/servers/"+serverID.String()+"/invites/abc123", serverID, "abc123", userID))

	assert.Equal(t, http.StatusNoContent, rec.Code)
}

func TestInviteHandler_CreateInvite_ServerNotFound(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("CreateInvite", serverID, userID).Return(nil, domain.ErrServerNotFound)

	rec := httptest.NewRecorder()
	h.CreateInvite(rec, inviteRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/invites", serverID, "", userID))

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestInviteHandler_CreateInvite_GenericErrorHidesDetails(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("CreateInvite", serverID, userID).Return(nil, assert.AnError)

	rec := httptest.NewRecorder()
	h.CreateInvite(rec, inviteRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/invites", serverID, "", userID))

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.NotContains(t, rec.Body.String(), assert.AnError.Error())

	var body map[string]string
	err := json.Unmarshal(rec.Body.Bytes(), &body)
	assert.NoError(t, err)
	assert.Equal(t, "internal server error", body["error"])
}

func TestInviteHandler_ListInvites_Success(t *testing.T) {
	h, uc := newTestInviteHandler(t)
	serverID, userID := uuid.New(), uuid.New()

	uc.On("ListInvites", serverID, userID).Return([]*domain.Invite{{Code: "abc123", ServerID: serverID}}, nil)

	rec := httptest.NewRecorder()
	h.ListInvites(rec, inviteRequest(http.MethodGet, "/api/v1/servers/"+serverID.String()+"/invites", serverID, "", userID))

	assert.Equal(t, http.StatusOK, rec.Code)
}
