package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// newFriendUC собирает юзкейс с моками. Возвращает все моки: тесты
// настраивают только те ожидания, которые им нужны.
func newFriendUC(t *testing.T) (domain.FriendUseCase, *MockFriendRepository,
	*MockBlockRepository, *MockUserRepository, *MockServerRepository) {
	t.Helper()
	fr := new(MockFriendRepository)
	br := new(MockBlockRepository)
	ur := new(MockUserRepository)
	sr := new(MockServerRepository)
	return usecase.NewFriendUseCase(fr, br, ur, sr), fr, br, ur, sr
}

func userWith(id uuid.UUID, name string, fr, dm domain.PrivacyMode) *domain.User {
	return &domain.User{
		ID:                  id,
		Username:            name,
		AllowFriendRequests: fr,
		AllowDMFrom:         dm,
	}
}

func TestSendRequest_ToSelf_Rejected(t *testing.T) {
	uc, _, _, ur, _ := newFriendUC(t)
	me := uuid.New()
	ur.On("GetByUsername", "self").Return(userWith(me, "self", domain.PrivacyEveryone, domain.PrivacyFriends), nil)

	_, _, _, _, err := uc.SendRequest(me, "self")
	assert.ErrorIs(t, err, domain.ErrSelfFriendship)
}

func TestSendRequest_Blocked_ReturnsGenericForbidden(t *testing.T) {
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(true, nil)

	_, _, _, _, err := uc.SendRequest(me, "other")
	// Именно ErrInteractionForbidden, а не отдельная «вы заблокированы»:
	// различимость этих случаев снаружи — утечка.
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
}

func TestSendRequest_PrivacyNone_Rejected(t *testing.T) {
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyNone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)

	_, _, _, _, err := uc.SendRequest(me, "other")
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
}

func TestSendRequest_MutualServers_NoCommonServer_Rejected(t *testing.T) {
	uc, _, br, ur, sr := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyMutualServers, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	sr.On("HasMutualServer", me, other).Return(false, nil)

	_, _, _, _, err := uc.SendRequest(me, "other")
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
}

func TestSendRequest_MutualServers_WithCommonServer_Allowed(t *testing.T) {
	uc, fr, br, ur, sr := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyMutualServers, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	sr.On("HasMutualServer", me, other).Return(true, nil)
	fr.On("GetByPair", me, other).Return(nil, domain.ErrFriendshipNotFound)
	fr.On("Create", mock.AnythingOfType("*domain.Friendship")).Return(nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)

	req, target, self, accepted, err := uc.SendRequest(me, "other")
	require.NoError(t, err)
	assert.False(t, accepted)
	assert.Equal(t, other, target.UserID)
	assert.Equal(t, other, req.User.UserID)
	// Регрессия C1: self обязан быть профилем ВЫЗЫВАЮЩЕГО (me), а не target —
	// хендлер использует его для WS-пуша target'у, где "другая сторона" это
	// вызывающий.
	assert.Equal(t, me, self.UserID)
}

// Регрессия C1: SendRequest обязан возвращать профиль ВЫЗЫВАЮЩЕГО отдельно
// от профиля target'а — хендлер использует его для WS-пуша заявки target'у,
// где "другая сторона" это как раз вызывающий, а не сам target. До фикса
// SendRequest возвращал только target-брифа, и хендлер пушил target'у его же
// собственный профиль.
func TestSendRequest_ReturnsCallerOwnBriefAsSelf(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()

	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("GetByPair", me, other).Return(nil, domain.ErrFriendshipNotFound)
	fr.On("Create", mock.AnythingOfType("*domain.Friendship")).Return(nil)

	_, target, self, accepted, err := uc.SendRequest(me, "other")
	require.NoError(t, err)
	assert.False(t, accepted)
	require.NotNil(t, self)
	assert.Equal(t, me, self.UserID, "self обязан быть вызывающим (me), а не target'ом")
	assert.NotEqual(t, target.UserID, self.UserID)
}

// Регрессия M2: два одновременных "стать друзьями" (каждый становится
// встречной заявкой для другого) могут оба пройти GetByPair, не найдя
// строки, и оба дойти до Create — проигравший получает от репозитория
// ErrFriendshipPairRace вместо unwrapped 500. SendRequest обязан перечитать
// пару и разрешить её так же, как обычную встречную заявку.
func TestSendRequest_ConcurrentCounterRequest_ResolvesInsteadOf500(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	reqID := uuid.New()

	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	// Первый GetByPair не находит строки — мы решаем создавать заявку.
	fr.On("GetByPair", me, other).Return(nil, domain.ErrFriendshipNotFound).Once()
	// Create проигрывает гонку: конкурентный запрос успел вставить строку
	// для этой же пары (встречная заявка от other).
	fr.On("Create", mock.AnythingOfType("*domain.Friendship")).Return(domain.ErrFriendshipPairRace)
	// Перечитываем пару — теперь она есть, и это встречная заявка от other.
	fr.On("GetByPair", me, other).Return(&domain.Friendship{
		ID: reqID, RequesterID: other, AddresseeID: me, Status: domain.FriendshipPending,
	}, nil).Once()
	fr.On("Accept", reqID, me, mock.AnythingOfType("time.Time")).Return(nil)

	_, target, self, accepted, err := uc.SendRequest(me, "other")
	require.NoError(t, err, "гонка обязана разрешиться, а не всплыть как ошибка")
	assert.True(t, accepted)
	assert.Equal(t, other, target.UserID)
	assert.Equal(t, me, self.UserID)
}

func TestCanDM_FriendsBypassPrivacySetting(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	// allow_dm_from = friends — но они друзья, значит писать можно.
	ur.On("GetByID", other).Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("IsFriend", me, other).Return(true, nil)

	assert.NoError(t, uc.CanDM(me, other))
}

func TestCanDM_NotFriend_PrivacyFriends_Rejected(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByID", other).Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("IsFriend", me, other).Return(false, nil)

	assert.ErrorIs(t, uc.CanDM(me, other), domain.ErrInteractionForbidden)
}

func TestCanDM_BlockedFriend_StillRejected(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByID", other).Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyEveryone), nil)
	// Блокировка проверяется ПЕРВОЙ и короткозамыкает дружбу.
	br.On("IsBlockedEither", me, other).Return(true, nil)
	// Намеренно НЕ регистрируем ожидание на IsFriend: если код дойдёт до
	// проверки дружбы, testify-мок запаникует на неожиданном вызове — это
	// само по себе сигнализирует о нарушении короткого замыкания.

	assert.ErrorIs(t, uc.CanDM(me, other), domain.ErrInteractionForbidden)
	fr.AssertNotCalled(t, "IsFriend")
}

func TestSendRequest_CounterRequest_BecomesFriendship(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	reqID := uuid.New()

	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	// Заявка от НЕГО ко мне уже висит.
	fr.On("GetByPair", me, other).Return(&domain.Friendship{
		ID: reqID, RequesterID: other, AddresseeID: me, Status: domain.FriendshipPending,
	}, nil)
	fr.On("Accept", reqID, me, mock.AnythingOfType("time.Time")).Return(nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)

	_, target, self, accepted, err := uc.SendRequest(me, "other")
	require.NoError(t, err)
	assert.True(t, accepted, "встречная заявка обязана сразу становиться дружбой, а не 409")
	assert.Equal(t, other, target.UserID)
	assert.Equal(t, me, self.UserID)
	fr.AssertNotCalled(t, "Create", mock.Anything)
}

func TestSendRequest_OwnRequestAlreadyPending_Rejected(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()

	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("GetByPair", me, other).Return(&domain.Friendship{
		ID: uuid.New(), RequesterID: me, AddresseeID: other, Status: domain.FriendshipPending,
	}, nil)

	_, _, _, _, err := uc.SendRequest(me, "other")
	assert.ErrorIs(t, err, domain.ErrFriendRequestExists)
}

func TestSendRequest_AlreadyFriends_Rejected(t *testing.T) {
	uc, fr, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()

	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	ur.On("GetByID", me).Return(userWith(me, "me", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	fr.On("GetByPair", me, other).Return(&domain.Friendship{
		ID: uuid.New(), RequesterID: other, AddresseeID: me, Status: domain.FriendshipAccepted,
	}, nil)

	_, _, _, _, err := uc.SendRequest(me, "other")
	assert.ErrorIs(t, err, domain.ErrAlreadyFriends)
}

func TestAcceptRequest_RaceWithConcurrentAccept_Rejected(t *testing.T) {
	uc, fr, _, _, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	reqID := uuid.New()

	// Заявка моя, но между чтением и UPDATE её приняли из другой вкладки:
	// условие `AND status = 'pending'` обновит ноль строк. Проверка в
	// UPDATE — не дублирование проверки в Go, а защита именно от этого.
	fr.On("GetByID", reqID).Return(&domain.Friendship{
		ID: reqID, RequesterID: other, AddresseeID: me, Status: domain.FriendshipPending,
	}, nil)
	fr.On("Accept", reqID, me, mock.AnythingOfType("time.Time")).Return(domain.ErrFriendshipNotFound)

	_, _, err := uc.AcceptRequest(me, reqID)
	assert.ErrorIs(t, err, domain.ErrFriendshipNotFound)
}

func TestAcceptRequest_Success_ReturnsProfileAndRequesterID(t *testing.T) {
	uc, fr, _, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	reqID := uuid.New()

	fr.On("GetByID", reqID).Return(&domain.Friendship{
		ID: reqID, RequesterID: other, AddresseeID: me, Status: domain.FriendshipPending,
	}, nil)
	fr.On("Accept", reqID, me, mock.AnythingOfType("time.Time")).Return(nil)
	ur.On("GetByID", other).Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)

	profile, otherID, err := uc.AcceptRequest(me, reqID)
	require.NoError(t, err)
	// Второй результат — id второй стороны: хендлеру он нужен, чтобы
	// отправить ей friend_added.
	assert.Equal(t, other, otherID)
	assert.Equal(t, other, profile.UserID)
	assert.Equal(t, "other", profile.Username)
}

func TestAcceptRequest_NotMyRequest_RejectedBeforeUpdate(t *testing.T) {
	uc, fr, _, _, _ := newFriendUC(t)
	me := uuid.New()
	reqID := uuid.New()

	// Заявка между двумя посторонними: угадавший id не должен ни принять
	// её, ни узнать из ответа, что она существует.
	fr.On("GetByID", reqID).Return(&domain.Friendship{
		ID: reqID, RequesterID: uuid.New(), AddresseeID: uuid.New(),
		Status: domain.FriendshipPending,
	}, nil)

	_, _, err := uc.AcceptRequest(me, reqID)
	assert.ErrorIs(t, err, domain.ErrFriendshipNotFound)
	fr.AssertNotCalled(t, "Accept", mock.Anything, mock.Anything, mock.Anything)
}

func TestDeleteRequest_ReturnsOtherPartyForNotification(t *testing.T) {
	uc, fr, _, _, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	reqID := uuid.New()

	fr.On("GetByID", reqID).Return(&domain.Friendship{
		ID: reqID, RequesterID: me, AddresseeID: other, Status: domain.FriendshipPending,
	}, nil)
	fr.On("Delete", reqID, me).Return(nil)

	otherID, err := uc.DeleteRequest(me, reqID)
	require.NoError(t, err)
	// Вторая сторона нужна, чтобы отправить ей friend_request_cancelled.
	assert.Equal(t, other, otherID)
	// otherID вычисляется из уже прочитанной заявки f и не зависит от
	// реального удаления — без этой проверки тест не ловит регрессию, где
	// заявка вычисляется, но фактически не удаляется.
	fr.AssertCalled(t, "Delete", reqID, me)
}

func TestDeleteRequest_ForeignRequest_Rejected(t *testing.T) {
	uc, fr, _, _, _ := newFriendUC(t)
	me := uuid.New()
	reqID := uuid.New()

	fr.On("GetByID", reqID).Return(&domain.Friendship{
		ID: reqID, RequesterID: uuid.New(), AddresseeID: uuid.New(),
		Status: domain.FriendshipPending,
	}, nil)

	_, err := uc.DeleteRequest(me, reqID)
	assert.ErrorIs(t, err, domain.ErrFriendshipNotFound)
	fr.AssertNotCalled(t, "Delete", mock.Anything, mock.Anything)
}

func TestBlock_Self_Rejected(t *testing.T) {
	uc, _, br, _, _ := newFriendUC(t)
	me := uuid.New()

	err := uc.Block(me, me)
	assert.ErrorIs(t, err, domain.ErrSelfFriendship)
	br.AssertNotCalled(t, "Block", mock.Anything, mock.Anything)
}

func TestBlock_DropsFriendship(t *testing.T) {
	uc, _, br, _, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	// Удаление дружбы — часть транзакции репозитория, юзкейс её не дублирует.
	br.On("Block", me, other).Return(nil)

	require.NoError(t, uc.Block(me, other))
	br.AssertCalled(t, "Block", me, other)
}

func TestRemoveFriend_DeletesPair(t *testing.T) {
	uc, fr, _, _, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	fr.On("DeleteByPair", me, other).Return(nil)

	require.NoError(t, uc.RemoveFriend(me, other))
	// Без этой проверки тест проходит и тогда, когда RemoveFriend вообще не
	// обращается к репозиторию — require.NoError сам по себе этого не ловит.
	fr.AssertCalled(t, "DeleteByPair", me, other)
}

func TestUnblock_DelegatesToBlockRepo(t *testing.T) {
	uc, _, br, _, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	br.On("Unblock", me, other).Return(nil)

	require.NoError(t, uc.Unblock(me, other))
	br.AssertCalled(t, "Unblock", me, other)
}
