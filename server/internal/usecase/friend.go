package usecase

import (
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type friendUseCase struct {
	friendRepo domain.FriendRepository
	blockRepo  domain.BlockRepository
	userRepo   domain.UserRepository
	serverRepo domain.ServerRepository
}

func NewFriendUseCase(
	friendRepo domain.FriendRepository,
	blockRepo domain.BlockRepository,
	userRepo domain.UserRepository,
	serverRepo domain.ServerRepository,
) domain.FriendUseCase {
	return &friendUseCase{
		friendRepo: friendRepo,
		blockRepo:  blockRepo,
		userRepo:   userRepo,
		serverRepo: serverRepo,
	}
}

type interaction int

const (
	interactionFriendRequest interaction = iota
	interactionDM
)

// canInteract — ЕДИНСТВЕННОЕ место, где решается, разрешено ли from
// инициировать действие в адрес to. Не дублировать в хендлерах: любая
// вторая копия этой логики рано или поздно разойдётся с первой, и разойдётся
// она в сторону разрешения.
//
// Порядок проверок обязателен: блокировка идёт первой и короткозамыкает всё
// остальное, включая дружбу.
//
// Наружу всегда уходит один и тот же ErrInteractionForbidden — и для
// блокировки, и для настройки приватности. Различать их нельзя: иначе
// перебором заявок вычисляется, кто тебя заблокировал.
func (uc *friendUseCase) canInteract(from uuid.UUID, to *domain.User, act interaction) error {
	if from == to.ID {
		return domain.ErrSelfFriendship
	}

	blocked, err := uc.blockRepo.IsBlockedEither(from, to.ID)
	if err != nil {
		return fmt.Errorf("check block: %w", err)
	}
	if blocked {
		return domain.ErrInteractionForbidden
	}

	mode := to.AllowFriendRequests
	if act == interactionDM {
		// Друзьям настройка ЛС не препятствует — иначе выбор «писать могут
		// только друзья» отрезал бы и самих друзей.
		isFriend, err := uc.friendRepo.IsFriend(from, to.ID)
		if err != nil {
			return fmt.Errorf("check friendship: %w", err)
		}
		if isFriend {
			return nil
		}
		mode = to.AllowDMFrom
	}

	switch mode {
	case domain.PrivacyEveryone:
		return nil
	case domain.PrivacyMutualServers:
		mutual, err := uc.serverRepo.HasMutualServer(from, to.ID)
		if err != nil {
			return fmt.Errorf("check mutual server: %w", err)
		}
		if !mutual {
			return domain.ErrInteractionForbidden
		}
		return nil
	default:
		// PrivacyNone для заявок, PrivacyFriends для ЛС (не-друг сюда
		// доходит только не будучи другом), а также любое неизвестное
		// значение — запрет. Неизвестный режим обязан запрещать, а не
		// разрешать: иначе опечатка в БД открывает доступ.
		return domain.ErrInteractionForbidden
	}
}

func (uc *friendUseCase) CanDM(fromID, toID uuid.UUID) error {
	to, err := uc.userRepo.GetByID(toID)
	if err != nil {
		return err
	}
	return uc.canInteract(fromID, to, interactionDM)
}

func (uc *friendUseCase) SendRequest(fromID uuid.UUID, username string) (*domain.FriendRequest, *domain.UserBrief, bool, error) {
	target, err := uc.userRepo.GetByUsername(username)
	if err != nil {
		return nil, nil, false, err
	}

	if err := uc.canInteract(fromID, target, interactionFriendRequest); err != nil {
		return nil, nil, false, err
	}

	brief := &domain.UserBrief{
		UserID:    target.ID,
		Username:  target.Username,
		AvatarURL: target.AvatarURL,
	}

	existing, err := uc.friendRepo.GetByPair(fromID, target.ID)
	if err != nil && !errors.Is(err, domain.ErrFriendshipNotFound) {
		return nil, nil, false, err
	}
	if existing != nil {
		// Ветка встречной заявки реализуется в Task 7.
		if existing.Status == domain.FriendshipAccepted {
			return nil, nil, false, domain.ErrAlreadyFriends
		}
		return nil, nil, false, domain.ErrFriendRequestExists
	}

	f := &domain.Friendship{
		ID:          uuid.New(),
		RequesterID: fromID,
		AddresseeID: target.ID,
		Status:      domain.FriendshipPending,
		CreatedAt:   time.Now().UTC(),
	}
	if err := uc.friendRepo.Create(f); err != nil {
		return nil, nil, false, err
	}

	return &domain.FriendRequest{ID: f.ID, User: *brief, CreatedAt: f.CreatedAt}, brief, false, nil
}

func (uc *friendUseCase) ListFriends(userID uuid.UUID) ([]*domain.FriendProfile, error) {
	return uc.friendRepo.GetFriends(userID)
}

func (uc *friendUseCase) ListRequests(userID uuid.UUID) ([]*domain.FriendRequest, []*domain.FriendRequest, error) {
	return uc.friendRepo.GetPending(userID)
}

func (uc *friendUseCase) ListBlocks(userID uuid.UUID) ([]*domain.UserBrief, error) {
	return uc.blockRepo.List(userID)
}

// errNotImplemented — временная заглушка. NewFriendUseCase возвращает
// domain.FriendUseCase напрямую, поэтому Go проверяет соответствие
// интерфейсу немедленно, в точке return внутри конструктора: без этих
// пяти методов пакет usecase не компилируется вообще, а не только при
// попытке ими воспользоваться. Реальную логику добавляют Task 7 (заявки)
// и Task 8 (блокировки) — эти тела здесь только ради компиляции.
var errNotImplemented = errors.New("not implemented: see Task 7/8")

func (uc *friendUseCase) AcceptRequest(userID, requestID uuid.UUID) (*domain.FriendProfile, uuid.UUID, error) {
	return nil, uuid.Nil, errNotImplemented
}

func (uc *friendUseCase) DeleteRequest(userID, requestID uuid.UUID) (uuid.UUID, error) {
	return uuid.Nil, errNotImplemented
}

func (uc *friendUseCase) RemoveFriend(userID, friendID uuid.UUID) error {
	return errNotImplemented
}

func (uc *friendUseCase) Block(userID, targetID uuid.UUID) error {
	return errNotImplemented
}

func (uc *friendUseCase) Unblock(userID, targetID uuid.UUID) error {
	return errNotImplemented
}
