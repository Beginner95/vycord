package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strings"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
)

type ServerHandler struct {
	serverUseCase domain.ServerUseCase
	inviteUseCase domain.InviteUseCase
	hub           *ws.Hub
	log           *slog.Logger
}

func NewServerHandler(serverUseCase domain.ServerUseCase, inviteUseCase domain.InviteUseCase, hub *ws.Hub, log *slog.Logger) *ServerHandler {
	return &ServerHandler{
		serverUseCase: serverUseCase,
		inviteUseCase: inviteUseCase,
		hub:           hub,
		log:           log,
	}
}

// broadcast адресует реалтайм-событие сервера: приватному — только его
// участникам (GetServerAudience), публичному — как раньше, всем подключённым.
//
// GetServerAudience возвращает (nil, nil) для публичного сервера — это не
// ошибка, это осознанный сигнал "рассылать всем". Ошибка (err != nil)
// означает, что мы не смогли ни подтвердить публичность, ни получить список
// участников — в этом случае событие НЕ рассылается вообще (fail-closed):
// откат на BroadcastMessage при ошибке был бы утечкой приватных данных
// (например, при временном сбое БД во время рассылки обновления приватного
// сервера) всем подключённым клиентам, а не только его участникам.
func (h *ServerHandler) broadcast(serverID uuid.UUID, msg *ws.Message) {
	audience, err := h.serverUseCase.GetServerAudience(serverID)
	if err != nil {
		h.log.Error("failed to resolve server audience, dropping broadcast", "server_id", serverID, "message_type", msg.Type, "error", err)
		return
	}
	if audience != nil {
		h.hub.SendToUsers(audience, msg)
		return
	}
	h.hub.BroadcastMessage(msg)
}

type CreateServerRequest struct {
	Name      string `json:"name"`
	IsPrivate bool   `json:"is_private"`
}

func (h *ServerHandler) CreateServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req CreateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	req.Name = strings.TrimSpace(req.Name)

	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeServerNameRequired, "server name is required")
		return
	}

	server, err := h.serverUseCase.CreateServer(req.Name, userID, req.IsPrivate)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	if req.IsPrivate {
		// Приватный сервер без единой инвайт-ссылки никто, кроме владельца,
		// открыть не может — авто-инвайт даёт стартовый способ позвать первых
		// участников сразу после создания. Best-effort: ошибка здесь не
		// должна откатывать уже созданный сервер, только логируется.
		if _, err := h.inviteUseCase.CreateInvite(server.ID, userID); err != nil {
			h.log.Error("failed to create initial invite for private server", "server_id", server.ID, "error", err)
		}
	}

	h.sendJSON(w, http.StatusCreated, server)
}

func (h *ServerHandler) GetServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	server, err := h.serverUseCase.GetServer(serverID, userID)
	if err != nil {
		h.sendError(w, http.StatusNotFound, httperr.CodeServerNotFound, "server not found")
		return
	}

	h.sendJSON(w, http.StatusOK, server)
}

func (h *ServerHandler) GetUserServers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	servers, err := h.serverUseCase.GetUserServers(userID)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, httperr.CodeGetServersFailed, "failed to get servers")
		return
	}

	if servers == nil {
		servers = []*domain.Server{}
	}

	h.sendJSON(w, http.StatusOK, servers)
}

func (h *ServerHandler) JoinServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	if err := h.serverUseCase.JoinServer(serverID, userID); err != nil {
		// Приватный сервер отвечает тем же 404, что и GetServer — анти-энумерация.
		// Остальные ошибки (уже участник/владелец) намеренно остаются как есть:
		// клиент (AppPage.tsx handleJoinServer) распознаёт их по тексту сообщения.
		if errors.Is(err, domain.ErrServerNotFound) {
			h.sendError(w, http.StatusNotFound, httperr.CodeServerNotFound, "server not found")
			return
		}
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

func (h *ServerHandler) LeaveServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	if err := h.serverUseCase.LeaveServer(serverID, userID); err != nil {
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, err.Error())
		return
	}

	w.WriteHeader(http.StatusNoContent)
}

// UpdateServerRequest: IsPrivate — указатель, тем же приёмом, что раньше
// защищал приватность канала от PATCH без этого ключа (см. историю VYC-59) —
// отсутствие ключа обязано оставить приватность нетронутой, а не сбросить в false.
type UpdateServerRequest struct {
	Name      string `json:"name"`
	IsPrivate *bool  `json:"is_private"`
}

func (h *ServerHandler) UpdateServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	var req UpdateServerRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeServerNameRequired, "server name is required")
		return
	}
	if len(req.Name) > 100 {
		h.sendError(w, http.StatusBadRequest, httperr.CodeServerNameTooLong, "server name must be 100 characters or fewer")
		return
	}

	server, err := h.serverUseCase.UpdateServer(serverID, userID, req.Name, req.IsPrivate)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.broadcast(serverID, &ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}

type deleteServerPayload struct {
	ID uuid.UUID `json:"id"`
}

func (h *ServerHandler) DeleteServer(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	// GetServerAudience должен быть посчитан до удаления — после DeleteServer
	// сервера уже не будет в БД, чтобы определить его приватность и участников.
	audience, audErr := h.serverUseCase.GetServerAudience(serverID)

	if err := h.serverUseCase.DeleteServer(serverID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(deleteServerPayload{ID: serverID})
	msg := &ws.Message{Type: "server_delete", Payload: payload}
	switch {
	case audErr != nil:
		// Та же fail-closed логика, что в broadcast(): не смогли определить
		// аудиторию — не рассылаем вообще, а не глобально всем подключённым.
		h.log.Error("failed to resolve server audience, dropping server_delete broadcast", "server_id", serverID, "error", audErr)
	case audience != nil:
		h.hub.SendToUsers(audience, msg)
	default:
		h.hub.BroadcastMessage(msg)
	}

	w.WriteHeader(http.StatusNoContent)
}

type CreateChannelRequest struct {
	Name string             `json:"name"`
	Type domain.ChannelType `json:"type"`
}

func (h *ServerHandler) CreateChannel(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	var req CreateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}

	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeChannelNameRequired, "channel name is required")
		return
	}

	if req.Type == "" {
		req.Type = domain.ChannelTypeText
	}

	userID := r.Context().Value("user_id").(uuid.UUID)

	channel, err := h.serverUseCase.CreateChannel(serverID, userID, req.Name, req.Type)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(channel)
	h.broadcast(serverID, &ws.Message{Type: "channel_create", Payload: payload})

	h.sendJSON(w, http.StatusCreated, channel)
}

func (h *ServerHandler) GetChannels(w http.ResponseWriter, r *http.Request) {
	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	userID := r.Context().Value("user_id").(uuid.UUID)

	channels, err := h.serverUseCase.GetChannels(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	if channels == nil {
		channels = []*domain.Channel{}
	}

	h.sendJSON(w, http.StatusOK, channels)
}

type UpdateChannelRequest struct {
	Name string `json:"name"`
}

func (h *ServerHandler) UpdateChannel(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	var req UpdateChannelRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeChannelNameRequired, "channel name is required")
		return
	}
	if len(req.Name) > 100 {
		h.sendError(w, http.StatusBadRequest, httperr.CodeChannelNameTooLong, "channel name must be 100 characters or fewer")
		return
	}

	channel, err := h.serverUseCase.UpdateChannel(serverID, channelID, userID, req.Name)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(channel)
	h.broadcast(serverID, &ws.Message{Type: "channel_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, channel)
}

type deleteChannelPayload struct {
	ID       uuid.UUID `json:"id"`
	ServerID uuid.UUID `json:"server_id"`
}

func (h *ServerHandler) DeleteChannel(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	serverID, err := uuid.Parse(r.PathValue("server_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}
	channelID, err := uuid.Parse(r.PathValue("channel_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
		return
	}

	if err := h.serverUseCase.DeleteChannel(serverID, channelID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(deleteChannelPayload{ID: channelID, ServerID: serverID})
	h.broadcast(serverID, &ws.Message{Type: "channel_delete", Payload: payload})

	w.WriteHeader(http.StatusNoContent)
}

func (h *ServerHandler) GetMembers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("server_id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	members, err := h.serverUseCase.GetMembers(serverID, userID)
	if err != nil {
		if errors.Is(err, domain.ErrForbidden) {
			h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
			return
		}
		h.sendError(w, http.StatusInternalServerError, httperr.CodeGetMembersFailed, "failed to get members")
		return
	}

	if members == nil {
		members = []*domain.MemberWithUser{}
	}

	h.sendJSON(w, http.StatusOK, members)
}

func (h *ServerHandler) SearchServers(w http.ResponseWriter, r *http.Request) {
	query := r.URL.Query().Get("q")
	if query == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeSearchQueryRequired, "query parameter 'q' is required")
		return
	}

	limit := 20
	if limitStr := r.URL.Query().Get("limit"); limitStr != "" {
		if _, err := fmt.Sscanf(limitStr, "%d", &limit); err != nil {
			limit = 20
		}
	}

	servers, err := h.serverUseCase.SearchServers(query, limit)
	if err != nil {
		h.sendError(w, http.StatusInternalServerError, httperr.CodeSearchServersFail, "failed to search servers")
		return
	}

	if servers == nil {
		servers = []*domain.Server{}
	}

	h.sendJSON(w, http.StatusOK, servers)
}

const (
	// maxServerIconRequestBytes ограничивает multipart-запрос целиком — чуть
	// больше maxServerIconFileBytes, чтобы оставить место под границы/заголовки.
	maxServerIconRequestBytes = 3 << 20
	// maxServerIconFileBytes — лимит на сам файл иконки.
	maxServerIconFileBytes = 2 << 20
)

// UploadServerIcon принимает multipart/form-data с полем "icon" (PNG/JPEG,
// ≤2MB), сохраняет его, обновляет icon_url сервера и рассылает server_update.
func (h *ServerHandler) UploadServerIcon(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxServerIconRequestBytes)
	if err := r.ParseMultipartForm(maxServerIconRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeIconTooLarge, "icon file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	file, _, err := r.FormFile("icon")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeIconRequired, "icon file is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxServerIconFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeIconReadFailed, "failed to read icon file")
		return
	}
	if len(data) > maxServerIconFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeIconTooLarge, "icon file is too large")
		return
	}

	server, err := h.serverUseCase.UpdateServerIcon(serverID, userID, data)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.broadcast(serverID, &ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}

// RemoveServerIcon очищает иконку сервера и рассылает server_update.
func (h *ServerHandler) RemoveServerIcon(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	idStr := r.PathValue("id")
	serverID, err := uuid.Parse(idStr)
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	server, err := h.serverUseCase.RemoveServerIcon(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}

	payload, _ := json.Marshal(server)
	h.broadcast(serverID, &ws.Message{Type: "server_update", Payload: payload})

	h.sendJSON(w, http.StatusOK, server)
}

// writeUseCaseError транслирует доменные ошибки usecase-слоя серверов/каналов
// в HTTP-статусы, не раскрывая внутренние детали (err.Error()) наружу.
func (h *ServerHandler) writeUseCaseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrServerNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeServerNotFound, "server not found")
	case errors.Is(err, domain.ErrServerNameTaken):
		h.sendError(w, http.StatusConflict, httperr.CodeServerNameTaken, "server with this name already exists")
	case errors.Is(err, domain.ErrChannelNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeChannelNotFound, "channel not found")
	case errors.Is(err, domain.ErrLastChannel):
		h.sendError(w, http.StatusBadRequest, httperr.CodeLastChannel, "cannot delete the last channel of a server")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	case errors.Is(err, domain.ErrChannelForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeChannelForbidden, "channel access denied")
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, httperr.CodeUnsupportedImageType, "unsupported format: only PNG and JPEG are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImage, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImageSize, "image dimensions are out of allowed range")
	default:
		h.log.Error("server request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *ServerHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *ServerHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
