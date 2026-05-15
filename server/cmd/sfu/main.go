package main

import (
	"context"
	"encoding/json"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"github.com/gorilla/websocket"
	"github.com/vycord/server/internal/sfu"
	"github.com/vycord/server/pkg/logger"
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
	sfuServer  *sfu.SFU
	clients    map[string]*SFUClient
	rooms      map[string]map[string]*SFUClient // roomID -> userID -> client
	register   chan *SFUClient
	unregister chan *SFUClient
	log        *slog.Logger
}

func NewSFUHub(log *slog.Logger) *SFUHub {
	s, err := sfu.NewSFU()
	if err != nil {
		log.Error("failed to create SFU", "error", err)
		os.Exit(1)
	}

	return &SFUHub{
		sfuServer:  s,
		clients:    make(map[string]*SFUClient),
		rooms:      make(map[string]map[string]*SFUClient),
		register:   make(chan *SFUClient),
		unregister: make(chan *SFUClient),
		log:        log,
	}
}

func (h *SFUHub) Run() {
	for {
		select {
		case client := <-h.register:
			h.clients[client.ID] = client

			if _, exists := h.rooms[client.RoomID]; !exists {
				h.rooms[client.RoomID] = make(map[string]*SFUClient)
				h.sfuServer.CreateRoom(client.RoomID)
				h.log.Info("room created", "room_id", client.RoomID)
			}
			h.rooms[client.RoomID][client.UserID] = client

			roomSize := len(h.rooms[client.RoomID])
			h.log.Info("client registered",
				"user_id", client.UserID,
				"room_id", client.RoomID,
				"room_size", roomSize,
				"total_clients", len(h.clients),
			)

		case client := <-h.unregister:
			if _, exists := h.clients[client.ID]; exists {
				delete(h.clients, client.ID)
				close(client.Send)

				remaining := 0
				if roomClients, exists := h.rooms[client.RoomID]; exists {
					delete(roomClients, client.UserID)
					remaining = len(roomClients)
					if remaining == 0 {
						delete(h.rooms, client.RoomID)
						h.log.Info("room closed (empty)", "room_id", client.RoomID)
					}
				}

				h.log.Info("client unregistered",
					"user_id", client.UserID,
					"room_id", client.RoomID,
					"remaining_in_room", remaining,
					"total_clients", len(h.clients),
				)

				h.notifyRoomClients(client.RoomID, client.UserID, "peer_left", map[string]interface{}{
					"user_id": client.UserID,
				})
			}
		}
	}
}

func (h *SFUHub) notifyRoomClients(roomID, excludeUserID, eventType string, payload interface{}) {
	roomClients, exists := h.rooms[roomID]
	if !exists {
		return
	}

	data, _ := json.Marshal(map[string]interface{}{
		"type":    eventType,
		"payload": payload,
	})

	notified := 0
	for userID, client := range roomClients {
		if userID == excludeUserID {
			continue
		}
		select {
		case client.Send <- data:
			notified++
		default:
			h.log.Warn("send channel full, dropping message",
				"event", eventType,
				"target_user_id", userID,
				"room_id", roomID,
			)
		}
	}

	h.log.Debug("notified room clients",
		"event", eventType,
		"room_id", roomID,
		"excluded_user_id", excludeUserID,
		"notified", notified,
	)
}

func (h *SFUHub) sendToUser(userID, roomID string, msg interface{}) {
	roomClients, exists := h.rooms[roomID]
	if !exists {
		h.log.Warn("sendToUser: room not found",
			"room_id", roomID,
			"target_user_id", userID,
		)
		return
	}

	client, exists := roomClients[userID]
	if !exists {
		h.log.Warn("sendToUser: target user not in room",
			"target_user_id", userID,
			"room_id", roomID,
		)
		return
	}

	data, _ := json.Marshal(msg)
	select {
	case client.Send <- data:
	default:
		h.log.Warn("sendToUser: send channel full, dropping message",
			"target_user_id", userID,
			"room_id", roomID,
		)
	}
}

func handleWebSocket(hub *SFUHub, w http.ResponseWriter, r *http.Request) {
	userID := r.URL.Query().Get("user_id")
	roomID := r.URL.Query().Get("room_id")
	if userID == "" || roomID == "" {
		http.Error(w, "missing user_id or room_id", http.StatusBadRequest)
		return
	}

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		hub.log.Error("failed to upgrade WebSocket connection",
			"user_id", userID,
			"room_id", roomID,
			"error", err,
		)
		return
	}

	client := &SFUClient{
		ID:     userID + "-" + roomID,
		UserID: userID,
		RoomID: roomID,
		Conn:   conn,
		Send:   make(chan []byte, 512),
	}

	hub.log.Info("WebSocket connection established",
		"user_id", userID,
		"room_id", roomID,
		"remote_addr", r.RemoteAddr,
	)

	hub.register <- client

	go hub.writePump(client)
	go hub.readPump(client, hub)
}

func (h *SFUHub) readPump(client *SFUClient, hub *SFUHub) {
	defer func() {
		hub.unregister <- client
		client.Conn.Close()
		h.log.Info("readPump closed",
			"user_id", client.UserID,
			"room_id", client.RoomID,
		)
	}()

	for {
		_, message, err := client.Conn.ReadMessage()
		if err != nil {
			if websocket.IsUnexpectedCloseError(err, websocket.CloseGoingAway, websocket.CloseNormalClosure) {
				h.log.Warn("unexpected WebSocket close",
					"user_id", client.UserID,
					"room_id", client.RoomID,
					"error", err,
				)
			} else {
				h.log.Debug("WebSocket closed normally",
					"user_id", client.UserID,
					"room_id", client.RoomID,
				)
			}
			break
		}

		var msg sfu.PeerMessage
		if err := json.Unmarshal(message, &msg); err != nil {
			h.log.Error("failed to parse SFU message",
				"user_id", client.UserID,
				"room_id", client.RoomID,
				"error", err,
				"raw", string(message),
			)
			continue
		}

		h.log.Debug("message received",
			"type", msg.Type,
			"user_id", client.UserID,
			"room_id", client.RoomID,
		)

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
	default:
		h.log.Warn("unknown message type",
			"type", msg.Type,
			"user_id", client.UserID,
			"room_id", client.RoomID,
		)
	}
}

func (h *SFUHub) handleJoin(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.JoinPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.log.Error("failed to parse join payload",
			"user_id", client.UserID,
			"error", err,
		)
		return
	}

	client.RoomID = payload.RoomID

	existingPeers := []string{}
	if roomClients, exists := h.rooms[payload.RoomID]; exists {
		for userID := range roomClients {
			if userID != client.UserID {
				existingPeers = append(existingPeers, userID)
			}
		}
	}

	h.log.Info("peer joined room",
		"user_id", client.UserID,
		"room_id", payload.RoomID,
		"existing_peers", existingPeers,
		"existing_count", len(existingPeers),
	)

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
		h.log.Error("failed to parse offer payload",
			"user_id", client.UserID,
			"error", err,
		)
		return
	}

	if payload.TargetUserID == "" {
		h.log.Warn("offer missing target_user_id, dropping",
			"from_user_id", client.UserID,
			"room_id", payload.RoomID,
		)
		return
	}

	h.log.Info("routing offer",
		"from_user_id", client.UserID,
		"target_user_id", payload.TargetUserID,
		"room_id", payload.RoomID,
	)

	h.sendToUser(payload.TargetUserID, payload.RoomID, map[string]interface{}{
		"type": "offer",
		"payload": map[string]interface{}{
			"from_user_id": client.UserID,
			"sdp":          payload.SDP,
		},
	})
}

func (h *SFUHub) handleAnswer(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.SDPPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.log.Error("failed to parse answer payload",
			"user_id", client.UserID,
			"error", err,
		)
		return
	}

	if payload.TargetUserID == "" {
		h.log.Warn("answer missing target_user_id, dropping",
			"from_user_id", client.UserID,
			"room_id", payload.RoomID,
		)
		return
	}

	h.log.Info("routing answer",
		"from_user_id", client.UserID,
		"target_user_id", payload.TargetUserID,
		"room_id", payload.RoomID,
	)

	h.sendToUser(payload.TargetUserID, payload.RoomID, map[string]interface{}{
		"type": "answer",
		"payload": map[string]interface{}{
			"from_user_id": client.UserID,
			"sdp":          payload.SDP,
		},
	})
}

func (h *SFUHub) handleICECandidate(client *SFUClient, msg *sfu.PeerMessage) {
	var payload sfu.ICEPayload
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		h.log.Error("failed to parse ice_candidate payload",
			"user_id", client.UserID,
			"error", err,
		)
		return
	}

	if payload.TargetUserID == "" {
		h.log.Warn("ice_candidate missing target_user_id, dropping",
			"from_user_id", client.UserID,
			"room_id", payload.RoomID,
		)
		return
	}

	h.log.Debug("routing ICE candidate",
		"from_user_id", client.UserID,
		"target_user_id", payload.TargetUserID,
		"room_id", payload.RoomID,
	)

	h.sendToUser(payload.TargetUserID, payload.RoomID, map[string]interface{}{
		"type": "ice_candidate",
		"payload": map[string]interface{}{
			"from_user_id": client.UserID,
			"candidate":    payload.Candidate,
		},
	})
}

func (h *SFUHub) handleLeave(client *SFUClient, msg *sfu.PeerMessage) {
	h.log.Info("peer requested leave",
		"user_id", client.UserID,
		"room_id", client.RoomID,
	)
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
			h.log.Warn("writePump: failed to get writer",
				"user_id", client.UserID,
				"room_id", client.RoomID,
				"error", err,
			)
			return
		}
		w.Write(message)

		if err := w.Close(); err != nil {
			h.log.Warn("writePump: failed to close writer",
				"user_id", client.UserID,
				"room_id", client.RoomID,
				"error", err,
			)
			return
		}
	}
}

func mustMarshal(v interface{}) []byte {
	data, _ := json.Marshal(v)
	return data
}

func main() {
	log := logger.New(slog.LevelDebug)

	port := os.Getenv("SFU_PORT")
	if port == "" {
		port = "8081"
	}

	hub := NewSFUHub(log)
	go hub.Run()

	http.HandleFunc("/ws", func(w http.ResponseWriter, r *http.Request) {
		handleWebSocket(hub, w, r)
	})

	srv := &http.Server{
		Addr: ":" + port,
	}

	go func() {
		log.Info("SFU server starting", "port", port)
		if err := srv.ListenAndServe(); err != nil && err != http.ErrServerClosed {
			log.Error("SFU server failed", "error", err)
			os.Exit(1)
		}
	}()

	quit := make(chan os.Signal, 1)
	signal.Notify(quit, syscall.SIGINT, syscall.SIGTERM)
	<-quit

	log.Info("SFU server shutting down...")
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := srv.Shutdown(ctx); err != nil {
		log.Error("SFU server forced shutdown", "error", err)
	}
	log.Info("SFU server stopped")
}
