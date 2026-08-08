import { describe, expect, it } from 'vitest';
import { toggleWrap, toggleQuote, toggleBullet, toggleNumbered } from '@/utils/textTransforms';

describe('toggleWrap', () => {
  it('оборачивает выделение', () => {
    expect(toggleWrap('abc', 1, 2, '**')).toEqual({ value: 'a**b**c', start: 3, end: 4, allPrefixed: false });
  });
  it('сворачивает, если маркеры в выделении', () => {
    expect(toggleWrap('a**b**c', 1, 6, '**')).toEqual({ value: 'abc', start: 1, end: 2, allPrefixed: false });
  });
  it('коллапсированная позиция — пустая пара маркеров', () => {
    expect(toggleWrap('abc', 1, 1, '**')).toEqual({ value: 'a****bc', start: 3, end: 3, allPrefixed: false });
  });
});

describe('toggleQuote', () => {
  it('добавляет > к выбранной строке (выделение смещается на внутренний текст)', () => {
    expect(toggleQuote('a\nb', 0, 1)).toEqual({ value: '> a\nb', start: 2, end: 3, allPrefixed: false });
  });
  it('убирает > , если строка уже процитирована', () => {
    expect(toggleQuote('> a', 0, 3)).toEqual({ value: 'a', start: 0, end: 1, allPrefixed: true });
  });
});

describe('toggleBullet', () => {
  it('добавляет "- " (выделение смещается на внутренний текст)', () => {
    expect(toggleBullet('a\nb', 0, 1)).toEqual({ value: '- a\nb', start: 2, end: 3, allPrefixed: false });
  });
});

describe('toggleNumbered', () => {
  it('добавляет "1. " (выделение смещается на внутренний текст)', () => {
    expect(toggleNumbered('a\nb', 0, 1)).toEqual({ value: '1. a\nb', start: 3, end: 4, allPrefixed: false });
  });
  it('убирает номера со всех выбранных строк', () => {
    expect(toggleNumbered('1. a\n2. b', 0, 9)).toEqual({ value: 'a\nb', start: 0, end: 3, allPrefixed: true });
  });
});