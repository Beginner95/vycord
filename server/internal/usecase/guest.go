package usecase

import (
	"errors"
	"fmt"
	"log/slog"
	"sync"
	"time"

	"github.com/google/uuid"

	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/pkg/authtoken"
)

// NoopGuestEvents — заглушка domain.GuestEvents: жизненный цикл гостя работает,
// но никого не уведомляет. Стоит в main.go до плана 3 (гостевой шлюз, события
// хаба, kick в SFU).
type NoopGuestEvents struct{}

func (NoopGuestEvents) LinksChanged(uuid.UUID)                       {}
func (NoopGuestEvents) LobbyRequested(*domain.CallGuest, *uuid.UUID) {}
func (NoopGuestEvents) LobbyResolved(*domain.CallGuest, *uuid.UUID)  {}
func (NoopGuestEvents) GuestsEnded([]*domain.CallGuest)              {}

type GuestUseCaseDeps struct {
	Repo      domain.GuestRepository
	Servers   domain.ServerRepository
	Access    domain.ChannelAccessChecker
	Perms     domain.PermissionUseCase
	Presence  domain.CallPresence
	TURN      domain.TURNUseCase
	JWTSecret string
	// Now подменяется в тестах; nil означает time.Now.
	Now func() time.Time
}

type guestUseCase struct {
	repo      domain.GuestRepository
	servers   domain.ServerRepository
	access    domain.ChannelAccessChecker
	perms     domain.PermissionUseCase
	presence  domain.CallPresence
	turn      domain.TURNUseCase
	events    domain.GuestEvents
	jwtSecret string
	ipKey     []byte
	now       func() time.Time

	// absentSince — с какого момента гость пропал и из шлюза, и из SFU.
	// Живёт в памяти: обрыв на 10 секунд не должен оставлять следов в БД.
	absentMu    sync.Mutex
	absentSince map[uuid.UUID]time.Time
}

func newGuestUseCase(d GuestUseCaseDeps) *guestUseCase {
	now := d.Now
	if now == nil {
		now = time.Now
	}
	return &guestUseCase{
		repo: d.Repo, servers: d.Servers, access: d.Access, perms: d.Perms,
		presence: d.Presence, turn: d.TURN, events: NoopGuestEvents{},
		jwtSecret: d.JWTSecret,
		// Отдельный производный ключ: ключ подписи гостевых room-токенов не
		// должен использоваться ни для чего другого.
		ipKey:       authtoken.DeriveKey(d.JWTSecret, authtoken.GuestIPKeyLabel),
		now:         now,
		absentSince: make(map[uuid.UUID]time.Time),
	}
}

// SetEvents вызывается один раз при старте, до приёма запросов.
func (uc *guestUseCase) SetEvents(events domain.GuestEvents) {
	if events == nil {
		events = NoopGuestEvents{}
	}
	uc.events = events
}

func (uc *guestUseCase) CreateLink(channelID, userID uuid.UUID) (*domain.GuestLinkCreated, error) {
	ch, err := uc.access.CheckChannelAccess(channelID, userID)
	if err != nil {
		return nil, err
	}
	server, err := uc.servers.GetByID(ch.ServerID)
	if err != nil {
		return nil, fmt.Errorf("get server: %w", err)
	}
	if !server.GuestLinksEnabled {
		return nil, domain.ErrGuestLinksDisabled
	}
	// Приглашать может только тот, кто сам сейчас в звонке.
	if !uc.presence.IsInVoiceChannel(userID, channelID) {
		return nil, domain.ErrNotInCall
	}
	callID, err := uc.repo.OpenCallMessageID(channelID)
	if err != nil {
		return nil, err
	}

	secret, err := authtoken.GenerateOpaqueSecret()
	if err != nil {
		return nil, fmt.Errorf("generate guest link secret: %w", err)
	}
	now := uc.now()
	creator := userID
	link := &domain.GuestLink{
		ID: uuid.New(), ChannelID: channelID, CallMessageID: callID,
		CreatedBy: &creator, CreatedAt: now, ExpiresAt: now.Add(domain.GuestLinkTTL),
	}
	if err := uc.repo.CreateLink(link, authtoken.HashOpaqueSecret(secret)); err != nil {
		return nil, err
	}
	slog.Info("guest_link.created", "link_id", link.ID, "channel_id", channelID, "created_by", userID)
	uc.events.LinksChanged(channelID)

	return &domain.GuestLinkCreated{ID: link.ID, Secret: secret, ExpiresAt: link.ExpiresAt}, nil
}

func (uc *guestUseCase) ListCallGuests(channelID, userID uuid.UUID) (*domain.GuestCallState, error) {
	if _, err := uc.access.CheckChannelAccess(channelID, userID); err != nil {
		return nil, err
	}
	if !uc.presence.IsInVoiceChannel(userID, channelID) {
		return nil, domain.ErrNotInCall
	}
	callID, err := uc.repo.OpenCallMessageID(channelID)
	if errors.Is(err, domain.ErrCallNotActive) {
		return &domain.GuestCallState{Links: []*domain.GuestLink{}, Guests: []*domain.CallGuest{}}, nil
	}
	if err != nil {
		return nil, err
	}
	return uc.repo.ListCallState(callID)
}

func (uc *guestUseCase) RevokeLink(linkID, userID uuid.UUID) error {
	target, err := uc.repo.GetLinkTargetByID(linkID)
	if err != nil {
		return err
	}
	if _, err := uc.access.CheckChannelAccess(target.Link.ChannelID, userID); err != nil {
		return err
	}
	ok, err := uc.canModerate(target.ServerID, target.Link.ChannelID, userID, target.Link.CreatedBy)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}

	actor := userID
	ended, err := uc.repo.RevokeLink(linkID, &actor, domain.GuestRevokeManual, uc.now())
	if err != nil {
		return err
	}
	slog.Info("guest_link.revoked", "link_id", linkID, "channel_id", target.Link.ChannelID,
		"revoked_by", userID, "guests_ended", len(ended))
	uc.endGuests(ended)
	uc.events.LinksChanged(target.Link.ChannelID)
	return nil
}

func (uc *guestUseCase) Admit(guestID, userID uuid.UUID) error {
	return uc.decide(guestID, userID, true)
}

func (uc *guestUseCase) Reject(guestID, userID uuid.UUID) error {
	return uc.decide(guestID, userID, false)
}

// decide — решение лобби. Принять или отклонить может ЛЮБОЙ участник звонка:
// лобби — это общий контроль, а не полномочие модератора.
func (uc *guestUseCase) decide(guestID, userID uuid.UUID, admit bool) error {
	gc, err := uc.repo.GetGuest(guestID)
	if err != nil {
		return err
	}
	channelID := gc.Guest.ChannelID
	if _, err := uc.access.CheckChannelAccess(channelID, userID); err != nil {
		return err
	}
	if !uc.presence.IsInVoiceChannel(userID, channelID) {
		return domain.ErrNotInCall
	}

	g, err := uc.repo.Decide(guestID, userID, admit, uc.now())
	if err != nil {
		return err
	}
	slog.Info("guest.decided", "guest_id", guestID, "channel_id", channelID,
		"status", string(g.Status), "decided_by", userID)

	actor := userID
	uc.events.LobbyResolved(g, &actor)
	if !admit {
		uc.endGuests([]*domain.CallGuest{g})
	}
	uc.events.LinksChanged(channelID)
	return nil
}

func (uc *guestUseCase) Kick(guestID, userID uuid.UUID, ban bool) error {
	gc, err := uc.repo.GetGuest(guestID)
	if err != nil {
		return err
	}
	channelID := gc.Guest.ChannelID
	if _, err := uc.access.CheckChannelAccess(channelID, userID); err != nil {
		return err
	}
	ok, err := uc.canModerate(gc.ServerID, channelID, userID, gc.LinkCreatedBy)
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrForbidden
	}

	actor := userID
	g, err := uc.repo.EndGuest(guestID, domain.GuestStatusKicked, &actor, ban, uc.now())
	if err != nil {
		return err
	}
	slog.Info("guest.kicked", "guest_id", guestID, "channel_id", channelID, "kicked_by", userID, "ban", ban)

	if gc.Guest.Status == domain.GuestStatusLobby {
		uc.events.LobbyResolved(g, &actor)
	}
	uc.endGuests([]*domain.CallGuest{g})
	uc.events.LinksChanged(channelID)
	return nil
}

func (uc *guestUseCase) SetServerGuestLinks(serverID, userID uuid.UUID, enabled bool) (*domain.Server, error) {
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return nil, err
	}
	if !ps.Has(domain.PermManageServer) {
		return nil, domain.ErrForbidden
	}

	ended, err := uc.repo.SetServerGuestLinks(serverID, enabled, userID, uc.now())
	if err != nil {
		return nil, err
	}
	slog.Info("guest_links.server_toggled", "server_id", serverID, "enabled", enabled,
		"by", userID, "guests_ended", len(ended))
	uc.endGuests(ended)
	uc.notifyChannelsOf(ended)

	return uc.servers.GetByID(serverID)
}

// OnParticipantLeft вызывается, когда участник покинул голосовой канал: его
// ссылки перестают принимать новых гостей (правило 1 «дыры модерации»).
// Уже впущенные гости остаются. Ошибку только логируем — это фоновая уборка.
func (uc *guestUseCase) OnParticipantLeft(channelID, userID uuid.UUID) {
	n, err := uc.repo.CloseCreatorLinksInChannel(channelID, userID, uc.now())
	if err != nil {
		slog.Error("guest_link.close_on_leave_failed", "channel_id", channelID, "user_id", userID, "error", err)
		return
	}
	if n > 0 {
		slog.Info("guest_link.closed_on_leave", "channel_id", channelID, "user_id", userID, "links", n)
		uc.events.LinksChanged(channelID)
	}
}

// isModerator — создатель ссылки, владелец сервера или обладатель
// PermAdministrator (PermissionSet.Has короткозамыкает оба последних).
func (uc *guestUseCase) isModerator(serverID, userID uuid.UUID, linkCreatedBy *uuid.UUID) (bool, error) {
	if linkCreatedBy != nil && *linkCreatedBy == userID {
		return true, nil
	}
	ps, err := uc.perms.Resolve(serverID, userID)
	if err != nil {
		return false, err
	}
	return ps.Has(domain.PermAdministrator), nil
}

// canModerate — правило 2 «дыры модерации»: если в звонке нет ни одного
// модератора этой ссылки, право выгнать гостя и отозвать ссылку получает любой
// участник звонка. Иначе проблемный гость остался бы навсегда, когда создатель
// ссылки ушёл, а администраторов в звонке нет.
func (uc *guestUseCase) canModerate(serverID, channelID, actorID uuid.UUID, linkCreatedBy *uuid.UUID) (bool, error) {
	moderator, err := uc.isModerator(serverID, actorID, linkCreatedBy)
	if err != nil || moderator {
		return moderator, err
	}
	if !uc.presence.IsInVoiceChannel(actorID, channelID) {
		return false, nil
	}
	for _, participant := range uc.presence.VoiceParticipants(channelID) {
		if participant == actorID {
			continue
		}
		mod, err := uc.isModerator(serverID, participant, linkCreatedBy)
		if err != nil {
			return false, err
		}
		if mod {
			return false, nil
		}
	}
	return true, nil
}

func (uc *guestUseCase) endGuests(guests []*domain.CallGuest) {
	if len(guests) > 0 {
		uc.events.GuestsEnded(guests)
	}
}

func (uc *guestUseCase) notifyChannelsOf(guests []*domain.CallGuest) {
	seen := make(map[uuid.UUID]struct{}, len(guests))
	for _, g := range guests {
		if _, ok := seen[g.ChannelID]; ok {
			continue
		}
		seen[g.ChannelID] = struct{}{}
		uc.events.LinksChanged(g.ChannelID)
	}
}

// NewGuestUseCase собирает гостевой use case. События по умолчанию — NoopGuestEvents,
// реальную реализацию подключает SetEvents при старте (план 3).
func NewGuestUseCase(d GuestUseCaseDeps) domain.GuestUseCase {
	return newGuestUseCase(d)
}

// linkBySecret находит ссылку по секрету и проверяет её пригодность. Секрет
// никогда не логируется и не сохраняется — только его SHA-256.
func (uc *guestUseCase) linkBySecret(secret string) (*domain.GuestLinkTarget, error) {
	if secret == "" {
		return nil, domain.ErrGuestLinkInvalid
	}
	target, err := uc.repo.GetLinkTargetBySecretHash(authtoken.HashOpaqueSecret(secret))
	if err != nil {
		return nil, err
	}
	if err := target.Usable(uc.now()); err != nil {
		return nil, err
	}
	return target, nil
}

func (uc *guestUseCase) Preview(secret string) (*domain.GuestPreview, error) {
	target, err := uc.linkBySecret(secret)
	if err != nil {
		return nil, err
	}
	state, err := uc.repo.ListCallState(target.Link.CallMessageID)
	if err != nil {
		return nil, err
	}
	admitted := 0
	for _, g := range state.Guests {
		if g.Status == domain.GuestStatusAdmitted {
			admitted++
		}
	}
	// Имён участников здесь нет намеренно: у держателя ссылки ещё нет допуска.
	return &domain.GuestPreview{
		ServerName:       target.ServerName,
		ServerIconURL:    target.ServerIconURL,
		ChannelName:      target.ChannelName,
		ParticipantCount: len(uc.presence.VoiceParticipants(target.Link.ChannelID)) + admitted,
	}, nil
}

func (uc *guestUseCase) Join(secret, displayName, clientIP string) (*domain.GuestJoinResult, error) {
	target, err := uc.linkBySecret(secret)
	if err != nil {
		return nil, err
	}
	name, err := domain.NormalizeGuestName(displayName)
	if err != nil {
		return nil, err
	}
	session, err := authtoken.GenerateOpaqueSecret()
	if err != nil {
		return nil, fmt.Errorf("generate guest session token: %w", err)
	}

	g, err := uc.repo.Join(domain.GuestJoin{
		LinkID:      target.Link.ID,
		GuestID:     uuid.New(),
		DisplayName: name,
		SessionHash: authtoken.HashOpaqueSecret(session),
		IPHash:      guestIPHash(uc.ipKey, clientIP),
		Now:         uc.now(),
	})
	if err != nil {
		return nil, err
	}
	slog.Info("guest.joined_lobby", "guest_id", g.ID, "link_id", target.Link.ID, "channel_id", g.ChannelID)

	uc.events.LobbyRequested(g, target.Link.CreatedBy)
	uc.events.LinksChanged(g.ChannelID)

	return &domain.GuestJoinResult{GuestID: g.ID, SessionToken: session, DisplayName: name}, nil
}

// Authenticate проверяет непрозрачный сессионный токен на каждом запросе:
// именно поэтому кик, отзыв ссылки и конец звонка действуют мгновенно.
func (uc *guestUseCase) Authenticate(sessionToken string) (*domain.GuestContext, error) {
	if sessionToken == "" {
		return nil, domain.ErrGuestSessionInvalid
	}
	gc, err := uc.repo.GetSessionByHash(authtoken.HashOpaqueSecret(sessionToken))
	if err != nil {
		return nil, err
	}
	if !gc.SessionUsable() {
		return nil, domain.ErrGuestSessionInvalid
	}
	return gc, nil
}

func (uc *guestUseCase) Leave(gc *domain.GuestContext) error {
	g, err := uc.repo.EndGuest(gc.Guest.ID, domain.GuestStatusLeft, nil, false, uc.now())
	if err != nil {
		return err
	}
	slog.Info("guest.left", "guest_id", g.ID, "channel_id", g.ChannelID)

	if gc.Guest.Status == domain.GuestStatusLobby {
		uc.events.LobbyResolved(g, nil)
	}
	uc.endGuests([]*domain.CallGuest{g})
	uc.events.LinksChanged(g.ChannelID)
	return nil
}

func (uc *guestUseCase) IssueRoomToken(gc *domain.GuestContext) (string, uuid.UUID, error) {
	if gc.Guest.Status != domain.GuestStatusAdmitted {
		return "", uuid.Nil, domain.ErrGuestNotAdmitted
	}
	// Комната берётся из строки гостя, а не из запроса: токен не может
	// оказаться выписан на чужую комнату.
	token, err := authtoken.GenerateGuestRoomToken(uc.jwtSecret, gc.Guest.ID, gc.Guest.ChannelID, domain.GuestRoomTokenTTL)
	if err != nil {
		return "", uuid.Nil, fmt.Errorf("generate guest room token: %w", err)
	}
	return token, gc.Guest.ChannelID, nil
}

func (uc *guestUseCase) TURNCredentials(gc *domain.GuestContext) (*domain.TURNCredentials, error) {
	if gc.Guest.Status != domain.GuestStatusAdmitted {
		return nil, domain.ErrGuestNotAdmitted
	}
	// Короткий TTL: отозвать выданные coturn-креды нельзя, они только истекают.
	return uc.turn.GetCredentialsForIdentity(authtoken.GuestIdentity(gc.Guest.ID), domain.GuestTURNTTL)
}

func (uc *guestUseCase) ExpireLobby() {
	now := uc.now()
	guests, err := uc.repo.ExpireLobby(now.Add(-domain.GuestLobbyTimeout), now)
	if err != nil {
		slog.Error("guest.lobby_expiry_failed", "error", err)
		return
	}
	for _, g := range guests {
		uc.events.LobbyResolved(g, nil)
	}
	uc.endGuests(guests)
	uc.notifyChannelsOf(guests)
}

// EndGuestsOfClosedCalls — страховка на случай, если событие конца звонка не
// дошло: состояние звонка в БД всегда важнее любых уведомлений.
func (uc *guestUseCase) EndGuestsOfClosedCalls() {
	guests, err := uc.repo.EndGuestsOfClosedCalls(uc.now())
	if err != nil {
		slog.Error("guest.closed_call_sweep_failed", "error", err)
		return
	}
	if len(guests) > 0 {
		slog.Info("guest.call_ended", "guests", len(guests))
	}
	uc.endGuests(guests)
}

// SweepAbsentGuests releases a guest who is in neither the gateway nor the SFU
// for longer than GuestAbsenceGrace. An обрыв is not a leave: the grace window
// is what lets a guest reconnect without re-entering their name.
func (uc *guestUseCase) SweepAbsentGuests(present map[uuid.UUID]struct{}) {
	guests, err := uc.repo.ListAdmittedGuests()
	if err != nil {
		slog.Error("guest.absence_sweep_failed", "error", err)
		return
	}
	now := uc.now()

	var released []*domain.CallGuest
	uc.absentMu.Lock()
	seen := make(map[uuid.UUID]struct{}, len(guests))
	for _, g := range guests {
		seen[g.ID] = struct{}{}
		if _, here := present[g.ID]; here {
			delete(uc.absentSince, g.ID)
			continue
		}
		since, tracked := uc.absentSince[g.ID]
		if !tracked {
			uc.absentSince[g.ID] = now
			continue
		}
		if now.Sub(since) >= domain.GuestAbsenceGrace {
			delete(uc.absentSince, g.ID)
			released = append(released, g)
		}
	}
	// Гости, которых больше нет среди admitted, из памяти уходят тоже.
	for id := range uc.absentSince {
		if _, ok := seen[id]; !ok {
			delete(uc.absentSince, id)
		}
	}
	uc.absentMu.Unlock()

	var ended []*domain.CallGuest
	for _, g := range released {
		left, err := uc.repo.EndGuest(g.ID, domain.GuestStatusLeft, nil, false, now)
		if err != nil {
			if !errors.Is(err, domain.ErrGuestNotActive) && !errors.Is(err, domain.ErrGuestNotFound) {
				slog.Error("guest.absence_release_failed", "guest_id", g.ID, "error", err)
			}
			continue
		}
		slog.Info("guest.released_absent", "guest_id", g.ID, "channel_id", g.ChannelID)
		ended = append(ended, left)
	}
	uc.endGuests(ended)
	uc.notifyChannelsOf(ended)
}
