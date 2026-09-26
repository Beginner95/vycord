# «О приложении» (VYC-98) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Новый раздел настроек «О приложении»: шапка (иконка + название), описание, версия и ссылки на GitHub — на десктопе и в мобильной (PWA) версии.

**Architecture:** Единый компонент `AboutBody.tsx` (паттерн `ProfileAccountBody`/`PrivacyBody`/`LanguageBody`, VYC-95): монтируется вкладкой в десктопный `Settings.tsx` и секцией в мобильный `SettingsScreen.tsx`. Версия — из существующего define `__APP_VERSION__` (vite, читает `package.json`), внешние ссылки — обычные `<a target="_blank" rel="noopener noreferrer">` (паттерн `MessageRow.tsx:67`).

**Tech Stack:** React 19, TypeScript, Vite 8 (vitest), `lucide-react`, i18n ru/en (ru — источник, en типизирована против неё), plain CSS + stylelint.

**Спека:** `docs/superpowers/specs/2026-09-26-about-section-design.md`.

## Global Constraints

- Все npm/npx/node команды — из `client/` (из корня репо stylelint падает с ENOENT-стеком, похожим на линт-ошибки).
- i18n: `src/i18n/locales/ru.ts` — источник словаря; `en.ts` типизирована против него — **оба файла в одном коммите**; `tsc` ловит рассинхрон.
- Иконки: `lucide-react` только, явные `size` и `strokeWidth={1.8}` у каждой.
- Классы: kebab-case `component-thing`, новые — с префиксом `about-`; state — `is-*`/`has-*`.
- Токены только из `tokens.css` (raw-цвета вне токенов запрещены). Радиус иконки — `--radius-card`.
- Внешние ссылки — `<a target="_blank" rel="noopener noreferrer">`.
- «Vycord» — имя собственное, вне i18n.
- Версия — `__APP_VERSION__` (declare в `src/vite-env.d.ts`, define в `vite.config.ts` из `package.json`).
- Никогда `git add -A` — только явные пути (в репо есть нарочно untracked `design_handoff_discord_redesign/`).
- Строки: `npx tsc --noEmit` (0 байт), `npx stylelint "src/**/*.css"` (0 байт), `npm run check:i18n` («непереведённых строк не найдено.»), `npm test` (ровно 3 фейла, все в `api.network-retry.test.ts` — by design; новый код не должен добавлять фейлов).

---

### Task 1: AboutBody + CSS + i18n-ключи + тест

Тело раздела и его переводы. Один коммит (правило i18n).

**Files:**
- Create: `client/src/components/settings/AboutBody.tsx`
- Create: `client/src/components/settings/AboutBody.css`
- Create: `client/src/components/settings/__tests__/AboutBody.test.tsx`
- Modify: `client/src/i18n/locales/ru.ts`
- Modify: `client/src/i18n/locales/en.ts`

**Interfaces:**
- Produces: `export function AboutBody(): JSX.Element` — рендерит `.settings-section` с шапкой, описанием и тремя строками. «Версия» — не ссылка; «GitHub» и «Сообщить о проблеме» — `<a class="setting-row setting-row-link" target="_blank" rel="noopener noreferrer">`. Потребляется в Task 2 (`Settings.tsx`) и Task 3 (`SettingsScreen.tsx`).

- [ ] **Step 1: Write the failing test**

Create `client/src/components/settings/__tests__/AboutBody.test.tsx`:

```tsx
// client/src/components/settings/__tests__/AboutBody.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { AboutBody } from '@/components/settings/AboutBody';

afterEach(cleanup);

describe('AboutBody (VYC-98 «О приложении»)', () => {
  it('показывает название, описание и версию', () => {
    render(<AboutBody />);
    expect(document.body.textContent).toContain('Vycord');
    expect(document.body.textContent).toContain('Мессенджер для голосовых и видеозвонков');
    expect(document.body.textContent).toContain(__APP_VERSION__);
  });

  it('ссылки ведут на репозиторий и issues и открываются в новой вкладке', () => {
    render(<AboutBody />);
    const links = document.querySelectorAll<HTMLAnchorElement>('a.setting-row-link');
    expect(links).toHaveLength(2);
    expect(links[0].getAttribute('href')).toBe('https://github.com/Beginner95/vycord');
    expect(links[1].getAttribute('href')).toBe('https://github.com/Beginner95/vycord/issues');
    for (const link of links) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/__tests__/AboutBody.test.tsx`
Expected: FAIL — «Failed to resolve import "@/components/settings/AboutBody"» (компонента ещё нет). `__APP_VERSION__` уже определён в vitest через `vite.config.ts`, ошибки на нём быть не должно.

- [ ] **Step 3: Add i18n keys**

In `client/src/i18n/locales/ru.ts` (источник), сразу после строки `tabAppearance: 'Внешний вид',` (строка 290):

```ts
    tabAbout: 'О приложении',

    aboutDescription: 'Мессенджер для голосовых и видеозвонков, чатов и своих серверов — с нейроочисткой шума',
    aboutVersionLabel: 'Версия',
    aboutGithub: 'GitHub',
    aboutReportIssue: 'Сообщить о проблеме',
```

In `client/src/i18n/locales/en.ts`, сразу после строки `tabAppearance: 'Appearance',` (строка 279):

```ts
    tabAbout: 'About',

    aboutDescription: 'A messenger for voice and video calls, chats and your own servers — with AI noise cancellation',
    aboutVersionLabel: 'Version',
    aboutGithub: 'GitHub',
    aboutReportIssue: 'Report an issue',
```

- [ ] **Step 4: Write the implementation**

Create `client/src/components/settings/AboutBody.tsx`:

```tsx
import { ArrowUpRight } from 'lucide-react';
import { useT } from '@/i18n';
import './AboutBody.css';

const GITHUB_URL = 'https://github.com/Beginner95/vycord';
const ISSUES_URL = `${GITHUB_URL}/issues`;

export function AboutBody() {
  const t = useT();
  return (
    <div className="settings-section">
      <div className="about-header">
        <img src="/icon.png" alt="" className="about-logo" />
        <span className="about-name">Vycord</span>
        <p className="about-description">{t('settings.aboutDescription')}</p>
      </div>

      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutVersionLabel')}</span>
        </div>
        <span className="setting-row-value">{__APP_VERSION__}</span>
      </div>

      <a
        className="setting-row setting-row-link"
        href={GITHUB_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutGithub')}</span>
        </div>
        <ArrowUpRight size={16} strokeWidth={1.8} className="setting-row-link-icon" />
      </a>

      <a
        className="setting-row setting-row-link"
        href={ISSUES_URL}
        target="_blank"
        rel="noopener noreferrer"
      >
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.aboutReportIssue')}</span>
        </div>
        <ArrowUpRight size={16} strokeWidth={1.8} className="setting-row-link-icon" />
      </a>
    </div>
  );
}
```

Create `client/src/components/settings/AboutBody.css`:

```css
.about-header {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 4px 0 18px;
  text-align: center;
}

.about-logo {
  width: 72px;
  height: 72px;
  border-radius: var(--radius-card);
}

.about-name {
  font-size: 17px;
  font-weight: 700;
  color: var(--ink);
}

.about-description {
  max-width: 360px;
  margin: 0;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--muted);
}

.setting-row-link {
  text-decoration: none;
  cursor: pointer;
  transition: color var(--transition);
}

.setting-row-value {
  font-size: 13px;
  color: var(--muted);
}

.setting-row-link-icon {
  flex-shrink: 0;
  color: var(--muted);
  transition: color var(--transition);
}

.setting-row-link:hover .setting-row-title,
.setting-row-link:hover .setting-row-link-icon {
  color: var(--accent-text);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/components/settings/__tests__/AboutBody.test.tsx`
Expected: PASS — 2 теста, 0 фейлов.

- [ ] **Step 6: Gates**

Run from `client/`:
- `npx tsc --noEmit` → выход 0, ноль байт на выходе (ловит рассинхрон ru/en)
- `npx stylelint "src/**/*.css"` → выход 0, ноль байт
- `npm run check:i18n` → «непереведённых строк не найдено.»

- [ ] **Step 7: Commit**

```bash
git add client/src/components/settings/AboutBody.tsx client/src/components/settings/AboutBody.css client/src/components/settings/__tests__/AboutBody.test.tsx client/src/i18n/locales/ru.ts client/src/i18n/locales/en.ts
git commit -m "VYC-98 Добавлено тело раздела «О приложении» с i18n"
```

---

### Task 2: Desktop — вкладка «О приложении» в Settings.tsx

**Files:**
- Modify: `client/src/components/Settings.tsx`
- Modify: `client/src/components/settings/__tests__/Settings.dom.test.tsx`
- Modify (через `-u`): `client/src/components/settings/__tests__/__snapshots__/Settings.profile.html`

**Interfaces:**
- Consumes: `AboutBody` из Task 1; i18n-ключ `settings.tabAbout` из Task 1.
- Produces: вкладка `about` в `TABS` — консистентна с остальными (id, labelKey, icon).

- [ ] **Step 1: Write the failing test**

In `client/src/components/settings/__tests__/Settings.dom.test.tsx`:
- строка 3: добавить `fireEvent` в импорт из `@testing-library/react`:

```tsx
import { render, cleanup, fireEvent } from '@testing-library/react';
```

- в конец `describe` блока (после теста «вкладка „Профиль" по умолчанию»):

```tsx
  it('вкладка «О приложении» рендерит AboutBody', () => {
    render(<Settings isOpen onClose={() => {}} onLogout={() => {}} />);
    const aboutTab = [...document.querySelectorAll('.settings-nav-btn')]
      .find((btn) => btn.textContent?.includes('О приложении'));
    expect(aboutTab).toBeTruthy();
    fireEvent.click(aboutTab!);
    expect(document.body.textContent).toContain('Мессенджер для голосовых и видеозвонков');
    expect(document.body.textContent).toContain(__APP_VERSION__);
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx`
Expected: FAIL — `.find(...)` вернул undefined → `aboutTab` truthy-проверка не прошла (вкладки ещё нет). Снапшот-тест тоже может упасть только после реализации — на этом шаге он зелёный.

- [ ] **Step 3: Implement the tab**

In `client/src/components/Settings.tsx`:

- строка 2, импорт иконок — добавить `Info`:

```tsx
import { X, User, Volume2, Video, Palette, LogOut, Info, type LucideIcon } from 'lucide-react';
```

- после строки 3, импорт тела:

```tsx
import { AboutBody } from '@/components/settings/AboutBody';
```

- строка 18:

```tsx
type SettingsTab = 'profile' | 'audio' | 'video' | 'appearance' | 'about';
```

- в `TABS` (строка 20-25) последним элементом:

```tsx
const TABS: { id: SettingsTab; labelKey: TKey; icon: LucideIcon }[] = [
  { id: 'profile', labelKey: 'settings.tabProfile', icon: User },
  { id: 'audio', labelKey: 'settings.tabAudio', icon: Volume2 },
  { id: 'video', labelKey: 'settings.tabVideo', icon: Video },
  { id: 'appearance', labelKey: 'settings.tabAppearance', icon: Palette },
  { id: 'about', labelKey: 'settings.tabAbout', icon: Info },
];
```

- в рендере панели, после строки 87 (`{activeTab === 'appearance' && <AppearanceSettings />}`):

```tsx
            {activeTab === 'about' && <AboutBody />}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx`
Expected: новый тест PASS; снапшот-тест FAIL (DOM навигации изменился — появилась кнопка «О приложении»). Это ожидаемо.

- [ ] **Step 5: Update the snapshot**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx -u`
Expected: PASS, снапшот `Settings.profile.html` перезаписан. Проверить diff: изменения только в навигационных кнопках (новая кнопка «О приложении»), тело — без изменений.

- [ ] **Step 6: Gates**

Run from `client/`: `npx tsc --noEmit`, `npx stylelint "src/**/*.css"` — оба «ноль байт», выход 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/components/Settings.tsx client/src/components/settings/__tests__/Settings.dom.test.tsx client/src/components/settings/__tests__/__snapshots__/Settings.profile.html
git commit -m "VYC-98 Вкладка «О приложении» в десктопных настройках"
```

---

### Task 3: Mobile — секция settings{about}

**Files:**
- Modify: `client/src/mobile/nav/types.ts`
- Modify: `client/src/mobile/screens/ProfileScreen.tsx`
- Modify: `client/src/mobile/screens/SettingsScreen.tsx`
- Modify: `client/src/mobile/screens/__tests__/SettingsScreen.test.tsx`
- Modify: `client/src/mobile/screens/__tests__/ProfileScreen.test.tsx`

**Interfaces:**
- Consumes: `AboutBody` из Task 1; `settings.tabAbout` из Task 1.
- Produces: `SettingsSection` с членом `'about'`; строка в мобильном списке настроек (последняя, после «Язык»); `settings{about}` рендерит `AboutBody`.

- [ ] **Step 1: Extend the SettingsSection type**

In `client/src/mobile/nav/types.ts` (строка 3):

```ts
export type SettingsSection = 'profile' | 'privacy' | 'audio' | 'video' | 'appearance' | 'language' | 'about';
```

- [ ] **Step 2: Write the failing tests**

In `client/src/mobile/screens/__tests__/SettingsScreen.test.tsx`, в массив `it.each` (строка 36-42) добавить после строки `['language', 'Язык', 'Язык интерфейса'],`:

```tsx
    ['about', 'О приложении', 'Мессенджер для голосовых и видеозвонков'],
```

In `client/src/mobile/screens/__tests__/ProfileScreen.test.tsx`, в конец `describe` (после теста «пункт „Язык"…»):

```tsx
  it('пункт «О приложении» (последний) ведёт на settings{about}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[6]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'about' });
  });
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npx vitest run src/mobile/screens/__tests__/SettingsScreen.test.tsx src/mobile/screens/__tests__/ProfileScreen.test.tsx`
Expected: FAIL — «О приложении» нет ни в `TITLE_KEY` (заголовок пустой), ни в `ROWS` (клик по индексу `[6]` — undefined). Существующий тест «пункт „Язык" (последний)» (индекс `[5]`) — PASS (порядок не тронут).

- [ ] **Step 4: Implement**

In `client/src/mobile/screens/SettingsScreen.tsx`:
- строка 5: импорт тела:

```tsx
import { AboutBody } from '@/components/settings/AboutBody';
```

- в `TITLE_KEY` (после строки `language: 'settings.language',`):

```tsx
  about: 'settings.tabAbout',
```

- в рендере тела, после строки 40 (`{section === 'language' && <LanguageBody />}`):

```tsx
        {section === 'about' && <AboutBody />}
```

In `client/src/mobile/screens/ProfileScreen.tsx`:
- строка 2, импорт иконок — добавить `Info`:

```tsx
import { Globe, Info, Palette, Shield, User as UserIcon, Video, Volume2 } from 'lucide-react';
```

- в `ROWS` (после строки `{ section: 'language', labelKey: 'settings.language', Icon: Globe },`):

```tsx
  { section: 'about', labelKey: 'settings.tabAbout', Icon: Info },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/mobile/screens/__tests__/SettingsScreen.test.tsx src/mobile/screens/__tests__/ProfileScreen.test.tsx`
Expected: PASS — все, включая старый «пункт „Язык" (последний) ведёт на settings{language}» (индекс `[5]` по-прежнему «Язык»).

- [ ] **Step 6: Gates**

Run from `client/`: `npx tsc --noEmit`, `npx stylelint "src/**/*.css"` — оба «ноль байт», выход 0.

- [ ] **Step 7: Commit**

```bash
git add client/src/mobile/nav/types.ts client/src/mobile/screens/ProfileScreen.tsx client/src/mobile/screens/SettingsScreen.tsx client/src/mobile/screens/__tests__/SettingsScreen.test.tsx client/src/mobile/screens/__tests__/ProfileScreen.test.tsx
git commit -m "VYC-98 Секция settings{about} в мобильных настройках"
```

---

### Task 4: Final verification

Ничего не меняет — полный прогон гейтов после трёх тасков.

- [ ] **Step 1: Full test run**

Run from `client/`: `npm test`
Expected: ровно 3 FAILED, все в `src/services/__tests__/api.network-retry.test.ts` (by design, «никогда не чинить»). Остальные файлы — PASS.

- [ ] **Step 2: Static gates**

Run from `client/`:
- `npx tsc --noEmit` → выход 0, ноль байт
- `npx stylelint "src/**/*.css"` → выход 0, ноль байт
- `npm run check:i18n` → «непереведённых строк не найдено.»

- [ ] **Step 3: Manual click-through (человек)**

`npm run dev:vite`, открыть настройки (обе темы, узкая ширина — и десктопный модал, и мобильный список настроек):
- вкладка «О приложении» в десктопе и пункт в мобильном списке открывают раздел
- шапка центрирована, иконка не искажена
- клик «GitHub» и «Сообщить о проблеме» открывают браузер с правильными адресами в новой вкладке
- у «Версии» нет hover-эффекта ссылки

- [ ] **Step 4: Branch cleanliness**

Run from repo root:
- `git status --short` — только ожидаемые файлы; **никаких** файлов из `design_handoff_discord_redesign/`
- `git log --oneline -3` — три коммита VYC-98

---

## Self-Review

**Покрытие спеки:**
- Шапка (иконка + название) — Task 1 (`about-header`/`about-logo`/`about-name`). ✓
- Описание — Task 1 (ключ `aboutDescription`, текст из решения пользователя). ✓
- Версия `__APP_VERSION__` — Task 1 (строка «Версия»). ✓
- GitHub-ссылка → репозиторий — Task 1. ✓
- «Сообщить о проблеме» → issues — Task 1 (доп. согласованный пункт). ✓
- Desktop вкладка + `Info`-иконка — Task 2. ✓
- Mobile: тип, `ROWS` (последняя строка), `TITLE_KEY`, рендер — Task 3. ✓
- i18n ru+en в одном коммите — Task 1 Step 3/7. ✓
- Тесты: AboutBody, Settings.dom, SettingsScreen it.each, ProfileScreen — Tasks 1-3. ✓
- Снапшот `Settings.profile.html` обновлён — Task 2 Step 5. ✓
- Вне объёма (лицензия, отдельная модалка, URL текстом) — не реализуется. ✓

**Плейсхолдер-скан:** нет TBD/TODO; каждый код-шаг содержит полный код. ✓

**Консистентность типов:** `AboutBody` (один экспорт, одна сигнатура) используется одинаково в Task 2 и Task 3; `SettingsSection` расширяется один раз в Task 3 и сразу потребляется `TITLE_KEY`/`ROWS`/тестом. Классы `about-header/about-logo/about-name/about-description/setting-row-link/setting-row-value/setting-row-link-icon` одинаковы в TSX и CSS. ✓