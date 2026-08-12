import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiService, apiErrorText } from '@/services/api';
import { wsService } from '@/services/websocket';
import type { User } from '@/types';
import { useT } from '@/i18n';
import './Auth.css';

const MIN_PASSWORD_LENGTH = 8;

export function RegisterPage() {
  const navigate = useNavigate();
  const t = useT();
  const login = useAuthStore((state) => state.login);
  const [username, setUsername] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(t('auth.passwordMinLength', { min: MIN_PASSWORD_LENGTH }));
      setLoading(false);
      return;
    }

    try {
      const data = await apiService.register(username, email, password) as { access_token: string; refresh_token: string; user: User };
      login(data.access_token, data.refresh_token, data.user);
      apiService.scheduleTokenRefresh(data.access_token);

      // Connect WebSocket
      await wsService.connect(data.access_token);

      navigate('/app');
    } catch (err) {
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

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
