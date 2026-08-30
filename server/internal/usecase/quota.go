package usecase

import (
	"fmt"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
)

type cachedPlan struct {
	plan    *domain.Plan
	fetched time.Time
}

type quotaUseCase struct {
	planRepo   domain.PlanRepository
	attachRepo domain.AttachmentRepository
	cacheTTL   time.Duration

	mu    sync.RWMutex
	cache map[uuid.UUID]cachedPlan

	// Now подменяется в тестах кэша.
	Now func() time.Time
}

// NewQuotaUseCase собирает единственный источник правды по лимитам.
//
// План кэшируется на cacheTTL: таблица крошечная и меняется редко, а ходить в
// БД на каждую загрузку незачем. Кэш по пользователю, а не по плану, чтобы
// смена тарифа подхватилась сама в течение TTL.
func NewQuotaUseCase(planRepo domain.PlanRepository, attachRepo domain.AttachmentRepository, cacheTTL time.Duration) domain.QuotaUseCase {
	return &quotaUseCase{
		planRepo:   planRepo,
		attachRepo: attachRepo,
		cacheTTL:   cacheTTL,
		cache:      make(map[uuid.UUID]cachedPlan),
		Now:        time.Now,
	}
}

func (uc *quotaUseCase) plan(userID uuid.UUID) (*domain.Plan, error) {
	uc.mu.RLock()
	c, ok := uc.cache[userID]
	uc.mu.RUnlock()
	if ok && uc.Now().Sub(c.fetched) < uc.cacheTTL {
		return c.plan, nil
	}

	p, err := uc.planRepo.GetByUserID(userID)
	if err != nil {
		return nil, fmt.Errorf("get plan: %w", err)
	}

	uc.mu.Lock()
	uc.cache[userID] = cachedPlan{plan: p, fetched: uc.Now()}
	uc.mu.Unlock()

	return p, nil
}

func (uc *quotaUseCase) For(userID uuid.UUID) (*domain.Quota, error) {
	p, err := uc.plan(userID)
	if err != nil {
		return nil, err
	}
	return &domain.Quota{
		MaxFileBytes:  p.MaxFileBytes,
		RetentionDays: p.RetentionDays,
		MaxTotalBytes: p.MaxTotalBytes,
	}, nil
}

func (uc *quotaUseCase) CheckUpload(userID uuid.UUID, size int64) error {
	q, err := uc.For(userID)
	if err != nil {
		return err
	}

	if size > q.MaxFileBytes {
		return fmt.Errorf("%d > %d: %w", size, q.MaxFileBytes, domain.ErrAttachmentTooLarge)
	}

	// Суммарный объём считаем только если план его ограничивает: у free
	// max_total_bytes = NULL, и лишний запрос в БД делать не за чем.
	if q.MaxTotalBytes != nil {
		total, err := uc.attachRepo.TotalBytesByUser(userID)
		if err != nil {
			return fmt.Errorf("sum user attachments: %w", err)
		}
		if total+size > *q.MaxTotalBytes {
			return domain.ErrStorageQuotaExceeded
		}
	}

	return nil
}

func (uc *quotaUseCase) ExpiresAt(userID uuid.UUID, now time.Time) (*time.Time, error) {
	q, err := uc.For(userID)
	if err != nil {
		return nil, err
	}
	if q.RetentionDays == nil {
		return nil, nil
	}
	exp := now.AddDate(0, 0, *q.RetentionDays)
	return &exp, nil
}
