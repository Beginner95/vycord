package usecase

import (
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type callUseCase struct {
	callRepo domain.CallRepository
}

func NewCallUseCase(callRepo domain.CallRepository) domain.CallUseCase {
	return &callUseCase{callRepo: callRepo}
}

func (uc *callUseCase) StartCall(callerID, receiverID uuid.UUID) (*domain.Call, error) {
	// Check if there's already an active call
	existing, err := uc.callRepo.GetActiveByUser(callerID)
	if err != nil {
		return nil, fmt.Errorf("failed to check active calls: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("user already in a call")
	}

	existing, err = uc.callRepo.GetActiveByUser(receiverID)
	if err != nil {
		return nil, fmt.Errorf("failed to check receiver active calls: %w", err)
	}
	if existing != nil {
		return nil, fmt.Errorf("receiver already in a call")
	}

	now := time.Now().UTC().Format(time.RFC3339)
	call := &domain.Call{
		ID:         uuid.New(),
		CallerID:   callerID,
		ReceiverID: receiverID,
		Status:     domain.CallStatusRinging,
		StartedAt:  now,
	}

	if err := uc.callRepo.Create(call); err != nil {
		return nil, fmt.Errorf("failed to create call: %w", err)
	}

	return call, nil
}

func (uc *callUseCase) AcceptCall(callID uuid.UUID) error {
	call, err := uc.callRepo.GetByID(callID)
	if err != nil {
		return fmt.Errorf("call not found: %w", err)
	}

	if call.Status != domain.CallStatusRinging {
		return fmt.Errorf("call is not in ringing state")
	}

	return uc.callRepo.UpdateStatus(callID, domain.CallStatusActive)
}

func (uc *callUseCase) RejectCall(callID uuid.UUID) error {
	call, err := uc.callRepo.GetByID(callID)
	if err != nil {
		return fmt.Errorf("call not found: %w", err)
	}

	if call.Status != domain.CallStatusRinging {
		return fmt.Errorf("call is not in ringing state")
	}

	if err := uc.callRepo.UpdateStatus(callID, domain.CallStatusRejected); err != nil {
		return err
	}

	return uc.callRepo.SetEndTime(callID)
}

func (uc *callUseCase) EndCall(callID uuid.UUID) error {
	call, err := uc.callRepo.GetByID(callID)
	if err != nil {
		return fmt.Errorf("call not found: %w", err)
	}

	if call.Status == domain.CallStatusEnded {
		return nil // Already ended
	}

	if err := uc.callRepo.UpdateStatus(callID, domain.CallStatusEnded); err != nil {
		return err
	}

	return uc.callRepo.SetEndTime(callID)
}

func (uc *callUseCase) GetActiveCall(userID uuid.UUID) (*domain.Call, error) {
	call, err := uc.callRepo.GetActiveByUser(userID)
	if err != nil {
		return nil, fmt.Errorf("failed to get active call: %w", err)
	}

	return call, nil
}
