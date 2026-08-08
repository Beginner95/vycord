import { describe, expect, it } from 'vitest';
import { parseInline, blockify, isUnsafeUrl, normalizeLinkHref } from '@/utils/markdown';

describe('parseInline', () => {
  it('жирный **b**', () => {
    expect(parseInline('**b**')).toEqual([{ type: 'strong', children: [{ type: 'text', text: 'b' }] }]);
  });
  it('курсив *i*', () => {
    expect(parseInline('*i*')).toEqual([{ type: 'em', children: [{ type: 'text', text: 'i' }] }]);
  });
  it('подчёркнутый __u__', () => {
    expect(parseInline('__u__')).toEqual([{ type: 'u', children: [{ type: 'text', text: 'u' }] }]);
  });
  it('ссылка [label](https://a.com)', () => {
    expect(parseInline('[s](https://a.com)')).toEqual([
      { type: 'link', label: [{ type: 'text', text: 's' }], url: 'https://a.com' },
    ]);
  });
  it('несмешанный текст и голый URL', () => {
    expect(parseInline('go https://ex.com now')).toEqual([
      { type: 'text', text: 'go ' },
      { type: 'link', label: [{ type: 'text', text: 'https://ex.com' }], url: 'https://ex.com' },
      { type: 'text', text: ' now' },
    ]);
  });
  it('небезопасная ссылка остаётся текстом', () => {
    expect(parseInline('[x](javascript:alert(1))')).toEqual([{ type: 'text', text: '[x](javascript:alert(1))' }]);
  });
  it('незакрытый маркер — обычный текст', () => {
    expect(parseInline('**open')).toEqual([{ type: 'text', text: '**open' }]);
  });
});

describe('blockify', () => {
  it('цитаты группируются', () => {
    expect(blockify('> a\n> b')).toEqual([{ kind: 'quote', text: 'a\nb' }]);
  });
  it('нумерованный список', () => {
    expect(blockify('1. a\n2. b')).toEqual([{ kind: 'ol', items: ['a', 'b'] }]);
  });
  it('маркированный список', () => {
    expect(blockify('- a\n- b')).toEqual([{ kind: 'ul', items: ['a', 'b'] }]);
  });
  it('смешанные блоки', () => {
    expect(blockify('plain\n- a')).toEqual([
      { kind: 'plain', text: 'plain' },
      { kind: 'ul', items: ['a'] },
    ]);
  });
});

describe('isUnsafeUrl / normalizeLinkHref', () => {
  it('unsafe', () => {
    expect(isUnsafeUrl('javascript:alert(1)')).toBe(true);
    expect(isUnsafeUrl('data:text/html,x')).toBe(true);
  });
  it('safe', () => {
    expect(isUnsafeUrl('https://a.com')).toBe(false);
    expect(isUnsafeUrl('http://a.com')).toBe(false);
    expect(isUnsafeUrl('mailto:a@b.c')).toBe(false);
  });
  it('normalize www', () => {
    expect(normalizeLinkHref('www.example.com')).toBe('https://www.example.com');
    expect(normalizeLinkHref('https://a.com')).toBe('https://a.com');
  });
});