import { describe, it, expect } from 'vitest';
import { isInAppBrowser } from '../inAppBrowser';

describe('isInAppBrowser', () => {
  it('распознаёт Instagram-вебвью', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) Instagram 300.0.0')).toBe(true);
  });
  it('распознаёт TikTok-вебвью', () => {
    expect(isInAppBrowser('Mozilla/5.0 (Linux; Android 13) TikTok 32.0.0')).toBe(true);
  });
  it('не срабатывает на обычном Chrome', () => {
    expect(isInAppBrowser('Mozilla/5.0 (iPhone) AppleWebKit/605.1.15 Chrome/120.0')).toBe(false);
  });
});
