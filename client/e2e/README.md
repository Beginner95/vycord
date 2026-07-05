# E2E: screen share from a machine without a camera (VYC-22)

Регрессионный тест бага «при шаринге экрана с компьютера без камеры зрители видят
чёрный экран».

## Что проверяется

Сценарий гоняется через **настоящий стек**: реальный Go SFU (pion), реальный
`groupCallService` из `src/services/groupCall.ts`, реальный Chrome (headless).
Моков сигналинга/WebRTC нет — подменяются только устройства:

- `getUserMedia`: аудио — синтетический трек (WebAudio), любой запрос с видео —
  `NotFoundError`, как на машине без камеры;
- `getDisplayMedia`: анимированный canvas-трек вместо захвата экрана.

Шаги (`no-camera-screenshare.html`):

1. Два участника (sharer без камеры + viewer) заходят в одну комнату.
2. Baseline: аудио sharer'а доходит до viewer'а (ICE/DTLS/форвардинг живы).
3. До начала шаринга у viewer'а **нет** видеотрека от sharer'а
   (dummy-трек не должен утекать в эфир).
4. Sharer стартует шаринг → viewer должен получить видеотрек и **реально
   декодировать кадры** (`requestVideoFrameCallback`, ≥10 кадров) — просто
   наличие трека не считается успехом, чёрный экран так не отличить.
5. Стоп и повторный старт шаринга → кадры должны пойти снова
   (регрессия на `replaceTrack(null)` → `replaceTrack(screen)`).

Результат — одна строка `E2E_RESULT {json}` в консоли страницы; `run.sh` её
парсит и возвращает exit code 0/1.

## Запуск

```bash
cd client
npm run test:e2e        # или: bash e2e/run.sh
```

Требуется: go, google-chrome, node ≥ 20.19 (раннер сам подхватит новейший
из `~/.nvm/versions/node`, если системный старый). Порты по умолчанию:
SFU — 18081, vite — 13999 (переопределяются `SFU_PORT`/`VITE_PORT`).

## Корневая причина бага (для истории)

Без камеры клиент резервировал видеосекцию через `addTransceiver('video',
{direction:'sendrecv'})` **без трека**. По JSEP §5.10 Chrome сопоставляет с
m-секциями серверного оффера только трансиверы, созданные `addTrack`, поэтому
такой трансивер оставался несвязанным (`mid=null`), в answer уходило
`a=inactive` без `a=ssrc`, и `replaceTrack(screenTrack)` не отправлял ни
одного RTP-пакета. Вдобавок pion не биндит незаявленный SSRC для не-simulcast
треков. Фикс — dummy-видеотрек через `canvas.captureStream(0)` + `addTrack`
(`createDummyVideoTrack` в `groupCall.ts`).

Проверка валидности теста: на коде без фикса тест падает на шаге 4
(`timeout waiting for: viewer-got-video-track`), с фиксом — проходит.
