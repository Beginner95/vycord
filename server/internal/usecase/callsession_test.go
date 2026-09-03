package usecase_test

import (
	"io"
	"log/slog"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// fakeCallMessageRepo hand-rolls domain.MessageRepository. Only the five
// call-bookkeeping methods do anything; the rest are stubs never exercised
// by these tests but required to satisfy the interface.
type fakeCallMessageRepo struct {
	createCallFn         func(msg *domain.Message) (bool, error)
	endCallFn            func(channelID uuid.UUID) (*domain.Message, bool, error)
	addCallParticipantFn func(channelID, userID uuid.UUID) error
	touchCallsFn         func(channelIDs []uuid.UUID) error
	closeCallsMissingFn  func(channelIDs []uuid.UUID, minAge time.Duration) ([]*domain.Message, error)
}

func (f *fakeCallMessageRepo) CreateCall(msg *domain.Message) (bool, error) { return f.createCallFn(msg) }
func (f *fakeCallMessageRepo) EndCall(channelID uuid.UUID) (*domain.Message, bool, error) {
	return f.endCallFn(channelID)
}
func (f *fakeCallMessageRepo) AddCallParticipant(channelID, userID uuid.UUID) error {
	return f.addCallParticipantFn(channelID, userID)
}
func (f *fakeCallMessageRepo) TouchCalls(channelIDs []uuid.UUID) error { return f.touchCallsFn(channelIDs) }
func (f *fakeCallMessageRepo) CloseCallsMissingFrom(channelIDs []uuid.UUID, minAge time.Duration) ([]*domain.Message, error) {
	return f.closeCallsMissingFn(channelIDs, minAge)
}
func (f *fakeCallMessageRepo) CloseOrphanedCalls() error { return nil }

func (f *fakeCallMessageRepo) Create(*domain.Message) error                   { return nil }
func (f *fakeCallMessageRepo) GetByID(uuid.UUID) (*domain.Message, error)     { return nil, nil }
func (f *fakeCallMessageRepo) GetByChannelID(uuid.UUID, int, int) ([]*domain.Message, error) {
	return nil, nil
}
func (f *fakeCallMessageRepo) Search(uuid.UUID, string, int, int) ([]*domain.MessageWithAuthor, int, error) {
	return nil, 0, nil
}
func (f *fakeCallMessageRepo) GetAround(uuid.UUID, uuid.UUID, int) ([]*domain.Message, error) {
	return nil, nil
}
func (f *fakeCallMessageRepo) Update(uuid.UUID, map[string]interface{}) error { return nil }
func (f *fakeCallMessageRepo) Delete(uuid.UUID) error                         { return nil }

func newTestHubForRecorder(t *testing.T, channelID uuid.UUID) (*ws.Hub, *ws.Client) {
	t.Helper()
	h := ws.NewHub(slog.New(slog.NewTextHandler(io.Discard, nil)))
	go h.Run()
	client := &ws.Client{UserID: uuid.New(), Send: make(chan []byte, 8)}
	h.RegisterClient(client)
	assert.Eventually(t, func() bool { return h.IsOnline(client.UserID) }, time.Second, 10*time.Millisecond)
	h.SetClientChannel(client.UserID, &channelID)
	return h, client
}

func TestCallSessionRecorder_CallStarted_InsertsAndBroadcasts(t *testing.T) {
	channelID, starterID := uuid.New(), uuid.New()
	h, client := newTestHubForRecorder(t, channelID)

	var created *domain.Message
	repo := &fakeCallMessageRepo{
		createCallFn: func(msg *domain.Message) (bool, error) {
			created = msg
			return true, nil
		},
	}
	rec := usecase.NewCallSessionRecorder(repo, h)

	rec.CallStarted(channelID, starterID)

	if assert.NotNil(t, created) {
		assert.Equal(t, "call", created.Kind)
		assert.Equal(t, starterID, created.UserID)
	}
	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"chat_message"`) {
				return
			}
		case <-deadline:
			t.Fatal("expected a chat_message broadcast")
		}
	}
}

func TestCallSessionRecorder_CallStarted_UniqueConflictDoesNotBroadcast(t *testing.T) {
	channelID := uuid.New()
	h, client := newTestHubForRecorder(t, channelID)

	repo := &fakeCallMessageRepo{
		createCallFn: func(msg *domain.Message) (bool, error) { return false, nil }, // уже открыт
	}
	rec := usecase.NewCallSessionRecorder(repo, h)

	rec.CallStarted(channelID, uuid.New())

	deadline := time.After(200 * time.Millisecond)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"chat_message"`) {
				t.Fatalf("unexpected chat_message broadcast on unique-index conflict: %s", msg)
			}
		case <-deadline:
			return
		}
	}
}

func TestCallSessionRecorder_CallEnded_ZeroRowsDoesNotBroadcast(t *testing.T) {
	channelID := uuid.New()
	h, client := newTestHubForRecorder(t, channelID)

	repo := &fakeCallMessageRepo{
		endCallFn: func(uuid.UUID) (*domain.Message, bool, error) { return nil, false, nil },
	}
	rec := usecase.NewCallSessionRecorder(repo, h)

	rec.CallEnded(channelID)

	deadline := time.After(200 * time.Millisecond)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"message_update"`) {
				t.Fatalf("unexpected message_update broadcast when no open call was closed: %s", msg)
			}
		case <-deadline:
			return
		}
	}
}

func TestCallSessionRecorder_ParticipantJoined_CallsAddCallParticipantWithNoBroadcast(t *testing.T) {
	channelID, userID := uuid.New(), uuid.New()
	h, client := newTestHubForRecorder(t, channelID)

	var gotChannelID, gotUserID uuid.UUID
	repo := &fakeCallMessageRepo{
		addCallParticipantFn: func(cID, uID uuid.UUID) error {
			gotChannelID, gotUserID = cID, uID
			return nil
		},
	}
	rec := usecase.NewCallSessionRecorder(repo, h)

	rec.ParticipantJoined(channelID, userID)

	assert.Equal(t, channelID, gotChannelID)
	assert.Equal(t, userID, gotUserID)

	// Only chat_message/message_update would indicate an (unwanted) call
	// broadcast here; online_users/voice_state are unrelated hub bookkeeping
	// that newTestHubForRecorder's RegisterClient can still be delivering
	// asynchronously at this point (see the sibling CallStarted/CallEnded
	// tests above, which filter the same way).
	deadline := time.After(200 * time.Millisecond)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"chat_message"`) || strings.Contains(string(msg), `"message_update"`) {
				t.Fatalf("unexpected broadcast on ParticipantJoined: %s", msg)
			}
		case <-deadline:
			return
		}
	}
}

func TestCallSessionRecorder_SweepCalls_TouchesAndClosesAndBroadcasts(t *testing.T) {
	staleChannel := uuid.New()
	h, client := newTestHubForRecorder(t, staleChannel)

	var touchedWith []uuid.UUID
	closedMsg := &domain.Message{ID: uuid.New(), ChannelID: staleChannel, Kind: "call"}
	repo := &fakeCallMessageRepo{
		touchCallsFn: func(ids []uuid.UUID) error { touchedWith = ids; return nil },
		closeCallsMissingFn: func(ids []uuid.UUID, minAge time.Duration) ([]*domain.Message, error) {
			assert.Equal(t, 15*time.Second, minAge)
			return []*domain.Message{closedMsg}, nil
		},
	}
	rec := usecase.NewCallSessionRecorder(repo, h)

	rec.SweepCalls([]uuid.UUID{})

	assert.NotNil(t, touchedWith, "TouchCalls must be called even with zero active channels")
	deadline := time.After(time.Second)
	for {
		select {
		case msg := <-client.Send:
			if strings.Contains(string(msg), `"message_update"`) {
				return
			}
		case <-deadline:
			t.Fatal("expected a message_update broadcast for the closed call")
		}
	}
}
