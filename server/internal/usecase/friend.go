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
		if existing.Status == domain.FriendshipAccepted {
			return nil, nil, false, domain.ErrAlreadyFriends
		}
		if existing.RequesterID == fromID {
			return nil, nil, false, domain.ErrFriendRequestExists
		}
		// Встречная заявка: он уже позвал меня — значит это не вторая
		// заявка, а принятие первой. Транзакция не нужна: условие
		// `AND status = 'pending'` внутри UPDATE делает переход атомарным.
		if err := uc.friendRepo.Accept(existing.ID, fromID, time.Now().UTC()); err != nil {
			if errors.Is(err, domain.ErrFriendshipNotFound) {
				// Гонка: кто-то принял её между GetByPair и Accept.
				// Результат ровно тот, которого хотел пользователь.
				return nil, brief, true, nil
			}
			return nil, nil, false, err
		}
		return nil, brief, true, nil
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
// методов пакет usecase не компилируется вообще, а не только при попытке
// ими воспользоваться. AcceptRequest реализован в Task 7; DeleteRequest,
// RemoveFriend, Block, Unblock остаются заглушками до Task 8 — эти тела
// здесь только ради компиляции.
var errNotImplemented = errors.New("not implemented: see Task 8")

func (uc *friendUseCase) AcceptRequest(userID, requestID uuid.UUID) (*domain.FriendProfile, uuid.UUID, error) {
	f, err := uc.friendRepo.GetByID(requestID)
	if err != nil {
		return nil, uuid.Nil, err
	}
	// Принять можно только адресованную мне заявку. Повторная проверка в
	// UPDATE ниже — не дублирование, а защита от гонки; эта же нужна, чтобы
	// не открыть чужой профиль тому, кто просто угадал id.
	if f.AddresseeID != userID {
		return nil, uuid.Nil, domain.ErrFriendshipNotFound
	}

	at := time.Now().UTC()
	if err := uc.friendRepo.Accept(requestID, userID, at); err != nil {
		return nil, uuid.Nil, err
	}

	other, err := uc.userRepo.GetByID(f.RequesterID)
	if err != nil {
		return nil, uuid.Nil, err
	}

	return &domain.FriendProfile{
		UserBrief: domain.UserBrief{
			UserID:    other.ID,
			Username:  other.Username,
			AvatarURL: other.AvatarURL,
		},
		FriendsSince: at,
	}, other.ID, nil
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
