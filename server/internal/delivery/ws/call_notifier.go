package ws

import (
	"encoding/json"

	"github.com/google/uuid"
)

// CallNotifier — адаптер хаба под domain.CallNotifier: usecase звонков шлёт
// события сам (в том числе из таймеров), не зная про WebSocket.
type CallNotifier struct{ hub *Hub }

func NewCallNotifier(h *Hub) *CallNotifier { return &CallNotifier{hub: h} }

func (n *CallNotifier) Notify(userID uuid.UUID, msgType string, payload any) {
	data, err := json.Marshal(payload)
	if err != nil {
		n.hub.log.Error("call notifier: marshal payload", "type", msgType, "error", err)
		return
	}
	n.hub.SendToUser(userID, &Message{Type: msgType, Payload: data})
}
