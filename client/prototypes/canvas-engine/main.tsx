/** Isolated manual regression fixture: no persistence, auth, or collaboration. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../src/index.css';
import { Canvas } from '../../src/canvas/Canvas';
import { editor, loadBoard } from '../../src/canvas/use-document-store';
import { useCameraStore } from '../../src/canvas/use-camera-store';
import { useSelectionStore } from '../../src/canvas/use-selection-store';
import { useToolStore } from '../../src/canvas/use-tool-store';
import { rectangleUtil } from '../../src/canvas/shapes/rectangle';
import { TooltipProvider } from '../../src/components/ui/tooltip';

loadBoard('canvas-engine-fixture', { persist: false, collab: false });
editor.transact(() => {
  editor.createShape({
    id: 'frame',
    type: 'frame',
    x: 100,
    y: 150,
    rotation: 0.15,
    index: 'a0',
    props: { w: 320, h: 260, name: 'Clipped frame' },
  });
  editor.createShape({
    id: 'box',
    type: 'rectangle',
    x: 300,
    y: 200,
    rotation: 0.3,
    index: 'a9',
    parentId: 'frame',
    props: {
      ...rectangleUtil.getDefaultProps(),
      w: 200,
      h: 140,
      fillStyle: 'solid',
      color: '#3085ed',
    },
  });
  editor.createShape({
    id: 'cover',
    type: 'rectangle',
    x: 370,
    y: 340,
    rotation: 0,
    index: 'a1',
    props: {
      ...rectangleUtil.getDefaultProps(),
      w: 200,
      h: 150,
      fillStyle: 'solid',
      color: '#ee6655',
    },
  });
  editor.createShape({
    id: 'text',
    type: 'text',
    x: 590,
    y: 180,
    rotation: 0,
    index: 'a2',
    props: {
      text: 'Flat DOM / SVG\nDraw, move, rotate, zoom.',
      w: 300,
      fontSize: 24,
      fontFamily: 'sans',
      color: '#000000',
      textAlign: 'left',
    },
  });
});
function Fixture() {
  const [result, setResult] = useState('Ready');
  const mutate = (action: () => void) => {
    const before = document.querySelector('[data-shape-id="box"]');
    const path = before?.querySelector('svg');
    action();
    requestAnimationFrame(() =>
      setResult(
        before === document.querySelector('[data-shape-id="box"]') &&
          path === before?.querySelector('svg')
          ? 'DOM identity preserved'
          : 'DOM changed',
      ),
    );
  };
  return (
    <TooltipProvider>
      <Canvas />
      <div
        style={{
          position: 'fixed',
          zIndex: 1000,
          top: 12,
          left: 12,
          display: 'flex',
          gap: 12,
          background: 'white',
          color: '#222',
          padding: 12,
          border: '1px solid #ccc',
        }}
      >
        <button onClick={() => useToolStore.getState().setTool('select')}>
          Select
        </button>
        <button onClick={() => useToolStore.getState().setTool('draw')}>
          Draw
        </button>
        <button
          onClick={() =>
            mutate(() =>
              editor.updateShape('box', { x: editor.getShape('box')!.x + 20 }),
            )
          }
        >
          Move box
        </button>
        <button
          onClick={() =>
            mutate(() =>
              editor.updateShape('box', {
                parentId: editor.getShape('box')!.parentId ? null : 'frame',
              }),
            )
          }
        >
          Reparent box
        </button>
        <button
          onClick={() =>
            mutate(() => {
              useSelectionStore.getState().clear();
              useCameraStore.getState().setCamera({ x: 10000, y: 0, z: 1 });
            })
          }
        >
          Pan away
        </button>
        <button
          onClick={() =>
            mutate(() =>
              useCameraStore.getState().setCamera({ x: 0, y: 0, z: 1 }),
            )
          }
        >
          Return
        </button>
        <output>{result}</output>
      </div>
    </TooltipProvider>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Fixture />
  </StrictMode>,
);
