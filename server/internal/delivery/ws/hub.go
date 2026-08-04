package ws

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	clients            map[uuid.UUID]*Client
	register           chan *Client
	unregister         chan *Client
	broadcast          chan *Message
	voiceChannels      map[uuid.UUID]map[uuid.UUID]struct{} // channelID → set(userID)
	clientVoiceChannel map[uuid.UUID]uuid.UUID              // userID → channelID
	mu                 sync.RWMutex
	log                *slog.Logger
	// voiceAudienceResolver, when set, restricts BroadcastVoiceParticipants
	// to the returned user IDs for private voice channels (nil result =
	// broadcast to everyone). Injected from main.go after the usecase layer
	// is constructed — this package has no DB/domain dependency itself.
	voiceAudienceResolver func(channelID uuid.UUID) ([]uuid.UUID, error)
}

type Message struct {
	Type    string          `json:"type"`
	Payload json.RawMessage `json:"payload"`
}

type Client struct {
	UserID           uuid.UUID
	CurrentChannelID *uuid.UUID
	Conn             *websocket.Conn
	Send             chan []byte
	Hub              *Hub
}

func NewHub(log *slog.Logger) *Hub {
	return &Hub{
		clients:            make(map[uuid.UUID]*Client),
		register:           make(chan *Client),
		unregister:         make(chan *Client),
		broadcast:          make(chan *Message),
		voiceChannels:      make(map[uuid.UUID]map[uuid.UUID]struct{}),
		clientVoiceChannel: make(map[uuid.UUID]uuid.UUID),
		log:                log,
	}
}

func (h *Hub) Run() {
	for {
		select {
		case client := <-h.register:
			h.mu.Lock()
			if old, ok := h.clients[client.UserID]; ok && old != client {
				// Reconnect: the new connection supersedes the old one. Kill
				// the replaced connection now so its pumps exit instead of
				// lingering until pongWait. Closing under the write lock is
				// safe — every sender (SendToUser, notify*, SendToChannel)
				// holds at least the read lock while sending.
				close(old.Send)
				if old.Conn != nil {
					old.Conn.Close()
				}
			}
			h.clients[client.UserID] = client
			currentIDs := h.getOnlineUserIDsLocked()
			voiceState := h.voiceStateLocked()
			h.mu.Unlock()
			h.log.Info("client connected", "user_id", client.UserID, "total", len(h.clients))

			// Send online users list and current voice-channel roster to the newly connected client
			h.sendOnlineUsersToClient(client, currentIDs)
			h.sendVoiceStateToClient(client, voiceState)

			// Notify all other clients about the new online user
			h.notifyAllOnlineUsers(client.UserID.String())

		case client := <-h.unregister:
			h.mu.Lock()
			cur, ok := h.clients[client.UserID]
			isCurrent := ok && cur == client
			var currentIDs []string
			if isCurrent {
				delete(h.clients, client.UserID)
				close(client.Send)
				currentIDs = h.getOnlineUserIDsLocked()
			}
			h.mu.Unlock()

			if !isCurrent {
				// A stale connection of a user who already reconnected: the
				// register case closed its Send when it was replaced. Removing
				// the map entry or the voice presence here would kick the
				// user's LIVE connection instead of the dead one.
				continue
			}

			h.log.Info("client disconnected", "user_id", client.UserID, "total", len(h.clients))

			// Notify all clients about the disconnected user
			h.notifyAllOnlineUsersAfterDisconnect(client.UserID.String(), currentIDs)

			// Clean up voice-channel presence left behind by an unexpected disconnect.
			// Dispatched via goroutine: BroadcastVoiceParticipants sends on h.broadcast,
			// which only Run()'s own select loop drains — calling it synchronously here
			// would deadlock Run() against itself.
			if channelID, participants, ok := h.LeaveVoiceChannel(client.UserID); ok {
				go h.BroadcastVoiceParticipants(channelID, participants)
			}

		case message := <-h.broadcast:
			// Write lock, not RLock: evicting a slow client mutates the map
			// (concurrent map write) and closes its Send, which must never
			// happen while a SendToUser holding RLock is sending into it —
			// that combination panics with "send on closed channel" and takes
			// down the whole API process.
			data := mustMarshal(message)
			h.mu.Lock()
			for _, client := range h.clients {
				select {
				case client.Send <- data:
				default:
					close(client.Send)
					if client.Conn != nil {
						client.Conn.Close()
					}
					delete(h.clients, client.UserID)
				}
			}
			h.mu.Unlock()
		}
	}
}

func (h *Hub) getOnlineUserIDsLocked() []string {
	ids := make([]string, 0, len(h.clients))
	for id := range h.clients {
		ids = append(ids, id.String())
	}
	return ids
}

func (h *Hub) sendOnlineUsersToClient(client *Client, userIDs []string) {
	payload := mustMarshal(map[string]interface{}{
		"user_ids": userIDs,
	})
	select {
	case client.Send <- mustMarshal(map[string]interface{}{
		"type":    "online_users",
		"payload": json.RawMessage(payload),
	}):
	default:
	}
}

func (h *Hub) sendVoiceStateToClient(client *Client, state map[uuid.UUID][]uuid.UUID) {
	channels := make(map[string][]string, len(state))
	for channelID, userIDs := range state {
		ids := make([]string, len(userIDs))
		for i, id := range userIDs {
			ids[i] = id.String()
		}
		channels[channelID.String()] = ids
	}
	payload := mustMarshal(map[string]interface{}{
		"channels": channels,
	})
	select {
	case client.Send <- mustMarshal(map[string]interface{}{
		"type":    "voice_state",
		"payload": json.RawMessage(payload),
	}):
	default:
	}
}

// SetVoiceAudienceResolver installs a callback used by BroadcastVoiceParticipants
// to restrict delivery for private voice channels. nil (the zero value, as in
// any Hub built by a bare NewHub) keeps the pre-existing "broadcast to
// everyone" behavior.
func (h *Hub) SetVoiceAudienceResolver(resolver func(channelID uuid.UUID) ([]uuid.UUID, error)) {
	h.voiceAudienceResolver = resolver
}

// BroadcastVoiceParticipants notifies clients about the current participant
// list for a voice channel. When a voiceAudienceResolver is set and returns
// a non-nil audience for channelID (a private channel), delivery is
// restricted to those user IDs; otherwise every connected client gets it —
// the pre-existing behavior, exercised by both explicit join/leave events
// and Run()'s automatic disconnect cleanup.
func (h *Hub) BroadcastVoiceParticipants(channelID uuid.UUID, participants []uuid.UUID) {
	ids := make([]string, len(participants))
	for i, id := range participants {
		ids[i] = id.String()
	}
	msg := &Message{
		Type: "voice_participants",
		Payload: mustMarshal(map[string]interface{}{
			"channel_id": channelID.String(),
			"user_ids":   ids,
		}),
	}

	if h.voiceAudienceResolver != nil {
		audience, err := h.voiceAudienceResolver(channelID)
		if err != nil {
			h.log.Warn("failed to resolve voice audience, broadcasting to everyone", "channel_id", channelID, "error", err)
		} else if audience != nil {
			h.SendToUsers(audience, msg)
			return
		}
	}
	h.BroadcastMessage(msg)
}

// SendToUsers delivers message to each connected client whose UserID is in
// userIDs — used for private-channel realtime events that must not reach
// every connected client the way BroadcastMessage does.
func (h *Hub) SendToUsers(userIDs []uuid.UUID, message *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	data := mustMarshal(message)
	for _, userID := range userIDs {
		client, ok := h.clients[userID]
		if !ok {
			continue
		}
		select {
		case client.Send <- data:
		default:
			h.log.Warn("SendToUsers: send channel full, dropping message", "user_id", userID, "msg_type", message.Type)
		}
	}
}

// BroadcastUserUpdate notifies all connected clients that userID's profile
// changed (currently only the avatar). avatarURL is nil when the avatar was
// removed, which marshals to JSON null.
func (h *Hub) BroadcastUserUpdate(userID uuid.UUID, avatarURL *string) {
	h.BroadcastMessage(&Message{
		Type: "user_updated",
		Payload: mustMarshal(map[string]interface{}{
			"id":         userID.String(),
			"avatar_url": avatarURL,
		}),
	})
}

func (h *Hub) notifyAllOnlineUsers(newUserID string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.clients {
		select {
		case client.Send <- mustMarshal(map[string]interface{}{
			"type":    "user_joined",
			"payload": mustMarshal(map[string]interface{}{"user_id": newUserID}),
		}):
		default:
		}
	}
}

func (h *Hub) notifyAllOnlineUsersAfterDisconnect(disconnectedUserID string, remainingIDs []string) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	for _, client := range h.clients {
		select {
		case client.Send <- mustMarshal(map[string]interface{}{
			"type": "user_left",
			"payload": mustMarshal(map[string]interface{}{
				"user_id":  disconnectedUserID,
				"user_ids": remainingIDs,
			}),
		}):
		default:
		}
	}
}

func (h *Hub) SendToUser(userID uuid.UUID, message *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	client, ok := h.clients[userID]
	if !ok {
		h.log.Warn("SendToUser: user not connected", "user_id", userID, "msg_type", message.Type)
		return
	}

	select {
	case client.Send <- mustMarshal(message):
	default:
		h.log.Warn("SendToUser: send channel full, dropping message",
			"user_id", userID,
			"msg_type", message.Type,
		)
	}
}

func (h *Hub) GetOnlineUsers() []uuid.UUID {
	h.mu.RLock()
	defer h.mu.RUnlock()

	userIDs := make([]uuid.UUID, 0, len(h.clients))
	for userID := range h.clients {
		userIDs = append(userIDs, userID)
	}
	return userIDs
}

func (h *Hub) IsOnline(userID uuid.UUID) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	_, ok := h.clients[userID]
	return ok
}

// IsCurrentClient reports whether c is the connection currently registered for
// its user. False once a reconnect has replaced it — the stale connection's
// teardown must not apply user-level side effects (offline status, voice
// presence) that belong to the live connection.
func (h *Hub) IsCurrentClient(c *Client) bool {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.clients[c.UserID] == c
}

// JoinVoiceChannel registers userID as present in the given voice channel,
// moving it out of any previous voice channel first. Returns the updated
// participant list for channelID.
func (h *Hub) JoinVoiceChannel(userID, channelID uuid.UUID) []uuid.UUID {
	h.mu.Lock()
	defer h.mu.Unlock()

	if prevChannelID, ok := h.clientVoiceChannel[userID]; ok {
		delete(h.voiceChannels[prevChannelID], userID)
		if len(h.voiceChannels[prevChannelID]) == 0 {
			delete(h.voiceChannels, prevChannelID)
		}
	}

	if h.voiceChannels[channelID] == nil {
		h.voiceChannels[channelID] = make(map[uuid.UUID]struct{})
	}
	h.voiceChannels[channelID][userID] = struct{}{}
	h.clientVoiceChannel[userID] = channelID

	return h.voiceParticipantsLocked(channelID)
}

// LeaveVoiceChannel removes userID from whatever voice channel it is
// currently in. ok is false if the user was not in any voice channel —
// safe to call repeatedly (e.g. voluntary leave followed by SFU teardown).
func (h *Hub) LeaveVoiceChannel(userID uuid.UUID) (channelID uuid.UUID, participants []uuid.UUID, ok bool) {
	h.mu.Lock()
	defer h.mu.Unlock()

	channelID, ok = h.clientVoiceChannel[userID]
	if !ok {
		return uuid.Nil, nil, false
	}

	delete(h.clientVoiceChannel, userID)
	delete(h.voiceChannels[channelID], userID)
	if len(h.voiceChannels[channelID]) == 0 {
		delete(h.voiceChannels, channelID)
	}

	return channelID, h.voiceParticipantsLocked(channelID), true
}

// GetVoiceState returns a snapshot of all non-empty voice channels and their participants.
func (h *Hub) GetVoiceState() map[uuid.UUID][]uuid.UUID {
	h.mu.RLock()
	defer h.mu.RUnlock()
	return h.voiceStateLocked()
}

// voiceParticipantsLocked returns the participant list for channelID.
// Caller must hold h.mu.
func (h *Hub) voiceParticipantsLocked(channelID uuid.UUID) []uuid.UUID {
	set := h.voiceChannels[channelID]
	ids := make([]uuid.UUID, 0, len(set))
	for id := range set {
		ids = append(ids, id)
	}
	return ids
}

// voiceStateLocked returns a snapshot of all non-empty voice channels.
// Caller must hold h.mu (read or write lock).
func (h *Hub) voiceStateLocked() map[uuid.UUID][]uuid.UUID {
	state := make(map[uuid.UUID][]uuid.UUID, len(h.voiceChannels))
	for channelID := range h.voiceChannels {
		state[channelID] = h.voiceParticipantsLocked(channelID)
	}
	return state
}

func (h *Hub) RegisterClient(client *Client) {
	h.register <- client
}

func (h *Hub) UnregisterClient(client *Client) {
	h.unregister <- client
}

func (h *Hub) BroadcastMessage(message *Message) {
	h.broadcast <- message
}

// SetClientChannel updates the channel a client is currently viewing.
func (h *Hub) SetClientChannel(userID uuid.UUID, channelID *uuid.UUID) {
	h.mu.Lock()
	defer h.mu.Unlock()
	if client, ok := h.clients[userID]; ok {
		client.CurrentChannelID = channelID
	}
}

// SendToChannel delivers a message to all clients currently viewing the given channel.
func (h *Hub) SendToChannel(channelID uuid.UUID, message *Message) {
	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		if client.CurrentChannelID != nil && *client.CurrentChannelID == channelID {
			select {
			case client.Send <- mustMarshal(message):
			default:
				h.log.Warn("failed to send channel message to user", "user_id", client.UserID)
			}
		}
	}
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}
