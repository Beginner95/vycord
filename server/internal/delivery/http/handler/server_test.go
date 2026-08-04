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

func (m *mockServerUseCase) CreateServer(name string, ownerID uuid.UUID) (*domain.Server, error) {
	args := m.Called(name, ownerID)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) GetServer(id uuid.UUID) (*domain.Server, error) {
	args := m.Called(id)
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

func (m *mockServerUseCase) CreateChannel(serverID, userID uuid.UUID, name string, channelType domain.ChannelType, isPrivate bool) (*domain.Channel, error) {
	args := m.Called(serverID, userID, name, channelType, isPrivate)
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

func (m *mockServerUseCase) UpdateServer(serverID, userID uuid.UUID, name string) (*domain.Server, error) {
	args := m.Called(serverID, userID, name)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}

func (m *mockServerUseCase) DeleteServer(serverID, userID uuid.UUID) error {
	return m.Called(serverID, userID).Error(0)
}

func (m *mockServerUseCase) UpdateChannel(serverID, channelID, userID uuid.UUID, name string, isPrivate bool) (*domain.Channel, error) {
	args := m.Called(serverID, channelID, userID, name, isPrivate)
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

func (m *mockServerUseCase) InviteToChannel(serverID, channelID, inviterID, targetUserID uuid.UUID) error {
	return m.Called(serverID, channelID, inviterID, targetUserID).Error(0)
}

func (m *mockServerUseCase) RemoveFromChannel(serverID, channelID, removerID, targetUserID uuid.UUID) error {
	return m.Called(serverID, channelID, removerID, targetUserID).Error(0)
}

func (m *mockServerUseCase) GetChannelMembers(serverID, channelID, userID uuid.UUID) ([]*domain.ChannelMemberWithUser, error) {
	args := m.Called(serverID, channelID, userID)
	mm, _ := args.Get(0).([]*domain.ChannelMemberWithUser)
	return mm, args.Error(1)
}

// --- Харнесс ---

func newTestServerHandler(t *testing.T) (*ServerHandler, *mockServerUseCase) {
	t.Helper()
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	uc := &mockServerUseCase{}
	hub := ws.NewHub(log)
	go hub.Run()
	return NewServerHandler(uc, hub, log), uc
}

func patchChannelRequest(serverID, channelID, userID uuid.UUID, body string) *http.Request {
	req := httptest.NewRequest(http.MethodPatch,
		"/api/v1/servers/"+serverID.String()+"/channels/"+channelID.String(),
		strings.NewReader(body))
	req.SetPathValue("server_id", serverID.String())
	req.SetPathValue("channel_id", channelID.String())
	return req.WithContext(context.WithValue(req.Context(), "user_id", userID))
}

// --- Тесты ---

// Тело без ключа is_private (то, что шлёт любой клиент, не знающий про приватные
// каналы) — это обычное переименование: приватность канала и его список
// приглашённых обязаны остаться нетронутыми.
func TestUpdateChannel_OmittedIsPrivate_PreservesCurrentPrivacy(t *testing.T) {
	h, uc := newTestServerHandler(t)
	serverID, channelID, userID := uuid.New(), uuid.New(), uuid.New()

	uc.On("CheckChannelAccess", channelID, userID).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: true}, nil)
	uc.On("UpdateChannel", serverID, channelID, userID, "new name", true).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "new name", IsPrivate: true}, nil)
	uc.On("GetChannelAudience", channelID).Return([]uuid.UUID{userID}, nil)

	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, patchChannelRequest(serverID, channelID, userID, `{"name":"new name"}`))

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "UpdateChannel", serverID, channelID, userID, "new name", true)
	uc.AssertNotCalled(t, "UpdateChannel", serverID, channelID, userID, "new name", false)
}

// То же самое для публичного канала: отсутствие ключа не должно внезапно
// сделать его приватным.
func TestUpdateChannel_OmittedIsPrivate_KeepsPublicChannelPublic(t *testing.T) {
	h, uc := newTestServerHandler(t)
	serverID, channelID, userID := uuid.New(), uuid.New(), uuid.New()

	uc.On("CheckChannelAccess", channelID, userID).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, IsPrivate: false}, nil)
	uc.On("UpdateChannel", serverID, channelID, userID, "new name", false).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "new name"}, nil)

	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, patchChannelRequest(serverID, channelID, userID, `{"name":"new name"}`))

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "UpdateChannel", serverID, channelID, userID, "new name", false)
}

// Явный is_private:false по-прежнему снимает приватность — поведение
// осознанного переключения не изменилось.
func TestUpdateChannel_ExplicitIsPrivateFalse_StillUnprivates(t *testing.T) {
	h, uc := newTestServerHandler(t)
	serverID, channelID, userID := uuid.New(), uuid.New(), uuid.New()

	uc.On("UpdateChannel", serverID, channelID, userID, "new name", false).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "new name"}, nil)

	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, patchChannelRequest(serverID, channelID, userID, `{"name":"new name","is_private":false}`))

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "UpdateChannel", serverID, channelID, userID, "new name", false)
	// Текущее значение не запрашивается: клиент прислал его явно.
	uc.AssertNotCalled(t, "CheckChannelAccess", mock.Anything, mock.Anything)
}

// Явный is_private:true работает как раньше.
func TestUpdateChannel_ExplicitIsPrivateTrue_Privates(t *testing.T) {
	h, uc := newTestServerHandler(t)
	serverID, channelID, userID := uuid.New(), uuid.New(), uuid.New()

	uc.On("UpdateChannel", serverID, channelID, userID, "new name", true).
		Return(&domain.Channel{ID: channelID, ServerID: serverID, Name: "new name", IsPrivate: true}, nil)
	uc.On("GetChannelAudience", channelID).Return([]uuid.UUID{userID}, nil)

	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, patchChannelRequest(serverID, channelID, userID, `{"name":"new name","is_private":true}`))

	assert.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	uc.AssertCalled(t, "UpdateChannel", serverID, channelID, userID, "new name", true)
	uc.AssertNotCalled(t, "CheckChannelAccess", mock.Anything, mock.Anything)
}

// Ошибка чтения текущего значения уходит через тот же writeUseCaseError,
// что и остальные ошибки UpdateChannel.
func TestUpdateChannel_OmittedIsPrivate_CurrentValueLookupError(t *testing.T) {
	h, uc := newTestServerHandler(t)
	serverID, channelID, userID := uuid.New(), uuid.New(), uuid.New()

	uc.On("CheckChannelAccess", channelID, userID).Return(nil, domain.ErrChannelForbidden)

	rec := httptest.NewRecorder()
	h.UpdateChannel(rec, patchChannelRequest(serverID, channelID, userID, `{"name":"new name"}`))

	assert.Equal(t, http.StatusForbidden, rec.Code)
	uc.AssertNotCalled(t, "UpdateChannel", mock.Anything, mock.Anything, mock.Anything, mock.Anything, mock.Anything)
}
