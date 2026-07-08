# VYC-24: Авто-переподключение группового звонка — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Участник, у которого посреди группового звонка сменилась сеть (VPN, wifi→LTE, рестарт SFU), автоматически возвращается в звонок за секунды с сохранением мьюта и демонстрации экрана.

**Architecture:** Клиентский auto-rejoin: детекция обрыва (pc failed / pc disconnected>3с / ws.onclose), частичный teardown (PC+WS умирают, локальные медиатреки живут), цикл ретраев с backoff ~30с через общий `connect()`. На сервере — единственное изменение: `RoomSession.Join` вытесняет stale-сессию того же `user_id`. Спека: `docs/superpowers/specs/2026-07-08-vyc24-call-reconnect-design.md`.

**Tech Stack:** Go + pion/webrtc v4 (SFU), TypeScript + React (клиент), gorilla/websocket (сигналинг).

## Global Constraints

- Ветка: `VYC-24-reconnect` от `main` (создаётся после мержа `VYC-23-coturn`).
- **Коммиты и пуши выполняет пользователь.** На каждом шаге «Commit» — остановиться, показать diff-сводку и предложенное сообщение коммита, дождаться пользователя.
- Сообщения коммитов: префикс `VYC-24`, на русском (стиль истории репо).
- Клиентских unit-тестов в проекте нет (только `test:e2e` bash) — клиентские таски верифицируются `npx tsc --noEmit` + ручным прогоном (Task 5). Не заводить новую тест-инфраструктуру.
- Go-тест — первый в пакете `application`; никаких новых зависимостей (стандартный `testing`, без testify).

---

### Task 1: Сервер — вытеснение stale-сессии в `RoomSession.Join`

При реконнекте старый WS того же пользователя висит полуоткрытым до `disconnectedTimeout` (30с), и в комнате оказывается «призрак»: его треки форвардятся, остальные видят дубль. `Join` должен вытеснять существующую сессию с тем же `UserID`.

**Files:**
- Create: `server/internal/sfu/application/room_session_test.go`
- Modify: `server/internal/sfu/application/room_session.go:38-45` (начало `Join`)

**Interfaces:**
- Consumes: `RoomSession.Join/Leave`, `domain.NewParticipant(id, userID, roomID)`, `domain.NewRoom(id, onEvent)`, `sfuwebrtc.NewPeerFactory(iceURLs, publicIP)`, интерфейс `SignalingSession` (`interfaces.go`).
- Produces: поведение `Join` — при входе участника с `UserID`, уже присутствующим в комнате, старая сессия закрывается (`Done()` закрыт), остальным уходит `participant_left`. Клиентские таски на это опираются.

- [ ] **Step 1: Написать падающий тест**

Создать `server/internal/sfu/application/room_session_test.go`:

```go
package application

import (
	"context"
	"io"
	"log/slog"
	"sync"
	"testing"
	"time"

	"github.com/pion/webrtc/v4"

	"github.com/vycord/server/internal/sfu/domain"
	sfuwebrtc "github.com/vycord/server/internal/sfu/infrastructure/webrtc"
)

// fakeSignalingSession records Notify events; offers/candidates are discarded.
type fakeSignalingSession struct {
	mu     sync.Mutex
	events []string
}

func (f *fakeSignalingSession) SendOffer(webrtc.SessionDescription) error       { return nil }
func (f *fakeSignalingSession) SendICECandidate(*webrtc.ICECandidateInit) error { return nil }
func (f *fakeSignalingSession) Context() context.Context                        { return context.Background() }

func (f *fakeSignalingSession) Notify(eventType string, _ any) error {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.events = append(f.events, eventType)
	return nil
}

func (f *fakeSignalingSession) received(eventType string) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, e := range f.events {
		if e == eventType {
			return true
		}
	}
	return false
}

func TestJoinEvictsStaleSessionOfSameUser(t *testing.T) {
	log := slog.New(slog.NewTextHandler(io.Discard, nil))
	pf, err := sfuwebrtc.NewPeerFactory(nil, "")
	if err != nil {
		t.Fatalf("NewPeerFactory: %v", err)
	}
	room := domain.NewRoom("room1", func(domain.Event) {})
	rs := NewRoomSession(room, pf, log)

	// Alice joins, then "loses network": her session stays in the room.
	psOld, err := rs.Join(domain.NewParticipant("p1", "alice", "room1"), &fakeSignalingSession{})
	if err != nil {
		t.Fatalf("first alice join: %v", err)
	}

	bobSig := &fakeSignalingSession{}
	if _, err := rs.Join(domain.NewParticipant("p2", "bob", "room1"), bobSig); err != nil {
		t.Fatalf("bob join: %v", err)
	}

	// Alice reconnects with a new participant ID before the old session timed out.
	if _, err := rs.Join(domain.NewParticipant("p3", "alice", "room1"), &fakeSignalingSession{}); err != nil {
		t.Fatalf("alice rejoin: %v", err)
	}

	select {
	case <-psOld.Done():
	case <-time.After(2 * time.Second):
		t.Fatal("stale alice session was not closed on rejoin")
	}

	if got := rs.participantCount(); got != 2 {
		t.Fatalf("participant count = %d, want 2 (bob + new alice)", got)
	}
	if !bobSig.received("participant_left") {
		t.Fatal("bob was not notified that stale alice session left")
	}
}
```

Примечание: если `NewPeerFactory(nil, "")` вернёт ошибку на пустых URL — передать `[]string{}` (сигнатура: `NewPeerFactory(iceURLs []string, publicIP string)`).

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd /www/my/vycord/server && go test ./internal/sfu/application/ -run TestJoinEvictsStaleSessionOfSameUser -v`
Expected: FAIL — `stale alice session was not closed on rejoin` (после ~2с таймаута), т.к. вытеснения ещё нет.

- [ ] **Step 3: Реализовать вытеснение**

В `room_session.go`, в самое начало `Join` (до `rs.peerFactory.NewPeerConnection()`):

```go
	// A reconnecting user may still have a stale session here: after a network
	// change the old WS hangs half-open until disconnectedTimeout, its tracks
	// keep being forwarded and other participants see a duplicate. Evict it
	// before adding the new session.
	rs.mu.RLock()
	staleID := ""
	for id, s := range rs.sessions {
		if s.Participant.UserID == participant.UserID {
			staleID = id
			break
		}
	}
	rs.mu.RUnlock()
	if staleID != "" {
		rs.log.Info("evicting stale session for reconnecting user",
			"room_id", rs.room.ID,
			"user_id", participant.UserID,
			"stale_participant_id", staleID,
		)
		rs.Leave(staleID)
	}
```

`Leave` берёт собственный lock — вызывать строго вне `rs.mu`. Существующий `Leave` уже снимает форвардящиеся треки у подписчиков и рассылает `participant_left`; `watchSession` старой сессии после `Close()` вызовет `rs.Leave` повторно — это no-op (сессии уже нет в map).

- [ ] **Step 4: Убедиться, что тест проходит и ничего не сломано**

Run: `cd /www/my/vycord/server && go test ./internal/sfu/application/ -run TestJoinEvictsStaleSessionOfSameUser -v`
Expected: PASS

Run: `cd /www/my/vycord/server && go build ./... && go test ./...`
Expected: сборка ок, все тесты PASS.

- [ ] **Step 5: Commit (пользователь)**

Показать diff, предложить: `VYC-24 SFU: вытеснение stale-сессии того же user_id при повторном Join`

---

### Task 2: Клиент — флаг `intentionalLeave` и выделение `connect()`

Чистый рефакторинг без изменения поведения: подготовка точки входа для reconnect.

**Files:**
- Modify: `client/src/services/groupCall.ts` (`joinGroupCall` ~151-214, `leaveGroupCall` ~216-222, `teardown` ~1090)

**Interfaces:**
- Produces: `private async connect(roomId, userId): Promise<boolean>` — получение свежих ICE-серверов + `connectSignaling`; поле `private intentionalLeave: boolean`. Task 3 использует оба.

- [ ] **Step 1: Добавить поле и выделить `connect()`**

В блок полей класса `GroupCallService` (рядом с `private inCall = false;`):

```ts
  // True once the user asked to leave — suppresses auto-reconnect (Task 3).
  private intentionalLeave = false;
```

Новый приватный метод (перед `connectSignaling`):

```ts
  // Establishes signaling and (via the server's offer) a new PC. Shared by the
  // initial join and reconnect. Fetches ICE servers every time: TURN entries
  // carry ephemeral credentials that may have expired during a network outage.
  private async connect(roomId: string, userId: string): Promise<boolean> {
    this.iceServers = await getIceServers();
    gcLog(userId, 'ICE servers', {
      urls: this.iceServers.flatMap((s) => s.urls),
      hasTurn: this.iceServers.some((s) => String(s.urls).startsWith('turn')),
    });
    return this.connectSignaling(roomId, userId);
  }
```

В `joinGroupCall`: после guard'а `if (this.inCall) {...}` добавить `this.intentionalLeave = false;`; удалить блок получения `getIceServers` + его `gcLog` (строки «Fetch STUN+TURN config before signaling…» — комментарий перенести к `connect()`); последнюю строку заменить на `return this.connect(roomId, userId);`.

В `leaveGroupCall`: первой строкой `this.intentionalLeave = true;`.

- [ ] **Step 2: Typecheck**

Run: `cd /www/my/vycord/client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 3: Commit (пользователь)**

Предложить: `VYC-24 клиент: intentionalLeave + выделение connect() под реконнект`

---

### Task 3: Клиент — механизм reconnect

Ядро фичи: детекция обрыва, частичный teardown, цикл ретраев, восстановление демонстрации экрана.

**Files:**
- Modify: `client/src/services/groupCall.ts`:
  - интерфейс `GroupCallCallbacks` (~97-105)
  - поля класса (~113-143)
  - `leaveGroupCall`, `teardown`
  - `connectSignaling` → `ws.onclose` / `ws.onerror` (~535-548)
  - `createPeerConnection` → `pc.onconnectionstatechange` (~802-806)
  - `handleMessage` case `'error'` (~940)
  - `handleOffer` — хвост после отправки answer (~1059-1064)
  - новые методы: `reconnect`, `partialTeardown`, `restoreScreenShare`, `applyScreenRestore`

**Interfaces:**
- Consumes: `connect()`, `intentionalLeave` из Task 2; серверное вытеснение из Task 1.
- Produces: опциональные колбэки `onReconnecting?: () => void` и `onReconnected?: () => void` в `GroupCallCallbacks` — их использует Task 4.

- [ ] **Step 1: Колбэки и поля**

В `GroupCallCallbacks` после `onScreenShareEnded`:

```ts
  // Fired when the call dropped due to a network change and auto-reconnect started.
  onReconnecting?: () => void;
  // Fired when auto-reconnect restored the call.
  onReconnected?: () => void;
```

Поля класса (рядом с `intentionalLeave`):

```ts
  // True while the reconnect loop owns the WS/PC lifecycle — suppresses
  // onclose/onerror side effects from failed attempts.
  private reconnecting = false;
  // Started when the PC goes 'disconnected'; fires reconnect if it doesn't
  // recover — the browser can sit in 'disconnected' for tens of seconds
  // before 'failed' while the WS hangs half-open (VPN case).
  private disconnectedTimer: ReturnType<typeof setTimeout> | null = null;
  // Screen track waiting to be re-attached to the new PC after reconnect.
  private pendingScreenRestore: MediaStreamTrack | null = null;
```

- [ ] **Step 2: Методы reconnect / partialTeardown / restoreScreenShare / applyScreenRestore**

Добавить после `leaveGroupCall`:

```ts
  // ── Auto-reconnect ─────────────────────────────────────────────────────────

  private async reconnect(trigger: string): Promise<void> {
    if (this.reconnecting || this.intentionalLeave || !this.inCall) return;
    this.reconnecting = true;
    gcLog(this.currentUserId, 'reconnect: started', { trigger });
    this.callbacks?.onReconnecting?.();

    // A live local screen track survives a network change — remember it to
    // re-attach to the new PC. Mic/camera mute needs no snapshot: localStream
    // tracks are reused as-is, their .enabled flags persist.
    const screenTrack = this._isScreenSharing
      ? this.screenStream?.getVideoTracks()[0] ?? null
      : null;

    this.partialTeardown();

    // ~30s total.
    const delaysMs = [500, 1000, 2000, 4000, 8000, 8000, 8000];
    for (const [attempt, delay] of delaysMs.entries()) {
      await new Promise((r) => setTimeout(r, delay));
      if (this.intentionalLeave) {
        this.reconnecting = false;
        return;
      }
      gcLog(this.currentUserId, 'reconnect: attempt', { attempt: attempt + 1, delay });
      try {
        await this.connect(this.currentRoomId, this.currentUserId);
      } catch (err) {
        gcLog(this.currentUserId, 'reconnect: attempt failed', { error: String(err) });
      }
      // connectSignaling's boolean means "alone in room", not success —
      // success is inCall (set on 'joined') plus an open WS.
      if (this.inCall && this.ws?.readyState === WebSocket.OPEN) {
        this.restoreScreenShare(screenTrack);
        this.reconnecting = false;
        gcLog(this.currentUserId, 'reconnect: succeeded', { attempt: attempt + 1 });
        this.callbacks?.onReconnected?.();
        return;
      }
    }

    this.reconnecting = false;
    gcLog(this.currentUserId, 'reconnect: gave up');
    this.teardown();
    this.callbacks?.onCallEnded();
  }

  // Transport-only teardown for reconnect: closes PC/WS and clears remote
  // state, but keeps local capture (mic/camera/screen tracks, AudioContext,
  // noise cancellation) alive so rejoin doesn't re-prompt or rebuild audio.
  private partialTeardown(): void {
    if (this.ws) {
      // Detach handlers first — ws.close() must not trigger onclose teardown.
      this.ws.onclose = null;
      this.ws.onerror = null;
      this.ws.onmessage = null;
      this.ws.close();
      this.ws = null;
    }
    if (this.disconnectedTimer !== null) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
    this.pc?.close();
    this.pc = null;
    // The new PC creates its own dummy track in createPeerConnection.
    this.dummyVideoTrack?.stop();
    this.dummyVideoTrack = null;
    this.screenSender = null; // belonged to the old PC
    this.remoteStreams.clear();
    this.pendingCandidates = [];
    this.inCall = false;
  }

  private restoreScreenShare(screenTrack: MediaStreamTrack | null): void {
    if (!screenTrack) return;
    if (screenTrack.readyState !== 'live') {
      // The OS capture died during the outage — drop share state honestly.
      gcLog(this.currentUserId, 'reconnect: screen track dead, stopping share');
      this._isScreenSharing = false;
      this.screenStream?.getTracks().forEach((t) => t.stop());
      this.screenStream = null;
      this.callbacks?.onScreenShareEnded?.();
      return;
    }
    this.pendingScreenRestore = screenTrack;
    // The PC may already exist: the server's offer often precedes 'joined'.
    this.applyScreenRestore();
  }

  // Re-attaches the pending screen track to the new PC's video sender. Also
  // called after each answer in handleOffer: if 'joined' resolved before the
  // first offer, the PC doesn't exist yet when restoreScreenShare runs.
  private applyScreenRestore(): void {
    const track = this.pendingScreenRestore;
    if (!track || !this.pc) return;
    const videoTransceiver = this.pc.getTransceivers().find(
      (t) => t.receiver.track.kind === 'video',
    );
    if (!videoTransceiver) return; // a later offer will bring the m-line
    this.pendingScreenRestore = null;
    if (videoTransceiver.direction === 'recvonly') {
      videoTransceiver.direction = 'sendrecv';
    }
    videoTransceiver.sender.replaceTrack(track).then(() => {
      this.screenSender = videoTransceiver.sender;
      // Same reasoning as startScreenShare: replaceTrack doesn't renegotiate,
      // the SFU needs an explicit keyframe push.
      this.requestKeyframeWithRetry();
      gcLog(this.currentUserId, 'reconnect: screen share restored');
    }).catch((err) => {
      gcLog(this.currentUserId, 'reconnect: screen restore failed', { error: String(err) });
    });
  }
```

- [ ] **Step 3: Подключить триггеры**

`ws.onclose` в `connectSignaling` — заменить тело на:

```ts
      this.ws!.onclose = (ev) => {
        gcLog(userId, 'WS closed', { code: ev.code, reason: ev.reason });
        settle(false);
        if (this.reconnecting) return; // reconnect loop owns the lifecycle
        if (this.inCall && !this.intentionalLeave) {
          void this.reconnect('ws_closed');
          return;
        }
        this.inCall = false;
        this.callbacks?.onCallEnded();
        this.teardown();
      };
```

`ws.onerror` — не дёргать `onError` во время ретраев:

```ts
      this.ws!.onerror = () => {
        gcLog(userId, 'WS ERROR');
        settle(false);
        if (!this.reconnecting) this.callbacks?.onError('SFU connection failed');
      };
```

`pc.onconnectionstatechange` в `createPeerConnection` — блок `failed` заменить (убрать `onError('WebRTC connection failed')` — реконнект вместо фатальной ошибки; UI-обработчик `onError` делает полный выход и убил бы ретраи), добавить обработку `disconnected`, в начало блока `connected` добавить сброс таймера:

```ts
    pc.onconnectionstatechange = () => {
      gcLog(this.currentUserId, 'PC connectionState', { state: pc.connectionState });
      if (pc.connectionState === 'failed') {
        void this.reconnect('pc_failed');
      }
      if (pc.connectionState === 'disconnected' && this.disconnectedTimer === null) {
        this.disconnectedTimer = setTimeout(() => {
          this.disconnectedTimer = null;
          if (this.pc && this.pc.connectionState !== 'connected') {
            void this.reconnect('pc_disconnected_3s');
          }
        }, 3000);
      }
      if (pc.connectionState === 'connected') {
        if (this.disconnectedTimer !== null) {
          clearTimeout(this.disconnectedTimer);
          this.disconnectedTimer = null;
        }
        // ... существующий блок connected без изменений ...
      }
    };
```

`handleMessage`, case `'error'` — не давать серверной ошибке неудачной попытки убить ретраи через UI-обработчик:

```ts
      case 'error':
        if (!this.reconnecting) {
          this.callbacks?.onError((msg.payload as ErrorPayload).message);
        }
        break;
```

`handleOffer` — после блока `if (this.ws?.readyState === WebSocket.OPEN) { ...answer... }` добавить строку:

```ts
    this.applyScreenRestore();
```

`teardown` — добавить перед `this.ws = null;`:

```ts
    if (this.disconnectedTimer !== null) {
      clearTimeout(this.disconnectedTimer);
      this.disconnectedTimer = null;
    }
    this.pendingScreenRestore = null;
```

- [ ] **Step 4: Typecheck**

Run: `cd /www/my/vycord/client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 5: Commit (пользователь)**

Предложить: `VYC-24 клиент: авто-реконнект звонка (детекция обрыва, retry с backoff, восстановление демки)`

---

### Task 4: UI — баннер «Переподключение…»

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx` (~181-268: state + `groupCallService.init`; ~541: разметка оверлея)
- Modify: `client/src/components/GroupCallUI.css`

**Interfaces:**
- Consumes: `onReconnecting` / `onReconnected` из Task 3.

- [ ] **Step 1: State и колбэки**

Рядом с `const [isInGroupCall, ...]`:

```tsx
  const [isReconnecting, setIsReconnecting] = useState(false);
```

В объект `groupCallService.init({...})` добавить:

```tsx
      onReconnecting: () => {
        setIsReconnecting(true);
        // Participants are re-announced via 'joined'/onPeerJoined after
        // rejoin; clear now so users who left during the outage don't linger.
        setParticipants([]);
        setScreenSharers(new Set());
        setFocusedUserId(null);
      },
      onReconnected: () => {
        setIsReconnecting(false);
      },
```

В существующие `onCallEnded` и `onError` добавить `setIsReconnecting(false);` (первой строкой).

- [ ] **Step 2: Баннер и стили**

Сразу после открывающего `<div className="group-call-overlay">` (~строка 541):

```tsx
      {isReconnecting && (
        <div className="gc-reconnecting-banner">Переподключение…</div>
      )}
```

В `GroupCallUI.css`:

```css
.gc-reconnecting-banner {
  position: absolute;
  top: 12px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 30;
  padding: 8px 16px;
  border-radius: 8px;
  background: rgba(230, 160, 30, 0.92);
  color: #1a1a1a;
  font-weight: 600;
}
```

(Кнопка «выйти» остаётся активной: `leaveGroupCall` ставит `intentionalLeave`, цикл ретраев прервётся сам — отдельного кода в UI не нужно.)

- [ ] **Step 3: Полная сборка клиента**

Run: `cd /www/my/vycord/client && npm run build`
Expected: сборка без ошибок.

- [ ] **Step 4: Commit (пользователь)**

Предложить: `VYC-24 UI: баннер «Переподключение…» и сброс участников на время реконнекта`

---

### Task 5: Ручная верификация (чеклист из спеки)

**Files:** нет изменений кода; при находках — фиксы отдельными шагами.

- [ ] **Step 1: Поднять окружение**

Run: `cd /www/my/vycord && docker compose up -d`, затем `cd client && npm run dev`. Два участника: два окна/устройства.

- [ ] **Step 2: Сценарий VPN (основной из VYC-24)**

1. Участники А и Б в звонке, А замьючен и демонстрирует экран.
2. А включает VPN.
3. Expected: у А баннер «Переподключение…»; в логах `reconnect: started` → `reconnect: succeeded`; в течение ~2-10с звук в обе стороны восстановлен; А по-прежнему замьючен; демонстрация экрана у Б снова видна (лог `reconnect: screen share restored`); в логах SFU — `evicting stale session for reconnecting user`.
4. Повторить с выключением VPN.

- [ ] **Step 3: Рестарт SFU**

`docker restart <sfu-container>` посреди звонка. Expected: оба участника показывают баннер и возвращаются в звонок после старта SFU (в пределах ~30с окна ретраев).

- [ ] **Step 4: Негативные проверки**

1. Обычный «выйти» → reconnect НЕ запускается (нет баннера, обычный `onCallEnded`).
2. SFU остановлен насовсем (`docker stop`) → после ~30с ретраев звонок честно завершается (`reconnect: gave up` → onCallEnded).

- [ ] **Step 5: Итог**

Зафиксировать результаты прогона в PR-описании / сообщении пользователю. При багах — systematic-debugging, фиксы отдельными коммитами.
