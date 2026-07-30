package domain_test

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/domain"
)

func TestPermissionSet_Owner_HasEverything(t *testing.T) {
	ps := domain.PermissionSet{IsOwner: true, Bits: 0, HighestPosition: -1}

	assert.True(t, ps.Has(domain.PermManageServer))
	assert.True(t, ps.Has(domain.PermManageRoles))
	assert.True(t, ps.Has(domain.PermSendMessages))
}

func TestPermissionSet_Administrator_HasEverything(t *testing.T) {
	ps := domain.PermissionSet{Bits: domain.PermAdministrator, HighestPosition: 1}

	assert.True(t, ps.Has(domain.PermManageChannels))
	assert.True(t, ps.Has(domain.PermMentionEveryone))
}

func TestPermissionSet_ExplicitBits(t *testing.T) {
	ps := domain.PermissionSet{
		Bits:            domain.PermViewChannels | domain.PermSendMessages,
		HighestPosition: 0,
	}

	assert.True(t, ps.Has(domain.PermViewChannels))
	assert.True(t, ps.Has(domain.PermSendMessages))
	assert.False(t, ps.Has(domain.PermManageChannels))
	assert.False(t, ps.Has(domain.PermAdministrator))
}

func TestPermissionSet_Empty_HasNothing(t *testing.T) {
	var ps domain.PermissionSet

	assert.False(t, ps.Has(domain.PermViewChannels))
	assert.False(t, ps.Has(domain.PermSendMessages))
}

func TestPermission_IsValid(t *testing.T) {
	assert.True(t, (domain.PermViewChannels | domain.PermSendMessages).IsValid())
	assert.True(t, domain.PermAll.IsValid())
	assert.True(t, domain.Permission(0).IsValid())
	// Бит 63 не соответствует ни одному известному праву.
	assert.False(t, domain.Permission(1<<63).IsValid())
}

func TestPermission_JSONRoundTrip(t *testing.T) {
	type payload struct {
		Permissions domain.Permission `json:"permissions"`
	}

	raw, err := json.Marshal(payload{Permissions: domain.PermViewChannels | domain.PermSendMessages})
	require.NoError(t, err)
	assert.JSONEq(t, `{"permissions":"48"}`, string(raw))

	var got payload
	require.NoError(t, json.Unmarshal([]byte(`{"permissions":"64"}`), &got))
	assert.Equal(t, domain.PermMentionEveryone, got.Permissions)
}

func TestPermission_UnmarshalRejectsGarbage(t *testing.T) {
	var p domain.Permission
	assert.Error(t, p.UnmarshalJSON([]byte(`"not-a-number"`)))
}

func TestPermission_UnmarshalRejectsBareNumber(t *testing.T) {
	// Строковый контракт (см. MarshalJSON) должен отвергать голое JSON-число:
	// это ровно та ошибка клиента ("забыли закавычить поле"), от которой
	// строковое кодирование должно защищать.
	var p domain.Permission
	assert.Error(t, p.UnmarshalJSON([]byte(`64`)))
}

func TestPermissionBitValues(t *testing.T) {
	// Значения зафиксированы: миграция 011 записывает их в БД числами.
	assert.Equal(t, domain.Permission(1), domain.PermAdministrator)
	assert.Equal(t, domain.Permission(2), domain.PermManageServer)
	assert.Equal(t, domain.Permission(4), domain.PermManageRoles)
	assert.Equal(t, domain.Permission(8), domain.PermManageChannels)
	assert.Equal(t, domain.Permission(16), domain.PermViewChannels)
	assert.Equal(t, domain.Permission(32), domain.PermSendMessages)
	assert.Equal(t, domain.Permission(64), domain.PermMentionEveryone)
	assert.Equal(t, domain.Permission(127), domain.PermAll)
}
