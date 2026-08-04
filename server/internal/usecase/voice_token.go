package usecase

import (
	"errors"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

const voiceTokenTTL = 60 * time.Second

type voiceTokenUseCase struct {
	access    domain.ChannelAccessChecker
	jwtSecret string
}

func NewVoiceTokenUseCase(access domain.ChannelAccessChecker, jwtSecret string) domain.VoiceTokenUseCase {
	return &voiceTokenUseCase{access: access, jwtSecret: jwtSecret}
}

func (uc *voiceTokenUseCase) IssueToken(channelID, userID uuid.UUID) (string, error) {
	ch, err := uc.access.CheckChannelAccess(channelID, userID)
	if err != nil {
		return "", err
	}
	if ch.Type != domain.ChannelTypeVoice {
		return "", domain.ErrChannelNotVoice
	}

	token, err := authtoken.GenerateRoomToken(uc.jwtSecret, userID, channelID, voiceTokenTTL)
	if err != nil {
		return "", errors.New("failed to generate voice token")
	}
	return token, nil
}
