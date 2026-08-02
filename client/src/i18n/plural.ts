export type PluralForms = {
  one: string;
  few?: string;
  many?: string;
  other: string;
};

/**
 * Возвращает намеренно широкий тип PluralForms, а не литеральный: благодаря
 * этому en.ts может задать только { one, other } и всё равно совпасть
 * с `typeof ru`, где у русских записей есть ещё few и many.
 */
export function plural(forms: PluralForms): PluralForms {
  return forms;
}
