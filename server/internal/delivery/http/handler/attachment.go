package handler

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/delivery/http/httperr"
	"github.com/vycord/server/internal/delivery/http/middleware"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/attachlink"
	"github.com/vycord/server/pkg/filestorage"
)

type AttachmentHandler struct {
	uc     domain.AttachmentUseCase
	quota  domain.QuotaUseCase
	signer *attachlink.Signer
	// maxRequestBytes — предохранитель на сырое тело запроса. Настоящий лимит
	// файла живёт в тарифном плане и проверяется в QuotaUseCase; здесь только
	// защита от бесконечного тела.
	maxRequestBytes int64
	log             *slog.Logger
}

func NewAttachmentHandler(uc domain.AttachmentUseCase, quota domain.QuotaUseCase, signer *attachlink.Signer, maxRequestBytes int64, log *slog.Logger) *AttachmentHandler {
	return &AttachmentHandler{uc: uc, quota: quota, signer: signer, maxRequestBytes: maxRequestBytes, log: log}
}

// multipartEnvelopeSlack — запас, с которым ранняя проверка по Content-Length
// (см. Upload) сравнивает заявленный размер тела с лимитом плана.
// Content-Length — это размер ВСЕГО multipart-тела: сам файл плюс границы
// частей, их заголовки (Content-Disposition, Content-Type) и поле
// channel_id. Он всегда больше файла внутри, поэтому наивное сравнение
// "ContentLength > лимит" забраковало бы валидный файл, чей конверт
// вылез за лимит на десяток-другой байт. Берём запас заведомо
// избыточным (единицы килобайт — реальный конверт multipart весит
// десятки-сотни байт), чтобы ранняя проверка никогда не дала ложный
// отказ: цена ошибки в другую сторону — лишняя запись на диск, которую
// всё равно отбракует точная проверка ниже по потоку.
const multipartEnvelopeSlack = 8 * 1024

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

	// Ранний отказ по заявленной длине — до r.MultipartReader(), то есть до
	// того, как сервер вообще начнёт читать и писать тело на диск. Находка
	// I6: без этой проверки любой авторизованный пользователь заставлял
	// сервер записывать на диск до maxRequestBytes на каждый обречённый
	// запрос. r.ContentLength == -1 при chunked-передаче без заявленной
	// длины — тогда просто пропускаем раннюю проверку и полагаемся на позднюю
	// ниже по потоку; здесь мы выигрываем только скорость отказа, а не
	// корректность.
	if r.ContentLength >= 0 {
		q, err := h.quota.For(userID)
		if err != nil {
			// Не смогли узнать лимит — не блокируем загрузку из-за
			// оптимизации: точную проверку всё равно сделает поздний путь
			// через QuotaUseCase.CheckUpload.
			h.log.Error("get quota for early upload check failed", "request_id", middleware.RequestIDFromContext(r.Context()), "error", err)
		} else if r.ContentLength > q.MaxFileBytes+multipartEnvelopeSlack {
			h.sendError(w, http.StatusRequestEntityTooLarge, httperr.CodeAttachmentTooLarge, "file is too large")
			return
		}
	}

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

// ContentURLFor и ThumbURLFor открывают подпись наружу — ими пользуются тесты
// и проводка маршрутов; на боевом пути ссылки ставит SignAttachments.
func (h *AttachmentHandler) ContentURLFor(id uuid.UUID) string { return h.signer.ContentURL(id) }
func (h *AttachmentHandler) ThumbURLFor(id uuid.UUID) string   { return h.signer.ThumbURL(id) }

// Content отдаёт файл. Авторизации по заголовку здесь нет и быть не может:
// <img src> и <video src> не умеют слать Authorization, поэтому доступ даёт
// подпись в самом URL.
func (h *AttachmentHandler) Content(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, false)
}

// Thumb отдаёт миниатюру, а если её нет — оригинал (решает usecase).
func (h *AttachmentHandler) Thumb(w http.ResponseWriter, r *http.Request) {
	h.serve(w, r, true)
}

func (h *AttachmentHandler) serve(w http.ResponseWriter, r *http.Request, thumb bool) {
	id, err := uuid.Parse(r.PathValue("id"))
	if err != nil {
		h.sendError(w, http.StatusBadRequest, httperr.CodeInvalidAttachmentID, "invalid attachment id")
		return
	}

	q := r.URL.Query()
	if err := h.signer.Verify(id, q.Get("exp"), q.Get("sig")); err != nil {
		// Протухшую и подделанную подпись отдаём одинаково: клиент в обоих
		// случаях делает одно и то же — запрашивает свежую ссылку.
		h.sendError(w, http.StatusForbidden, httperr.CodeAttachmentLinkExpired, "attachment link is expired or invalid")
		return
	}

	var (
		att  *domain.Attachment
		body io.ReadSeekCloser
	)
	if thumb {
		att, body, err = h.uc.OpenThumb(id)
	} else {
		att, body, err = h.uc.OpenContent(id)
	}
	if err != nil {
		h.writeError(w, r, err)
		return
	}
	defer body.Close()

	contentType := att.ContentType
	disposition := "inline"
	// Всё, что не медиа, отдаём октет-потоком и вложением: так ничто из
	// загруженного не выполнится как скрипт в контексте приложения.
	// Проверка намеренно НЕ зависит от thumb: подпись покрывает id и срок, но
	// не путь, поэтому ссылку на /content можно предъявить и на /thumb.
	if att.Kind == domain.AttachmentKindFile {
		contentType = "application/octet-stream"
		disposition = "attachment"
	}
	// Миниатюра всегда перекодирована в JPEG (см. AnalyzeImage), а в БД лежит
	// content-type оригинала. Без этой поправки PNG-вложение отдавало бы
	// JPEG-байты под видом image/png.
	if thumb && att.ThumbKey != "" {
		contentType = "image/jpeg"
	}
	if r.URL.Query().Get("download") == "1" {
		disposition = "attachment"
	}

	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Content-Disposition", contentDisposition(disposition, att.FileName))
	// Ссылка подписана и протухает, поэтому кэшировать у клиента безопасно и
	// полезно: лента не перекачивает миниатюры при каждом скролле.
	w.Header().Set("Cache-Control", "private, max-age=86400")

	// ServeContent сам разбирает Range — без него не перемотать видео и аудио.
	http.ServeContent(w, r, att.FileName, att.CreatedAt, body)
}

// contentDisposition кодирует имя по RFC 5987: без filename*=UTF-8'' любое
// не-ASCII имя превратится в мусор. ASCII-фолбэк оставляем для очень старых
// клиентов.
//
// Пустая строка ниже отвязывает комментарий от объявления намеренно: начиная с
// Go 1.19 gofmt переформатирует doc-комментарии и превращает пару апострофов в
// типографскую кавычку, испортив записанный здесь синтаксис RFC 5987.

func contentDisposition(disposition, name string) string {
	return fmt.Sprintf("%s; filename=\"%s\"; filename*=UTF-8''%s",
		disposition, asciiFallback(name), url.PathEscape(name))
}

func asciiFallback(name string) string {
	var b strings.Builder
	for _, r := range name {
		if r < 0x20 || r > 0x7E || r == '"' || r == '\\' {
			b.WriteByte('_')
			continue
		}
		b.WriteRune(r)
	}
	if b.Len() == 0 {
		return "file"
	}
	return b.String()
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
