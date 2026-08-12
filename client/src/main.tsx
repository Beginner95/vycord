import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './index.css';
import './stores/themeStore';
import './stores/localeStore';
import { initErrorReporting } from './services/errorReporting';
import { apiService } from './services/api';

initErrorReporting();
apiService.initAuthLifecycle();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
