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
