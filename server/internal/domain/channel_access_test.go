package domain_test

import (
	"testing"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"

	"github.com/vycord/server/internal/domain"
)

func TestChannel_CanAccess_PublicAlwaysTrue(t *testing.T) {
	ch := &domain.Channel{IsPrivate: false, OwnerID: uuid.New()}
	assert.True(t, ch.CanAccess(uuid.New(), domain.PermissionSet{}, false))
}

func TestChannel_CanAccess_PrivateOwnerTrue(t *testing.T) {
	ownerID := uuid.New()
	ch := &domain.Channel{IsPrivate: true, OwnerID: ownerID}
	assert.True(t, ch.CanAccess(ownerID, domain.PermissionSet{}, false))
}

func TestChannel_CanAccess_PrivateServerOwnerTrue(t *testing.T) {
	ch := &domain.Channel{IsPrivate: true, OwnerID: uuid.New()}
	assert.True(t, ch.CanAccess(uuid.New(), domain.PermissionSet{IsOwner: true}, false))
}

func TestChannel_CanAccess_PrivateAdministratorTrue(t *testing.T) {
	ch := &domain.Channel{IsPrivate: true, OwnerID: uuid.New()}
	ps := domain.PermissionSet{Bits: domain.PermAdministrator}
	assert.True(t, ch.CanAccess(uuid.New(), ps, false))
}

func TestChannel_CanAccess_PrivateInvitedMemberTrue(t *testing.T) {
	ch := &domain.Channel{IsPrivate: true, OwnerID: uuid.New()}
	assert.True(t, ch.CanAccess(uuid.New(), domain.PermissionSet{}, true))
}

func TestChannel_CanAccess_PrivatePlainManageChannelsFalse(t *testing.T) {
	// MANAGE_CHANNELS alone must NOT grant access to someone else's private
	// channel — only owner/server-owner/administrator/invited do.
	ch := &domain.Channel{IsPrivate: true, OwnerID: uuid.New()}
	ps := domain.PermissionSet{Bits: domain.PermManageChannels}
	assert.False(t, ch.CanAccess(uuid.New(), ps, false))
}

func TestChannel_IsManagedBy_Owner(t *testing.T) {
	ownerID := uuid.New()
	ch := &domain.Channel{OwnerID: ownerID}
	assert.True(t, ch.IsManagedBy(ownerID, domain.PermissionSet{}))
}

func TestChannel_IsManagedBy_ServerOwner(t *testing.T) {
	ch := &domain.Channel{OwnerID: uuid.New()}
	assert.True(t, ch.IsManagedBy(uuid.New(), domain.PermissionSet{IsOwner: true}))
}

func TestChannel_IsManagedBy_Administrator(t *testing.T) {
	ch := &domain.Channel{OwnerID: uuid.New()}
	assert.True(t, ch.IsManagedBy(uuid.New(), domain.PermissionSet{Bits: domain.PermAdministrator}))
}

func TestChannel_IsManagedBy_PlainManageChannelsFalse(t *testing.T) {
	ch := &domain.Channel{OwnerID: uuid.New()}
	assert.False(t, ch.IsManagedBy(uuid.New(), domain.PermissionSet{Bits: domain.PermManageChannels}))
}

func TestChannel_IsManagedBy_InvitedMemberFalse(t *testing.T) {
	// Being an invited channel_member grants viewing (CanAccess) but not
	// management authority (IsManagedBy) — an invited peer cannot invite
	// others or flip privacy back off.
	ch := &domain.Channel{OwnerID: uuid.New()}
	assert.False(t, ch.IsManagedBy(uuid.New(), domain.PermissionSet{}))
}
