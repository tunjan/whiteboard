// Design review harness for the whole board interface.
//
// `board-view.tsx` cannot be opened without signing in, so every judgement
// about the chrome — how the four corners sit together, what the toolbar looks
// like over real ink, whether the two themes agree — had to be made from one
// surface at a time. This mounts the same composition on a board with no
// persistence, no collab and no auth, and seeds enough ink to judge the chrome
// against something other than an empty grid.
//
// `?theme=dark` opens in dark. `?empty=1` seeds nothing. `?as=student` joins
// as a student with a tutor present (the follow feature); `?followers=1` seeds
// students following the tutor.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Canvas } from './canvas/Canvas';
import { editor, loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { BoardChrome } from './components/board-chrome';
import { BoardUiLayer } from './components/board-ui-layer';
import { Toolbar } from './components/toolbar';
import { Toaster } from './components/ui/toast';
import { applyTheme } from './use-theme-store';
import { TUTOR_COLOR } from './collab/identity';
import {
  usePresenceStore,
  type PeerPresence,
} from './collab/use-presence-store';
import { genId } from '@whiteboard/shared';

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light');

loadBoard('temporary-board-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: -40, y: -40, z: 1 }, activeKey: '' });

if (params.get('empty') !== '1') seed();

const asStudent = params.get('as') === 'student';
const peer = (
  clientId: number,
  name: string,
  color: string,
  isTutor: boolean,
  following: boolean,
): PeerPresence => ({
  clientId,
  name,
  color,
  isTutor,
  cursor: null,
  cursorType: 'pointer',
  viewport: isTutor
    ? { camera: { x: 150, y: 100, z: 1.4 }, size: { width: 1200, height: 800 } }
    : null,
  summon: null,
  page: null,
  following,
  latencyMs: null,
  textSelection: null,
  selection: null,
  scribbles: null,
  laser: null,
  voice: null,
  attention: null,
});
if (asStudent) {
  usePresenceStore.getState().setPeers([peer(1, 'Alberto', TUTOR_COLOR, true, false)]);
} else if (params.get('followers') === '1') {
  usePresenceStore.getState().setPeers([
    peer(2, 'Lucía', '#099268', false, true),
    peer(3, 'Marco', '#ae3ec9', false, true),
    peer(4, 'Sam', '#e16919', false, false),
  ]);
}

function seed() {
  const colors = ['#4465e9', '#e16919', '#099268', '#ae3ec9', '#1d1d1d'];
  editor.transact(() => {
    let i = 0;
    const next = () => `a${(i++).toString(36).padStart(3, '0')}`;
    // A band of ink across the middle of the viewport: the chrome has to stay
    // legible over this, which an empty board would never show.
    for (let s = 0; s < 5; s++) {
      const points: Array<{ x: number; y: number; pressure: number }> = [];
      for (let t = 0; t <= 40; t++) {
        const x = t * 22;
        points.push({
          x,
          y: Math.sin(t / 5 + s) * 60 + Math.cos(t / 11) * 25,
          pressure: 0.4 + 0.35 * Math.sin(t / 7 + s),
        });
      }
      editor.createShape({
        id: genId(),
        type: 'draw',
        x: 90,
        y: 260 + s * 70,
        rotation: 0,
        index: next(),
        parentId: null,
        props: {
          points,
          isClosed: false,
          color: colors[s % colors.length]!,
          size: 4 + s * 2,
          fillStyle: 'none',
          dash: 'solid',
          isComplete: true,
        },
      });
    }
    editor.createShape({
      id: genId(),
      type: 'rectangle',
      x: 240,
      y: 130,
      rotation: 0,
      index: next(),
      parentId: null,
      props: {
        w: 300,
        h: 190,
        color: '#4465e9',
        fillStyle: 'hatch',
        dash: 'solid',
        size: 4,
      },
    });
    editor.createShape({
      id: genId(),
      type: 'ellipse',
      x: 640,
      y: 150,
      rotation: 0,
      index: next(),
      parentId: null,
      props: {
        w: 220,
        h: 220,
        color: '#e16919',
        fillStyle: 'solid',
        dash: 'solid',
        size: 4,
      },
    });
  });
}

function Review() {
  const [title, setTitle] = useState('Trigonometric identities');
  useEffect(() => {
    // The chrome reads document.title nowhere, but the tab should say what
    // this is while several review windows are open at once.
    document.title = `Board review — ${title}`;
  }, [title]);

  return (
    <div className="wb-board relative h-dvh w-screen overflow-hidden overscroll-none bg-panel text-fg">
      <Canvas />
      <BoardUiLayer>
        <BoardChrome
          boardId="temporary-board-review"
          title={title}
          onBack={() => {}}
          onRenameTitle={() => setTitle('Trigonometric identities')}
          onEditIdentity={() => {}}
          identity={
            asStudent
              ? { name: 'Lucía', color: '#099268', isTutor: false }
              : { name: 'Alberto', color: '#4465e9', isTutor: true }
          }
        />
        <Toolbar />
      </BoardUiLayer>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Review />);
