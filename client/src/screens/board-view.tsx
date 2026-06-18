import { useEffect, useRef, useState } from 'react';
import { boardRepository } from '@/board/server-board-repository';
import { Canvas } from '@/canvas/Canvas';
import {
  loadBoard,
  setCurrentPage,
  useDocumentStore,
} from '@/canvas/use-document-store';
import {
  type Identity,
  resolveIdentity,
  setStoredName,
} from '@/collab/identity';
import { setLocalUser } from '@/collab/presence';
import { BoardChrome } from '@/components/board-chrome';
import { CanvasContextMenu } from '@/components/canvas-context-menu';
import { GraphPanel } from '@/components/graph-panel';
import { NameDialog } from '@/components/name-dialog';
import { StylePanel } from '@/components/style-panel';
import { Toolbar } from '@/components/toolbar';
import { navigate } from '@/router';

/** The board editor for one board id. Loads content + sets up presence. */
export function BoardView({ boardId }: { boardId: string }) {
  const [name, setName] = useState('Whiteboard');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [assignedColor, setAssignedColor] = useState('#2f6df6');

  // The page id requested by the share link (`?p=`), pending until it syncs in.
  const pendingPage = useRef<string | null>(null);
  const pages = useDocumentStore((s) => s.doc.pages);
  const currentPageId = useDocumentStore((s) => s.currentPageId);

  // Load board content + collaboration.
  useEffect(() => {
    pendingPage.current = new URLSearchParams(window.location.search).get('p');
    const dispose = loadBoard(boardId, { persist: true, collab: true });
    void boardRepository.get(boardId).then((b) => {
      if (b) setName(b.name);
    });
    return dispose;
  }, [boardId]);

  // Deep link: jump to the shared page once it exists in the synced doc.
  useEffect(() => {
    const target = pendingPage.current;
    if (target && pages[target]) {
      setCurrentPage(target);
      pendingPage.current = null;
    }
  }, [pages]);

  // Keep the address bar's `?p=` pointed at the active page (no history spam),
  // so the Share link always reflects the slide you're on.
  useEffect(() => {
    if (pendingPage.current) return; // wait until the deep link is applied
    const url = new URL(window.location.href);
    if (url.searchParams.get('p') === currentPageId) return;
    url.searchParams.set('p', currentPageId);
    window.history.replaceState({}, '', url);
  }, [currentPageId]);

  // Resolve who we are (tutor vs. student) once.
  useEffect(() => {
    let cancelled = false;
    void resolveIdentity().then((r) => {
      if (cancelled) return;
      setAssignedColor(r.color);
      if (r.identity) setIdentity(r.identity);
      else setNeedsName(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Publish our identity to awareness whenever it changes.
  useEffect(() => {
    if (identity) setLocalUser(identity);
  }, [identity]);

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-background text-foreground">
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
      <BoardChrome
        title={name}
        onBack={() => navigate('/')}
        identity={identity}
      />
      <Toolbar />
      <GraphPanel />
      <StylePanel />

      <NameDialog
        open={needsName}
        color={assignedColor}
        onSubmit={(n) => {
          setStoredName(n);
          setIdentity({ name: n, color: assignedColor, isTutor: false });
          setNeedsName(false);
        }}
      />
    </div>
  );
}
