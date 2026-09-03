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
	"github.com/jackc/pgx/v5/pgconn"
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
		INSERT INTO messages (id, channel_id, user_id, content, sticker_id, created_at, updated_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)
		RETURNING id
	`

	err := r.db.QueryRow(
		ctx,
		query,
		msg.ID,
		msg.ChannelID,
		msg.UserID,
		msg.Content,
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
		SELECT m.id, m.channel_id, m.user_id, m.content, m.sticker_id,
		       m.kind, m.call_started_at, m.call_ended_at, m.call_participant_ids,
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
		&msgStickerID,
		&msg.Kind,
		&msg.CallStartedAt,
		&msg.CallEndedAt,
		&msg.CallParticipantIDs,
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
		SELECT m.id, m.channel_id, m.user_id, m.content, m.sticker_id,
		       m.kind, m.call_started_at, m.call_ended_at, m.call_participant_ids,
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
			&msgStickerID,
			&msg.Kind,
			&msg.CallStartedAt,
			&msg.CallEndedAt,
			&msg.CallParticipantIDs,
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

// isUniqueCallViolation reports whether err is a violation of
// idx_messages_active_call (021_call_messages) — the only unique constraint
// CreateCall's INSERT can hit.
func isUniqueCallViolation(err error) bool {
	var pgErr *pgconn.PgError
	return errors.As(err, &pgErr) && pgErr.Code == "23505"
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
	countQuery := `SELECT COUNT(*) FROM messages WHERE channel_id = $1 AND content ILIKE $2 ESCAPE '\' AND kind = 'user'`
	if err := r.db.QueryRow(ctx, countQuery, channelID, pattern).Scan(&total); err != nil {
		return nil, 0, fmt.Errorf("failed to count search results: %w", err)
	}

	searchQuery := `
		SELECT m.id, m.channel_id, m.user_id, m.content, m.kind, m.created_at, m.updated_at, u.username
		FROM messages m
		JOIN users u ON u.id = m.user_id
		WHERE m.channel_id = $1 AND m.content ILIKE $2 ESCAPE '\' AND m.kind = 'user'
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
			&res.Kind,
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
			SELECT m.id, m.channel_id, m.user_id, m.content, m.sticker_id,
			       m.kind, m.call_started_at, m.call_ended_at, m.call_participant_ids,
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
			SELECT m.id, m.channel_id, m.user_id, m.content, m.sticker_id,
			       m.kind, m.call_started_at, m.call_ended_at, m.call_participant_ids,
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
			&msgStickerID,
			&msg.Kind,
			&msg.CallStartedAt,
			&msg.CallEndedAt,
			&msg.CallParticipantIDs,
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

// CreateCall inserts a kind='call' row using msg's ID/ChannelID/UserID/
// CallStartedAt/CreatedAt/UpdatedAt (caller sets all of these — see
// usecase.callSessionRecorder.CallStarted). ok is false, err is nil when
// idx_messages_active_call is already held by another open call in the
// channel — the caller's job is to no-op silently, not treat it as a
// failure (spec «Идемпотентность вместо синхронизации»).
func (r *messageRepository) CreateCall(msg *domain.Message) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		INSERT INTO messages (id, channel_id, user_id, content, kind, call_started_at, call_last_seen_at, call_participant_ids, created_at, updated_at)
		VALUES ($1, $2, $3, '', 'call', $4, $4, ARRAY[$3::uuid], $4, $4)
	`
	_, err := r.db.Exec(ctx, query, msg.ID, msg.ChannelID, msg.UserID, msg.CallStartedAt)
	if err != nil {
		if isUniqueCallViolation(err) {
			return false, nil
		}
		return false, fmt.Errorf("failed to create call message: %w", err)
	}
	return true, nil
}

// AddCallParticipant adds userID to channelID's open call, if any.
// Idempotent: 0 rows affected (nil error) when the channel has no open call
// — it may have closed between the hub reading its state and this call
// landing — or when userID is already in call_participant_ids. One atomic
// UPDATE, safe under concurrent joins to the same row (Postgres serializes
// via the row lock; a second call with the same userID simply finds the
// WHERE clause false the moment the first one commits).
//
// updated_at is deliberately not touched — same reasoning as EndCall not
// touching it (VYC-87 spec): the client's "edited" indicator is
// updated_at !== created_at, and a call message is written to many times
// over its life without ever being user-edited.
func (r *messageRepository) AddCallParticipant(channelID, userID uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		UPDATE messages
		SET call_participant_ids = array_append(call_participant_ids, $2)
		WHERE channel_id = $1 AND kind = 'call' AND call_ended_at IS NULL
		  AND NOT ($2 = ANY(call_participant_ids))
	`, channelID, userID)
	if err != nil {
		return fmt.Errorf("failed to add call participant: %w", err)
	}
	return nil
}

// EndCall closes channelID's open call (call_ended_at = now()) and returns
// it. ok is false when there was nothing open to close (a concurrent close
// already happened) — again a silent no-op for the caller, not an error.
func (r *messageRepository) EndCall(channelID uuid.UUID) (*domain.Message, bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	query := `
		UPDATE messages
		SET call_ended_at = now()
		WHERE channel_id = $1 AND kind = 'call' AND call_ended_at IS NULL
		RETURNING id, channel_id, user_id, content, kind, call_started_at, call_ended_at, call_participant_ids, created_at, updated_at
	`
	msg := &domain.Message{}
	err := r.db.QueryRow(ctx, query, channelID).Scan(
		&msg.ID, &msg.ChannelID, &msg.UserID, &msg.Content, &msg.Kind,
		&msg.CallStartedAt, &msg.CallEndedAt, &msg.CallParticipantIDs, &msg.CreatedAt, &msg.UpdatedAt,
	)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, false, nil
	}
	if err != nil {
		return nil, false, fmt.Errorf("failed to end call: %w", err)
	}
	return msg, true, nil
}

// TouchCalls marks call_last_seen_at = now() for every open call whose
// channel is in channelIDs — the presence worker's "the SFU still confirms
// this one is live" per-tick signal. A nil-but-actually-empty channelIDs is
// harmless here (ANY(NULL) matches nothing, same effective result as
// ANY('{}')), unlike CloseCallsMissingFrom below.
func (r *messageRepository) TouchCalls(channelIDs []uuid.UUID) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		UPDATE messages SET call_last_seen_at = now()
		WHERE kind = 'call' AND call_ended_at IS NULL AND channel_id = ANY($1)
	`, channelIDs)
	if err != nil {
		return fmt.Errorf("failed to touch active calls: %w", err)
	}
	return nil
}

// CloseCallsMissingFrom closes every open call whose channel is absent from
// channelIDs (the SFU-confirmed live set) and started more than minAge ago —
// the age guard exists because the client's voice_joined API call and its
// SFU connection land almost simultaneously, and a tick landing in that gap
// must not close a call of duration zero.
//
// channelIDs MUST be a non-nil slice, even when there are zero active
// channels (build it with make([]uuid.UUID, 0, n), never `var channelIDs
// []uuid.UUID`): pgx encodes a nil Go slice as SQL NULL, and
// `channel_id <> ALL(NULL)` evaluates to NULL — matching NO rows — for
// every row, which would silently disable the exact case ("SFU confirms
// nothing is running anywhere") this query exists to handle. A non-nil
// empty slice correctly encodes as `{}`, against which `<> ALL('{}')` is
// true for every row, as intended.
func (r *messageRepository) CloseCallsMissingFrom(channelIDs []uuid.UUID, minAge time.Duration) ([]*domain.Message, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		UPDATE messages
		SET call_ended_at = COALESCE(call_last_seen_at, call_started_at)
		WHERE kind = 'call' AND call_ended_at IS NULL
		  AND channel_id <> ALL($1)
		  AND call_started_at < now() - make_interval(secs => $2)
		RETURNING id, channel_id, user_id, content, kind, call_started_at, call_ended_at, call_participant_ids, created_at, updated_at
	`, channelIDs, minAge.Seconds())
	if err != nil {
		return nil, fmt.Errorf("failed to close missing calls: %w", err)
	}
	defer rows.Close()

	var closed []*domain.Message
	for rows.Next() {
		msg := &domain.Message{}
		if err := rows.Scan(
			&msg.ID, &msg.ChannelID, &msg.UserID, &msg.Content, &msg.Kind,
			&msg.CallStartedAt, &msg.CallEndedAt, &msg.CallParticipantIDs, &msg.CreatedAt, &msg.UpdatedAt,
		); err != nil {
			return nil, fmt.Errorf("failed to scan closed call: %w", err)
		}
		closed = append(closed, msg)
	}
	return closed, nil
}

// CloseOrphanedCalls closes every still-open call unconditionally. Run once
// at API startup (main.go), before the hub accepts connections — see
// domain.MessageRepository's doc comment for why.
func (r *messageRepository) CloseOrphanedCalls() error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	_, err := r.db.Exec(ctx, `
		UPDATE messages
		SET call_ended_at = COALESCE(call_last_seen_at, call_started_at)
		WHERE kind = 'call' AND call_ended_at IS NULL
	`)
	if err != nil {
		return fmt.Errorf("failed to close orphaned calls: %w", err)
	}
	return nil
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
