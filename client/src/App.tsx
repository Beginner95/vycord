import { BrowserRouter, HashRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter';
import { UpdateBanner } from './components/UpdateBanner';
import { ErrorBoundary } from './components/ErrorBoundary';

// Electron serves the app from file://, where BrowserRouter's real paths
// (e.g. file:///app) break on reload — there's no server to fall back to
// index.html. HashRouter keeps navigation in the URL fragment, which always
// resolves to the same physical file. The web build keeps clean paths.
const isElectron = typeof window !== 'undefined' && !!window.electronAPI;
const Router = isElectron ? HashRouter : BrowserRouter;

function App() {
  return (
    <ErrorBoundary>
      <Router>
        <UpdateBanner />
        <AppRouter />
      </Router>
    </ErrorBoundary>
  );
}

export default App;
