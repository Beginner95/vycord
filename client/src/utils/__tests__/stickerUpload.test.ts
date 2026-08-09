import { describe, it, expect } from 'vitest';
import { validateStickerFile, STICKER_MAX_BYTES } from '@/utils/stickerUpload';

describe('validateStickerFile', () => {
  it('accepts png, jpeg and gif', () => {
    expect(validateStickerFile({ type: 'image/png', size: 100 })).toBeNull();
    expect(validateStickerFile({ type: 'image/jpeg', size: 100 })).toBeNull();
    expect(validateStickerFile({ type: 'image/gif', size: 100 })).toBeNull();
  });

  it('rejects unsupported formats', () => {
    expect(validateStickerFile({ type: 'image/webp', size: 100 })).toBe('stickerInvalidFormat');
    expect(validateStickerFile({ type: 'text/plain', size: 100 })).toBe('stickerInvalidFormat');
  });

  it('rejects files over the size limit', () => {
    expect(validateStickerFile({ type: 'image/png', size: STICKER_MAX_BYTES + 1 }))
      .toBe('sticker_file_too_large');
  });
});