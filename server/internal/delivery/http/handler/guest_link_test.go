package handler

import (
	"context"
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

	"github.com/vycord/server/internal/domain"
)

func newGuestLinkHandler(t *testing.T) (*GuestLinkHandler, *mockGuestUseCase) {
	t.Helper()
	uc := &mockGuestUseCase{}
	return NewGuestLinkHandler(uc, nil, nil, slog.New(slog.NewTextHandler(io.Discard, nil))), uc
}

func accountRequest(method, path, body string, userID uuid.UUID, pathValues map[string]string) *http.Request {
	var r *http.Request
	if body == "" {
		r = httptest.NewRequest(method, path, nil)
	} else {
		r = httptest.NewRequest(method, path, strings.NewReader(body))
	}
	for k, v := range pathValues {
		r.SetPathValue(k, v)
	}
	return r.WithContext(context.WithValue(r.Context(), "user_id", userID))
}

func TestGuestLinkHandler_CreateLink(t *testing.T) {
	h, uc := newGuestLinkHandler(t)
	channelID, userID := uuid.New(), uuid.New()
	created := &domain.GuestLinkCreated{ID: uuid.New(), Secret: "s3cr3t", ExpiresAt: time.Now().Add(time.Hour)}
	uc.On("CreateLink", channelID, userID).Return(created, nil)

	rec := httptest.NewRecorder()
	h.CreateLink(rec, accountRequest(http.MethodPost, "/api/v1/channels/x/guest-links", "", userID,
		map[string]string{"channel_id": channelID.String()}))

	require.Equal(t, http.StatusCreated, rec.Code)
	var body map[string]any
	require.NoError(t, json.Unmarshal(rec.Body.Bytes(), &body))
	assert.Equal(t, "s3cr3t", body["secret"])
	assert.Equal(t, created.ID.String(), body["id"])
}

func TestGuestLinkHandler_CreateLinkInvalidChannel(t *testing.T) {
	h, uc := newGuestLinkHandler(t)
	rec := httptest.NewRecorder()
	h.CreateLink(rec, accountRequest(http.MethodPost, "/x", "", uuid.New(), map[string]string{"channel_id": "nope"}))

	assert.Equal(t, http.StatusBadRequest, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"invalid_channel_id"`)
	uc.AssertNotCalled(t, "CreateLink", mock.Anything, mock.Anything)
}

func TestGuestLinkHandler_CreateLinkNotInCall(t *testing.T) {
	h, uc := newGuestLinkHandler(t)
	channelID, userID := uuid.New(), uuid.New()
	uc.On("CreateLink", channelID, userID).Return(nil, domain.ErrNotInCall)

	rec := httptest.NewRecorder()
	h.CreateLink(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"channel_id": channelID.String()}))

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"not_in_call"`)
}

func TestGuestLinkHandler_ListLinks(t *testing.T) {
	h, uc := newGuestLinkHandler(t)
	channelID, userID := uuid.New(), uuid.New()
	uc.On("ListCallGuests", channelID, userID).
		Return(&domain.GuestCallState{Links: []*domain.GuestLink{}, Guests: []*domain.CallGuest{}}, nil)

	rec := httptest.NewRecorder()
	h.ListLinks(rec, accountRequest(http.MethodGet, "/x", "", userID, map[string]string{"channel_id": channelID.String()}))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Contains(t, rec.Body.String(), `"links":[]`)
	assert.Contains(t, rec.Body.String(), `"guests":[]`)
}

func TestGuestLinkHandler_RevokeAndDecisions(t *testing.T) {
	linkID, guestID, userID := uuid.New(), uuid.New(), uuid.New()

	t.Run("revoke", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("RevokeLink", linkID, userID).Return(nil)
		rec := httptest.NewRecorder()
		h.RevokeLink(rec, accountRequest(http.MethodDelete, "/x", "", userID, map[string]string{"id": linkID.String()}))
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("revoke with a broken id", func(t *testing.T) {
		h, _ := newGuestLinkHandler(t)
		rec := httptest.NewRecorder()
		h.RevokeLink(rec, accountRequest(http.MethodDelete, "/x", "", userID, map[string]string{"id": "zzz"}))
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		assert.Contains(t, rec.Body.String(), `"code":"invalid_guest_link_id"`)
	})

	t.Run("admit", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Admit", guestID, userID).Return(nil)
		rec := httptest.NewRecorder()
		h.Admit(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("admit a guest someone already decided", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Admit", guestID, userID).Return(domain.ErrGuestAlreadyDecided)
		rec := httptest.NewRecorder()
		h.Admit(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusConflict, rec.Code)
		assert.Contains(t, rec.Body.String(), `"code":"guest_already_decided"`)
	})

	t.Run("reject", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Reject", guestID, userID).Return(nil)
		rec := httptest.NewRecorder()
		h.Reject(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusNoContent, rec.Code)
	})

	t.Run("kick without a body means no ban", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Kick", guestID, userID, false).Return(nil)
		rec := httptest.NewRecorder()
		h.Kick(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusNoContent, rec.Code)
		uc.AssertExpectations(t)
	})

	t.Run("kick with ban", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Kick", guestID, userID, true).Return(nil)
		rec := httptest.NewRecorder()
		h.Kick(rec, accountRequest(http.MethodPost, "/x", `{"ban":true}`, userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusNoContent, rec.Code)
		uc.AssertExpectations(t)
	})

	t.Run("kick a guest who is already gone", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("Kick", guestID, userID, false).Return(domain.ErrGuestNotActive)
		rec := httptest.NewRecorder()
		h.Kick(rec, accountRequest(http.MethodPost, "/x", "", userID, map[string]string{"id": guestID.String()}))
		assert.Equal(t, http.StatusConflict, rec.Code)
		assert.Contains(t, rec.Body.String(), `"code":"guest_not_active"`)
	})
}

func TestGuestLinkHandler_SetServerGuestLinks(t *testing.T) {
	serverID, userID := uuid.New(), uuid.New()

	t.Run("switch off", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("SetServerGuestLinks", serverID, userID, false).
			Return(&domain.Server{ID: serverID, Name: "s", GuestLinksEnabled: false}, nil)
		rec := httptest.NewRecorder()
		h.SetServerGuestLinks(rec, accountRequest(http.MethodPut, "/x", `{"enabled":false}`, userID,
			map[string]string{"id": serverID.String()}))
		require.Equal(t, http.StatusOK, rec.Code)
		assert.Contains(t, rec.Body.String(), `"guest_links_enabled":false`)
	})

	t.Run("missing enabled field", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		rec := httptest.NewRecorder()
		h.SetServerGuestLinks(rec, accountRequest(http.MethodPut, "/x", `{}`, userID,
			map[string]string{"id": serverID.String()}))
		assert.Equal(t, http.StatusBadRequest, rec.Code)
		uc.AssertNotCalled(t, "SetServerGuestLinks", mock.Anything, mock.Anything, mock.Anything)
	})

	t.Run("no permission", func(t *testing.T) {
		h, uc := newGuestLinkHandler(t)
		uc.On("SetServerGuestLinks", serverID, userID, true).Return(nil, domain.ErrForbidden)
		rec := httptest.NewRecorder()
		h.SetServerGuestLinks(rec, accountRequest(http.MethodPut, "/x", `{"enabled":true}`, userID,
			map[string]string{"id": serverID.String()}))
		assert.Equal(t, http.StatusForbidden, rec.Code)
	})
}

// The whole error table of the spec, in one place.
func TestWriteGuestError(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	cases := []struct {
		err    error
		status int
		code   string
	}{
		{domain.ErrGuestLinkInvalid, http.StatusNotFound, "guest_link_invalid"},
		{domain.ErrGuestLinkExpired, http.StatusGone, "guest_link_expired"},
		{domain.ErrGuestLinkRevoked, http.StatusGone, "guest_link_revoked"},
		{domain.ErrGuestCallEnded, http.StatusGone, "guest_call_ended"},
		{domain.ErrGuestLinkClosed, http.StatusGone, "guest_link_closed"},
		{domain.ErrGuestLinksDisabled, http.StatusForbidden, "guest_links_disabled"},
		{domain.ErrGuestBanned, http.StatusForbidden, "guest_banned"},
		{domain.ErrGuestCallFull, http.StatusConflict, "guest_call_full"},
		{domain.ErrGuestLobbyFull, http.StatusConflict, "guest_lobby_full"},
		{domain.ErrGuestLinkExhausted, http.StatusConflict, "guest_link_exhausted"},
		{domain.ErrInvalidGuestName, http.StatusBadRequest, "invalid_guest_name"},
		{domain.ErrReservedGuestName, http.StatusBadRequest, "reserved_guest_name"},
		{domain.ErrGuestSessionInvalid, http.StatusUnauthorized, "guest_session_invalid"},
		{domain.ErrGuestNotAdmitted, http.StatusForbidden, "guest_not_admitted"},
		{domain.ErrNotInCall, http.StatusForbidden, "not_in_call"},
		{domain.ErrCallNotActive, http.StatusConflict, "call_not_active"},
		{domain.ErrTooManyGuestLinks, http.StatusConflict, "too_many_links"},
		{domain.ErrGuestAlreadyDecided, http.StatusConflict, "guest_already_decided"},
		{domain.ErrGuestLinkNotFound, http.StatusNotFound, "guest_link_not_found"},
		{domain.ErrGuestNotFound, http.StatusNotFound, "guest_not_found"},
		{domain.ErrGuestNotActive, http.StatusConflict, "guest_not_active"},
		{domain.ErrGuestMessageTooLong, http.StatusBadRequest, "guest_message_too_long"},
		{domain.ErrGuestMentionForbidden, http.StatusBadRequest, "guest_mention_forbidden"},
		{domain.ErrMessageEmpty, http.StatusBadRequest, "message_content_required"},
		{domain.ErrForbidden, http.StatusForbidden, "forbidden"},
		{domain.ErrChannelForbidden, http.StatusForbidden, "channel_forbidden"},
		{domain.ErrChannelNotFound, http.StatusNotFound, "channel_not_found"},
		{domain.ErrServerNotFound, http.StatusNotFound, "server_not_found"},
		{domain.ErrMessageNotFound, http.StatusNotFound, "message_not_found"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		writeGuestError(rec, httptest.NewRequest(http.MethodGet, "/", nil), log, c.err)
		assert.Equal(t, c.status, rec.Code, c.code)
		assert.Contains(t, rec.Body.String(), `"code":"`+c.code+`"`)
	}

	rec := httptest.NewRecorder()
	writeGuestError(rec, httptest.NewRequest(http.MethodGet, "/", nil), log, io.ErrUnexpectedEOF)
	assert.Equal(t, http.StatusInternalServerError, rec.Code)
	assert.Contains(t, rec.Body.String(), `"code":"internal_error"`)
}
