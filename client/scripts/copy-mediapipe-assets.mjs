// Копирует wasm MediaPipe Tasks из node_modules и скачивает модель
// selfie_multiclass_256x256 в public/vision/ (в dev vite раздаёт public/
// с корня; в проде файлы попадают в dist/vision/, откуда их грузит IPC
// get-vision-assets-url-sync).
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const wasmSrc = join(root, 'node_modules/@mediapipe/tasks-vision/wasm');
const dst = join(root, 'public/vision');
const modelUrl =
  'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_multiclass_256x256/float32/latest/selfie_multiclass_256x256.tflite';
const modelDst = join(dst, 'selfie_multiclass_256x256.tflite');

mkdirSync(dst, { recursive: true });
cpSync(wasmSrc, dst, { recursive: true });

if (existsSync(modelDst)) {
  console.log('copy-mediapipe-assets: модель уже на месте, пропускаю download');
} else {
  const res = await fetch(modelUrl);
  if (!res.ok) throw new Error(`model download failed: HTTP ${res.status}`);
  writeFileSync(modelDst, Buffer.from(await res.arrayBuffer()));
  console.log('copy-mediapipe-assets: selfie_multiclass_256x256.tflite скачана');
}

const files = readFileSync(join(dst, 'vision_wasm_internal.js'), 'utf8').length > 0;
if (!files) throw new Error('vision_wasm_internal.js не скопировался');
console.log('copy-mediapipe-assets: OK');