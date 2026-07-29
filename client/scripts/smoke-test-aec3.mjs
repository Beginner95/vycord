// Автономная проверка (без браузера/тест-раннера — в проекте их нет): библиотека
// AEC3 грузится в Node и реально подавляет коррелированный сигнал. Не проверяет
// нашу воркер/воркет-обвязку (она требует браузер — см. e2e), только сам факт,
// что зависимость установлена, WASM грузится и алгоритм работает как ожидается.
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

let failed = false;
function assert(cond, msg) {
  if (!cond) {
    console.error('FAIL:', msg);
    failed = true;
  } else {
    console.log('OK:', msg);
  }
}

function rms(buf) {
  let sum = 0;
  for (const v of buf) sum += v * v;
  return Math.sqrt(sum / buf.length);
}

const WebRtcAec3 = require('@ennuicastr/webrtcaec3.js');
const AEC3 = await WebRtcAec3();
const aec = new AEC3.AEC3(48000, 1, 1);

assert(typeof aec.analyze === 'function', 'AEC3 instance exposes analyze()');
assert(typeof aec.process === 'function', 'AEC3 instance exposes process()');

// AEC3 требует 10мс-фреймы @48kHz = 480 сэмплов — фиксированный контракт библиотеки.
const FRAME = 480;
let phase = 0;
function makeToneFrame(freq) {
  const f = new Float32Array(FRAME);
  for (let i = 0; i < FRAME; i++) {
    f[i] = 0.5 * Math.sin(phase);
    phase += (2 * Math.PI * freq) / 48000;
  }
  return f;
}

// Идеальное самоэхо без задержки: 200 фреймов (2с) одного и того же тона на
// render и capture. После сходимости фильтра выход должен быть тихим.
let lastOut = new Float32Array(0);
for (let i = 0; i < 200; i++) {
  const render = makeToneFrame(440);
  const capture = render.slice();
  aec.analyze([render]);
  const outSz = aec.processSize([capture]);
  const outBuf = [new Float32Array(outSz)];
  aec.process(outBuf, [capture]);
  lastOut = outBuf[0];
}

const inputRms = rms(makeToneFrame(440));
const outputRms = rms(lastOut);
assert(lastOut.every((v) => Number.isFinite(v)), 'process() output contains only finite samples (no NaN/Infinity)');
assert(
  outputRms < inputRms * 0.1,
  `after convergence, correlated echo is suppressed by >20dB (input rms=${inputRms.toFixed(4)}, output rms=${outputRms.toFixed(4)})`,
);

aec.free();

if (failed) {
  console.error('AEC3 smoke test FAILED');
  process.exit(1);
}
console.log('AEC3 smoke test PASSED');
