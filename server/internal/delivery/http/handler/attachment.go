package handler

import (
	"encoding/json"
	"errors"
	"io"
	"log/slog"
	"net/http"
	"os"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/attachlink"
	"github.com/vycord/server/pkg/filestorage"
)

type AttachmentHandler struct {
	uc     domain.AttachmentUseCase
	signer *attachlink.Signer
	// maxRequestBytes — предохранитель на сырое тело запроса. Настоящий лимит
	// файла живёт в тарифном плане и проверяется в QuotaUseCase; здесь только
	// защита от бесконечного тела.
	maxRequestBytes int64
	log             *slog.Logger
}

func NewAttachmentHandler(uc domain.AttachmentUseCase, signer *attachlink.Signer, maxRequestBytes int64, log *slog.Logger) *AttachmentHandler {
	return &AttachmentHandler{uc: uc, signer: signer, maxRequestBytes: maxRequestBytes, log: log}
}

// SignAttachments проставляет подписанные ссылки. Вызывается везде, где
// вложения уходят наружу: и здесь, и в обработчике сообщений.
func SignAttachments(signer *attachlink.Signer, atts []*domain.Attachment) {
	for _, a := range atts {
		a.URL = signer.ContentURL(a.ID)
		if a.Kind == domain.AttachmentKindImage {
			a.ThumbURL = signer.ThumbURL(a.ID)
		}
	}
}

// Upload принимает multipart/form-data с полями channel_id и file.
//
// Тело читается потоком через MultipartReader и сразу пишется во временный
// файл: ParseMultipartForm + io.ReadAll (как в загрузке стикеров) держал бы
// весь файл в памяти — на 25 МБ это 25 МБ RSS на каждую параллельную загрузку.
func (h *AttachmentHandler) Upload(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)

	r.Body = http.MaxBytesReader(w, r.Body, h.maxRequestBytes)
	mr, err := r.MultipartReader()
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid multipart body")
		return
	}

	var (
		channelID uuid.UUID
		haveChan  bool
		fileName  string
		tmp       *os.File
		size      int64
	)
	defer func() {
		if tmp != nil {
			tmp.Close()
			os.Remove(tmp.Name())
		}
	}()

	for {
		part, err := mr.NextPart()
		if errors.Is(err, io.EOF) {
			break
		}
		if err != nil {
			h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "invalid multipart body")
			return
		}

		switch part.FormName() {
		case "channel_id":
			raw, err := io.ReadAll(io.LimitReader(part, 128))
			part.Close()
			if err != nil {
				h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
				return
			}
			channelID, err = uuid.Parse(string(raw))
			if err != nil {
				h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "invalid channel id")
				return
			}
			haveChan = true
		case "file":
			// Второй файл в одном запросе не принимаем: контракт — одно
			// вложение на запрос. Без этой проверки повторная часть с тем же
			// именем перезаписала бы переменную tmp, и предыдущий временный
			// файл остался бы на диске навсегда: defer замыкается на
			// переменную и на выходе видит только последнее значение.
			// Любой авторизованный клиент мог бы так забить диск.
			if tmp != nil {
				part.Close()
				h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "only one file per request is allowed")
				return
			}
			// channel_id обязан прийти раньше файла. Порядок частей задаёт
			// клиент, и без этой проверки сервер запишет на диск до 25 МБ
			// прежде, чем сработает грошовая проверка UUID.
			if !haveChan {
				part.Close()
				h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "channel_id must precede the file part")
				return
			}

			fileName = part.FileName()
			tmp, err = os.CreateTemp("", "vycord-upload-*")
			if err != nil {
				part.Close()
				h.log.Error("create temp file failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
				h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
				return
			}
			size, err = io.Copy(tmp, io.LimitReader(part, h.maxRequestBytes+1))
			part.Close()
			if err != nil {
				h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidBody, "failed to read uploaded file")
				return
			}
			if size > h.maxRequestBytes {
				h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeAttachmentTooLarge, "file is too large")
				return
			}
		default:
			part.Close()
		}
	}

	if !haveChan {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidChannelID, "channel id is required")
		return
	}
	if tmp == nil || fileName == "" {
		h.sendError(w, http.StatusBadRequest, httperr.CodeAttachmentRequired, "file is required")
		return
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		h.log.Error("rewind temp file failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
		return
	}

	att, err := h.uc.Upload(domain.AttachmentUpload{
		ChannelID: channelID,
		UserID:    userID,
		FileName:  fileName,
		Size:      size,
		Content:   tmp,
	})
	if err != nil {
		h.writeError(w, r, err)
		return
	}

	SignAttachments(h.signer, []*domain.Attachment{att})
	h.sendJSON(w, http.StatusCreated, att)
}

// Get отдаёт метаданные со свежей подписью — им клиент чинит протухшую ссылку.
func (h *AttachmentHandler) Get(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidAttachmentID, "invalid attachment id")
		return
	}

	att, err := h.uc.GetForUser(id, userID)
	if err != nil {
		h.writeError(w, r, err)
		return
	}

	SignAttachments(h.signer, []*domain.Attachment{att})
	h.sendJSON(w, http.StatusOK, att)
}

func (h *AttachmentHandler) Delete(w http.ResponseWriter, r *http.Request) {
	userID := r.Context().Value("user_id").(uuid.UUID)
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidAttachmentID, "invalid attachment id")
		return
	}

	if err := h.uc.Delete(id, userID); err != nil {
		h.writeError(w, r, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (h *AttachmentHandler) writeError(w http.ResponseWriter, r *http.Request, err error) {
	switch {
	case errors.Is(err, domain.ErrAttachmentTooLarge):
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeAttachmentTooLarge, "file is too large")
	case errors.Is(err, domain.ErrStorageQuotaExceeded):
		h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeStorageQuotaExceeded, "storage quota exceeded")
	case errors.Is(err, domain.ErrAttachmentAlreadyAttached):
		h.sendError(w, http.StatusConflict, httperr.CodeAttachmentAlreadyAttached, "attachment is already attached to a message")
	case errors.Is(err, domain.ErrAttachmentNotFound), errors.Is(err, filestorage.ErrNotFound):
		h.sendError(w, http.StatusNotFound, httperr.CodeAttachmentNotFound, "attachment not found")
	case errors.Is(err, domain.ErrForbidden):
		h.sendError(w, http.StatusForbidden, httperr.CodeForbidden, "access denied")
	default:
		h.log.Error("attachment request failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		h.sendError(w, http.StatusInternalServerError, httperr.CodeInternalError, "internal server error")
	}
}

func (h *AttachmentHandler) sendJSON(w http.ResponseWriter, status int, data interface{}) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(data); err != nil {
		h.log.Error("encode attachment response failed", "error", err)
	}
}

func (h *AttachmentHandler) sendError(w http.ResponseWriter, status int, code, message string) {
	httperr.Write(w, status, code, message)
}
