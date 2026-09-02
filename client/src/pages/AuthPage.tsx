import { useEffect, useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiService, apiErrorText, ApiError } from '@/services/api';
import { wsService } from '@/services/websocket';
import { OtpCodeInput } from '@/components/OtpCodeInput';
import type { User } from '@/types';
import { useT } from '@/i18n';
import './Auth.css';

type Step = 'email' | 'code' | 'username' | 'password';

const RESEND_COOLDOWN_SECONDS = 60;

type TokenResponse = { access_token: string; refresh_token: string; user: User };

export function AuthPage() {
  const navigate = useNavigate();
  const t = useT();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [username, setUsername] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState<Step>('email');
  const [codeSent, setCodeSent] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const completeLogin = async (data: TokenResponse) => {
    login(data.access_token, data.refresh_token, data.user);
    apiService.scheduleTokenRefresh(data.access_token);
    await wsService.connect(data.access_token);
    navigate('/app');
  };

  const handleRequestCode = async (e?: FormEvent) => {
    e?.preventDefault();
    setError('');
    setLoading(true);
    try {
      await apiService.requestOtp(email);
      setCodeSent(true);
      setStep('code');
      setCooldown(RESEND_COOLDOWN_SECONDS);
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleVerify = async (submittedCode: string, submittedUsername?: string) => {
    setError('');
    setLoading(true);
    try {
      const data = await apiService.verifyOtp(email, submittedCode, submittedUsername);
      if ('status' in data) {
        setStep('username');
        return;
      }
      await completeLogin(data);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'otp_attempts_exceeded') {
        // Код сожжён окончательно — держать пользователя на шаге username
        // (или code) смысла нет, он будет биться о мёртвый код бесконечно.
        // Единственный выход — запросить новый код заново.
        setCode('');
        setUsername('');
        setError('');
        setStep('email');
        return;
      }
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  const handleBackToEmailFromUsername = () => {
    setStep('email');
    setCode('');
    setUsername('');
    setError('');
  };

  const handleCodeComplete = (submitted: string) => {
    setCode(submitted);
    void handleVerify(submitted);
  };

  const handleUsernameSubmit = (e: FormEvent) => {
    e.preventDefault();
    void handleVerify(code, username);
  };

  const handlePasswordSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const data = await apiService.login(email, password);
      await completeLogin(data);
    } catch (err) {
      // Аккаунт есть, но почта не подтверждена. Код здесь НЕ отправляется
      // автоматически: иначе форма входа паролем рассылала бы письма на
      // любой чужой адрес. Показываем экран кода с явной кнопкой отправки.
      if (err instanceof ApiError && err.code === 'email_not_verified') {
        setStep('code');
        setCodeSent(false);
        setError('');
        return;
      }
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

  if (step === 'password') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{t('auth.welcomeBack')}</h1>
            <p>{t('auth.welcomeBackSubtitle')}</p>
          </div>

          <form onSubmit={handlePasswordSubmit}>
            {error && <div className="auth-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="password-email">{t('auth.email')}</label>
              <input
                id="password-email"
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
          </form>

          <button
            type="button"
            className="auth-link-button"
            onClick={() => { setStep('email'); setError(''); }}
          >
            {t('auth.loginWithCode')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'code') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{codeSent ? t('auth.enterCode') : t('auth.emailNotVerifiedTitle')}</h1>
            <p>{codeSent ? t('auth.codeSentTo', { email }) : t('auth.emailNotVerifiedHint')}</p>
          </div>

          {error && <div className="auth-error">{error}</div>}

          <OtpCodeInput value={code} onChange={setCode} onComplete={handleCodeComplete} disabled={loading} autoFocus />

          <button
            type="button"
            className="auth-link-button"
            onClick={() => handleRequestCode()}
            disabled={cooldown > 0 || loading}
          >
            {cooldown > 0 ? t('auth.resendIn', { seconds: cooldown }) : (codeSent ? t('auth.resendCode') : t('auth.sendCode'))}
          </button>

          <button
            type="button"
            className="auth-link-button"
            onClick={() => { setStep('email'); setCode(''); setError(''); }}
          >
            {t('auth.changeEmail')}
          </button>
        </div>
      </div>
    );
  }

  if (step === 'username') {
    return (
      <div className="auth-container">
        <div className="auth-card">
          <div className="auth-header">
            <h1>{t('auth.chooseUsernameTitle')}</h1>
            <p>{t('auth.chooseUsernameHint')}</p>
          </div>

          <form onSubmit={handleUsernameSubmit}>
            {error && <div className="auth-error">{error}</div>}

            <div className="form-group">
              <label htmlFor="username">{t('auth.username')}</label>
              <input
                id="username"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                required
                minLength={3}
                maxLength={30}
                autoFocus
              />
            </div>

            <button type="submit" className="auth-btn" disabled={loading}>
              {loading ? t('auth.creatingAccount') : t('auth.continueButton')}
            </button>
          </form>

          <button
            type="button"
            className="auth-link-button"
            onClick={handleBackToEmailFromUsername}
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
          <h1>{t('auth.emailStepTitle')}</h1>
          <p>{t('auth.emailStepSubtitle')}</p>
        </div>

        <form onSubmit={handleRequestCode}>
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

          <button type="submit" className="auth-btn" disabled={loading}>
            {loading ? t('auth.loggingIn') : t('auth.continueButton')}
          </button>

          <button type="button" className="auth-link-button" onClick={() => { setStep('password'); setError(''); }}>
            {t('auth.backToPassword')}
          </button>
        </form>
      </div>
    </div>
  );
}
