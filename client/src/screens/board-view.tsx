import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { setBoardAccess, useBoardAccessStore } from '@/board/board-access';
import { startDocumentNotifications } from '@/board/document-notifications';
import { useBoardLoadingStore } from '@/board/use-board-loading-store';
import { boardRepository } from '@/board/server-board-repository';
import { Canvas } from '@/canvas/Canvas';
import { ensureGraphMath } from '@/canvas/graph-math';
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
import { useArrivalToasts } from '@/collab/use-arrival-toasts';
import { VoiceAudioSinks } from '@/collab/voice/VoiceAudioSinks';
import { BoardChrome } from '@/components/board-chrome';
import { BoardLoadingVeil } from '@/components/board-loading-veil';
import { BoardTitleDialog } from '@/components/board-title-dialog';
import { BoardUiLayer } from '@/components/board-ui-layer';
import { useWakeLock } from '@/hooks/use-wake-lock';
import { CanvasContextMenu } from '@/components/canvas-context-menu';
import { AttentionToast } from '@/components/attention-toast';
import { LatencyWarningToast } from '@/components/latency-warning-toast';
import { NameDialog } from '@/components/name-dialog';
import { PdfRangeDialog } from '@/components/pdf-range-dialog';
import { StickerCutOutDialog } from '@/components/sticker-cutout-dialog';
import { AgentBar } from '@/components/agent-bar';
import { Toolbar } from '@/components/toolbar';
import { Toaster } from '@/components/ui/toast';
import { VideoPanel } from '@/components/video-panel';
import { Button } from '@/components/ui/button';
import { useToolStore } from '@/canvas/use-tool-store';
import { startUsageLog } from '@/lib/usage-log';
import { navigate } from '@/router';

// These panels pull in MathLive and its KaTeX assets. Keep them outside the
// entry bundle so the browser can parse and cache them independently.
const EquationPanel = lazy(() =>
  import('@/components/equation-panel').then(({ EquationPanel }) => ({
    default: EquationPanel,
  })),
);
// The panel is unusable without the mathjs parser, so it waits for both here
// and never renders the "still loading" state the canvas shapes can show.
const GraphPanel = lazy(async () => {
  const [{ GraphPanel }] = await Promise.all([
    import('@/components/graph-panel'),
    ensureGraphMath(),
  ]);
  return { default: GraphPanel };
});

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
  const boardReady = useBoardLoadingStore((s) => s.ready);

  // Held for as long as the board is open, not just while it is being drawn
  // on: watching someone else work is the common case here.
  useWakeLock(boardReady);

  // The tutor shared the link; they are the one waiting to see it land.
  useArrivalToasts(identity?.isTutor ?? false);

  const access = useBoardAccessStore((s) => s.access);
  // The link was reset or switched off, or the tutor removed this student:
  // the board is torn down rather than left reconnecting in the background.
  const accessEnded = access === 'denied' || access === 'removed';

  // Each board answers for itself; nothing carries over to the next one.
  useEffect(() => () => setBoardAccess('pending'), [boardId]);

  // The tutor's toolbar use, for deciding what the toolbar should be.
  const isTutor = identity?.isTutor ?? false;
  useEffect(() => (isTutor ? startUsageLog(boardId) : undefined), [isTutor, boardId]);

  // A view-only link keeps only the tools that change nothing.
  useEffect(() => {
    if (access === 'view') useToolStore.getState().setTool('hand');
  }, [access]);

  // Load board content + collaboration.
  useEffect(() => {
    if (accessEnded) return;
    pendingPage.current = new URLSearchParams(window.location.search).get('p');
    const dispose = loadBoard(boardId, { persist: true, collab: true });
    // After loadBoard — it resets the documents store, which would otherwise
    // land on the watcher as a repository that emptied itself.
    const stopDocumentNotifications = startDocumentNotifications(boardId);
    let cancelled = false;
    void boardRepository.get(boardId).then((b) => {
      if (b && !cancelled) setName(b.name);
    });
    return () => {
      cancelled = true;
      stopDocumentNotifications();
      dispose();
    };
  }, [boardId, accessEnded]);

  // Deep link: jump to the shared page once it exists in the synced doc.
  useEffect(() => {
    const target = pendingPage.current;
    if (!target) return;
    if (pages[target]) {
      setCurrentPage(target);
      pendingPage.current = null;
    } else if (useBoardLoadingStore.getState().ready) {
      // Loaded and still absent: the page is gone. Stop waiting for it, or
      // the address bar never tracks the open page. Read from the store, not
      // `boardReady`: on mount that can still be the previous board's answer.
      pendingPage.current = null;
    }
  }, [pages, boardReady]);

  // Keep the address bar's `?p=` pointed at the active page (no history spam),
  // so the Share link always reflects the slide you're on.
  useEffect(() => {
    if (pendingPage.current) return; // wait until the deep link is applied
    const url = new URL(window.location.href);
    if (url.searchParams.get('p') === currentPageId) return;
    url.searchParams.set('p', currentPageId);
    window.history.replaceState({}, '', url);
    // `boardReady`: a deep link given up on above has to be replaced here.
  }, [currentPageId, boardReady]);

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
  }, [boardId]);

  // iOS ignores the viewport's `user-scalable=no`, so a pinch that starts on
  // the toolbar or a panel — anywhere outside the canvas's `touch-action:
  // none` — zooms the whole app instead of the board. Safari's proprietary
  // gesture events are the one hook that stops it; the board's own pinch runs
  // on pointer events and is unaffected.
  useEffect(() => {
    const block = (e: Event) => e.preventDefault();
    document.addEventListener('gesturestart', block);
    document.addEventListener('gesturechange', block);
    return () => {
      document.removeEventListener('gesturestart', block);
      document.removeEventListener('gesturechange', block);
    };
  }, []);

  // Publish our identity to awareness whenever it changes.
  useEffect(() => {
    if (identity) setLocalUser(identity);
  }, [identity]);

  if (accessEnded) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-4 bg-panel p-6 text-center text-fg">
        <p className="max-w-xs text-sm text-pretty text-fg-secondary">
          {access === 'removed'
            ? 'You were removed from this board.'
            : 'This link no longer works. Ask your tutor for a new one.'}
        </p>
        <Button variant="secondary" onClick={() => navigate('/')}>
          Go home
        </Button>
      </div>
    );
  }

  return (
    <div
      // Flips once per load; the chrome's entrance keys off it (see
      // `[data-arrive]` in index.css) so it plays as the veil lifts, not unseen
      // behind it.
      data-arrived={boardReady ? '' : undefined}
      className="wb-board relative h-dvh w-screen overflow-hidden overscroll-none bg-panel text-fg">
      <CanvasContextMenu>
        <Canvas />
      </CanvasContextMenu>
      <BoardUiLayer>
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
        <VoiceAudioSinks />
        {access === 'view' ? null : <Toolbar />}
        {access === 'view' ? null : <AgentBar />}
        <Suspense fallback={null}>
          <GraphPanel />
          <EquationPanel />
        </Suspense>
        {/* Last, so a maximized call paints over the toolbar and side panels. */}
        <VideoPanel identity={identity} />
      </BoardUiLayer>
      <LatencyWarningToast />
      {/* Tutor-only, and silent by design: the student is told nothing. */}
      {identity?.isTutor ? <AttentionToast /> : null}
      <Toaster />

      {/* Opened from the paste handler, not from a control, when a pasted PDF
          runs past the import limit. */}
      <PdfRangeDialog isTutor={identity?.isTutor ?? false} />
      {/* Opened from the sticker upload flow, once per file. */}
      <StickerCutOutDialog />
      {/* Held until the board is up: asking a student who they are over a blank
          canvas is a worse first impression than a half-second wait, and
          `resolveIdentity` has long since answered by then. */}
      <NameDialog
        open={boardReady && (needsName || editingIdentity)}
        editing={editingIdentity}
        initialName={identity?.name ?? ''}
        initialColor={identity?.color ?? assignedColor}
        colorEditable={!identity?.isTutor}
        boardTitle={name}
        onSubmit={(n, c) => {
          setStoredName(n);
          const isTutor = identity?.isTutor ?? false;
          const color = isTutor ? (identity?.color ?? assignedColor) : c;
          if (!isTutor) setStoredColor(color);
          setIdentity({ name: n, color, isTutor });
          setNeedsName(false);
          setEditingIdentity(false);
        }}
        onCancel={() => setEditingIdentity(false)}
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

      {/* Last, and above every in-board band: nothing behind it is seen or
          clicked until the board has actually finished joining. */}
      <BoardLoadingVeil title={name} />
    </div>
  );
}
