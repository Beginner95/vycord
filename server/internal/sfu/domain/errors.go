package domain

import "errors"

var (
	ErrRoomNotFound        = errors.New("sfu: room not found")
	ErrRoomAlreadyExists   = errors.New("sfu: room already exists")
	ErrRoomClosed          = errors.New("sfu: room is closed")
	ErrParticipantNotFound = errors.New("sfu: participant not found")
	ErrParticipantExists   = errors.New("sfu: participant already exists")
	ErrSinkExists          = errors.New("sfu: subscriber already has a fan-out sink for this track")
	ErrFanoutClosed        = errors.New("sfu: track fan-out is closed")
	ErrSessionClosed       = errors.New("sfu: participant session is closed")
)
