export const STICKER_MAX_BYTES = 2 * 1024 * 1024;
export const ALLOWED_STICKER_TYPES = ['image/png', 'image/jpeg', 'image/gif'];

// Возвращает i18n-ключ ошибки, если файл не проходит валидацию, иначе null.
export function validateStickerFile(file: { type: string; size: number }): string | null {
  if (!ALLOWED_STICKER_TYPES.includes(file.type)) {
    return 'stickerInvalidFormat';
  }
  if (file.size > STICKER_MAX_BYTES) {
    return 'sticker_file_too_large';
  }
  return null;
}