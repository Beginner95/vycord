package domain

import (
	"time"

	"github.com/google/uuid"
)

// UnreadCountCap — потолок подсчёта непрочитанных в одном канале (VYC-104).
// Клиент показывает «99+», считать дальше незачем, а LIMIT держит запрос
// дешёвым на длинных каналах.
const UnreadCountCap = 100

// ReadCursor — «прочитано до» в канале: прочитаны все сообщения с
// (created_at, id) ≤ (At, MessageID). MessageID == nil (сид миграции или
// фолбэк на joined_at) — прочитано всё с created_at ≤ At.
type ReadCursor struct {
	At        time.Time  `json:"last_read_at"`
	MessageID *uuid.UUID `json:"last_read_message_id"`
}

// ChannelUnread — счётчик и курсор пользователя по одному каналу.
type ChannelUnread struct {
	ServerID  uuid.UUID `json:"server_id"`
	ChannelID uuid.UUID `json:"channel_id"`
	Count     int       `json:"count"`
	ReadCursor
}

// MarkReadResult — итог PUT /read: курсор после продвижения и сколько
// непрочитанного осталось за ним.
type MarkReadResult struct {
	ServerID uuid.UUID `json:"-"`
	Count    int       `json:"count"`
	ReadCursor
	// Advanced — курсор действительно сдвинулся: только тогда другим
	// открывшим канал уходит channel_read.
	Advanced bool `json:"-"`
}

// Reader — участник сервера в списке «кто прочитал».
type Reader struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
	HasRead   bool      `json:"-"`
}

// MessageReaders — ответ GET …/readers/{message_id}.
type MessageReaders struct {
	Read   []*Reader `json:"read"`
	Unread []*Reader `json:"unread"`
}

const (
	ChannelActivityCreate = "create"
	ChannelActivityDelete = "delete"
)

// ChannelActivity — payload WS-события channel_activity: без текста, только
// то, что нужно клиенту, чтобы сдвинуть счётчик канала на ±1.
type ChannelActivity struct {
	Op           string     `json:"op"`
	ServerID     uuid.UUID  `json:"server_id"`
	ChannelID    uuid.UUID  `json:"channel_id"`
	MessageID    uuid.UUID  `json:"message_id"`
	CreatedAt    time.Time  `json:"created_at"`
	AuthorUserID *uuid.UUID `json:"author_user_id"`
}

type ReadStateRepository interface {
	// ListUnread — счётчики и эффективные курсоры по всем каналам всех
	// серверов пользователя одним запросом.
	ListUnread(userID uuid.UUID) ([]*ChannelUnread, error)
	// CountUnread — непрочитанные за эффективным курсором (до UnreadCountCap).
	// ErrForbidden — пользователь не участник сервера канала.
	CountUnread(userID, channelID uuid.UUID) (int, error)
	// Cursor — эффективный курсор: строка channel_read_states, а без неё —
	// момент вступления в сервер (MessageID == nil). ErrForbidden — не участник.
	Cursor(userID, channelID uuid.UUID) (*ReadCursor, error)
	// Advance двигает курсор только вперёд. false без ошибки — не сдвинулся:
	// позиция не новее текущей, раньше вступления в сервер или пользователь
	// не участник.
	Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error)
	// OthersMax — самый дальний ЯВНЫЙ курсор канала среди участников, кроме
	// userID. nil, nil — никто ничего явно не читал.
	OthersMax(userID, channelID uuid.UUID) (*ReadCursor, error)
	// Readers — все участники сервера, кроме authorID, с отметкой, дошёл ли
	// их явный курсор до сообщения (at, messageID). По имени.
	Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*Reader, error)
	// ServerMemberIDs — адресаты channel_activity.
	ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error)
}
