// Ищет пользовательский текст, который забыли завернуть в t().
// Эвристика, а не доказательство: даёт ложные срабатывания, поэтому
// намеренно не встраивается в сборку — падающий из-за эвристики билд
// был бы хуже проблемы, которую скрипт решает.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;

// Файлы, где русский текст — это комментарии и отладочный вывод, а не интерфейс.
const SKIP_FILES = [
  'services/noiseCancellation.ts',
  'services/echoCancellation.ts',
  'services/groupCall.ts',
  'services/ncModels.ts',
  'utils/callQuality.ts',
  'i18n/locales/ru.ts',
  'i18n/locales/en.ts',
];

const ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

function stripComments(line) {
  return line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
}

const findings = [];

for (const file of walk(SRC)) {
  const rel = relative(SRC, file);
  if (SKIP_FILES.includes(rel)) continue;

  // Разметка живёт только в .tsx. Проверять на неё .ts бессмысленно: там
  // ловятся дженерики и HTML-строки неиспользуемого шаблона Vite (src/main.ts).
  const isJsx = rel.endsWith('.tsx');

  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((raw, i) => {
    const line = stripComments(raw);
    if (!line.trim() || line.includes('console.')) return;

    // 1. Текстовые узлы JSX: >Текст<
    // Лукбихайнд отсекает стрелку функции: `=> Promise<void>` — это не JSX.
    const jsxText = isJsx && line.match(/(?<!=)>\s*([A-Za-zА-Яа-яЁё][^<>{}\n]{2,}?)\s*</);
    if (jsxText) findings.push([rel, i + 1, jsxText[1].trim()]);

    // 2. Локализуемые атрибуты со строковым литералом
    if (isJsx) {
      for (const attr of ATTRS) {
        const m = line.match(new RegExp(`${attr}="([^"]{2,})"`));
        if (m) findings.push([rel, i + 1, `${attr}="${m[1]}"`]);
      }
    }

    // 3. alert() / confirm() со строковым литералом
    const dialog = line.match(/\b(alert|confirm)\(\s*['"]([^'"]{2,})/);
    if (dialog) findings.push([rel, i + 1, `${dialog[1]}(${dialog[2]}`]);
  });
}

if (findings.length === 0) {
  console.log('check-i18n: непереведённых строк не найдено.');
  process.exit(0);
}

console.log(`check-i18n: найдено ${findings.length} подозрительных строк:\n`);
for (const [file, line, text] of findings) {
  console.log(`  ${file}:${line}  ${text}`);
}
console.log('\nЭто эвристика — часть находок может быть ложной (юникод-иконки, технические метки).');
