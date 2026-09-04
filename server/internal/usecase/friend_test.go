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

	_, _, _, err := uc.SendRequest(me, "self")
	assert.ErrorIs(t, err, domain.ErrSelfFriendship)
}

func TestSendRequest_Blocked_ReturnsGenericForbidden(t *testing.T) {
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(true, nil)

	_, _, _, err := uc.SendRequest(me, "other")
	// Именно ErrInteractionForbidden, а не отдельная «вы заблокированы»:
	// различимость этих случаев снаружи — утечка.
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
}

func TestSendRequest_PrivacyNone_Rejected(t *testing.T) {
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyNone, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)

	_, _, _, err := uc.SendRequest(me, "other")
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
}

func TestSendRequest_MutualServers_NoCommonServer_Rejected(t *testing.T) {
	uc, _, br, ur, sr := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByUsername", "other").Return(userWith(other, "other", domain.PrivacyMutualServers, domain.PrivacyFriends), nil)
	br.On("IsBlockedEither", me, other).Return(false, nil)
	sr.On("HasMutualServer", me, other).Return(false, nil)

	_, _, _, err := uc.SendRequest(me, "other")
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

	req, target, accepted, err := uc.SendRequest(me, "other")
	require.NoError(t, err)
	assert.False(t, accepted)
	assert.Equal(t, other, target.UserID)
	assert.Equal(t, other, req.User.UserID)
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
	uc, _, br, ur, _ := newFriendUC(t)
	me, other := uuid.New(), uuid.New()
	ur.On("GetByID", other).Return(userWith(other, "other", domain.PrivacyEveryone, domain.PrivacyEveryone), nil)
	// Блокировка проверяется ПЕРВОЙ и короткозамыкает дружбу.
	br.On("IsBlockedEither", me, other).Return(true, nil)

	assert.ErrorIs(t, uc.CanDM(me, other), domain.ErrInteractionForbidden)
	fr := new(MockFriendRepository)
	fr.AssertNotCalled(t, "IsFriend")
}
