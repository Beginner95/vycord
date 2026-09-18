package handler

import (
	"encoding/json"
	"io"
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

	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/http/ratelimit"
	"github.com/vycord/server/internal/domain"
)

func newGuestHandler(t *testing.T) (*GuestHandler, *mockGuestUseCase, *mockMessageUseCase) {
	t.Helper()
	guests := &mockGuestUseCase{}
	messages := &mockMessageUseCase{}
	limits := GuestRateLimits{
		Preview:        ratelimit.New(10, time.Minute),
		Join:           ratelimit.New(5, time.Minute),
		SecretFailures: ratelimit.New(3, time.Hour),
		Messages:       ratelimit.New(5, 10*time.Second),
	}
	return NewGuestHandler(guests, messages, nil, limits, slog.New(slog.NewTextHandler(io.Discard, nil))), guests, messages
}

func guestRequest(method, path, body string, guest *domain.GuestContext) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	r.RemoteAddr = "127.0.0.1:5000"
	r.Header.Set("X-Real-IP", "203.0.113.9")
	if guest != nil {
		r = r.WithContext(middleware.WithGuest(r.Context(), guest))
	}
	return r
}

func admittedGuestContext(channelID uuid.UUID) *domain.GuestContext {
	admitted := time.Now()
	return &domain.GuestContext{
		Guest: domain.CallGuest{
			ID: uuid.New(), ChannelID: channelID, DisplayName: "Вася",
			Status: domain.GuestStatusAdmitted, AdmittedAt: &admitted,
		},
		GuestLinksEnabled: true,
	}
}

func TestGuestHandler_Preview(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	guests.On("Preview", "sec").Return(&domain.GuestPreview{ServerName: "Вебваха", ChannelName: "общий", ParticipantCount: 2}, nil)

	rec := httptest.NewRecorder()
	h.Preview(rec, guestRequest(http.MethodPost, "/api/v1/guest/preview", `{"secret":"sec"}`, nil))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"server_name":"Вебваха"`)
	assert.NotContains(t, rec.Body.String(), "user_id", "the preview never leaks participant identities")
}

// Н18: repeated wrong secrets close the door for that IP.
func TestGuestHandler_PreviewFailureLimit(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	guests.On("Preview", "bad").Return(nil, domain.ErrGuestLinkInvalid)
	guests.On("Preview", "good").Return(&domain.GuestPreview{ServerName: "s"}, nil)

	for i := 0; i < 3; i++ {
		rec := httptest.NewRecorder()
		h.Preview(rec, guestRequest(http.MethodPost, "/x", `{"secret":"bad"}`, nil))
		require.Equal(t, http.StatusNotFound, rec.Code, "attempt %d", i+1)
	}

	rec := httptest.NewRecorder()
	h.Preview(rec, guestRequest(http.MethodPost, "/x", `{"secret":"good"}`, nil))
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"rate_limited"`)
}

func TestGuestHandler_JoinPassesClientIP(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	res := &domain.GuestJoinResult{GuestID: uuid.New(), SessionToken: "tok", DisplayName: "Вася"}
	guests.On("Join", "sec", "Вася", "203.0.113.9").Return(res, nil)

	rec := httptest.NewRecorder()
	h.Join(rec, guestRequest(http.MethodPost, "/x", `{"secret":"sec","display_name":"Вася"}`, nil))

	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Contains(t, rec.Body.String(), `"session_token":"tok"`)
	guests.AssertExpectations(t)
}

func TestGuestHandler_JoinFromPublicPeerIgnoresXRealIP(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	guests.On("Join", "sec", "Вася", "198.51.100.7").Return(&domain.GuestJoinResult{}, nil)

	req := guestRequest(http.MethodPost, "/x", `{"secret":"sec","display_name":"Вася"}`, nil)
	req.RemoteAddr = "198.51.100.7:4000"
	rec := httptest.NewRecorder()
	h.Join(rec, req)

	require.Equal(t, http.StatusCreated, rec.Code)
	guests.AssertExpectations(t)
}

func TestGuestHandler_JoinRejectsBadName(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	guests.On("Join", "sec", "Администратор", mock.Anything).Return(nil, domain.ErrReservedGuestName)

	rec := httptest.NewRecorder()
	h.Join(rec, guestRequest(http.MethodPost, "/x", `{"secret":"sec","display_name":"Администратор"}`, nil))

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"reserved_guest_name"`)
}

func TestGuestHandler_VoiceTokenAndTURN(t *testing.T) {
	channelID := uuid.New()
	gc := admittedGuestContext(channelID)

	h, guests, _ := newGuestHandler(t)
	guests.On("IssueRoomToken", gc).Return("room-token", channelID, nil)
	rec := httptest.NewRecorder()
	h.VoiceToken(rec, guestRequest(http.MethodPost, "/x", "", gc))
	require.Equal(t, http.StatusOK, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "room-token", body["token"])
	assert.Equal(t, channelID.String(), body["room_id"])

	guests.On("TURNCredentials", gc).Return(&domain.TURNCredentials{
		URLs: []string{"turn:example:3478"}, Username: "1:guest:x", Credential: "c", TTLSeconds: 3600,
	}, nil)
	rec = httptest.NewRecorder()
	h.TURNCredentials(rec, guestRequest(http.MethodGet, "/x", "", gc))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"ttl":3600`)
	assert.Contains(t, rec.Body.String(), `"ice_servers":[`)
}

// Н12
func TestGuestHandler_VoiceTokenNotAdmitted(t *testing.T) {
	h, guests, _ := newGuestHandler(t)
	gc := admittedGuestContext(uuid.New())
	gc.Guest.Status = domain.GuestStatusLobby
	guests.On("IssueRoomToken", gc).Return("", uuid.Nil, domain.ErrGuestNotAdmitted)

	rec := httptest.NewRecorder()
	h.VoiceToken(rec, guestRequest(http.MethodPost, "/x", "", gc))
	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"guest_not_admitted"`)
}

func TestGuestHandler_WithoutGuestContext(t *testing.T) {
	h, _, _ := newGuestHandler(t)
	rec := httptest.NewRecorder()
	h.VoiceToken(rec, guestRequest(http.MethodPost, "/x", "", nil))
	assert.Equal(t, http.StatusUnauthorized, rec.Code)
}

func TestGuestHandler_PostMessage(t *testing.T) {
	channelID := uuid.New()
	gc := admittedGuestContext(channelID)
	h, _, messages := newGuestHandler(t)
	msg := &domain.Message{ID: uuid.New(), ChannelID: channelID, Content: "привет"}
	messages.On("CreateGuestMessage", gc, "привет").Return(msg, nil)

	rec := httptest.NewRecorder()
	h.PostMessage(rec, guestRequest(http.MethodPost, "/x", `{"content":"привет"}`, gc))
	require.Equal(t, http.StatusCreated, rec.Code)
	assert.Contains(t, rec.Body.String(), `"content":"привет"`)
}

func TestGuestHandler_PostMessageRateLimit(t *testing.T) {
	gc := admittedGuestContext(uuid.New())
	h, _, messages := newGuestHandler(t)
	messages.On("CreateGuestMessage", gc, "spam").Return(&domain.Message{ID: uuid.New()}, nil)

	for i := 0; i < 5; i++ {
		rec := httptest.NewRecorder()
		h.PostMessage(rec, guestRequest(http.MethodPost, "/x", `{"content":"spam"}`, gc))
		require.Equal(t, http.StatusCreated, rec.Code, "message %d", i+1)
	}
	rec := httptest.NewRecorder()
	h.PostMessage(rec, guestRequest(http.MethodPost, "/x", `{"content":"spam"}`, gc))
	assert.Equal(t, http.StatusTooManyRequests, rec.Code)
}

func TestGuestHandler_ListMessages(t *testing.T) {
	gc := admittedGuestContext(uuid.New())
	afterID := uuid.New()

	h, _, messages := newGuestHandler(t)
	messages.On("ListGuestMessages", gc, &afterID, 10).Return([]*domain.GuestChatMessage{{ID: uuid.New(), Content: "hi"}}, nil)
	rec := httptest.NewRecorder()
	h.ListMessages(rec, guestRequest(http.MethodGet, "/x?after="+afterID.String()+"&limit=10", "", gc))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"content":"hi"`)

	h2, _, messages2 := newGuestHandler(t)
	messages2.On("ListGuestMessages", gc, (*uuid.UUID)(nil), 0).Return(nil, nil)
	rec = httptest.NewRecorder()
	h2.ListMessages(rec, guestRequest(http.MethodGet, "/x", "", gc))
	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "[]\n", rec.Body.String(), "an empty window is an empty array, not null")

	h3, _, _ := newGuestHandler(t)
	rec = httptest.NewRecorder()
	h3.ListMessages(rec, guestRequest(http.MethodGet, "/x?after=zzz", "", gc))
	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"invalid_message_id"`)
}

func TestGuestHandler_Leave(t *testing.T) {
	gc := admittedGuestContext(uuid.New())
	h, guests, _ := newGuestHandler(t)
	guests.On("Leave", gc).Return(nil)

	rec := httptest.NewRecorder()
	h.Leave(rec, guestRequest(http.MethodPost, "/x", "", gc))
	assert.Equal(t, http.StatusNoContent, rec.Code)
}
