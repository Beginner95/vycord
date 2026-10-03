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

const (
	// CallRingTimeout — сколько звонит вызов до missed (спека, решение 6).
	CallRingTimeout = 45 * time.Second
	// CallDisconnectGrace — сколько активный звонок ждёт участника, у которого
	// оборвался WS с API (спека, раздел 1).
	CallDisconnectGrace = 20 * time.Second
	// CallRingRetryDelay — через сколько повторить таймаут дозвона, если переход
	// в БД не удался (иначе звонок завис бы в ringing до рестарта).
	CallRingRetryDelay = 5 * time.Second
	callRoomTokenTTL   = 60 * time.Second
)

type CallDeps struct {
	Repo       domain.CallRepository
	Notifier   domain.CallNotifier
	Presence   domain.DirectCallPresence
	Permission domain.CallPermission
	Users      domain.CallUserLookup
	Clock      Clock
	JWTSecret  string
}

// callUseCase — машина состояний звонка 1:1. Все публичные методы и
// срабатывания таймеров идут под одним mu: API — один процесс, звонков мало,
// а сериализация снимает целый класс гонок (встречные вызовы, accept против
// таймаута). Условные переходы в БД — вторая линия обороны.
type callUseCase struct {
	d  CallDeps
	mu sync.Mutex

	ringTimers  map[uuid.UUID]Stopper     // call_id → таймер дозвона
	graceTimers map[uuid.UUID]*graceTimer // user_id → grace обрыва
	knownRooms  map[uuid.UUID]bool        // room_id → комната звонка или нет (кэш IsCallRoom)
}

// graceTimer — запись grace-таймера. Замыкание таймера захватывает указатель,
// созданный ДО AfterFunc, а не переменную со Stopper: таймер может сработать
// раньше, чем OnDisconnect её присвоит. Поле t пишется и читается под uc.mu.
type graceTimer struct{ t Stopper }

func NewCallUseCase(d CallDeps) domain.CallUseCase {
	if d.Clock == nil {
		d.Clock = RealClock()
	}
	return &callUseCase{
		d:           d,
		ringTimers:  map[uuid.UUID]Stopper{},
		graceTimers: map[uuid.UUID]*graceTimer{},
		knownRooms:  map[uuid.UUID]bool{},
	}
}

func (uc *callUseCase) Start(callerID, receiverID uuid.UUID) (*domain.Call, error) {
	uc.mu.Lock()
	defer uc.mu.Unlock()

	if err := uc.d.Permission.CanDM(callerID, receiverID); err != nil {
		return nil, err
	}
	if !uc.d.Presence.IsOnline(receiverID) {
		return nil, domain.ErrCallPeerOffline
	}

	callerLive, err := uc.d.Repo.ListLiveByUser(callerID)
	if err != nil {
		return nil, err
	}
	for _, c := range callerLive {
		if !c.Has(receiverID) {
			continue
		}
		if c.Status == domain.CallStatusRinging && c.ReceiverID == callerID {
			// Встречный вызов: B звонит A, пока A звонит B — это согласие.
			if err := uc.acceptLocked(callerID, c); err != nil {
				return nil, err
			}
			return c, nil
		}
		// Повторное «Позвонить» тому же — тот же звонок. Звонящему переотправляем
		// текущее событие: клиент мог потерять call_id (или нажать «Позвонить» в
		// уже идущем звонке) и иначе завис бы в «Звоним…» без call_id.
		if err := uc.resendCurrentLocked(callerID, c); err != nil {
			return nil, err
		}
		return c, nil
	}

	receiverLive, err := uc.d.Repo.ListLiveByUser(receiverID)
	if err != nil {
		return nil, err
	}
	for _, c := range receiverLive {
		if c.Status == domain.CallStatusRinging {
			return nil, domain.ErrCallBusy
		}
	}

	call := &domain.Call{
		ID:         uuid.New(),
		CallerID:   callerID,
		ReceiverID: receiverID,
		Status:     domain.CallStatusRinging,
		StartedAt:  uc.d.Clock.Now(),
	}
	// Снимок — до любых побочных эффектов: сбой lookup не оставляет сироту-звонок.
	snap, err := uc.snapshot(call)
	if err != nil {
		return nil, err
	}

	// «Позвонить» выводит звонящего из его текущих звонков (решение 5).
	for _, c := range callerLive {
		if err := uc.finishLocked(c, callerID, domain.CallEndEnded); err != nil {
			return nil, err
		}
	}
	if err := uc.d.Repo.Create(call); err != nil {
		return nil, err
	}
	uc.knownRooms[call.ID] = true
	uc.armRing(call.ID, CallRingTimeout)
	uc.d.Notifier.Notify(callerID, "call_ringing", *snap)
	uc.d.Notifier.Notify(receiverID, "call_ringing", *snap)
	return call, nil
}

func (uc *callUseCase) Accept(userID, callID uuid.UUID) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if call.ReceiverID != userID {
		return domain.ErrCallNotFound
	}
	return uc.acceptLocked(userID, call)
}

// resendCurrentLocked шлёт to событие, соответствующее текущему статусу живого
// звонка: снимок call_ringing при дозвоне, call_accepted при активном.
func (uc *callUseCase) resendCurrentLocked(to uuid.UUID, call *domain.Call) error {
	if call.Status == domain.CallStatusActive {
		uc.d.Notifier.Notify(to, "call_accepted", map[string]any{"call_id": call.ID.String()})
		return nil
	}
	snap, err := uc.snapshot(call)
	if err != nil {
		return err
	}
	uc.d.Notifier.Notify(to, "call_ringing", *snap)
	return nil
}

func (uc *callUseCase) acceptLocked(receiverID uuid.UUID, call *domain.Call) error {
	if call.Status != domain.CallStatusRinging {
		return domain.ErrCallInvalidState
	}
	// «Принять» выводит получателя из его текущих звонков (решение 5).
	live, err := uc.d.Repo.ListLiveByUser(receiverID)
	if err != nil {
		return err
	}
	for _, c := range live {
		if c.ID != call.ID {
			if err := uc.finishLocked(c, receiverID, domain.CallEndEnded); err != nil {
				return err
			}
		}
	}
	ok, err := uc.d.Repo.Transition(call.ID, []domain.CallStatus{domain.CallStatusRinging}, domain.CallStatusActive, uc.d.Clock.Now())
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrCallInvalidState
	}
	uc.stopRing(call.ID)
	call.Status = domain.CallStatusActive
	payload := map[string]any{"call_id": call.ID.String()}
	uc.d.Notifier.Notify(call.CallerID, "call_accepted", payload)
	uc.d.Notifier.Notify(call.ReceiverID, "call_accepted", payload)
	return nil
}

func (uc *callUseCase) Reject(userID, callID uuid.UUID) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if call.ReceiverID != userID {
		return domain.ErrCallNotFound
	}
	if call.Status != domain.CallStatusRinging {
		return domain.ErrCallInvalidState
	}
	return uc.finishLocked(call, userID, domain.CallEndRejected)
}

func (uc *callUseCase) End(userID, callID uuid.UUID, reason domain.CallEndReason) error {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return err
	}
	if !call.Status.Live() {
		return domain.ErrCallInvalidState
	}
	if reason != domain.CallEndFailed {
		reason = domain.CallEndEnded // клиент не вправе прислать серверную причину
	}
	return uc.finishLocked(call, userID, reason)
}

// finishLocked завершает живой звонок от имени actor. Статус и причина
// выводятся из текущего статуса и стороны actor (см. план, Task 2).
func (uc *callUseCase) finishLocked(call *domain.Call, actor uuid.UUID, reason domain.CallEndReason) error {
	var to domain.CallStatus
	switch {
	case call.Status == domain.CallStatusRinging && actor == call.ReceiverID:
		to, reason = domain.CallStatusRejected, domain.CallEndRejected
	case call.Status == domain.CallStatusRinging:
		to = domain.CallStatusMissed
		if reason != domain.CallEndTimeout {
			reason = domain.CallEndMissed
		}
	default:
		to = domain.CallStatusEnded
	}
	ok, err := uc.d.Repo.Transition(call.ID, []domain.CallStatus{call.Status}, to, uc.d.Clock.Now())
	if err != nil {
		return err
	}
	if !ok {
		return domain.ErrCallInvalidState
	}
	uc.stopRing(call.ID)
	payload := map[string]any{"call_id": call.ID.String(), "reason": reason}
	uc.d.Notifier.Notify(call.CallerID, "call_ended", payload)
	uc.d.Notifier.Notify(call.ReceiverID, "call_ended", payload)
	return nil
}

// ownCall — звонок, в котором userID участник; чужой неотличим от несуществующего.
func (uc *callUseCase) ownCall(userID, callID uuid.UUID) (*domain.Call, error) {
	call, err := uc.d.Repo.GetByID(callID)
	if err != nil {
		return nil, err
	}
	if !call.Has(userID) {
		return nil, domain.ErrCallNotFound
	}
	return call, nil
}

func (uc *callUseCase) stopRing(callID uuid.UUID) {
	if t, ok := uc.ringTimers[callID]; ok {
		t.Stop()
		delete(uc.ringTimers, callID)
	}
}

// armRing взводит таймер дозвона; вызывается под uc.mu.
func (uc *callUseCase) armRing(callID uuid.UUID, d time.Duration) {
	uc.ringTimers[callID] = uc.d.Clock.AfterFunc(d, func() { uc.onRingTimeout(callID) })
}

func (uc *callUseCase) onRingTimeout(callID uuid.UUID) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	delete(uc.ringTimers, callID)
	call, err := uc.d.Repo.GetByID(callID)
	if err != nil {
		if !errors.Is(err, domain.ErrCallNotFound) {
			slog.Error("call: ring timeout: get call failed, retrying", "call_id", callID, "error", err)
			uc.armRing(callID, CallRingRetryDelay)
		}
		return
	}
	if call.Status != domain.CallStatusRinging {
		return // уже приняли/отклонили/отменили — таймер опоздал
	}
	if err := uc.finishLocked(call, call.CallerID, domain.CallEndTimeout); err != nil {
		if errors.Is(err, domain.ErrCallInvalidState) {
			return // переход выиграл кто-то другой
		}
		// Иначе звонок навсегда останется ringing и заблокирует обе стороны (busy).
		slog.Error("call: ring timeout: finish failed, retrying", "call_id", callID, "error", err)
		uc.armRing(callID, CallRingRetryDelay)
	}
}

func (uc *callUseCase) snapshot(call *domain.Call) (*domain.CallSnapshot, error) {
	caller, err := uc.party(call.CallerID)
	if err != nil {
		return nil, err
	}
	receiver, err := uc.party(call.ReceiverID)
	if err != nil {
		return nil, err
	}
	return &domain.CallSnapshot{CallID: call.ID, Status: call.Status, Caller: caller, Receiver: receiver}, nil
}

func (uc *callUseCase) party(id uuid.UUID) (domain.CallParty, error) {
	u, err := uc.d.Users.GetByID(id)
	if err != nil {
		return domain.CallParty{}, fmt.Errorf("call party %s: %w", id, err)
	}
	return domain.CallParty{ID: u.ID, Username: u.Username, AvatarURL: u.AvatarURL}, nil
}

// OnConnect вызывается на каждое WS-подключение. Под общим mu — только снятие
// grace-таймера; чтение БД и сборка снимка идут без блокировки, иначе при
// медленной БД шторм реконнектов выстраивался бы в очередь N×таймаут и
// останавливал все звонки. Снимок — подсказка клиенту: событие, гонящееся с
// ним, придёт следом и будет применено поверх.
func (uc *callUseCase) OnConnect(userID uuid.UUID) *domain.CallSnapshot {
	uc.mu.Lock()
	if g, ok := uc.graceTimers[userID]; ok {
		g.t.Stop()
		delete(uc.graceTimers, userID)
	}
	uc.mu.Unlock()

	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil {
		slog.Error("call: on connect list failed", "user_id", userID, "error", err)
		return nil
	}
	if len(live) == 0 {
		return nil
	}
	pick := live[0]
	for _, c := range live {
		if c.Status == domain.CallStatusActive {
			pick = c
			break
		}
	}
	snap, err := uc.snapshot(pick)
	if err != nil {
		slog.Error("call: on connect snapshot failed", "call_id", pick.ID, "error", err)
		return nil
	}
	return snap
}

func (uc *callUseCase) OnDisconnect(userID uuid.UUID) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil {
		slog.Error("call: on disconnect list failed", "user_id", userID, "error", err)
		return
	}
	hasActive := false
	for _, c := range live {
		if c.Status == domain.CallStatusRinging {
			// Обрыв во время дозвона — пропущенный, а не отказ: актор — звонящий.
			if err := uc.finishLocked(c, c.CallerID, domain.CallEndMissed); err != nil {
				slog.Error("call: finish ringing on disconnect failed", "call_id", c.ID, "error", err)
			}
			continue
		}
		hasActive = true
	}
	if !hasActive {
		return
	}
	if g, ok := uc.graceTimers[userID]; ok {
		g.t.Stop()
	}
	g := &graceTimer{}
	g.t = uc.d.Clock.AfterFunc(CallDisconnectGrace, func() { uc.onGraceExpired(userID, g) })
	uc.graceTimers[userID] = g
}

func (uc *callUseCase) onGraceExpired(userID uuid.UUID, g *graceTimer) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	if uc.graceTimers[userID] != g {
		return // реконнект снял или новый обрыв заменил этот таймер
	}
	delete(uc.graceTimers, userID)
	if uc.d.Presence.IsOnline(userID) {
		return
	}
	live, err := uc.d.Repo.ListLiveByUser(userID)
	if err != nil {
		slog.Error("call: grace list failed", "user_id", userID, "error", err)
		return
	}
	for _, c := range live {
		if c.Status != domain.CallStatusActive {
			continue
		}
		if err := uc.finishLocked(c, userID, domain.CallEndEnded); err != nil {
			slog.Error("call: finish active after grace failed", "call_id", c.ID, "error", err)
		}
	}
}

func (uc *callUseCase) IssueRoomToken(userID, callID uuid.UUID) (string, error) {
	uc.mu.Lock()
	defer uc.mu.Unlock()
	call, err := uc.ownCall(userID, callID)
	if err != nil {
		return "", err
	}
	if call.Status != domain.CallStatusActive {
		return "", domain.ErrCallInvalidState
	}
	return authtoken.GenerateRoomToken(uc.d.JWTSecret, userID, callID, callRoomTokenTTL)
}

func (uc *callUseCase) IsCallRoom(roomID uuid.UUID) bool {
	uc.mu.Lock()
	isCall, known := uc.knownRooms[roomID]
	uc.mu.Unlock()
	if known {
		return isCall
	}
	ok, err := uc.d.Repo.Exists(roomID)
	if err != nil {
		// Ошибка БД — «не звонок» и без кэша: худший исход — комната на тик
		// попадёт в presence как канал, аудитория которого не резолвится (fail-closed).
		slog.Error("call: is call room check failed", "room_id", roomID, "error", err)
		return false
	}
	// Кэшируем и «нет»: id канала никогда не станет id звонка, а строка звонка
	// создаётся (и попадает в кэш в Start) раньше, чем выдаётся любой токен в
	// его комнату, так что комната звонка не может быть увидена до своей строки.
	uc.mu.Lock()
	uc.knownRooms[roomID] = ok
	uc.mu.Unlock()
	return ok
}

func (uc *callUseCase) RecoverOnStartup() error {
	n, err := uc.d.Repo.CloseAllLive(uc.d.Clock.Now())
	if err != nil {
		return err
	}
	if n > 0 {
		slog.Info("call: closed live calls left over from previous run", "count", n)
	}
	return nil
}
