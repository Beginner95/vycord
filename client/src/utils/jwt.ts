/**
 * Декодирует поле exp из JWT без проверки подписи — только для клиентского
 * планирования (когда проактивно обновить access-токен). Сервер — источник
 * истины по валидности; здесь ошибка парсинга просто означает "не знаем,
 * когда истекает", а не "токен невалиден".
 */
export function decodeJwtExpMs(token: string): number | null {
  try {
    const payload = token.split('.')[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, '+').replace(/_/g, '/');
    const json = atob(normalized);
    const claims = JSON.parse(json) as { exp?: unknown };
    return typeof claims.exp === 'number' ? claims.exp * 1000 : null;
  } catch {
    return null;
  }
}
