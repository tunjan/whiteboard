// TEMPORARY review harness for the student arrival flow. Delete with
// join-review.html.
//
// Mounts the board composition with the loading veil and the first-visit name
// dialog, as a student opening a share link would meet them. `?theme=dark`,
// `?alone=1` seeds no one already on the board, `?stage=remote` holds the veil.
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Canvas } from './canvas/Canvas';
import { loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { BoardChrome } from './components/board-chrome';
import { BoardUiLayer } from './components/board-ui-layer';
import { BoardLoadingVeil } from './components/board-loading-veil';
import { NameDialog } from './components/name-dialog';
import { Toolbar } from './components/toolbar';
import { Toaster } from './components/ui/toast';
import { applyTheme } from './use-theme-store';
import { STUDENT_COLORS, TUTOR_COLOR, type Identity } from './collab/identity';
import { useBoardLoadingStore } from './board/use-board-loading-store';
import { usePresenceStore, type PeerPresence } from './collab/use-presence-store';
import type { BoardLoadStage } from './board/board-readiness';
import { useArrivalToasts } from './collab/use-arrival-toasts';

const asTutor = new URLSearchParams(location.search).get('as') === 'tutor';

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light');
loadBoard('temporary-join-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: -40, y: -40, z: 1 }, activeKey: '' });

const held = params.get('stage') as BoardLoadStage | null;
useBoardLoadingStore.setState({ stage: held ?? 'local', ready: false });
if (!held) {
  setTimeout(() => useBoardLoadingStore.setState({ stage: 'remote' }), 500);
  setTimeout(() => useBoardLoadingStore.setState({ stage: 'page' }), 1100);
  setTimeout(
    () => useBoardLoadingStore.setState({ stage: 'ready', ready: true }),
    1600,
  );
}

const peer = (clientId: number, name: string, color: string, isTutor: boolean): PeerPresence => ({
  clientId, name, color, isTutor, cursor: null, cursorType: 'pointer', viewport: null,
  summon: null, page: null, following: false, latencyMs: null, textSelection: null,
  selection: null, scribbles: null, laser: null, voice: null, attention: null,
});
if (params.get('alone') !== '1') {
  usePresenceStore.getState().setPeers([
    peer(1, 'Alberto', TUTOR_COLOR, true),
    peer(2, 'Marco', STUDENT_COLORS[1]!, false),
  ]);
}

function Review() {
  const ready = useBoardLoadingStore((s) => s.ready);
  const [identity, setIdentity] = useState<Identity | null>(
    asTutor ? { name: 'Alberto', color: TUTOR_COLOR, isTutor: true } : null,
  );
  useArrivalToasts(asTutor);
  const title = 'Trigonometric identities';
  return (
    <div className="wb-board relative h-dvh w-screen overflow-hidden overscroll-none bg-panel text-fg">
      <Canvas />
      <BoardUiLayer>
        <BoardChrome boardId="temporary-join-review" title={title} onBack={() => {}} onEditIdentity={() => {}} identity={identity} />
        <Toolbar />
      </BoardUiLayer>
      <Toaster />
      <NameDialog
        open={ready && !identity}
        initialColor={STUDENT_COLORS[6]!}
        boardTitle={title}
        onSubmit={(name, color) => setIdentity({ name, color, isTutor: false })}
      />
      <BoardLoadingVeil title={title} />
    </div>
  );
}

// `?as=tutor`: a student arrives two seconds after the board is up.
if (asTutor) {
  setTimeout(() => {
    const { peers, setPeers } = usePresenceStore.getState();
    setPeers([...peers, peer(3, 'Lucía', STUDENT_COLORS[2]!, false)]);
  }, 3600);
}

createRoot(document.getElementById('root')!).render(<Review />);
