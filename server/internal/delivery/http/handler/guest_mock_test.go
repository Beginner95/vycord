package handler

import (
	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type mockGuestUseCase struct{ mock.Mock }

func (m *mockGuestUseCase) SetEvents(events domain.GuestEvents) { m.Called(events) }

func (m *mockGuestUseCase) CreateLink(channelID, userID uuid.UUID) (*domain.GuestLinkCreated, error) {
	args := m.Called(channelID, userID)
	c, _ := args.Get(0).(*domain.GuestLinkCreated)
	return c, args.Error(1)
}
func (m *mockGuestUseCase) ListCallGuests(channelID, userID uuid.UUID) (*domain.GuestCallState, error) {
	args := m.Called(channelID, userID)
	s, _ := args.Get(0).(*domain.GuestCallState)
	return s, args.Error(1)
}
func (m *mockGuestUseCase) RevokeLink(linkID, userID uuid.UUID) error {
	return m.Called(linkID, userID).Error(0)
}
func (m *mockGuestUseCase) Admit(guestID, userID uuid.UUID) error {
	return m.Called(guestID, userID).Error(0)
}
func (m *mockGuestUseCase) Reject(guestID, userID uuid.UUID) error {
	return m.Called(guestID, userID).Error(0)
}
func (m *mockGuestUseCase) Kick(guestID, userID uuid.UUID, ban bool) error {
	return m.Called(guestID, userID, ban).Error(0)
}
func (m *mockGuestUseCase) SetServerGuestLinks(serverID, userID uuid.UUID, enabled bool) (*domain.Server, error) {
	args := m.Called(serverID, userID, enabled)
	s, _ := args.Get(0).(*domain.Server)
	return s, args.Error(1)
}
func (m *mockGuestUseCase) OnParticipantLeft(channelID, userID uuid.UUID) {
	m.Called(channelID, userID)
}
func (m *mockGuestUseCase) Preview(secret string) (*domain.GuestPreview, error) {
	args := m.Called(secret)
	p, _ := args.Get(0).(*domain.GuestPreview)
	return p, args.Error(1)
}
func (m *mockGuestUseCase) Join(secret, displayName, clientIP string) (*domain.GuestJoinResult, error) {
	args := m.Called(secret, displayName, clientIP)
	res, _ := args.Get(0).(*domain.GuestJoinResult)
	return res, args.Error(1)
}
func (m *mockGuestUseCase) Authenticate(sessionToken string) (*domain.GuestContext, error) {
	args := m.Called(sessionToken)
	gc, _ := args.Get(0).(*domain.GuestContext)
	return gc, args.Error(1)
}
func (m *mockGuestUseCase) Leave(guest *domain.GuestContext) error {
	return m.Called(guest).Error(0)
}
func (m *mockGuestUseCase) IssueRoomToken(guest *domain.GuestContext) (string, uuid.UUID, error) {
	args := m.Called(guest)
	id, _ := args.Get(1).(uuid.UUID)
	return args.String(0), id, args.Error(2)
}
func (m *mockGuestUseCase) TURNCredentials(guest *domain.GuestContext) (*domain.TURNCredentials, error) {
	args := m.Called(guest)
	c, _ := args.Get(0).(*domain.TURNCredentials)
	return c, args.Error(1)
}
func (m *mockGuestUseCase) ExpireLobby()            { m.Called() }
func (m *mockGuestUseCase) EndGuestsOfClosedCalls() { m.Called() }

func (m *mockGuestUseCase) SweepAbsentGuests(present map[uuid.UUID]struct{}) { m.Called(present) }
