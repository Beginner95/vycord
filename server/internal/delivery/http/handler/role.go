package handler

import (
	"encoding/json"
	"errors"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

type RoleHandler struct {
	roleUseCase domain.RoleUseCase
	permUseCase domain.PermissionUseCase
	log         *slog.Logger
}

func NewRoleHandler(roleUseCase domain.RoleUseCase, permUseCase domain.PermissionUseCase, log *slog.Logger) *RoleHandler {
	return &RoleHandler{roleUseCase: roleUseCase, permUseCase: permUseCase, log: log}
}

type CreateRoleRequest struct {
	Name        string            `json:"name"`
	Color       int               `json:"color"`
	Position    int               `json:"position"`
	Permissions domain.Permission `json:"permissions"`
}

type UpdateRoleRequest struct {
	Name        *string            `json:"name"`
	Color       *int               `json:"color"`
	Position    *int               `json:"position"`
	Permissions *domain.Permission `json:"permissions"`
}

// pathIDs достаёт serverID и опциональные roleID/userID из пути.
func (h *RoleHandler) pathUUID(w http.ResponseWriter, r *http.Request, key, label string) (uuid.UUID, bool) {
	id, err := uuid.Parse(r.PathValue(key))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid "+label)
		return uuid.Nil, false
	}
	return id, true
}

func (h *RoleHandler) ListRoles(w http.ResponseWriter, r *http.Request) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return
	}
	userID := r.Context().Value("user_id").(uuid.UUID)

	roles, err := h.roleUseCase.ListRoles(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusOK, roles)
}

func (h *RoleHandler) CreateRole(w http.ResponseWriter, r *http.Request) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return
	}
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req CreateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	role, err := h.roleUseCase.CreateRole(serverID, userID, req.Name, req.Color, req.Position, req.Permissions)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusCreated, role)
}

func (h *RoleHandler) UpdateRole(w http.ResponseWriter, r *http.Request) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return
	}
	roleID, ok := h.pathUUID(w, r, "role_id", "role id")
	if !ok {
		return
	}
	userID := r.Context().Value("user_id").(uuid.UUID)

	var req UpdateRoleRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		h.sendError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	role, err := h.roleUseCase.UpdateRole(serverID, roleID, userID, domain.RolePatch{
		Name:        req.Name,
		Color:       req.Color,
		Position:    req.Position,
		Permissions: req.Permissions,
	})
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	h.sendJSON(w, http.StatusOK, role)
}

func (h *RoleHandler) DeleteRole(w http.ResponseWriter, r *http.Request) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return
	}
	roleID, ok := h.pathUUID(w, r, "role_id", "role id")
	if !ok {
		return
	}
	userID := r.Context().Value("user_id").(uuid.UUID)

	if err := h.roleUseCase.DeleteRole(serverID, roleID, userID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoleHandler) AssignRole(w http.ResponseWriter, r *http.Request) {
	serverID, roleID, targetID, ok := h.assignmentPath(w, r)
	if !ok {
		return
	}
	actorID := r.Context().Value("user_id").(uuid.UUID)

	if err := h.roleUseCase.AssignRole(serverID, targetID, roleID, actorID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoleHandler) UnassignRole(w http.ResponseWriter, r *http.Request) {
	serverID, roleID, targetID, ok := h.assignmentPath(w, r)
	if !ok {
		return
	}
	actorID := r.Context().Value("user_id").(uuid.UUID)

	if err := h.roleUseCase.UnassignRole(serverID, targetID, roleID, actorID); err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *RoleHandler) assignmentPath(w http.ResponseWriter, r *http.Request) (uuid.UUID, uuid.UUID, uuid.UUID, bool) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	targetID, ok := h.pathUUID(w, r, "user_id", "user id")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	roleID, ok := h.pathUUID(w, r, "role_id", "role id")
	if !ok {
		return uuid.Nil, uuid.Nil, uuid.Nil, false
	}
	return serverID, roleID, targetID, true
}

// GetMyPermissions отдаёт эффективные права текущего пользователя на сервере.
// Не-участник получает 403, а не пустой набор: наличие сервера не должно
// подтверждаться постороннему.
func (h *RoleHandler) GetMyPermissions(w http.ResponseWriter, r *http.Request) {
	serverID, ok := h.pathUUID(w, r, "server_id", "server id")
	if !ok {
		return
	}
	userID := r.Context().Value("user_id").(uuid.UUID)

	ps, err := h.permUseCase.Resolve(serverID, userID)
	if err != nil {
		h.writeUseCaseError(w, r, err)
		return
	}
	if !ps.IsOwner && ps.HighestPosition < 0 {
		h.sendError(w, http.StatusForbidden, "access denied")
		return
	}
	h.sendJSON(w, http.StatusOK, ps)
}

func (h *RoleHandler) writeUseCaseError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrServerNotFound):
		h.sendError(w, http.StatusNotFound, "server not found")
	case errors.Is(err, domain.ErrRoleNotFound):
		h.sendError(w, http.StatusNotFound, "role not found")
	case errors.Is(err, domain.ErrInvalidPermissions):
		h.sendError(w, http.StatusBadRequest, "invalid permissions")
	case errors.Is(err, domain.ErrInvalidRoleName):
		h.sendError(w, http.StatusBadRequest, "invalid role name")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, "access denied")
	default:
		h.log.Error("role request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, "internal server error")
	}
}

func (h *RoleHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *RoleHandler) sendError(w http.ResponseWriter, status int, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}
