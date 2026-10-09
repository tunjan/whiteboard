// The DOM half of the shape scene: one absolutely positioned container per
// shape, holding that shape's own SVG.
//
// Both renderers mount these. `FlatShapeLayer` gives them every id on the page;
// the Canvas2D renderer gives them only the shapes it will not paint itself —
// the ones whose content is React artwork, a typeset document, or a live
// gesture — so the two implementations cannot disagree about what a bookmark or
// an equation looks like.
import { memo, useLayoutEffect, useRef } from 'react';
import { react, type Signal } from '@tldraw/state';
import type { Shape } from '@whiteboard/shared';
import { CanvasScene, shapeMatrix, type SceneNode } from './engine/scene';
import { useSignalValue } from './engine/use-signal';
import { inverse, matrixCss } from './engine/matrix';
import { ShapeView } from './ShapeView';
import { FrameChrome } from './shapes/frame';
import {
  FRAME_HEADING_FONT_SCREEN,
  frameHeadingLayout,
  frameHeadingSideTransform,
  frameHeadingText,
} from './frame-geometry';
import { inkPaint } from './ink-color';
import { useEraserCutStore } from './use-eraser-cut-store';
import { useFrameEditingStore } from './use-frame-editing-store';
import { useLiveStrokeStore } from './use-live-stroke-store';

/** The scene publishes both lists, so neither the overlay pass nor the cull
 * costs a per-shape subscription: DOM order is irrelevant here because every
 * container carries an explicit z-index. */
export const ShapeList = memo(function ShapeList({
  scene,
  containers,
  overlays,
  ids: idSignal,
  highlightIds: highlightSignal,
}: {
  scene: CanvasScene;
  containers: Map<string, HTMLDivElement>;
  overlays: Map<string, HTMLDivElement>;
  /** Which shapes this layer owns. Defaults to the whole page. */
  ids?: Signal<readonly string[]>;
  highlightIds?: Signal<readonly string[]>;
}) {
  const ids = useSignalValue(idSignal ?? scene.ids);
  const highlightIds = useSignalValue(highlightSignal ?? scene.highlightIds);
  return (
    <>
      {ids.map((id) => (
        <ShapeContainer key={id} node={scene.record(id)} containers={containers} />
      ))}
      {highlightIds.map((id) => (
        <HighlightOverlay key={id} node={scene.record(id)} overlays={overlays} />
      ))}
    </>
  );
});

/** Share the owner's transform, mask and visibility across both ink passes. */
export const HighlightOverlay = memo(function HighlightOverlay({ node, overlays }: {
  node: SceneNode;
  overlays: Map<string, HTMLDivElement>;
}) {
  const shape = useSignalValue(node.content);
  const ref = useRef<HTMLDivElement>(null);
  const fragments = useEraserCutStore((s) => s.fragments[node.id]);
  useLayoutEffect(() => {
    const element = ref.current!;
    overlays.set(node.id, element);
    element.style.display = node.scene.visible.get().has(node.id) ? '' : 'none';
    const update = () => {
      const style = node.presentation.get();
      // The live layer owns the stroke while it is being drawn; `shapeId` is
      // not a signal, hence the second subscription below.
      applyPresentation(
        element,
        useLiveStrokeStore.getState().shapeId === node.id
          ? { ...style, visibility: 'hidden' }
          : style,
      );
      const z = String(1_000_000 + node.z.get());
      if (element.style.zIndex !== z) element.style.zIndex = z;
    };
    const stop = react(`highlight overlay:${node.id}`, update);
    const unsubscribe = useLiveStrokeStore.subscribe(update);
    return () => { stop(); unsubscribe(); overlays.delete(node.id); };
  }, [node, overlays]);
  return <div ref={ref} data-highlight-overlay={node.id} style={{ position: 'absolute', width: 1, height: 1, transformOrigin: '0 0' }}>
    <svg width="1" height="1" overflow="visible" style={{ display: 'block', overflow: 'visible' }}>
      {fragments ? <CutPreview node={node} fragments={fragments} inkPass="overlay" /> : shape ? <ShapeView shape={shape} inkPass="overlay" /> : null}
    </svg>
  </div>;
});

type Presentation = ReturnType<SceneNode['presentation']['get']>;

/** Write only what differs: assigning an unchanged CSS property still dirties
 * the element for style recalculation. */
function applyPresentation(element: HTMLElement, style: Presentation) {
  for (const key of ['transform', 'clipPath', 'opacity', 'visibility'] as const)
    if (element.style[key] !== style[key]) element.style[key] = style[key];
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
      applyPresentation(element, node.presentation.get());
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
    <g ref={ref} data-frame-heading>
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
