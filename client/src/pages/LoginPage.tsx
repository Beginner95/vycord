import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiService, apiErrorText, ApiError } from '@/services/api';
import { wsService } from '@/services/websocket';
import { OtpCodeInput } from '@/components/OtpCodeInput';
import type { User } from '@/types';
import { useT } from '@/i18n';
import './Auth.css';

type Mode = 'password' | 'code-email' | 'code-verify' | 'verify-registration';

const RESEND_COOLDOWN_SECONDS = 60;

export function LoginPage() {
  const navigate = useNavigate();
  const t = useT();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mode, setMode] = useState<Mode>('password');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const data = await apiService.login(email, password) as { access_token: string; refresh_token: string; user: User };
      login(data.access_token, data.refresh_token, data.user);
      apiService.scheduleTokenRefresh(data.access_token);

      // Connect WebSocket
      await wsService.connect(data.access_token);

      navigate('/app');
    } catch (err) {
      // Аккаунт есть, но почта не подтверждена. Сервер намеренно НЕ шлёт код
      // на этом шаге, иначе форма входа рассылала бы письма на любой чужой
      // адрес. Показываем экран кода с кнопкой отправки.
      if (err instanceof ApiError && err.code === 'email_not_verified') {
        setMode('verify-registration');
        setError('');
        return;
      }
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleRequestLoginCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiService.requestLoginCode(email);
      setMode('code-verify');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyLoginCode = async (submitted: string) => {
    setError('');
    setLoading(true);
    try {
      const data = await apiService.verifyLoginCode(email, submitted);
      login(data.access_token, data.refresh_token, data.user);
      apiService.scheduleTokenRefresh(data.access_token);
      await wsService.connect(data.access_token);
      navigate('/app');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'otp_attempts_exceeded') {
        setCode('');
      }
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  // Экран после 403: код отправляется только по кнопке. Автоотправка
  // превратила бы неудачную попытку входа в рассылку писем.
  const handleSendRegistrationCode = async () => {
    setError('');
    try {
      await apiService.resendRegistrationCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  const handleVerifyRegistrationCode = async (submitted: string) => {
    setError('');
    setLoading(true);
    try {
      const data = await apiService.verifyRegistrationCode(email, submitted);
      login(data.access_token, data.refresh_token, data.user);
      apiService.scheduleTokenRefresh(data.access_token);
      await wsService.connect(data.access_token);
      navigate('/app');
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  if (mode === 'code-email') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{t('auth.loginWithCode')}</h1>
          </div>

          <form onSubmit={handleRequestLoginCode}>
            {error && <div className="auth-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="code-email">{t('auth.email')}</label>
              <input
                id="code-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoFocus
              />
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>{t('auth.sendCode')}</button>
          </form>

          <button
            type="button"
            className="auth-link-button"
            onClick={() => { setMode('password'); setError(''); }}
          >
            {t('auth.backToPassword')}
          </button>
        </div>
      </div>
    );
  }

  if (mode === 'code-verify' || mode === 'verify-registration') {
    const isRegistration = mode === 'verify-registration';
    const onComplete = isRegistration ? handleVerifyRegistrationCode : handleVerifyLoginCode;
    const onSend = isRegistration ? handleSendRegistrationCode : handleRequestLoginCode;

    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{isRegistration ? t('auth.emailNotVerifiedTitle') : t('auth.enterCode')}</h1>
            <p>{isRegistration ? t('auth.emailNotVerifiedHint') : t('auth.codeSentTo', { email })}</p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <OtpCodeInput value={code} onChange={setCode} onComplete={onComplete} disabled={loading} autoFocus />

          <button
            type="button"
            className="auth-link-button"
            onClick={() => onSend()}
            disabled={cooldown > 0 || loading}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.sendCode')}
          </button>

          <button
            type="button"
            className="auth-link-button"
            onClick={() => { setMode('password'); setCode(''); setError(''); }}
          >
            {t('auth.backToPassword')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>{t('auth.welcomeBack')}</h1>
          <p>{t('auth.welcomeBackSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="email">{t('auth.email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="password">{t('auth.password')}</label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? t('auth.loggingIn') : t('auth.logIn')}
          </button>

          <button type="button" className="auth-link-button" onClick={() => { setMode('code-email'); setError(''); }}>
            {t('auth.loginWithCode')}
          </button>

          <div className="auth-footer">
            {t('auth.needAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
