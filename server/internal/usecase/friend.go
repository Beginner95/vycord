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

func (uc *friendUseCase) SendRequest(fromID uuid.UUID, username string) (*domain.FriendRequest, *domain.UserBrief, *domain.UserBrief, bool, error) {
	target, err := uc.userRepo.GetByUsername(username)
	if err != nil {
		return nil, nil, nil, false, err
	}

	if err := uc.canInteract(fromID, target, interactionFriendRequest); err != nil {
		return nil, nil, nil, false, err
	}

	// self — профиль вызывающего, нужен хендлеру для WS-пуша target'у
	// (там "другая сторона" — это вызывающий, а не сам target). Ошибка
	// здесь — реальная ошибка: fromID приходит из валидного JWT.
	self, err := uc.userRepo.GetByID(fromID)
	if err != nil {
		return nil, nil, nil, false, err
	}
	selfBrief := &domain.UserBrief{
		UserID:    self.ID,
		Username:  self.Username,
		AvatarURL: self.AvatarURL,
	}

	brief := &domain.UserBrief{
		UserID:    target.ID,
		Username:  target.Username,
		AvatarURL: target.AvatarURL,
	}

	existing, err := uc.friendRepo.GetByPair(fromID, target.ID)
	if err != nil && !errors.Is(err, domain.ErrFriendshipNotFound) {
		return nil, nil, nil, false, err
	}
	if existing != nil {
		return uc.resolveExistingPair(fromID, existing, brief, selfBrief)
	}

	f := &domain.Friendship{
		ID:          uuid.New(),
		RequesterID: fromID,
		AddresseeID: target.ID,
		Status:      domain.FriendshipPending,
		CreatedAt:   time.Now().UTC(),
	}
	if err := uc.friendRepo.Create(f); err != nil {
		if errors.Is(err, domain.ErrFriendshipPairRace) {
			// Конкурентная встречная заявка: кто-то создал строку для этой
			// же пары между нашим GetByPair и Create. Перечитываем и
			// разрешаем её тем же путём, что и обычную встречную заявку,
			// а не отдаём наверх 500.
			raced, err := uc.friendRepo.GetByPair(fromID, target.ID)
			if err != nil {
				return nil, nil, nil, false, err
			}
			return uc.resolveExistingPair(fromID, raced, brief, selfBrief)
		}
		return nil, nil, nil, false, err
	}

	return &domain.FriendRequest{ID: f.ID, User: *brief, CreatedAt: f.CreatedAt}, brief, selfBrief, false, nil
}

// resolveExistingPair решает, что делать, когда для (fromID, target) уже
// есть строка friendships — обычный путь через GetByPair до Create, а также
// путь после ErrFriendshipPairRace, когда строку успел создать конкурентный
// запрос. Вынесено в отдельный метод именно ради второго вызова: логика
// идентична, дублировать её нельзя — разойдётся.
func (uc *friendUseCase) resolveExistingPair(fromID uuid.UUID, existing *domain.Friendship, brief, selfBrief *domain.UserBrief) (*domain.FriendRequest, *domain.UserBrief, *domain.UserBrief, bool, error) {
	if existing.Status == domain.FriendshipAccepted {
		return nil, nil, nil, false, domain.ErrAlreadyFriends
	}
	if existing.RequesterID == fromID {
		return nil, nil, nil, false, domain.ErrFriendRequestExists
	}
	// Встречная заявка: он уже позвал меня — значит это не вторая заявка, а
	// принятие первой. Транзакция не нужна: условие `AND status = 'pending'`
	// внутри UPDATE делает переход атомарным.
	if err := uc.friendRepo.Accept(existing.ID, fromID, time.Now().UTC()); err != nil {
		if errors.Is(err, domain.ErrFriendshipNotFound) {
			// Гонка: кто-то принял её между GetByPair и Accept.
			// Результат ровно тот, которого хотел пользователь.
			return nil, brief, selfBrief, true, nil
		}
		return nil, nil, nil, false, err
	}
	return nil, brief, selfBrief, true, nil
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
	f, err := uc.friendRepo.GetByID(requestID)
	if err != nil {
		return uuid.Nil, err
	}
	if f.RequesterID != userID && f.AddresseeID != userID {
		// Чужая заявка. Отдаём «не найдено», а не «запрещено»: наличие
		// заявки с таким id — тоже информация.
		return uuid.Nil, domain.ErrFriendshipNotFound
	}

	if err := uc.friendRepo.Delete(requestID, userID); err != nil {
		return uuid.Nil, err
	}

	other := f.AddresseeID
	if other == userID {
		other = f.RequesterID
	}
	return other, nil
}

func (uc *friendUseCase) RemoveFriend(userID, friendID uuid.UUID) error {
	return uc.friendRepo.DeleteByPair(userID, friendID)
}

func (uc *friendUseCase) Block(userID, targetID uuid.UUID) error {
	if userID == targetID {
		return domain.ErrSelfFriendship
	}
	// Дружбу удаляет сам репозиторий, одной транзакцией со вставкой
	// блокировки — здесь это не дублируется.
	return uc.blockRepo.Block(userID, targetID)
}

func (uc *friendUseCase) Unblock(userID, targetID uuid.UUID) error {
	return uc.blockRepo.Unblock(userID, targetID)
}
