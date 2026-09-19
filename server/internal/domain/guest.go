package domain

import (
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/google/uuid"
	"golang.org/x/text/unicode/norm"
)

// Гостевой вход в звонок по ссылке —
// docs/superpowers/specs/2026-09-17-guest-call-link-design.md.

type GuestStatus string

const (
	GuestStatusLobby        GuestStatus = "lobby"
	GuestStatusAdmitted     GuestStatus = "admitted"
	GuestStatusRejected     GuestStatus = "rejected"
	GuestStatusLobbyTimeout GuestStatus = "lobby_timeout"
	GuestStatusLeft         GuestStatus = "left"
	GuestStatusKicked       GuestStatus = "kicked"
	GuestStatusRevoked      GuestStatus = "revoked"
	GuestStatusCallEnded    GuestStatus = "call_ended"
)

// IsActive — гость ещё в лобби или в звонке. Все прочие статусы финальные.
func (s GuestStatus) IsActive() bool {
	return s == GuestStatusLobby || s == GuestStatusAdmitted
}

const (
	GuestRevokeManual         = "manual"
	GuestRevokeCallEnded      = "call_ended"
	GuestRevokeServerDisabled = "server_disabled"
)

// Лимиты — константы, не настройки (спека, раздел 2 «Константы»).
const (
	GuestLinkTTL                    = 8 * time.Hour
	MaxActiveLinksPerCreatorPerCall = 3
	MaxJoinsPerLink                 = 20
	MaxLobbyPerLink                 = 5
	MaxGuestsPerCall                = 10
	GuestLobbyTimeout               = 5 * time.Minute
	GuestAbsenceGrace               = 60 * time.Second
	GuestWSAuthTimeout              = 5 * time.Second
	GuestTURNTTL                    = time.Hour
	GuestRoomTokenTTL               = 60 * time.Second
	GuestMessageMaxLen              = 2000
	GuestNameMaxLen                 = 32
	SFUGuestDenyTTL                 = 2 * time.Minute
)

// GuestLink — гостевая ссылка на конкретный звонок. Секрета здесь нет и быть
// не может: в БД лежит только его SHA-256.
type GuestLink struct {
	ID            uuid.UUID  `json:"id"`
	ChannelID     uuid.UUID  `json:"channel_id"`
	CallMessageID uuid.UUID  `json:"-"`
	CreatedBy     *uuid.UUID `json:"created_by"`
	CreatedAt     time.Time  `json:"created_at"`
	ExpiresAt     time.Time  `json:"expires_at"`
	Uses          int        `json:"uses"`
	ClosedAt      *time.Time `json:"closed_at,omitempty"`
	RevokedAt     *time.Time `json:"-"`
	RevokedBy     *uuid.UUID `json:"-"`
	RevokeReason  *string    `json:"-"`
}

// GuestLinkTarget — ссылка вместе с состоянием всего, от чего зависит её
// пригодность: сервер (выключатель), канал (имя для предпросмотра), звонок.
type GuestLinkTarget struct {
	Link              GuestLink
	ServerID          uuid.UUID
	ServerName        string
	ServerIconURL     *string
	GuestLinksEnabled bool
	ChannelName       string
	CallEndedAt       *time.Time
}

// Usable сообщает, можно ли по ссылке войти прямо сейчас, и если нет — почему.
// Порядок проверок задаёт текст, который увидит гость: отзыв говорит о
// причине точнее, чем «звонок закрыт».
func (t *GuestLinkTarget) Usable(now time.Time) error {
	if t.Link.RevokedAt != nil {
		reason := ""
		if t.Link.RevokeReason != nil {
			reason = *t.Link.RevokeReason
		}
		switch reason {
		case GuestRevokeCallEnded:
			return ErrGuestCallEnded
		case GuestRevokeServerDisabled:
			return ErrGuestLinksDisabled
		default:
			return ErrGuestLinkRevoked
		}
	}
	if t.CallEndedAt != nil {
		return ErrGuestCallEnded
	}
	if !t.GuestLinksEnabled {
		return ErrGuestLinksDisabled
	}
	if !now.Before(t.Link.ExpiresAt) {
		return ErrGuestLinkExpired
	}
	if t.Link.ClosedAt != nil {
		return ErrGuestLinkClosed
	}
	return nil
}

// CallGuest — гость звонка. Никогда не пользователь из users.
type CallGuest struct {
	ID            uuid.UUID   `json:"id"`
	LinkID        uuid.UUID   `json:"link_id"`
	ChannelID     uuid.UUID   `json:"channel_id"`
	CallMessageID uuid.UUID   `json:"-"`
	DisplayName   string      `json:"display_name"`
	Status        GuestStatus `json:"status"`
	Banned        bool        `json:"banned"`
	CreatedAt     time.Time   `json:"created_at"`
	AdmittedAt    *time.Time  `json:"admitted_at,omitempty"`
	EndedAt       *time.Time  `json:"-"`
}

// GuestContext — гость вместе с живым состоянием ссылки, звонка и сервера.
// Его отдаёт аутентификация сессии и поиск гостя по id.
type GuestContext struct {
	Guest             CallGuest
	ServerID          uuid.UUID
	LinkCreatedBy     *uuid.UUID
	LinkRevoked       bool
	CallEnded         bool
	GuestLinksEnabled bool
}

// SessionUsable — сессия гостя действительна: гость активен, ссылка не
// отозвана, звонок идёт, сервер не выключил гостей. Проверяется на каждом
// запросе, поэтому отзыв и конец звонка действуют мгновенно, даже если фоновая
// уборка ещё не перевела гостя в финальный статус.
func (c *GuestContext) SessionUsable() bool {
	return c.Guest.Status.IsActive() && !c.LinkRevoked && !c.CallEnded && c.GuestLinksEnabled
}

// GuestJoin — вход в лобби. Хеши вычисляет use case, репозиторий их только хранит.
type GuestJoin struct {
	LinkID      uuid.UUID
	GuestID     uuid.UUID
	DisplayName string
	SessionHash []byte
	IPHash      []byte
	Now         time.Time
}

type GuestCallState struct {
	Links  []*GuestLink `json:"links"`
	Guests []*CallGuest `json:"guests"`
}

type GuestLinkCreated struct {
	ID        uuid.UUID `json:"id"`
	Secret    string    `json:"secret"`
	ExpiresAt time.Time `json:"expires_at"`
}

// GuestPreview — всё, что видно по ссылке до входа. Имён участников здесь нет
// намеренно: у того, кто держит ссылку, ещё нет допуска.
type GuestPreview struct {
	ServerName       string  `json:"server_name"`
	ServerIconURL    *string `json:"server_icon_url,omitempty"`
	ChannelName      string  `json:"channel_name"`
	ParticipantCount int     `json:"participant_count"`
}

type GuestJoinResult struct {
	GuestID      uuid.UUID `json:"guest_id"`
	SessionToken string    `json:"session_token"`
	DisplayName  string    `json:"display_name"`
}

var reservedGuestNames = []string{
	"admin", "administrator", "администратор", "админ",
	"moderator", "модератор", "owner", "владелец",
	"vycord", "system", "система", "support", "поддержка",
	"гость", "guest",
}

// latinLookalikes сводит латинские двойники к кириллице, чтобы «Аdmin» с
// кириллической «А» и «admin» дали одинаковый скелет.
var latinLookalikes = strings.NewReplacer(
	"a", "а", "o", "о", "e", "е", "p", "р", "c", "с", "x", "х",
	"y", "у", "k", "к", "m", "м", "t", "т", "h", "н", "b", "в",
)

func guestNameSkeleton(s string) string {
	s = strings.ToLower(s)
	s = strings.Map(func(r rune) rune {
		if unicode.IsSpace(r) || r == '.' || r == '_' || r == '-' {
			return -1
		}
		return r
	}, s)
	return latinLookalikes.Replace(s)
}

var reservedGuestSkeletons = func() map[string]struct{} {
	m := make(map[string]struct{}, len(reservedGuestNames))
	for _, n := range reservedGuestNames {
		m[guestNameSkeleton(n)] = struct{}{}
	}
	return m
}()

// NormalizeGuestName приводит имя гостя к безопасному виду: NFKC, вырезание
// управляющих и форматирующих символов (zero-width, bidi-override, BOM),
// схлопывание пробелов, лимит длины, запрет зарезервированных имён. Главная
// защита от подмены — не этот фильтр, а метка «Гость» в UI.
func NormalizeGuestName(raw string) (string, error) {
	s := norm.NFKC.String(raw)

	var b strings.Builder
	pendingSpace := false
	for _, r := range s {
		if unicode.IsSpace(r) {
			pendingSpace = b.Len() > 0
			continue
		}
		if unicode.Is(unicode.Cc, r) || unicode.Is(unicode.Cf, r) {
			continue
		}
		if pendingSpace {
			b.WriteRune(' ')
			pendingSpace = false
		}
		b.WriteRune(r)
	}
	name := b.String()

	n := utf8.RuneCountInString(name)
	if n == 0 || n > GuestNameMaxLen {
		return "", ErrInvalidGuestName
	}
	if _, reserved := reservedGuestSkeletons[guestNameSkeleton(name)]; reserved {
		return "", ErrReservedGuestName
	}
	return name, nil
}

// GuestRepository — все переходы состояний гостей и ссылок. Каждый метод,
// меняющий состояние, выполняется одной транзакцией.
type GuestRepository interface {
	// OpenCallMessageID — id открытого звонка канала или ErrCallNotActive.
	OpenCallMessageID(channelID uuid.UUID) (uuid.UUID, error)
	// CreateLink вставляет ссылку. ErrCallNotActive — звонок link.CallMessageID
	// уже закрыт; ErrTooManyGuestLinks — у создателя уже
	// MaxActiveLinksPerCreatorPerCall активных ссылок в этом звонке.
	CreateLink(link *GuestLink, secretHash []byte) error
	// GetLinkTargetBySecretHash — ErrGuestLinkInvalid, если не найдено.
	GetLinkTargetBySecretHash(secretHash []byte) (*GuestLinkTarget, error)
	// GetLinkTargetByID — ErrGuestLinkNotFound, если не найдено.
	GetLinkTargetByID(linkID uuid.UUID) (*GuestLinkTarget, error)
	// ListCallState — неотозванные ссылки и активные гости звонка.
	ListCallState(callMessageID uuid.UUID) (*GuestCallState, error)
	// CloseCreatorLinksInChannel закрывает для новых гостей ссылки creatorID в
	// открытом звонке канала. Возвращает число закрытых ссылок.
	CloseCreatorLinksInChannel(channelID, creatorID uuid.UUID, now time.Time) (int64, error)
	// SetServerGuestLinks меняет выключатель сервера. При выключении отзывает
	// все ссылки сервера (server_disabled) и возвращает выкинутых гостей.
	// ErrServerNotFound — сервера нет.
	SetServerGuestLinks(serverID uuid.UUID, enabled bool, actorID uuid.UUID, now time.Time) ([]*CallGuest, error)
	// Join — вход в лобби со всеми проверками пригодности и лимитов под
	// блокировкой звонка. Ошибки: всё, что возвращает GuestLinkTarget.Usable,
	// а также ErrGuestLinkInvalid, ErrGuestBanned, ErrGuestLinkExhausted,
	// ErrGuestLobbyFull, ErrGuestCallFull.
	Join(j GuestJoin) (*CallGuest, error)
	// GetSessionByHash — ErrGuestSessionInvalid, если сессии нет.
	GetSessionByHash(sessionHash []byte) (*GuestContext, error)
	// GetGuest — ErrGuestNotFound, если гостя нет.
	GetGuest(guestID uuid.UUID) (*GuestContext, error)
	// Decide впускает или отклоняет гостя в лобби. ErrGuestNotFound,
	// ErrGuestAlreadyDecided (не в лобби), ErrGuestCallEnded.
	Decide(guestID, actorID uuid.UUID, admit bool, now time.Time) (*CallGuest, error)
	// EndGuest переводит активного гостя в left, kicked или lobby_timeout.
	// ErrGuestNotFound, ErrGuestNotActive.
	EndGuest(guestID uuid.UUID, status GuestStatus, actorID *uuid.UUID, ban bool, now time.Time) (*CallGuest, error)
	// RevokeLink отзывает ссылку и возвращает её выкинутых гостей.
	// Идемпотентен: уже отозванная ссылка — (nil, nil).
	RevokeLink(linkID uuid.UUID, actorID *uuid.UUID, reason string, now time.Time) ([]*CallGuest, error)
	// EndGuestsOfClosedCalls гасит ссылки и гостей всех закрытых звонков.
	EndGuestsOfClosedCalls(now time.Time) ([]*CallGuest, error)
	// ExpireLobby переводит в lobby_timeout гостей, ждущих с до olderThan.
	ExpireLobby(olderThan, now time.Time) ([]*CallGuest, error)
	// ListAdmittedGuests returns every guest currently in a call — the input
	// of the absence sweep.
	ListAdmittedGuests() ([]*CallGuest, error)
}

// CallPresence — срез хаба: кто сейчас в голосовом канале.
type CallPresence interface {
	IsInVoiceChannel(userID, channelID uuid.UUID) bool
	VoiceParticipants(channelID uuid.UUID) []uuid.UUID
}

// GuestEvents — побочные эффекты жизненного цикла гостя: события хаба,
// сообщения гостевому шлюзу, выкидывание из SFU. Реализация — план 3; до неё
// в main.go стоит usecase.NoopGuestEvents.
type GuestEvents interface {
	// LinksChanged — изменился состав ссылок или гостей звонка канала.
	LinksChanged(channelID uuid.UUID)
	// LobbyRequested — гость встал в лобби.
	LobbyRequested(g *CallGuest, linkCreatedBy *uuid.UUID)
	// LobbyResolved — гость покинул лобби: впущен, отклонён, таймаут, ушёл,
	// выгнан. byUserID == nil — решение не человека (таймаут, уход гостя).
	LobbyResolved(g *CallGuest, byUserID *uuid.UUID)
	// GuestsEnded — гости перешли в финальный статус: закрыть их соединения и
	// выкинуть из SFU.
	GuestsEnded(guests []*CallGuest)
}

type GuestUseCase interface {
	// SetEvents подключает реализацию GuestEvents. Вызывается один раз при
	// старте, до приёма запросов.
	SetEvents(events GuestEvents)

	CreateLink(channelID, userID uuid.UUID) (*GuestLinkCreated, error)
	ListCallGuests(channelID, userID uuid.UUID) (*GuestCallState, error)
	RevokeLink(linkID, userID uuid.UUID) error
	Admit(guestID, userID uuid.UUID) error
	Reject(guestID, userID uuid.UUID) error
	Kick(guestID, userID uuid.UUID, ban bool) error
	SetServerGuestLinks(serverID, userID uuid.UUID, enabled bool) (*Server, error)
	OnParticipantLeft(channelID, userID uuid.UUID)

	Preview(secret string) (*GuestPreview, error)
	Join(secret, displayName, clientIP string) (*GuestJoinResult, error)
	Authenticate(sessionToken string) (*GuestContext, error)
	Leave(guest *GuestContext) error
	IssueRoomToken(guest *GuestContext) (token string, roomID uuid.UUID, err error)
	TURNCredentials(guest *GuestContext) (*TURNCredentials, error)

	ExpireLobby()
	EndGuestsOfClosedCalls()
	// SweepAbsentGuests releases guests that have been missing from both the
	// gateway and the SFU for longer than GuestAbsenceGrace.
	SweepAbsentGuests(present map[uuid.UUID]struct{})
}
