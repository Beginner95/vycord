package handler

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type mockReactionUseCase struct{ mock.Mock }

func (m *mockReactionUseCase) Add(userID, channelID, messageID uuid.UUID, rawKey string) ([]domain.Reaction, error) {
	args := m.Called(userID, channelID, messageID, rawKey)
	rs, _ := args.Get(0).([]domain.Reaction)
	return rs, args.Error(1)
}
func (m *mockReactionUseCase) Remove(userID, channelID, messageID uuid.UUID, rawKey string) ([]domain.Reaction, error) {
	args := m.Called(userID, channelID, messageID, rawKey)
	rs, _ := args.Get(0).([]domain.Reaction)
	return rs, args.Error(1)
}

type fakeChannelSender struct{ sent []*ws.Message }

func (f *fakeChannelSender) SendToChannel(_ uuid.UUID, m *ws.Message) { f.sent = append(f.sent, m) }

type fakeGuestReactions struct{ calls int }

func (f *fakeGuestReactions) MessageReactions(uuid.UUID, uuid.UUID, []domain.Reaction) { f.calls++ }

// serve прогоняет запрос через настоящий ServeMux — так PathValue и
// раскодирование %-последовательностей те же, что в проде.
func serveReaction(h *ReactionHandler, method, path string, userID uuid.UUID) *httptest.ResponseRecorder {
	mux := http.NewServeMux()
	mux.HandleFunc("PUT /api/v1/channels/{channel_id}/messages/{message_id}/reactions/{key}", h.Add)
	mux.HandleFunc("DELETE /api/v1/channels/{channel_id}/messages/{message_id}/reactions/{key}", h.Remove)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, authed(httptest.NewRequest(method, path, nil), userID))
	return rec
}

func reactionPath(ch, msg uuid.UUID, key string) string {
	return "/api/v1/channels/" + ch.String() + "/messages/" + msg.String() + "/reactions/" + url.PathEscape(key)
}

func newReactionHandler() (*ReactionHandler, *mockReactionUseCase, *fakeChannelSender, *fakeGuestReactions) {
	uc, hub, guests := new(mockReactionUseCase), &fakeChannelSender{}, &fakeGuestReactions{}
	h := NewReactionHandler(uc, hub, slog.New(slog.NewTextHandler(&bytes.Buffer{}, nil)))
	h.SetGuestFanout(guests)
	return h, uc, hub, guests
}

func TestReactionHandler_AddDecodesKeyAndBroadcasts(t *testing.T) {
	h, uc, hub, guests := newReactionHandler()
	user, ch, msg := uuid.New(), uuid.New(), uuid.New()
	snap := []domain.Reaction{{Key: "❤️", Emoji: "❤️", Count: 1, UserIDs: []uuid.UUID{user}}}
	uc.On("Add", user, ch, msg, "❤️").Return(snap, nil)

	rec := serveReaction(h, http.MethodPut, reactionPath(ch, msg, "❤️"), user)

	require.Equal(t, http.StatusOK, rec.Code, rec.Body.String())
	var body reactionsPayload
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, msg, body.MessageID)
	assert.Equal(t, ch, body.ChannelID)
	assert.Equal(t, snap, body.Reactions)
	require.Len(t, hub.sent, 1)
	assert.Equal(t, "message_reactions", hub.sent[0].Type)
	assert.JSONEq(t, rec.Body.String(), string(hub.sent[0].Payload))
	assert.Equal(t, 1, guests.calls)
}

func TestReactionHandler_RemoveLastSendsEmptyArray(t *testing.T) {
	h, uc, hub, _ := newReactionHandler()
	user, ch, msg := uuid.New(), uuid.New(), uuid.New()
	uc.On("Remove", user, ch, msg, "👍").Return(nil, nil) // nil из usecase → всё равно []

	rec := serveReaction(h, http.MethodDelete, reactionPath(ch, msg, "👍"), user)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"reactions":[]`)
	require.Len(t, hub.sent, 1)
	assert.Contains(t, string(hub.sent[0].Payload), `"reactions":[]`)
}

func TestReactionHandler_StickerKey(t *testing.T) {
	h, uc, _, _ := newReactionHandler()
	user, ch, msg, sid := uuid.New(), uuid.New(), uuid.New(), uuid.New()
	uc.On("Add", user, ch, msg, "sticker:"+sid.String()).Return([]domain.Reaction{}, nil)
	rec := serveReaction(h, http.MethodPut, reactionPath(ch, msg, "sticker:"+sid.String()), user)
	assert.Equal(t, http.StatusOK, rec.Code)
}

func TestReactionHandler_ErrorMapping(t *testing.T) {
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{domain.ErrReactionInvalid, http.StatusBadRequest, "reaction_invalid"},
		{domain.ErrReactionLimitReached, http.StatusBadRequest, "reaction_limit_reached"},
		{domain.ErrReactionNotAllowed, http.StatusBadRequest, "reaction_not_allowed"},
		{domain.ErrStickerNotFound, http.StatusNotFound, "sticker_not_found"},
		{domain.ErrMessageNotFound, http.StatusNotFound, "message_not_found"},
		{domain.ErrChannelNotFound, http.StatusNotFound, "channel_not_found"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
	}
	for _, c := range cases {
		h, uc, hub, guests := newReactionHandler()
		user, ch, msg := uuid.New(), uuid.New(), uuid.New()
		uc.On("Add", user, ch, msg, "👍").Return(nil, c.err)
		rec := serveReaction(h, http.MethodPut, reactionPath(ch, msg, "👍"), user)
		assert.Equal(t, c.status, rec.Code, c.code)
		var body map[string]string
		require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
		assert.Equal(t, c.code, body["code"])
		assert.Empty(t, hub.sent, "ошибка не рассылается")
		assert.Zero(t, guests.calls)
	}
}

func TestReactionHandler_BadIDs(t *testing.T) {
	h, _, _, _ := newReactionHandler()
	rec := serveReaction(h, http.MethodPut, "/api/v1/channels/nope/messages/"+uuid.NewString()+"/reactions/x", uuid.New())
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	rec = serveReaction(h, http.MethodPut, "/api/v1/channels/"+uuid.NewString()+"/messages/nope/reactions/x", uuid.New())
	assert.Equal(t, http.StatusBadRequest, rec.Code)
}
