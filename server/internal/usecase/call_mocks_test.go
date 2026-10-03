package usecase_test

import (
	"errors"
	"sort"
	"sync"
	"time"

	"github.com/google/uuid"
	"github.com/vycord/server/internal/domain"
	"github.com/vycord/server/internal/usecase"
)

// memCallRepo — честная in-memory реализация CallRepository: тестам машины
// состояний важна семантика условных переходов, а не вызовы мока.
type memCallRepo struct {
	mu    sync.Mutex
	calls map[uuid.UUID]*domain.Call
	// failTransitions — сколько ближайших вызовов Transition вернут ошибку БД.
	failTransitions int
	// listGate — вызывается в начале ListLiveByUser вне r.mu (имитация медленной БД).
	listGate func(u uuid.UUID)
	// listErr — ошибка, которую вернёт ListLiveByUser.
	listErr error
	// existsCalls/existsErr — счётчик обращений Exists и подставная ошибка БД.
	existsCalls int
	existsErr   error
}

// failNextTransition — следующие n вызовов Transition завершатся ошибкой.
func (r *memCallRepo) failNextTransition(n int) {
	r.mu.Lock()
	r.failTransitions = n
	r.mu.Unlock()
}

func newMemCallRepo() *memCallRepo { return &memCallRepo{calls: map[uuid.UUID]*domain.Call{}} }

func (r *memCallRepo) Create(c *domain.Call) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	cp := *c
	r.calls[c.ID] = &cp
	return nil
}

func (r *memCallRepo) GetByID(id uuid.UUID) (*domain.Call, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	c, ok := r.calls[id]
	if !ok {
		return nil, domain.ErrCallNotFound
	}
	cp := *c
	return &cp, nil
}

func (r *memCallRepo) ListLiveByUser(u uuid.UUID) ([]*domain.Call, error) {
	r.mu.Lock()
	gate, lerr := r.listGate, r.listErr
	r.mu.Unlock()
	if gate != nil {
		gate(u)
	}
	if lerr != nil {
		return nil, lerr
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	var out []*domain.Call
	for _, c := range r.calls {
		if c.Has(u) && c.Status.Live() {
			cp := *c
			out = append(out, &cp)
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].StartedAt.After(out[j].StartedAt) })
	return out, nil
}

func (r *memCallRepo) Transition(id uuid.UUID, from []domain.CallStatus, to domain.CallStatus, at time.Time) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.failTransitions > 0 {
		r.failTransitions--
		return false, errors.New("db down")
	}
	c, ok := r.calls[id]
	if !ok {
		return false, nil
	}
	for _, s := range from {
		if c.Status == s {
			c.Status = to
			if to == domain.CallStatusActive {
				c.AcceptedAt = &at
			} else if !to.Live() {
				c.EndedAt = &at
			}
			return true, nil
		}
	}
	return false, nil
}

func (r *memCallRepo) CloseAllLive(at time.Time) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	var n int64
	for _, c := range r.calls {
		switch c.Status {
		case domain.CallStatusRinging:
			c.Status, c.EndedAt, n = domain.CallStatusMissed, &at, n+1
		case domain.CallStatusActive:
			c.Status, c.EndedAt, n = domain.CallStatusEnded, &at, n+1
		}
	}
	return n, nil
}

func (r *memCallRepo) Exists(id uuid.UUID) (bool, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.existsCalls++
	if r.existsErr != nil {
		return false, r.existsErr
	}
	_, ok := r.calls[id]
	return ok, nil
}

func (r *memCallRepo) status(id uuid.UUID) domain.CallStatus {
	c, _ := r.GetByID(id)
	return c.Status
}

type sentEvent struct {
	To      uuid.UUID
	Type    string
	Payload any
}

type recNotifier struct {
	mu     sync.Mutex
	events []sentEvent
}

func (n *recNotifier) Notify(to uuid.UUID, t string, p any) {
	n.mu.Lock()
	defer n.mu.Unlock()
	n.events = append(n.events, sentEvent{to, t, p})
}

// of — события типа t, адресованные to.
func (n *recNotifier) of(to uuid.UUID, t string) []sentEvent {
	n.mu.Lock()
	defer n.mu.Unlock()
	var out []sentEvent
	for _, e := range n.events {
		if e.To == to && e.Type == t {
			out = append(out, e)
		}
	}
	return out
}

func (n *recNotifier) reset() {
	n.mu.Lock()
	n.events = nil
	n.mu.Unlock()
}

type setPresence struct {
	mu     sync.Mutex
	online map[uuid.UUID]bool
}

func (p *setPresence) IsOnline(u uuid.UUID) bool {
	p.mu.Lock()
	defer p.mu.Unlock()
	return p.online[u]
}

func (p *setPresence) set(u uuid.UUID, on bool) {
	p.mu.Lock()
	p.online[u] = on
	p.mu.Unlock()
}

type denyList struct{ denied map[[2]uuid.UUID]error }

func (d denyList) CanDM(from, to uuid.UUID) error {
	if from == to {
		return domain.ErrSelfFriendship
	}
	return d.denied[[2]uuid.UUID{from, to}]
}

type usersByID struct{}

func (usersByID) GetByID(id uuid.UUID) (*domain.User, error) {
	return &domain.User{ID: id, Username: "u-" + id.String()[:4]}, nil
}

// fakeClock: AfterFunc копит таймеры, Advance срабатывает наступившие —
// вне собственной блокировки, потому что f берёт мьютекс usecase.
type fakeClock struct {
	mu     sync.Mutex
	now    time.Time
	timers []*fakeTimer
}

type fakeTimer struct {
	clock   *fakeClock // stopped/fired защищены clock.mu
	at      time.Time
	f       func()
	stopped bool
	fired   bool
}

func (t *fakeTimer) Stop() bool {
	t.clock.mu.Lock()
	defer t.clock.mu.Unlock()
	was := !t.stopped && !t.fired
	t.stopped = true
	return was
}

func newFakeClock() *fakeClock { return &fakeClock{now: time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC)} }

func (c *fakeClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *fakeClock) AfterFunc(d time.Duration, f func()) usecase.Stopper {
	c.mu.Lock()
	defer c.mu.Unlock()
	t := &fakeTimer{clock: c, at: c.now.Add(d), f: f}
	c.timers = append(c.timers, t)
	return t
}

func (c *fakeClock) Advance(d time.Duration) {
	c.mu.Lock()
	c.now = c.now.Add(d)
	var due []*fakeTimer
	for _, t := range c.timers {
		if !t.stopped && !t.fired && !t.at.After(c.now) {
			t.fired = true
			due = append(due, t)
		}
	}
	c.mu.Unlock()
	for _, t := range due {
		t.f()
	}
}

// immediateClock: таймер длительности only сразу запускает f в своей горутине —
// худший для гонок порядок, когда таймер срабатывает раньше, чем вызывающий
// сохранил Stopper. Остальные таймеры не срабатывают никогда.
type immediateClock struct {
	only time.Duration
	wg   sync.WaitGroup
}

type nopStopper struct{}

func (nopStopper) Stop() bool { return false }

func (c *immediateClock) Now() time.Time { return time.Date(2026, 10, 3, 12, 0, 0, 0, time.UTC) }

func (c *immediateClock) AfterFunc(d time.Duration, f func()) usecase.Stopper {
	if d != c.only {
		return nopStopper{}
	}
	c.wg.Add(1)
	go func() { defer c.wg.Done(); f() }()
	return nopStopper{}
}

type callEnv struct {
	uc       domain.CallUseCase
	repo     *memCallRepo
	notes    *recNotifier
	presence *setPresence
	clock    *fakeClock
	deny     denyList
}

func newCallEnv(online ...uuid.UUID) *callEnv {
	env := &callEnv{
		repo:     newMemCallRepo(),
		notes:    &recNotifier{},
		presence: &setPresence{online: map[uuid.UUID]bool{}},
		clock:    newFakeClock(),
		deny:     denyList{denied: map[[2]uuid.UUID]error{}},
	}
	for _, u := range online {
		env.presence.set(u, true)
	}
	env.uc = usecase.NewCallUseCase(usecase.CallDeps{
		Repo: env.repo, Notifier: env.notes, Presence: env.presence,
		Permission: env.deny, Users: usersByID{}, Clock: env.clock, JWTSecret: "test-secret",
	})
	return env
}

func endReason(e sentEvent) domain.CallEndReason {
	return e.Payload.(map[string]any)["reason"].(domain.CallEndReason)
}
