import { memo, useLayoutEffect, useRef, useState } from 'react';
import { react, transact } from '@tldraw/state';
import { cameraToTransform, type Camera } from './camera';
import { CanvasScene } from './engine/scene';
import type { ShapeRendererProps } from './engine/renderer';
import { subscribeDocumentChanges } from './engine/document-changes';
import { ShapeList } from './shape-dom-nodes';
import { editor, spatialIndex } from './use-document-store';
import { shapeStore } from './engine/shape-store';
import { useCameraInteraction } from './use-camera-interaction';
import { useCameraStore } from './use-camera-store';
import { bindSceneUi } from './scene-ui';
import { useShapeRasterCache } from './use-shape-raster-cache';

/** Camera and per-shape styles are exclusively owned by signal effects. React
 * receives a stable, id-sorted sibling list, so parenting/z-order/culling never
 * detach embedded content. Each SVG is local to one shape, HTML can be added to
 * the same wrapper without replacing the engine or losing browser state. */
export const FlatShapeLayer = memo(function FlatShapeLayer({
  width,
  height,
}: ShapeRendererProps) {
  // useState, not useMemo: these must keep one identity for the layer's life.
  const [scene] = useState(() => new CanvasScene(spatialIndex, shapeStore));
  const layer = useRef<HTMLDivElement>(null);
  const raster = useRef<HTMLDivElement>(null);
  const [containers] = useState(() => new Map<string, HTMLDivElement>());
  // Highlighter overlays cull with their owner, so they join the one page-level
  // reactor rather than each reading `visible` — a set whose identity changes
  // on every document change — from inside their own.
  const [overlays] = useState(() => new Map<string, HTMLDivElement>());

  useLayoutEffect(() => {
    // TEMPORARY perf harness — delete with ./scale-bench.ts.
    (globalThis as unknown as { __scene?: CanvasScene }).__scene = scene;
    const syncCamera = () => scene.camera.set(useCameraStore.getState().camera);
    const positionLayer = (camera: Camera) => {
      if (!layer.current) return;
      layer.current.style.transform = cameraToTransform(
        camera,
        !useCameraInteraction.getState().isMoving,
      );
    };
    let stopUi = () => {};
    transact(() => {
      // The store is already published; the scene only derives from it.
      scene.sync(shapeStore.snapshot(), null, null, new Map());
      syncCamera();
      stopUi = bindSceneUi(scene, editor.getShape);
    });
    let previousVisible = new Set<string>();
    const stops = [
      subscribeDocumentChanges(({ shapes, ids, contentIds, previous }) =>
        scene.sync(shapes, ids, contentIds, previous),
      ),
      useCameraStore.subscribe(syncCamera),
      stopUi,
      // Device-pixel snapping is dropped while the camera moves and restored
      // when it settles, matching `useCameraFollow` — see
      // `cameraTranslation`. This layer is positioned imperatively, so it takes
      // the settle signal as its own subscription rather than a re-render; both
      // paths read the same `isMoving`, so they cannot land on different
      // answers for the same frame.
      react('position camera layer', () => {
        positionLayer(scene.camera.get());
      }),
      useCameraInteraction.subscribe(() => positionLayer(scene.camera.get())),
      react('cull page', () => {
        const visible = scene.visible.get();
        const display = (id: string, value: string) => {
          const element = containers.get(id);
          if (element) element.style.display = value;
          const overlay = overlays.get(id);
          if (overlay) overlay.style.display = value;
        };
        for (const id of previousVisible)
          if (!visible.has(id)) display(id, 'none');
        for (const id of visible)
          if (!previousVisible.has(id)) display(id, '');
        previousVisible = visible;
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [scene, containers, overlays]);

  useLayoutEffect(() => {
    scene.viewport.set({ width, height });
  }, [scene, width, height]);

  useShapeRasterCache(scene, layer, raster, containers, width, height);

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[var(--z-canvas-shapes)]"
      data-canvas-engine="dom-svg"
    >
      <div
        ref={layer}
        data-shape-layer
        style={{
          position: 'absolute',
          width: 1,
          height: 1,
          transformOrigin: '0 0',
        }}
      >
        <ShapeList scene={scene} containers={containers} overlays={overlays} />
      </div>
      <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
        <div ref={raster} data-shape-raster-cache style={{
          position: 'absolute', width: 1, height: 1, transformOrigin: '0 0', display: 'none',
        }} />
      </div>
    </div>
  );
});

