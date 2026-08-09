package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
)

const (
	// maxStickerRequestBytes — лимит сырого multipart-тела запроса стикера.
	maxStickerRequestBytes = 3 << 20
	// maxStickerFileBytes — лимит содержимого файла стикера.
	maxStickerFileBytes = 2 << 20
)

type StickerHandler struct {
	stickerUseCase domain.StickerUseCase
	log            *slog.Logger
}

func NewStickerHandler(stickerUseCase domain.StickerUseCase, log *slog.Logger) *StickerHandler {
	return &StickerHandler{stickerUseCase: stickerUseCase, log: log}
}

// CreateSticker принимает multipart/form-data с полями "name" и "image" (PNG/JPEG, ≤2MB).
func (h *StickerHandler) CreateSticker(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	r.Body = http.MaxBytesReader(w, r.Body, maxStickerRequestBytes)
	if err := r.ParseMultipartForm(maxStickerRequestBytes); err != nil {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeStickerTooLarge, "sticker file is too large")
		return
	}
	defer r.MultipartForm.RemoveAll()

	name := r.FormValue("name")
	file, _, err := r.FormFile("image")
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerImageRequired, "sticker image is required")
		return
	}
	defer file.Close()

	data, err := io.ReadAll(io.LimitReader(file, maxStickerFileBytes+1))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerReadFailed, "failed to read sticker file")
		return
	}
	if len(data) > maxStickerFileBytes {
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeStickerTooLarge, "sticker file is too large")
		return
	}

	sticker, err := h.stickerUseCase.CreateSticker(serverID, userID, name, data)
	if err != nil {
		h.writeStickerError(w, r, err)
		return
	}

	h.sendJSON(w, http.StatusCreated, sticker)
}

func (h *StickerHandler) ListStickers(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}

	stickers, err := h.stickerUseCase.ListStickers(serverID, userID)
	if err != nil {
		h.writeStickerError(w, r, err)
		return
	}
	if stickers == nil {
		stickers = []*domain.Sticker{}
	}
	h.sendJSON(w, http.StatusOK, stickers)
}

func (h *StickerHandler) DeleteSticker(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	serverID, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidServerID, "invalid server id")
		return
	}
	stickerID, err := uuid.Parse(r.PathValue("sticker_id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidStickerID, "invalid sticker id")
		return
	}

	if err := h.stickerUseCase.DeleteSticker(serverID, stickerID, userID); err != nil {
		h.writeStickerError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *StickerHandler) writeStickerError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrStickerForbidden), errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	case errors.Is(err, domain.ErrStickerNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeStickerNotFound, "sticker not found")
	case errors.Is(err, domain.ErrStickerNameRequired):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerNameRequired, "sticker name is required")
	case errors.Is(err, domain.ErrStickerNameTooLong):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerNameTooLong, "sticker name is too long")
	case errors.Is(err, domain.ErrStickerImageRequired):
		h.sendError(w, http.StatusBadRequest, httperr.CodeStickerImageRequired, "sticker image is required")
	case errors.Is(err, domain.ErrUnsupportedAvatarFormat):
		h.sendError(w, http.StatusBadRequest, httperr.CodeUnsupportedImageType, "unsupported format: only PNG and JPEG are allowed")
	case errors.Is(err, domain.ErrInvalidAvatarImage):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImage, "invalid image file")
	case errors.Is(err, domain.ErrInvalidAvatarDimensions):
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidImageSize, "image dimensions are out of allowed range")
	default:
		h.log.Error("sticker request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *StickerHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(data)
}

func (h *StickerHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}