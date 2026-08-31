package handler_test

import (
	"bytes"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
)

// nopSeekCloser превращает bytes.Reader в io.ReadSeekCloser.
type nopSeekCloser struct{ *bytes.Reader }

func (nopSeekCloser) Close() error { return nil }

func contentRequest(t *testing.T, h interface{ ContentURLFor(uuid.UUID) string }, id uuid.UUID, extraQuery string) *http.Request {
	t.Helper()
	link := h.ContentURLFor(id)
	if extraQuery != "" {
		link += "&" + extraQuery
	}
	req := httptest.NewRequest(http.MethodGet, link, nil)
	req.SetPathValue("id", id.String())
	return req
}

func TestContentServesFileInline(t *testing.T) {
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindImage, ContentType: "image/png", FileName: "pic.png",
	}, nopSeekCloser{bytes.NewReader([]byte("image-bytes"))}, nil)
	h := newAttachmentHandler(uc)

	rec := httptest.NewRecorder()
	h.Content(rec, contentRequest(t, h, id, ""))

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline"))
	assert.Equal(t, "image-bytes", rec.Body.String())
}

func TestContentForcesDownloadWithQueryFlag(t *testing.T) {
	// API и фронт на разных доменах: атрибут <a download> браузер для
	// кросс-доменной ссылки игнорирует, поэтому имя задаёт сервер.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindImage, ContentType: "image/png", FileName: "pic.png",
	}, nopSeekCloser{bytes.NewReader([]byte("x"))}, nil)
	h := newAttachmentHandler(uc)

	rec := httptest.NewRecorder()
	h.Content(rec, contentRequest(t, h, id, "download=1"))

	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment"))
}

func TestContentAlwaysDownloadsGenericFiles(t *testing.T) {
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindFile, ContentType: "application/pdf", FileName: "doc.pdf",
	}, nopSeekCloser{bytes.NewReader([]byte("x"))}, nil)
	h := newAttachmentHandler(uc)

	rec := httptest.NewRecorder()
	h.Content(rec, contentRequest(t, h, id, ""))

	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment"))
	// Ничто из загруженного не должно выполниться как скрипт в контексте
	// приложения, поэтому не-медиа отдаётся октет-потоком.
	assert.Equal(t, "application/octet-stream", rec.Header().Get("Content-Type"))
}

func TestContentEncodesCyrillicFileName(t *testing.T) {
	// Без RFC 5987 кириллическое имя превращается в мусор.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindFile, ContentType: "application/pdf", FileName: "Отчёт за март.pdf",
	}, nopSeekCloser{bytes.NewReader([]byte("x"))}, nil)
	h := newAttachmentHandler(uc)

	rec := httptest.NewRecorder()
	h.Content(rec, contentRequest(t, h, id, ""))

	cd := rec.Header().Get("Content-Disposition")
	assert.Contains(t, cd, "filename*=UTF-8''")
	assert.Contains(t, cd, url.PathEscape("Отчёт за март.pdf"))
}

func TestContentSupportsRangeRequests(t *testing.T) {
	// Без Range нельзя перемотать видео и аудио.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindVideo, ContentType: "video/mp4", FileName: "clip.mp4",
	}, nopSeekCloser{bytes.NewReader([]byte("0123456789"))}, nil)
	h := newAttachmentHandler(uc)

	req := contentRequest(t, h, id, "")
	req.Header.Set("Range", "bytes=2-5")
	rec := httptest.NewRecorder()
	h.Content(rec, req)

	assert.Equal(t, http.StatusPartialContent, rec.Code)
	assert.Equal(t, "2345", rec.Body.String())
}

func TestContentRejectsMissingSignature(t *testing.T) {
	id := uuid.New()
	h := newAttachmentHandler(new(MockAttachmentUseCase))

	req := httptest.NewRequest(http.MethodGet, "/api/v1/attachments/"+id.String()+"/content", nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Content(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
	assert.Contains(t, rec.Body.String(), "attachment_link_expired")
}

func TestContentRejectsTamperedSignature(t *testing.T) {
	id := uuid.New()
	h := newAttachmentHandler(new(MockAttachmentUseCase))

	req := httptest.NewRequest(http.MethodGet,
		"/api/v1/attachments/"+id.String()+"/content?exp=99999999999&sig=deadbeef", nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Content(rec, req)

	assert.Equal(t, http.StatusForbidden, rec.Code)
}

func TestThumbServesThumbnail(t *testing.T) {
	// ThumbKey пуст — usecase откатился на оригинал (для картинки это
	// допустимо), поэтому Content-Type остаётся типом оригинала.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenThumb", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindImage, ContentType: "image/png", FileName: "pic.png",
	}, nopSeekCloser{bytes.NewReader([]byte("thumb-bytes"))}, nil)
	h := newAttachmentHandler(uc)

	link := h.ThumbURLFor(id)
	req := httptest.NewRequest(http.MethodGet, link, nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Thumb(rec, req)

	require.Equal(t, http.StatusOK, rec.Code)
	assert.Equal(t, "thumb-bytes", rec.Body.String())
	assert.Equal(t, "image/png", rec.Header().Get("Content-Type"))
	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Disposition"), "inline"))
}

func TestThumbRejectsNonImageAttachment(t *testing.T) {
	// Подпись не покрывает путь, поэтому ссылку на /content можно предъявить
	// и на /thumb. Не-картинка обязана отвечать «не найдено», иначе через этот
	// путь отдаётся оригинал в обход принудительного octet-stream.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenThumb", id).Return(nil, nil, domain.ErrAttachmentNotFound)
	h := newAttachmentHandler(uc)

	req := httptest.NewRequest(http.MethodGet, h.ThumbURLFor(id), nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Thumb(rec, req)

	assert.Equal(t, http.StatusNotFound, rec.Code)
}

func TestContentForcesOctetStreamOnThumbPathToo(t *testing.T) {
	// Подстраховка на случай, если через /thumb всё же дойдёт не-медиа.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenThumb", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindFile, ContentType: "text/html", FileName: "evil.html",
	}, nopSeekCloser{bytes.NewReader([]byte("<script>alert(1)</script>"))}, nil)
	h := newAttachmentHandler(uc)

	req := httptest.NewRequest(http.MethodGet, h.ThumbURLFor(id), nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Thumb(rec, req)

	assert.Equal(t, "application/octet-stream", rec.Header().Get("Content-Type"))
	assert.True(t, strings.HasPrefix(rec.Header().Get("Content-Disposition"), "attachment"))
}

func TestThumbServesJPEGContentType(t *testing.T) {
	// Миниатюра всегда JPEG, даже если оригинал PNG.
	id := uuid.New()
	uc := new(MockAttachmentUseCase)
	uc.On("OpenThumb", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindImage, ContentType: "image/png",
		FileName: "pic.png", ThumbKey: "attachments/c/x_thumb.jpg",
	}, nopSeekCloser{bytes.NewReader([]byte("jpeg-bytes"))}, nil)
	h := newAttachmentHandler(uc)

	req := httptest.NewRequest(http.MethodGet, h.ThumbURLFor(id), nil)
	req.SetPathValue("id", id.String())
	rec := httptest.NewRecorder()
	h.Thumb(rec, req)

	assert.Equal(t, "image/jpeg", rec.Header().Get("Content-Type"))
}

func TestContentClosesFile(t *testing.T) {
	// Незакрытый файловый дескриптор на каждой отдаче — верный способ упереться
	// в лимит открытых файлов на проде.
	id := uuid.New()
	f := &trackingSeekCloser{Reader: bytes.NewReader([]byte("x"))}
	uc := new(MockAttachmentUseCase)
	uc.On("OpenContent", id).Return(&domain.Attachment{
		ID: id, Kind: domain.AttachmentKindFile, ContentType: "application/pdf", FileName: "d.pdf",
	}, f, nil)
	h := newAttachmentHandler(uc)

	rec := httptest.NewRecorder()
	h.Content(rec, contentRequest(t, h, id, ""))

	assert.True(t, f.closed, "файл обязан быть закрыт после отдачи")
}

type trackingSeekCloser struct {
	*bytes.Reader
	closed bool
}

func (t *trackingSeekCloser) Close() error { t.closed = true; return nil }

var _ io.ReadSeekCloser = (*trackingSeekCloser)(nil)
