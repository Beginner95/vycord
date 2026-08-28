import { resolveUploadUrl } from '@/services/api';

/**
 * Ссылка, по которой файл именно скачивается, а не открывается.
 *
 * Флаг download=1 обязателен: API и фронт живут на разных доменах, а атрибут
 * <a download> браузер для кросс-доменной ссылки игнорирует — имя файла
 * терялось бы. С этим флагом имя задаёт сервер в Content-Disposition.
 */
export function downloadUrl(url: string): string {
  const abs = resolveUploadUrl(url) ?? url;
  return abs.includes('?') ? `${abs}&download=1` : `${abs}?download=1`;
}
