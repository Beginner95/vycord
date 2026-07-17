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
			h.clients[client.UserID] = client
			currentIDs := h.getOnlineUserIDsLocked()
			h.mu.Unlock()
			h.log.Info("client connected", "user_id", client.UserID, "total", len(h.clients))

			// Send online users list to the newly connected client
			h.sendOnlineUsersToClient(client, currentIDs)

			// Notify all other clients about the new online user
			h.notifyAllOnlineUsers(client.UserID.String())

		case client := <-h.unregister:
			h.mu.Lock()
			if _, ok := h.clients[client.UserID]; ok {
				delete(h.clients, client.UserID)
				close(client.Send)
				currentIDs := h.getOnlineUserIDsLocked()
				h.mu.Unlock()
				h.log.Info("client disconnected", "user_id", client.UserID, "total", len(h.clients))

				// Notify all clients about the disconnected user
				h.notifyAllOnlineUsersAfterDisconnect(client.UserID.String(), currentIDs)
			} else {
				h.mu.Unlock()
			}

		case message := <-h.broadcast:
			h.mu.RLock()
			for _, client := range h.clients {
				select {
				case client.Send <- mustMarshal(message):
				default:
					close(client.Send)
					delete(h.clients, client.UserID)
				}
			}
			h.mu.RUnlock()
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
