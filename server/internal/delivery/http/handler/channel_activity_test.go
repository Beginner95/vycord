package handler

import (
	"bytes"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type sentToUsers struct {
	ids []uuid.UUID
	msg *ws.Message
}

type fakeUsersSender struct{ sent []sentToUsers }

func (f *fakeUsersSender) SendToUsers(ids []uuid.UUID, m *ws.Message) {
	f.sent = append(f.sent, sentToUsers{ids, m})
}

func newFanout() (*ChannelActivityFanout, *mockReadStateUseCase, *fakeUsersSender, *bytes.Buffer) {
	uc, sender, buf := new(mockReadStateUseCase), &fakeUsersSender{}, &bytes.Buffer{}
	return NewChannelActivityFanout(uc, sender, slog.New(slog.NewTextHandler(buf, nil))), uc, sender, buf
}

func TestChannelActivityFanout_CreatedAdvancesAuthorAndBroadcasts(t *testing.T) {
	f, uc, sender, _ := newFanout()
	author := uuid.New()
	msg := &domain.Message{ID: uuid.New(), ChannelID: uuid.New(), UserID: &author, Kind: "user", CreatedAt: time.Now()}
	ev := &domain.ChannelActivity{Op: "create", ServerID: uuid.New(), ChannelID: msg.ChannelID, MessageID: msg.ID, CreatedAt: msg.CreatedAt, AuthorUserID: &author}
	members := []uuid.UUID{author, uuid.New()}
	uc.On("AuthorRead", msg).Return(nil)
	uc.On("Activity", msg, "create").Return(ev, members, nil)

	f.Created(msg)

	uc.AssertCalled(t, "AuthorRead", msg)
	require.Len(t, sender.sent, 1)
	assert.Equal(t, members, sender.sent[0].ids)
	assert.Equal(t, "channel_activity", sender.sent[0].msg.Type)
	assert.Contains(t, string(sender.sent[0].msg.Payload), `"op":"create"`)
}

func TestChannelActivityFanout_CallMessageIsSilent(t *testing.T) {
	f, uc, sender, _ := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "call"}
	uc.On("AuthorRead", msg).Return(nil)
	uc.On("Activity", msg, "create").Return(nil, nil, nil)
	f.Created(msg)
	assert.Empty(t, sender.sent)
}

func TestChannelActivityFanout_ErrorsAreLoggedNotFatal(t *testing.T) {
	f, uc, sender, buf := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "user"}
	uc.On("AuthorRead", msg).Return(errors.New("db down"))
	uc.On("Activity", msg, "create").Return(nil, nil, errors.New("db down"))
	f.Created(msg)
	assert.Empty(t, sender.sent)
	assert.Contains(t, buf.String(), "db down")
}

func TestChannelActivityFanout_LookupAndDeleted(t *testing.T) {
	f, uc, sender, _ := newFanout()
	msg := &domain.Message{ID: uuid.New(), Kind: "user"}
	uc.On("MessageByID", msg.ID).Return(msg, nil)
	missing := uuid.New()
	uc.On("MessageByID", missing).Return(nil, domain.ErrMessageNotFound)
	uc.On("Activity", msg, "delete").Return(&domain.ChannelActivity{Op: "delete"}, []uuid.UUID{uuid.New()}, nil)

	assert.Equal(t, msg, f.Lookup(msg.ID))
	assert.Nil(t, f.Lookup(missing))

	f.Deleted(msg)
	require.Len(t, sender.sent, 1)
	assert.Contains(t, string(sender.sent[0].msg.Payload), `"op":"delete"`)
}
