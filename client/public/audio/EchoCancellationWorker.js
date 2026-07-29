// Классический (не module) Web Worker — обёртка над @ennuicastr/webrtcaec3.js
// (WASM-порт настоящего WebRTC AEC3). Библиотека синхронная (README прямо
// рекомендует гонять её в воркере), поэтому вся работа с AEC3-инстансом идёт
// здесь, а не в реалтайм-потоке AudioWorklet'а.
//
// importScripts резолвит путь относительно этого файла — webrtcaec3-0.3.0.js
// и .wasm лежат рядом в public/audio/ (см. copy-audio-assets).
importScripts('webrtcaec3-0.3.0.js');

let aec = null;

async function handleInit(msg, replyPort) {
  try {
    const AEC3 = await self.WebRtcAec3();
    aec = new AEC3.AEC3(msg.sampleRate, msg.renderChannels, msg.captureChannels);
    replyPort.postMessage({ type: 'INIT_OK' });
  } catch (err) {
    replyPort.postMessage({ type: 'ERROR', error: String((err && err.message) || err) });
  }
}

function handleFrame(msg, replyPort) {
  if (!aec) return;
  const renderFrame = [msg.ref];
  const captureFrame = [msg.cap];
  aec.analyze(renderFrame);
  const outSize = aec.processSize(captureFrame);
  const outBuf = [new Float32Array(outSize)];
  aec.process(outBuf, captureFrame);
  replyPort.postMessage({ type: 'FRAME_RESULT', out: outBuf[0] }, [outBuf[0].buffer]);
}

self.onmessage = (event) => {
  const msg = event.data;
  if (msg.type !== 'CONNECT_PORT') return;
  const port = msg.port;
  port.onmessage = (e) => {
    const m = e.data;
    if (m.type === 'INIT') {
      handleInit(m, port);
    } else if (m.type === 'PROCESS_FRAME') {
      handleFrame(m, port);
    } else if (m.type === 'FREE') {
      aec?.free();
      aec = null;
    }
  };
};
