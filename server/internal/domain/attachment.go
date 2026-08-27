package domain

import (
	"io"
	"time"

	"github.com/google/uuid"
)

// AttachmentKind — как вложение показывать в ленте. Значения совпадают с
// CHECK-ограничением колонки attachments.kind (миграция 018).
type AttachmentKind string

const (
	AttachmentKindImage AttachmentKind = "image"
	AttachmentKindVideo AttachmentKind = "video"
	AttachmentKindAudio AttachmentKind = "audio"
	// AttachmentKindFile — всё, что не удалось надёжно опознать как медиа.
	// Такое вложение рендерится карточкой со скачиванием и никогда не
	// попадает в <img>/<video>.
	AttachmentKindFile AttachmentKind = "file"
)

func (k AttachmentKind) IsValid() bool {
	switch k {
	case AttachmentKindImage, AttachmentKindVideo, AttachmentKindAudio, AttachmentKindFile:
		return true
	}
	return false
}

// Attachment — файл, приложенный к сообщению.
//
// StorageKey/ThumbKey наружу не отдаются: клиент работает только с
// подписанными URL, которые проставляются при сериализации (см. pkg/attachlink).
// Благодаря этому раскладку файлов на диске можно менять, не трогая БД.
type Attachment struct {
	ID          uuid.UUID      `json:"id"`
	UserID      uuid.UUID      `json:"user_id"`
	ChannelID   uuid.UUID      `json:"channel_id"`
	MessageID   *uuid.UUID     `json:"message_id,omitempty"`
	Kind        AttachmentKind `json:"kind"`
	FileName    string         `json:"file_name"`
	ContentType string         `json:"content_type"`
	SizeBytes   int64          `json:"size_bytes"`
	StorageKey  string         `json:"-"`
	ThumbKey    string         `json:"-"`
	Width       *int           `json:"width,omitempty"`
	Height      *int           `json:"height,omitempty"`
	ExpiresAt   *time.Time     `json:"expires_at,omitempty"`
	CreatedAt   time.Time      `json:"created_at"`

	// URL и ThumbURL в БД не хранятся — заполняются подписью перед отдачей.
	URL      string `json:"url,omitempty"`
	ThumbURL string `json:"thumb_url,omitempty"`
}

// Plan — тарифный план пользователя. Сегодня в таблице одна строка 'free',
// но лимиты читаются отсюда, а не из констант, чтобы платный план сводился
// к INSERT в plans без правок кода.
type Plan struct {
	Code          string
	MaxFileBytes  int64
	RetentionDays *int   // nil — хранить вечно
	MaxTotalBytes *int64 // nil — суммарный объём не ограничен
}

// AttachmentUpload — вход для приёма файла. Content — уже записанный на диск
// временный файл: в память файл целиком не читается нигде.
type AttachmentUpload struct {
	ChannelID uuid.UUID
	UserID    uuid.UUID
	FileName  string
	Size      int64
	Content   io.ReadSeeker
}

type AttachmentRepository interface {
	Create(a *Attachment) error
	GetByID(id uuid.UUID) (*Attachment, error)
	// ListByMessageIDs отдаёт вложения, сгруппированные по сообщению: список
	// сообщений подтягивает вложения одним запросом, а не N.
	ListByMessageIDs(messageIDs []uuid.UUID) (map[uuid.UUID][]*Attachment, error)
	// AttachToMessage привязывает вложения к сообщению одной транзакцией и
	// только если каждое из них принадлежит userID, лежит в channelID и ещё
	// не привязано. Иначе — ErrAttachmentNotFound / ErrAttachmentAlreadyAttached.
	AttachToMessage(messageID, userID, channelID uuid.UUID, ids []uuid.UUID) error
	Delete(id uuid.UUID) error
	// ListSweepable отдаёт сирот старше orphanBefore и всё протухшее по now.
	ListSweepable(now, orphanBefore time.Time, limit int) ([]*Attachment, error)
	TotalBytesByUser(userID uuid.UUID) (int64, error)
}

type PlanRepository interface {
	GetByUserID(userID uuid.UUID) (*Plan, error)
}

// Quota — действующие для пользователя лимиты, разрешённые его планом.
type Quota struct {
	MaxFileBytes  int64
	RetentionDays *int
	MaxTotalBytes *int64
}

// QuotaUseCase — единственное место, отвечающее на вопросы «можно ли залить
// файл такого размера» и «до какого числа его хранить».
type QuotaUseCase interface {
	For(userID uuid.UUID) (*Quota, error)
	CheckUpload(userID uuid.UUID, size int64) error
	ExpiresAt(userID uuid.UUID, now time.Time) (*time.Time, error)
}

type AttachmentUseCase interface {
	Upload(in AttachmentUpload) (*Attachment, error)
	// GetForUser проверяет права на канал вложения — им клиент обновляет
	// протухшую подпись.
	GetForUser(id, userID uuid.UUID) (*Attachment, error)
	// OpenContent и OpenThumb вызываются только после проверки подписи ссылки.
	OpenContent(id uuid.UUID) (*Attachment, io.ReadSeekCloser, error)
	OpenThumb(id uuid.UUID) (*Attachment, io.ReadSeekCloser, error)
	Delete(id, userID uuid.UUID) error
}
