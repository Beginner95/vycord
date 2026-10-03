package postgres_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/repository/postgres"
)

func newRingingCall(caller, receiver uuid.UUID) *domain.Call {
	return &domain.Call{
		ID: uuid.New(), CallerID: caller, ReceiverID: receiver,
		Status: domain.CallStatusRinging, StartedAt: time.Now().UTC(),
	}
}

func TestCallRepository_Lifecycle(t *testing.T) {
	pool := openIntegrationDB(t)
	repo := postgres.NewCallRepository(pool)
	a, b := seedUser(t, pool), seedUser(t, pool)

	// Без звонков — nil, nil, а не ошибка (регрессия pgx.ErrNoRows).
	live, err := repo.ListLiveByUser(a)
	require.NoError(t, err)
	assert.Empty(t, live)

	_, err = repo.GetByID(uuid.New())
	assert.ErrorIs(t, err, domain.ErrCallNotFound)

	call := newRingingCall(a, b)
	require.NoError(t, repo.Create(call))

	ok, err := repo.Exists(call.ID)
	require.NoError(t, err)
	assert.True(t, ok)

	live, err = repo.ListLiveByUser(b)
	require.NoError(t, err)
	require.Len(t, live, 1)
	assert.Equal(t, call.ID, live[0].ID)

	now := time.Now().UTC()
	moved, err := repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, now)
	require.NoError(t, err)
	assert.True(t, moved)

	// Повтор того же перехода проигрывает: статус уже active.
	moved, err = repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, now)
	require.NoError(t, err)
	assert.False(t, moved)

	got, err := repo.GetByID(call.ID)
	require.NoError(t, err)
	assert.Equal(t, domain.CallStatusActive, got.Status)
	require.NotNil(t, got.AcceptedAt)
	assert.Nil(t, got.EndedAt)

	moved, err = repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusActive}, domain.CallStatusEnded, now)
	require.NoError(t, err)
	assert.True(t, moved)
	got, err = repo.GetByID(call.ID)
	require.NoError(t, err)
	require.NotNil(t, got.EndedAt)

	live, err = repo.ListLiveByUser(a)
	require.NoError(t, err)
	assert.Empty(t, live)
}

func TestCallRepository_CloseAllLive(t *testing.T) {
	pool := openIntegrationDB(t)
	repo := postgres.NewCallRepository(pool)
	a, b, c := seedUser(t, pool), seedUser(t, pool), seedUser(t, pool)

	ringing := newRingingCall(a, b)
	require.NoError(t, repo.Create(ringing))
	active := newRingingCall(c, a)
	require.NoError(t, repo.Create(active))
	_, err := repo.Transition(active.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, time.Now())
	require.NoError(t, err)

	n, err := repo.CloseAllLive(time.Now())
	require.NoError(t, err)
	assert.EqualValues(t, 2, n)

	got, _ := repo.GetByID(ringing.ID)
	assert.Equal(t, domain.CallStatusMissed, got.Status)
	got, _ = repo.GetByID(active.ID)
	assert.Equal(t, domain.CallStatusEnded, got.Status)
}
