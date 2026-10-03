package handler

import (
	"encoding/json"
	"log/slog"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

// ChannelActivityNotifier — побочные эффекты сообщения для непрочитанного
// (VYC-104): курсор автора и событие channel_activity всем участникам сервера.
// Опционален, как GuestChatFanout.
type ChannelActivityNotifier interface {
	// Created — сообщение создано: курсор автора на него + событие create.
	Created(msg *domain.Message)
	// Lookup — снимок сообщения ДО удаления: после него ни времени, ни
	// автора уже не узнать. nil — сообщения нет или БД недоступна.
	Lookup(messageID uuid.UUID) *domain.Message
	// Deleted — событие delete по снимку из Lookup.
	Deleted(msg *domain.Message)
}

// UsersSender — то, что фанауту нужно от хаба. *ws.Hub подходит как есть.
type UsersSender interface {
	SendToUsers(userIDs []uuid.UUID, message *ws.Message)
}

type ChannelActivityFanout struct {
	uc  domain.ReadStateUseCase
	hub UsersSender
	log *slog.Logger
}

func NewChannelActivityFanout(uc domain.ReadStateUseCase, hub UsersSender, log *slog.Logger) *ChannelActivityFanout {
	return &ChannelActivityFanout{uc: uc, hub: hub, log: log}
}

// Ошибки здесь только логируются: сообщение уже создано/удалено, отказывать
// пользователю из-за счётчиков нельзя — клиент пересчитает их при реконнекте.
func (f *ChannelActivityFanout) Created(msg *domain.Message) {
	if err := f.uc.AuthorRead(msg); err != nil {
		f.log.Error("advance author read cursor failed", "message_id", msg.ID, "error", err)
	}
	f.send(msg, domain.ChannelActivityCreate)
}

func (f *ChannelActivityFanout) Lookup(messageID uuid.UUID) *domain.Message {
	msg, err := f.uc.MessageByID(messageID)
	if err != nil {
		return nil
	}
	return msg
}

func (f *ChannelActivityFanout) Deleted(msg *domain.Message) {
	f.send(msg, domain.ChannelActivityDelete)
}

func (f *ChannelActivityFanout) send(msg *domain.Message, op string) {
	ev, audience, err := f.uc.Activity(msg, op)
	if err != nil {
		f.log.Error("resolve channel activity failed", "message_id", msg.ID, "op", op, "error", err)
		return
	}
	if ev == nil {
		return
	}
	payload, err := json.Marshal(ev)
	if err != nil {
		f.log.Error("marshal channel activity failed", "message_id", msg.ID, "error", err)
		return
	}
	f.hub.SendToUsers(audience, &ws.Message{Type: "channel_activity", Payload: payload})
}
