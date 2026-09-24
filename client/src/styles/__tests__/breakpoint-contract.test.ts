import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VYC-95, спека §2 — один мобильный брейкпоинт.
 *
 * До VYC-95 оболочка переключалась на `width < 900px`, а 17 компонентных
 * блоков остались на `<= 768px` (плюс `<= 640px`, `<= 720px`): в полосе
 * 769–899 раскладка была мобильной, а компоненты — десктопными. Тест
 * фиксирует допустимый набор условий по ширине. Наследие перечислено
 * ТОЧНО (файл → условие → число вхождений): и новый нарушитель, и
 * исправленный блок требуют правки этого списка. Этап 7 опустошил его:
 * наследия больше нет, `LEGACY` пуст. Константа оставлена как дом для
 * будущего ОБОСНОВАННОГО исключения — добавляйте запись «файл → условие →
 * число вхождений» только вместе с комментарием, почему блок не может
 * жить на `ALLOWED`-условиях.
 */

const ALLOWED = new Set([
  'width < 900px',            // мобильная модель
  'width >= 900px',           // десктоп
  '900px <= width < 1200px',  // десктопный бенд AppPage (M6 T8)
  'width < 1200px',           // десктопный бенд AppPage (M6 T8)
]);

const LEGACY: Record<string, Record<string, number>> = {};

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

function cssFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : cssFiles(p);
    return p.endsWith('.css') ? [p] : [];
  });
}

/** Условия по ширине из всех @media-прелюдий файла, комментарии вырезаны. */
function widthConditions(css: string): string[] {
  const stripped = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const preludes = [...stripped.matchAll(/@media([^{]*)\{/g)].map((m) => m[1]);
  return preludes.flatMap((p) =>
    [...p.matchAll(/\(([^()]*\bwidth\b[^()]*)\)/g)].map((m) => m[1].replace(/\s+/g, ' ').trim()),
  );
}

describe('breakpoint contract (VYC-95 §2)', () => {
  const found: Record<string, Record<string, number>> = {};
  for (const file of cssFiles(SRC)) {
    const rel = relative(SRC, file);
    for (const cond of widthConditions(readFileSync(file, 'utf8'))) {
      if (ALLOWED.has(cond)) continue;
      found[rel] ??= {};
      found[rel][cond] = (found[rel][cond] ?? 0) + 1;
    }
  }

  it('the scanner reports width conditions from CSS text (non-vacuous)', () => {
    const css = `
      /* @media (width <= 100px) { } — комментарий не считается */
      @media (width <= 768px) { .x { color: red } }
      @media (width < 900px) { .y { color: blue } }
    `;
    expect(widthConditions(css)).toEqual(['width <= 768px', 'width < 900px']);
  });

  it('the scanner sees the real mobile query in the tree', () => {
    const all = cssFiles(SRC).flatMap((f) => widthConditions(readFileSync(f, 'utf8')));
    expect(all).toContain('width < 900px');
  });

  it('every width condition is allowed or is exactly-listed legacy', () => {
    expect(found).toEqual(LEGACY);
  });
});
