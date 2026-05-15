package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vycord/server/internal/sfu"
)

var upgrader = websocket.Upgrader{
	ReadBufferSize:  4096,
	WriteBufferSize: 4096,
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

// SFUClient represents a connected client in the SFU
type SFUClient struct {
	ID     string
	UserID string
	RoomID string
	Conn   *websocket.Conn
	Send   chan []byte
	Peer   *sfu.Peer
}

// SFUHub manages SFU clients and rooms
type SFUHub struct {
	sfuServer    *sfu.SFU
	clients      map[string]*SFUClient
	rooms        map[string]map[string]*SFUClient // roomID -> userID -> client
	register     chan *SFUClient
	unregister   chan *SFUClient
}

func NewSFUHub() *SFUHub {
	s, err := sfu.NewSFU()
	if err != nil {
		log.Fatalf("Failed to create SFU: %v", err)
	}

	return &SFUHub{
		sfuServer:  s,
		clients:    make(map[string]*SFUClient),
		rooms:      make(map[string]map[string]*SFUClient),
		register:   make(chan *SFUClient),
		unregister: make(chan *SFUClient),
	}
}

func (h *SFUHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client.ID] = client
			log.Printf("[SFU] Client %s joined", client.ID)

			// Add to room
			if _, exists := h.rooms[client.RoomID]; !exists {
				h.rooms[client.RoomID] = make(map[string]*SFUClient)
				// Create SFU room
				h.sfuServer.CreateRoom(client.RoomID)
			}
			h.rooms[client.RoomID][client.UserID] = client

		case client := <-h.unregister:
			if _, exists := h.clients[client.ID]; exists {
				delete(h.clients, client.ID)
				close(client.Send)

				// Remove from room
				if roomClients, exists := h.rooms[client.RoomID]; exists {
					delete(roomClients, client.UserID)
					if len(roomClients) == 0 {
						delete(h.rooms, client.RoomID)
					}
				}

				// Notify other clients in the room
				h.notifyRoomClients(client.RoomID, client.UserID, "peer_left", map[string]interface{}{
					"user_id": client.UserID,
				})

				log.Printf("[SFU] Client %s left", client.ID)
			}
		}
	}
}

func (h *SFUHub) notifyRoomClients(roomID, excludeUserID, eventType string, payload interface{}) {
	if roomClients, exists := h.rooms[roomID]; exists {
		data, _ := json.Marshal(map[string]interface{}{
			"type":    eventType,
			"payload": payload,
		})
		for userID, client := range roomClients {
			if userID == excludeUserID {
				continue
			}
			select {
			case client.Send <- data:
			default:
			}
		}
	}
}

func (h *SFUHub) sendToUser(userID, roomID string, msg interface{}) {
	if roomClients, exists := h.rooms[roomID]; exists {
		if client, exists := roomClients[userID]; exists {
			data, _ := json.Marshal(msg)
			select {
			case client.Send <- data:
			default:
			}
		}
	}
}

func handleWebSocket(hub *SFUHub, w http.ResponseWriter, r *http.Request) {
	// Get params from query
	userID := r.URL.Query().Get("user_id")
	roomID := r.URL.Query().Get("room_id")
	if userID == "" || roomID == "" {
		http.Error(w, "missing user_id or room_id", http.StatusBadRequest)
		return
	}

	// Upgrade connection
	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		log.Printf("[SFU] Failed to upgrade: %v", err)
		return
	}

	client := &SFUClient{
		ID:     userID + "-" + roomID,
		UserID: userID,
		RoomID: roomID,
		Conn:   conn,
		Send:   make(chan []byte, 512),
	}

	hub.register <- client

	go hub.writePump(client)
	go hub.readPump(client, hub)
}

func (h *SFUHub) readPump(client *SFUClient, hub *SFUHub) {
	defer func() {
		hub.unregister <- client
		client.Conn.Close()
	}()

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			break
		}

		var msg sfu.PeerMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			log.Printf("[SFU] Failed to parse message: %v", err)
			continue
		}

		hub.handleMessage(client, &msg)
	}
}

func (h *SFUHub) handleMessage(client *SFUClient, msg *sfu.PeerMessage) {
	switch msg.Type {
	case "join":
		h.handleJoin(client, msg)
	case "offer":
		h.handleOffer(client, msg)
	case "answer":
		h.handleAnswer(client, msg)
	case "ice_candidate":
		h.handleICECandidate(client, msg)
	case "leave":
		h.handleLeave(client, msg)
	}
}

func (h *SFUHub) handleJoin(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.JoinPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}

	client.RoomID = payload.RoomID

	// Collect peers already in the room before notifying them about the new joiner.
	// The new client itself was added to h.rooms during register, so exclude it here.
	existingPeers := []string{}
	if roomClients, exists := h.rooms[payload.RoomID]; exists {
		for userID := range roomClients {
			if userID != client.UserID {
				existingPeers = append(existingPeers, userID)
			}
		}
	}

	// Notify others
	h.notifyRoomClients(payload.RoomID, client.UserID, "peer_joined", map[string]interface{}{
		"user_id": client.UserID,
	})

	client.Send <- mustMarshal(map[string]interface{}{
		"type": "joined",
		"payload": map[string]interface{}{
			"room_id":        payload.RoomID,
			"existing_peers": existingPeers,
		},
	})
}

func (h *SFUHub) handleOffer(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.SDPPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}

	// Forward offer to target users in room
	h.notifyRoomClients(payload.RoomID, client.UserID, "offer", map[string]interface{}{
		"from_user_id": client.UserID,
		"sdp":          payload.SDP,
	})
}

func (h *SFUHub) handleAnswer(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.SDPPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}

	// Forward answer to target users
	h.notifyRoomClients(payload.RoomID, client.UserID, "answer", map[string]interface{}{
		"from_user_id": client.UserID,
		"sdp":          payload.SDP,
	})
}

func (h *SFUHub) handleICECandidate(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.ICEPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}

	// Forward ICE candidate to all peers in room
	h.notifyRoomClients(payload.RoomID, client.UserID, "ice_candidate", map[string]interface{}{
		"from_user_id": client.UserID,
		"candidate":    payload.Candidate,
	})
}

func (h *SFUHub) handleLeave(client *SFUClient, msg *sfu.PeerMessage) {
	h.unregister <- client
}

func (h *SFUHub) writePump(client *SFUClient) {
	defer func() {
		client.Conn.Close()
	}()

	for {
		message, ok := <-client.Send
		if !ok {
			client.Conn.WriteMessage(websocket.CloseMessage, []byte{})
			return
		}

		w, err := client.Conn.NextWriter(websocket.TextMessage)
		if err != nil {
			return
		}
		w.Write(message)

		if err := w.Close(); err != nil {
			return
		}
	}
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

func main() {
	port := os.Getenv("SFU_PORT")
	if port == "" {
		port = "8081"
	}

	hub := NewSFUHub()
	go hub.Run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(hub, w, r)
	})

	srv := &http.Server{
		Addr: ":" + port,
	}

	go func() {
		log.Printf("[SFU] Server starting on :%s", port)
		if err := srv.ListenAndServe(); err != nil {
			log.Fatalf("[SFU] Server failed: %v", err)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Println("[SFU] Shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	srv.Shutdown(ctx)
}
