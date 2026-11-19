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
// students following the tutor. `?ai=1` mounts the agent bar against stubbed
// `/api/ai/*` answers (about a second each, like the real models).
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { Canvas } from './canvas/Canvas';
import { editor, loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { BoardChrome } from './components/board-chrome';
import { BoardUiLayer } from './components/board-ui-layer';
import { Toolbar } from './components/toolbar';
import { AgentBar } from './components/agent-bar';
import { Toaster } from './components/ui/toast';
import { applyTheme } from './use-theme-store';
import { TUTOR_COLOR } from './collab/identity';
import {
  usePresenceStore,
  type PeerPresence,
} from './collab/use-presence-store';
import { genId } from '@whiteboard/shared';
import { ALL_FEATURES } from '@whiteboard/shared';
import { useFeaturesStore } from '@/board/features';

// Review page: every feature on, AI included, without a server to ask.
useFeaturesStore.setState({ features: ALL_FEATURES });

const params = new URLSearchParams(location.search);
applyTheme(params.get('theme') === 'dark' ? 'dark' : 'light');

loadBoard('temporary-board-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: -40, y: -40, z: 1 }, activeKey: '' });

if (params.get('empty') !== '1') seed();

const withAi = params.get('ai') === '1';
if (withAi) {
  const realFetch = window.fetch.bind(window);
  const reply = (body: unknown, ms = 0) =>
    new Promise<Response>((resolve) =>
      setTimeout(() => resolve(new Response(JSON.stringify(body))), ms),
    );
  // The agent answers as the server does when asked to stream: progress
  // events a beat apart, then the result.
  const streamed = (result: { reply?: string; actions: unknown[] }, tools: string[]) => {
    // A written answer arrives as the server forwards it: in pieces.
    const pieces = !tools.length && result.reply ? (result.reply.match(/[\s\S]{1,12}/g) ?? []) : [];
    const events = [
      { progress: { step: 'thinking' } },
      ...tools.map((name) => ({ progress: { step: 'tool', name } })),
      ...pieces.map((text) => ({ progress: { step: 'draft', text } })),
      { result },
    ];
    const encoder = new TextEncoder();
    return Promise.resolve(
      new Response(
        new ReadableStream({
          async start(controller) {
            for (const event of events) {
              const drafting = 'progress' in event && event.progress?.step === 'draft';
              await new Promise((r) => setTimeout(r, drafting ? 90 : 700));
              controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
            }
            controller.close();
          },
        }),
      ),
    );
  };
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    // Kept for a console check of what the bar sends (previous, image).
    if (url.endsWith('/api/ai/agent'))
      ((window as { agentBodies?: unknown[] }).agentBodies ??= []).push(JSON.parse(String(init?.body)));
    // "explain …" gets edits and an answer beside them.
    if (url.endsWith('/api/ai/agent') && String(init?.body).includes('"text":"explain'))
      return streamed(
        {
          reply: 'A parabola is the graph of a quadratic; this one opens **upward** because $a > 0$.',
          actions: [
            { type: 'create_graph', expressions: ['y = x^2'] },
            { type: 'create_equation', latex: 'y = ax^2 + bx + c', x: 600, y: 120 },
            { type: 'create_equation', latex: 'a > 0', x: 600, y: 200 },
          ],
        },
        ['create_graph', 'create_equation', 'create_equation', 'say'],
      );
    // An instruction ending in "?" gets a written answer instead of edits.
    if (url.endsWith('/api/ai/agent') && String(init?.body).includes('?"'))
      return streamed(
        {
          reply:
            // A real answer from the agent (eval, 2026-11-11): aligned working in display maths.
            'Use $\\log_{ab}(ab)=1$ and split the product:\n\n$$\\begin{aligned}\\log_{ab} a+\\log_{ab} b&=\\log_{ab}(ab)=1\\\\ 3+\\log_{ab} b&=1\\\\ \\log_{ab} b&=-2\\end{aligned}$$\n\nSo **$\\log_{ab} b=-2$**, because the two logs must add to $1$.',
          actions: [],
        },
        [],
      );
    if (url.endsWith('/api/ai/agent'))
      return streamed(
        {
          actions: [
            { type: 'create_equation', latex: 'x = \\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}', x: 300, y: 120 },
          ],
        },
        ['create_equation'],
      );
    if (url.endsWith('/api/ai/check'))
      return reply({ errors: [{ line: 1, message: 'Sign error when expanding', correction: 'x^2-2x+1' }] }, 1500);
    return realFetch(input, init);
  };
}

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
        {withAi ? <AgentBar /> : null}
      </BoardUiLayer>
      <Toaster />
    </div>
  );
}

createRoot(document.getElementById('root')!).render(<Review />);
