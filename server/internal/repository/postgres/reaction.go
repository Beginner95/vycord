package postgres

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type reactionRepository struct {
	db *pgxpool.Pool
}

func NewReactionRepository(db *pgxpool.Pool) domain.ReactionRepository {
	return &reactionRepository{db: db}
}

// queryer — общее у пула и транзакции: снимок читается и вне, и внутри tx.
type queryer interface {
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
}

// Группировка по s.id позволяет выбрать остальные колонки стикера (PK
// функционально их определяет). Порядок видов — по первой реакции.
const reactionSnapshotSQL = `
	SELECT r.message_id, r.emoji, r.sticker_id,
	       s.server_id, s.name, s.image_url, s.created_by, s.created_at,
	       COUNT(*)::int, array_agg(r.user_id ORDER BY r.created_at, r.user_id)
	FROM message_reactions r
	LEFT JOIN stickers s ON s.id = r.sticker_id
	WHERE r.message_id = ANY($1)
	GROUP BY r.message_id, r.emoji, r.sticker_id, s.id
	ORDER BY r.message_id, MIN(r.created_at), r.emoji NULLS LAST, r.sticker_id`

func listReactions(ctx context.Context, q queryer, ids []uuid.UUID) (map[uuid.UUID][]domain.Reaction, error) {
	out := make(map[uuid.UUID][]domain.Reaction)
	if len(ids) == 0 {
		return out, nil
	}
	rows, err := q.Query(ctx, reactionSnapshotSQL, ids)
	if err != nil {
		return nil, fmt.Errorf("failed to list reactions: %w", err)
	}
	defer rows.Close()
	for rows.Next() {
		var (
			messageID  uuid.UUID
			emoji      *string
			stickerID  *uuid.UUID
			sServerID  *uuid.UUID
			sName      *string
			sImageURL  *string
			sCreatedBy *uuid.UUID
			sCreatedAt *time.Time
			r          domain.Reaction
		)
		if err := rows.Scan(&messageID, &emoji, &stickerID, &sServerID, &sName, &sImageURL, &sCreatedBy, &sCreatedAt, &r.Count, &r.UserIDs); err != nil {
			return nil, fmt.Errorf("failed to scan reaction: %w", err)
		}
		if stickerID != nil {
			r.Key = domain.ReactionKey{StickerID: stickerID}.String()
			if sServerID != nil {
				r.Sticker = &domain.Sticker{ID: *stickerID, ServerID: *sServerID, Name: *sName, ImageURL: *sImageURL, CreatedBy: *sCreatedBy, CreatedAt: *sCreatedAt}
			}
		} else if emoji != nil {
			r.Key, r.Emoji = *emoji, *emoji
		}
		out[messageID] = append(out[messageID], r)
	}
	return out, rows.Err()
}

func (r *reactionRepository) ListByMessageIDs(ids []uuid.UUID) (map[uuid.UUID][]domain.Reaction, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return listReactions(ctx, r.db, ids)
}

// emojiArg — emoji-колонка ключа: NULL для стикера.
func emojiArg(k domain.ReactionKey) *string {
	if k.StickerID != nil {
		return nil
	}
	return &k.Emoji
}

// withMessageLock выполняет fn в транзакции, удерживающей строку сообщения.
// Блокировка сериализует изменения реакций одного сообщения: без неё две
// транзакции увидели бы по 19 видов и обе вставили бы двадцатый, а снимки
// могли бы прийти клиентам не в порядке коммитов.
func (r *reactionRepository) withMessageLock(messageID uuid.UUID, fn func(ctx context.Context, tx pgx.Tx) error) ([]domain.Reaction, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin reaction tx: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	var locked uuid.UUID
	if err := tx.QueryRow(ctx, `SELECT id FROM messages WHERE id = $1 FOR NO KEY UPDATE`, messageID).Scan(&locked); err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
		}
		return nil, fmt.Errorf("lock message: %w", err)
	}
	if err := fn(ctx, tx); err != nil {
		return nil, err
	}
	snap, err := listReactions(ctx, tx, []uuid.UUID{messageID})
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit reaction tx: %w", err)
	}
	if s := snap[messageID]; s != nil {
		return s, nil
	}
	return []domain.Reaction{}, nil
}

func (r *reactionRepository) Add(messageID, userID uuid.UUID, key domain.ReactionKey, maxDistinct int) ([]domain.Reaction, error) {
	return r.withMessageLock(messageID, func(ctx context.Context, tx pgx.Tx) error {
		// Эмодзи-ключ не содержит ASCII, поэтому COALESCE(emoji, sticker_id::text)
		// не склеит эмодзи со стикером.
		var kinds int
		var exists bool
		err := tx.QueryRow(ctx, `
			SELECT COUNT(DISTINCT COALESCE(emoji, sticker_id::text)),
			       COALESCE(bool_or(emoji IS NOT DISTINCT FROM $2::text AND sticker_id IS NOT DISTINCT FROM $3::uuid), false)
			FROM message_reactions WHERE message_id = $1`,
			messageID, emojiArg(key), key.StickerID).Scan(&kinds, &exists)
		if err != nil {
			return fmt.Errorf("count reactions: %w", err)
		}
		if !exists && kinds >= maxDistinct {
			return domain.ErrReactionLimitReached
		}
		_, err = tx.Exec(ctx, `
			INSERT INTO message_reactions (message_id, user_id, emoji, sticker_id)
			VALUES ($1, $2, $3, $4)
			ON CONFLICT DO NOTHING`,
			messageID, userID, emojiArg(key), key.StickerID)
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "23503" && key.StickerID != nil {
			// Стикер удалили между проверкой в usecase и вставкой.
			return fmt.Errorf("sticker %s: %w", key.StickerID, domain.ErrStickerNotFound)
		}
		if err != nil {
			return fmt.Errorf("insert reaction: %w", err)
		}
		return nil
	})
}

func (r *reactionRepository) Remove(messageID, userID uuid.UUID, key domain.ReactionKey) ([]domain.Reaction, error) {
	return r.withMessageLock(messageID, func(ctx context.Context, tx pgx.Tx) error {
		_, err := tx.Exec(ctx, `
			DELETE FROM message_reactions
			WHERE message_id = $1 AND user_id = $2
			  AND emoji IS NOT DISTINCT FROM $3::text AND sticker_id IS NOT DISTINCT FROM $4::uuid`,
			messageID, userID, emojiArg(key), key.StickerID)
		if err != nil {
			return fmt.Errorf("delete reaction: %w", err)
		}
		return nil
	})
}
