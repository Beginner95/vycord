import { useState, type FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { apiService, apiErrorText } from '@/services/api';
import { wsService } from '@/services/websocket';
import type { User } from '@/types';
import { useT } from '@/i18n';
import './Auth.css';

export function LoginPage() {
  const navigate = useNavigate();
  const t = useT();
  const login = useAuthStore((state) => state.login);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

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
      setError(apiErrorText(err, t));
    } finally {
      setLoading(false);
    }
  };

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

          <div className="auth-footer">
            {t('auth.needAccount')} <Link to="/register">{t('auth.registerLink')}</Link>
          </div>
        </form>
      </div>
    </div>
  );
}
