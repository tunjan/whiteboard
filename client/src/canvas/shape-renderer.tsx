import { useRef } from 'react';
import type { ShapeRenderer, ShapeRendererProps } from './engine/renderer';
import { FlatShapeLayer } from './FlatShapeLayer';
import { Canvas2dShapeLayer } from './canvas-2d-renderer';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { shapeStore } from './engine/shape-store';
import { useStoreValue } from './use-shapes';

export const DOM_SVG_RENDERER: ShapeRenderer = {
  id: 'dom-svg',
  Component: FlatShapeLayer,
};

/** The hybrid Canvas2D implementation: geometry painted on a canvas, React
 *  artwork and typeset content left in the DOM — see `canvas-2d-renderer.tsx`. */
export const CANVAS_2D_RENDERER: ShapeRenderer = {
  id: 'canvas-2d',
  Component: Canvas2dShapeLayer,
};

/** Built-in renderers, keyed by the `?renderer=` value that selects them. */
export const SHAPE_RENDERERS: Readonly<Record<string, ShapeRenderer>> = {
  [DOM_SVG_RENDERER.id]: DOM_SVG_RENDERER,
  [CANVAS_2D_RENDERER.id]: CANVAS_2D_RENDERER,
};

/**
 * Page size, in shapes, at which `auto` hands the page to the Canvas2D layer.
 *
 * Below it the DOM/SVG layer is the better picture — pixel-exact, and zoom at
 * real page sizes (p99 ~2,800 shapes) is already sub-frame. Around 10k it
 * collapses on zoom-out (1fps, p95 367ms) while Canvas2D holds 43fps. 5,000 is
 * well clear of every measured real page and well short of the collapse.
 */
export const AUTO_CANVAS_2D_SHAPES = 5000;

/**
 * The renderer to mount: `?renderer=` first, then an explicit saved
 * preference, then `auto` — the DOM/SVG layer, or Canvas2D once the page holds
 * {@link AUTO_CANVAS_2D_SHAPES} shapes.
 *
 * The URL wins so a link can pin one implementation for an A/B or a bench run
 * without disturbing what the person opening it normally uses — and so a
 * misbehaving preference is one query parameter away from being overridden.
 * An unknown or absent id at either level falls through rather than leaving
 * the board without a scene.
 *
 * `renderers` is a parameter so the port can be exercised against an
 * implementation that is not built in; the app only ever passes the default.
 */
export function resolveShapeRenderer(
  search: string,
  preference?: string,
  renderers: Readonly<Record<string, ShapeRenderer>> = SHAPE_RENDERERS,
  largePage = false,
): ShapeRenderer {
  const requested = new URLSearchParams(search).get('renderer');
  return (
    (requested ? renderers[requested] : undefined) ??
    (preference ? renderers[preference] : undefined) ??
    (largePage ? CANVAS_2D_RENDERER : DOM_SVG_RENDERER)
  );
}

/**
 * Mounts the selected renderer, keyed on its id.
 *
 * Switching implementations discards the scene's signal graph and builds a new
 * one from the document store — the same thing the `key={currentPageId}`
 * remount above this already does on a page switch, and the reason the choice
 * is a preference rather than a control anyone is expected to hold down.
 *
 * `auto` latches: once a page has crossed the threshold it keeps Canvas2D until
 * the page is left (the caller's page key remounts this and resets the latch).
 * Otherwise erasing and redrawing around the threshold would remount the whole
 * shape layer each time it was crossed. The selector yields a boolean, so a
 * page this far below the threshold re-renders nothing on an edit.
 */
export function ShapeLayer(props: ShapeRendererProps) {
  const preference = useCanvasUiStore((s) => s.shapeRenderer);
  const large = useStoreValue(
    () => shapeStore.sorted.get().length >= AUTO_CANVAS_2D_SHAPES,
    [],
  );
  const latched = useRef(false);
  latched.current ||= large;
  const renderer = resolveShapeRenderer(
    location.search,
    preference,
    SHAPE_RENDERERS,
    latched.current,
  );
  return <renderer.Component key={renderer.id} {...props} />;
}
