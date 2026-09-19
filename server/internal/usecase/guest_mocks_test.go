package usecase_test

import (
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/mock"

	"github.com/vycord/server/internal/domain"
)

type MockGuestRepository struct{ mock.Mock }

func (m *MockGuestRepository) OpenCallMessageID(channelID uuid.UUID) (uuid.UUID, error) {
	args := m.Called(channelID)
	id, _ := args.Get(0).(uuid.UUID)
	return id, args.Error(1)
}
func (m *MockGuestRepository) CreateLink(link *domain.GuestLink, secretHash []byte) error {
	return m.Called(link, secretHash).Error(0)
}
func (m *MockGuestRepository) GetLinkTargetBySecretHash(secretHash []byte) (*domain.GuestLinkTarget, error) {
	args := m.Called(secretHash)
	t, _ := args.Get(0).(*domain.GuestLinkTarget)
	return t, args.Error(1)
}
func (m *MockGuestRepository) GetLinkTargetByID(linkID uuid.UUID) (*domain.GuestLinkTarget, error) {
	args := m.Called(linkID)
	t, _ := args.Get(0).(*domain.GuestLinkTarget)
	return t, args.Error(1)
}
func (m *MockGuestRepository) ListCallState(callMessageID uuid.UUID) (*domain.GuestCallState, error) {
	args := m.Called(callMessageID)
	s, _ := args.Get(0).(*domain.GuestCallState)
	return s, args.Error(1)
}
func (m *MockGuestRepository) CloseCreatorLinksInChannel(channelID, creatorID uuid.UUID, now time.Time) (int64, error) {
	args := m.Called(channelID, creatorID, now)
	n, _ := args.Get(0).(int64)
	return n, args.Error(1)
}
func (m *MockGuestRepository) SetServerGuestLinks(serverID uuid.UUID, enabled bool, actorID uuid.UUID, now time.Time) ([]*domain.CallGuest, error) {
	args := m.Called(serverID, enabled, actorID, now)
	g, _ := args.Get(0).([]*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) Join(j domain.GuestJoin) (*domain.CallGuest, error) {
	args := m.Called(j)
	g, _ := args.Get(0).(*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) GetSessionByHash(sessionHash []byte) (*domain.GuestContext, error) {
	args := m.Called(sessionHash)
	c, _ := args.Get(0).(*domain.GuestContext)
	return c, args.Error(1)
}
func (m *MockGuestRepository) GetGuest(guestID uuid.UUID) (*domain.GuestContext, error) {
	args := m.Called(guestID)
	c, _ := args.Get(0).(*domain.GuestContext)
	return c, args.Error(1)
}
func (m *MockGuestRepository) Decide(guestID, actorID uuid.UUID, admit bool, now time.Time) (*domain.CallGuest, error) {
	args := m.Called(guestID, actorID, admit, now)
	g, _ := args.Get(0).(*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) EndGuest(guestID uuid.UUID, status domain.GuestStatus, actorID *uuid.UUID, ban bool, now time.Time) (*domain.CallGuest, error) {
	args := m.Called(guestID, status, actorID, ban, now)
	g, _ := args.Get(0).(*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) RevokeLink(linkID uuid.UUID, actorID *uuid.UUID, reason string, now time.Time) ([]*domain.CallGuest, error) {
	args := m.Called(linkID, actorID, reason, now)
	g, _ := args.Get(0).([]*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) EndGuestsOfClosedCalls(now time.Time) ([]*domain.CallGuest, error) {
	args := m.Called(now)
	g, _ := args.Get(0).([]*domain.CallGuest)
	return g, args.Error(1)
}
func (m *MockGuestRepository) ExpireLobby(olderThan, now time.Time) ([]*domain.CallGuest, error) {
	args := m.Called(olderThan, now)
	g, _ := args.Get(0).([]*domain.CallGuest)
	return g, args.Error(1)
}

// fakePresence — воспроизводимый срез хаба.
type fakePresence struct {
	mu    sync.Mutex
	rooms map[uuid.UUID][]uuid.UUID
}

func newFakePresence() *fakePresence { return &fakePresence{rooms: map[uuid.UUID][]uuid.UUID{}} }

func (p *fakePresence) put(channelID uuid.UUID, users ...uuid.UUID) {
	p.mu.Lock()
	defer p.mu.Unlock()
	p.rooms[channelID] = users
}

func (p *fakePresence) IsInVoiceChannel(userID, channelID uuid.UUID) bool {
	for _, u := range p.VoiceParticipants(channelID) {
		if u == userID {
			return true
		}
	}
	return false
}

func (p *fakePresence) VoiceParticipants(channelID uuid.UUID) []uuid.UUID {
	p.mu.Lock()
	defer p.mu.Unlock()
	out := make([]uuid.UUID, len(p.rooms[channelID]))
	copy(out, p.rooms[channelID])
	return out
}

// recordingEvents запоминает всё, что use case отправил наружу.
type recordingEvents struct {
	linksChanged   []uuid.UUID
	lobbyRequested []*domain.CallGuest
	requestedBy    []*uuid.UUID
	lobbyResolved  []*domain.CallGuest
	resolvedBy     []*uuid.UUID
	ended          [][]*domain.CallGuest
}

func (e *recordingEvents) LinksChanged(channelID uuid.UUID) {
	e.linksChanged = append(e.linksChanged, channelID)
}
func (e *recordingEvents) LobbyRequested(g *domain.CallGuest, linkCreatedBy *uuid.UUID) {
	e.lobbyRequested = append(e.lobbyRequested, g)
	e.requestedBy = append(e.requestedBy, linkCreatedBy)
}
func (e *recordingEvents) LobbyResolved(g *domain.CallGuest, byUserID *uuid.UUID) {
	e.lobbyResolved = append(e.lobbyResolved, g)
	e.resolvedBy = append(e.resolvedBy, byUserID)
}
func (e *recordingEvents) GuestsEnded(guests []*domain.CallGuest) {
	e.ended = append(e.ended, guests)
}
func (e *recordingEvents) endedIDs() []uuid.UUID {
	var ids []uuid.UUID
	for _, batch := range e.ended {
		for _, g := range batch {
			ids = append(ids, g.ID)
		}
	}
	return ids
}

type stubTURN struct {
	identity string
	ttl      time.Duration
	creds    *domain.TURNCredentials
}

func (s *stubTURN) GetCredentials(uuid.UUID) (*domain.TURNCredentials, error) { return s.creds, nil }
func (s *stubTURN) GetCredentialsForIdentity(identity string, ttl time.Duration) (*domain.TURNCredentials, error) {
	s.identity, s.ttl = identity, ttl
	return s.creds, nil
}

func (m *MockGuestRepository) ListAdmittedGuests() ([]*domain.CallGuest, error) {
	args := m.Called()
	g, _ := args.Get(0).([]*domain.CallGuest)
	return g, args.Error(1)
}
