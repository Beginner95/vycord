import { useEffect, useRef, useState } from 'react';
import { X, ZoomIn } from 'lucide-react';
import { apiErrorText } from '@/services/api';
import { t, useT } from '@/i18n';
import './AvatarCropModal.css';

const CANVAS_SIZE = 320;
const CIRCLE_RADIUS = 130;
const CIRCLE_DIAMETER = CIRCLE_RADIUS * 2;
const OUTPUT_SIZE = 512;
const MIN_ZOOM = 1;
const MAX_ZOOM = 4;

interface Offset {
  x: number;
  y: number;
}

interface AvatarCropModalProps {
  file: File;
  title?: string;
  onCancel: () => void;
  onUpload: (blob: Blob) => Promise<void>;
}

function clampOffset(x: number, y: number, zoom: number, img: HTMLImageElement, baseScale: number): Offset {
  const drawWidth = img.naturalWidth * baseScale * zoom;
  const drawHeight = img.naturalHeight * baseScale * zoom;
  const maxX = Math.max(0, (drawWidth - CIRCLE_DIAMETER) / 2);
  const maxY = Math.max(0, (drawHeight - CIRCLE_DIAMETER) / 2);
  return {
    x: Math.min(maxX, Math.max(-maxX, x)),
    y: Math.min(maxY, Math.max(-maxY, y)),
  };
}

// Renders the crop into a plain square 512×512 JPEG — no transparency, no
// baked-in circle. The circular look comes purely from CSS border-radius
// wherever the avatar is displayed; clipping a circle here would leave the
// square's corners transparent, which JPEG (no alpha channel) turns black.
function exportCroppedBlob(img: HTMLImageElement, baseScale: number, zoom: number, offset: Offset): Promise<Blob> {
  const output = document.createElement('canvas');
  output.width = OUTPUT_SIZE;
  output.height = OUTPUT_SIZE;
  const ctx = output.getContext('2d');
  // Функция живёт вне компонента, хука здесь нет — берём нереактивный t.
  // Текст сразу уходит в setError и дальше не перерисовывается.
  if (!ctx) return Promise.reject(new Error(t('common.canvasUnsupported')));

  const ratio = OUTPUT_SIZE / CIRCLE_DIAMETER;
  const drawWidth = img.naturalWidth * baseScale * zoom * ratio;
  const drawHeight = img.naturalHeight * baseScale * zoom * ratio;
  ctx.translate(OUTPUT_SIZE / 2 + offset.x * ratio, OUTPUT_SIZE / 2 + offset.y * ratio);
  ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return new Promise((resolve, reject) => {
    output.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error(t('common.imageExportFailed')))),
      'image/jpeg',
      0.92
    );
  });
}

export function AvatarCropModal({ file, title, onCancel, onUpload }: AvatarCropModalProps) {
  const t = useT();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const draggingRef = useRef(false);
  const lastPointRef = useRef<Offset>({ x: 0, y: 0 });

  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [baseScale, setBaseScale] = useState(1);
  const [zoom, setZoom] = useState(MIN_ZOOM);
  const [offset, setOffset] = useState<Offset>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const objectUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.max(CIRCLE_DIAMETER / image.naturalWidth, CIRCLE_DIAMETER / image.naturalHeight);
      setBaseScale(scale);
      setZoom(MIN_ZOOM);
      setOffset({ x: 0, y: 0 });
      setImg(image);
    };
    image.onerror = () => setError(t('common.imageOpenFailed'));
    image.src = objectUrl;
    return () => URL.revokeObjectURL(objectUrl);
  }, [file]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !img) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

    const drawWidth = img.naturalWidth * baseScale * zoom;
    const drawHeight = img.naturalHeight * baseScale * zoom;
    ctx.save();
    ctx.translate(CANVAS_SIZE / 2 + offset.x, CANVAS_SIZE / 2 + offset.y);
    ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);
    ctx.restore();

    ctx.save();
    ctx.fillStyle = 'rgba(15, 17, 23, 0.6)';
    ctx.beginPath();
    ctx.rect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.fill('evenodd');
    ctx.beginPath();
    ctx.arc(CANVAS_SIZE / 2, CANVAS_SIZE / 2, CIRCLE_RADIUS, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
  }, [img, baseScale, zoom, offset]);

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    draggingRef.current = true;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!draggingRef.current || !img) return;
    const dx = e.clientX - lastPointRef.current.x;
    const dy = e.clientY - lastPointRef.current.y;
    lastPointRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => clampOffset(prev.x + dx, prev.y + dy, zoom, img, baseScale));
  };

  const handlePointerUp = () => {
    draggingRef.current = false;
  };

  const handleWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!img) return;
    e.preventDefault();
    const delta = e.deltaY > 0 ? -0.1 : 0.1;
    const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom + delta));
    setZoom(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next, img, baseScale));
  };

  const handleZoomSlider = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!img) return;
    const next = parseFloat(e.target.value);
    setZoom(next);
    setOffset((prev) => clampOffset(prev.x, prev.y, next, img, baseScale));
  };

  const handleSaveClick = async () => {
    if (!img) return;
    setError(null);
    setSaving(true);
    try {
      const blob = await exportCroppedBlob(img, baseScale, zoom, offset);
      await onUpload(blob);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={saving ? undefined : onCancel}>
      <div className="modal avatar-crop-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2 className="modal-title">{title ?? t('settings.cropAvatarTitle')}</h2>
          <button
            type="button"
            className="modal-close-btn"
            title={t('common.cancel')}
            aria-label={t('common.cancel')}
            onClick={onCancel}
          >
            <X size={16} strokeWidth={1.8} />
          </button>
        </div>

        <canvas
          ref={canvasRef}
          className="avatar-crop-canvas"
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerLeave={handlePointerUp}
          onWheel={handleWheel}
        />

        <div className="avatar-crop-zoom">
          <span className="avatar-crop-zoom-icon">
            <ZoomIn size={16} strokeWidth={1.8} />
          </span>
          <input
            type="range"
            className="slider-input"
            min={MIN_ZOOM}
            max={MAX_ZOOM}
            step={0.05}
            value={zoom}
            // --slider-fill красит пройденную часть дорожки в primitives.css;
            // значение JS-инъекционное, поэтому в CSS оно всегда с fallback.
            style={{
              '--slider-fill': `${Math.round(((zoom - MIN_ZOOM) / (MAX_ZOOM - MIN_ZOOM)) * 100)}%`,
            } as React.CSSProperties}
            onChange={handleZoomSlider}
            disabled={!img}
          />
        </div>

        {error && <p className="avatar-crop-error">{error}</p>}

        <div className="modal-actions">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={saving}>
            {t('common.cancel')}
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleSaveClick}
            disabled={!img || saving}
          >
            {saving ? t('common.saving') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  );
}
