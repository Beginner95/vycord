package handler

import (
	"bytes"
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockReadStateUseCase struct{ mock.Mock }

func (m *mockReadStateUseCase) Unread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	args := m.Called(userID)
	list, _ := args.Get(0).([]*domain.ChannelUnread)
	return list, args.Error(1)
}
func (m *mockReadStateUseCase) MarkRead(userID, channelID, messageID uuid.UUID) (*domain.MarkReadResult, error) {
	args := m.Called(userID, channelID, messageID)
	res, _ := args.Get(0).(*domain.MarkReadResult)
	return res, args.Error(1)
}
func (m *mockReadStateUseCase) OthersRead(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	args := m.Called(userID, channelID)
	cur, _ := args.Get(0).(*domain.ReadCursor)
	return cur, args.Error(1)
}
func (m *mockReadStateUseCase) Readers(userID, channelID, messageID uuid.UUID) (*domain.MessageReaders, error) {
	args := m.Called(userID, channelID, messageID)
	res, _ := args.Get(0).(*domain.MessageReaders)
	return res, args.Error(1)
}
func (m *mockReadStateUseCase) AuthorRead(msg *domain.Message) error { return m.Called(msg).Error(0) }
func (m *mockReadStateUseCase) MessageByID(id uuid.UUID) (*domain.Message, error) {
	args := m.Called(id)
	msg, _ := args.Get(0).(*domain.Message)
	return msg, args.Error(1)
}
func (m *mockReadStateUseCase) Activity(msg *domain.Message, op string) (*domain.ChannelActivity, []uuid.UUID, error) {
	args := m.Called(msg, op)
	ev, _ := args.Get(0).(*domain.ChannelActivity)
	ids, _ := args.Get(1).([]uuid.UUID)
	return ev, ids, args.Error(2)
}

type sentToChannel struct {
	channelID, except uuid.UUID
	msg               *ws.Message
}

type fakeChannelReadSender struct{ sent []sentToChannel }

func (f *fakeChannelReadSender) SendToChannelExcept(channelID, exceptUserID uuid.UUID, message *ws.Message) {
	f.sent = append(f.sent, sentToChannel{channelID, exceptUserID, message})
}

func newReadStateHandler() (*ReadStateHandler, *mockReadStateUseCase, *fakeChannelReadSender) {
	uc, sender := new(mockReadStateUseCase), &fakeChannelReadSender{}
	return NewReadStateHandler(uc, sender, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil))), uc, sender
}

func authed(r *http.Request, userID uuid.UUID) *http.Request {
	return r.WithContext(context.WithValue(r.Context(), "user_id", userID))
}

func TestReadStateHandler_GetUnreadNeverNull(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user := uuid.New()
	uc.On("Unread", user).Return(nil, nil)

	rec := httptest.NewRecorder()
	h.GetUnread(rec, authed(httptest.NewRequest(http.MethodGet, "/api/v1/unread", nil), user))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `[]`, rec.Body.String())
}

func TestReadStateHandler_MarkReadBroadcastsOnlyWhenAdvanced(t *testing.T) {
	for _, advanced := range []bool{true, false} {
		h, uc, sender := newReadStateHandler()
		user, ch, msgID := uuid.New(), uuid.New(), uuid.New()
		at := time.Date(2026, 10, 3, 10, 0, 0, 123456000, time.UTC)
		uc.On("MarkRead", user, ch, msgID).Return(&domain.MarkReadResult{
			Count: 2, ReadCursor: domain.ReadCursor{At: at, MessageID: &msgID}, Advanced: advanced,
		}, nil)

		req := httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(`{"message_id":"`+msgID.String()+`"}`))
		req.SetPathValue("channel_id", ch.String())
		rec := httptest.NewRecorder()
		h.MarkRead(rec, authed(req, user))

		require.Equal(t, http.StatusOK, rec.Code)
		assert.JSONEq(t, `{"count":2,"last_read_at":"2026-10-03T10:00:00.123456Z","last_read_message_id":"`+msgID.String()+`"}`, rec.Body.String())
		if !advanced {
			assert.Empty(t, sender.sent)
			continue
		}
		require.Len(t, sender.sent, 1)
		assert.Equal(t, ch, sender.sent[0].channelID)
		assert.Equal(t, user, sender.sent[0].except)
		assert.Equal(t, "channel_read", sender.sent[0].msg.Type)
		assert.JSONEq(t, `{"channel_id":"`+ch.String()+`","read_at":"2026-10-03T10:00:00.123456Z","message_id":"`+msgID.String()+`"}`, string(sender.sent[0].msg.Payload))
	}
}

func TestReadStateHandler_MarkReadValidation(t *testing.T) {
	h, _, _ := newReadStateHandler()
	req := httptest.NewRequest(http.MethodPut, "/x", strings.NewReader(`{}`))
	req.SetPathValue("channel_id", uuid.NewString())
	rec := httptest.NewRecorder()
	h.MarkRead(rec, authed(req, uuid.New()))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"invalid_message_id"`)
}

func TestReadStateHandler_ReadReceipts(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user, ch := uuid.New(), uuid.New()
	uc.On("OthersRead", user, ch).Return(nil, nil)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.SetPathValue("channel_id", ch.String())
	rec := httptest.NewRecorder()
	h.GetReadReceipts(rec, authed(req, user))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.JSONEq(t, `{"others_max_read_at":null,"others_max_read_message_id":null}`, rec.Body.String())
}

func TestReadStateHandler_ReadersErrors(t *testing.T) {
	cases := map[error]int{
		domain.ErrForbidden:       http.StatusForbidden,
		domain.ErrMessageNotFound: http.StatusNotFound,
		domain.ErrChannelNotFound: http.StatusNotFound,
	}
	for err, status := range cases {
		h, uc, _ := newReadStateHandler()
		user, ch, msgID := uuid.New(), uuid.New(), uuid.New()
		uc.On("Readers", user, ch, msgID).Return(nil, err)

		req := httptest.NewRequest(http.MethodGet, "/x", nil)
		req.SetPathValue("channel_id", ch.String())
		req.SetPathValue("message_id", msgID.String())
		rec := httptest.NewRecorder()
		h.GetReaders(rec, authed(req, user))
		assert.Equal(t, status, rec.Code, err.Error())
	}
}

func TestReadStateHandler_ReadersOK(t *testing.T) {
	h, uc, _ := newReadStateHandler()
	user, ch, msgID, b := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	uc.On("Readers", user, ch, msgID).Return(&domain.MessageReaders{
		Read: []*domain.Reader{{UserID: b, Username: "boris", HasRead: true}}, Unread: []*domain.Reader{},
	}, nil)

	req := httptest.NewRequest(http.MethodGet, "/x", nil)
	req.SetPathValue("channel_id", ch.String())
	req.SetPathValue("message_id", msgID.String())
	rec := httptest.NewRecorder()
	h.GetReaders(rec, authed(req, user))
	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]json.RawMessage
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.JSONEq(t, `[{"user_id":"`+b.String()+`","username":"boris"}]`, string(body["read"]))
	assert.JSONEq(t, `[]`, string(body["unread"]))
}
