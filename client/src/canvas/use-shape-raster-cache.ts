import { useLayoutEffect, type RefObject } from 'react';
import type { CanvasScene } from './engine/scene';
import { subscribeDocumentChanges } from './engine/document-changes';
import { ShapeRasterSource } from './shape-raster-source';
import { rasterizeSvg } from './raster-svg';
import { shouldCacheShapes, type RasterCacheMode } from './raster-grid';
import { ShapeTileCache } from './shape-tile-cache';
import { useCameraStore } from './use-camera-store';
import { useCanvasUiStore } from './use-canvas-ui-store';
import { useCameraInteraction } from './use-camera-interaction';
import {
  isShapeInteractionActive,
  subscribeShapeInteraction,
} from './scene-ui';
import { useHiddenStore } from './use-hidden-store';
import { useEraserStore } from './use-eraser-store';
import { useEraserCutStore } from './use-eraser-cut-store';

export function useShapeRasterCache(
  scene: CanvasScene,
  live: RefObject<HTMLDivElement | null>,
  host: RefObject<HTMLDivElement | null>,
  containers: Map<string, HTMLDivElement>,
  width: number,
  height: number,
) {
  // The saved preference, which the effect below takes as an input: flipping it
  // tears the cache down and builds the other configuration, because a tile
  // cache cannot change its own gate halfway through a session.
  const preference = useCanvasUiStore((s) => s.rasterCache);
  useLayoutEffect(() => {
    if (!live.current || !host.current) return;
    // `?rasterCache=` still wins, so a bench link pins the configuration it is
    // measuring whatever the machine it runs on prefers.
    const parameter = new URLSearchParams(location.search).get('rasterCache');
    const mode: RasterCacheMode =
      parameter === 'on' || parameter === 'off' ? parameter : preference;
    // Do not even observe the shape DOM on engines excluded by the gate.
    if (!shouldCacheShapes(mode, navigator.userAgent, Number.MAX_SAFE_INTEGER))
      return;
    const cache = new ShapeTileCache({
      live: live.current,
      host: host.current,
      width,
      height,
      camera: () => useCameraStore.getState().camera,
      moving: () => useCameraInteraction.getState().isMoving,
      eligible: () =>
        shouldCacheShapes(
          mode,
          navigator.userAgent,
          scene.visible.get().size,
        ) && !isShapeInteractionActive(),
      source: () => {
        const source = new ShapeRasterSource(scene, live.current!, containers);
        return {
          tile: async (tile, zoom, pixels) =>
            rasterizeSvg(await source.tile(tile, zoom, pixels), pixels),
          dispose: () => source.dispose(),
        };
      },
    });
    // Camera presentation writes aren't content changes. LOD, equations and
    // asynchronously loaded SVG content are, and can arrive without a document
    // write. Frame labels deliberately stay frozen inside the zoom band.
    const content = new MutationObserver((records) => {
      if (
        records.some((record) => {
          const element =
            record.target instanceof Element
              ? record.target
              : record.target.parentElement;
          if (!element) return false;
          if (
            record.type === 'attributes' &&
            (element === live.current || element.parentElement === live.current)
          )
            return false;
          if (element.closest('[data-frame-heading]')) return false;
          return true;
        })
      )
        cache.invalidate();
    });
    content.observe(live.current, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const theme = new MutationObserver(cache.invalidate);
    theme.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style', 'data-theme'],
    });
    const invalidate = cache.invalidate;
    live.current.addEventListener('load', invalidate, true);
    document.fonts?.addEventListener('loadingdone', invalidate);
    const stops = [
      subscribeDocumentChanges(invalidate),
      useCameraStore.subscribe(cache.refresh),
      useCameraInteraction.subscribe(cache.refresh),
      subscribeShapeInteraction(invalidate),
      useHiddenStore.subscribe(invalidate),
      useEraserStore.subscribe(invalidate),
      useEraserCutStore.subscribe(invalidate),
    ];
    cache.refresh();
    const element = live.current;
    return () => {
      for (const stop of stops) stop();
      content.disconnect();
      theme.disconnect();
      element.removeEventListener('load', invalidate, true);
      document.fonts?.removeEventListener('loadingdone', invalidate);
      cache.dispose();
    };
  }, [scene, live, host, containers, width, height, preference]);
}
