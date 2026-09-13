import { memo, useLayoutEffect, useMemo, useRef } from 'react';
import { computed, react, transact } from '@tldraw/state';
import type { Shape } from '@whiteboard/shared';
import { cameraToTransform } from './camera';
import { CanvasScene, type SceneNode } from './engine/scene';
import { useSignalValue } from './engine/use-signal';
import { subscribeDocumentChanges } from './engine/document-changes';
import { inverse, matrixCss } from './engine/matrix';
import { shapeMatrix } from './engine/scene';
import { ShapeView } from './ShapeView';
import { FrameChrome } from './shapes/frame';
import {
  FRAME_HEADING_FONT_SCREEN,
  frameHeadingLayout,
  frameHeadingSideTransform,
  frameHeadingText,
} from './frame-geometry';
import { inkPaint } from './ink-color';
import { useDocumentStore, spatialIndex } from './use-document-store';
import { useCameraStore } from './use-camera-store';
import { useSelectionStore } from './use-selection-store';
import { useHiddenStore } from './use-hidden-store';
import { useEraserStore } from './use-eraser-store';
import { useEraserCutStore } from './use-eraser-cut-store';
import { useTextEditingStore } from './use-text-editing-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useImageCroppingStore } from './use-image-cropping-store';
import { useVideoPlayingStore } from './use-video-playing-store';
import { useLiveStrokeStore } from './use-live-stroke-store';

/** Camera and per-shape styles are exclusively owned by signal effects. React
 * receives a stable, id-sorted sibling list, so parenting/z-order/culling never
 * detach embedded content. Each SVG is local to one shape, HTML can be added to
 * the same wrapper without replacing the engine or losing browser state. */
export const FlatShapeLayer = memo(function FlatShapeLayer({
  width,
  height,
}: {
  width: number;
  height: number;
}) {
  const scene = useMemo(() => new CanvasScene(spatialIndex), []);
  // TEMPORARY perf harness — delete with ./scale-bench.ts.
  (globalThis as unknown as { __scene?: CanvasScene }).__scene = scene;
  const layer = useRef<HTMLDivElement>(null);
  const containers = useMemo(() => new Map<string, HTMLDivElement>(), []);

  useLayoutEffect(() => {
    const syncUi = () => {
      const editing = useTextEditingStore.getState().editingId;
      const cropping = useImageCroppingStore.getState().croppingId;
      const playing = useVideoPlayingStore.getState().playingId;
      const live = useLiveStrokeStore.getState().shapeId;
      const liveShape = live ? useDocumentStore.getState().shapesById.get(live) : undefined;
      const liveHighlight = liveShape?.type === 'draw' && liveShape.props.inkKind === 'highlight';
      const frame = useFrameEditingStore.getState().editingId;
      const suppressed = new Set(
        [editing, cropping, playing, liveHighlight ? null : live].filter((id): id is string => !!id),
      );
      const pinned = new Set([
        ...useSelectionStore.getState().selectedIds,
        ...suppressed,
      ]);
      if (live) pinned.add(live);
      if (frame) pinned.add(frame);
      scene.ui.set({
        hidden: useHiddenStore.getState().hidden,
        erasing: useEraserStore.getState().marked,
        suppressed,
        pinned,
      });
    };
    const syncCamera = () => scene.camera.set(useCameraStore.getState().camera);
    transact(() => {
      scene.apply(useDocumentStore.getState().shapesById, null);
      syncCamera();
      syncUi();
    });
    let previousVisible = new Set<string>();
    const stops = [
      subscribeDocumentChanges(({ shapes, ids, contentIds }) =>
        scene.apply(shapes, ids, contentIds),
      ),
      useCameraStore.subscribe(syncCamera),
      useSelectionStore.subscribe((next, prev) => {
        if (next.selectedIds !== prev.selectedIds) syncUi();
      }),
      useHiddenStore.subscribe(syncUi),
      useEraserStore.subscribe(syncUi),
      useTextEditingStore.subscribe(syncUi),
      useImageCroppingStore.subscribe(syncUi),
      useVideoPlayingStore.subscribe(syncUi),
      useFrameEditingStore.subscribe(syncUi),
      useLiveStrokeStore.subscribe(syncUi),
      react('position camera layer', () => {
        const transform = cameraToTransform(scene.camera.get());
        if (layer.current) layer.current.style.transform = transform;
      }),
      react('cull page', () => {
        const visible = scene.visible.get();
        for (const id of previousVisible)
          if (!visible.has(id)) {
            const element = containers.get(id);
            if (element) element.style.display = 'none';
          }
        for (const id of visible)
          if (!previousVisible.has(id)) {
            const element = containers.get(id);
            if (element) element.style.display = '';
          }
        previousVisible = visible;
      }),
    ];
    return () => {
      for (const stop of stops) stop();
    };
  }, [scene, containers]);

  useLayoutEffect(() => {
    scene.viewport.set({ width, height });
  }, [scene, width, height]);

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
        <ShapeList scene={scene} containers={containers} />
      </div>
    </div>
  );
});

const ShapeList = memo(function ShapeList({
  scene,
  containers,
}: {
  scene: CanvasScene;
  containers: Map<string, HTMLDivElement>;
}) {
  const ids = useSignalValue(scene.ids);
  return ids.map((id) => (
    <ShapePair key={id} node={scene.record(id)} containers={containers} />
  ));
});

const ShapePair = memo(function ShapePair({ node, containers }: {
  node: SceneNode;
  containers: Map<string, HTMLDivElement>;
}) {
  return <>
    <ShapeContainer node={node} containers={containers} />
    <HighlightOverlay node={node} />
  </>;
});

/** Share the owner's transform, mask and visibility across both ink passes. */
function HighlightOverlay({ node }: { node: SceneNode }) {
  const isHighlight = useMemo(() => computed(`is highlight:${node.id}`, () => {
    const shape = node.content.get();
    return shape?.type === 'draw' && shape.props.inkKind === 'highlight';
  }), [node]);
  if (!useSignalValue(isHighlight)) return null;
  return <HighlightOverlayContent node={node} />;
}

function HighlightOverlayContent({ node }: { node: SceneNode }) {
  const shape = useSignalValue(node.content);
  const ref = useRef<HTMLDivElement>(null);
  const fragments = useEraserCutStore((s) => s.fragments[node.id]);
  useLayoutEffect(() => {
    const update = () => {
      const element = ref.current!;
      Object.assign(element.style, node.presentation.get());
      element.style.zIndex = String(1_000_000 + node.z.get());
      element.style.display = node.scene.visible.get().has(node.id) ? '' : 'none';
      if (useLiveStrokeStore.getState().shapeId === node.id) element.style.visibility = 'hidden';
    };
    const stop = react(`highlight overlay:${node.id}`, update);
    const unsubscribe = useLiveStrokeStore.subscribe(update);
    return () => { stop(); unsubscribe(); };
  }, [node]);
  return <div ref={ref} data-highlight-overlay={node.id} style={{ position: 'absolute', width: 1, height: 1, transformOrigin: '0 0' }}>
    <svg width="1" height="1" overflow="visible" style={{ display: 'block', overflow: 'visible' }}>
      {fragments ? <CutPreview node={node} fragments={fragments} inkPass="overlay" /> : shape ? <ShapeView shape={shape} inkPass="overlay" /> : null}
    </svg>
  </div>;
}

const ShapeContainer = memo(function ShapeContainer({
  node,
  containers,
}: {
  node: SceneNode;
  containers: Map<string, HTMLDivElement>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const element = ref.current!;
    containers.set(node.id, element);
    element.style.display = node.scene.visible.get().has(node.id) ? '' : 'none';
    const stop = react(`position:${node.id}`, () => {
      const style = node.presentation.get();
      for (const key of [
        'transform',
        'clipPath',
        'opacity',
        'visibility',
      ] as const) {
        if (element.style[key] !== style[key]) element.style[key] = style[key];
      }
      const z = String(node.z.get());
      if (element.style.zIndex !== z) element.style.zIndex = z;
    });
    return () => {
      stop();
      containers.delete(node.id);
    };
  }, [node, containers]);
  return (
    <div
      ref={ref}
      data-shape-id={node.id}
      style={{
        position: 'absolute',
        width: 1,
        height: 1,
        transformOrigin: '0 0',
      }}
    >
      <svg
        width="1"
        height="1"
        overflow="visible"
        style={{ display: 'block', overflow: 'visible' }}
      >
        <ShapeContent node={node} />
      </svg>
    </div>
  );
});

const ShapeContent = memo(function ShapeContent({ node }: { node: SceneNode }) {
  const shape = useSignalValue(node.content);
  const fragments = useEraserCutStore((s) => s.fragments[node.id]);
  if (!shape) return null;
  if (fragments) return <CutPreview node={node} fragments={fragments} inkPass="underlay" />;
  if (shape.type === 'frame')
    return (
      <>
        <FrameChrome frame={shape} showTitle={false} />
        <LiveFrameHeading node={node} />
      </>
    );
  return <ShapeView shape={shape} inkPass="underlay" />;
});

/** Keep the heading upright and screen-sized without reconciling shape content. */
function LiveFrameHeading({ node }: { node: SceneNode }) {
  const ref = useRef<SVGGElement>(null);
  useLayoutEffect(() => {
    const group = ref.current!;
    const text = group.querySelector('text')!;
    const update = () => {
      const frame = node.shape.get();
      if (frame?.type !== 'frame') return;
      const zoom = node.scene.camera.get().z;
      const layout = frameHeadingLayout(frame, zoom);
      group.setAttribute(
        'transform',
        frameHeadingSideTransform(layout.side, frame.props.w, frame.props.h) ??
          '',
      );
      group.style.display =
        useFrameEditingStore.getState().editingId === frame.id ? 'none' : '';
      text.setAttribute('x', String(layout.x + 6 / zoom));
      text.setAttribute('y', String(layout.y + layout.height / 2));
      text.setAttribute('font-size', String(FRAME_HEADING_FONT_SCREEN / zoom));
      text.setAttribute('stroke-width', String(3 / zoom));
      text.setAttribute(
        'fill',
        inkPaint(frame.props.color ?? 'var(--color-muted-foreground)'),
      );
      text.textContent = frameHeadingText(frame.props.name, layout, zoom);
    };
    const stop = react('position frame heading', update);
    const unsubscribe = useFrameEditingStore.subscribe(update);
    return () => {
      stop();
      unsubscribe();
    };
  }, [node]);
  return (
    <g ref={ref}>
      <text
        data-slot="frame-heading"
        fontFamily="'Inter Variable', system-ui, sans-serif"
        fontWeight={550}
        dominantBaseline="central"
        paintOrder="stroke"
        stroke="var(--color-background)"
        strokeLinejoin="round"
      />
    </g>
  );
}

function CutPreview({
  node,
  fragments,
  inkPass,
}: {
  node: SceneNode;
  fragments: Shape[];
  inkPass?: 'underlay' | 'overlay';
}) {
  // Fragments still use page coordinates. Cancel only their owner's transform;
  // the owner's clip, opacity and stacking slot continue to apply.
  const shape = useSignalValue(node.shape);
  if (!shape) return null;
  return (
    <g transform={matrixCss(inverse(shapeMatrix(shape)))}>
      {fragments.map((piece) => (
        <ShapeView key={piece.id} shape={piece} inkPass={inkPass} />
      ))}
    </g>
  );
}
