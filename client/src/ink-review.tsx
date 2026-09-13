import { createRoot } from 'react-dom/client';
import './index.css';
import './canvas/shapes/register';
import './canvas/tools/register';
import { Canvas } from './canvas/Canvas';
import { editor, loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { useToolStore } from './canvas/use-tool-store';
import { drawUtil } from './canvas/shapes/draw';
import { useCanvasUiStore } from './canvas/use-canvas-ui-store';
import { getInkPathData } from './canvas/shapes/ink';

loadBoard('temporary-ink-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 } });
useCanvasUiStore.persist.setOptions({ storage: undefined });
useCanvasUiStore.getState().resetPencil();
useToolStore.getState().setTool('draw');
const path = Array.from({ length: 200 }, (_, i) => ({ x: i * 2, y: Math.sin(i / 9) * 28, pressure: 0.2 + i / 250 }));
for (let row = 0; row < 3; row++) {
  editor.createShape({ id: `wave-${row}`, type: 'draw', x: 70, y: 100 + row * 90, rotation: 0, index: `a${row + 1}`,
    props: { ...drawUtil.getDefaultProps(), inkAlgorithm: 'reference', size: 5 + row * 5, points: path, streamline: 0.62, smoothing: 0.62, simulatePressure: row === 0, pressureEasing: row === 0 ? 'ease-out-sine' : 'stylus', thinning: 0.62 } });
}
editor.createShape({ id: 'paper', type: 'rectangle', x: 540, y: 70, rotation: 0, index: 'a4', props: { w: 280, h: 260, color: '#537ba8', size: 2, dash: 'solid', fillStyle: 'solid' } });
editor.createShape({ id: 'wash', type: 'draw', x: 480, y: 140, rotation: 0, index: 'a0', props: { ...drawUtil.getDefaultProps(), inkAlgorithm: 'reference', inkKind: 'highlight', size: 35, thinning: 0, points: [{ x: 0, y: 0 }, { x: 340, y: 0 }], color: '#ffee00' } });
const many = Array.from({length:600}, (_, i) => ({ x:i*2, y:30*Math.sin(i/10), pressure:0.5 }));
for(let i=0;i<100;i++) getInkPathData(many, 8, true, {inkAlgorithm:'reference', simulatePressure:true, streamline:0.64});
const start=performance.now();
for(let i=0;i<1000;i++) getInkPathData(many, 8, true, {inkAlgorithm:'reference', simulatePressure:true, streamline:0.64});
const elapsed=(performance.now()-start)/1000;
createRoot(document.getElementById('root')!).render(<><Canvas /><div style={{position:'fixed',left:24,top:16,zIndex:1000,background:'white',padding:8,fontFamily:'sans-serif'}}>Ink review · 600-point render: {elapsed.toFixed(3)} ms<br/><button onClick={() => useToolStore.getState().setTool('draw')}>Test pen</button> · <button onClick={() => useToolStore.getState().setTool('highlighter')}>Test highlighter</button></div></>);
