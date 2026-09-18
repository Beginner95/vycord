// Package guestevents is the real implementation of domain.GuestEvents: it
// turns guest lifecycle transitions into hub events for the call's members,
// gateway messages for the guest, and eviction calls to the SFU. It is the only
// place that knows all three exist.
package guestevents

import (
	"context"
	"encoding/json"
	"log/slog"
	"time"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/delivery/guestws"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

// kickTimeout bounds one /kick call to the SFU: eviction is best-effort from
// the API's point of view — the guest's session is already dead in the database.
const kickTimeout = 5 * time.Second

type HubPort interface {
	SendToUsers(userIDs []uuid.UUID, message *ws.Message)
	VoiceParticipants(channelID uuid.UUID) []uuid.UUID
	VoiceChannelOf(userID uuid.UUID) (uuid.UUID, bool)
}

type GatewayPort interface {
	Send(guestID uuid.UUID, msg *guestws.Message)
	Broadcast(channelID uuid.UUID, msg *guestws.Message)
	CloseGuest(guestID uuid.UUID, msg *guestws.Message)
	Connected() map[uuid.UUID]uuid.UUID
}

type SFUPort interface {
	KickGuest(ctx context.Context, roomID uuid.UUID, identity string) error
}

type GuestLister interface {
	OpenCallMessageID(channelID uuid.UUID) (uuid.UUID, error)
	ListCallState(callMessageID uuid.UUID) (*domain.GuestCallState, error)
}

type UserLookup interface {
	GetByID(id uuid.UUID) (*domain.User, error)
}

type Events struct {
	hub    HubPort
	gw     GatewayPort
	sfu    SFUPort
	guests GuestLister
	users  UserLookup
	log    *slog.Logger
}

func New(hub HubPort, gw GatewayPort, sfu SFUPort, guests GuestLister, users UserLookup, log *slog.Logger) *Events {
	return &Events{hub: hub, gw: gw, sfu: sfu, guests: guests, users: users, log: log}
}

// --- domain.GuestEvents ---

func (e *Events) LinksChanged(channelID uuid.UUID) {
	e.notifyMembers(channelID, "guest_links_changed", map[string]string{"channel_id": channelID.String()})
	e.syncChannel(channelID)
}

func (e *Events) LobbyRequested(g *domain.CallGuest, linkCreatedBy *uuid.UUID) {
	payload := map[string]any{
		"channel_id":   g.ChannelID.String(),
		"guest_id":     g.ID.String(),
		"display_name": g.DisplayName,
		"link_id":      g.LinkID.String(),
	}
	if linkCreatedBy != nil {
		payload["link_created_by"] = linkCreatedBy.String()
	}
	e.notifyMembers(g.ChannelID, "guest_lobby_request", payload)
	e.gw.Send(g.ID, guestws.Marshal("lobby_waiting", nil))
}

func (e *Events) LobbyResolved(g *domain.CallGuest, byUserID *uuid.UUID) {
	payload := map[string]any{
		"channel_id": g.ChannelID.String(),
		"guest_id":   g.ID.String(),
		"result":     string(g.Status),
	}
	if byUserID != nil {
		payload["by_user_id"] = byUserID.String()
	}
	e.notifyMembers(g.ChannelID, "guest_lobby_resolved", payload)

	if g.Status == domain.GuestStatusAdmitted {
		e.gw.Send(g.ID, guestws.Marshal("admitted", map[string]string{"room_id": g.ChannelID.String()}))
		e.gw.Send(g.ID, e.Participants(g.ChannelID))
	}
}

func (e *Events) GuestsEnded(guests []*domain.CallGuest) {
	channels := make(map[uuid.UUID]struct{}, len(guests))
	for _, g := range guests {
		channels[g.ChannelID] = struct{}{}

		if msg := endedMessage(g.Status); msg != nil {
			e.gw.CloseGuest(g.ID, msg)
		}
		// Только тот, кого впускали, мог оказаться в SFU.
		if g.AdmittedAt != nil {
			e.kickFromSFU(g)
		}
	}
	for channelID := range channels {
		e.syncChannel(channelID)
		e.notifyMembers(channelID, "guest_links_changed", map[string]string{"channel_id": channelID.String()})
	}
}

// endedMessage — что именно увидит гость. Для «ушёл сам» сообщения нет: он и
// так закрыл вкладку.
func endedMessage(status domain.GuestStatus) *guestws.Message {
	switch status {
	case domain.GuestStatusKicked:
		return guestws.Marshal("kicked", map[string]string{"reason": "kicked"})
	case domain.GuestStatusRevoked:
		return guestws.Marshal("kicked", map[string]string{"reason": "link_revoked"})
	case domain.GuestStatusCallEnded:
		return guestws.Marshal("call_ended", nil)
	case domain.GuestStatusRejected:
		return guestws.Marshal("rejected", nil)
	case domain.GuestStatusLobbyTimeout:
		return guestws.Marshal("lobby_timeout", nil)
	default:
		return nil
	}
}

func (e *Events) kickFromSFU(g *domain.CallGuest) {
	identity := authtoken.GuestIdentity(g.ID)
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), kickTimeout)
		defer cancel()
		if err := e.sfu.KickGuest(ctx, g.ChannelID, identity); err != nil {
			// Не фатально: сессия гостя уже мертва в БД, нового room-токена он
			// не получит, а SFU выкинет его по своим таймаутам.
			e.log.Warn("guest kick in SFU failed", "guest_id", g.ID, "channel_id", g.ChannelID, "error", err)
		}
	}()
}

// --- guest-side realtime (handler.GuestRealtime) ---

// RelayGuestSignal forwards a guest's own mic/screen/quality event to the
// call's members. The identity is stamped from the session: a guest cannot
// claim to be someone else by putting a user_id in the payload.
func (e *Events) RelayGuestSignal(guest *domain.GuestContext, msgType string, payload json.RawMessage) {
	out := map[string]any{"user_id": authtoken.GuestIdentity(guest.Guest.ID)}
	if len(payload) > 0 {
		var fields map[string]any
		if err := json.Unmarshal(payload, &fields); err == nil {
			for k, v := range fields {
				if k == "user_id" {
					continue
				}
				out[k] = v
			}
		}
	}
	e.notifyMembers(guest.Guest.ChannelID, msgType, out)
	e.gw.Broadcast(guest.Guest.ChannelID, guestws.Marshal(msgType, out))
}

// Participants builds the roster a guest sees: the call's members (name and
// avatar only) and the admitted guests. Nothing about the server, its member
// list or the channel history.
func (e *Events) Participants(channelID uuid.UUID) *guestws.Message {
	users := make([]map[string]any, 0)
	for _, userID := range e.hub.VoiceParticipants(channelID) {
		entry := map[string]any{"user_id": userID.String()}
		if user, err := e.users.GetByID(userID); err == nil && user != nil {
			entry["username"] = user.Username
			if user.AvatarURL != nil {
				entry["avatar_url"] = *user.AvatarURL
			}
		}
		users = append(users, entry)
	}

	guests := make([]map[string]any, 0)
	for _, g := range e.admittedGuests(channelID) {
		guests = append(guests, map[string]any{
			"id":           authtoken.GuestIdentity(g.ID),
			"guest_id":     g.ID.String(),
			"display_name": g.DisplayName,
		})
	}

	return guestws.Marshal("participants", map[string]any{"users": users, "guests": guests})
}

// MirrorFromUser forwards a member's event to the guests of the call that
// member is in — and only that call.
func (e *Events) MirrorFromUser(userID uuid.UUID, msgType string, payload json.RawMessage) {
	channelID, ok := e.hub.VoiceChannelOf(userID)
	if !ok {
		return
	}
	e.gw.Broadcast(channelID, &guestws.Message{Type: msgType, Payload: payload})
}

// --- chat fan-out ---

func (e *Events) ChatMessage(channelID uuid.UUID, msg *domain.Message, author *domain.User) {
	e.gw.Broadcast(channelID, guestws.Marshal("chat_message", guestChatMessage(msg, author)))
}

func (e *Events) MessageDeleted(channelID, messageID uuid.UUID) {
	e.gw.Broadcast(channelID, guestws.Marshal("message_delete", map[string]string{
		"id":         messageID.String(),
		"channel_id": channelID.String(),
	}))
}

func guestChatMessage(msg *domain.Message, author *domain.User) domain.GuestChatMessage {
	out := domain.GuestChatMessage{ID: msg.ID, Content: msg.Content, CreatedAt: msg.CreatedAt}
	switch {
	case msg.GuestID != nil:
		out.Author = domain.GuestChatAuthor{Kind: "guest", GuestID: msg.GuestID}
		if msg.Guest != nil {
			out.Author.DisplayName = msg.Guest.DisplayName
		}
	case author != nil:
		out.Author = domain.GuestChatAuthor{
			Kind: "user", UserID: &author.ID, Username: author.Username, AvatarURL: author.AvatarURL,
		}
	default:
		out.Author = domain.GuestChatAuthor{Kind: "user", UserID: msg.UserID}
	}
	return out
}

// --- helpers ---

func (e *Events) notifyMembers(channelID uuid.UUID, msgType string, payload any) {
	participants := e.hub.VoiceParticipants(channelID)
	if len(participants) == 0 {
		return
	}
	raw, err := json.Marshal(payload)
	if err != nil {
		e.log.Error("guest events: failed to encode payload", "type", msgType, "error", err)
		return
	}
	e.hub.SendToUsers(participants, &ws.Message{Type: msgType, Payload: raw})
}

// syncChannel refreshes both sides' view of who is in the call: the guests get
// a participants snapshot, the members get the guest roster.
func (e *Events) syncChannel(channelID uuid.UUID) {
	e.gw.Broadcast(channelID, e.Participants(channelID))

	guests := make([]map[string]string, 0)
	for _, g := range e.admittedGuests(channelID) {
		guests = append(guests, map[string]string{
			"id":           authtoken.GuestIdentity(g.ID),
			"display_name": g.DisplayName,
		})
	}
	e.notifyMembers(channelID, "guest_participants", map[string]any{
		"channel_id": channelID.String(),
		"guests":     guests,
	})
}

func (e *Events) admittedGuests(channelID uuid.UUID) []*domain.CallGuest {
	callID, err := e.guests.OpenCallMessageID(channelID)
	if err != nil {
		return nil
	}
	state, err := e.guests.ListCallState(callID)
	if err != nil || state == nil {
		return nil
	}
	out := make([]*domain.CallGuest, 0, len(state.Guests))
	for _, g := range state.Guests {
		if g.Status == domain.GuestStatusAdmitted {
			out = append(out, g)
		}
	}
	return out
}

var _ domain.GuestEvents = (*Events)(nil)
