import { describe, it, expect } from 'vitest';
import { pinchZoomReducer, type PinchZoomState } from '../pinchZoom';

const idle: PinchZoomState = { scale: 1, x: 0, y: 0 };

describe('pinchZoomReducer', () => {
  it('два пальца раздвигаются — увеличение пропорционально дистанции', () => {
    const next = pinchZoomReducer(idle, { type: 'pinch', startDist: 100, dist: 200, midX: 0, midY: 0 });
    expect(next.scale).toBeCloseTo(2, 5);
  });
  it('масштаб зажат в [1, 4]', () => {
    const huge = pinchZoomReducer(idle, { type: 'pinch', startDist: 100, dist: 1000, midX: 0, midY: 0 });
    expect(huge.scale).toBe(4);
    const shrink = pinchZoomReducer({ scale: 2, x: 0, y: 0 }, { type: 'pinch', startDist: 100, dist: 10, midX: 0, midY: 0 });
    expect(shrink.scale).toBeGreaterThanOrEqual(1);
  });
  it('scale=1 после pinch до <1 сбрасывает смещение в 0', () => {
    const next = pinchZoomReducer({ scale: 2, x: 40, y: 40 }, { type: 'pinch', startDist: 100, dist: 50, midX: 0, midY: 0 });
    expect(next).toEqual({ scale: 1, x: 0, y: 0 });
  });
  it('двойной тап сбрасывает в исходное состояние', () => {
    expect(pinchZoomReducer({ scale: 3, x: 50, y: -20 }, { type: 'doubleTap' })).toEqual(idle);
  });
  it('reset — то же, что двойной тап', () => {
    expect(pinchZoomReducer({ scale: 3, x: 50, y: -20 }, { type: 'reset' })).toEqual(idle);
  });
  it('pan сдвигает x/y только когда scale > 1', () => {
    expect(pinchZoomReducer(idle, { type: 'pan', dx: 30, dy: 10 })).toEqual(idle);
    expect(pinchZoomReducer({ scale: 2, x: 0, y: 0 }, { type: 'pan', dx: 30, dy: 10 })).toEqual({ scale: 2, x: 30, y: 10 });
  });
});
