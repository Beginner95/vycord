package usecase_test

import (
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/mock"
	"github.com/stretchr/testify/require"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

type MockPlanRepository struct{ mock.Mock }

func (m *MockPlanRepository) GetByUserID(userID uuid.UUID) (*domain.Plan, error) {
	args := m.Called(userID)
	if args.Get(0) == nil {
		return nil, args.Error(1)
	}
	return args.Get(0).(*domain.Plan), args.Error(1)
}

func freePlan() *domain.Plan {
	return &domain.Plan{Code: "free", MaxFileBytes: 26214400}
}

func TestCheckUploadAcceptsFileWithinPlanLimit(t *testing.T) {
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(freePlan(), nil)
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Minute)

	assert.NoError(t, uc.CheckUpload(userID, 26214400))
}

func TestCheckUploadRejectsFileOverPlanLimit(t *testing.T) {
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(freePlan(), nil)
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Minute)

	err := uc.CheckUpload(userID, 26214401)

	assert.ErrorIs(t, err, domain.ErrAttachmentTooLarge)
}

func TestCheckUploadUsesLimitFromPlanNotConstant(t *testing.T) {
	// Платный план поднимает лимит без единой правки кода — ради этого
	// значение и живёт в таблице.
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(&domain.Plan{Code: "pro", MaxFileBytes: 104857600}, nil)
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Minute)

	assert.NoError(t, uc.CheckUpload(userID, 104857600))
	assert.ErrorIs(t, uc.CheckUpload(userID, 104857601), domain.ErrAttachmentTooLarge)
}

func TestCheckUploadSkipsTotalSizeWhenPlanHasNoTotalLimit(t *testing.T) {
	// У free max_total_bytes = NULL, поэтому суммы вообще не считаем —
	// лишнего запроса в БД на каждую загрузку быть не должно.
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(freePlan(), nil)
	attachRepo := new(MockAttachmentRepository)
	uc := usecase.NewQuotaUseCase(planRepo, attachRepo, time.Minute)

	require.NoError(t, uc.CheckUpload(userID, 1000))

	attachRepo.AssertNotCalled(t, "TotalBytesByUser", mock.Anything)
}

func TestCheckUploadEnforcesTotalSizeWhenPlanSetsIt(t *testing.T) {
	userID := uuid.New()
	total := int64(1000)
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(&domain.Plan{Code: "pro", MaxFileBytes: 500, MaxTotalBytes: &total}, nil)
	attachRepo := new(MockAttachmentRepository)
	attachRepo.On("TotalBytesByUser", userID).Return(int64(800), nil)
	uc := usecase.NewQuotaUseCase(planRepo, attachRepo, time.Minute)

	err := uc.CheckUpload(userID, 300)

	assert.ErrorIs(t, err, domain.ErrStorageQuotaExceeded)
}

func TestExpiresAtIsNilWhenPlanKeepsFilesForever(t *testing.T) {
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(freePlan(), nil)
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Minute)

	got, err := uc.ExpiresAt(userID, time.Now())

	require.NoError(t, err)
	assert.Nil(t, got, "у free retention не ограничен — срока хранения быть не должно")
}

func TestExpiresAtIsComputedFromRetentionDays(t *testing.T) {
	userID := uuid.New()
	days := 30
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(&domain.Plan{Code: "basic", MaxFileBytes: 100, RetentionDays: &days}, nil)
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Minute)

	now := time.Date(2026, 8, 27, 12, 0, 0, 0, time.UTC)
	got, err := uc.ExpiresAt(userID, now)

	require.NoError(t, err)
	require.NotNil(t, got)
	assert.Equal(t, now.AddDate(0, 0, 30), *got)
}

func TestPlanIsCachedBetweenCalls(t *testing.T) {
	// Таблица планов крошечная и меняется редко: ходить в БД на каждую
	// загрузку незачем.
	userID := uuid.New()
	planRepo := new(MockPlanRepository)
	planRepo.On("GetByUserID", userID).Return(freePlan(), nil).Once()
	uc := usecase.NewQuotaUseCase(planRepo, new(MockAttachmentRepository), time.Hour)

	require.NoError(t, uc.CheckUpload(userID, 10))
	require.NoError(t, uc.CheckUpload(userID, 20))

	planRepo.AssertExpectations(t)
}
