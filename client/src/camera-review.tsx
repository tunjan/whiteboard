import { createRoot } from 'react-dom/client';
import './index.css';
import { Canvas } from './canvas/Canvas';
import { editor, loadBoard } from './canvas/use-document-store';
import { useCameraStore } from './canvas/use-camera-store';
import { useToolStore } from './canvas/use-tool-store';
loadBoard('temporary-camera-review', { persist: false, collab: false });
useCameraStore.setState({ camera: { x: 0, y: 0, z: 1 }, activeKey: '' });
useToolStore.getState().setTool('hand');
editor.createShape({ id: 'camera-target', type: 'rectangle', x: 250, y: 200, rotation: 0, index: 'a1', props: { w: 200, h: 150, color: '#537ba8', size: 2, dash: 'solid', fillStyle: 'solid' } });
function Review() {
  const camera = useCameraStore(s => s.camera);
  return <><Canvas /><output style={{position: 'fixed', top: 12, left: 12, background: 'white', padding: 8, pointerEvents: 'none'}}>Camera: {camera.x.toFixed(3)}, {camera.y.toFixed(3)}, {camera.z.toFixed(5)}</output></>;
}
createRoot(document.getElementById('root')!).render(<Review />);
