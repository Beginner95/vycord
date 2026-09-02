import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuthStore } from '@/stores/authStore';
import { AuthPage } from '@/pages/AuthPage';
import { AppPage } from '@/pages/AppPage';

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <>{children}</> : <Navigate to="/login" />;
}

function PublicRoute({ children }: { children: React.ReactNode }) {
  const isAuthenticated = useAuthStore((state) => state.isAuthenticated);
  return isAuthenticated ? <Navigate to="/app" /> : <>{children}</>;
}

export function AppRouter() {
  return (
    <Routes>
      <Route
        path="/login"
        element={
          <PublicRoute>
            <AuthPage />
          </PublicRoute>
        }
      />
      <Route path="/register" element={<Navigate to="/login" />} />
      <Route
        path="/app"
        element={
          <PrivateRoute>
            <AppPage />
          </PrivateRoute>
        }
      />
      <Route path="/" element={<Navigate to="/app" />} />
      <Route path="*" element={<Navigate to="/app" />} />
    </Routes>
  );
}
