import { describe, it, expect } from 'vitest';
import { formatCallDuration, stageGridClass, SPEAKING_THRESHOLD, mobileGridLayout } from './callStage';

describe('formatCallDuration', () => {
  it('zero → 00:00', () => expect(formatCallDuration(0)).toBe('00:00'));
  it('pads minutes and seconds', () => expect(formatCallDuration(64_000)).toBe('01:04'));
  it('12:04 like the board', () => expect(formatCallDuration(724_000)).toBe('12:04'));
  it('59:59 stays mm:ss', () => expect(formatCallDuration(3_599_000)).toBe('59:59'));
  it('hours roll over', () => expect(formatCallDuration(3_661_000)).toBe('1:01:01'));
  it('negative clamps to 00:00', () => expect(formatCallDuration(-5)).toBe('00:00'));
  it('NaN clamps to 00:00', () => expect(formatCallDuration(Number.NaN)).toBe('00:00'));
});

describe('stageGridClass (board 1e: 1 col ≤1, 2 cols ≤4, 3 beyond)', () => {
  it('solo', () => expect(stageGridClass(1)).toBe('is-solo'));
  it('2–4 → default two columns', () => {
    expect(stageGridClass(2)).toBe('');
    expect(stageGridClass(4)).toBe('');
  });
  it('5+ → three columns', () => expect(stageGridClass(5)).toBe('is-many'));
  it('threshold is the existing 0.05', () => expect(SPEAKING_THRESHOLD).toBe(0.05));
});

describe('mobileGridLayout', () => {
  it('1 участник — весь экран, без прокрутки', () => {
    expect(mobileGridLayout(1, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
  it('2 участника, портрет — одна колонка (вертикально)', () => {
    expect(mobileGridLayout(2, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
  it('2 участника, пейзаж — две колонки (горизонтально)', () => {
    expect(mobileGridLayout(2, 'landscape')).toEqual({ columns: 2, scroll: false });
  });
  it('3 участника — 2×2, без прокрутки', () => {
    expect(mobileGridLayout(3, 'portrait')).toEqual({ columns: 2, scroll: false });
  });
  it('4 участника — 2×2, без прокрутки', () => {
    expect(mobileGridLayout(4, 'portrait')).toEqual({ columns: 2, scroll: false });
  });
  it('5 участников — 2 колонки, с прокруткой', () => {
    expect(mobileGridLayout(5, 'portrait')).toEqual({ columns: 2, scroll: true });
  });
  it('12 участников, пейзаж — тоже 2 колонки, прокрутка', () => {
    expect(mobileGridLayout(12, 'landscape')).toEqual({ columns: 2, scroll: true });
  });
  it('0 участников — как 1 (не бывает в звонке без себя, защитный случай)', () => {
    expect(mobileGridLayout(0, 'portrait')).toEqual({ columns: 1, scroll: false });
  });
});
