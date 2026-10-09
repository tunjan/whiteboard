import { describe, expect, it } from 'vitest';
import { FlatShapeLayer } from './FlatShapeLayer';
import type { ShapeRenderer } from './engine/renderer';
import {
  CANVAS_2D_RENDERER,
  DOM_SVG_RENDERER,
  SHAPE_RENDERERS,
  resolveShapeRenderer,
} from './shape-renderer';

const stub: ShapeRenderer = { id: 'stub', Component: () => null };
const table = { ...SHAPE_RENDERERS, [stub.id]: stub };

describe('shape renderer port', () => {
  it('serves the retained DOM/SVG layer as the built-in renderer', () => {
    expect(SHAPE_RENDERERS[DOM_SVG_RENDERER.id]).toBe(DOM_SVG_RENDERER);
    expect(DOM_SVG_RENDERER.Component).toBe(FlatShapeLayer);
    expect(DOM_SVG_RENDERER.id).toBe('dom-svg');
  });

  it('serves the Canvas2D implementation alongside it', () => {
    expect(SHAPE_RENDERERS[CANVAS_2D_RENDERER.id]).toBe(CANVAS_2D_RENDERER);
    expect(resolveShapeRenderer('?renderer=canvas-2d')).toBe(
      CANVAS_2D_RENDERER,
    );
    expect(CANVAS_2D_RENDERER.Component).not.toBe(FlatShapeLayer);
  });

  it('defaults to the DOM/SVG renderer without a request', () => {
    expect(resolveShapeRenderer('')).toBe(DOM_SVG_RENDERER);
    expect(resolveShapeRenderer('?rasterCache=on')).toBe(DOM_SVG_RENDERER);
  });

  // The point of the port: an implementation the module does not import can be
  // selected without touching the scene, the shape utils, or picking.
  it('selects an implementation that is not built in', () => {
    expect(resolveShapeRenderer('?renderer=stub', undefined, table)).toBe(stub);
    expect(resolveShapeRenderer('?renderer=dom-svg', undefined, table)).toBe(
      DOM_SVG_RENDERER,
    );
  });

  // The preference is what the settings menu writes; the URL is what a bench
  // link or an A/B pins, and it has to win over whatever the machine prefers.
  it('takes the saved preference when the URL asks for nothing', () => {
    expect(resolveShapeRenderer('', 'canvas-2d')).toBe(CANVAS_2D_RENDERER);
    expect(resolveShapeRenderer('?rasterCache=on', 'canvas-2d')).toBe(
      CANVAS_2D_RENDERER,
    );
  });

  it('lets the URL override the saved preference either way', () => {
    expect(resolveShapeRenderer('?renderer=dom-svg', 'canvas-2d')).toBe(
      DOM_SVG_RENDERER,
    );
    expect(resolveShapeRenderer('?renderer=canvas-2d', 'dom-svg')).toBe(
      CANVAS_2D_RENDERER,
    );
  });

  it('falls back when the preference names nothing that exists', () => {
    expect(resolveShapeRenderer('', 'webgpu')).toBe(DOM_SVG_RENDERER);
  });

  it('falls back rather than leaving the board without a scene', () => {
    expect(resolveShapeRenderer('?renderer=webgpu', undefined, table)).toBe(
      DOM_SVG_RENDERER,
    );
    expect(resolveShapeRenderer('?renderer=', undefined, table)).toBe(DOM_SVG_RENDERER);
  });

  // `auto` is the default preference: the DOM/SVG layer until the page is big
  // enough for its zoom-out to collapse.
  it('picks by page size under auto, and nowhere else', () => {
    expect(resolveShapeRenderer('', 'auto')).toBe(DOM_SVG_RENDERER);
    expect(resolveShapeRenderer('', 'auto', SHAPE_RENDERERS, true)).toBe(
      CANVAS_2D_RENDERER,
    );
    expect(resolveShapeRenderer('', 'dom-svg', SHAPE_RENDERERS, true)).toBe(
      DOM_SVG_RENDERER,
    );
    expect(
      resolveShapeRenderer('?renderer=dom-svg', 'auto', SHAPE_RENDERERS, true),
    ).toBe(DOM_SVG_RENDERER);
  });
});
