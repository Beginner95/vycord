import { hasKey, type TFunc, type TKey } from '@/i18n';

/**
 * Текст ошибки гостя. Сервер присылает стабильный code — по нему и переводим;
 * если код клиенту неизвестен (старый клиент против нового сервера), остаётся
 * серверный текст, как и в apiErrorText для аккаунта.
 */
export function guestErrorText(error: { code?: string; message: string } | null, t: TFunc): string {
  if (!error) return '';
  const key = `errors.${error.code ?? ''}`;
  return error.code && hasKey(key) ? t(key as TKey) : error.message;
}
