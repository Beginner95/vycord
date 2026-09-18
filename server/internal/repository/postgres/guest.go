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

// guestRepository хранит гостевые ссылки и гостей звонков
// (docs/superpowers/specs/2026-09-17-guest-call-link-design.md). Каждый
// переход состояния — одна транзакция; всё, что зависит от числа гостей
// звонка, сериализуется lockCall.
type guestRepository struct {
	db *pgxpool.Pool
}

func newGuestRepository(db *pgxpool.Pool) *guestRepository {
	return &guestRepository{db: db}
}

func guestCtx() (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), 5*time.Second)
}

// lockCall берёт транзакционную advisory-блокировку на звонок. Блокировка
// строки ссылки не спасла бы лимит «10 гостей на звонок»: два входа по двум
// разным ссылкам одного звонка держали бы разные строки.
func lockCall(ctx context.Context, tx pgx.Tx, callMessageID uuid.UUID) error {
	_, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, callMessageID.String())
	return err
}

const guestLinkColumns = `l.id, l.channel_id, l.call_message_id, l.created_by, l.created_at, l.expires_at,
	l.uses, l.closed_at, l.revoked_at, l.revoked_by, l.revoke_reason`

func guestLinkDest(l *domain.GuestLink) []any {
	return []any{
		&l.ID, &l.ChannelID, &l.CallMessageID, &l.CreatedBy, &l.CreatedAt, &l.ExpiresAt,
		&l.Uses, &l.ClosedAt, &l.RevokedAt, &l.RevokedBy, &l.RevokeReason,
	}
}

const guestLinkTargetSelect = `
	SELECT ` + guestLinkColumns + `,
	       c.server_id, s.name, s.icon_url, s.guest_links_enabled, c.name, m.call_ended_at
	FROM call_guest_links l
	JOIN channels c ON c.id = l.channel_id
	JOIN servers s ON s.id = c.server_id
	JOIN messages m ON m.id = l.call_message_id`

func scanGuestLinkTarget(row pgx.Row) (*domain.GuestLinkTarget, error) {
	t := &domain.GuestLinkTarget{}
	dest := append(guestLinkDest(&t.Link),
		&t.ServerID, &t.ServerName, &t.ServerIconURL, &t.GuestLinksEnabled, &t.ChannelName, &t.CallEndedAt)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	return t, nil
}

const callGuestColumns = `g.id, g.link_id, g.channel_id, g.call_message_id, g.display_name,
	g.status, g.banned, g.created_at, g.admitted_at, g.ended_at`

func callGuestDest(g *domain.CallGuest, status *string) []any {
	return []any{
		&g.ID, &g.LinkID, &g.ChannelID, &g.CallMessageID, &g.DisplayName,
		status, &g.Banned, &g.CreatedAt, &g.AdmittedAt, &g.EndedAt,
	}
}

func scanCallGuest(row pgx.Row) (*domain.CallGuest, error) {
	g := &domain.CallGuest{}
	var status string
	if err := row.Scan(callGuestDest(g, &status)...); err != nil {
		return nil, err
	}
	g.Status = domain.GuestStatus(status)
	return g, nil
}

// collectCallGuests читает все строки и закрывает rows. Возвращает непустой
// (не nil) срез: вызывающие отдают его наружу как JSON-массив.
func collectCallGuests(rows pgx.Rows, err error) ([]*domain.CallGuest, error) {
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	guests := []*domain.CallGuest{}
	for rows.Next() {
		g, err := scanCallGuest(rows)
		if err != nil {
			return nil, err
		}
		guests = append(guests, g)
	}
	return guests, rows.Err()
}

func (r *guestRepository) OpenCallMessageID(channelID uuid.UUID) (uuid.UUID, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	var id uuid.UUID
	err := r.db.QueryRow(ctx,
		`SELECT id FROM messages WHERE channel_id = $1 AND kind = 'call' AND call_ended_at IS NULL`,
		channelID).Scan(&id)
	if errors.Is(err, pgx.ErrNoRows) {
		return uuid.Nil, domain.ErrCallNotActive
	}
	if err != nil {
		return uuid.Nil, fmt.Errorf("find open call: %w", err)
	}
	return id, nil
}

func (r *guestRepository) CreateLink(link *domain.GuestLink, secretHash []byte) error {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return fmt.Errorf("begin create guest link: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if err := lockCall(ctx, tx, link.CallMessageID); err != nil {
		return fmt.Errorf("lock call: %w", err)
	}

	var open bool
	err = tx.QueryRow(ctx,
		`SELECT call_ended_at IS NULL FROM messages WHERE id = $1 AND kind = 'call'`,
		link.CallMessageID).Scan(&open)
	if errors.Is(err, pgx.ErrNoRows) || (err == nil && !open) {
		return domain.ErrCallNotActive
	}
	if err != nil {
		return fmt.Errorf("check call: %w", err)
	}

	if link.CreatedBy != nil {
		var active int
		if err := tx.QueryRow(ctx, `
			SELECT count(*) FROM call_guest_links
			WHERE call_message_id = $1 AND created_by = $2
			  AND revoked_at IS NULL AND closed_at IS NULL AND expires_at > $3`,
			link.CallMessageID, *link.CreatedBy, link.CreatedAt).Scan(&active); err != nil {
			return fmt.Errorf("count creator links: %w", err)
		}
		if active >= domain.MaxActiveLinksPerCreatorPerCall {
			return domain.ErrTooManyGuestLinks
		}
	}

	if _, err := tx.Exec(ctx, `
		INSERT INTO call_guest_links (id, secret_hash, channel_id, call_message_id, created_by, created_at, expires_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7)`,
		link.ID, secretHash, link.ChannelID, link.CallMessageID, link.CreatedBy, link.CreatedAt, link.ExpiresAt); err != nil {
		return fmt.Errorf("insert guest link: %w", err)
	}
	return tx.Commit(ctx)
}

func (r *guestRepository) GetLinkTargetBySecretHash(secretHash []byte) (*domain.GuestLinkTarget, error) {
	if len(secretHash) == 0 {
		return nil, domain.ErrGuestLinkInvalid
	}
	return r.getLinkTarget(`WHERE l.secret_hash = $1`, secretHash, domain.ErrGuestLinkInvalid)
}

func (r *guestRepository) GetLinkTargetByID(linkID uuid.UUID) (*domain.GuestLinkTarget, error) {
	return r.getLinkTarget(`WHERE l.id = $1`, linkID, domain.ErrGuestLinkNotFound)
}

func (r *guestRepository) getLinkTarget(where string, arg any, notFound error) (*domain.GuestLinkTarget, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	t, err := scanGuestLinkTarget(r.db.QueryRow(ctx, guestLinkTargetSelect+" "+where, arg))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound
	}
	if err != nil {
		return nil, fmt.Errorf("get guest link: %w", err)
	}
	return t, nil
}

func (r *guestRepository) ListCallState(callMessageID uuid.UUID) (*domain.GuestCallState, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	state := &domain.GuestCallState{Links: []*domain.GuestLink{}}

	rows, err := r.db.Query(ctx, `
		SELECT `+guestLinkColumns+` FROM call_guest_links l
		WHERE l.call_message_id = $1 AND l.revoked_at IS NULL
		ORDER BY l.created_at`, callMessageID)
	if err != nil {
		return nil, fmt.Errorf("list guest links: %w", err)
	}
	for rows.Next() {
		l := &domain.GuestLink{}
		if err := rows.Scan(guestLinkDest(l)...); err != nil {
			rows.Close()
			return nil, fmt.Errorf("scan guest link: %w", err)
		}
		state.Links = append(state.Links, l)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return nil, fmt.Errorf("list guest links: %w", err)
	}

	state.Guests, err = collectCallGuests(r.db.Query(ctx, `
		SELECT `+callGuestColumns+` FROM call_guests g
		WHERE g.call_message_id = $1 AND g.status IN ('lobby', 'admitted')
		ORDER BY g.created_at`, callMessageID))
	if err != nil {
		return nil, fmt.Errorf("list call guests: %w", err)
	}
	return state, nil
}

func (r *guestRepository) CloseCreatorLinksInChannel(channelID, creatorID uuid.UUID, now time.Time) (int64, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tag, err := r.db.Exec(ctx, `
		UPDATE call_guest_links l SET closed_at = $3
		FROM messages m
		WHERE m.id = l.call_message_id AND m.call_ended_at IS NULL
		  AND l.channel_id = $1 AND l.created_by = $2
		  AND l.closed_at IS NULL AND l.revoked_at IS NULL`,
		channelID, creatorID, now)
	if err != nil {
		return 0, fmt.Errorf("close creator guest links: %w", err)
	}
	return tag.RowsAffected(), nil
}

// NewGuestRepository — полная реализация domain.GuestRepository.
func NewGuestRepository(db *pgxpool.Pool) domain.GuestRepository {
	return newGuestRepository(db)
}

const guestContextSelect = `
	SELECT ` + callGuestColumns + `,
	       c.server_id, l.created_by, l.revoked_at IS NOT NULL, m.call_ended_at IS NOT NULL, s.guest_links_enabled
	FROM call_guests g
	JOIN call_guest_links l ON l.id = g.link_id
	JOIN channels c ON c.id = g.channel_id
	JOIN servers s ON s.id = c.server_id
	JOIN messages m ON m.id = g.call_message_id`

func scanGuestContext(row pgx.Row) (*domain.GuestContext, error) {
	c := &domain.GuestContext{}
	var status string
	dest := append(callGuestDest(&c.Guest, &status),
		&c.ServerID, &c.LinkCreatedBy, &c.LinkRevoked, &c.CallEnded, &c.GuestLinksEnabled)
	if err := row.Scan(dest...); err != nil {
		return nil, err
	}
	c.Guest.Status = domain.GuestStatus(status)
	return c, nil
}

// endedIPHash — выражение для ip_hash при переводе гостя в финальный статус.
// У забаненного гостя ip_hash живёт до конца звонка: по нему проверяется бан.
const endedIPHash = `CASE WHEN g.banned THEN g.ip_hash ELSE NULL END`

func (r *guestRepository) Join(j domain.GuestJoin) (*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin guest join: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Порядок блокировок везде один: строка ссылки, затем звонок.
	t, err := scanGuestLinkTarget(tx.QueryRow(ctx, guestLinkTargetSelect+` WHERE l.id = $1 FOR UPDATE OF l`, j.LinkID))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrGuestLinkInvalid
	}
	if err != nil {
		return nil, fmt.Errorf("load guest link: %w", err)
	}
	if err := lockCall(ctx, tx, t.Link.CallMessageID); err != nil {
		return nil, fmt.Errorf("lock call: %w", err)
	}
	if err := t.Usable(j.Now); err != nil {
		return nil, err
	}

	if len(j.IPHash) > 0 {
		var banned bool
		if err := tx.QueryRow(ctx, `
			SELECT EXISTS (SELECT 1 FROM call_guests WHERE call_message_id = $1 AND banned AND ip_hash = $2)`,
			t.Link.CallMessageID, j.IPHash).Scan(&banned); err != nil {
			return nil, fmt.Errorf("check guest ban: %w", err)
		}
		if banned {
			return nil, domain.ErrGuestBanned
		}
	}

	if t.Link.Uses >= domain.MaxJoinsPerLink {
		return nil, domain.ErrGuestLinkExhausted
	}

	var lobbyOnLink, activeInCall int
	if err := tx.QueryRow(ctx, `
		SELECT count(*) FILTER (WHERE link_id = $2 AND status = 'lobby'),
		       count(*) FILTER (WHERE status IN ('lobby', 'admitted'))
		FROM call_guests WHERE call_message_id = $1`,
		t.Link.CallMessageID, t.Link.ID).Scan(&lobbyOnLink, &activeInCall); err != nil {
		return nil, fmt.Errorf("count call guests: %w", err)
	}
	if lobbyOnLink >= domain.MaxLobbyPerLink {
		return nil, domain.ErrGuestLobbyFull
	}
	if activeInCall >= domain.MaxGuestsPerCall {
		return nil, domain.ErrGuestCallFull
	}

	if _, err := tx.Exec(ctx, `UPDATE call_guest_links SET uses = uses + 1 WHERE id = $1`, t.Link.ID); err != nil {
		return nil, fmt.Errorf("count guest link use: %w", err)
	}

	g := &domain.CallGuest{
		ID:            j.GuestID,
		LinkID:        t.Link.ID,
		ChannelID:     t.Link.ChannelID,
		CallMessageID: t.Link.CallMessageID,
		DisplayName:   j.DisplayName,
		Status:        domain.GuestStatusLobby,
		CreatedAt:     j.Now,
	}
	if _, err := tx.Exec(ctx, `
		INSERT INTO call_guests (id, link_id, channel_id, call_message_id, display_name, session_hash, ip_hash, status, created_at)
		VALUES ($1, $2, $3, $4, $5, $6, $7, 'lobby', $8)`,
		g.ID, g.LinkID, g.ChannelID, g.CallMessageID, g.DisplayName, j.SessionHash, j.IPHash, g.CreatedAt); err != nil {
		return nil, fmt.Errorf("insert call guest: %w", err)
	}

	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit guest join: %w", err)
	}
	return g, nil
}

func (r *guestRepository) GetSessionByHash(sessionHash []byte) (*domain.GuestContext, error) {
	if len(sessionHash) == 0 {
		return nil, domain.ErrGuestSessionInvalid
	}
	return r.getGuestContext(`WHERE g.session_hash = $1`, sessionHash, domain.ErrGuestSessionInvalid)
}

func (r *guestRepository) GetGuest(guestID uuid.UUID) (*domain.GuestContext, error) {
	return r.getGuestContext(`WHERE g.id = $1`, guestID, domain.ErrGuestNotFound)
}

func (r *guestRepository) getGuestContext(where string, arg any, notFound error) (*domain.GuestContext, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	c, err := scanGuestContext(r.db.QueryRow(ctx, guestContextSelect+" "+where, arg))
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, notFound
	}
	if err != nil {
		return nil, fmt.Errorf("get call guest: %w", err)
	}
	return c, nil
}

func (r *guestRepository) Decide(guestID, actorID uuid.UUID, admit bool, now time.Time) (*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin guest decision: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	// Блокировка строки гостя сериализует решение с отзывом ссылки: RevokeLink
	// обновляет эти же строки в своей транзакции.
	var status string
	var callEnded bool
	err = tx.QueryRow(ctx, `
		SELECT g.status, m.call_ended_at IS NOT NULL
		FROM call_guests g JOIN messages m ON m.id = g.call_message_id
		WHERE g.id = $1 FOR UPDATE OF g`, guestID).Scan(&status, &callEnded)
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, domain.ErrGuestNotFound
	}
	if err != nil {
		return nil, fmt.Errorf("load guest for decision: %w", err)
	}
	if domain.GuestStatus(status) != domain.GuestStatusLobby {
		return nil, domain.ErrGuestAlreadyDecided
	}
	if callEnded {
		return nil, domain.ErrGuestCallEnded
	}

	query := `UPDATE call_guests AS g
		SET status = 'admitted', decided_by = $2, decided_at = $3, admitted_at = $3
		WHERE g.id = $1 RETURNING ` + callGuestColumns
	if !admit {
		query = `UPDATE call_guests AS g
			SET status = 'rejected', decided_by = $2, decided_at = $3, ended_at = $3,
			    session_hash = NULL, ip_hash = NULL
			WHERE g.id = $1 RETURNING ` + callGuestColumns
	}
	g, err := scanCallGuest(tx.QueryRow(ctx, query, guestID, actorID, now))
	if err != nil {
		return nil, fmt.Errorf("apply guest decision: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit guest decision: %w", err)
	}
	return g, nil
}

func (r *guestRepository) EndGuest(guestID uuid.UUID, status domain.GuestStatus, actorID *uuid.UUID, ban bool, now time.Time) (*domain.CallGuest, error) {
	switch status {
	case domain.GuestStatusLeft, domain.GuestStatusKicked, domain.GuestStatusLobbyTimeout:
	default:
		return nil, fmt.Errorf("EndGuest: unsupported target status %q", status)
	}

	ctx, cancel := guestCtx()
	defer cancel()

	g, err := scanCallGuest(r.db.QueryRow(ctx, `
		UPDATE call_guests AS g
		SET status = $2, ended_at = $3, ended_by = $4,
		    banned = g.banned OR $5,
		    session_hash = NULL,
		    ip_hash = CASE WHEN g.banned OR $5 THEN g.ip_hash ELSE NULL END
		WHERE g.id = $1 AND g.status IN ('lobby', 'admitted')
		RETURNING `+callGuestColumns,
		guestID, string(status), now, actorID, ban))
	if errors.Is(err, pgx.ErrNoRows) {
		var exists bool
		if err := r.db.QueryRow(ctx, `SELECT EXISTS (SELECT 1 FROM call_guests WHERE id = $1)`, guestID).Scan(&exists); err != nil {
			return nil, fmt.Errorf("check call guest: %w", err)
		}
		if !exists {
			return nil, domain.ErrGuestNotFound
		}
		return nil, domain.ErrGuestNotActive
	}
	if err != nil {
		return nil, fmt.Errorf("end call guest: %w", err)
	}
	return g, nil
}

func (r *guestRepository) RevokeLink(linkID uuid.UUID, actorID *uuid.UUID, reason string, now time.Time) ([]*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin revoke guest link: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `
		UPDATE call_guest_links SET revoked_at = $2, revoked_by = $3, revoke_reason = $4
		WHERE id = $1 AND revoked_at IS NULL`, linkID, now, actorID, reason)
	if err != nil {
		return nil, fmt.Errorf("revoke guest link: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, tx.Commit(ctx)
	}

	status := domain.GuestStatusRevoked
	if reason == domain.GuestRevokeCallEnded {
		status = domain.GuestStatusCallEnded
	}
	guests, err := collectCallGuests(tx.Query(ctx, `
		UPDATE call_guests AS g
		SET status = $2, ended_at = $3, session_hash = NULL, ip_hash = `+endedIPHash+`
		WHERE g.link_id = $1 AND g.status IN ('lobby', 'admitted')
		RETURNING `+callGuestColumns, linkID, string(status), now))
	if err != nil {
		return nil, fmt.Errorf("end guests of revoked link: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit revoke guest link: %w", err)
	}
	return guests, nil
}

func (r *guestRepository) SetServerGuestLinks(serverID uuid.UUID, enabled bool, actorID uuid.UUID, now time.Time) ([]*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin server guest toggle: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	tag, err := tx.Exec(ctx, `UPDATE servers SET guest_links_enabled = $2, updated_at = $3 WHERE id = $1`, serverID, enabled, now)
	if err != nil {
		return nil, fmt.Errorf("update server guest toggle: %w", err)
	}
	if tag.RowsAffected() == 0 {
		return nil, fmt.Errorf("server %s: %w", serverID, domain.ErrServerNotFound)
	}
	if enabled {
		return []*domain.CallGuest{}, tx.Commit(ctx)
	}

	if _, err := tx.Exec(ctx, `
		UPDATE call_guest_links l SET revoked_at = $2, revoked_by = $3, revoke_reason = 'server_disabled'
		FROM channels c
		WHERE c.id = l.channel_id AND c.server_id = $1 AND l.revoked_at IS NULL`,
		serverID, now, actorID); err != nil {
		return nil, fmt.Errorf("revoke server guest links: %w", err)
	}
	guests, err := collectCallGuests(tx.Query(ctx, `
		UPDATE call_guests AS g
		SET status = 'revoked', ended_at = $2, session_hash = NULL, ip_hash = `+endedIPHash+`
		FROM channels c
		WHERE c.id = g.channel_id AND c.server_id = $1 AND g.status IN ('lobby', 'admitted')
		RETURNING `+callGuestColumns, serverID, now))
	if err != nil {
		return nil, fmt.Errorf("end server guests: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit server guest toggle: %w", err)
	}
	return guests, nil
}

func (r *guestRepository) EndGuestsOfClosedCalls(now time.Time) ([]*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	tx, err := r.db.Begin(ctx)
	if err != nil {
		return nil, fmt.Errorf("begin end guests of closed calls: %w", err)
	}
	defer func() { _ = tx.Rollback(ctx) }()

	if _, err := tx.Exec(ctx, `
		UPDATE call_guest_links l SET revoked_at = $1, revoke_reason = 'call_ended'
		FROM messages m
		WHERE m.id = l.call_message_id AND m.call_ended_at IS NOT NULL AND l.revoked_at IS NULL`, now); err != nil {
		return nil, fmt.Errorf("revoke links of closed calls: %w", err)
	}
	guests, err := collectCallGuests(tx.Query(ctx, `
		UPDATE call_guests AS g
		SET status = 'call_ended', ended_at = $1, session_hash = NULL, ip_hash = NULL
		FROM messages m
		WHERE m.id = g.call_message_id AND m.call_ended_at IS NOT NULL AND g.status IN ('lobby', 'admitted')
		RETURNING `+callGuestColumns, now))
	if err != nil {
		return nil, fmt.Errorf("end guests of closed calls: %w", err)
	}
	if _, err := tx.Exec(ctx, `
		UPDATE call_guests AS g SET ip_hash = NULL
		FROM messages m
		WHERE m.id = g.call_message_id AND m.call_ended_at IS NOT NULL AND g.ip_hash IS NOT NULL`); err != nil {
		return nil, fmt.Errorf("clear ban hashes of closed calls: %w", err)
	}
	if err := tx.Commit(ctx); err != nil {
		return nil, fmt.Errorf("commit end guests of closed calls: %w", err)
	}
	return guests, nil
}

func (r *guestRepository) ExpireLobby(olderThan, now time.Time) ([]*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	guests, err := collectCallGuests(r.db.Query(ctx, `
		UPDATE call_guests AS g
		SET status = 'lobby_timeout', ended_at = $2, session_hash = NULL, ip_hash = `+endedIPHash+`
		WHERE g.status = 'lobby' AND g.created_at < $1
		RETURNING `+callGuestColumns, olderThan, now))
	if err != nil {
		return nil, fmt.Errorf("expire guest lobby: %w", err)
	}
	return guests, nil
}

func (r *guestRepository) ListAdmittedGuests() ([]*domain.CallGuest, error) {
	ctx, cancel := guestCtx()
	defer cancel()

	guests, err := collectCallGuests(r.db.Query(ctx,
		`SELECT `+callGuestColumns+` FROM call_guests g WHERE g.status = 'admitted'`))
	if err != nil {
		return nil, fmt.Errorf("list admitted guests: %w", err)
	}
	return guests, nil
}
