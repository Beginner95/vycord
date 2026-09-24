# VYC-95 — мобильный редизайн, этап 5 (друзья и профиль) — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** вкладки «Друзья» и «Профиль» мобильной оболочки (спека §5.7, §5.8,
§5.11) — сегмент-контрол друзей с заявками и меню-шторкой, карточка профиля
со списком настроек, шесть экранов `settings{section}`, CSS-полировка
`AuthPage` на узких экранах. Десктоп (`≥900px`) остаётся пиксель-в-пиксель.

**Architecture:** `ProfileSettings.tsx` разрезается на три переиспользуемых
тела (`ProfileAccountBody`/`PrivacyBody`/`LanguageBody`) ровно как этап 2
разрезал `EditServerModal` → `EditServerBody`; `AudioSettings`/
`VideoSettings`/`AppearanceSettings` переиспользуются без изменений. Вкладка
«Друзья» — полностью новый мобильный код (`FriendsScreen`,
`useFriendMenuItems`), не разделяющий JSX с десктопным `FriendsPanel.tsx`
(тот же выбор, что `useServerMenuItems` ↔ `ServerMenu.tsx` в этапе 2).
`settings{section}` — новый экран-диспетчер, монтирующий тела по `section`.

**Tech Stack:** React 19, TypeScript, Zustand 5, Vitest 4 + RTL, lucide-react,
per-component CSS.

**Spec:** `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`
(§5.1, §5.7, §5.8, §5.11, §4.1–4.6, §10 строки 1–4, 6, 70–86, 91).

## Global Constraints

- Брейкпоинт — ровно `width < 900px`; десктоп `≥900px` не меняется НИ в одном
  затронутом файле (`ProfileSettings.tsx` — только композиция тел, тот же DOM).
- Роль-токены only: никаких сырых цветов, `12px`-радиусов, числовых
  `z-index`, незапрошенных `var(..., fallback)`.
- Имена классов — `component-thing`; примитивы (`.btn`, `.mobile-row`,
  `.screen-header-btn`, `.toggle-switch`, `.select-control`, `.settings-section`,
  `.setting-row`) переиспользуются, не копируются.
- `MobileListRow`: слот аватара 48, высота строки ≥64, тач-цели ≥44×44 (спека
  §5.1). Строка — всегда `<button>` без вложенных кнопок; там, где нужны
  инлайн-кнопки (заявки в друзья) — не `MobileListRow`, а собственная
  разметка (тот же выбор, что десктопный `FriendRow.tsx`).
- `ActionSheet` берёт `ContextMenuItem[]` (`@/components/ContextMenu`);
  опасные пункты — отдельной группой (обрабатывается самим `ActionSheet`).
- Все npm/npx/node — из `client/`. Гейты: `npx tsc --noEmit` (0 байт),
  `npx stylelint "src/**/*.css"` (0 байт), `npm run check:i18n` («непереведённых
  строк не найдено»), `npm test` (RED by design: ровно 3 падения, все в
  `api.network-retry.test.ts` — этот файл никогда не трогать).
- Никаких `git add -A`/`git add .` — коммитит и пушит пользователь сам; сами
  задачи плана НЕ включают шаг коммита.

## Decisions

- **D1 — `friendAdd` остаётся неиспользуемым.** `Screen`-тип уже резервирует
  `{ kind: 'friendAdd' }` (этап 1), но `BottomSheet` безусловно вызывает
  внутри себя `useBackDismiss` (кладёт СВОЮ запись `{kind:'sheet'}` при
  открытии). Обернуть им РЕАЛЬНЫЙ push-экран значило бы получить два вложенных
  push при одном открытии и два «назад» для полного закрытия. Все шторки
  этапов 2–4 (`ServerMenuSheet`, `ChannelMenuSheet`, `MobileGuestSheet`,
  `CallOverflowSheets`) управляются ЛОКАЛЬНЫМ `useState` в экране-хозяине, а
  не через `nav.push` — «+» на вкладке «Друзья» делает то же самое. Тест
  `renderScreen.test.tsx`: `show({kind:'friendAdd'})` → `.mobile-screen-loading`
  — не трогаем, он остаётся верным (никто не зовёт `nav.push({kind:'friendAdd'})`).
- **D2 — `ProfileSettings.tsx` разрезается, три другие панели — нет.**
  `ProfileAccountBody`/`PrivacyBody`/`LanguageBody` — по образцу
  `EditServerBody` (этап 2): тело, которое десктопный композер и мобильный
  экран монтируют одинаково. `AudioSettings.tsx`/`VideoSettings.tsx`/
  `AppearanceSettings.tsx` этим этапом не редактируются вовсе — их классы
  (`.settings-section`, `.setting-row`, …) определены в `Settings.css`,
  который уже в бандле через `Settings.tsx` (тот же приём, что
  `MobileGuestSheet.tsx` документирует для `GuestInvitePopover.css`).
- **D3 — мобильные «Друзья» не делят JSX с десктопом.** `FriendsScreen`/
  `useFriendMenuItems` — новый код. `FriendsPanel.tsx`/`FriendRow.tsx`/
  `AddFriendForm.tsx`/`HomeView.tsx` НЕ трогаются: `HomeView` остаётся
  смонтирован в `DesktopShell.tsx` (десктопная вкладка «Дом»), только
  `renderScreen.tsx`'s `'friends'`-кейс перестаёт его использовать.
  `AddFriendForm` переиспользуется в новой шторке БЕЗ изменений — её CSS
  (`.add-friend-form` и т.д., в `FriendsPanel.css`) уже в бандле через
  `FriendsPanel.tsx` → `HomeView.tsx` → `DesktopShell.tsx`.
- **D4 — подписи пунктов профиля повторяют десктопные, не прозу спеки.**
  Список профиля использует уже существующие `settings.tabProfile` /
  `settings.privacy` / `settings.tabAudio` / `settings.tabVideo` /
  `settings.tabAppearance` / `settings.language` (те же строки, что вкладки
  десктопного `Settings.tsx`) — а не отдельную синонимичную подпись «Звук» из
  прозы §5.8. Тот же экран назначения — та же подпись; новых i18n-ключей для
  этого не заводим.
- **D5 — тап по строке друга открывает `ActionSheet` напрямую, без
  long-press.** У строки друга в этой фазе нет собственного экрана-назначения
  (личные сообщения — VYC-91), поэтому, в отличие от сервера/канала, тап сам
  и есть «открыть меню».
- **D6 — «Позвонить другу» переиспользует `server.callUser`.** Тот же ключ
  (`{{name}}`), что уже зовёт `callService.startCall` в `ChannelInfoScreen.tsx`
  для звонка участнику — семантически то же действие.

## File Structure

| Файл | Роль |
|---|---|
| `client/src/components/settings/ProfileAccountBody.tsx` | НОВЫЙ. Аватар + учётная запись (вынесено из `ProfileSettings.tsx`) |
| `client/src/components/settings/PrivacyBody.tsx` | НОВЫЙ. Приватность (вынесено из `ProfileSettings.tsx`) |
| `client/src/components/settings/LanguageBody.tsx` | НОВЫЙ. Язык (вынесено из `ProfileSettings.tsx`) |
| `client/src/components/settings/ProfileSettings.tsx` | ИЗМЕНЁН. Тонкий композер трёх тел |
| `client/src/mobile/menus/useFriendMenuItems.tsx` | НОВЫЙ. Пункты `ActionSheet` по тапу на друга |
| `client/src/mobile/screens/FriendsScreen.tsx` / `.css` | НОВЫЙ. Вкладка «Друзья» |
| `client/src/mobile/screens/ProfileScreen.tsx` / `.css` | НОВЫЙ. Вкладка «Профиль» |
| `client/src/mobile/screens/SettingsScreen.tsx` / `.css` | НОВЫЙ. Экран `settings{section}` |
| `client/src/mobile/screens/renderScreen.tsx` | ИЗМЕНЁН. Кейсы `friends`/`profile`/`settings`, удалён `ProfileRoot` |
| `client/src/pages/Auth.css` | ИЗМЕНЁН. `@media (width < 900px)` блок |
| `client/src/i18n/locales/{ru,en}.ts` | ИЗМЕНЁН. один новый ключ `mobile.addFriend` |

---

### Task 1: Замороженный DOM-снимок `Settings.tsx` (вкладка «Профиль»)

**Files:**
- Create: `client/src/components/settings/__tests__/Settings.dom.test.tsx`
- Create (авто, шаг 2): `client/src/components/settings/__tests__/__snapshots__/Settings.profile.html`

**Interfaces:** нет (тест самодостаточен).

Только `ProfileSettings.tsx` редактируется этим этапом (T2) — `AudioSettings`/
`VideoSettings`/`AppearanceSettings` не трогаются вовсе, снимать их незачем;
снимаем ровно активную по умолчанию вкладку «Профиль».

- [ ] **Step 1: Написать тест**

```tsx
// client/src/components/settings/__tests__/Settings.dom.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { render, cleanup } from '@testing-library/react';
import { Settings } from '@/components/Settings';
import { useAuthStore } from '@/stores/authStore';

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'anna', email: 'anna@example.com', avatar_url: undefined,
      status: 'online', created_at: '', updated_at: '',
      show_last_seen: true, allow_friend_requests: 'everyone', allow_dm_from: 'friends',
    } as never,
  });
});
afterEach(() => { cleanup(); });

describe('Settings modal DOM (desktop parity, снято до VYC-95 этапа 5)', () => {
  it('вкладка «Профиль» по умолчанию', () => {
    render(<Settings isOpen onClose={() => {}} onLogout={() => {}} />);
    expect(document.body.innerHTML).toMatchFileSnapshot('./__snapshots__/Settings.profile.html');
  });
});
```

- [ ] **Step 2: Создать снимок первым прогоном**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx`
Expected: тест проходит, файл `__snapshots__/Settings.profile.html` создан
(`toMatchFileSnapshot` создаёт файл, если его ещё нет, и в этом случае не
падает). Проверить `wc -l` файла — реальная разметка (`.settings-modal`,
`.profile-avatar-block`, три `.settings-section`), не пусто.

- [ ] **Step 3: Повторный прогон — стабильность**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx`
Expected: PASS без диффа (снимок совпал сам с собой).

---

### Task 2: Разрез `ProfileSettings.tsx` на три тела

**Files:**
- Create: `client/src/components/settings/ProfileAccountBody.tsx`
- Create: `client/src/components/settings/PrivacyBody.tsx`
- Create: `client/src/components/settings/LanguageBody.tsx`
- Modify: `client/src/components/settings/ProfileSettings.tsx` (весь файл заменяется)

**Interfaces:**
- Consumes: ничего от предыдущих задач.
- Produces: `ProfileAccountBody(): JSX.Element`, `PrivacyBody(): JSX.Element`,
  `LanguageBody(): JSX.Element` — без пропсов, каждое тело само читает нужный
  стор. Потребители: T5 (`SettingsScreen.tsx`, `ProfileAccountBody`/
  `PrivacyBody`/`LanguageBody` напрямую) и десктопный композер ниже.

- [ ] **Step 1: `ProfileAccountBody.tsx`**

```tsx
import { useRef, useState } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import { Avatar } from '@/components/Avatar';
import { AvatarCropModal } from '@/components/AvatarCropModal';

const ALLOWED_TYPES = ['image/png', 'image/jpeg'];
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/** Аватар + учётная запись — вынесено из ProfileSettings.tsx (VYC-95 этап 5,
 *  T2): тот же приём, что EditServerModal → EditServerBody в этапе 2. Тело
 *  монтируется и десктопным композером (ProfileSettings.tsx), и мобильным
 *  экраном settings{profile} (SettingsScreen.tsx, T5) — БЕЗ прохода через
 *  композер. ДОЛЖНО остаться DOM-идентичным Settings.dom.test.tsx (T1). */
export function ProfileAccountBody() {
  const { user, updateUser } = useAuthStore();
  const t = useT();
  const [cropFile, setCropFile] = useState<File | null>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    if (!ALLOWED_TYPES.includes(file.type)) {
      setPickError(t('settings.avatarBadFormat'));
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setPickError(t('settings.avatarTooLarge'));
      return;
    }

    setPickError(null);
    setCropFile(file);
  };

  const handleUpload = async (blob: Blob): Promise<void> => {
    const updated = await apiService.uploadAvatar(blob);
    updateUser({ avatar_url: updated.avatar_url });
    setCropFile(null);
  };

  const handleRemove = async () => {
    setRemoving(true);
    try {
      const updated = await apiService.removeAvatar();
      updateUser({ avatar_url: updated.avatar_url });
    } catch (err) {
      setPickError(apiErrorText(err, t));
    } finally {
      setRemoving(false);
    }
  };

  return (
    <>
      <div className="profile-avatar-block">
        <Avatar url={user?.avatar_url} username={user?.username ?? ''} className="profile-avatar-large" />
        <div className="profile-avatar-actions">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => fileInputRef.current?.click()}
          >
            {t('settings.changeAvatar')}
          </button>
          {user?.avatar_url && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={handleRemove}
              disabled={removing}
            >
              {removing ? t('settings.removingAvatar') : t('settings.removeAvatar')}
            </button>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg"
          onChange={handleFileChange}
          style={{ display: 'none' }}
        />
        {pickError && <p className="setting-warning">{pickError}</p>}
      </div>

      <div className="settings-section">
        <h3 className="settings-section-title">{t('settings.account')}</h3>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.usernameLabel')}</span>
            <p className="setting-row-desc">{user?.username}</p>
          </div>
        </div>
        <div className="setting-row">
          <div className="setting-row-info">
            <span className="setting-row-title">{t('settings.emailLabel')}</span>
            <p className="setting-row-desc">{user?.email}</p>
          </div>
        </div>
      </div>

      {cropFile && (
        <AvatarCropModal
          file={cropFile}
          onCancel={() => setCropFile(null)}
          onUpload={handleUpload}
        />
      )}
    </>
  );
}
```

- [ ] **Step 2: `PrivacyBody.tsx`**

```tsx
import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useAuthStore } from '@/stores/authStore';
import { useT } from '@/i18n';
import { apiService, apiErrorText } from '@/services/api';
import type { PrivacyMode } from '@/types';

/** Приватность — вынесено из ProfileSettings.tsx (VYC-95 этап 5, T2). См.
 *  ProfileAccountBody.tsx — тот же приём и тот же контракт. */
export function PrivacyBody() {
  const { user, updateUser } = useAuthStore();
  const t = useT();
  const [privacyError, setPrivacyError] = useState<string | null>(null);

  const handleShowLastSeenChange = async (checked: boolean) => {
    const previous = user?.show_last_seen ?? true;
    updateUser({ show_last_seen: checked });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ show_last_seen: checked });
    } catch (err) {
      updateUser({ show_last_seen: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  const handleAllowFriendRequestsChange = async (value: PrivacyMode) => {
    const previous = user?.allow_friend_requests ?? 'everyone';
    updateUser({ allow_friend_requests: value });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ allow_friend_requests: value });
    } catch (err) {
      updateUser({ allow_friend_requests: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  const handleAllowDmFromChange = async (value: PrivacyMode) => {
    const previous = user?.allow_dm_from ?? 'friends';
    updateUser({ allow_dm_from: value });
    setPrivacyError(null);
    try {
      await apiService.updatePrivacy({ allow_dm_from: value });
    } catch (err) {
      updateUser({ allow_dm_from: previous });
      setPrivacyError(apiErrorText(err, t));
    }
  };

  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.privacy')}</h3>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.showLastSeen')}</span>
          <p className="setting-row-desc">{t('settings.showLastSeenDescription')}</p>
        </div>
        <label className="toggle-switch">
          <input
            type="checkbox"
            aria-label={t('settings.showLastSeen')}
            checked={user?.show_last_seen ?? true}
            onChange={(e) => { void handleShowLastSeenChange(e.target.checked); }}
          />
          <span className="toggle-track" />
        </label>
      </div>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.allowFriendRequests')}</span>
          <p className="setting-row-desc">{t('settings.allowFriendRequestsDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.allowFriendRequests')}
            value={user?.allow_friend_requests ?? 'everyone'}
            onChange={(e) => { void handleAllowFriendRequestsChange(e.target.value as PrivacyMode); }}
          >
            <option value="everyone">{t('settings.privacyEveryone')}</option>
            <option value="mutual_servers">{t('settings.privacyMutualServers')}</option>
            <option value="none">{t('settings.privacyNobody')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.allowDmFrom')}</span>
          <p className="setting-row-desc">{t('settings.allowDmFromDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.allowDmFrom')}
            value={user?.allow_dm_from ?? 'friends'}
            onChange={(e) => { void handleAllowDmFromChange(e.target.value as PrivacyMode); }}
          >
            <option value="everyone">{t('settings.privacyEveryone')}</option>
            <option value="mutual_servers">{t('settings.privacyMutualServers')}</option>
            <option value="friends">{t('settings.privacyFriendsOnly')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
      {privacyError && <p className="setting-warning">{privacyError}</p>}
    </div>
  );
}
```

- [ ] **Step 3: `LanguageBody.tsx`**

```tsx
import { ChevronDown } from 'lucide-react';
import { useLocaleStore, type Locale } from '@/stores/localeStore';
import { useT } from '@/i18n';

/** Язык — вынесено из ProfileSettings.tsx (VYC-95 этап 5, T2). */
export function LanguageBody() {
  const { locale, setLocale } = useLocaleStore();
  const t = useT();
  return (
    <div className="settings-section">
      <h3 className="settings-section-title">{t('settings.language')}</h3>
      <div className="setting-row">
        <div className="setting-row-info">
          <span className="setting-row-title">{t('settings.interfaceLanguage')}</span>
          <p className="setting-row-desc">{t('settings.languageDescription')}</p>
        </div>
        <span className="select-wrap">
          <select
            className="select-control"
            aria-label={t('settings.interfaceLanguage')}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            <option value="ru">{t('settings.languageNameRu')}</option>
            <option value="en">{t('settings.languageNameEn')}</option>
          </select>
          <span className="select-chevron">
            <ChevronDown size={14} strokeWidth={1.8} />
          </span>
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Переписать `ProfileSettings.tsx` тонким композером (заменить файл целиком)**

```tsx
import { ProfileAccountBody } from './ProfileAccountBody';
import { PrivacyBody } from './PrivacyBody';
import { LanguageBody } from './LanguageBody';
import './ProfileSettings.css';

/** Композер вкладки «Профиль» десктопного Settings.tsx. Разрезано на тела
 *  (VYC-95 этап 5, T2, см. ProfileAccountBody.tsx): каждое — самостоятельный
 *  переиспользуемый кусок, который SettingsScreen.tsx (T5) монтирует
 *  напрямую в settings{profile}/settings{privacy}/settings{language}, минуя
 *  этот композер. ДОЛЖЕН остаться DOM-идентичным — три тела возвращают ровно
 *  те же узлы, что раньше лежали здесь плоским JSX (Settings.dom.test.tsx, T1). */
export function ProfileSettings() {
  return (
    <div className="profile-settings">
      <ProfileAccountBody />
      <PrivacyBody />
      <LanguageBody />
    </div>
  );
}
```

- [ ] **Step 5: Проверить снимок не изменился**

Run: `npx vitest run src/components/settings/__tests__/Settings.dom.test.tsx`
Expected: PASS, файл `Settings.profile.html` не изменился (`git status --short`
не должен показать его модифицированным — если diff есть, разрез сломал
DOM, искать расхождение вручную).

- [ ] **Step 6: Гейты**

Run: `npx tsc --noEmit && npx stylelint "src/**/*.css"`
Expected: оба — 0 байт вывода.

---

### Task 3: `useFriendMenuItems` + `FriendsScreen`

**Files:**
- Create: `client/src/mobile/menus/useFriendMenuItems.tsx`
- Create: `client/src/mobile/menus/__tests__/useFriendMenuItems.test.tsx`
- Create: `client/src/mobile/screens/FriendsScreen.tsx`
- Create: `client/src/mobile/screens/FriendsScreen.css`
- Create: `client/src/mobile/screens/__tests__/FriendsScreen.test.tsx`
- Modify: `client/src/mobile/screens/renderScreen.tsx`
- Modify: `client/src/i18n/locales/ru.ts`, `client/src/i18n/locales/en.ts`

**Interfaces:**
- Consumes: `useFriendStore` (`@/stores/friendStore`), `useOnlineIds`
  (`@/hooks/useOnlineIds`), `callService.startCall(userId): Promise<string|null>`
  (`@/services/call`), `apiService.{acceptFriendRequest,deleteFriendRequest,
  removeFriend,blockUser,unblockUser}` (`@/services/api`), `ContextMenuItem`
  (`@/components/ContextMenu`), `MobileListRow`, `ScreenHeader`, `ActionSheet`,
  `BottomSheet`, `AddFriendForm` (`@/components/AddFriendForm`, без изменений).
- Produces: `useFriendMenuItems(user: UserBrief, actions: FriendMenuActions):
  ContextMenuItem[]`; `FriendsScreen(): JSX.Element` (без пропсов — этот
  экран не использует `ScreenCtx`, у него нет навигации в этой фазе, см. D1/D5).

- [ ] **Step 1: i18n — один новый ключ**

Modify `client/src/i18n/locales/ru.ts` (в блоке `mobile:`, сразу после
`sheetHandle: 'Потяните вниз, чтобы закрыть',`):

```ts
    addFriend: 'Добавить в друзья',
```

Modify `client/src/i18n/locales/en.ts` (тот же блок, та же позиция):

```ts
    addFriend: 'Add friend',
```

- [ ] **Step 2: `useFriendMenuItems.tsx`**

```tsx
import { Ban, Phone, Undo2, UserMinus } from 'lucide-react';
import type { ContextMenuItem } from '@/components/ContextMenu';
import type { UserBrief } from '@/types';
import { useT } from '@/i18n';

export interface FriendMenuActions {
  onCall?: () => void;
  onRemove?: () => void;
  onBlock?: () => void;
  onUnblock?: () => void;
}

/** Пункты ActionSheet по тапу на строку друга (спека §5.7, D5). Независимая
 *  от десктопа копия (см. Decisions D3) — та же граница, что
 *  useServerMenuItems ↔ ServerMenu.tsx в этапе 2. */
export function useFriendMenuItems(user: UserBrief, a: FriendMenuActions): ContextMenuItem[] {
  const t = useT();
  const items: ContextMenuItem[] = [];
  if (a.onCall) {
    items.push({ label: t('server.callUser', { name: user.username }), icon: <Phone size={20} strokeWidth={1.8} />, onClick: a.onCall });
  }
  if (a.onUnblock) {
    items.push({ label: t('friends.unblock'), icon: <Undo2 size={20} strokeWidth={1.8} />, onClick: a.onUnblock });
  }
  if (a.onRemove) {
    items.push({ label: t('friends.remove'), icon: <UserMinus size={20} strokeWidth={1.8} />, danger: true, onClick: a.onRemove });
  }
  if (a.onBlock) {
    items.push({ label: t('friends.block'), icon: <Ban size={20} strokeWidth={1.8} />, danger: true, onClick: a.onBlock });
  }
  return items;
}
```

- [ ] **Step 3: тест хука**

```tsx
// client/src/mobile/menus/__tests__/useFriendMenuItems.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { useFriendMenuItems } from '@/mobile/menus/useFriendMenuItems';
import { t } from '@/i18n';

const user = { user_id: 'u2', username: 'Борис' };

describe('useFriendMenuItems', () => {
  it('без действий — пустой список', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, {}));
    expect(result.current).toEqual([]);
  });

  it('онлайн-друг: звонок первым, затем удалить/заблокировать опасной группой', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, {
      onCall: vi.fn(), onRemove: vi.fn(), onBlock: vi.fn(),
    }));
    expect(result.current.map((i) => i.label)).toEqual([
      t('server.callUser', { name: 'Борис' }), t('friends.remove'), t('friends.block'),
    ]);
    expect(result.current[1].danger).toBe(true);
    expect(result.current[2].danger).toBe(true);
  });

  it('заблокированный: только «Разблокировать»', () => {
    const { result } = renderHook(() => useFriendMenuItems(user, { onUnblock: vi.fn() }));
    expect(result.current.map((i) => i.label)).toEqual([t('friends.unblock')]);
  });
});
```

- [ ] **Step 4: `FriendsScreen.tsx`**

```tsx
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { apiService, apiErrorText } from '@/services/api';
import { useFriendStore } from '@/stores/friendStore';
import { useOnlineIds } from '@/hooks/useOnlineIds';
import { callService } from '@/services/call';
import { Avatar } from '@/components/Avatar';
import { AddFriendForm } from '@/components/AddFriendForm';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import { ActionSheet } from '@/mobile/sheets/ActionSheet';
import { BottomSheet } from '@/mobile/sheets/BottomSheet';
import { useFriendMenuItems } from '@/mobile/menus/useFriendMenuItems';
import type { UserBrief, FriendRequest } from '@/types';
import { useT } from '@/i18n';
import './FriendsScreen.css';

type Tab = 'online' | 'all' | 'pending' | 'blocked';

/** Вкладка «Друзья» (спека §5.7). «+» открывает локальную шторку с
 *  AddFriendForm (D1) — не nav.push. Тап по строке друга открывает
 *  ActionSheet напрямую (D5); заявки в «Ожидании» — инлайн-кнопки 44px, не
 *  MobileListRow (там нельзя вкладывать кнопки). */
export function FriendsScreen() {
  const t = useT();
  const [tab, setTab] = useState<Tab>('online');
  const [addOpen, setAddOpen] = useState(false);
  const [menuTarget, setMenuTarget] = useState<UserBrief | null>(null);
  const { friends, incoming, outgoing, blocked, load } = useFriendStore();
  const onlineIds = useOnlineIds();
  const [actionError, setActionError] = useState<string | null>(null);

  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await load();
    } catch (err) {
      setActionError(apiErrorText(err, t));
      setTimeout(() => setActionError(null), 5000);
    }
  };

  const onlineFriends = friends.filter((f) => onlineIds.has(f.user_id));
  const menuOnline = !!menuTarget && onlineIds.has(menuTarget.user_id);
  const menuBlocked = !!menuTarget && blocked.some((u) => u.user_id === menuTarget.user_id);
  const menuItems = useFriendMenuItems(menuTarget ?? { user_id: '', username: '' }, menuTarget ? {
    onCall: (menuOnline && !menuBlocked) ? () => { void callService.startCall(menuTarget.user_id); } : undefined,
    onRemove: menuBlocked ? undefined : () => act(() => apiService.removeFriend(menuTarget.user_id)),
    onBlock: menuBlocked ? undefined : () => act(() => apiService.blockUser(menuTarget.user_id)),
    onUnblock: menuBlocked ? () => act(() => apiService.unblockUser(menuTarget.user_id)) : undefined,
  } : {});

  const segments: { key: Tab; label: string; count?: number }[] = [
    { key: 'online', label: t('friends.tabOnline') },
    { key: 'all', label: t('friends.tabAll'), count: friends.length },
    { key: 'pending', label: t('friends.tabPending'), count: incoming.length + outgoing.length },
    { key: 'blocked', label: t('friends.tabBlocked') },
  ];

  const row = (u: UserBrief, online: boolean) => (
    <MobileListRow
      key={u.user_id}
      avatar={<span className={`user-avatar-wrap${online ? ' is-online' : ''}`}><Avatar url={u.avatar_url ?? undefined} username={u.username} className="friends-screen-avatar" /></span>}
      title={u.username}
      subtitle={online ? t('friends.statusOnline') : t('friends.statusOffline')}
      onClick={() => setMenuTarget(u)}
    />
  );

  const pendingRow = (r: FriendRequest, kind: 'incoming' | 'outgoing') => (
    <div className="friends-pending-row" key={r.id}>
      <span className="user-avatar-wrap"><Avatar url={r.user.avatar_url ?? undefined} username={r.user.username} className="friends-screen-avatar" /></span>
      <span className="friends-pending-name">{r.user.username}</span>
      <div className="friends-pending-actions">
        {kind === 'incoming' ? (
          <>
            <button type="button" className="btn btn-primary friends-pending-btn" onClick={() => act(() => apiService.acceptFriendRequest(r.id))}>
              {t('friends.accept')}
            </button>
            <button type="button" className="btn btn-secondary friends-pending-btn" onClick={() => act(() => apiService.deleteFriendRequest(r.id))}>
              {t('friends.decline')}
            </button>
          </>
        ) : (
          <button type="button" className="btn btn-secondary friends-pending-btn" onClick={() => act(() => apiService.deleteFriendRequest(r.id))}>
            {t('friends.cancel')}
          </button>
        )}
      </div>
    </div>
  );

  return (
    <div className="friends-screen">
      <ScreenHeader
        title={t('mobile.tabFriends')}
        actions={
          <button type="button" className="screen-header-btn" aria-label={t('mobile.addFriend')} onClick={() => setAddOpen(true)}>
            <Plus size={24} strokeWidth={1.8} />
          </button>
        }
      />
      <div className="friends-segments" role="tablist">
        {segments.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={tab === s.key}
            className={`friends-segment${tab === s.key ? ' is-active' : ''}`}
            onClick={() => setTab(s.key)}
          >
            {s.label}
            {s.count ? <span className="friends-segment-count">{s.count}</span> : null}
          </button>
        ))}
      </div>
      <div className="friends-screen-list">
        {tab === 'online' && (
          onlineFriends.length > 0
            ? onlineFriends.map((f) => row(f, true))
            : <p className="friends-screen-empty">{t('friends.emptyOnline')}</p>
        )}
        {tab === 'all' && (
          friends.length > 0
            ? friends.map((f) => row(f, onlineIds.has(f.user_id)))
            : <p className="friends-screen-empty">{t('friends.emptyAll')}</p>
        )}
        {tab === 'pending' && (
          <>
            <h3 className="friends-screen-section">{t('friends.incoming')}</h3>
            {incoming.length > 0
              ? incoming.map((r) => pendingRow(r, 'incoming'))
              : <p className="friends-screen-empty">{t('friends.emptyIncoming')}</p>}
            <h3 className="friends-screen-section">{t('friends.outgoing')}</h3>
            {outgoing.length > 0
              ? outgoing.map((r) => pendingRow(r, 'outgoing'))
              : <p className="friends-screen-empty">{t('friends.emptyOutgoing')}</p>}
          </>
        )}
        {tab === 'blocked' && (
          blocked.length > 0
            ? blocked.map((u) => row(u, false))
            : <p className="friends-screen-empty">{t('friends.emptyBlocked')}</p>
        )}
      </div>

      <ActionSheet open={menuTarget !== null} onClose={() => setMenuTarget(null)} title={menuTarget?.username} items={menuItems} />
      <BottomSheet open={addOpen} onClose={() => setAddOpen(false)}>
        <AddFriendForm />
      </BottomSheet>
      {actionError && <div className="error-toast">{actionError}</div>}
    </div>
  );
}
```

- [ ] **Step 5: `FriendsScreen.css`**

```css
/* VYC-95 §5.7. Экран рендерится только мобильной оболочкой — медиазапросов нет. */
.friends-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.friends-segments {
  display: flex;
  gap: 8px;
  flex-shrink: 0;
  padding: 4px 16px 12px;
  overflow-x: auto;
}

.friends-segment {
  display: flex;
  align-items: center;
  gap: 6px;
  flex-shrink: 0;
  height: 36px;
  padding: 0 14px;
  border: 0;
  border-radius: var(--radius-pill);
  background: var(--canvas-2);
  color: var(--muted);
  font: inherit;
  font-size: 13.5px;
  font-weight: 600;
  cursor: pointer;
  -webkit-tap-highlight-color: transparent;
}

.friends-segment.is-active {
  background: var(--accent-soft);
  color: var(--accent-text);
}

.friends-segment-count {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  min-width: 18px;
  height: 18px;
  padding: 0 5px;
  border-radius: var(--radius-pill);
  background: var(--chip-bg);
  color: var(--muted-2);
  font-size: 11px;
  font-weight: 700;
}

.friends-segment.is-active .friends-segment-count {
  background: var(--canvas);
  color: var(--accent-text);
}

.friends-screen-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom);
}

.friends-screen-empty {
  margin: 0;
  padding: 24px 16px;
  color: var(--muted-2);
  font-size: 13px;
  text-align: center;
}

.friends-screen-section {
  margin: 0;
  padding: 16px 16px 4px;
  color: var(--muted);
  font-size: 13px;
  font-weight: 700;
  text-transform: uppercase;
}

.friends-screen-avatar {
  width: 100%;
  height: 100%;
  border-radius: var(--radius-pill);
  object-fit: cover;
}

/* Строка заявки (§5.7): инлайн-кнопки, поэтому не MobileListRow (тот всегда
   <button>, вложенные кнопки в нём невозможны намеренно — MobileListRow.tsx). */
.friends-pending-row {
  display: flex;
  align-items: center;
  gap: 12px;
  min-height: 64px;
  padding: 8px 16px;
}

.friends-pending-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  color: var(--ink);
  font-size: 16px;
  font-weight: 600;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.friends-pending-actions {
  display: flex;
  flex-shrink: 0;
  gap: 8px;
}

.friends-pending-btn {
  height: 44px;
  padding: 0 16px;
  font-size: 13px;
}
```

- [ ] **Step 6: тест экрана**

```tsx
// client/src/mobile/screens/__tests__/FriendsScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import { FriendsScreen } from '@/mobile/screens/FriendsScreen';
import { useFriendStore } from '@/stores/friendStore';
import { callService } from '@/services/call';
import type { FriendProfile, FriendRequest, UserBrief } from '@/types';

vi.mock('@/services/api', async (orig) => {
  const actual = await orig<typeof import('@/services/api')>();
  return {
    ...actual,
    apiService: {
      ...actual.apiService,
      getOnlineUsers: vi.fn(async () => [{ id: 'u2' }]),
      acceptFriendRequest: vi.fn(async () => {}),
      deleteFriendRequest: vi.fn(async () => {}),
      removeFriend: vi.fn(async () => {}),
      blockUser: vi.fn(async () => {}),
      unblockUser: vi.fn(async () => {}),
    },
  };
});
vi.mock('@/services/websocket', () => ({ wsService: { on: vi.fn(() => () => {}), send: vi.fn() } }));
vi.mock('@/services/call', () => ({ callService: { startCall: vi.fn(async () => null) } }));

const boris: FriendProfile = { user_id: 'u2', username: 'Борис', friends_since: '' };
const vera: FriendProfile = { user_id: 'u3', username: 'Вера', friends_since: '' };
const req = (id: string, user: UserBrief): FriendRequest => ({ id, user, created_at: '' });

beforeEach(() => {
  vi.clearAllMocks();
  useFriendStore.setState({
    friends: [boris, vera],
    incoming: [req('r1', { user_id: 'u4', username: 'Галя' })],
    outgoing: [req('r2', { user_id: 'u5', username: 'Денис' })],
    blocked: [{ user_id: 'u6', username: 'Ева' }],
    load: vi.fn(async () => {}),
  });
});
afterEach(cleanup);

describe('FriendsScreen (VYC-95 этап 5)', () => {
  it('вкладка «В сети» по умолчанию показывает только друзей онлайн', async () => {
    render(<FriendsScreen />);
    await waitFor(() => expect(document.body.textContent).toContain('Борис'));
    expect(document.body.textContent).not.toContain('Вера');
  });

  it('вкладка «Все» показывает всех друзей', async () => {
    render(<FriendsScreen />);
    fireEvent.click(document.querySelectorAll('.friends-segment')[1]);
    await waitFor(() => expect(document.body.textContent).toContain('Вера'));
  });

  it('«Ожидание»: инлайн «Принять» зовёт apiService.acceptFriendRequest', async () => {
    const { apiService } = await import('@/services/api');
    render(<FriendsScreen />);
    fireEvent.click(document.querySelectorAll('.friends-segment')[2]);
    await waitFor(() => expect(document.body.textContent).toContain('Галя'));
    fireEvent.click([...document.querySelectorAll('.friends-pending-btn')].find((b) => b.textContent === 'Принять')!);
    await waitFor(() => expect(apiService.acceptFriendRequest).toHaveBeenCalledWith('r1'));
  });

  it('тап по строке друга открывает ActionSheet, «Позвонить» зовёт callService', async () => {
    render(<FriendsScreen />);
    await waitFor(() => expect(document.body.textContent).toContain('Борис'));
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(document.body.textContent).toContain('Позвонить Борис');
    fireEvent.click([...document.querySelectorAll('.action-sheet-item')].find((b) => b.textContent?.includes('Позвонить'))!);
    expect(callService.startCall).toHaveBeenCalledWith('u2');
  });

  it('«+» открывает шторку с AddFriendForm', () => {
    render(<FriendsScreen />);
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(document.querySelector('.add-friend-form')).not.toBeNull();
  });

  it('«Заблокированные»: меню показывает только «Разблокировать»', async () => {
    render(<FriendsScreen />);
    fireEvent.click(document.querySelectorAll('.friends-segment')[3]);
    await waitFor(() => expect(document.body.textContent).toContain('Ева'));
    fireEvent.click(document.querySelector('.mobile-row')!);
    expect(document.body.textContent).toContain('Разблокировать');
    expect(document.body.textContent).not.toContain('Позвонить');
  });
});
```

- [ ] **Step 7: подключить в `renderScreen.tsx`**

Modify `client/src/mobile/screens/renderScreen.tsx`: убрать импорт `HomeView`
(строка `import { HomeView } from '@/components/HomeView';`), добавить

```tsx
import { FriendsScreen } from '@/mobile/screens/FriendsScreen';
```

и заменить кейс:

```tsx
    case 'friends':
      return <HomeView />;
```

на:

```tsx
    case 'friends':
      return <FriendsScreen />;
```

- [ ] **Step 8: Гейты**

Run: `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
Expected: все три — 0 байт / «непереведённых строк не найдено».
Run: `npx vitest run src/mobile/menus/__tests__/useFriendMenuItems.test.tsx src/mobile/screens/__tests__/FriendsScreen.test.tsx src/mobile/screens/__tests__/renderScreen.test.tsx`
Expected: всё PASS (включая существующий `renderScreen.test.tsx` — кейс
`friendAdd` по-прежнему падает в заглушку, см. D1).

---

### Task 4: `ProfileScreen`

**Files:**
- Create: `client/src/mobile/screens/ProfileScreen.tsx`
- Create: `client/src/mobile/screens/ProfileScreen.css`
- Create: `client/src/mobile/screens/__tests__/ProfileScreen.test.tsx`
- Modify: `client/src/mobile/screens/__tests__/fixtures.tsx` (обогатить `user`)
- Modify: `client/src/mobile/screens/renderScreen.tsx`

**Interfaces:**
- Consumes: `ScreenCtx` (`c.user`, `c.logout`, `nav.push`), `ConfirmModal`
  (`@/components/ConfirmModal`), `noiseCancellationService` (`@/services/noiseCancellation`).
- Produces: `ProfileScreen({ ctx }: { ctx: ScreenCtx }): JSX.Element`. Навигация
  использует `{ kind: 'settings'; section: SettingsSection }` — потребитель T5.

- [ ] **Step 1: `ProfileScreen.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { Globe, Palette, Shield, User as UserIcon, Video, Volume2 } from 'lucide-react';
import { Avatar } from '@/components/Avatar';
import { ConfirmModal } from '@/components/ConfirmModal';
import { noiseCancellationService } from '@/services/noiseCancellation';
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { MobileListRow } from '@/mobile/components/MobileListRow';
import type { SettingsSection } from '@/mobile/nav/types';
import { useT, type TKey } from '@/i18n';
import type { ScreenCtx } from './types';
import './ProfileScreen.css';

const ROWS: { section: SettingsSection; labelKey: TKey; Icon: typeof UserIcon }[] = [
  { section: 'profile', labelKey: 'settings.tabProfile', Icon: UserIcon },
  { section: 'privacy', labelKey: 'settings.privacy', Icon: Shield },
  { section: 'audio', labelKey: 'settings.tabAudio', Icon: Volume2 },
  { section: 'video', labelKey: 'settings.tabVideo', Icon: Video },
  { section: 'appearance', labelKey: 'settings.tabAppearance', Icon: Palette },
  { section: 'language', labelKey: 'settings.language', Icon: Globe },
];

/** Корень вкладки «Профиль» (спека §5.8). Карточка — новая мобильная
 *  разметка (аватар 72 + email — которых `UserPanel` не показывает; тот
 *  компонент остаётся отдельным десктопным боковым виджетом,
 *  `DesktopShell.tsx` не трогаем). Список ведёт в settings{section} (T5). */
export function ProfileScreen({ ctx }: { ctx: ScreenCtx }) {
  const { c, nav } = ctx;
  const t = useT();
  const [ncEnabled, setNcEnabled] = useState(false);
  const [confirmLogout, setConfirmLogout] = useState(false);

  useEffect(() => {
    setNcEnabled(noiseCancellationService.getState().isEnabled);
    const unsub = noiseCancellationService.onStateChange((state) => setNcEnabled(state.isEnabled));
    return unsub;
  }, []);

  return (
    <div className="profile-screen">
      <ScreenHeader title={t('mobile.tabProfile')} />
      <div className="profile-screen-scroll">
        <div className="profile-card">
          <Avatar url={c.user?.avatar_url} username={c.user?.username ?? ''} className="profile-card-avatar" />
          <span className="profile-card-name">{c.user?.username}</span>
          <span className="profile-card-email">{c.user?.email}</span>
          <span className="profile-card-status">
            {t('server.online')}
            {ncEnabled && ` · ${t('channel.ncOn')}`}
          </span>
        </div>
        <div className="profile-list">
          {ROWS.map(({ section, labelKey, Icon }) => (
            <MobileListRow
              key={section}
              avatar={<span className="profile-list-icon"><Icon size={20} strokeWidth={1.8} /></span>}
              title={t(labelKey)}
              onClick={() => nav.push({ kind: 'settings', section })}
            />
          ))}
        </div>
        <button type="button" className="btn btn-danger-soft profile-logout-btn" onClick={() => setConfirmLogout(true)}>
          {t('common.logout')}
        </button>
      </div>

      <ConfirmModal
        open={confirmLogout}
        title={t('common.logoutTitle')}
        body={t('common.logoutBody')}
        confirmLabel={t('common.logout')}
        onConfirm={c.logout}
        onCancel={() => setConfirmLogout(false)}
      />
    </div>
  );
}
```

- [ ] **Step 2: `ProfileScreen.css`**

```css
/* VYC-95 §5.8. Экран рендерится только мобильной оболочкой — медиазапросов нет. */
.profile-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.profile-screen-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding-bottom: env(safe-area-inset-bottom);
}

.profile-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
  padding: 24px 16px 20px;
  text-align: center;
}

.profile-card-avatar {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 72px;
  height: 72px;
  border-radius: var(--radius-pill);
  font-size: 26px;
  font-weight: 700;
  object-fit: cover;
}

.profile-card-name {
  margin-top: 8px;
  color: var(--ink);
  font-size: 18px;
  font-weight: 700;
}

.profile-card-email {
  color: var(--muted);
  font-size: 13px;
}

.profile-card-status {
  margin-top: 4px;
  color: var(--muted-2);
  font-size: 12.5px;
}

.profile-list {
  margin-top: 8px;
  border-top: 1px solid var(--line);
}

.profile-list-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: var(--radius-row);
  background: var(--canvas-2);
  color: var(--muted);
}

.profile-logout-btn {
  display: block;
  width: calc(100% - 32px);
  margin: 20px 16px 24px;
}
```

- [ ] **Step 3: обогатить общую фикстуру пользователя**

Modify `client/src/mobile/screens/__tests__/fixtures.tsx`: заменить

```ts
export const user: User = { id: 'u1' } as User;
```

на

```ts
export const user: User = { id: 'u1', username: 'anna', email: 'anna@example.com' } as User;
```

(безопасно и аддитивно — существующие тесты не проверяют отсутствие этих полей).

- [ ] **Step 4: тест экрана**

```tsx
// client/src/mobile/screens/__tests__/ProfileScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ProfileScreen } from '@/mobile/screens/ProfileScreen';
import { controller, nav } from './fixtures';

vi.mock('@/services/noiseCancellation', () => ({
  noiseCancellationService: { getState: () => ({ isEnabled: false }), onStateChange: () => () => {} },
}));

afterEach(cleanup);

function mount() {
  const n = nav();
  const c = controller();
  render(
    <MemoryRouter initialEntries={[{ pathname: '/app', state: { m: [{ kind: 'profile' }], b: 0 } }]}>
      <ProfileScreen ctx={{ c, nav: n, joinVoice: vi.fn() }} />
    </MemoryRouter>,
  );
  return { n, c };
}

describe('ProfileScreen (VYC-95 этап 5)', () => {
  it('карточка показывает username и email', () => {
    mount();
    expect(document.body.textContent).toContain('anna');
    expect(document.body.textContent).toContain('anna@example.com');
  });

  it('пункт «Профиль» ведёт на settings{profile}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[0]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'profile' });
  });

  it('пункт «Язык» (последний) ведёт на settings{language}', () => {
    const { n } = mount();
    fireEvent.click(document.querySelectorAll('.mobile-row')[5]);
    expect(n.push).toHaveBeenCalledWith({ kind: 'settings', section: 'language' });
  });

  it('«Выйти» требует подтверждения перед c.logout', () => {
    const { c } = mount();
    fireEvent.click(document.querySelector('.profile-logout-btn')!);
    expect(c.logout).not.toHaveBeenCalled();
    fireEvent.click(document.querySelector('.confirm-modal-actions .btn-danger')!);
    expect(c.logout).toHaveBeenCalled();
  });
});
```

- [ ] **Step 5: подключить в `renderScreen.tsx`, удалить `ProfileRoot`/`UserPanel`**

Modify `client/src/mobile/screens/renderScreen.tsx`: удалить функцию
`ProfileRoot` целиком (строки — локально определённая функция вида
`function ProfileRoot({ c }: { c: AppController }) { … }`), удалить импорт
`UserPanel` (`import { UserPanel } from '@/components/UserPanel';`), добавить

```tsx
import { ProfileScreen } from '@/mobile/screens/ProfileScreen';
```

и заменить кейс:

```tsx
    case 'profile':
      return <ProfileRoot c={c} />;
```

на:

```tsx
    case 'profile':
      return <ProfileScreen ctx={ctx} />;
```

- [ ] **Step 6: Гейты**

Run: `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
Run: `npx vitest run src/mobile/screens/__tests__/ProfileScreen.test.tsx src/mobile/screens/__tests__/renderScreen.test.tsx`
Expected: всё зелёное.

---

### Task 5: `SettingsScreen` (экран `settings{section}`)

**Files:**
- Create: `client/src/mobile/screens/SettingsScreen.tsx`
- Create: `client/src/mobile/screens/SettingsScreen.css`
- Create: `client/src/mobile/screens/__tests__/SettingsScreen.test.tsx`
- Modify: `client/src/mobile/screens/renderScreen.tsx`

**Interfaces:**
- Consumes: `ProfileAccountBody`/`PrivacyBody`/`LanguageBody` (T2, без
  пропсов), `AudioSettings`/`VideoSettings`/`AppearanceSettings` (без
  изменений, без пропсов), `SettingsSection` (`@/mobile/nav/types`).
- Produces: `SettingsScreen({ section, onBack }: { section: SettingsSection;
  onBack: () => void }): JSX.Element`.

- [ ] **Step 1: `SettingsScreen.tsx`**

```tsx
import { ScreenHeader } from '@/mobile/components/ScreenHeader';
import { ProfileAccountBody } from '@/components/settings/ProfileAccountBody';
import { PrivacyBody } from '@/components/settings/PrivacyBody';
import { LanguageBody } from '@/components/settings/LanguageBody';
import { AudioSettings } from '@/components/settings/AudioSettings';
import { VideoSettings } from '@/components/settings/VideoSettings';
import { AppearanceSettings } from '@/components/settings/AppearanceSettings';
import type { SettingsSection } from '@/mobile/nav/types';
import { useT, type TKey } from '@/i18n';
import './SettingsScreen.css';

const TITLE_KEY: Record<SettingsSection, TKey> = {
  profile: 'settings.tabProfile',
  privacy: 'settings.privacy',
  audio: 'settings.tabAudio',
  video: 'settings.tabVideo',
  appearance: 'settings.tabAppearance',
  language: 'settings.language',
};

/** Экран `settings{section}` (спека §5.8, §5.9): каждый пункт списка
 *  «Профиль» (ProfileScreen.tsx, T4) ведёт сюда со своим `section`. Тела —
 *  те же компоненты, что десктопный Settings.tsx: ProfileAccountBody/
 *  PrivacyBody/LanguageBody из T2 для profile/privacy/language;
 *  AudioSettings/VideoSettings/AppearanceSettings переиспользованы БЕЗ
 *  изменений — их CSS (.settings-section, .setting-row, …) уже в бандле
 *  через ProfileSettings.tsx → Settings.tsx (тот же приём, что
 *  MobileGuestSheet.tsx документирует для GuestInvitePopover.css). */
export function SettingsScreen({ section, onBack }: { section: SettingsSection; onBack: () => void }) {
  const t = useT();
  return (
    <div className="settings-screen">
      <ScreenHeader title={t(TITLE_KEY[section])} onBack={onBack} />
      <div className="settings-screen-body">
        {section === 'profile' && <ProfileAccountBody />}
        {section === 'privacy' && <PrivacyBody />}
        {section === 'audio' && <AudioSettings />}
        {section === 'video' && <VideoSettings />}
        {section === 'appearance' && <AppearanceSettings />}
        {section === 'language' && <LanguageBody />}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: `SettingsScreen.css`**

```css
/* VYC-95 §5.8/§5.9. Экран рендерится только мобильной оболочкой — медиазапросов нет. */
.settings-screen {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
  background: var(--canvas);
}

.settings-screen-body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 8px 16px calc(16px + env(safe-area-inset-bottom));
}
```

- [ ] **Step 3: тест**

```tsx
// client/src/mobile/screens/__tests__/SettingsScreen.test.tsx
// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, fireEvent } from '@testing-library/react';
import { SettingsScreen } from '@/mobile/screens/SettingsScreen';
import { useAuthStore } from '@/stores/authStore';

vi.mock('@/services/noiseCancellation', () => ({
  noiseCancellationService: {
    getState: () => ({ isEnabled: false, isLoading: false }),
    onStateChange: () => () => {},
    setEnabled: vi.fn(async () => {}),
  },
  NoiseCancellationService: { isSupported: () => true },
}));

beforeEach(() => {
  useAuthStore.setState({
    user: {
      id: 'u1', username: 'anna', email: 'anna@example.com',
      show_last_seen: true, allow_friend_requests: 'everyone', allow_dm_from: 'friends',
    } as never,
  });
});
afterEach(cleanup);

describe('SettingsScreen (VYC-95 этап 5)', () => {
  it.each([
    ['profile', 'Профиль', 'anna@example.com'],
    ['privacy', 'Приватность', 'Показывать последний визит'],
    ['audio', 'Аудио', 'Проверка микрофона'],
    ['video', 'Видео', 'Камера'],
    ['appearance', 'Внешний вид', 'Тема'],
    ['language', 'Язык', 'Язык интерфейса'],
  ] as const)('section=%s — заголовок и тело', (section, title, bodyText) => {
    render(<SettingsScreen section={section} onBack={() => {}} />);
    expect(document.querySelector('.screen-header-name')?.textContent).toBe(title);
    expect(document.body.textContent).toContain(bodyText);
  });

  it('кнопка «назад» зовёт onBack', () => {
    const onBack = vi.fn();
    render(<SettingsScreen section="profile" onBack={onBack} />);
    fireEvent.click(document.querySelector('.screen-header-btn')!);
    expect(onBack).toHaveBeenCalled();
  });
});
```

- [ ] **Step 4: подключить в `renderScreen.tsx`**

Modify `client/src/mobile/screens/renderScreen.tsx`: добавить

```tsx
import { SettingsScreen } from '@/mobile/screens/SettingsScreen';
```

и новый кейс (после `case 'profile': …`, перед `case 'channels': …`):

```tsx
    case 'settings':
      return <SettingsScreen section={screen.section} onBack={nav.back} />;
```

- [ ] **Step 5: Гейты**

Run: `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n`
Run: `npx vitest run src/mobile/screens/__tests__/SettingsScreen.test.tsx src/mobile/screens/__tests__/renderScreen.test.tsx`
Expected: всё зелёное.

---

### Task 6: `AuthPage` — CSS-полировка `(width < 900px)`

**Files:**
- Modify: `client/src/pages/Auth.css`

**Interfaces:** нет (только CSS; `AuthPage.tsx`/`OtpCodeInput.tsx` не меняются
— `inputMode="numeric"`/`autoComplete="one-time-code"` уже на месте, ячейки
56×64 уже ≥44×44).

- [ ] **Step 1: добавить мобильный блок в конец `Auth.css`**

```css
@media (width < 900px) {
  .auth-container {
    min-height: 100dvh;
    padding: max(24px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right))
      max(24px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left));
  }

  /* 16px, не десктопные 14px — держит Safari/Chrome на iOS от автозума при
     фокусе поля (спека §5.11). Кнопка отправки уже идёт последним элементом
     формы (после полей) — на короткой одноколоночной карточке она и так
     ближе к низу; здесь докладываем только safe-area/dvh. */
  .form-group input {
    font-size: 16px;
  }
}
```

- [ ] **Step 2: Гейты**

Run: `npx stylelint "src/**/*.css"`
Expected: 0 байт вывода.

- [ ] **Step 3: визуальная проверка (390×844, обе темы, все 4 шага auth)**

Через `client/tools/verify/smoke.mjs` (см. `client/docs/verification.md`)
открыть `/auth`, прогнать шаги email → code → username и password → в обеих
темах на ширине 390px: инпуты не вызывают зум при фокусе (проверить
computed `font-size` ≥16px через CDP), кнопка отправки не перекрыта
safe-area. На ширине ≥900px — снять AE-сравнение с「до」скриншотом (если он
есть в `.superpowers/vyc95/`) или явно зафиксировать, что `.auth-container`/
`.form-group input` вне медиа-блока не менялись (`git diff` по файлу — правки
только внутри `@media (width < 900px)`).

---

### Task 7: Таблица покрытия, i18n-сверка, приёмка

**Files:**
- Modify: `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`

Финальный проход этапа: приёмочная визуальная проверка + честное обновление
таблицы покрытия. Выполняется ПОСЛЕ задач 1–6, на актуальном дереве.

- [ ] **Step 1: полный прогон гейтов**

Run (из `client/`): `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test`
Expected: tsc/stylelint/i18n — чисто; `npm test` — ровно 3 падения, все в
`api.network-retry.test.ts` (то же число, что до этапа — если больше, искать
регресс, не «чинить» этот файл).

- [ ] **Step 2: визуальный смоук (390×844, обе темы) через `client/tools/verify/smoke.mjs`**

Фикстуры — прямой импорт сторов (`await import('/src/stores/friendStore')` и
т.д.) в `--preload`/`--eval-file`, тот же приём, что этапы 2–4 (реальный
бэкенд недостижим из dev-сервера в этой среде). Снять и сверить AE:
- «Друзья»: все 4 сегмента (В сети/Все/Ожидание с непустыми входящими и
  исходящими/Заблокированные), открытая шторка «+» (AddFriendForm), открытый
  ActionSheet друга (онлайн-друг и заблокированный — разный набор пунктов).
- «Профиль»: карточка (с NC on и без), список из 6 пунктов, `ConfirmModal`
  выхода.
- Все 6 `settings{section}` экранов.
- `AuthPage` на 390px, все 4 шага, обе темы.
- Десктопная идентичность: `Settings.tsx` (все 4 вкладки, обе темы) на
  1280×800 — AE=0 против скриншотов «до» этапа 5 (снять их из `git stash`/
  предыдущего коммита, если отдельного «до»-набора нет — сравнить текущий
  рендер вкладки «Профиль» до и после T2 построчно как страховку сверх T1's
  DOM-снимка).

- [ ] **Step 3: обновить таблицу покрытия (§10)**

Modify `docs/superpowers/specs/2026-09-20-mobile-redesign-design.md`: строки
1–4 (Auth), 6 (Главная/друзья), 70–86 (Друзья, Профиль и настройки) — колонка
«Проверка» с «план» на «✅ этап 5 — …» с путями к скриншотам/тестам (по
образцу строк, закрытых на этапах 2–4). Строка 91 (контекстные меню →
touch) — снять «⏳ частично», меню друга теперь покрыто; отметить «✅ этап
2+5». Если приёмка (Step 2) найдёт реальные дефекты, которые решено
отложить — завести раздел «### Этап 5 — отложено и найдено по пути» (по
образцу разделов этапов 2–4) с честным описанием и обоснованием отсрочки,
а не молчать о них в таблице.

- [ ] **Step 4: финальный гейт-прогон после правок спеки**

Run: `npx tsc --noEmit && npx stylelint "src/**/*.css" && npm run check:i18n && npm test`
Expected: то же самое, что Step 1 (правки спеки — документ, не код, гейты не
могли измениться, но перепроверка дешева и обязательна перед хэндоффом).
