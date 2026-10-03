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

type readStateRepository struct {
	db *pgxpool.Pool
}

func NewReadStateRepository(db *pgxpool.Pool) domain.ReadStateRepository {
	return &readStateRepository{db: db}
}

// effectiveCursors — эффективный курсор пользователя $1 по каждому каналу его
// серверов: строка channel_read_states, а без неё — момент вступления в сервер.
// Вызывающий может дописать к WHERE своё условие через AND.
const effectiveCursors = `
	SELECT c.id AS channel_id, c.server_id,
	       COALESCE(rs.last_read_at, sm.joined_at) AS at,
	       rs.last_read_message_id AS mid
	FROM server_members sm
	JOIN channels c ON c.server_id = sm.server_id
	LEFT JOIN channel_read_states rs ON rs.user_id = sm.user_id AND rs.channel_id = c.id
	WHERE sm.user_id = $1`

// unreadCount — коррелированный подзапрос по строке cur из effectiveCursors.
// Порядок — пара (created_at, id). Курсор без message_id покрывает своё время
// целиком. Свои и call-строки не считаются, гостевые (user_id NULL) — считаются.
var unreadCount = fmt.Sprintf(`
	(SELECT count(*) FROM (
		SELECT 1 FROM messages m
		WHERE m.channel_id = cur.channel_id
		  AND m.kind = 'user'
		  AND m.user_id IS DISTINCT FROM $1
		  AND (m.created_at > cur.at
		       OR (m.created_at = cur.at AND cur.mid IS NOT NULL AND m.id > cur.mid))
		LIMIT %d) capped)`, domain.UnreadCountCap)

func (r *readStateRepository) ListUnread(userID uuid.UUID) ([]*domain.ChannelUnread, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `WITH cur AS (`+effectiveCursors+`)
		SELECT cur.server_id, cur.channel_id, cur.at, cur.mid, `+unreadCount+` FROM cur`, userID)
	if err != nil {
		return nil, fmt.Errorf("list unread: %w", err)
	}
	defer rows.Close()

	out := []*domain.ChannelUnread{}
	for rows.Next() {
		u := &domain.ChannelUnread{}
		if err := rows.Scan(&u.ServerID, &u.ChannelID, &u.At, &u.MessageID, &u.Count); err != nil {
			return nil, fmt.Errorf("scan unread: %w", err)
		}
		out = append(out, u)
	}
	return out, rows.Err()
}

func (r *readStateRepository) CountUnread(userID, channelID uuid.UUID) (int, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var n int
	err := r.db.QueryRow(ctx, `WITH cur AS (`+effectiveCursors+` AND c.id = $2)
		SELECT `+unreadCount+` FROM cur`, userID, channelID).Scan(&n)
	if errors.Is(err, pgx.ErrNoRows) {
		return 0, domain.ErrForbidden
	}
	if err != nil {
		return 0, fmt.Errorf("count unread: %w", err)
	}
	return n, nil
}

func (r *readStateRepository) Cursor(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	cur := &domain.ReadCursor{}
	err := r.db.QueryRow(ctx, `WITH cur AS (`+effectiveCursors+` AND c.id = $2)
		SELECT at, mid FROM cur`, userID, channelID).Scan(&cur.At, &cur.MessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrForbidden
	}
	if err != nil {
		return nil, fmt.Errorf("get read cursor: %w", err)
	}
	return cur, nil
}

// advanceSQL — upsert только вперёд. SELECT из server_members одновременно
// проверяет членство и не пускает курсор раньше joined_at: иначе первый же
// прочитанный кусок старой истории откатил бы эффективный курсор назад и
// счётчик вырос бы. Курсор сида (message_id NULL) сравнивается как нулевой
// uuid — сообщение ровно в то же время его обгонит, это безвредно.
const advanceSQL = `
	INSERT INTO channel_read_states (user_id, channel_id, last_read_at, last_read_message_id, updated_at)
	SELECT $1::uuid, $2::uuid, $3::timestamptz, $4::uuid, now()
	FROM server_members sm
	JOIN channels c ON c.server_id = sm.server_id
	WHERE sm.user_id = $1 AND c.id = $2 AND $3::timestamptz >= sm.joined_at
	ON CONFLICT (user_id, channel_id) DO UPDATE
	SET last_read_at = EXCLUDED.last_read_at,
	    last_read_message_id = EXCLUDED.last_read_message_id,
	    updated_at = now()
	WHERE (channel_read_states.last_read_at,
	       COALESCE(channel_read_states.last_read_message_id, '00000000-0000-0000-0000-000000000000'::uuid))
	    < (EXCLUDED.last_read_at, EXCLUDED.last_read_message_id)
	RETURNING 1`

func (r *readStateRepository) Advance(userID, channelID uuid.UUID, at time.Time, messageID uuid.UUID) (bool, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	var one int
	err := r.db.QueryRow(ctx, advanceSQL, userID, channelID, at, messageID).Scan(&one)
	if errors.Is(err, pgx.ErrNoRows) {
		return false, nil
	}
	if err != nil {
		return false, fmt.Errorf("advance read cursor: %w", err)
	}
	return true, nil
}

func (r *readStateRepository) OthersMax(userID, channelID uuid.UUID) (*domain.ReadCursor, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	// NULLS FIRST: курсор без message_id покрывает своё время целиком, значит
	// при равном времени он дальше любого с id.
	cur := &domain.ReadCursor{}
	err := r.db.QueryRow(ctx, `
		SELECT rs.last_read_at, rs.last_read_message_id
		FROM channel_read_states rs
		JOIN channels c ON c.id = rs.channel_id
		JOIN server_members sm ON sm.server_id = c.server_id AND sm.user_id = rs.user_id
		WHERE rs.channel_id = $1 AND rs.user_id <> $2
		ORDER BY rs.last_read_at DESC, rs.last_read_message_id DESC NULLS FIRST
		LIMIT 1`, channelID, userID).Scan(&cur.At, &cur.MessageID)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, nil
	}
	if err != nil {
		return nil, fmt.Errorf("others max read cursor: %w", err)
	}
	return cur, nil
}

func (r *readStateRepository) Readers(serverID, channelID uuid.UUID, at time.Time, messageID, authorID uuid.UUID) ([]*domain.Reader, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `
		SELECT u.id, u.username, u.avatar_url,
		       COALESCE(rs.last_read_at > $3
		             OR (rs.last_read_at = $3
		                 AND (rs.last_read_message_id IS NULL OR rs.last_read_message_id >= $4)), false)
		FROM server_members sm
		JOIN users u ON u.id = sm.user_id
		LEFT JOIN channel_read_states rs ON rs.user_id = sm.user_id AND rs.channel_id = $2
		WHERE sm.server_id = $1 AND sm.user_id <> $5
		ORDER BY lower(u.username)`, serverID, channelID, at, messageID, authorID)
	if err != nil {
		return nil, fmt.Errorf("list readers: %w", err)
	}
	defer rows.Close()

	out := []*domain.Reader{}
	for rows.Next() {
		rd := &domain.Reader{}
		if err := rows.Scan(&rd.UserID, &rd.Username, &rd.AvatarURL, &rd.HasRead); err != nil {
			return nil, fmt.Errorf("scan reader: %w", err)
		}
		out = append(out, rd)
	}
	return out, rows.Err()
}

func (r *readStateRepository) ServerMemberIDs(serverID uuid.UUID) ([]uuid.UUID, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	rows, err := r.db.Query(ctx, `SELECT user_id FROM server_members WHERE server_id = $1`, serverID)
	if err != nil {
		return nil, fmt.Errorf("list server member ids: %w", err)
	}
	defer rows.Close()

	var ids []uuid.UUID
	for rows.Next() {
		var id uuid.UUID
		if err := rows.Scan(&id); err != nil {
			return nil, fmt.Errorf("scan member id: %w", err)
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}
