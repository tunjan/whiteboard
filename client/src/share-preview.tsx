import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { useDocumentStore } from '@/canvas/use-document-store';
import { ShareButton } from '@/components/share-button';
import { usePresenceStore } from '@/collab/use-presence-store';

const params = new URLSearchParams(location.search);
// `?student` previews what a student sees; the default is the tutor's view,
// with the link endpoints answered here.
const isTutor = !params.has('student');
let share = { key: '4f1c9a0e7b2d4c6f8a1e3b5d7c9f0a2b', mode: 'edit' };
const realFetch = window.fetch;
window.fetch = async (input, init) => {
  const url = String(input);
  if (!url.includes('/access') && !url.endsWith('/remove')) return realFetch(input, init);
  if (url.endsWith('/reset')) share = { ...share, key: crypto.randomUUID().replaceAll('-', '') };
  else if (init?.method === 'PATCH') share = { ...share, ...JSON.parse(String(init.body)) };
  return new Response(JSON.stringify(share), { headers: { 'content-type': 'application/json' } });
};
usePresenceStore.setState({
  peers: [
    { clientId: 11, name: 'Maya', color: '#d9480f', isTutor: false },
    { clientId: 12, name: 'Jonah', color: '#2f9e44', isTutor: false },
  ],
} as never);

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
      <ShareButton isTutor={isTutor} />
    </div>
  </StrictMode>,
);
