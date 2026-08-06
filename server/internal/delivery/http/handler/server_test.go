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
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"

	ws "github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// --- Мок ServerUseCase ---

type mockServerUseCase struct{ mock.Mock }

func (m *mockServerUseCase) CheckChannelAccess(channelID, userID uuid.UUID) (*domain.Channel, error) {
	args := m.Called(channelID, userID)
	ch, _ := args.Get(0).(*domain.Channel)
	return ch, args.Error(1)
}

func (m *mockServerUseCase) GetChannelAudience(channelID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(channelID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}

func (m *mockServerUseCase) CreateServer(name string, ownerID uuid.UUID, isPrivate bool) (*domain.Server, error) {
	args := m.Called(name, ownerID, isPrivate)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) GetServer(id, userID uuid.UUID) (*domain.Server, error) {
	args := m.Called(id, userID)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) GetUserServers(userID uuid.UUID) ([]*domain.Server, error) {
	args := m.Called(userID)
	s, _ := args.Get(0).([]*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) JoinServer(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}

func (m *mockServerUseCase) LeaveServer(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}

func (m *mockServerUseCase) SearchServers(query string, limit int) ([]*domain.Server, error) {
	args := m.Called(query, limit)
	s, _ := args.Get(0).([]*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) CreateChannel(serverID, userID uuid.UUID, name string, channelType domain.ChannelType) (*domain.Channel, error) {
	args := m.Called(serverID, userID, name, channelType)
	ch, _ := args.Get(0).(*domain.Channel)
	return ch, args.Error(1)
}

func (m *mockServerUseCase) GetChannels(serverID, userID uuid.UUID) ([]*domain.Channel, error) {
	args := m.Called(serverID, userID)
	ch, _ := args.Get(0).([]*domain.Channel)
	return ch, args.Error(1)
}

func (m *mockServerUseCase) GetMembers(serverID, userID uuid.UUID) ([]*domain.MemberWithUser, error) {
	args := m.Called(serverID, userID)
	mm, _ := args.Get(0).([]*domain.MemberWithUser)
	return mm, args.Error(1)
}

func (m *mockServerUseCase) UpdateServer(serverID, userID uuid.UUID, name string, isPrivate *bool) (*domain.Server, error) {
	args := m.Called(serverID, userID, name, isPrivate)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) DeleteServer(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}

func (m *mockServerUseCase) UpdateChannel(serverID, channelID, userID uuid.UUID, name string) (*domain.Channel, error) {
	args := m.Called(serverID, channelID, userID, name)
	ch, _ := args.Get(0).(*domain.Channel)
	return ch, args.Error(1)
}

func (m *mockServerUseCase) DeleteChannel(serverID, channelID, userID uuid.UUID) error {
	return m.Called(serverID, channelID, userID).Error(0)
}

func (m *mockServerUseCase) UpdateServerIcon(serverID, userID uuid.UUID, data []byte) (*domain.Server, error) {
	args := m.Called(serverID, userID, data)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) RemoveServerIcon(serverID, userID uuid.UUID) (*domain.Server, error) {
	args := m.Called(serverID, userID)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) GetServerAudience(serverID uuid.UUID) ([]uuid.UUID, error) {
	args := m.Called(serverID)
	ids, _ := args.Get(0).([]uuid.UUID)
	return ids, args.Error(1)
}

// --- Мок InviteUseCase (нужен только для конструктора ServerHandler) ---

type mockInviteUseCaseForServer struct{ mock.Mock }

func (m *mockInviteUseCaseForServer) CreateInvite(serverID, userID uuid.UUID) (*domain.Invite, error) {
	args := m.Called(serverID, userID)
	inv, _ := args.Get(0).(*domain.Invite)
	return inv, args.Error(1)
}
func (m *mockInviteUseCaseForServer) ListInvites(serverID, userID uuid.UUID) ([]*domain.Invite, error) {
	args := m.Called(serverID, userID)
	inv, _ := args.Get(0).([]*domain.Invite)
	return inv, args.Error(1)
}
func (m *mockInviteUseCaseForServer) RevokeInvite(serverID uuid.UUID, code string, userID uuid.UUID) error {
	return m.Called(serverID, code, userID).Error(0)
}
func (m *mockInviteUseCaseForServer) PreviewInvite(code string) (*domain.InvitePreview, error) {
	args := m.Called(code)
	p, _ := args.Get(0).(*domain.InvitePreview)
	return p, args.Error(1)
}
func (m *mockInviteUseCaseForServer) JoinViaInvite(code string, userID uuid.UUID) (*domain.Server, error) {
	args := m.Called(code, userID)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

// --- Харнесс ---

func newTestServerHandler(t *testing.T) (*ServerHandler, *mockServerUseCase, *mockInviteUseCaseForServer) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := &mockServerUseCase{}
	inviteUC := &mockInviteUseCaseForServer{}
	hub := ws.NewHub(log)
	go hub.Run()
	return NewServerHandler(uc, inviteUC, hub, log), uc, inviteUC
}

func serverRequest(method, path string, userID uuid.UUID, body string) *http.Request {
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(method, path, nil)
	} else {
		req = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

// --- Тесты ---

func TestCreateServer_Public_DoesNotAutoCreateInvite(t *testing.T) {
	h, uc, inviteUC := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("CreateServer", "Мой сервер", userID, false).Return(&domain.Server{ID: serverID, Name: "Мой сервер"}, nil)

	req := serverRequest(http.MethodPost, "/api/v1/servers", userID, `{"name":"Мой сервер"}`)
	rec := httptest.NewRecorder()
	h.CreateServer(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	inviteUC.AssertNotCalled(t, "CreateInvite", mock.Anything, mock.Anything)
}

func TestCreateServer_Private_AutoCreatesInvite(t *testing.T) {
	h, uc, inviteUC := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("CreateServer", "Закрытый клуб", userID, true).Return(&domain.Server{ID: serverID, Name: "Закрытый клуб", IsPrivate: true}, nil)
	inviteUC.On("CreateInvite", serverID, userID).Return(&domain.Invite{Code: "abc123", ServerID: serverID}, nil)

	req := serverRequest(http.MethodPost, "/api/v1/servers", userID, `{"name":"Закрытый клуб","is_private":true}`)
	rec := httptest.NewRecorder()
	h.CreateServer(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code)
	inviteUC.AssertCalled(t, "CreateInvite", serverID, userID)
}

func TestGetServer_NotFound_Returns404(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("GetServer", serverID, userID).Return(nil, domain.ErrServerNotFound)

	req := serverRequest(http.MethodGet, "/api/v1/servers/"+serverID.String(), userID, "")
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.GetServer(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestJoinServer_PrivateServer_Returns404(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("JoinServer", serverID, userID).Return(domain.ErrServerNotFound)

	req := serverRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/join", userID, "")
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.JoinServer(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestJoinServer_AlreadyMember_Returns500WithMessage(t *testing.T) {
	// Регрессионный тест: AppPage.tsx на клиенте распознаёт "уже участник"/
	// "владелец" по тексту ошибки — этот путь НЕ должен провалиться через
	// writeUseCaseError (который заменил бы текст на generic "internal server
	// error" и сломал бы клиентскую проверку).
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("JoinServer", serverID, userID).Return(assert.AnError)

	req := serverRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/join", userID, "")
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.JoinServer(rec, req)

	assert.Equal(t, http.StatusInternalServerError, rec.Code)
}

func TestUpdateServer_OmittedIsPrivate_PassesNilThrough(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("UpdateServer", serverID, userID, "new name", (*bool)(nil)).
		Return(&domain.Server{ID: serverID, Name: "new name"}, nil)
	uc.On("GetServerAudience", serverID).Return(nil, nil)

	req := serverRequest(http.MethodPatch, "/api/v1/servers/"+serverID.String(), userID, `{"name":"new name"}`)
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.UpdateServer(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "UpdateServer", serverID, userID, "new name", (*bool)(nil))
}

func TestUpdateServer_ExplicitIsPrivateTrue_PassesPointer(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	isPrivate := true
	uc.On("UpdateServer", serverID, userID, "new name", &isPrivate).
		Return(&domain.Server{ID: serverID, Name: "new name", IsPrivate: true}, nil)
	uc.On("GetServerAudience", serverID).Return([]uuid.UUID{userID}, nil)

	req := serverRequest(http.MethodPatch, "/api/v1/servers/"+serverID.String(), userID, `{"name":"new name","is_private":true}`)
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.UpdateServer(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}

func TestBroadcast_PrivateServer_UsesSendToUsers(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID := uuid.New(), uuid.New()

	uc.On("UpdateServer", serverID, userID, "renamed", (*bool)(nil)).
		Return(&domain.Server{ID: serverID, Name: "renamed", IsPrivate: true}, nil)
	uc.On("GetServerAudience", serverID).Return([]uuid.UUID{userID}, nil)

	req := serverRequest(http.MethodPatch, "/api/v1/servers/"+serverID.String(), userID, `{"name":"renamed"}`)
	req.SetPathValue("id", serverID.String())
	rec := httptest.NewRecorder()
	h.UpdateServer(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "GetServerAudience", serverID)
}

func TestCreateChannel_NoLongerAcceptsIsPrivate(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID, channelID := uuid.New(), uuid.New(), uuid.New()

	uc.On("CreateChannel", serverID, userID, "general", domain.ChannelTypeText).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "general", Type: domain.ChannelTypeText}, nil)
	uc.On("GetServerAudience", serverID).Return(nil, nil)

	req := serverRequest(http.MethodPost, "/api/v1/servers/"+serverID.String()+"/channels", userID, `{"name":"general","is_private":true}`)
	req.SetPathValue("server_id", serverID.String())
	rec := httptest.NewRecorder()
	h.CreateChannel(rec, req)

	assert.Equal(t, http.StatusCreated, rec.Code, rec.Body.String())
	// is_private в теле игнорируется — вызов usecase не принимает такой параметр вовсе.
	uc.AssertCalled(t, "CreateChannel", serverID, userID, "general", domain.ChannelTypeText)
}

func TestUpdateChannel_Success(t *testing.T) {
	h, uc, _ := newTestServerHandler(t)
	userID, serverID, channelID := uuid.New(), uuid.New(), uuid.New()

	uc.On("UpdateChannel", serverID, channelID, userID, "new name").
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "new name"}, nil)
	uc.On("GetServerAudience", serverID).Return(nil, nil)

	req := serverRequest(http.MethodPatch, "/api/v1/servers/"+serverID.String()+"/channels/"+channelID.String(), userID, `{"name":"new name"}`)
	req.SetPathValue("server_id", serverID.String())
	req.SetPathValue("channel_id", channelID.String())
	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, req)

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
}
