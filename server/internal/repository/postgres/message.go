package postgres

import (
	"context"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/vycord/server/internal/domain"
)

type messageRepository struct {
	db *pgxpool.Pool
}

func NewMessageRepository(db *pgxpool.Pool) domain.MessageRepository {
	return &messageRepository{db: db}
}

func (r *messageRepository) Create(msg *domain.Message) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO messages (id, channel_id, user_id, content, attachments, sticker_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		msg.ID,
		msg.ChannelID,
		msg.UserID,
		msg.Content,
		msg.Attachments,
		msg.StickerID,
		msg.CreatedAt,
		msg.UpdatedAt,
	).Scan(&msg.ID)

	if err != nil {
		return fmt.Errorf("failed to create message: %w", err)
	}

	return nil
}

func (r *messageRepository) GetByID(id uuid.UUID) (*domain.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.sticker_id,
		       m.created_at, m.updated_at,
		       s.id, s.name, s.image_url, s.server_id
		FROM messages m
		LEFT JOIN stickers s ON s.id = m.sticker_id
		WHERE m.id = $1
	`

	msg := &domain.Message{}
	var msgStickerID *uuid.UUID
	var sID *uuid.UUID
	var sName *string
	var sURL *string
	var sServerID *uuid.UUID
	err := r.db.QueryRow(ctx, query, id).Scan(
		&msg.ID,
		&msg.ChannelID,
		&msg.UserID,
		&msg.Content,
		&msg.Attachments,
		&msgStickerID,
		&msg.CreatedAt,
		&msg.UpdatedAt,
		&sID,
		&sName,
		&sURL,
		&sServerID,
	)
	if err != nil {
		return nil, err
	}
	if msgStickerID != nil {
		msg.StickerID = msgStickerID
		msg.Sticker = &domain.Sticker{
			ID:       *sID,
			Name:     *sName,
			ImageURL: *sURL,
			ServerID: *sServerID,
		}
	}

	if errors.Is(err, pgx.ErrNoRows) {
		return nil, fmt.Errorf("message %s: %w", id, domain.ErrMessageNotFound)
	}
	if err != nil {
		return nil, fmt.Errorf("failed to get message: %w", err)
	}

	return msg, nil
}

func (r *messageRepository) GetByChannelID(channelID uuid.UUID, limit, offset int) ([]*domain.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.sticker_id,
		       m.created_at, m.updated_at,
		       s.id, s.name, s.image_url, s.server_id
		FROM messages m
		LEFT JOIN stickers s ON s.id = m.sticker_id
		WHERE m.channel_id = $1
		ORDER BY m.created_at DESC
		LIMIT $2 OFFSET $3
	`

	rows, err := r.db.Query(ctx, query, channelID, limit, offset)
	if err != nil {
		return nil, fmt.Errorf("failed to query messages: %w", err)
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		msg := &domain.Message{}
		var msgStickerID *uuid.UUID
		var sID *uuid.UUID
		var sName *string
		var sURL *string
		var sServerID *uuid.UUID
		if err := rows.Scan(
			&msg.ID,
			&msg.ChannelID,
			&msg.UserID,
			&msg.Content,
			&msg.Attachments,
			&msgStickerID,
			&msg.CreatedAt,
			&msg.UpdatedAt,
			&sID,
			&sName,
			&sURL,
			&sServerID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		if msgStickerID != nil {
			msg.StickerID = msgStickerID
			msg.Sticker = &domain.Sticker{
				ID:       *sID,
				Name:     *sName,
				ImageURL: *sURL,
				ServerID: *sServerID,
			}
		}
		messages = append(messages, msg)
	}

	// Reverse to get ascending order
	for i, j := 0, len(messages)-1; i < j; i, j = i+1, j-1 {
		messages[i], messages[j] = messages[j], messages[i]
	}

	return messages, nil
}

var allowedMessageColumns = map[string]string{
	"content": "content",
}

func (r *messageRepository) Update(id uuid.UUID, updates map[string]interface{}) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	setClauses := []string{}
	args := []interface{}{}
	argIdx := 1

	for key, value := range updates {
		colName, ok := allowedMessageColumns[key]
		if !ok {
			continue
		}
		setClauses = append(setClauses, fmt.Sprintf("%s = $%d", colName, argIdx))
		args = append(args, value)
		argIdx++
	}

	if len(setClauses) == 0 {
		return fmt.Errorf("no valid columns to update")
	}

	setClauses = append(setClauses, fmt.Sprintf("updated_at = $%d", argIdx))
	args = append(args, time.Now())

	query := fmt.Sprintf(
		"UPDATE messages SET %s WHERE id = $%d",
		strings.Join(setClauses, ", "),
		argIdx+1,
	)
	args = append(args, id)

	_, err := r.db.Exec(ctx, query, args...)
	if err != nil {
		return fmt.Errorf("failed to update message: %w", err)
	}

	return nil
}

// escapeLike экранирует спецсимволы LIKE-шаблона, чтобы пользовательский
// запрос искался как буквальная подстрока.
func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, `%`, `\%`, `_`, `\_`).Replace(s)
}

func (r *messageRepository) Search(channelID uuid.UUID, query string, limit, offset int) ([]*domain.MessageWithAuthor, int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	pattern := "%" + escapeLike(query) + "%"

	var total int
	countQuery := `SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND content ILIKE $2 ESCAPE '\'`
	if err := r.db.QueryRow(ctx, countQuery, channelID, pattern).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count search results: %w", err)
	}

	searchQuery := `
		SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.created_at, m.updated_at, u.username
		FROM messages m
		JOIN users u ON u.id = m.user_id
		WHERE m.channel_id = $1 AND m.content ILIKE $2 ESCAPE '\'
		ORDER BY m.created_at DESC
		LIMIT $3 OFFSET $4
	`
	rows, err := r.db.Query(ctx, searchQuery, channelID, pattern, limit, offset)
	if err != nil {
		return nil, 0, fmt.Errorf("failed to search messages: %w", err)
	}
	defer rows.Close()

	var results []*domain.MessageWithAuthor
	for rows.Next() {
		res := &domain.MessageWithAuthor{}
		if err := rows.Scan(
			&res.ID,
			&res.ChannelID,
			&res.UserID,
			&res.Content,
			&res.Attachments,
			&res.CreatedAt,
			&res.UpdatedAt,
			&res.Username,
		); err != nil {
			return nil, 0, fmt.Errorf("failed to scan search result: %w", err)
		}
		results = append(results, res)
	}

	return results, total, nil
}

func (r *messageRepository) GetAround(channelID, messageID uuid.UUID, limit int) ([]*domain.Message, error) {
	target, err := r.GetByID(messageID)
	if err != nil {
		return nil, err
	}
	if target.ChannelID != channelID {
		return nil, fmt.Errorf("message %s: %w", messageID, domain.ErrMessageNotFound)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// Контекст вокруг цели: limit сообщений до (включая цель) + limit после.
	// Тай-брейк по id, т.к. created_at не уникален.
	query := `
		(
			SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.sticker_id,
			       m.created_at, m.updated_at,
			       s.id, s.name, s.image_url, s.server_id
			FROM messages m
			LEFT JOIN stickers s ON s.id = m.sticker_id
			WHERE m.channel_id = $1 AND (m.created_at, m.id) <= ($2, $3)
			ORDER BY m.created_at DESC, m.id DESC
			LIMIT $4
		)
		UNION ALL
		(
			SELECT m.id, m.channel_id, m.user_id, m.content, m.attachments, m.sticker_id,
			       m.created_at, m.updated_at,
			       s.id, s.name, s.image_url, s.server_id
			FROM messages m
			LEFT JOIN stickers s ON s.id = m.sticker_id
			WHERE m.channel_id = $1 AND (m.created_at, m.id) > ($2, $3)
			ORDER BY m.created_at ASC, m.id ASC
			LIMIT $4
		)
	`
	rows, err := r.db.Query(ctx, query, channelID, target.CreatedAt, target.ID, limit)
	if err != nil {
		return nil, fmt.Errorf("failed to get messages around: %w", err)
	}
	defer rows.Close()

	var messages []*domain.Message
	for rows.Next() {
		msg := &domain.Message{}
		var msgStickerID *uuid.UUID
		var sID *uuid.UUID
		var sName *string
		var sURL *string
		var sServerID *uuid.UUID
		if err := rows.Scan(
			&msg.ID,
			&msg.ChannelID,
			&msg.UserID,
			&msg.Content,
			&msg.Attachments,
			&msgStickerID,
			&msg.CreatedAt,
			&msg.UpdatedAt,
			&sID,
			&sName,
			&sURL,
			&sServerID,
		); err != nil {
			return nil, fmt.Errorf("failed to scan message: %w", err)
		}
		if msgStickerID != nil {
			msg.StickerID = msgStickerID
			msg.Sticker = &domain.Sticker{
				ID:       *sID,
				Name:     *sName,
				ImageURL: *sURL,
				ServerID: *sServerID,
			}
		}
		messages = append(messages, msg)
	}

	sort.Slice(messages, func(i, j int) bool {
		if !messages[i].CreatedAt.Equal(messages[j].CreatedAt) {
			return messages[i].CreatedAt.Before(messages[j].CreatedAt)
		}
		return messages[i].ID.String() < messages[j].ID.String()
	})

	return messages, nil
}

func (r *messageRepository) Delete(id uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := "DELETE FROM messages WHERE id = $1"
	_, err := r.db.Exec(ctx, query, id)
	if err != nil {
		return fmt.Errorf("failed to delete message: %w", err)
	}

	return nil
}
