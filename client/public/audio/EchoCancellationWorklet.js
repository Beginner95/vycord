// AudioWorkletProcessor с двумя входами: referenceBus (звук звонка) и
// захваченный системный звук (loopback шаринга экрана). Буферизует
// 128-сэмпловые render-кванты в 480-сэмпловые (10мс @48kHz) фреймы —
// фиксированный контракт AEC3 (см. EchoCancellationWorker.js) — и пересылает
// их в Worker через MessagePort. Выход — очищенный системный звук; пока не
// накопится хотя бы один обработанный фрейм (инициализация, либо воркер не
// успевает), проксирует сырой захваченный сигнал, чтобы звук шаринга не
// пропадал совсем — только временно не подавляется эхо.

const FRAME_SIZE = 480;

function concatF32(a, b) {
  const out = new Float32Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

class EchoCancellationProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.dataPort = null;
    this.refAccum = new Float32Array(0);
    this.capAccum = new Float32Array(0);
    this.outQueue = new Float32Array(0);

    this.port.onmessage = (event) => {
      if (event.data && event.data.type === 'INIT_PORT') {
        this.dataPort = event.data.dataPort;
        this.dataPort.onmessage = (e) => {
          if (e.data && e.data.type === 'FRAME_RESULT') {
            this.outQueue = concatF32(this.outQueue, e.data.out);
          }
        };
      }
    };
  }

  process(inputs, outputs) {
    const refIn = (inputs[0] && inputs[0][0]) || new Float32Array(128);
    const capIn = (inputs[1] && inputs[1][0]) || new Float32Array(128);
    const out = outputs[0][0];
    if (!out) return true;

    if (this.dataPort) {
      this.refAccum = concatF32(this.refAccum, refIn);
      this.capAccum = concatF32(this.capAccum, capIn);
      while (this.refAccum.length >= FRAME_SIZE && this.capAccum.length >= FRAME_SIZE) {
        const refFrame = this.refAccum.slice(0, FRAME_SIZE);
        const capFrame = this.capAccum.slice(0, FRAME_SIZE);
        this.refAccum = this.refAccum.slice(FRAME_SIZE);
        this.capAccum = this.capAccum.slice(FRAME_SIZE);
        this.dataPort.postMessage(
          { type: 'PROCESS_FRAME', ref: refFrame, cap: capFrame },
          [refFrame.buffer, capFrame.buffer],
        );
      }
    }

    if (this.outQueue.length >= out.length) {
      out.set(this.outQueue.subarray(0, out.length));
      this.outQueue = this.outQueue.slice(out.length);
    } else {
      // Недобор (старт, либо воркер отстаёт) — пропускаем сырой захваченный
      // сигнал, чтобы звук шаринга не прерывался; эхо в эти миллисекунды не
      // подавляется.
      out.set(capIn.subarray(0, out.length));
    }

    return true;
  }
}

registerProcessor('echo-cancellation-processor', EchoCancellationProcessor);
