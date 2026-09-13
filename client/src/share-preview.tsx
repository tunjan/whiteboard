import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { useDocumentStore } from '@/canvas/use-document-store';
import { ShareButton } from '@/components/share-button';

const pages = new URLSearchParams(location.search).has('one')
  ? { a: { id: 'a', name: 'Page 1' } }
  : { a: { id: 'a', name: 'Page 1' }, b: { id: 'b', name: 'Quadratics warm-up' } };
useDocumentStore.setState({
  boardId: 'k3j9x2mq7w',
  currentPageId: Object.keys(pages).length > 1 ? 'b' : 'a',
  doc: { pages, pageOrder: Object.keys(pages) },
} as never);

if (new URLSearchParams(location.search).has('dark')) document.documentElement.classList.add('dark');
document.body.style.background = 'var(--bg-canvas)';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <div style={{ display: 'flex', justifyContent: 'flex-end', padding: 24 }}>
      <ShareButton />
    </div>
  </StrictMode>,
);
