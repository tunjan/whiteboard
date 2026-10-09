# Camera raster caches

The dot grid discards levels coarser than the finest fully visible level. Because
the theme's dot colors are translucent, shared intersections are now lighter.
The DOM snapshot test checks the reduced layer count, not pixel equivalence to
the old overlapping grid.

Backgrounds retain the SVG at rest. During a camera gesture, a prepainted canvas
wallpaper moves by a modulo translation and scales inside a √2 zoom band. It is
rebuilt on band/spacing changes, theme or viewport changes, and settle. Coordinate
axes and labels remain live. Dot fades and screen-sized strokes are temporarily
frozen with the raster, so they can soften or change slightly on settle.

Shapes use world-aligned 512px tiles at the nearest √2 zoom level. Tiles have a
2px sampling bleed, and the viewport's existing 25% overscan is warmed ahead of
the camera. A complete previous zoom level remains usable while the next level
loads. If neither level covers the viewport, the mounted SVG scene is shown.
At rest the SVG is always shown, and fresh tiles are prepared for the next
gesture. No `will-change` hint is applied to the bitmaps.

The default gate is **Firefox with at least 200 visible shape records**. This is
a conservative starting threshold based on the earlier engine-dependent
snapshot results, not a newly measured break-even point. Chromium and other
engines retain live shape rendering by default.

Use `?rasterCache=on` to test on any engine or small scene; use
`?rasterCache=off` as the live-shape baseline. These flags affect shapes only.
The DOM exposes `data-raster-state`, `data-raster-tiles`, and `data-raster-paints`
on `[data-shape-raster-cache]`, and `data-raster-paints` on the background canvas.
They allow checking reuse without assuming that transforms imply compositor
promotion or claiming an FPS improvement from rect counts alone.

Tile backing stores share a 64 MiB budget across the current and previous zoom
levels. Resolution is capped at DPR 2 and reduced for larger viewports. Source
markup and embedded resources have separate bounded caches. A huge viewport,
unavailable asset, unsupported animated SVG, or HTML/embedded content falls back
to live rendering. Board-owned images and relevant webfonts are embedded in each
standalone SVG before it is rasterized; external-origin assets stay live.

Document changes (including page resets), hidden/eraser state, editing, cropping,
playback, live strokes, theme changes, loaded fonts/assets, and committed SVG
content invalidate the cache. Generation checks reject late asynchronous
results. Viewport resize and unmount release canvases, observers, subscriptions,
object URLs, and pending resource requests. Frame headings intentionally freeze
within a gesture band, then become exact again on settle.

For a local, non-persisted visual fixture, open
`/raster-review.html?rasterCache=on` on the client dev server. It contains 240 ink
strokes, text, a rotated clipped frame, and a two-pass highlighter. Hold a gesture,
pan and zoom, cross tile and zoom boundaries, edit, switch themes/backgrounds,
and settle. Compare with `rasterCache=off` on the same browser. The fixture is a
separate development entry point and is not part of the production app build.
