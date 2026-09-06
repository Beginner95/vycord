package domain

import (
	"time"

	"github.com/google/uuid"
)

// PrivacyMode — режим приватности взаимодействия. Значения совпадают со
// строками в колонках users.allow_friend_requests / users.allow_dm_from и
// с их CHECK-ограничениями (миграция 024): менять их можно только вместе.
type PrivacyMode string

const (
	PrivacyEveryone      PrivacyMode = "everyone"
	PrivacyMutualServers PrivacyMode = "mutual_servers"
	PrivacyNone          PrivacyMode = "none"
	PrivacyFriends       PrivacyMode = "friends"
)

// ValidForFriendRequests — допустимые режимы приёма заявок в друзья.
// 'friends' сюда не входит: «принимать заявки только от друзей» —
// бессмысленное состояние, из него нельзя стать другом.
func (m PrivacyMode) ValidForFriendRequests() bool {
	return m == PrivacyEveryone || m == PrivacyMutualServers || m == PrivacyNone
}

// ValidForDM — допустимые режимы приёма личных сообщений. 'none' сюда не
// входит: 'friends' уже самый строгий режим, а полный запрет ЛС отрезал бы
// и переписку с друзьями.
func (m PrivacyMode) ValidForDM() bool {
	return m == PrivacyEveryone || m == PrivacyMutualServers || m == PrivacyFriends
}

type FriendshipStatus string

const (
	FriendshipPending  FriendshipStatus = "pending"
	FriendshipAccepted FriendshipStatus = "accepted"
)

// Friendship — строка таблицы friendships как есть. Наружу не отдаётся:
// клиенту уходят FriendProfile и FriendRequest.
type Friendship struct {
	ID          uuid.UUID
	RequesterID uuid.UUID
	AddresseeID uuid.UUID
	Status      FriendshipStatus
	CreatedAt   time.Time
	AcceptedAt  *time.Time
}

// UserBrief — пользователь в объёме строки списка. Один тип на друзей,
// заявки и блокировки. Именно он, а не domain.User: User сериализует email,
// и его место — только в ответе «про себя».
type UserBrief struct {
	UserID    uuid.UUID `json:"user_id"`
	Username  string    `json:"username"`
	AvatarURL *string   `json:"avatar_url,omitempty"`
}

// FriendProfile — друг с данными профиля. UserBrief встроен, поэтому в JSON
// поля плоские: список друзей отдаётся одним запросом и клиенту не нужно
// ходить в /users/{id} за каждым (урок инцидента с fetch-storm).
type FriendProfile struct {
	UserBrief
	FriendsSince time.Time `json:"friends_since"`
}

// FriendRequest — висящая заявка глазами спрашивающего. User — всегда
// «другая сторона»: во входящей это отправитель, в исходящей — адресат.
// Направление несёт список, в который заявку положил GetPending, а не поле.
type FriendRequest struct {
	ID        uuid.UUID `json:"id"`
	User      UserBrief `json:"user"`
	CreatedAt time.Time `json:"created_at"`
}

type FriendRepository interface {
	GetFriends(userID uuid.UUID) ([]*FriendProfile, error)
	GetPending(userID uuid.UUID) (incoming, outgoing []*FriendRequest, err error)
	// GetByPair возвращает связь пары в любом направлении.
	// ErrFriendshipNotFound, если связи нет.
	GetByPair(a, b uuid.UUID) (*Friendship, error)
	// GetByID возвращает связь по её идентификатору. Нужен принятию заявки:
	// вторая сторона по id заявки иначе неизвестна.
	GetByID(id uuid.UUID) (*Friendship, error)
	Create(f *Friendship) error
	// Accept переводит заявку в accepted одним UPDATE с условием
	// `WHERE id = $1 AND addressee_id = $2 AND status = 'pending'`.
	// Условие внутри UPDATE делает переход атомарным без транзакции: принять
	// чужую или уже принятую заявку невозможно даже при гонке двух вкладок —
	// второй запрос обновит ноль строк и получит ErrFriendshipNotFound.
	Accept(id, addresseeID uuid.UUID, at time.Time) error
	// Delete удаляет заявку, если actorID — одна из её сторон. Одна операция
	// на «отклонить входящую» и «отменить исходящую»: с точки зрения данных
	// это одно и то же.
	Delete(id, actorID uuid.UUID) error
	// DeleteByPair удаляет связь пары независимо от направления и статуса —
	// «удалить из друзей».
	DeleteByPair(a, b uuid.UUID) error
	IsFriend(a, b uuid.UUID) (bool, error)
}

type BlockRepository interface {
	List(blockerID uuid.UUID) ([]*UserBrief, error)
	// Block удаляет дружбу/заявку и создаёт блокировку ОДНОЙ транзакцией:
	// блокировка, оставившая человека в друзьях, — рассогласованное
	// состояние, которое всплывёт в любом списке. Идемпотентна.
	Block(blockerID, blockedID uuid.UUID) error
	Unblock(blockerID, blockedID uuid.UUID) error
	// IsBlockedEither — есть ли блокировка в любую сторону. Одним запросом:
	// это первая проверка каждого взаимодействия.
	IsBlockedEither(a, b uuid.UUID) (bool, error)
}

// FriendUseCase — операции над графом друзей. Каждая возвращает данные,
// достаточные для WS-рассылки, чтобы хендлеру не пришлось перечитывать.
type FriendUseCase interface {
	ListFriends(userID uuid.UUID) ([]*FriendProfile, error)
	ListRequests(userID uuid.UUID) (incoming, outgoing []*FriendRequest, err error)
	// SendRequest шлёт заявку по ТОЧНОМУ username. accepted=true означает,
	// что встречная заявка уже висела и запрос её принял. self — краткий
	// профиль САМОГО вызывающего (fromID): req.User собран из target и
	// годится для HTTP-ответа вызывающему, но для WS-пуша target'у «другая
	// сторона» — это вызывающий, а не он сам, отсюда и второй профиль.
	SendRequest(fromID uuid.UUID, username string) (req *FriendRequest, target *UserBrief, self *UserBrief, accepted bool, err error)
	AcceptRequest(userID, requestID uuid.UUID) (*FriendProfile, uuid.UUID, error)
	// DeleteRequest — отклонить входящую или отменить исходящую. Второй
	// результат — id другой стороны, ей уходит WS-событие.
	DeleteRequest(userID, requestID uuid.UUID) (otherID uuid.UUID, err error)
	RemoveFriend(userID, friendID uuid.UUID) error
	ListBlocks(userID uuid.UUID) ([]*UserBrief, error)
	Block(userID, targetID uuid.UUID) error
	Unblock(userID, targetID uuid.UUID) error
	// CanDM — публичная проверка «можно ли писать в ЛС». В фазе 1 не
	// вызывается ниоткуда, кроме тестов; в фазе 2 её дёргает usecase личек.
	CanDM(fromID, toID uuid.UUID) error
}
