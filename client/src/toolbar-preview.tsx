import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Toolbar } from '@/components/toolbar';

function App() {
  return (
    <div className="relative h-[220px] w-full bg-canvas">
      <Toolbar />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
