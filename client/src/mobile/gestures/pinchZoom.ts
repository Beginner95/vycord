export interface PinchZoomState {
  scale: number;
  x: number;
  y: number;
}

export type PinchZoomEvent =
  | { type: 'pinch'; startDist: number; dist: number; midX: number; midY: number }
  | { type: 'pan'; dx: number; dy: number }
  | { type: 'doubleTap' }
  | { type: 'reset' };

const MIN_SCALE = 1;
const MAX_SCALE = 4;
const IDLE: PinchZoomState = { scale: 1, x: 0, y: 0 };

/** Чистая машина состояния зума видео демонстрации (спека §6.2). midX/midY
 *  зарезервированы для будущего зума «от точки», сейчас не используются —
 *  зум всегда от центра, а pan двигает изображение отдельным жестом. */
export function pinchZoomReducer(state: PinchZoomState, event: PinchZoomEvent): PinchZoomState {
  switch (event.type) {
    case 'pinch': {
      const ratio = event.startDist > 0 ? event.dist / event.startDist : 1;
      const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, state.scale * ratio));
      if (scale <= MIN_SCALE) return IDLE;
      return { ...state, scale };
    }
    case 'pan':
      if (state.scale <= MIN_SCALE) return state;
      return { ...state, x: state.x + event.dx, y: state.y + event.dy };
    case 'doubleTap':
    case 'reset':
      return IDLE;
    default:
      return state;
  }
}

export { IDLE as PINCH_ZOOM_IDLE };
