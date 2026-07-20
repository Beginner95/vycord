import { BrowserRouter } from 'react-router-dom';
import { AppRouter } from './AppRouter';
import { UpdateBanner } from './components/UpdateBanner';

function App() {
  return (
    <BrowserRouter>
      <UpdateBanner />
      <AppRouter />
    </BrowserRouter>
  );
}

export default App;
