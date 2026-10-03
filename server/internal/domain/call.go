package domain

import (
	"time"

	"github.com/google/uuid"
)

// Call — личный звонок 1:1 (VYC-103). Медиа идёт через комнату SFU с
// room_id = ID; жизненным циклом владеет CallUseCase, SFU о звонке не знает.
type Call struct {
	ID         uuid.UUID
	CallerID   uuid.UUID
	ReceiverID uuid.UUID
	Status     CallStatus
	StartedAt  time.Time
	AcceptedAt *time.Time
	EndedAt    *time.Time
}

// Has — участвует ли userID в звонке.
func (c *Call) Has(userID uuid.UUID) bool {
	return c.CallerID == userID || c.ReceiverID == userID
}

// Peer — собеседник userID. Для не-участника возвращает uuid.Nil.
func (c *Call) Peer(userID uuid.UUID) uuid.UUID {
	switch userID {
	case c.CallerID:
		return c.ReceiverID
	case c.ReceiverID:
		return c.CallerID
	}
	return uuid.Nil
}

type CallStatus string

const (
	CallStatusRinging  CallStatus = "ringing"
	CallStatusActive   CallStatus = "active"
	CallStatusEnded    CallStatus = "ended"
	CallStatusMissed   CallStatus = "missed"
	CallStatusRejected CallStatus = "rejected"
)

// Live — звонок ещё идёт или звонит.
func (s CallStatus) Live() bool { return s == CallStatusRinging || s == CallStatusActive }

// CallEndReason — причина в событии call_ended. Это не статус в БД:
// timeout и missed оба пишутся как missed, failed — как ended.
type CallEndReason string

const (
	CallEndEnded    CallEndReason = "ended"
	CallEndMissed   CallEndReason = "missed"
	CallEndTimeout  CallEndReason = "timeout"
	CallEndRejected CallEndReason = "rejected"
	CallEndFailed   CallEndReason = "failed"
)

// CallParty — участник звонка в событиях: клиенту не нужен отдельный запрос.
type CallParty struct {
	ID        uuid.UUID `json:"id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
}

// CallSnapshot — состояние звонка в call_ringing / call_state.
type CallSnapshot struct {
	CallID   uuid.UUID  `json:"call_id"`
	Status   CallStatus `json:"status"`
	Caller   CallParty  `json:"caller"`
	Receiver CallParty  `json:"receiver"`
}

type CallRepository interface {
	Create(call *Call) error
	// GetByID возвращает ErrCallNotFound, если строки нет.
	GetByID(id uuid.UUID) (*Call, error)
	// ListLiveByUser — ringing/active звонки пользователя с любой стороны,
	// новые первыми. Нет звонков — nil, nil.
	ListLiveByUser(userID uuid.UUID) ([]*Call, error)
	// Transition — условный переход: меняет статус, только если текущий входит
	// в from. false — гонку выиграл кто-то другой. Ставит accepted_at при
	// переходе в active и ended_at при переходе в завершающий статус.
	Transition(id uuid.UUID, from []CallStatus, to CallStatus, at time.Time) (bool, error)
	// CloseAllLive закрывает висящие звонки при старте API: ringing → missed,
	// active → ended. Возвращает число закрытых.
	CloseAllLive(at time.Time) (int64, error)
	// Exists — есть ли звонок с таким id в любом статусе.
	Exists(id uuid.UUID) (bool, error)
}

// CallNotifier доставляет событие пользователю (адаптер хаба).
type CallNotifier interface {
	Notify(userID uuid.UUID, msgType string, payload any)
}

// DirectCallPresence — онлайн ли пользователь (хаб). Не CallPresence: это имя
// уже занято портом гостевых звонков каналов (guest.go).
type DirectCallPresence interface {
	IsOnline(userID uuid.UUID) bool
}

// CallPermission — те же правила, что у ЛС (friendUseCase.CanDM).
type CallPermission interface {
	CanDM(fromID, toID uuid.UUID) error
}

// CallUserLookup — имя и аватар участника (userRepo).
type CallUserLookup interface {
	GetByID(id uuid.UUID) (*User, error)
}

type CallUseCase interface {
	Start(callerID, receiverID uuid.UUID) (*Call, error)
	Accept(userID, callID uuid.UUID) error
	Reject(userID, callID uuid.UUID) error
	// End — «Завершить» или отмена при дозвоне. reason из клиента: ended | failed.
	End(userID, callID uuid.UUID, reason CallEndReason) error
	// OnConnect снимает grace-таймер и возвращает снимок живого звонка
	// пользователя (nil — звонка нет). Снимок отправляет вызывающий.
	OnConnect(userID uuid.UUID) *CallSnapshot
	// OnDisconnect — последний WS пользователя закрылся.
	OnDisconnect(userID uuid.UUID)
	// IssueRoomToken — room-токен SFU для участника активного звонка.
	IssueRoomToken(userID, callID uuid.UUID) (string, error)
	// IsCallRoom — комната SFU принадлежит звонку 1:1 (для presence-воркера).
	IsCallRoom(roomID uuid.UUID) bool
	// RecoverOnStartup закрывает звонки, пережившие рестарт (таймеры в памяти).
	RecoverOnStartup() error
}
