# VYC-48 — Метрики качества звонка + индикатор соединения

**Дата:** 2026-07-24
**Ветка:** `VYC-48-call-quality-metrics`
**Область:** только групповой звонок (`groupCall.ts`, `GroupCallUI.tsx`, серверный WS-хаб). Звонок 1-на-1 (`call.ts` / `CallUI`) не затрагивается.

## Цель

Показывать на плитке каждого участника группового звонка индикатор качества его
**исходящего** соединения (packet loss, RTT, bitrate), одинаковый для всех
наблюдателей, чтобы все видели, что у конкретного пользователя плохой сигнал.

## Ключевое решение (семантика)

Топология — SFU: у каждого клиента один `RTCPeerConnection` (`this.pc`) к SFU.
Индикатор на плитке пользователя X отражает **собственный аплинк X к SFU**
(то, что SFU реально получает от X). X измеряет своё качество и транслирует его
всем через WS-хаб. Так бейдж на плитке X идентичен у всех участников и корректно
означает «у X плохой сигнал».

Это осознанно НЕ даунлинк-качество конкретного зрителя: единый broadcast-уровень
важнее локальных различий приёма.

## Архитектура

Переиспользуется проверенный паттерн событий «видят все» (как `mic_muted`):

```
groupCall (сэмплер getStats, 3с)
   → computeQualityLevel()
   → wsService.send('connection_quality', {...})     [троттлинг]
      → server case "connection_quality" → handleConnectionQuality
         → hub.BroadcastMessage(type=connection_quality, +user_id)
            → все клиенты: wsService.on('connection_quality')
               → state Record<userId, quality>
                  → ConnectionIndicator на плитке
```

## Компоненты

### 1. Клиент — сбор метрик (`client/src/services/groupCall.ts`)

- Новый **отдельный** периодический сэмплер (НЕ трогать существующий debug-логгер
  RTC stats, который сам останавливается через 90с — он остаётся как есть).
- Интервал **3 секунды**, работает всё время активного звонка.
- Источник — `this.pc.getStats()`, метрики **своего аплинка** к SFU:
  - **packet loss** — `remote-inbound-rtp` (kind audio): `fractionLost` (доля 0..1 →
    проценты). Фолбэк: дельта `packetsLost`, если `fractionLost` отсутствует.
  - **RTT** — `remote-inbound-rtp.roundTripTime` (сек → мс). Фолбэк:
    `candidate-pair` (state `succeeded`/nominated) `currentRoundTripTime`.
  - **bitrate** — дельта `outbound-rtp.bytesSent` (audio + video, если идёт шаринг)
    между двумя сэмплами → кбит/с.
- Приоритет аудио (задача про качество звука); битрейт — справочно.
- Жизненный цикл: старт при `pc.connectionState === 'connected'`, остановка и
  очистка интервала в тех же точках, где рвётся/пересоздаётся `pc` (teardown,
  leave, reconnect, partialTeardown). На reconnect сэмплер перезапускается на новом
  `pc`. Интервал обязательно чистится, чтобы не текло.
- Наружу отдаётся через новый колбэк в `GroupCallCallbacks`, напр.
  `onLocalQuality(metrics: ConnectionQualityMetrics)`.

### 2. Клиент — расчёт уровня (чистая функция, тестируемая отдельно)

```ts
type QualityLevel = 'good' | 'medium' | 'poor' | 'unknown';
interface ConnectionQualityMetrics {
  level: QualityLevel;
  packetLoss: number; // %, 1 знак
  rtt: number;        // мс, целое
  bitrate: number;    // кбит/с, целое
}
function computeQualityLevel(loss: number, rtt: number, hasData: boolean): QualityLevel;
```

Пороги:
- `good`: loss < 2% И rtt < 150мс
- `medium`: loss < 5% И rtt < 300мс
- `poor`: loss ≥ 5% ИЛИ rtt ≥ 300мс
- `unknown`: нет данных / нет аудио-трека (`hasData === false`)

Функция выносится в отдельный модуль (напр. `client/src/utils/callQuality.ts`),
чтобы юнит-тестить без WebRTC.

### 3. Клиент — отправка (`GroupCallUI.tsx`)

- Подписка на `onLocalQuality` → `wsService.send('connection_quality', payload)`.
- **Троттлинг**: отправлять при смене `level`, плюс heartbeat раз в ~9с. Не спамить.
- Payload: `{ level, packet_loss, rtt, bitrate }`.

### 4. Сервер (`server/internal/delivery/http/handler/websocket.go`)

- В `handleMessage`: `case "connection_quality": h.handleConnectionQuality(client, msg)`.
- `handleConnectionQuality` — по образцу `handleMicMuted`:
  - unmarshal payload (`level string`, `packet_loss float64`, `rtt float64`,
    `bitrate float64`);
  - при ошибке unmarshal — тихий выход, без паники;
  - `hub.BroadcastMessage` с `type: "connection_quality"` и payload, включающим
    `user_id: client.UserID.String()` + метрики.
- Валидация `level` (белый список good/medium/poor/unknown); неизвестное → выход.
- Рассылка глобальная `BroadcastMessage` (как `mic_muted`); клиент фильтрует по
  участникам звонка.

### 5. Клиент — приём и хранение (`GroupCallUI.tsx`)

- `wsService.on('connection_quality', ...)` → обновляет
  `qualityByUser: Record<string, ConnectionQualityMetrics>` (аналог
  `participantVolumes`, с ref для доступа из колбэков).
- Игнорировать собственные события (`payload.user_id === user?.id`) — своё качество
  берём напрямую из локального сэмплера, без round-trip.
- Очистка записи при уходе участника (`onPeerLeft` / participant_left).

### 6. Клиент — индикатор (`GroupCallUI.tsx` + `GroupCallUI.css`)

- Новый компонент `ConnectionIndicator({ metrics })`: иконка из 3 баров, цвет по
  уровню (зелёный/жёлтый/красный/серый), SVG или CSS, без внешних зависимостей.
- Размещение: в `RemoteParticipantTile` (grid и thumbnail) рядом с `mic-badge`, и на
  локальной плитке «(You)».
- **Тултип** (`title`): `Потери: X% · Пинг: Y мс · Битрейт: Z кбит/с`.
- Стили рядом с `.mic-badge`, с поддержкой темы.

## Тестирование

- **Go** (`websocket_test.go` стиль): `handleConnectionQuality` — валидный payload
  даёт broadcast с `user_id` и метриками; неизвестный `level` — без рассылки; битый
  JSON — без паники. Используются существующие хелперы `newMultiUserTestHandler`,
  `dialWSWithToken`, `sendJSON`, `readUntilType`.
- **Клиент**: юнит-раннера (vitest/jest) в проекте нет — добавлять его в рамках
  этой задачи не будем (расширение объёма и риск). Вместо этого:
  - `computeQualityLevel` — чистая функция без зависимостей от WebRTC, в отдельном
    модуле; корректность проверяется ревью и ручной проверкой граничных порогов;
  - функциональная проверка — ручной прогон группового звонка (см. чек-лист ниже).
- **Ручной чек-лист (клиент):** при звонке из 2+ участников на плитке каждого
  виден индикатор; при сетевой деградации (throttle/DevTools) уровень уходит в
  medium/poor у всех наблюдателей одинаково; тултип показывает числа; после
  reconnect индикатор восстанавливается; после leave интервал очищен (нет утечки —
  проверить, что `getStats` перестал вызываться в логах).

## Границы / инварианты (не сломать)

- Не менять существующий debug-логгер RTC stats.
- Не трогать `call.ts` / `CallUI`.
- Сэмплер не должен течь: интервал чистится во всех точках teardown.
- Отсутствие `remote-inbound-rtp` (например, до первого RTCP) → `unknown`, не краш.
- Отсутствие аудио-трека (микрофон недоступен) → `unknown`.
- Троттлинг WS, чтобы не увеличивать нагрузку на хаб.

## Открытые допущения

- Частота сэмпла 3с и heartbeat 9с — стартовые значения, можно подстроить.
- Пороги качества — стартовые, калибруются по факту.
