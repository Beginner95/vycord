// Подписи меню трея живут в main-процессе, у которого нет доступа
// ни к localStorage рендерера, ни к его словарям: electron/tsconfig.json
// собирает main отдельно. Ради двух строк дублирование дешевле, чем
// связность между двумя сборками.
export type TrayLocale = 'ru' | 'en';

export const TRAY_LABELS: Record<TrayLocale, { open: string; quit: string }> = {
  ru: { open: 'Открыть Vy Cord', quit: 'Выход' },
  en: { open: 'Open Vy Cord', quit: 'Quit' },
};

export function isTrayLocale(value: unknown): value is TrayLocale {
  return value === 'ru' || value === 'en';
}
