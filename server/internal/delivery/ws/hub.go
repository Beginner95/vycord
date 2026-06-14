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
	mu                 sync.RWMutex
	log                *slog.Logger
	voiceChannels      map[uuid.UUID]map[uuid.UUID]struct{} // channelID → set of userIDs
	clientVoiceChannel map[uuid.UUID]*uuid.UUID              // userID → voiceChannelID
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
		log:                log,
		voiceChannels:      make(map[uuid.UUID]map[uuid.UUID]struct{}),
		clientVoiceChannel: make(map[uuid.UUID]*uuid.UUID),
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
				voiceChannelID, remainingVoice := h.leaveVoiceChannelLocked(client.UserID)
				h.mu.Unlock()
				h.log.Info("client disconnected", "user_id", client.UserID, "total", len(h.clients))

				// Notify all clients about the disconnected user
				h.notifyAllOnlineUsersAfterDisconnect(client.UserID.String(), currentIDs)
				if voiceChannelID != nil {
					h.notifyVoiceParticipants(voiceChannelID.String(), remainingVoice)
				}
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
				"user_id":    disconnectedUserID,
				"user_ids":   remainingIDs,
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

// JoinVoiceChannel registers a user as present in a voice channel and returns the updated participant list.
func (h *Hub) JoinVoiceChannel(userID, channelID uuid.UUID) []string {
	h.mu.Lock()
	defer h.mu.Unlock()
	// Remove from previous voice channel if any
	if prev := h.clientVoiceChannel[userID]; prev != nil && *prev != channelID {
		delete(h.voiceChannels[*prev], userID)
	}
	h.clientVoiceChannel[userID] = &channelID
	if h.voiceChannels[channelID] == nil {
		h.voiceChannels[channelID] = make(map[uuid.UUID]struct{})
	}
	h.voiceChannels[channelID][userID] = struct{}{}
	return h.voiceParticipantsLocked(channelID)
}

// LeaveVoiceChannel removes a user from their current voice channel.
// Returns the channel they left and the remaining participant list (nil if not in any channel).
func (h *Hub) LeaveVoiceChannel(userID uuid.UUID) (*uuid.UUID, []string) {
	h.mu.Lock()
	defer h.mu.Unlock()
	return h.leaveVoiceChannelLocked(userID)
}

// leaveVoiceChannelLocked is the internal version; caller must hold h.mu.Lock().
func (h *Hub) leaveVoiceChannelLocked(userID uuid.UUID) (*uuid.UUID, []string) {
	channelID := h.clientVoiceChannel[userID]
	if channelID == nil {
		return nil, nil
	}
	delete(h.clientVoiceChannel, userID)
	delete(h.voiceChannels[*channelID], userID)
	remaining := h.voiceParticipantsLocked(*channelID)
	return channelID, remaining
}

// GetVoiceState returns all currently active voice channels and their participants.
func (h *Hub) GetVoiceState() map[string][]string {
	h.mu.RLock()
	defer h.mu.RUnlock()
	state := make(map[string][]string, len(h.voiceChannels))
	for channelID, users := range h.voiceChannels {
		if len(users) == 0 {
			continue
		}
		ids := make([]string, 0, len(users))
		for uid := range users {
			ids = append(ids, uid.String())
		}
		state[channelID.String()] = ids
	}
	return state
}

// SendVoiceStateTo sends the current voice presence snapshot to a single client.
func (h *Hub) SendVoiceStateTo(client *Client) {
	state := h.GetVoiceState()
	payload, _ := json.Marshal(state)
	msg, _ := json.Marshal(struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}{Type: "voice_state", Payload: json.RawMessage(payload)})
	select {
	case client.Send <- msg:
	default:
	}
}

// notifyVoiceParticipants broadcasts an updated participant list for a voice channel to all clients.
// Must NOT be called while holding h.mu (it acquires RLock internally).
func (h *Hub) notifyVoiceParticipants(channelID string, participants []string) {
	if participants == nil {
		participants = []string{}
	}
	payload, _ := json.Marshal(map[string]interface{}{
		"channel_id":   channelID,
		"participants": participants,
	})
	msg, _ := json.Marshal(struct {
		Type    string          `json:"type"`
		Payload json.RawMessage `json:"payload"`
	}{Type: "voice_participants", Payload: json.RawMessage(payload)})

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, client := range h.clients {
		select {
		case client.Send <- msg:
		default:
		}
	}
}

// voiceParticipantsLocked returns user IDs for a channel; caller must hold at least h.mu.RLock().
func (h *Hub) voiceParticipantsLocked(channelID uuid.UUID) []string {
	ids := make([]string, 0, len(h.voiceChannels[channelID]))
	for uid := range h.voiceChannels[channelID] {
		ids = append(ids, uid.String())
	}
	return ids
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}
