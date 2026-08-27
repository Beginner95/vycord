// Package attachments содержит фоновое обслуживание вложений.
package attachments

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/filestorage"
)

// Janitor удаляет вложения, которые больше не нужны.
//
// Две ветки в одном проходе:
//  1. сироты — файл загрузили, но сообщение так и не отправили;
//  2. протухшие — истёк срок хранения по тарифному плану.
//
// Вторая ветка сегодня не находит ничего (у free retention не ограничен) и
// включится сама, когда появятся платные планы. Первая работает с первого дня:
// без неё черновики копились бы вечно.
type Janitor struct {
	repo    domain.AttachmentRepository
	storage filestorage.Storage
	log     *slog.Logger

	// Interval — как часто просыпаться. Раз в час: спешить некуда, а нагрузку
	// на БД создавать незачем.
	Interval time.Duration
	// OrphanAge — сколько черновик живёт, прежде чем считается брошенным.
	OrphanAge time.Duration
	// BatchLimit ограничивает один проход, чтобы разовая уборка миллиона строк
	// не легла поперёк рабочей нагрузки.
	BatchLimit int
}

func NewJanitor(repo domain.AttachmentRepository, storage filestorage.Storage, log *slog.Logger) *Janitor {
	return &Janitor{
		repo:       repo,
		storage:    storage,
		log:        log,
		Interval:   time.Hour,
		OrphanAge:  24 * time.Hour,
		BatchLimit: 500,
	}
}

// Sweep делает один проход и возвращает число удалённых вложений.
func (j *Janitor) Sweep(ctx context.Context, now time.Time) (int, error) {
	list, err := j.repo.ListSweepable(now, now.Add(-j.OrphanAge), j.BatchLimit)
	if err != nil {
		return 0, fmt.Errorf("list sweepable attachments: %w", err)
	}

	deleted := 0
	for _, a := range list {
		// Строку удаляем ПЕРВОЙ и только потом файл. Обратный порядок означал
		// бы, что между выборкой и удалением привязанный к сообщению черновик
		// уже лишился файла, а строка осталась — в ленте битая картинка.
		var (
			removed bool
			err     error
		)
		if a.MessageID == nil {
			// Сирота: за время прохода её могли привязать к сообщению, поэтому
			// удаление условное. Не удалилось — значит вложение живое, руками
			// его не трогаем, оно просто больше не сирота.
			removed, err = j.repo.DeleteIfUnattached(a.ID)
		} else {
			// Протухшее по сроку хранения: привязанность роли не играет, срок
			// истёк и для отправленного сообщения тоже.
			err = j.repo.Delete(a.ID)
			removed = err == nil
		}
		if err != nil {
			j.log.Error("delete attachment row failed", "attachment_id", a.ID, "error", err)
			continue
		}
		if !removed {
			j.log.Info("attachment attached while sweeping, kept", "attachment_id", a.ID)
			continue
		}

		// Строки уже нет, откатывать нечего: провал удаления файла остаётся
		// в логе, иначе уборщик спотыкался бы о него на каждом проходе.
		if err := j.storage.Delete(ctx, a.StorageKey); err != nil {
			j.log.Warn("delete attachment file failed", "attachment_id", a.ID, "key", a.StorageKey, "error", err)
		}
		if a.ThumbKey != "" {
			if err := j.storage.Delete(ctx, a.ThumbKey); err != nil {
				j.log.Warn("delete attachment thumbnail failed", "attachment_id", a.ID, "key", a.ThumbKey, "error", err)
			}
		}
		deleted++
	}

	if deleted > 0 {
		j.log.Info("attachments swept", "deleted", deleted)
	}
	return deleted, nil
}

// Run крутит Sweep по расписанию до отмены контекста.
func (j *Janitor) Run(ctx context.Context) {
	ticker := time.NewTicker(j.Interval)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if _, err := j.Sweep(ctx, time.Now()); err != nil {
				j.log.Error("attachment sweep failed", "error", err)
			}
		}
	}
}
