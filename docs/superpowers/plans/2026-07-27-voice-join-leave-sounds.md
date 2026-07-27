# VYC-49 — Звуковые уведомления о входе и выходе участников: план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** во время группового звонка проигрывать восходящий сигнал, когда участник входит, и зеркальный нисходящий, когда выходит, не давая ложных срабатываний при авто-реконнекте.

**Architecture:** `onPeerJoined` в `groupCall.ts` получает явный параметр `source: 'snapshot' | 'live'` — `'snapshot'` для участников из `joined.existing_peers` (срабатывает и при своём входе, и на каждом реконнекте), `'live'` для живого `participant_joined`. Звук играет только на `'live'`. Свой вход/выход озвучивается в `GroupCallUI` на тех же предикатах, что уже используются для `voice_joined`/`voice_left`. Сами сигналы генерируются осцилляторами в существующем `audioService` — новых ассетов нет.

**Tech Stack:** TypeScript 6, React 19, Web Audio API, Vite 8; тесты — существующий harness `client/e2e/run.sh` (headless Chrome + реальный Go SFU, каждый сценарий печатает одну строку `E2E_RESULT {json}`).

**Спека:** `docs/superpowers/specs/2026-07-27-voice-join-leave-sounds-design.md`

## Global Constraints

- Все правки — только в `client/`. Серверный код (`server/`) не трогать.
- Node/npm запускать из каталога `client/`; системный `node -v` = v22.14.0, этого достаточно, nvm не нужен.
- Типизация: `tsconfig.json` имеет `"strict": true` и `"noEmit": true` — типопроверка это ровно `./node_modules/.bin/tsc` без аргументов.
- Существующие вызовы `playTone` не менять: новый параметр `type` добавляется последним и со значением по умолчанию `'sine'`.
- Тембр новых сигналов — `'triangle'`; частоты ровно `659.25` (E5) и `880` (A5); громкость `settings.volume * 0.25`.
- Окно антидребезга — `250` мс, отдельное для `'joined'` и `'left'`, лишние события отбрасываются (не откладываются в очередь).
- Ключ localStorage настроек — существующий `vycord_audio_settings`, новое поле `voiceSound`, дефолт `true`.
- В сообщения коммитов **не добавлять** `Co-Authored-By` и любые упоминания Claude как автора.
- Отклонение от спеки, согласованное заранее: спека описывала один новый e2e-сценарий, план добавляет **два** — `voice-sound-tones` (Task 1, проверяет сами сигналы, троттл и тумблер; SFU не нужен) и `join-leave-events` (Task 2, проверяет семантику `source` на реальном сигналинге). Разделение по зонам ответственности, суммарно дешевле одной страницы, делающей и то и другое.

---

### Task 1: Сигналы входа/выхода в `audioService`

**Files:**
- Modify: `client/src/services/audio.ts` (тип `NotificationType` строка 6, интерфейс `AudioSettings` строки 8–12, `DEFAULT_SETTINGS` строки 14–18, константы рядом со строкой 20, поля класса строки 23–26, новые методы после `playBusy` строка 145, сигнатура `playTone` строки 150–172)
- Create: `client/e2e/voice-sound-tones.html`
- Modify: `client/e2e/run.sh` (регистрация сценария в конце файла)

**Interfaces:**
- Consumes: ничего (первая задача).
- Produces:
  - `audioService.playUserJoined(): void` — восходящий сигнал входа.
  - `audioService.playUserLeft(): void` — нисходящий сигнал выхода.
  - поле настроек `voiceSound: boolean` в `AudioSettings` (дефолт `true`), читается через `audioService.getSettings()`, пишется через `audioService.updateSettings({ voiceSound })`.

- [ ] **Step 1: Написать падающий тест — e2e-страница `client/e2e/voice-sound-tones.html`**

Создать файл целиком:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>E2E: voice join/leave chimes</title>
</head>
<body>
  <pre id="status">starting…</pre>

  <script type="module">
    // E2E scenario for VYC-49: the join/leave chimes of audioService.
    //
    // No SFU and no WebRTC here — this checks the sound layer in isolation:
    // every tone the service plays creates exactly one OscillatorNode, so a spy on
    // AudioContext.prototype.createOscillator records the melody that was played.
    // That makes "join and leave sound different", "a burst collapses into one
    // chime" and "the settings toggle silences only these chimes" all observable
    // without listening to anything.
    //
    // Result protocol: a single console.log line "E2E_RESULT {json}" parsed by run.sh.

    const statusEl = document.getElementById('status');

    function log(...args) {
      console.log('[E2E]', ...args);
      statusEl.textContent += '\n' + args.map(String).join(' ');
    }

    let finished = false;
    function finish(pass, reason, extra = {}) {
      if (finished) return;
      finished = true;
      console.log('E2E_RESULT ' + JSON.stringify({ pass, reason, ...extra }));
    }

    // Page-level watchdog: whatever hangs, always emit a result line.
    setTimeout(() => finish(false, 'global watchdog (30s) fired'), 30_000);

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

    // Spy installed on the prototype BEFORE audio.ts is imported. playTone() creates
    // one oscillator per tone and sets its frequency via setValueAtTime, so both the
    // timbre and the pitch sequence are recoverable.
    const recorded = [];
    const origCreateOscillator = AudioContext.prototype.createOscillator;
    AudioContext.prototype.createOscillator = function patchedCreateOscillator() {
      const osc = origCreateOscillator.call(this);
      const rec = { osc, freq: null };
      recorded.push(rec);
      const origSetValueAtTime = osc.frequency.setValueAtTime.bind(osc.frequency);
      osc.frequency.setValueAtTime = (value, when) => {
        rec.freq = value;
        return origSetValueAtTime(value, when);
      };
      return osc;
    };

    // Returns the tones played since the previous drain(), then clears the buffer.
    function drain() {
      const played = recorded.map((r) => ({ type: r.osc.type, freq: r.freq }));
      recorded.length = 0;
      return played;
    }

    const failures = [];
    function expect(cond, what, detail) {
      if (cond) {
        log('OK   —', what);
        return;
      }
      log('FAIL —', what, JSON.stringify(detail));
      failures.push(what);
    }

    const freqs = (tones) => tones.map((t) => t.freq).join(',');

    try {
      const { audioService } = await import('/src/services/audio.ts');

      audioService.updateSettings({ voiceSound: true, messageSound: true, volume: 0.5 });
      drain();

      // 1. Join chime: two ascending triangle tones.
      audioService.playUserJoined();
      const join = drain();
      expect(join.length === 2, 'join chime plays two tones', join);
      expect(join.every((t) => t.type === 'triangle'), 'join chime uses the triangle timbre', join);
      expect(join[0]?.freq === 659.25 && join[1]?.freq === 880, 'join chime ascends E5 → A5', join);

      // 2. Leave chime: the mirrored sequence, i.e. audibly different from the join chime.
      audioService.playUserLeft();
      const left = drain();
      expect(left.length === 2, 'leave chime plays two tones', left);
      expect(left.every((t) => t.type === 'triangle'), 'leave chime uses the triangle timbre', left);
      expect(left[0]?.freq === 880 && left[1]?.freq === 659.25, 'leave chime descends A5 → E5', left);
      expect(freqs(join) !== freqs(left), 'join and leave chimes are different sounds', { join, left });

      // 3. Throttle: three participants joining at once must sound once...
      await sleep(300);
      audioService.playUserJoined();
      audioService.playUserJoined();
      audioService.playUserJoined();
      const burst = drain();
      expect(burst.length === 2, 'three simultaneous joins play a single chime', burst);

      // ...while an event past the throttle window sounds again.
      await sleep(300);
      audioService.playUserJoined();
      const later = drain();
      expect(later.length === 2, 'a join after the throttle window plays again', later);

      // 4. Settings gate: only the voice chimes go silent.
      audioService.updateSettings({ voiceSound: false });
      await sleep(300);
      audioService.playUserJoined();
      audioService.playUserLeft();
      const muted = drain();
      expect(muted.length === 0, 'voiceSound=false silences both chimes', muted);

      audioService.playMessage();
      const message = drain();
      expect(message.length === 2, 'message sound still plays with voiceSound=false', message);
      expect(message.every((t) => t.type === 'sine'), 'message sound keeps the default sine timbre', message);

      // Leave the persisted settings in the default state for the next scenario.
      audioService.updateSettings({ voiceSound: true });

      finish(
        failures.length === 0,
        failures.length === 0
          ? 'voice chimes: tones, throttle and settings gate all behave'
          : `${failures.length} assertion(s) failed`,
        { failures },
      );
    } catch (err) {
      finish(false, String((err && err.message) || err), { failures });
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Зарегистрировать сценарий в `client/e2e/run.sh`**

В конце файла, перед `echo "PASS"`, добавить строку **первой** в списке сценариев (он самый быстрый — быстрее падает при поломке):

```bash
run_scenario "voice-sound-tones" "http://localhost:$VITE_PORT/e2e/voice-sound-tones.html"
run_scenario "no-camera-screenshare" "$PAGE_URL"
run_scenario "nc-toggle" "http://localhost:$VITE_PORT/e2e/nc-toggle.html"
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `cd client && E2E_ONLY=voice-sound-tones bash e2e/run.sh`
Expected: `FAIL: voice-sound-tones failed` — в `E2E_RESULT` будет `"pass":false` с причиной вида `audioService.playUserJoined is not a function`.

- [ ] **Step 4: Расширить типы и настройки в `client/src/services/audio.ts`**

Заменить строки 6–20 (тип, интерфейс, дефолты, константа ключа) на:

```ts
type NotificationType =
  | 'message'
  | 'call_incoming'
  | 'call_accepted'
  | 'call_ended'
  | 'call_busy'
  | 'user_joined'
  | 'user_left';

interface AudioSettings {
  messageSound: boolean;
  callSound: boolean;
  voiceSound: boolean;
  volume: number; // 0–1
}

const DEFAULT_SETTINGS: AudioSettings = {
  messageSound: true,
  callSound: true,
  voiceSound: true,
  volume: 0.5,
};

const SETTINGS_KEY = 'vycord_audio_settings';

// Minimum gap between two chimes of the same kind. A burst of participants
// joining or leaving at once must not stack into noise.
const VOICE_SOUND_MIN_GAP_MS = 250;
```

Конструктор менять не нужно: `{ ...DEFAULT_SETTINGS, ...JSON.parse(stored) }` сам подставит `voiceSound: true` пользователям с уже сохранёнными настройками.

- [ ] **Step 5: Добавить поле троттла в класс**

После строки `private isRinging = false;` (строка 26) добавить:

```ts
  // Timestamps (performance.now()) of the last chime of each kind — see allowVoiceSound.
  private lastVoiceSoundAt: { joined: number; left: number } = { joined: 0, left: 0 };
```

- [ ] **Step 6: Добавить два метода сигналов и хелпер троттла**

Вставить сразу после метода `playBusy()` (после строки 145), перед `playTone`:

```ts
  /**
   * Play an ascending chime when a participant joins the group call.
   * The triangle timbre keeps it distinct from the sine message/call sounds.
   */
  playUserJoined(): void {
    if (!this.settings.voiceSound) return;
    if (!this.allowVoiceSound('joined')) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.25;

    this.playTone(ctx, 659.25, 0, 0.08, vol, 'triangle');   // E5
    this.playTone(ctx, 880, 0.08, 0.16, vol, 'triangle');   // A5
  }

  /**
   * Play the mirrored descending chime when a participant leaves the group call.
   */
  playUserLeft(): void {
    if (!this.settings.voiceSound) return;
    if (!this.allowVoiceSound('left')) return;
    const ctx = this.getAudioContext();
    const vol = this.settings.volume * 0.25;

    this.playTone(ctx, 880, 0, 0.08, vol, 'triangle');      // A5
    this.playTone(ctx, 659.25, 0.08, 0.2, vol, 'triangle'); // E5
  }

  /**
   * Rate-limit chimes per event kind: extra events inside the window are dropped,
   * never queued — several participants joining at once should sound once.
   */
  private allowVoiceSound(kind: 'joined' | 'left'): boolean {
    const now = performance.now();
    if (now - this.lastVoiceSoundAt[kind] < VOICE_SOUND_MIN_GAP_MS) return false;
    this.lastVoiceSoundAt[kind] = now;
    return true;
  }
```

- [ ] **Step 7: Добавить параметр тембра в `playTone`**

Заменить сигнатуру и присваивание типа осциллятора (строки 150–160):

```ts
  private playTone(
    ctx: AudioContext,
    frequency: number,
    startTime: number,
    duration: number,
    volume: number,
    type: OscillatorType = 'sine',
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
```

Остальное тело метода не меняется.

- [ ] **Step 8: Запустить тест и убедиться, что он проходит**

Run: `cd client && E2E_ONLY=voice-sound-tones bash e2e/run.sh`
Expected: `PASS: voice-sound-tones`, в `E2E_RESULT` — `"pass":true` и `"failures":[]`.

- [ ] **Step 9: Проверить типы**

Run: `cd client && ./node_modules/.bin/tsc`
Expected: пустой вывод, код возврата 0.

- [ ] **Step 10: Коммит**

```bash
git add client/src/services/audio.ts client/e2e/voice-sound-tones.html client/e2e/run.sh
git commit -m "VYC-49 Добавил звуковые сигналы входа и выхода в audioService"
```

---

### Task 2: Явный источник события в `onPeerJoined`

**Files:**
- Modify: `client/src/services/groupCall.ts` (интерфейс `GroupCallCallbacks` строка 104, вызов из снапшота `existing_peers` строка ~853, `case 'participant_joined'` строка ~1286)
- Create: `client/e2e/join-leave-events.html`
- Modify: `client/e2e/run.sh` (регистрация сценария)

**Interfaces:**
- Consumes: ничего от Task 1 (задачи независимы; порядок выбран для удобства ревью).
- Produces:
  - `GroupCallCallbacks.onPeerJoined: (userId: string, source: 'snapshot' | 'live') => void` — `'snapshot'` для участников, уже находившихся в комнате на момент подключения (включая каждый успешный авто-реконнект), `'live'` для входа в реальном времени.
  - `GroupCallCallbacks.onPeerLeft: (userId: string) => void` — без изменений.

- [ ] **Step 1: Написать падающий тест — e2e-страница `client/e2e/join-leave-events.html`**

Создать файл целиком:

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>E2E: participant join/leave event semantics</title>
</head>
<body>
  <pre id="status">starting…</pre>

  <script type="module">
    // E2E scenario for VYC-49: onPeerJoined must say WHERE the event came from.
    //
    // Three real groupCallService instances (a, b, c) talk to a real SFU through the
    // production signaling code. onPeerJoined carries source='snapshot' for peers that
    // were already in the room when we connected (this also happens on every
    // auto-reconnect) and source='live' for a real-time arrival. GroupCallUI plays the
    // join chime only on 'live', so a wrong source means users hear phantom chimes
    // after every network blip — that is the regression this scenario guards.
    //
    // Result protocol: a single console.log line "E2E_RESULT {json}" parsed by run.sh.

    const statusEl = document.getElementById('status');
    const startedAt = Date.now();
    const timings = {};

    function log(...args) {
      console.log('[E2E]', ...args);
      statusEl.textContent += '\n' + args.map(String).join(' ');
    }

    let finished = false;
    function finish(pass, reason, extra = {}) {
      if (finished) return;
      finished = true;
      console.log('E2E_RESULT ' + JSON.stringify({ pass, reason, timings, ...extra }));
    }

    function waitFor(predicate, timeoutMs, what) {
      return new Promise((resolve, reject) => {
        const t0 = Date.now();
        const id = setInterval(() => {
          let ok = false;
          try { ok = predicate(); } catch { /* keep polling */ }
          if (ok) {
            clearInterval(id);
            timings[what] = Date.now() - startedAt;
            resolve();
          } else if (Date.now() - t0 > timeoutMs) {
            clearInterval(id);
            reject(new Error(`timeout waiting for: ${what}`));
          }
        }, 200);
      });
    }

    // ── Media device fakes (must be installed before the service is imported) ──

    function makeSilentMicTrack() {
      const ctx = new AudioContext();
      const dst = ctx.createMediaStreamDestination();
      const osc = ctx.createOscillator();
      osc.frequency.value = 440;
      osc.connect(dst);
      osc.start();
      return dst.stream.getAudioTracks()[0];
    }

    // Mic only, no camera: acquireMedia() falls back to its audio-only branch,
    // which is enough for participant bookkeeping and keeps the test light.
    navigator.mediaDevices.getUserMedia = async (constraints) => {
      if (constraints?.video) {
        throw new DOMException('Requested device not found', 'NotFoundError');
      }
      if (constraints?.audio) {
        return new MediaStream([makeSilentMicTrack()]);
      }
      throw new DOMException('Requested device not found', 'NotFoundError');
    };

    // ── Test body ────────────────────────────────────────────────────────────

    setTimeout(() => finish(false, 'global watchdog (120s) fired', { events: dumpEvents() }), 120_000);

    const room = `e2e-${Date.now()}`;
    // Must be plain UUIDs: the SFU takes the identity from the token's user_id claim.
    const ids = { a: crypto.randomUUID(), b: crypto.randomUUID(), c: crypto.randomUUID() };
    const short = (uid) => Object.keys(ids).find((k) => ids[k] === uid) ?? uid.slice(0, 8);

    // Mirrors run.sh's JWT_SECRET for the test SFU.
    const E2E_JWT_SECRET = 'e2e-test-secret';

    async function makeToken(secret, userId) {
      const enc = new TextEncoder();
      const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
        .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const header = b64url(enc.encode(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
      const payload = b64url(enc.encode(JSON.stringify({
        user_id: userId,
        exp: Math.floor(Date.now() / 1000) + 3600,
      })));
      const key = await crypto.subtle.importKey(
        'raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
      );
      const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${header}.${payload}`));
      return `${header}.${payload}.${b64url(sig)}`;
    }

    const events = { a: [], b: [], c: [] };
    const dumpEvents = () => ({
      a: events.a.map((e) => `${e.kind}:${short(e.uid)}:${e.source ?? '-'}`),
      b: events.b.map((e) => `${e.kind}:${short(e.uid)}:${e.source ?? '-'}`),
      c: events.c.map((e) => `${e.kind}:${short(e.uid)}:${e.source ?? '-'}`),
    });

    function callbacksFor(who) {
      return {
        onRemoteStream: () => {},
        onPeerJoined: (uid, source) => {
          events[who].push({ kind: 'joined', uid, source });
          log(who, 'onPeerJoined', short(uid), String(source));
        },
        onPeerLeft: (uid) => {
          events[who].push({ kind: 'left', uid });
          log(who, 'onPeerLeft', short(uid));
        },
        onCallEnded: () => log(who, 'onCallEnded'),
        onError: (e) => log(who, 'onError:', e),
      };
    }

    const joined = (who, source, uid) => events[who].filter(
      (e) => e.kind === 'joined' && e.source === source && (uid === undefined || e.uid === uid),
    );
    const leftOf = (who, uid) => events[who].filter(
      (e) => e.kind === 'left' && (uid === undefined || e.uid === uid),
    );
    function clearEvents() {
      events.a.length = 0;
      events.b.length = 0;
      events.c.length = 0;
    }

    const failures = [];
    function expect(cond, what, detail) {
      if (cond) {
        log('OK   —', what);
        return;
      }
      log('FAIL —', what, JSON.stringify(detail));
      failures.push(what);
    }

    let svc = {};

    try {
      // Three independent service instances from the same production module.
      // The distinct query strings make vite evaluate the module three times.
      const [modA, modB, modC] = await Promise.all([
        import('/src/services/groupCall.ts?inst=a'),
        import('/src/services/groupCall.ts?inst=b'),
        import('/src/services/groupCall.ts?inst=c'),
      ]);
      svc = { a: modA.groupCallService, b: modB.groupCallService, c: modC.groupCallService };
      if (svc.a === svc.b || svc.b === svc.c || svc.a === svc.c) {
        finish(false, 'test harness broken: services are not distinct instances');
        throw new Error('shared instance');
      }

      for (const who of ['a', 'b', 'c']) svc[who].init(callbacksFor(who));

      const tokens = {
        a: await makeToken(E2E_JWT_SECRET, ids.a),
        b: await makeToken(E2E_JWT_SECRET, ids.b),
        c: await makeToken(E2E_JWT_SECRET, ids.c),
      };

      // groupCallService reads the token from localStorage at connect time and all
      // instances share this page's localStorage — set the right token immediately
      // before each (awaited) join, and again before forcing a reconnect below.
      async function join(who) {
        localStorage.setItem('vycord_token', tokens[who]);
        await svc[who].joinGroupCall(room, ids[who]);
        await waitFor(() => svc[who].isInGroupCallState, 15_000, `${who}-joined`);
        log(who, 'joined');
      }

      // 1. A joins an empty room — nothing to announce.
      await join('a');
      expect(events.a.length === 0, 'first participant sees no join events', dumpEvents());

      // 2. B joins: A sees a live arrival, B sees A as a snapshot peer.
      clearEvents();
      await join('b');
      await waitFor(() => joined('a', 'live', ids.b).length > 0, 15_000, 'a-saw-b-live');
      expect(joined('a', 'live', ids.b).length === 1, 'A sees B as exactly one live join', dumpEvents());
      expect(joined('a', 'snapshot').length === 0, 'A gets no snapshot events while staying in the room', dumpEvents());
      expect(joined('b', 'snapshot', ids.a).length === 1, 'B sees A as a snapshot peer', dumpEvents());
      expect(joined('b', 'live').length === 0, 'B gets no live events for peers that were already there', dumpEvents());

      // 3. C joins: both A and B see one live arrival, C sees two snapshot peers.
      clearEvents();
      await join('c');
      await waitFor(
        () => joined('a', 'live', ids.c).length > 0 && joined('b', 'live', ids.c).length > 0,
        15_000,
        'a-and-b-saw-c-live',
      );
      expect(joined('a', 'live', ids.c).length === 1, 'A sees C as exactly one live join', dumpEvents());
      expect(joined('b', 'live', ids.c).length === 1, 'B sees C as exactly one live join', dumpEvents());
      expect(joined('c', 'snapshot').length === 2, 'C sees both existing peers as snapshot', dumpEvents());
      expect(joined('c', 'live').length === 0, 'C gets no live events on its own join', dumpEvents());

      // 4. C leaves: everyone still in the room sees exactly one leave event.
      clearEvents();
      svc.c.leaveGroupCall();
      await waitFor(
        () => leftOf('a', ids.c).length > 0 && leftOf('b', ids.c).length > 0,
        15_000,
        'c-left-observed',
      );
      expect(leftOf('a', ids.c).length === 1, 'A sees C leave exactly once', dumpEvents());
      expect(leftOf('b', ids.c).length === 1, 'B sees C leave exactly once', dumpEvents());

      // 5. The regression that matters: A's socket dies, auto-reconnect rejoins, and
      // every peer A re-discovers must arrive as 'snapshot' — never as a live join.
      // (B legitimately sees A leave and come back: at SFU level A's session really
      // did end. Suppressing that would need a server-side grace period — out of
      // scope, see the spec.)
      clearEvents();
      localStorage.setItem('vycord_token', tokens.a);
      log('closing A\'s signaling socket to force a reconnect');
      svc.a.ws.close();
      await waitFor(() => joined('a', 'snapshot', ids.b).length > 0, 30_000, 'a-reconnected');
      expect(joined('a', 'snapshot', ids.b).length === 1, 'after reconnect A re-discovers B as snapshot', dumpEvents());
      expect(joined('a', 'live').length === 0, 'after reconnect A gets ZERO live joins', dumpEvents());

      finish(
        failures.length === 0,
        failures.length === 0
          ? 'onPeerJoined reports snapshot vs live correctly, including across a reconnect'
          : `${failures.length} assertion(s) failed`,
        { failures, events: dumpEvents() },
      );
    } catch (err) {
      finish(false, String((err && err.message) || err), { failures, events: dumpEvents() });
    } finally {
      for (const who of ['a', 'b', 'c']) {
        try { svc[who]?.leaveGroupCall(); } catch { /* already gone */ }
      }
    }
  </script>
</body>
</html>
```

- [ ] **Step 2: Зарегистрировать сценарий в `client/e2e/run.sh`**

Дописать строку после существующих `run_scenario` (перед `echo "PASS"`):

```bash
run_scenario "join-leave-events" "http://localhost:$VITE_PORT/e2e/join-leave-events.html"
```

- [ ] **Step 3: Запустить тест и убедиться, что он падает**

Run: `cd client && E2E_ONLY=join-leave-events bash e2e/run.sh`
Expected: `FAIL: join-leave-events failed`. Причина — `source` пока `undefined`: провалятся утверждения `A sees B as exactly one live join`, `B sees A as a snapshot peer` и остальные, где сравнивается `source`.

- [ ] **Step 4: Расширить сигнатуру колбэка в `client/src/services/groupCall.ts`**

В интерфейсе `GroupCallCallbacks` (строка 104) заменить:

```ts
  onPeerJoined: (userId: string) => void;
```

на:

```ts
  // source='snapshot' — peer was already in the room when we connected (also fires on
  // every successful auto-reconnect); source='live' — peer arrived just now.
  // Consumers that notify the user must react only to 'live'.
  onPeerJoined: (userId: string, source: 'snapshot' | 'live') => void;
```

- [ ] **Step 5: Передать `'snapshot'` в ветке начального снапшота**

В обработчике `socket.onmessage` ветки `msg.type === 'joined'` (строка ~853) заменить:

```ts
          peers.forEach((uid) => this.callbacks?.onPeerJoined(uid));
```

на:

```ts
          peers.forEach((uid) => this.callbacks?.onPeerJoined(uid, 'snapshot'));
```

- [ ] **Step 6: Передать `'live'` в обработчике `participant_joined`**

В `handleMessage`, `case 'participant_joined'` (строка ~1286) заменить:

```ts
        this.callbacks?.onPeerJoined((msg.payload as ParticipantEventPayload).user_id);
```

на:

```ts
        this.callbacks?.onPeerJoined((msg.payload as ParticipantEventPayload).user_id, 'live');
```

- [ ] **Step 7: Запустить тест и убедиться, что он проходит**

Run: `cd client && E2E_ONLY=join-leave-events bash e2e/run.sh`
Expected: `PASS: join-leave-events`, в `E2E_RESULT` — `"pass":true` и `"failures":[]`.

Если падает шаг 5 (реконнект) с таймаутом `a-reconnected` — смотреть `[E2E]`-строки в логе Chrome (`$WORK_DIR/chrome-join-leave-events.log`): типичная причина — не тот JWT в `localStorage` на момент реконнекта, тогда SFU принимает A за другого пользователя.

- [ ] **Step 8: Проверить типы**

Run: `cd client && ./node_modules/.bin/tsc`
Expected: пустой вывод, код возврата 0. Существующий колбэк в `GroupCallUI.tsx` объявлен с одним параметром — TS разрешает подставлять функцию с меньшим числом параметров, так что ошибок быть не должно. Любая ошибка = регресс, исправить до коммита.

- [ ] **Step 9: Коммит**

```bash
git add client/src/services/groupCall.ts client/e2e/join-leave-events.html client/e2e/run.sh
git commit -m "VYC-49 Добавил источник события в onPeerJoined (snapshot/live)"
```

---

### Task 3: Проигрывание сигналов в `GroupCallUI`

**Files:**
- Modify: `client/src/components/GroupCallUI.tsx` (импорты строки 1–14, `onPeerJoined` строки 474–483, `onPeerLeft` строки 484–496, `handleJoinGroupCall` строки 726–730, `handleLeaveGroupCall` строки 744–750)

**Interfaces:**
- Consumes: `audioService.playUserJoined()` / `audioService.playUserLeft()` из Task 1; параметр `source: 'snapshot' | 'live'` колбэка `onPeerJoined` из Task 2.
- Produces: ничего для последующих задач.

- [ ] **Step 1: Добавить импорт `audioService`**

После строки 9 (`import { apiService } from '@/services/api';`) добавить:

```ts
import { audioService } from '@/services/audio';
```

- [ ] **Step 2: Озвучить чужой вход в `onPeerJoined`**

Заменить тело колбэка (строки 474–483) на:

```ts
      onPeerJoined: (userId, source) => {
        setParticipants((prev) => {
          if (prev.find((p) => p.userId === userId)) return prev;
          return [...prev, { userId, stream: null }];
        });
        // Only a live arrival is an actual join: 'snapshot' peers were already in the
        // room when we connected, which also happens on every auto-reconnect and must
        // stay silent.
        if (source === 'live') audioService.playUserJoined();
        // Fires both when I discover an already-present peer and when someone
        // joins after me — re-announcing my mic state either way is harmless
        // and closes the window where a newly-joined peer doesn't know it yet.
        wsService.send(isMutedRef.current ? 'mic_muted' : 'mic_unmuted', {});
      },
```

- [ ] **Step 3: Озвучить чужой выход в `onPeerLeft`**

В начало тела `onPeerLeft` (перед `setParticipants(...)`, строка 485) добавить:

```ts
        // participant_left only arrives over a live socket: during a reconnect there is
        // no socket, and peers who left meanwhile are simply absent from the snapshot —
        // so this callback always means a real departure.
        audioService.playUserLeft();
```

- [ ] **Step 4: Озвучить свой вход в `handleJoinGroupCall`**

Заменить блок (строки 728–730):

```ts
    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
    }
```

на:

```ts
    if (!alreadyInThisRoom && groupCallService.currentRoomIdState === roomId) {
      wsService.send('voice_joined', { channel_id: roomId });
      // Same predicate as voice_joined: it filters out a repeated click on the active
      // voice channel and the mid-reconnect window where inCall is briefly false.
      audioService.playUserJoined();
    }
```

- [ ] **Step 5: Озвучить свой выход в `handleLeaveGroupCall`**

В блоке `if (channelId) { ... }` (строки 744–750) после `wsService.send('voice_left', ...)` добавить:

```ts
      // Only the deliberate exit chimes. A dropped connection, session_replaced or an
      // exhausted reconnect all land in onCallEnded/onError instead and stay silent —
      // those are connection failures, not someone leaving the call.
      audioService.playUserLeft();
```

- [ ] **Step 6: Проверить типы**

Run: `cd client && ./node_modules/.bin/tsc`
Expected: пустой вывод, код возврата 0.

- [ ] **Step 7: Прогнать весь e2e-набор — существующие сценарии не должны деградировать**

Run: `cd client && bash e2e/run.sh`
Expected: `PASS: voice-sound-tones`, `PASS: no-camera-screenshare`, `PASS: nc-toggle`, `PASS: join-leave-events`, затем итоговый `PASS`.

- [ ] **Step 8: Коммит**

```bash
git add client/src/components/GroupCallUI.tsx
git commit -m "VYC-49 Проигрываю сигналы при входе и выходе участников звонка"
```

---

### Task 4: Тумблер и превью в настройках

**Files:**
- Modify: `client/src/components/settings/AudioSettings.tsx` (локальный стейт строки 9–11, инициализация из настроек строки 27–32, новая строка настройки после блока «Call Sounds» строка 83, кнопки превью в блоке «Test Sounds» строки 110–142)

**Interfaces:**
- Consumes: `voiceSound` из `audioService.getSettings()` / `audioService.updateSettings()`, `audioService.playUserJoined()`, `audioService.playUserLeft()` (Task 1).
- Produces: ничего для последующих задач.

- [ ] **Step 1: Добавить локальный стейт**

После строки 10 (`const [callSound, setCallSound] = useState(true);`) добавить:

```ts
  const [voiceSound, setVoiceSound] = useState(true);
```

- [ ] **Step 2: Инициализировать стейт из сохранённых настроек**

В `useEffect` со чтением настроек (строки 27–32) после `setCallSound(settings.callSound);` добавить:

```ts
    setVoiceSound(settings.voiceSound);
```

- [ ] **Step 3: Добавить строку настройки после блока «Call Sounds»**

Сразу после закрывающего `</div>` блока «Call Sounds» (строка 83) вставить:

```tsx
      <div className="setting-item">
        <div className="setting-info">
          <label>Voice Join/Leave Sounds</label>
          <p className="setting-description">Play a sound when someone joins or leaves a voice call</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            checked={voiceSound}
            onChange={(e) => {
              setVoiceSound(e.target.checked);
              audioService.updateSettings({ voiceSound: e.target.checked });
            }}
          />
          <span className="toggle-slider"></span>
        </label>
      </div>
```

- [ ] **Step 4: Добавить кнопки превью в блок «Test Sounds»**

В `<div style={{ display: 'flex', gap: 8 }}>` после кнопки «📞 Ring» (после строки 141) вставить две кнопки в том же стиле:

```tsx
          <button
            onClick={() => audioService.playUserJoined()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ➡️ Join
          </button>
          <button
            onClick={() => audioService.playUserLeft()}
            style={{
              padding: '6px 14px',
              border: '1.5px solid var(--border-color)',
              borderRadius: 'var(--radius-md)',
              background: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              fontSize: 13,
              cursor: 'pointer',
            }}
          >
            ⬅️ Leave
          </button>
```

- [ ] **Step 5: Проверить типы**

Run: `cd client && ./node_modules/.bin/tsc`
Expected: пустой вывод, код возврата 0.

- [ ] **Step 6: Проверить сборку**

Run: `cd client && npm run build:vite`
Expected: сборка завершается без ошибок.

- [ ] **Step 7: Коммит**

```bash
git add client/src/components/settings/AudioSettings.tsx
git commit -m "VYC-49 Добавил настройку и превью звуков входа/выхода"
```

---

## Ручная проверка после всех задач

Запустить приложение (`cd client && npm run dev`, вторым клиентом — второе окно/машина) и пройти чек-лист из спеки:

- [ ] участник входит в звонок — остальные слышат восходящий сигнал; выходит — нисходящий; на слух различимы;
- [ ] свой вход и свой выход слышны самому пользователю;
- [ ] три-четыре входа/выхода подряд озвучиваются корректно, без каши;
- [ ] Settings → Audio: кнопки «➡️ Join» / «⬅️ Leave» проигрывают правильные сигналы; тумблер «Voice Join/Leave Sounds» глушит только их (рингтон и звук сообщений работают); состояние сохраняется после перезапуска приложения;
- [ ] выключить и включить Wi-Fi у одного из участников: у него после реконнекта **нет** ложных сигналов входа (у остальных вход/выход прозвучит — это реальное поведение SFU, см. «Вне области» в спеке);
- [ ] мьют, шаринг экрана и индикатор качества сигнала работают как раньше.
