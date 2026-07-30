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

// MockPermissionUseCase — мок domain.PermissionUseCase.
type MockPermissionUseCase struct {
	mock.Mock
}

func (m *MockPermissionUseCase) Resolve(serverID, userID uuid.UUID) (domain.PermissionSet, error) {
	args := m.Called(serverID, userID)
	return args.Get(0).(domain.PermissionSet), args.Error(1)
}

// roleFixture — окружение теста ролей.
type roleFixture struct {
	serverID uuid.UUID
	ownerID  uuid.UUID
	actorID  uuid.UUID
	targetID uuid.UUID
	srvRepo  *MockServerRepository
	roleRepo *MockRoleRepository
	perms    *MockPermissionUseCase
	uc       domain.RoleUseCase
}

func newRoleFixture(t *testing.T) *roleFixture {
	t.Helper()
	f := &roleFixture{
		serverID: uuid.New(),
		ownerID:  uuid.New(),
		actorID:  uuid.New(),
		targetID: uuid.New(),
		srvRepo:  new(MockServerRepository),
		roleRepo: new(MockRoleRepository),
		perms:    new(MockPermissionUseCase),
	}
	f.uc = usecase.NewRoleUseCase(f.srvRepo, f.roleRepo, f.perms)
	f.srvRepo.On("GetByID", f.serverID).Return(&domain.Server{ID: f.serverID, OwnerID: f.ownerID}, nil).Maybe()
	return f
}

// actorWith настраивает права актора: MANAGE_ROLES + переданные биты, позиция pos.
func (f *roleFixture) actorWith(bits domain.Permission, pos int) {
	f.perms.On("Resolve", f.serverID, f.actorID).
		Return(domain.PermissionSet{Bits: domain.PermManageRoles | bits, HighestPosition: pos}, nil)
}

func (f *roleFixture) targetAt(pos int) {
	f.perms.On("Resolve", f.serverID, f.targetID).
		Return(domain.PermissionSet{Bits: domain.PermViewChannels, HighestPosition: pos}, nil)
}

func (f *roleFixture) role(pos int, perms domain.Permission, isDefault bool) *domain.Role {
	r := &domain.Role{ID: uuid.New(), ServerID: f.serverID, Name: "Модератор", Position: pos, Permissions: perms, IsDefault: isDefault}
	f.roleRepo.On("GetByID", r.ID).Return(r, nil)
	return r
}

// --- Инвариант 1: нельзя выдать право, которого у тебя нет ---

func TestCreateRole_GrantingUnheldPermission_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(domain.PermManageChannels, 5)

	_, err := f.uc.CreateRole(f.serverID, f.actorID, "Хостер", 0, 2, domain.PermManageServer)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "Create", mock.Anything)
}

func TestCreateRole_GrantingHeldPermission_Success(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(domain.PermManageChannels, 5)
	f.roleRepo.On("Create", mock.AnythingOfType("*domain.Role")).Return(nil)

	got, err := f.uc.CreateRole(f.serverID, f.actorID, "Модератор", 0, 2, domain.PermManageChannels)

	require.NoError(t, err)
	assert.Equal(t, domain.PermManageChannels, got.Permissions)
	assert.Equal(t, 2, got.Position)
	assert.False(t, got.IsDefault)
}

func TestCreateRole_SelfEscalationToAdministrator_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)

	_, err := f.uc.CreateRole(f.serverID, f.actorID, "Root", 0, 2, domain.PermAdministrator)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestCreateRole_InvalidPermissionBits_Rejected(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)

	_, err := f.uc.CreateRole(f.serverID, f.actorID, "Странная", 0, 2, domain.Permission(1<<63))

	assert.ErrorIs(t, err, domain.ErrInvalidPermissions)
}

// --- Инвариант 2: нельзя трогать роль на своём уровне и выше ---

func TestUpdateRole_AtOwnPosition_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 3)
	role := f.role(3, domain.PermViewChannels, false)

	name := "Переименована"
	_, err := f.uc.UpdateRole(f.serverID, role.ID, f.actorID, domain.RolePatch{Name: &name})

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "Update", mock.Anything, mock.Anything)
}

func TestUpdateRole_BelowOwnPosition_Success(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 3)
	role := f.role(1, domain.PermViewChannels, false)
	f.roleRepo.On("Update", role.ID, mock.Anything).Return(nil)

	name := "Переименована"
	got, err := f.uc.UpdateRole(f.serverID, role.ID, f.actorID, domain.RolePatch{Name: &name})

	require.NoError(t, err)
	assert.Equal(t, "Переименована", got.Name)
}

func TestCreateRole_AtOrAboveOwnPosition_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 3)

	_, err := f.uc.CreateRole(f.serverID, f.actorID, "Выскочка", 0, 3, domain.PermViewChannels)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestDeleteRole_AboveOwnPosition_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 2)
	role := f.role(4, domain.PermViewChannels, false)

	err := f.uc.DeleteRole(f.serverID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

// --- Инвариант 3: нельзя действовать над участником выше или равным себе ---

func TestAssignRole_TargetAboveActor_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 3)
	f.targetAt(5)
	role := f.role(1, domain.PermViewChannels, false)

	err := f.uc.AssignRole(f.serverID, f.targetID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "AssignToMember", mock.Anything, mock.Anything, mock.Anything)
}

func TestAssignRole_TargetBelowActor_Success(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 3)
	f.targetAt(0)
	role := f.role(1, domain.PermViewChannels, false)
	f.srvRepo.On("IsMember", f.serverID, f.targetID).Return(true, nil)
	f.roleRepo.On("AssignToMember", f.serverID, f.targetID, role.ID).Return(nil)

	err := f.uc.AssignRole(f.serverID, f.targetID, role.ID, f.actorID)

	require.NoError(t, err)
}

func TestUnassignRole_TargetEqualToActor_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 2)
	f.targetAt(2)
	role := f.role(1, domain.PermViewChannels, false)

	err := f.uc.UnassignRole(f.serverID, f.targetID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

// --- Инвариант 4: @everyone неудаляема и неназначаема ---

func TestDeleteRole_Everyone_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)
	role := f.role(0, domain.PermViewChannels, true)

	err := f.uc.DeleteRole(f.serverID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "Delete", mock.Anything)
}

func TestAssignRole_Everyone_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)
	f.targetAt(0)
	role := f.role(0, domain.PermViewChannels, true)

	err := f.uc.AssignRole(f.serverID, f.targetID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestUpdateRole_EveryonePermissions_Success(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(domain.PermMentionEveryone, 5)
	role := f.role(0, domain.PermViewChannels|domain.PermSendMessages, true)
	f.roleRepo.On("Update", role.ID, mock.Anything).Return(nil)

	perms := domain.PermViewChannels | domain.PermSendMessages | domain.PermMentionEveryone
	got, err := f.uc.UpdateRole(f.serverID, role.ID, f.actorID, domain.RolePatch{Permissions: &perms})

	require.NoError(t, err)
	assert.Equal(t, perms, got.Permissions)
}

func TestUpdateRole_EveryonePosition_Ignored(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)
	role := f.role(0, domain.PermViewChannels, true)
	f.roleRepo.On("Update", role.ID, mock.Anything).Return(nil)

	pos := 9
	got, err := f.uc.UpdateRole(f.serverID, role.ID, f.actorID, domain.RolePatch{Position: &pos})

	require.NoError(t, err)
	assert.Equal(t, 0, got.Position, "позиция @everyone всегда 0")
}

// --- Инвариант 5: владелец вне досягаемости ---

func TestAssignRole_TargetIsOwner_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(domain.PermAdministrator, 9)
	role := f.role(1, domain.PermViewChannels, false)

	err := f.uc.AssignRole(f.serverID, f.ownerID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
	f.roleRepo.AssertNotCalled(t, "AssignToMember", mock.Anything, mock.Anything, mock.Anything)
}

func TestUnassignRole_TargetIsOwner_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(domain.PermAdministrator, 9)
	role := f.role(1, domain.PermViewChannels, false)

	err := f.uc.UnassignRole(f.serverID, f.ownerID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

// --- Владелец проходит всё ---

func TestOwner_CanDoEverything(t *testing.T) {
	f := newRoleFixture(t)
	f.perms.On("Resolve", f.serverID, f.ownerID).
		Return(domain.PermissionSet{IsOwner: true, HighestPosition: 0}, nil)
	f.targetAt(7)
	f.roleRepo.On("Create", mock.AnythingOfType("*domain.Role")).Return(nil)
	f.srvRepo.On("IsMember", f.serverID, f.targetID).Return(true, nil)

	created, err := f.uc.CreateRole(f.serverID, f.ownerID, "Root", 0, 99, domain.PermAdministrator)
	require.NoError(t, err, "владелец выдаёт любые права на любой позиции")
	assert.Equal(t, domain.PermAdministrator, created.Permissions)

	high := f.role(50, domain.PermAdministrator, false)
	f.roleRepo.On("AssignToMember", f.serverID, f.targetID, high.ID).Return(nil)
	assert.NoError(t, f.uc.AssignRole(f.serverID, f.targetID, high.ID, f.ownerID),
		"владелец назначает роль участнику любого ранга")

	f.roleRepo.On("Delete", high.ID).Return(nil)
	assert.NoError(t, f.uc.DeleteRole(f.serverID, high.ID, f.ownerID))
}

// --- Прочее ---

func TestRoleOps_WithoutManageRoles_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.perms.On("Resolve", f.serverID, f.actorID).
		Return(domain.PermissionSet{Bits: domain.PermViewChannels | domain.PermSendMessages, HighestPosition: 0}, nil)

	_, err := f.uc.CreateRole(f.serverID, f.actorID, "Моя роль", 0, 1, domain.PermViewChannels)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestRoleOps_RoleFromAnotherServer_NotFound(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)
	alien := &domain.Role{ID: uuid.New(), ServerID: uuid.New(), Position: 1}
	f.roleRepo.On("GetByID", alien.ID).Return(alien, nil)

	err := f.uc.DeleteRole(f.serverID, alien.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrRoleNotFound)
}

func TestAssignRole_TargetNotMember_Forbidden(t *testing.T) {
	f := newRoleFixture(t)
	f.actorWith(0, 5)
	f.targetAt(0)
	role := f.role(1, domain.PermViewChannels, false)
	f.srvRepo.On("IsMember", f.serverID, f.targetID).Return(false, nil)

	err := f.uc.AssignRole(f.serverID, f.targetID, role.ID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}

func TestListRoles_RequiresViewChannels(t *testing.T) {
	f := newRoleFixture(t)
	f.perms.On("Resolve", f.serverID, f.actorID).
		Return(domain.PermissionSet{HighestPosition: -1}, nil)

	_, err := f.uc.ListRoles(f.serverID, f.actorID)

	assert.ErrorIs(t, err, domain.ErrForbidden)
}
