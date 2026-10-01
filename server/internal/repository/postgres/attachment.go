package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type attachmentRepository struct {
	db *pgxpool.Pool
}

func NewAttachmentRepository(db *pgxpool.Pool) domain.AttachmentRepository {
	return &attachmentRepository{db: db}
}

const attachmentColumns = `id, user_id, channel_id, message_id, kind, file_name,
	content_type, size_bytes, storage_key, thumb_key, width, height, expires_at, created_at,
	is_voice, duration_ms, waveform`

func scanAttachment(row pgx.Row) (*domain.Attachment, error) {
	a := &domain.Attachment{}
	var thumbKey *string
	err := row.Scan(&a.ID, &a.UserID, &a.ChannelID, &a.MessageID, &a.Kind, &a.FileName,
		&a.ContentType, &a.SizeBytes, &a.StorageKey, &thumbKey, &a.Width, &a.Height,
		&a.ExpiresAt, &a.CreatedAt, &a.IsVoice, &a.DurationMs, &a.Waveform)
	if err != nil {
		return nil, err
	}
	if thumbKey != nil {
		a.ThumbKey = *thumbKey
	}
	return a, nil
}

func (r *attachmentRepository) Create(a *domain.Attachment) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// thumb_key пустой строкой не пишем: колонка nullable, и NULL честнее
	// отражает «миниатюры нет».
	var thumbKey *string
	if a.ThumbKey != "" {
		thumbKey = &a.ThumbKey
	}

	query := `
		INSERT INTO attachments (id, user_id, channel_id, message_id, kind, file_name,
			content_type, size_bytes, storage_key, thumb_key, width, height, expires_at, created_at,
			is_voice, duration_ms, waveform)
		VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
	`
	_, err := r.db.Exec(ctx, query, a.ID, a.UserID, a.ChannelID, a.MessageID, a.Kind,
		a.FileName, a.ContentType, a.SizeBytes, a.StorageKey, thumbKey, a.Width, a.Height,
		a.ExpiresAt, a.CreatedAt, a.IsVoice, a.DurationMs, a.Waveform)
	if err != nil {
		return fmt.Errorf("failed to create attachment: %w", err)
	}
	return nil
}

func (r *attachmentRepository) GetByID(id uuid.UUID) (*domain.Attachment, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT ` + attachmentColumns + ` FROM attachments WHERE id = $1`
	a, err := scanAttachment(r.db.QueryRow(ctx, query, id))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("attachment %s: %w", id, domain.ErrAttachmentNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get attachment: %w", err)
	}
	return a, nil
}

// ListByMessageIDs подтягивает вложения для пачки сообщений одним запросом:
// иначе список из 50 сообщений давал бы 50 походов в БД.
func (r *attachmentRepository) ListByMessageIDs(messageIDs []uuid.UUID) (map[uuid.UUID][]*domain.Attachment, error) {
	out := make(map[uuid.UUID][]*domain.Attachment)
	if len(messageIDs) == 0 {
		return out, nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `SELECT ` + attachmentColumns + `
		FROM attachments
		WHERE message_id = ANY($1)
		ORDER BY created_at ASC`
	rows, err := r.db.Query(ctx, query, messageIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to list attachments: %w", err)
	}
	defer rows.Close()

	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		if a.MessageID != nil {
			out[*a.MessageID] = append(out[*a.MessageID], a)
		}
	}
	return out, rows.Err()
}

// AttachToMessage привязывает вложения к сообщению одной транзакцией.
//
// UPDATE намеренно содержит все условия принадлежности: чужое вложение,
// вложение из другого канала и уже привязанное просто не попадут под WHERE.
// Если обновилось не столько строк, сколько запрошено — откатываем всё
// и разбираемся, что именно не так, отдельным запросом.
func (r *attachmentRepository) AttachToMessage(messageID, userID, channelID uuid.UUID, ids []uuid.UUID) error {
	if len(ids) == 0 {
		return nil
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin attach tx: %w", err)
	}
	defer tx.Rollback(ctx)

	tag, err := tx.Exec(ctx, `
		UPDATE attachments
		SET message_id = $1
		WHERE id = ANY($2) AND user_id = $3 AND channel_id = $4 AND message_id IS NULL
	`, messageID, ids, userID, channelID)
	if err != nil {
		return fmt.Errorf("attach attachments: %w", err)
	}

	if int(tag.RowsAffected()) != len(ids) {
		var attached int
		if err := tx.QueryRow(ctx, `
			SELECT COUNT(*) FROM attachments WHERE id = ANY($1) AND message_id IS NOT NULL
		`, ids).Scan(&attached); err == nil && attached > 0 {
			return domain.ErrAttachmentAlreadyAttached
		}
		return domain.ErrAttachmentNotFound
	}

	if err := tx.Commit(ctx); err != nil {
		return fmt.Errorf("commit attach tx: %w", err)
	}
	return nil
}

func (r *attachmentRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `DELETE FROM attachments WHERE id = $1`, id)
	if err != nil {
		return fmt.Errorf("failed to delete attachment: %w", err)
	}
	return nil
}

// DeleteIfUnattached удаляет строку только пока она не привязана к сообщению.
// Условие в самом DELETE, а не проверкой перед ним: между SELECT и DELETE
// вложение успело бы уехать в сообщение, и уборщик выпилил бы живой файл.
func (r *attachmentRepository) DeleteIfUnattached(id uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx, `DELETE FROM attachments WHERE id = $1 AND message_id IS NULL`, id)
	if err != nil {
		return false, fmt.Errorf("failed to delete unattached attachment: %w", err)
	}
	return tag.RowsAffected() > 0, nil
}

// ListSweepable отдаёт то, что пора удалить: сирот (загружены, но сообщение
// так и не отправили) старше orphanBefore и всё, чей срок хранения истёк.
func (r *attachmentRepository) ListSweepable(now, orphanBefore time.Time, limit int) ([]*domain.Attachment, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()

	query := `SELECT ` + attachmentColumns + `
		FROM attachments
		WHERE (message_id IS NULL AND created_at < $1)
		   OR (expires_at IS NOT NULL AND expires_at < $2)
		ORDER BY created_at ASC
		LIMIT $3`
	rows, err := r.db.Query(ctx, query, orphanBefore, now, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to list sweepable attachments: %w", err)
	}
	defer rows.Close()

	var out []*domain.Attachment
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

// TotalBytesByUser — суммарный занятый объём. Сегодня не вызывается: у плана
// free max_total_bytes = NULL. Появится вместе с платными планами.
func (r *attachmentRepository) TotalBytesByUser(userID uuid.UUID) (int64, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var total int64
	err := r.db.QueryRow(ctx, `
		SELECT COALESCE(SUM(size_bytes), 0) FROM attachments WHERE user_id = $1
	`, userID).Scan(&total)
	if err != nil {
		return 0, fmt.Errorf("failed to sum attachment sizes: %w", err)
	}
	return total, nil
}

func (r *attachmentRepository) ListByIDs(ids []uuid.UUID) ([]*domain.Attachment, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT `+attachmentColumns+` FROM attachments WHERE id = ANY($1)`, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to list attachments by id: %w", err)
	}
	defer rows.Close()

	var out []*domain.Attachment
	for rows.Next() {
		a, err := scanAttachment(rows)
		if err != nil {
			return nil, fmt.Errorf("failed to scan attachment: %w", err)
		}
		out = append(out, a)
	}
	return out, rows.Err()
}

func (r *attachmentRepository) MarkListened(attachmentID, userID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	tag, err := r.db.Exec(ctx, `
		INSERT INTO voice_listens (attachment_id, user_id) VALUES ($1, $2)
		ON CONFLICT (attachment_id, user_id) DO NOTHING`, attachmentID, userID)
	if err != nil {
		return false, fmt.Errorf("failed to mark voice listened: %w", err)
	}
	return tag.RowsAffected() == 1, nil
}

// ListenedFor — одним запросом на пачку. Прослушивания автора не пишутся,
// поэтому для автора условие a.user_id = viewer означает «слушал кто-то другой».
func (r *attachmentRepository) ListenedFor(viewerID uuid.UUID, attachmentIDs []uuid.UUID) (map[uuid.UUID]bool, error) {
	out := make(map[uuid.UUID]bool, len(attachmentIDs))
	if len(attachmentIDs) == 0 {
		return out, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT a.id FROM attachments a
		WHERE a.id = ANY($2) AND a.is_voice
		  AND EXISTS (SELECT 1 FROM voice_listens l
		              WHERE l.attachment_id = a.id
		                AND (a.user_id = $1 OR l.user_id = $1))`, viewerID, attachmentIDs)
	if err != nil {
		return nil, fmt.Errorf("failed to query voice listens: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("failed to scan voice listen: %w", err)
		}
		out[id] = true
	}
	return out, rows.Err()
}
