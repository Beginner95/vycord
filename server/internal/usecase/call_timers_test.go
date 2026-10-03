package usecase_test

import (
	"errors"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/authtoken"
)

func TestRingTimeout_Missed(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	env.clock.Advance(usecase.CallRingTimeout - time.Second)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID))

	env.clock.Advance(time.Second)
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	for _, u := range []uuid.UUID{a, b} {
		evs := env.notes.of(u, "call_ended")
		require.Len(t, evs, 1)
		assert.Equal(t, domain.CallEndTimeout, endReason(evs[0]))
	}
}

func TestRingTimeout_AfterAccept_NoOp(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.clock.Advance(usecase.CallRingTimeout * 2)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
	assert.Empty(t, env.notes.of(a, "call_ended"))
}

func TestRingTimeout_TransitionFails_Retried(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	env.repo.failNextTransition(1)
	env.clock.Advance(usecase.CallRingTimeout)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID), "сбой БД: звонок пока висит")
	assert.Empty(t, env.notes.of(a, "call_ended"))

	env.clock.Advance(usecase.CallRingRetryDelay - time.Second)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID))

	env.clock.Advance(time.Second)
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndTimeout, endReason(evs[0]))
}

func TestDisconnect_WhileRinging_EndsImmediately(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndMissed, endReason(evs[0]))
}

func TestDisconnect_Active_GraceThenEnd(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	env.clock.Advance(usecase.CallDisconnectGrace - time.Second)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))

	env.clock.Advance(time.Second)
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]))
}

func TestDisconnect_Active_ReconnectWithinGrace_KeepsCall(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.presence.set(b, false)
	env.uc.OnDisconnect(b)
	env.clock.Advance(10 * time.Second)
	env.presence.set(b, true)
	snap := env.uc.OnConnect(b)

	require.NotNil(t, snap, "реконнект возвращает снимок живого звонка")
	assert.Equal(t, call.ID, snap.CallID)
	assert.Equal(t, domain.CallStatusActive, snap.Status)

	env.clock.Advance(usecase.CallDisconnectGrace)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
}

func TestDisconnect_Active_GraceExpiresButOnline_KeepsCall(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	env.uc.OnDisconnect(b)
	env.presence.set(b, true) // вернулся без OnConnect
	env.clock.Advance(usecase.CallDisconnectGrace)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
}

func TestOnConnect_NoCall_Nil(t *testing.T) {
	a := uuid.New()
	env := newCallEnv(a)
	assert.Nil(t, env.uc.OnConnect(a))
}

func TestIssueRoomToken(t *testing.T) {
	a, b, stranger := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	_, err := env.uc.IssueRoomToken(a, call.ID)
	assert.ErrorIs(t, err, domain.ErrCallInvalidState, "до ответа токена нет")

	require.NoError(t, env.uc.Accept(b, call.ID))
	_, err = env.uc.IssueRoomToken(stranger, call.ID)
	assert.ErrorIs(t, err, domain.ErrCallNotFound)

	tok, err := env.uc.IssueRoomToken(a, call.ID)
	require.NoError(t, err)
	uid, room, err := authtoken.ValidateRoomToken("test-secret", tok)
	require.NoError(t, err)
	assert.Equal(t, a, uid)
	assert.Equal(t, call.ID, room)
}

func TestIsCallRoom(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	assert.True(t, env.uc.IsCallRoom(call.ID))
	assert.False(t, env.uc.IsCallRoom(uuid.New()), "id канала — не комната звонка")
}

func TestRecoverOnStartup(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.RecoverOnStartup())
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
}

// OnConnect не держит общий mu на время чтения БД: медленная БД у одного
// реконнекта не должна останавливать звонки остальных (шторм реконнектов).
func TestOnConnect_DoesNotHoldLockDuringDBRead(t *testing.T) {
	a, b, slow := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, slow)
	entered, release := make(chan struct{}), make(chan struct{})
	env.repo.listGate = func(u uuid.UUID) {
		if u == slow {
			close(entered)
			<-release
		}
	}
	done := make(chan struct{})
	go func() { env.uc.OnConnect(slow); close(done) }()
	<-entered

	started := make(chan error, 1)
	go func() { _, err := env.uc.Start(a, b); started <- err }()
	select {
	case err := <-started:
		require.NoError(t, err)
	case <-time.After(2 * time.Second):
		close(release)
		<-done
		t.Fatal("Start ждал mu, пока OnConnect читал БД")
	}
	close(release)
	<-done
}

func TestOnConnect_ListError_Nil(t *testing.T) {
	a := uuid.New()
	env := newCallEnv(a)
	env.repo.listErr = errors.New("db down")
	assert.Nil(t, env.uc.OnConnect(a))
}

func TestOnConnect_StopsGraceAndReturnsActive(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))
	env.uc.OnDisconnect(b)
	env.presence.set(b, false)
	snap := env.uc.OnConnect(b)
	require.NotNil(t, snap)
	assert.Equal(t, call.ID, snap.CallID)
	env.clock.Advance(usecase.CallDisconnectGrace)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID), "реконнект снял grace")
}

// Отрицательный результат тоже кэшируется: id канала никогда не станет id
// звонка (строка звонка создаётся до выдачи любого токена в его комнату).
func TestIsCallRoom_CachesNegative(t *testing.T) {
	env := newCallEnv()
	ch := uuid.New()
	assert.False(t, env.uc.IsCallRoom(ch))
	assert.False(t, env.uc.IsCallRoom(ch))
	assert.Equal(t, 1, env.repo.existsCalls)
}

func TestIsCallRoom_DBError_FalseNotCached(t *testing.T) {
	env := newCallEnv()
	ch := uuid.New()
	env.repo.existsErr = errors.New("db down")
	assert.False(t, env.uc.IsCallRoom(ch))
	env.repo.existsErr = nil
	assert.False(t, env.uc.IsCallRoom(ch))
	assert.Equal(t, 2, env.repo.existsCalls, "ошибку БД не кэшируем")
}

// Grace-таймер, сработавший раньше, чем OnDisconnect сохранил его Stopper,
// всё равно должен завершить звонок (замыкание не читает переменную до mu).
func TestDisconnect_GraceFiresImmediately_StillEnds(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	clock := &immediateClock{only: usecase.CallDisconnectGrace}
	repo := newMemCallRepo()
	presence := &setPresence{online: map[uuid.UUID]bool{a: true, b: true}}
	uc := usecase.NewCallUseCase(usecase.CallDeps{
		Repo: repo, Notifier: &recNotifier{}, Presence: presence,
		Permission: denyList{denied: map[[2]uuid.UUID]error{}}, Users: usersByID{}, Clock: clock, JWTSecret: "s",
	})
	call, err := uc.Start(a, b)
	require.NoError(t, err)
	require.NoError(t, uc.Accept(b, call.ID))
	presence.set(b, false)
	uc.OnDisconnect(b)
	clock.wg.Wait()
	assert.Equal(t, domain.CallStatusEnded, repo.status(call.ID))
}
