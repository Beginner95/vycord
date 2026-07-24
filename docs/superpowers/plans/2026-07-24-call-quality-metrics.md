# Call Quality Metrics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Показать на плитке каждого участника группового звонка индикатор качества его исходящего соединения (packet loss, RTT, bitrate), одинаковый для всех наблюдателей.

**Architecture:** SFU-топология: каждый клиент измеряет своё качество аплинка к SFU через `pc.getStats()` и транслирует уровень всем через WS-хаб (паттерн `mic_muted`: клиент → сервер `BroadcastMessage` → все клиенты фильтруют). Индикатор рендерится на плитках в `GroupCallUI`.

**Tech Stack:** Go (WS-хаб), TypeScript/React (клиент), WebRTC getStats API.

## Global Constraints

- Область — **только групповой звонок**. Не трогать `client/src/services/call.ts` и `client/src/components/CallUI.tsx`.
- Не менять существующий debug-логгер RTC stats (блок `statsIntervalId` в `groupCall.ts`, старт ~строка 1094, стоп через 90с).
- Новый сэмплер качества не должен течь: `clearInterval` во всех точках teardown (`teardown()` и `partialTeardown()`).
- Отсутствие данных (`remote-inbound-rtp` ещё нет / нет аудио-трека) → уровень `unknown`, без краша.
- Троттлинг WS-отправок: слать при смене уровня + heartbeat раз в ~9с.
- Клиентского юнит-раннера нет — новых тест-фреймворков НЕ добавлять. `computeQualityLevel` — чистая функция.
- Коммиты делает пользователь сам — в шагах «Commit» останавливаемся и сообщаем пользователю, НЕ выполняем `git commit` и НЕ добавляем Claude как co-author.
- Отвечать пользователю на русском.

**Пороги качества:**
- `good`: loss < 2% И rtt < 150мс
- `medium`: loss < 5% И rtt < 300мс
- `poor`: loss ≥ 5% ИЛИ rtt ≥ 300мс
- `unknown`: нет данных

**Payload события `connection_quality`:** `{ level: string, packet_loss: number, rtt: number, bitrate: number }`; сервер добавляет `user_id`.

---

## File Structure

- `client/src/utils/callQuality.ts` — **создать**: типы `QualityLevel`, `ConnectionQualityMetrics` и чистая функция `computeQualityLevel`.
- `client/src/services/groupCall.ts` — **изменить**: сэмплер getStats, поле интервала, колбэк `onLocalQuality`, очистка в teardown-точках.
- `server/internal/delivery/http/handler/websocket.go` — **изменить**: `case "connection_quality"` + `handleConnectionQuality`.
- `server/internal/delivery/http/handler/websocket_test.go` — **изменить**: тест `TestConnectionQualityBroadcast`.
- `client/src/components/GroupCallUI.tsx` — **изменить**: приём/хранение/отправка качества, компонент `ConnectionIndicator`, размещение на плитках.
- `client/src/components/GroupCallUI.css` — **изменить**: стили индикатора.

---

## Task 1: Чистая функция расчёта уровня качества

**Files:**
- Create: `client/src/utils/callQuality.ts`

**Interfaces:**
- Consumes: ничего.
- Produces:
  - `type QualityLevel = 'good' | 'medium' | 'poor' | 'unknown'`
  - `interface ConnectionQualityMetrics { level: QualityLevel; packetLoss: number; rtt: number; bitrate: number }`
  - `function computeQualityLevel(packetLossPct: number, rttMs: number, hasData: boolean): QualityLevel`

- [ ] **Step 1: Создать модуль с типами и функцией**

Create `client/src/utils/callQuality.ts`:

```ts
// Уровень качества исходящего соединения участника (аплинк к SFU).
export type QualityLevel = 'good' | 'medium' | 'poor' | 'unknown';

export interface ConnectionQualityMetrics {
  level: QualityLevel;
  packetLoss: number; // проценты, 1 знак после запятой
  rtt: number;        // миллисекунды, целое
  bitrate: number;    // кбит/с, целое
}

// Пороги (см. спек VYC-48). hasData=false → 'unknown' (нет remote-inbound-rtp
// или нет аудио-трека). Иначе классификация по потерям и пингу.
export function computeQualityLevel(
  packetLossPct: number,
  rttMs: number,
  hasData: boolean,
): QualityLevel {
  if (!hasData) return 'unknown';
  if (packetLossPct >= 5 || rttMs >= 300) return 'poor';
  if (packetLossPct >= 2 || rttMs >= 150) return 'medium';
  return 'good';
}
```

- [ ] **Step 2: Проверить типами (tsc)**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок по `callQuality.ts`.

- [ ] **Step 3: Ручная проверка граничных значений (ревью)**

Свериться с порогами: `(1, 100, true)→good`; `(2, 100, true)→medium`; `(0, 150, true)→medium`; `(5, 0, true)→poor`; `(0, 300, true)→poor`; `(0,0,false)→unknown`. Зафиксировать в описании коммита.

- [ ] **Step 4: Commit (выполняет пользователь)**

Сообщить пользователю: изменения в `client/src/utils/callQuality.ts` готовы к коммиту. НЕ коммитить самому.

---

## Task 2: Серверный обработчик `connection_quality`

**Files:**
- Modify: `server/internal/delivery/http/handler/websocket.go` (dispatch ~строка 196–198; новый handler рядом с `handleMicUnmuted` ~строка 605)
- Test: `server/internal/delivery/http/handler/websocket_test.go`

**Interfaces:**
- Consumes: `h.hub.BroadcastMessage`, `mustMarshal` (уже есть).
- Produces: broadcast сообщение `type: "connection_quality"` с payload `{ user_id, level, packet_loss, rtt, bitrate }`.

- [ ] **Step 1: Написать падающий тест**

В `server/internal/delivery/http/handler/websocket_test.go` добавить:

```go
func TestConnectionQualityBroadcast(t *testing.T) {
	userA := uuid.New()
	userB := uuid.New()

	h, _ := newMultiUserTestHandler(t, map[string]*domain.User{
		"token-a": {ID: userA, Username: "alice", Email: "a@e.st", Status: domain.StatusOffline},
		"token-b": {ID: userB, Username: "bob", Email: "b@e.st", Status: domain.StatusOffline},
	})

	srv := httptest.NewServer(http.HandlerFunc(h.HandleWebSocket))
	defer srv.Close()

	connA := dialWSWithToken(t, srv, "token-a")
	defer connA.Close()
	connB := dialWSWithToken(t, srv, "token-b")
	defer connB.Close()

	sendJSON(t, connA, "connection_quality", map[string]interface{}{
		"level":       "poor",
		"packet_loss": 7.5,
		"rtt":         320,
		"bitrate":     40,
	})

	msg := readUntilType(t, connB, "connection_quality", 2*time.Second)
	assert.Contains(t, string(msg), userA.String())
	assert.Contains(t, string(msg), "poor")
}
```

- [ ] **Step 2: Запустить тест — убедиться, что падает**

Run: `cd server && go test ./internal/delivery/http/handler/ -run TestConnectionQualityBroadcast -v`
Expected: FAIL (сообщение `connection_quality` не рассылается; `readUntilType` таймаутит).

- [ ] **Step 3: Добавить dispatch-ветку**

В `server/internal/delivery/http/handler/websocket.go`, в `handleMessage`, после `case "mic_unmuted":` блока (перед `case "voice_joined":`) добавить:

```go
	case "connection_quality":
		h.handleConnectionQuality(client, msg)
```

- [ ] **Step 4: Реализовать handler**

В `websocket.go` после `handleMicUnmuted` добавить:

```go
func (h *WebSocketHandler) handleConnectionQuality(client *ws.Client, msg *ws.Message) {
	var payload struct {
		Level      string  `json:"level"`
		PacketLoss float64 `json:"packet_loss"`
		RTT        float64 `json:"rtt"`
		Bitrate    float64 `json:"bitrate"`
	}
	if err := json.Unmarshal(msg.Payload, &payload); err != nil {
		return
	}
	switch payload.Level {
	case "good", "medium", "poor", "unknown":
	default:
		return
	}
	h.hub.BroadcastMessage(&ws.Message{
		Type: "connection_quality",
		Payload: mustMarshal(map[string]interface{}{
			"user_id":     client.UserID.String(),
			"level":       payload.Level,
			"packet_loss": payload.PacketLoss,
			"rtt":         payload.RTT,
			"bitrate":     payload.Bitrate,
		}),
	})
}
```

- [ ] **Step 5: Запустить тест — убедиться, что проходит**

Run: `cd server && go test ./internal/delivery/http/handler/ -run TestConnectionQualityBroadcast -v`
Expected: PASS.

- [ ] **Step 6: Прогнать пакет целиком (регрессия)**

Run: `cd server && go test ./internal/delivery/http/handler/`
Expected: ok, без падений.

- [ ] **Step 7: Commit (выполняет пользователь)**

Сообщить пользователю: серверная часть готова к коммиту. НЕ коммитить самому.

---

## Task 3: Клиентский сэмплер качества в `groupCall.ts`

**Files:**
- Modify: `client/src/services/groupCall.ts`

**Interfaces:**
- Consumes: `computeQualityLevel`, `ConnectionQualityMetrics` из `@/utils/callQuality`; `this.pc.getStats()`.
- Produces: колбэк `onLocalQuality?: (metrics: ConnectionQualityMetrics) => void` в `GroupCallCallbacks`; приватные методы `startQualitySampler()` / `stopQualitySampler()`.

- [ ] **Step 1: Импорт и поля класса**

Вверху `groupCall.ts` добавить импорт:

```ts
import { computeQualityLevel, type ConnectionQualityMetrics } from '@/utils/callQuality';
```

В интерфейс `GroupCallCallbacks` (рядом с `onReconnected?`) добавить:

```ts
  onLocalQuality?: (metrics: ConnectionQualityMetrics) => void;
```

В поля класса `GroupCallService` (рядом с `disconnectedTimer`) добавить:

```ts
  private qualityIntervalId: ReturnType<typeof setInterval> | null = null;
  private lastBytesSent = 0;
  private lastBytesSentAt = 0;
```

- [ ] **Step 2: Методы старта/остановки сэмплера**

Добавить приватные методы (например, сразу после `partialTeardown`):

```ts
  private startQualitySampler(): void {
    this.stopQualitySampler();
    this.lastBytesSent = 0;
    this.lastBytesSentAt = 0;
    this.qualityIntervalId = setInterval(() => {
      void this.sampleQuality();
    }, 3000);
  }

  private stopQualitySampler(): void {
    if (this.qualityIntervalId !== null) {
      clearInterval(this.qualityIntervalId);
      this.qualityIntervalId = null;
    }
  }

  private async sampleQuality(): Promise<void> {
    if (!this.pc || this.pc.connectionState !== 'connected') {
      this.stopQualitySampler();
      return;
    }
    try {
      const stats = await this.pc.getStats();
      let lossPct = 0;
      let rttMs = 0;
      let hasData = false;
      let bytesSent = 0;
      let candidateRttMs = 0;

      stats.forEach((report) => {
        if (report.type === 'remote-inbound-rtp' && report.kind === 'audio') {
          hasData = true;
          const fl = report.fractionLost as number | undefined;
          if (typeof fl === 'number') lossPct = Math.max(0, fl * 100);
          const rtt = report.roundTripTime as number | undefined;
          if (typeof rtt === 'number') rttMs = rtt * 1000;
        } else if (report.type === 'outbound-rtp' && !report.isRemote) {
          bytesSent += (report.bytesSent as number | undefined) ?? 0;
        } else if (report.type === 'candidate-pair' && report.state === 'succeeded') {
          const crtt = report.currentRoundTripTime as number | undefined;
          if (typeof crtt === 'number') candidateRttMs = crtt * 1000;
        }
      });

      if (rttMs === 0 && candidateRttMs > 0) rttMs = candidateRttMs;

      const now = Date.now();
      let bitrateKbps = 0;
      if (this.lastBytesSentAt > 0 && now > this.lastBytesSentAt) {
        const deltaBits = (bytesSent - this.lastBytesSent) * 8;
        const deltaSec = (now - this.lastBytesSentAt) / 1000;
        if (deltaSec > 0 && deltaBits >= 0) bitrateKbps = deltaBits / 1000 / deltaSec;
      }
      this.lastBytesSent = bytesSent;
      this.lastBytesSentAt = now;

      const metrics: ConnectionQualityMetrics = {
        level: computeQualityLevel(lossPct, rttMs, hasData),
        packetLoss: Math.round(lossPct * 10) / 10,
        rtt: Math.round(rttMs),
        bitrate: Math.round(bitrateKbps),
      };
      this.callbacks?.onLocalQuality?.(metrics);
    } catch {
      // getStats может кинуть на закрывающемся pc — игнорируем.
    }
  }
```

- [ ] **Step 3: Запуск сэмплера при connected**

В блоке `if (pc.connectionState === 'connected') {` (внутри `connect`, где стартует debug `statsIntervalId`) добавить после существующего блока debug-логгера:

```ts
        this.startQualitySampler();
```

(НЕ трогать сам debug-логгер.)

- [ ] **Step 4: Очистка в teardown-точках**

В `partialTeardown()` добавить (рядом с `this.pc?.close()`):

```ts
    this.stopQualitySampler();
```

В `teardown()` добавить (рядом с `this.pc?.close()`):

```ts
    this.stopQualitySampler();
```

- [ ] **Step 5: Проверить типами**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок.

- [ ] **Step 6: Сборка клиента (регрессия)**

Run: `cd client && npm run build`
Expected: успешная сборка.

- [ ] **Step 7: Commit (выполняет пользователь)**

Сообщить пользователю: сэмплер в `groupCall.ts` готов к коммиту. НЕ коммитить самому.

---

## Task 4: Компонент индикатора и стили

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx` (новый компонент `ConnectionIndicator`)
- Modify: `client/src/components/GroupCallUI.css`

**Interfaces:**
- Consumes: `ConnectionQualityMetrics`, `QualityLevel` из `@/utils/callQuality`.
- Produces: `function ConnectionIndicator({ metrics }: { metrics?: ConnectionQualityMetrics }): JSX.Element | null`

- [ ] **Step 1: Импорт типов в GroupCallUI.tsx**

Добавить в импорты `GroupCallUI.tsx`:

```ts
import type { ConnectionQualityMetrics, QualityLevel } from '@/utils/callQuality';
```

- [ ] **Step 2: Компонент ConnectionIndicator**

Добавить рядом с `RemoteParticipantTile` (перед ним):

```tsx
const QUALITY_TITLE: Record<QualityLevel, string> = {
  good: 'Хороший сигнал',
  medium: 'Средний сигнал',
  poor: 'Плохой сигнал',
  unknown: 'Нет данных о сигнале',
};

function ConnectionIndicator({ metrics }: { metrics?: ConnectionQualityMetrics }) {
  if (!metrics) return null;
  const { level, packetLoss, rtt, bitrate } = metrics;
  const title =
    level === 'unknown'
      ? QUALITY_TITLE.unknown
      : `${QUALITY_TITLE[level]} · Потери: ${packetLoss}% · Пинг: ${rtt} мс · Битрейт: ${bitrate} кбит/с`;
  return (
    <div className={`conn-indicator conn-indicator--${level}`} title={title} aria-label={title}>
      <span className="conn-bar conn-bar--1" />
      <span className="conn-bar conn-bar--2" />
      <span className="conn-bar conn-bar--3" />
    </div>
  );
}
```

- [ ] **Step 3: Стили индикатора**

В `GroupCallUI.css` (рядом с `.mic-badge`) добавить:

```css
.conn-indicator {
  display: inline-flex;
  align-items: flex-end;
  gap: 2px;
  height: 14px;
  padding: 2px 4px;
  border-radius: 4px;
  background: rgba(0, 0, 0, 0.45);
}
.conn-indicator .conn-bar {
  width: 3px;
  border-radius: 1px;
  background: currentColor;
  opacity: 0.3;
}
.conn-bar--1 { height: 5px; }
.conn-bar--2 { height: 9px; }
.conn-bar--3 { height: 13px; }
.conn-indicator--good { color: #43b581; }
.conn-indicator--good .conn-bar { opacity: 1; }
.conn-indicator--medium { color: #faa61a; }
.conn-indicator--medium .conn-bar--1,
.conn-indicator--medium .conn-bar--2 { opacity: 1; }
.conn-indicator--poor { color: #f04747; }
.conn-indicator--poor .conn-bar--1 { opacity: 1; }
.conn-indicator--unknown { color: #99aab5; }
```

- [ ] **Step 4: Проверить типами**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок (компонент пока не используется — предупреждение о неиспользуемом допустимо до Task 5; если tsc падает на unused, временно не считать за блокер, устранится в Task 5).

- [ ] **Step 5: Commit (выполняет пользователь)**

Сообщить пользователю: компонент индикатора и стили готовы к коммиту. НЕ коммитить самому.

---

## Task 5: Интеграция в GroupCallUI — приём, отправка, размещение

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx`

**Interfaces:**
- Consumes: `ConnectionIndicator`, `groupCallService` колбэк `onLocalQuality`, `wsService`, `RemoteParticipantTileProps`.
- Produces: prop `quality?: ConnectionQualityMetrics` у `RemoteParticipantTile`.

- [ ] **Step 1: State и ref для качества**

Рядом с `participantVolumes` state добавить:

```tsx
  const [qualityByUser, setQualityByUser] = useState<Record<string, ConnectionQualityMetrics>>({});
  const [localQuality, setLocalQuality] = useState<ConnectionQualityMetrics | undefined>(undefined);
```

- [ ] **Step 2: Подписка на входящие connection_quality**

В том же effect-блоке, где подписки `wsService.on('mic_muted'...)`, добавить:

```tsx
    const unsubQuality = wsService.on('connection_quality', (payload) => {
      const p = payload as { user_id: string; level: QualityLevel; packet_loss: number; rtt: number; bitrate: number };
      if (p.user_id === user?.id) return; // своё качество берём из локального сэмплера
      if (!participantsRef.current.some((pt) => pt.userId === p.user_id)) return;
      setQualityByUser((prev) => ({
        ...prev,
        [p.user_id]: { level: p.level, packetLoss: p.packet_loss, rtt: p.rtt, bitrate: p.bitrate },
      }));
    });
```

И в cleanup этого effect добавить `unsubQuality();` рядом с остальными отписками.

- [ ] **Step 3: Локальный сэмплер → отправка с троттлингом (в существующем `init`)**

ВАЖНО: колбэки регистрируются ОДНИМ вызовом `groupCallService.init({...})` (строка ~359), который заменяет весь объект колбэков (`this.callbacks = callbacks`). Отдельного merge-API нет. Поэтому `onLocalQuality` добавляется прямо в этот объект `init({...})`, НЕ отдельным effect и НЕ через несуществующий `setCallbacks`.

Троттлинг-состояние держим в ref (объявить рядом с другими ref, напр. возле `participantVolumesRef`):

```tsx
  const qualitySendRef = useRef<{ lastLevel: QualityLevel | null; lastSentAt: number }>({
    lastLevel: null,
    lastSentAt: 0,
  });
```

Внутри объекта `groupCallService.init({ ... })` добавить колбэк (рядом с `onReconnected`/`onError`):

```tsx
      onLocalQuality: (metrics) => {
        setLocalQuality(metrics);
        const now = Date.now();
        const st = qualitySendRef.current;
        const changed = metrics.level !== st.lastLevel;
        const heartbeat = now - st.lastSentAt >= 9000;
        if (changed || heartbeat) {
          st.lastLevel = metrics.level;
          st.lastSentAt = now;
          wsService.send('connection_quality', {
            level: metrics.level,
            packet_loss: metrics.packetLoss,
            rtt: metrics.rtt,
            bitrate: metrics.bitrate,
          });
        }
      },
```

- [ ] **Step 4: Очистка записи ушедшего участника (в `onPeerLeft`)**

Внутри существующего `onPeerLeft: (userId) => { ... }` (строка ~388, где идёт `setParticipants(...filter)` и `setRemoteMicMuted`) добавить:

```tsx
        setQualityByUser((prev) => {
          const next = { ...prev };
          delete next[userId];
          return next;
        });
```

- [ ] **Step 5: Проброс quality в RemoteParticipantTile**

В `RemoteParticipantTileProps` добавить поле:

```tsx
  quality?: ConnectionQualityMetrics;
```

В теле `RemoteParticipantTile` вставить индикатор рядом с `mic-badge` (и в grid, и в thumbnail ветках):

```tsx
      <ConnectionIndicator metrics={quality} />
```

В местах, где `RemoteParticipantTile` рендерится (`.map` по participants), передать проп:

```tsx
              quality={qualityByUser[p.userId]}
```

- [ ] **Step 6: Индикатор на локальной плитке «(You)»**

На локальной плитке (блоки ~строки 863–923, где `{user?.username} (You)`), рядом с локальным `mic-badge`, добавить:

```tsx
              <ConnectionIndicator metrics={localQuality} />
```

(в обеих ветках рендера локального видео — grid и screen-share, если их две).

- [ ] **Step 7: Проверить типами**

Run: `cd client && npx tsc --noEmit`
Expected: без ошибок, без unused-варнингов по `ConnectionIndicator`.

- [ ] **Step 8: Сборка клиента**

Run: `cd client && npm run build`
Expected: успешная сборка.

- [ ] **Step 9: Commit (выполняет пользователь)**

Сообщить пользователю: интеграция в GroupCallUI готова к коммиту. НЕ коммитить самому.

---

## Task 6: Финальная проверка (регрессия + ручной прогон)

**Files:** нет изменений (проверочная задача).

- [ ] **Step 1: Полный прогон Go-тестов**

Run: `cd server && go test ./...`
Expected: ok, без падений.

- [ ] **Step 2: Линт/типы/сборка клиента**

Run: `cd client && npx tsc --noEmit && npm run build`
Expected: без ошибок.

- [ ] **Step 3: Ручной чек-лист (сообщить пользователю для проверки в реальном звонке)**

- В звонке 2+ участников на плитке каждого виден индикатор сигнала.
- При деградации сети (DevTools throttling) уровень уходит в medium/poor одинаково у всех наблюдателей.
- Тултип показывает `Потери / Пинг / Битрейт`.
- После reconnect индикатор восстанавливается.
- После leave `getStats` перестаёт вызываться (нет утечки интервала) — проверить по логам `[GC]`.
- Существующие бейджи (mic, speaking, screen-share) и звук не сломаны.

- [ ] **Step 4: Итоговое сообщение пользователю**

Сообщить, что реализация завершена, все автотесты/сборка зелёные, и передать ручной чек-лист. Коммиты/пуш — за пользователем.
