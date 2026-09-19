package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

// guestErrorMappings — таблица «доменная ошибка → HTTP» из спеки, раздел 3
// «Коды ошибок». Различать причины отказа безопасно: чтобы получить любую из
// них, нужен настоящий 256-битный секрет.
var guestErrorMappings = []struct {
	target  error
	status  int
	code    string
	message string
}{
	{domain.ErrGuestLinkInvalid, http.StatusNotFound, httperr.CodeGuestLinkInvalid, "guest link invalid"},
	{domain.ErrGuestLinkExpired, http.StatusGone, httperr.CodeGuestLinkExpired, "guest link expired"},
	{domain.ErrGuestLinkRevoked, http.StatusGone, httperr.CodeGuestLinkRevoked, "guest link revoked"},
	{domain.ErrGuestCallEnded, http.StatusGone, httperr.CodeGuestCallEnded, "call ended"},
	{domain.ErrGuestLinkClosed, http.StatusGone, httperr.CodeGuestLinkClosed, "guest link closed"},
	{domain.ErrGuestLinksDisabled, http.StatusForbidden, httperr.CodeGuestLinksDisabled, "guest links are disabled"},
	{domain.ErrGuestBanned, http.StatusForbidden, httperr.CodeGuestBanned, "guest banned"},
	{domain.ErrGuestCallFull, http.StatusConflict, httperr.CodeGuestCallFull, "call guest limit reached"},
	{domain.ErrGuestLobbyFull, http.StatusConflict, httperr.CodeGuestLobbyFull, "guest lobby is full"},
	{domain.ErrGuestLinkExhausted, http.StatusConflict, httperr.CodeGuestLinkExhausted, "guest link exhausted"},
	{domain.ErrInvalidGuestName, http.StatusBadRequest, httperr.CodeInvalidGuestName, "invalid guest name"},
	{domain.ErrReservedGuestName, http.StatusBadRequest, httperr.CodeReservedGuestName, "reserved guest name"},
	{domain.ErrGuestSessionInvalid, http.StatusUnauthorized, httperr.CodeGuestSessionInvalid, "guest session invalid"},
	{domain.ErrGuestNotAdmitted, http.StatusForbidden, httperr.CodeGuestNotAdmitted, "guest is not admitted"},
	{domain.ErrNotInCall, http.StatusForbidden, httperr.CodeNotInCall, "you are not in the call"},
	{domain.ErrCallNotActive, http.StatusConflict, httperr.CodeCallNotActive, "no active call in this channel"},
	{domain.ErrTooManyGuestLinks, http.StatusConflict, httperr.CodeTooManyGuestLinks, "too many active guest links"},
	{domain.ErrGuestAlreadyDecided, http.StatusConflict, httperr.CodeGuestAlreadyDecided, "guest already decided"},
	{domain.ErrGuestLinkNotFound, http.StatusNotFound, httperr.CodeGuestLinkNotFound, "guest link not found"},
	{domain.ErrGuestNotFound, http.StatusNotFound, httperr.CodeGuestNotFound, "guest not found"},
	{domain.ErrGuestNotActive, http.StatusConflict, httperr.CodeGuestNotActive, "guest is no longer active"},
	{domain.ErrGuestMessageTooLong, http.StatusBadRequest, httperr.CodeGuestMessageTooLong, "message is too long"},
	{domain.ErrGuestMentionForbidden, http.StatusBadRequest, httperr.CodeGuestMentionForbidden, "guests cannot mention"},
	{domain.ErrMessageEmpty, http.StatusBadRequest, httperr.CodeMessageEmpty, "message content is required"},
	{domain.ErrChannelForbidden, http.StatusForbidden, httperr.CodeChannelForbidden, "channel access denied"},
	{domain.ErrChannelNotFound, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found"},
	{domain.ErrServerNotFound, http.StatusNotFound, httperr.CodeServerNotFound, "server not found"},
	{domain.ErrMessageNotFound, http.StatusNotFound, httperr.CodeMessageNotFound, "message not found"},
	// ErrForbidden идёт последним: он самый общий.
	{domain.ErrForbidden, http.StatusForbidden, httperr.CodeForbidden, "access denied"},
}

func writeGuestError(w http.ResponseWriter, r *http.Request, log *slog.Logger, err error) {
	for _, m := range guestErrorMappings {
		if errors.Is(err, m.target) {
			httperr.Write(w, m.status, m.code, m.message)
			return
		}
	}
	log.Error("guest request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
	httperr.Write(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
}

func writeGuestJSON(w http.ResponseWriter, status int, v any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(v)
}
