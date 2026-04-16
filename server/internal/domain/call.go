package domain

import "github.com/google/uuid"

type Call struct {
	ID          uuid.UUID `json:"id"`
	CallerID    uuid.UUID `json:"caller_id"`
	ReceiverID  uuid.UUID `json:"receiver_id"`
	Status      CallStatus `json:"status"`
	StartedAt   string    `json:"started_at"`
	EndedAt     *string   `json:"ended_at,omitempty"`
}

type CallStatus string

const (
	CallStatusRinging  CallStatus = "ringing"
	CallStatusActive   CallStatus = "active"
	CallStatusEnded    CallStatus = "ended"
	CallStatusMissed   CallStatus = "missed"
	CallStatusRejected CallStatus = "rejected"
)

type CallRepository interface {
	Create(call *Call) error
	GetByID(id uuid.UUID) (*Call, error)
	GetActiveByUser(userID uuid.UUID) (*Call, error)
	UpdateStatus(id uuid.UUID, status CallStatus) error
	SetEndTime(id uuid.UUID) error
	EndAllActiveByUser(userID uuid.UUID) error
}

type CallUseCase interface {
	StartCall(callerID, receiverID uuid.UUID) (*Call, error)
	AcceptCall(callID uuid.UUID) error
	RejectCall(callID uuid.UUID) error
	EndCall(callID uuid.UUID) error
	GetActiveCall(userID uuid.UUID) (*Call, error)
	EndAllActiveCalls(userID uuid.UUID) error
}
