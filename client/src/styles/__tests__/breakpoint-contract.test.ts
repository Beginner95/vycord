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
 * исправленный блок требуют правки этого списка. Этап 7 опустошает его.
 */

const ALLOWED = new Set([
  'width < 900px',            // мобильная модель
  'width >= 900px',           // десктоп
  '900px <= width < 1200px',  // десктопный бенд AppPage (M6 T8)
  'width < 1200px',           // десктопный бенд AppPage (M6 T8)
]);

const LEGACY: Record<string, Record<string, number>> = {
  'components/CallStage.css': { 'width <= 768px': 6, 'width <= 640px': 1 },
  'components/ChannelSidebar.css': { 'width <= 768px': 1 },
  'components/ChatArea.css': { 'width <= 768px': 1 },
  'components/CommandPalette.css': { 'width <= 640px': 1 },
  'components/Composer.css': { 'width <= 768px': 1 },
  'components/FriendsPanel.css': { 'width <= 768px': 1 },
  'components/MediaLightbox.css': { 'width <= 768px': 1 },
  'components/MessageAttachments.css': { 'width <= 768px': 1 },
  'components/MessageRow.css': { 'width <= 768px': 1 },
  'components/MessageSearch.css': { 'width <= 768px': 1 },
  'components/ServerList.css': { 'width <= 768px': 1 },
  'components/UserList.css': { 'width <= 768px': 1 },
  'components/VideoPlayer.css': { 'width <= 768px': 1 },
  'components/VoiceBanner.css': { 'width <= 768px': 1 },
  'pages/GuestCallView.css': { 'width <= 720px': 1 },
};

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

  it('the scanner sees the known mobile queries (non-vacuous)', () => {
    const all = cssFiles(SRC).flatMap((f) => widthConditions(readFileSync(f, 'utf8')));
    expect(all).toContain('width < 900px');
    expect(all).toContain('width <= 768px');
  });

  it('every width condition is allowed or is exactly-listed legacy', () => {
    expect(found).toEqual(LEGACY);
  });
});
