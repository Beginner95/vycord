package ws

import (
	"encoding/json"
	"log/slog"
	"sync"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

type Hub struct {
	clients    map[uuid.UUID]*Client
	register   chan *Client
	unregister chan *Client
	broadcast  chan *Message
	mu         sync.RWMutex
	log        *slog.Logger
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
		clients:    make(map[uuid.UUID]*Client),
		register:   make(chan *Client),
		unregister: make(chan *Client),
		broadcast:  make(chan *Message),
		log:        log,
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

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}
