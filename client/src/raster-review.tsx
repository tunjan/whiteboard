// Local, non-persisted rendering fixture. Open /raster-review.html?rasterCache=on.
import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './canvas/shapes/register';
import { FlatShapeLayer } from './canvas/FlatShapeLayer';
import { Background } from './canvas/Background';
import { type BackgroundType } from './canvas/grid';
import { editor, loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { useCameraInteraction } from './canvas/use-camera-interaction';
import { drawUtil } from './canvas/shapes/draw';
import { rectangleUtil } from './canvas/shapes/rectangle';
import { textUtil } from './canvas/shapes/text';
import { generateKeyBetween } from './canvas/order';

const closeBoard = loadBoard('raster-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
let index = 'a0';
editor.transact(() => {
  for (let i = 0; i < 240; i++) {
    index = generateKeyBetween(index, null);
    editor.createShape({
      id: `stroke-${i}`,
      type: 'draw',
      x: (i % 20) * 70 - 250,
      y: Math.floor(i / 20) * 65 - 120,
      rotation: 0,
      index,
      props: {
        ...drawUtil.getDefaultProps(),
        color: '#537ba8',
        size: 2,
        points: Array.from({ length: 20 }, (_, p) => ({
          x: p * 2.5,
          y: Math.sin(p / 3 + i) * 10,
          pressure: 0.5,
        })),
      },
    });
  }
  editor.createShape({
    id: 'frame',
    type: 'frame',
    x: 450,
    y: 210,
    rotation: 0.15,
    index: 'b0',
    props: { w: 260, h: 200, name: 'Clipped frame' },
  });
  editor.createShape({
    id: 'box',
    type: 'rectangle',
    x: 350,
    y: 290,
    rotation: -0.15,
    index: 'b1',
    parentId: 'frame',
    props: {
      ...rectangleUtil.getDefaultProps(),
      w: 300,
      h: 160,
      color: '#bd5939',
      fillStyle: 'solid',
      size: 3,
    },
  });
  editor.createShape({
    id: 'text',
    type: 'text',
    x: 180,
    y: 120,
    rotation: 0,
    index: 'b2',
    props: {
      ...textUtil.getDefaultProps(),
      text: 'Tiles keep the board moving',
      fontSize: 26,
      color: '#1c1917',
    },
  });
  editor.createShape({
    id: 'highlight',
    type: 'draw',
    x: 175,
    y: 138,
    rotation: 0,
    index: 'b3',
    props: {
      ...drawUtil.getDefaultProps(),
      inkKind: 'highlight',
      inkAlgorithm: 'reference',
      color: '#f2d45b',
      size: 30,
      points: [
        { x: 0, y: 0, pressure: 0.5 },
        { x: 345, y: 0, pressure: 0.5 },
      ],
    },
  });
});

function Review() {
  const camera = useCameraStore((s) => s.camera);
  const [hold, setHold] = useState(false);
  const [background, setBackground] = useState<BackgroundType>('dot');
  useEffect(() => {
    if (!hold) {
      useCameraInteraction.setState({ isMoving: false });
      return;
    }
    useCameraInteraction.setState({ isMoving: true });
    // Keep the normal gesture debounce alive without changing the camera's
    // geometry. Stop immediately when the fixture is settled or unmounted.
    const timer = setInterval(
      () =>
        useCameraStore.setState((state) => ({ camera: { ...state.camera } })),
      60,
    );
    return () => clearInterval(timer);
  }, [hold]);
  const change = (dx: number, zoom = camera.z) =>
    useCameraStore.setState({
      camera: { x: camera.x + dx, y: camera.y, z: zoom },
    });
  return (
    <main style={{ padding: 16 }}>
      <div
        style={{
          display: 'flex',
          gap: 12,
          marginBottom: 16,
          alignItems: 'center',
        }}
      >
        <button onClick={() => setHold(!hold)}>
          {hold ? 'Settle' : 'Hold gesture'}
        </button>
        <button onClick={() => change(20)}>Pan 20</button>
        <button onClick={() => change(600)}>Pan 600</button>
        <button onClick={() => change(0, camera.z * 1.05)}>Zoom 5%</button>
        <button onClick={() => change(0, camera.z * Math.SQRT2)}>
          Next zoom band
        </button>
        <button
          onClick={() =>
            editor.updateShape('box', { props: { color: '#368a6e' } })
          }
        >
          Edit shape
        </button>
        <button
          onClick={() => document.documentElement.classList.toggle('dark')}
        >
          Theme
        </button>
        <select
          aria-label="Background"
          value={background}
          onChange={(e) => setBackground(e.target.value as BackgroundType)}
        >
          {['dot', 'graph', 'coordinate', 'blank'].map((type) => (
            <option key={type}>{type}</option>
          ))}
        </select>
      </div>
      <div
        data-raster-review
        style={{
          position: 'relative',
          width: 800,
          height: 600,
          overflow: 'hidden',
          background: 'var(--color-background)',
          border: '1px solid var(--color-border)',
        }}
      >
        <Background
          type={background}
          camera={camera}
          width={800}
          height={600}
        />
        <FlatShapeLayer width={800} height={600} />
      </div>
      <output>
        Camera {camera.x.toFixed(2)}, {camera.y.toFixed(2)},{' '}
        {camera.z.toFixed(3)} · {hold ? 'Moving' : 'Settled'}
      </output>
    </main>
  );
}

const root = createRoot(document.getElementById('root')!);
root.render(<Review />);
import.meta.hot?.dispose(() => {
  root.unmount();
  closeBoard();
});
