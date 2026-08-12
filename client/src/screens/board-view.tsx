import { lazy, Suspense, useEffect, useRef, useState } from 'react';
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
  setStoredColor,
  setStoredName,
} from '@/collab/identity';
import { setLocalUser } from '@/collab/presence';
import { VoiceAudioSinks } from '@/collab/voice/VoiceAudioSinks';
import { BoardChrome } from '@/components/board-chrome';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { CanvasContextMenu } from '@/components/canvas-context-menu';
import { LatencyWarningToast } from '@/components/latency-warning-toast';
import { NameDialog } from '@/components/name-dialog';
import { StylePanel } from '@/components/style-panel';
import { Toolbar } from '@/components/toolbar';
import { navigate } from '@/router';

// These panels pull in MathLive and its KaTeX assets. Keep them outside the
// entry bundle so the browser can parse and cache them independently.
const EquationPanel = lazy(() =>
  import('@/components/equation-panel').then(({ EquationPanel }) => ({
    default: EquationPanel,
  })),
);
const GraphPanel = lazy(() =>
  import('@/components/graph-panel').then(({ GraphPanel }) => ({
    default: GraphPanel,
  })),
);

/** The board editor for one board id. Loads content + sets up presence. */
export function BoardView({ boardId }: { boardId: string }) {
  const [name, setName] = useState('Whiteboard');
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [needsName, setNeedsName] = useState(false);
  const [assignedColor, setAssignedColor] = useState('#2563EB');
  const [editingIdentity, setEditingIdentity] = useState(false);
  const [renamingBoard, setRenamingBoard] = useState(false);

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
      if (r.identity?.isTutor) void boardRepository.markOpened(boardId);
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
    <div className="relative h-dvh w-screen overflow-hidden overscroll-none bg-muted text-primary">
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
      <BoardChrome
        boardId={boardId}
        title={name}
        onBack={() => navigate('/')}
        onRenameTitle={
          identity?.isTutor ? () => setRenamingBoard(true) : undefined
        }
        onEditIdentity={identity ? () => setEditingIdentity(true) : undefined}
        identity={identity}
      />
      <LatencyWarningToast />
      <VoiceAudioSinks />
      <Toolbar />
      <Suspense fallback={null}>
        <GraphPanel />
        <EquationPanel />
      </Suspense>
      <StylePanel />

      <NameDialog
        open={needsName || editingIdentity}
        editing={editingIdentity}
        initialName={identity?.name ?? ''}
        initialColor={identity?.color ?? assignedColor}
        colorEditable={!identity?.isTutor}
        onSubmit={(n, c) => {
          setStoredName(n);
          const isTutor = identity?.isTutor ?? false;
          const color = isTutor ? (identity?.color ?? assignedColor) : c;
          if (!isTutor) setStoredColor(color);
          setIdentity({ name: n, color, isTutor });
          setNeedsName(false);
          setEditingIdentity(false);
        }}
      />
      <BoardTitleDialog
        open={renamingBoard}
        heading="Rename Board"
        initialValue={name}
        submitLabel="Save Changes"
        onOpenChange={setRenamingBoard}
        onSubmit={async (title) => {
          await boardRepository.rename(boardId, title);
          setName(title);
          setRenamingBoard(false);
        }}
      />
    </div>
  );
}
