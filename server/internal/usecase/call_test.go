package usecase_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
)

func TestCallStart_RingsBothParties(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)

	call, err := env.uc.Start(a, b)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(call.ID))

	for _, u := range []uuid.UUID{a, b} {
		evs := env.notes.of(u, "call_ringing")
		require.Len(t, evs, 1, "call_ringing обоим")
		snap := evs[0].Payload.(domain.CallSnapshot)
		assert.Equal(t, call.ID, snap.CallID)
		assert.Equal(t, a, snap.Caller.ID)
		assert.Equal(t, b, snap.Receiver.ID)
		assert.NotEmpty(t, snap.Caller.Username)
	}
}

func TestCallStart_Forbidden(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	env.deny.denied[[2]uuid.UUID{a, b}] = domain.ErrInteractionForbidden

	_, err := env.uc.Start(a, b)
	assert.ErrorIs(t, err, domain.ErrInteractionForbidden)
	assert.Empty(t, env.notes.of(b, "call_ringing"))
}

func TestCallStart_Self(t *testing.T) {
	a := uuid.New()
	env := newCallEnv(a)
	_, err := env.uc.Start(a, a)
	assert.ErrorIs(t, err, domain.ErrSelfFriendship)
}

func TestCallStart_ReceiverOffline(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a)
	_, err := env.uc.Start(a, b)
	assert.ErrorIs(t, err, domain.ErrCallPeerOffline)
}

func TestCallStart_Idempotent(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)
	second, err := env.uc.Start(a, b)
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
}

func TestCallStart_CrossCallAcceptsExisting(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)

	second, err := env.uc.Start(b, a) // встречный вызов
	require.NoError(t, err)
	assert.Equal(t, first.ID, second.ID)
	assert.Equal(t, domain.CallStatusActive, env.repo.status(first.ID))
	assert.Len(t, env.notes.of(a, "call_accepted"), 1)
}

func TestCallStart_ReceiverAlreadyRinging_Busy(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	_, err := env.uc.Start(a, b)
	require.NoError(t, err)

	_, err = env.uc.Start(c, b)
	assert.ErrorIs(t, err, domain.ErrCallBusy)
}

func TestCallStart_ReceiverInActiveCall_StillRings(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, err := env.uc.Start(a, b)
	require.NoError(t, err)
	require.NoError(t, env.uc.Accept(b, ab.ID))

	cb, err := env.uc.Start(c, b)
	require.NoError(t, err, "занятый активным звонком всё равно получает вызов")
	assert.Equal(t, domain.CallStatusRinging, env.repo.status(cb.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(ab.ID))
}

func TestCallStart_CallerSwitchesAwayFromActiveCall(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, ab.ID))
	env.notes.reset()

	_, err := env.uc.Start(a, c)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(ab.ID))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]))
}

func TestCallAccept_OnlyReceiver(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	assert.ErrorIs(t, env.uc.Accept(a, call.ID), domain.ErrCallNotFound)
	assert.ErrorIs(t, env.uc.Accept(uuid.New(), call.ID), domain.ErrCallNotFound)
	require.NoError(t, env.uc.Accept(b, call.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
	assert.Len(t, env.notes.of(a, "call_accepted"), 1)
	assert.Len(t, env.notes.of(b, "call_accepted"), 1)

	assert.ErrorIs(t, env.uc.Accept(b, call.ID), domain.ErrCallInvalidState, "повторный accept")
}

func TestCallAccept_SwitchesReceiverAwayFromActiveCall(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	ab, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, ab.ID))
	cb, _ := env.uc.Start(c, b)
	env.notes.reset()

	require.NoError(t, env.uc.Accept(b, cb.ID))
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(ab.ID))
	assert.Equal(t, domain.CallStatusActive, env.repo.status(cb.ID))
	require.Len(t, env.notes.of(a, "call_ended"), 1)
}

func TestCallReject(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	assert.ErrorIs(t, env.uc.Reject(a, call.ID), domain.ErrCallNotFound, "звонящий не отклоняет")
	require.NoError(t, env.uc.Reject(b, call.ID))
	assert.Equal(t, domain.CallStatusRejected, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndRejected, endReason(evs[0]))
}

func TestCallEnd_CallerCancelsWhileRinging_IsMissed(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	require.NoError(t, env.uc.End(a, call.ID, domain.CallEndEnded))
	assert.Equal(t, domain.CallStatusMissed, env.repo.status(call.ID))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndMissed, endReason(evs[0]))
}

func TestCallEnd_ActiveByEitherSide(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	require.NoError(t, env.uc.End(b, call.ID, domain.CallEndFailed))
	assert.Equal(t, domain.CallStatusEnded, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndFailed, endReason(evs[0]))

	assert.ErrorIs(t, env.uc.End(a, call.ID, domain.CallEndEnded), domain.ErrCallInvalidState)
}

func TestCallEnd_UnknownReasonBecomesEnded(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)
	require.NoError(t, env.uc.Accept(b, call.ID))

	require.NoError(t, env.uc.End(a, call.ID, domain.CallEndReason("timeout")))
	evs := env.notes.of(b, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndEnded, endReason(evs[0]), "клиент не может прислать серверную причину")
}

func TestCallStart_ReceiverHasOutgoingRinging_Busy(t *testing.T) {
	a, b, c := uuid.New(), uuid.New(), uuid.New()
	env := newCallEnv(a, b, c)
	_, err := env.uc.Start(b, c) // b сам звонит c
	require.NoError(t, err)

	_, err = env.uc.Start(a, b)
	assert.ErrorIs(t, err, domain.ErrCallBusy)
}

func TestCallEnd_ReceiverWhileRinging_IsRejected(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, _ := env.uc.Start(a, b)

	require.NoError(t, env.uc.End(b, call.ID, domain.CallEndEnded))
	assert.Equal(t, domain.CallStatusRejected, env.repo.status(call.ID))
	evs := env.notes.of(a, "call_ended")
	require.Len(t, evs, 1)
	assert.Equal(t, domain.CallEndRejected, endReason(evs[0]))
}

func TestCallStart_Idempotent_NoSecondRingingForReceiver(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	_, err := env.uc.Start(a, b)
	require.NoError(t, err)
	_, err = env.uc.Start(a, b)
	require.NoError(t, err)
	// Звонящему снимок переотправляется (клиент мог потерять call_id), получателю
	// второй вызов не звонит.
	assert.Len(t, env.notes.of(a, "call_ringing"), 2)
	assert.Len(t, env.notes.of(b, "call_ringing"), 1)
}

func TestCallStart_CrossCall_NotifiesBothAndNoSecondCall(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)
	_, err = env.uc.Start(b, a)
	require.NoError(t, err)

	assert.Len(t, env.notes.of(a, "call_accepted"), 1)
	assert.Len(t, env.notes.of(b, "call_accepted"), 1)
	assert.Len(t, env.notes.of(a, "call_ringing"), 1, "второй звонок не создавался")
	live, _ := env.repo.ListLiveByUser(a)
	require.Len(t, live, 1)
	assert.Equal(t, first.ID, live[0].ID)
}

func TestCallStart_Idempotent_ResendsRingingSnapshotToCaller(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	first, err := env.uc.Start(a, b)
	require.NoError(t, err)
	env.notes.reset()

	_, err = env.uc.Start(a, b)
	require.NoError(t, err)
	evs := env.notes.of(a, "call_ringing")
	require.Len(t, evs, 1, "звонящий получает текущий снимок")
	snap := evs[0].Payload.(domain.CallSnapshot)
	assert.Equal(t, first.ID, snap.CallID)
	assert.Equal(t, domain.CallStatusRinging, snap.Status)
	assert.Empty(t, env.notes.of(b, "call_ringing"))
}

func TestCallStart_ActiveSamePair_ResendsAcceptedToCaller(t *testing.T) {
	a, b := uuid.New(), uuid.New()
	env := newCallEnv(a, b)
	call, err := env.uc.Start(a, b)
	require.NoError(t, err)
	require.NoError(t, env.uc.Accept(b, call.ID))

	for _, caller := range []uuid.UUID{a, b} { // любая сторона жмёт «Позвонить» в живой звонок
		env.notes.reset()
		again, err := env.uc.Start(caller, other(a, b, caller))
		require.NoError(t, err)
		assert.Equal(t, call.ID, again.ID)
		assert.Equal(t, domain.CallStatusActive, env.repo.status(call.ID))
		evs := env.notes.of(caller, "call_accepted")
		require.Len(t, evs, 1, "звонящий получает call_accepted текущего звонка")
		assert.Equal(t, call.ID.String(), evs[0].Payload.(map[string]any)["call_id"])
		assert.Empty(t, env.notes.of(other(a, b, caller), "call_accepted"), "собеседника не дёргаем")
		assert.Empty(t, env.notes.of(caller, "call_ended"))
	}
}

func other(a, b, me uuid.UUID) uuid.UUID {
	if me == a {
		return b
	}
	return a
}
