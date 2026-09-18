package guestevents_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/google/uuid"
	"github.com/gorilla/websocket"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/vycord/server/internal/delivery/guestws"
	"github.com/vycord/server/internal/delivery/http/handler"
	"github.com/vycord/server/internal/delivery/ws"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/guestevents"
	"github.com/vycord/server/internal/repository/postgres"
	"github.com/vycord/server/internal/usecase"
	"github.com/vycord/server/pkg/authtoken"
)

// Сквозной путь гостя на настоящей базе, настоящем хабе, шлюзе и событиях:
// участник выпускает ссылку → гость смотрит предпросмотр и встаёт в лобби →
// участник впускает → гость получает admitted и состав звонка по сокету →
// гость пишет в чат → участника выгоняют гостя → сокет гостя закрывается,
// а его сессия больше не действует.
//
// SFU здесь подменён: он проверяется своими тестами, а тут важно, что события
// доходят до всех трёх адресатов.

const lifecycleSecret = "guest-lifecycle-secret"

type fakeKicker struct{ kicked chan string }

func (f *fakeKicker) KickGuest(_ context.Context, _ uuid.UUID, identity string) error {
	select {
	case f.kicked <- identity:
	default:
	}
	return nil
}

func openDB(t *testing.T) *pgxpool.Pool {
	t.Helper()
	dsn := os.Getenv("VYCORD_TEST_DSN")
	if dsn == "" {
		t.Skip("VYCORD_TEST_DSN not set — skipping guest lifecycle integration test")
	}
	pool, err := pgxpool.New(context.Background(), dsn)
	require.NoError(t, err)
	t.Cleanup(pool.Close)
	require.NoError(t, pool.Ping(context.Background()))

	// Этот тест работает на УЖЕ мигрированной базе (в отличие от
	// репозиторных тестов, которые поднимают одноразовую БД сами). Если
	// VYCORD_TEST_DSN указывает на служебную базу без схемы — пропускаем,
	// а не падаем.
	var migrated bool
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT to_regclass('public.call_guests') IS NOT NULL`).Scan(&migrated))
	if !migrated {
		t.Skip("VYCORD_TEST_DSN points at a database without the schema — run migrations or point it at the app database")
	}
	return pool
}

// seedCall inserts a user, a server with guests enabled, a channel and an open
// call directly: the point of this test is the guest path, not account signup.
func seedCall(t *testing.T, pool *pgxpool.Pool) (userID, serverID, channelID uuid.UUID) {
	t.Helper()
	ctx := context.Background()
	userID = uuid.New()
	suffix := strings.ReplaceAll(uuid.NewString(), "-", "")[:12]
	_, err := pool.Exec(ctx, `INSERT INTO users (id, username, email, password_hash) VALUES ($1, $2, $3, 'x')`,
		userID, "u"+suffix, suffix+"@example.test")
	require.NoError(t, err)

	serverID = uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO servers (id, name, owner_id, guest_links_enabled) VALUES ($1, $2, $3, true)`,
		serverID, "srv-"+suffix, userID)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `INSERT INTO server_members (server_id, user_id) VALUES ($1, $2)`, serverID, userID)
	require.NoError(t, err)

	channelID = uuid.New()
	_, err = pool.Exec(ctx, `INSERT INTO channels (id, server_id, name) VALUES ($1, $2, $3)`, channelID, serverID, "ch-"+suffix)
	require.NoError(t, err)
	_, err = pool.Exec(ctx, `
		INSERT INTO messages (id, channel_id, user_id, content, kind, call_started_at, call_last_seen_at, call_participant_ids, created_at, updated_at)
		VALUES ($1, $2, $3, '', 'call', now(), now(), ARRAY[$3::uuid], now(), now())`,
		uuid.New(), channelID, userID)
	require.NoError(t, err)

	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(), `DELETE FROM servers WHERE id = $1`, serverID)
		_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, userID)
	})
	return userID, serverID, channelID
}

// alwaysAllowedAccess stands in for the permission stack: membership and roles
// are resolved elsewhere and have their own tests.
type alwaysAllowedAccess struct{ channelID, serverID uuid.UUID }

func (a alwaysAllowedAccess) CheckChannelAccess(channelID, _ uuid.UUID) (*domain.Channel, error) {
	return &domain.Channel{ID: channelID, ServerID: a.serverID}, nil
}
func (a alwaysAllowedAccess) GetChannelAudience(uuid.UUID) ([]uuid.UUID, error) { return nil, nil }

type ownerPerms struct{}

func (ownerPerms) Resolve(uuid.UUID, uuid.UUID) (domain.PermissionSet, error) {
	return domain.PermissionSet{IsOwner: true}, nil
}

func readMessage(t *testing.T, conn *websocket.Conn) guestws.Message {
	t.Helper()
	require.NoError(t, conn.SetReadDeadline(time.Now().Add(5*time.Second)))
	_, raw, err := conn.ReadMessage()
	require.NoError(t, err)
	var m guestws.Message
	require.NoError(t, json.Unmarshal(raw, &m))
	return m
}

// readUntil drains roster refreshes until the awaited message shows up: the
// guest also receives a fresh participants snapshot on every membership
// change, and their order relative to lifecycle messages is not a contract.
func readUntil(t *testing.T, conn *websocket.Conn, want string) guestws.Message {
	t.Helper()
	for i := 0; i < 10; i++ {
		m := readMessage(t, conn)
		if m.Type == want {
			return m
		}
	}
	t.Fatalf("message %q never arrived", want)
	return guestws.Message{}
}

func TestGuestLifecycleEndToEnd(t *testing.T) {
	pool := openDB(t)
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	userID, serverID, channelID := seedCall(t, pool)

	guestRepo := postgres.NewGuestRepository(pool)
	messageRepo := postgres.NewMessageRepository(pool)
	userRepo := postgres.NewUserRepository(pool)

	hub := ws.NewHub(log)
	go hub.Run()
	gateway := guestws.NewGateway(log)
	kicker := &fakeKicker{kicked: make(chan string, 4)}

	guestUC := usecase.NewGuestUseCase(usecase.GuestUseCaseDeps{
		Repo:      guestRepo,
		Servers:   postgres.NewServerRepository(pool),
		Access:    alwaysAllowedAccess{channelID: channelID, serverID: serverID},
		Perms:     ownerPerms{},
		Presence:  hub,
		TURN:      usecase.NewTURNUseCase("", nil, time.Hour),
		JWTSecret: lifecycleSecret,
	})
	events := guestevents.New(hub, gateway, kicker, guestRepo, userRepo, log)
	guestUC.SetEvents(events)

	wsHandler := handler.NewGuestWSHandler(guestUC, gateway, events, log)
	srv := httptest.NewServer(http.HandlerFunc(wsHandler.HandleWebSocket))
	defer srv.Close()

	// Участник в звонке — только он может выпустить ссылку.
	hub.JoinVoiceChannel(userID, channelID)

	created, err := guestUC.CreateLink(channelID, userID)
	require.NoError(t, err)
	require.NotEmpty(t, created.Secret)

	preview, err := guestUC.Preview(created.Secret)
	require.NoError(t, err)
	assert.Equal(t, 1, preview.ParticipantCount)
	assert.NotEmpty(t, preview.ChannelName)

	joined, err := guestUC.Join(created.Secret, "  Гость​ Вася ", "203.0.113.9")
	require.NoError(t, err)
	assert.Equal(t, "Гость Вася", joined.DisplayName)

	// Гость подключает сокет, ещё стоя в лобби.
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(srv.URL, "http"), nil)
	require.NoError(t, err)
	defer conn.Close()
	authFrame, _ := json.Marshal(guestws.Marshal("auth", map[string]string{"token": joined.SessionToken}))
	require.NoError(t, conn.WriteMessage(websocket.TextMessage, authFrame))
	assert.Equal(t, "lobby_waiting", readMessage(t, conn).Type)

	// Участник впускает гостя.
	require.NoError(t, guestUC.Admit(joined.GuestID, userID))
	readUntil(t, conn, "admitted")

	roster := readUntil(t, conn, "participants")
	var rosterPayload struct {
		Users []struct {
			UserID   string `json:"user_id"`
			Username string `json:"username"`
		} `json:"users"`
		Guests []struct {
			DisplayName string `json:"display_name"`
		} `json:"guests"`
	}
	require.NoError(t, json.Unmarshal(roster.Payload, &rosterPayload))
	require.Len(t, rosterPayload.Users, 1)
	assert.Equal(t, userID.String(), rosterPayload.Users[0].UserID)
	assert.NotEmpty(t, rosterPayload.Users[0].Username)
	require.Len(t, rosterPayload.Guests, 1)
	assert.Equal(t, "Гость Вася", rosterPayload.Guests[0].DisplayName)

	// Теперь у гостя есть room-токен — и он валиден только для этой комнаты.
	session, err := guestUC.Authenticate(joined.SessionToken)
	require.NoError(t, err)
	roomToken, roomID, err := guestUC.IssueRoomToken(session)
	require.NoError(t, err)
	assert.Equal(t, channelID, roomID)
	claims, err := authtoken.ValidateGuestRoomToken(lifecycleSecret, roomToken)
	require.NoError(t, err)
	assert.Equal(t, joined.GuestID, claims.GuestID)
	_, err = authtoken.ValidateToken(lifecycleSecret, roomToken)
	assert.Error(t, err, "Н2: гостевой room-токен не является access-токеном")

	// Гость пишет в чат канала.
	messageUC := usecase.NewMessageUseCase(messageRepo, postgres.NewChannelRepository(pool),
		postgres.NewServerRepository(pool), postgres.NewStickerRepository(pool), ownerPerms{},
		postgres.NewAttachmentRepository(pool), nil)
	msg, err := messageUC.CreateGuestMessage(session, "привет из браузера")
	require.NoError(t, err)
	assert.Nil(t, msg.UserID)
	require.NotNil(t, msg.Guest)

	stored, err := messageRepo.GetByID(msg.ID)
	require.NoError(t, err)
	require.NotNil(t, stored.Guest)
	assert.Equal(t, "Гость Вася", stored.Guest.DisplayName)

	// Участник выгоняет гостя: сокет закрывается с причиной, SFU получает kick,
	// сессия перестаёт работать.
	require.NoError(t, guestUC.Kick(joined.GuestID, userID, false))

	kicked := readUntil(t, conn, "kicked")
	assert.Contains(t, string(kicked.Payload), "kicked")

	select {
	case identity := <-kicker.kicked:
		assert.Equal(t, authtoken.GuestIdentity(joined.GuestID), identity)
	case <-time.After(3 * time.Second):
		t.Fatal("SFU kick was never requested")
	}

	_, err = guestUC.Authenticate(joined.SessionToken)
	assert.ErrorIs(t, err, domain.ErrGuestSessionInvalid, "Н8: после кика сессия мертва")

	assert.Eventually(t, func() bool { return len(gateway.Connected()) == 0 }, 3*time.Second, 20*time.Millisecond)
}
