import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiService, apiErrorText, ApiError } from '@/services/api';
import { wsService } from '@/services/websocket';
import { OtpCodeInput } from '@/components/OtpCodeInput';
import { useT } from '@/i18n';
import './Auth.css';

const MIN_PASSWORD_LENGTH = 8;

type Step = 'form' | 'code';

const RESEND_COOLDOWN_SECONDS = 60;

export function RegisterPage() {
  const navigate = useNavigate();
  const t = useT();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('form');
  const [code, setCode] = useState('');
  const [cooldown, setCooldown] = useState(0);

  // Обратный отсчёт до следующей разрешённой отправки. Сервер всё равно
  // ответит 429, но пользователю нужно видеть, сколько ждать, а не жать
  // кнопку впустую.
  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordMinLength', { min: MIN_PASSWORD_LENGTH }));
      return;
    }

    setLoading(true);
    try {
      await apiService.register(username, email, password);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (submitted: string) => {
    setError('');
    setLoading(true);
    try {
      const data = await apiService.verifyRegistrationCode(email, submitted);
      login(data.access_token, data.refresh_token, data.user);
      apiService.scheduleTokenRefresh(data.access_token);
      await wsService.connect(data.access_token);
      navigate('/app');
    } catch (err) {
      // Исчерпанные попытки сжигают код целиком — чистим поле, чтобы
      // пользователь не добивал мёртвый код.
      if (err instanceof ApiError && err.code === 'otp_attempts_exceeded') {
        setCode('');
      }
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleResend = async () => {
    setError('');
    try {
      await apiService.resendRegistrationCode(email);
      setCooldown(RESEND_COOLDOWN_SECONDS);
      setCode('');
    } catch (err) {
      setError(apiErrorText(err, t));
    }
  };

  if (step === 'code') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{t('auth.enterCode')}</h1>
            <p>{t('auth.codeSentTo', { email })}</p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <OtpCodeInput value={code} onChange={setCode} onComplete={handleVerify} disabled={loading} autoFocus />

          <button
            type="button"
            className="auth-link-button"
            onClick={handleResend}
            disabled={cooldown > 0 || loading}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : t('auth.resendCode')}
          </button>

          <button
            type="button"
            className="auth-link-button"
            onClick={() => { setStep('form'); setCode(''); setError(''); }}
          >
            {t('auth.changeEmail')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-container">
      <div className="auth-card">
        <div className="auth-header">
          <h1>{t('auth.createAccount')}</h1>
          <p>{t('auth.registerSubtitle')}</p>
        </div>

        <form onSubmit={handleSubmit}>
          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label htmlFor="username">{t('auth.username')}</label>
            <input
              id="username"
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
              minLength={2}
              maxLength={50}
              autoFocus
            />
          </div>

          <div className="form-group">
            <label htmlFor="email">{t('auth.email')}</label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
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
              minLength={MIN_PASSWORD_LENGTH}
            />
          </div>

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? t('auth.creatingAccount') : t('auth.continueButton')}
          </button>

          <div className="auth-footer">
            {t('auth.haveAccount')} <Link to="/login">{t('auth.loginLink')}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
