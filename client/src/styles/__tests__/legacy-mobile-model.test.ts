import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * VYC-95, этап 7 — старой мобильной модели больше нет.
 *
 * До VYC-95 мобильный режим был «одна панель за раз»: `data-mobile-panel`
 * на `.app-layout`, проп `onMobileBack*` у компонентов и кнопки «назад»
 * внутри самих панелей. Теперь навигацией владеет оболочка `src/mobile/`
 * (стек экранов). Тест не даёт этим токенам вернуться в исходники — ни в
 * код, ни в CSS, ни в комментарии: ссылка на удалённое вводит в заблуждение.
 *
 * `server-list-mobile-header` в список намеренно НЕ входит: ServerList.tsx
 * пока рендерит эту скрытую разметку (отдельный follow-up).
 */

const FORBIDDEN = [
  'data-mobile-panel',
  'onMobileBack',
  'mobile-back-btn',
  'chat-back-btn',
  'stage-back-btn',
  'user-list-mobile-header',
  'home-view-mobile-header',
];

const SRC = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const SELF = fileURLToPath(import.meta.url);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'node_modules' ? [] : sourceFiles(p);
    return /\.(ts|tsx|css)$/.test(p) && p !== SELF ? [p] : [];
  });
}

/** «файл:строка — токен» для каждого вхождения запрещённого токена. */
function findHits(text: string, file: string): string[] {
  return text.split('\n').flatMap((line, i) =>
    FORBIDDEN.filter((tok) => line.includes(tok)).map((tok) => `${file}:${i + 1} — ${tok}`),
  );
}

describe('legacy mobile model is gone (VYC-95 stage 7)', () => {
  it('the scanner reports file:line for a forbidden token (non-vacuous)', () => {
    expect(findHits('ok\nprops.onMobileBack()\n.x { }', 'a.tsx')).toEqual(['a.tsx:2 — onMobileBack']);
    expect(findHits('.user-list-mobile-header {}', 'b.css')).toEqual(['b.css:1 — user-list-mobile-header']);
    expect(findHits('.server-list-mobile-header {}', 'c.css')).toEqual([]);
  });

  it('no source file mentions the legacy panel model', () => {
    const files = sourceFiles(SRC);
    expect(files.length).toBeGreaterThan(50);
    const hits = files.flatMap((f) => findHits(readFileSync(f, 'utf8'), relative(SRC, f)));
    expect(hits, `legacy tokens found:\n${hits.join('\n')}`).toEqual([]);
  });
});
