# Canvas rendering engine

The interactive canvas uses a retained, flat DOM/SVG scene. `FlatShapeLayer`
mounts one HTML container per shape (with an independent local SVG), ordered by
shape id. Logical parenting, fractional ordering, and visibility never reorder,
reparent, or unmount those containers. Deleting a shape or switching pages does.
The existing pure shape renderers continue to serve both this layer and export.

## State and rendering

- `@tldraw/state` supplies transactional atoms, lazy computed signals, epoch
  tracking, dependency capture, and equality-based early stopping.
- Yjs remains the collaborative document and undo source. Each publication
  writes the changed shapes once into `shape-store.ts` — one atom per shape —
  and `document-changes` hands the scene the ids and what they held before.
  Scene nodes read the store's atoms rather than keeping their own; a scene
  built without a store (tests) owns a private one and `apply` writes it.
  Remote publication retains the existing animation-frame batching. A reset
  refreshes the scene after loading, switching pages, or changing text metrics.
- Each shape has a record signal, a content computed, and a presentation
  computed. Position, rotation, opacity, index, and parent changes update CSS
  through signal effects. They do not reconcile the shape's SVG content.
- Content diffs have a revision in addition to props equality: Yjs ink mirrors
  mutate their point arrays in place. A remote append or same-length edit must
  redraw even when the array reference is unchanged.
- Camera changes write one CSS matrix on the shape layer. Frame headings use
  direct signal effects to retain their screen size and edge orientation.
  Existing controls, screen-space overlays, grid, and discrete LOD changes
  continue to use React.

The scene holds the UI overlays in one atom per concern — `hidden`, `erasing`,
`suppressed`, `pinned` — written together through `setUi`, which drops the ones
whose value is unchanged. `presentation` is mounted once per shape and reads the
first three; only `pinned` is selection-driven, and only `visible` reads it. A
single combined atom made every selection change invalidate every node on the
page. `uiEpoch` is the identity token left for consumers that cache a whole
frame against "any UI change", and `documentEpoch` the one for "any change at
all"; `boundsEpoch` is narrower on purpose — it moves only when a shape's
footprint could have, so reordering, reparenting and opacity do not re-cut the
cull. Records for deleted shapes are dropped, except while a live shape still
names one as its parent: descendant computeds capture the ancestor's atom, and
recreating that id would otherwise hand them a node nobody writes to.

## Geometry, stacking, and culling

`matrix.ts` implements composition, inversion, and point transforms.
`clipping.ts` intersects convex ancestor frame polygons, then maps the result
back into each shape's local coordinates for CSS `clip-path`. An empty mask
means fully clipped; it must never become an absent mask. Ancestor record reads
track dependencies, so frame changes invalidate descendant masks and opacity.

`paint-order.ts` projects fractional sibling order through a depth-first walk
into integer z-indices. `groupByParent` is separate from the walk so the scene
builds the sorted sibling buckets once and derives both the z-indices and the
pin closure's adjacency from them; a pure reorder republishes the z-indices
without touching that adjacency. Stable id ordering independently controls DOM
placement.
Picking shares this paint order and rejects masked/hidden ancestor pixels before
running registered shape geometry tests. Frame labels remain pickable outside
model bounds, and frame interiors yield to underlying geometry before serving
as an empty-frame fallback.

The existing incremental RBush index supplies viewport candidates. Quantized,
overscanned query bounds reuse searches during small camera changes. One page
reactor applies only visibility differences via `display`, for shape containers
and highlighter overlays alike — an overlay reading the cull set from its own
reactor would re-run on every document change; selected/editing shapes and their
descendants stay resident and uncullable. The scene publishes `highlightIds`
beside `ids` so the second ink pass mounts only for the strokes that need it. The live ink layer,
text/video/crop editors, and precision-eraser previews retain their existing
ownership of transient visuals.

## Renderer port

`renderer.ts` declares what the scene expects of the thing that draws it:
an id and a component taking the viewport size. `FlatShapeLayer` is the
`dom-svg` implementation; `../shape-renderer` holds the table and resolves
`?renderer=` once per mount, falling back to `dom-svg` for an absent or unknown
id. `Canvas` mounts `ShapeLayer` rather than a named implementation.

A renderer owns the committed shape scene only. Screen-space overlays —
selection, hover, comments, laser, live ink, the editors — remain React
siblings, because they are drawn in viewport coordinates and do not change
shape under a different rasterizer.

The port deliberately carries no `upsert`, `remove`, `setCamera`, or picking.
`CanvasScene` is the shared contract and a renderer subscribes to its signals
directly, and `hit-test.ts` runs on model geometry without reading rendered
output, so both serve every implementation unchanged. Scene construction stays
inside the renderer, which keeps the `key={currentPageId}` remount meaning what
it does today; a harness that needs two renderers over one scene would have to
hoist it.

The port is a component, not an imperative `mount(host)`: shape content reads
app stores through hooks, so a nested React root would lose that context and
change StrictMode semantics. Implementations still work imperatively inside
layout effects.

The raster tile cache, `shape-raster-source.ts`, `scale-bench.ts`, and the
`/raster-review.html` fixture read the mounted SVG through `data-shape-id`.
They are specific to `dom-svg` and continue to name it directly.

### The Canvas2D implementation

`canvas-2d-renderer.tsx` (`?renderer=canvas-2d`) is the second implementation.
It began as ink only, to measure; it is now the hybrid that measurement argued
for. It paints `draw` shapes through `buildInkRender` — the same path data,
handed to `Path2D` instead of an SVG `d` — and every other geometric type
through `canvas-2d-paint.ts`, which states each shape as a short list of paint
ops built from the same geometry helpers the SVG components use. Paths are
cached per shape against content revision, LOD band, and theme, so a pan
repaints without rebuilding anything.

What the rAF ramp says (`runScaleBench([2000, 10000, 25000])`, Chromium, dpr 2,
1710x986, in a real browser window — an embedded preview pane throttles rAF and
cannot measure this):

**Pan is already solved, and the canvas is worse at it.** Both renderers hold 60fps
and a 16.7ms median frame at every count from 2k to 25k. The DOM layer spends
0.10ms of JS per frame there; the canvas spends 3.0ms to reach the same 60fps,
which the `-shapes` row attributes entirely to the draw (0.10ms with shapes off).
The camera is one CSS matrix on the shape layer, not one per shape, so panning
never scaled with the document to begin with.

**Zoom is where the DOM layer collapses.** At 10k it reports 1fps with a p95 of
366.7ms, and at 25k 1fps with a p95 of 1099.9ms — a 16.7ms median against a mean
near 1000ms, so the shape of it is a handful of multi-second stalls, not a
uniformly slow gesture. The canvas holds 35fps and 24fps at the same counts, with
p95 83.4ms and 150.0ms. The `vis` column shows zooming out taking the drawn set
from ~1400 to 5276. Those containers are not being created — `ShapeList` mounts
every id in the page and culling only toggles `display` — so this is the browser
building style, layout and paint for ~3900 SVG subtrees that genuinely entered the
viewport. Real rendering work, not churn to be eliminated, which is why a
reveal-side deferral measured at ~2%.

The canvas's zoom cost is its own JS (16.0ms median, p95 154.3ms at 25k) with
`browser` down to 0.7ms — that is the ink cache being invalidated as LOD bands are
crossed, rebuilding thousands of strokes. It is a floor, not a ceiling.

A third run added the raster tile cache to the DOM layer (`?rasterCache=on`, which
forces it past its Firefox-only gate). It does not solve zoom, and it regresses
pan badly:

| 25k shapes       | pan fps | pan p95 | zoom fps | zoom p95 |
| ---------------- | ------- | ------- | -------- | -------- |
| dom-svg          | 60      | 17.6ms  | 1        | 1099.9ms |
| dom-svg + raster | 24      | 50.1ms  | 4        | 1250.0ms |
| canvas-2d        | 60      | 17.6ms  | 24       | 150.0ms  |

Zoom's mean improves (1fps to 4fps) while its tail gets worse, and pan drops from
60fps to 24fps — the `-shapes` row attributes ~33ms per frame to the cached shape
layer where the uncached one costs nothing. The likely cause is that tiles are
being prepared continuously and never amortized: the ramp holds the camera in
motion for its whole length, so nothing ever settles. Real gestures do settle, so
this is not a verdict on the cache in ordinary use — but it does mean the cache
cannot be the answer to the zoom collapse, and that its conservative
Firefox-only gate is load-bearing on Chromium rather than merely cautious.

Read the `vis` column with suspicion in cached runs (625-648 against the
baseline's 5276): it reports the last spatial-index search, and the tile source
issues its own narrower queries, so it stops describing the viewport cull.

The canvas renderer is the only configuration measured that fixes zoom without
costing anything on pan. That is the case for expanding it past ink — as a hybrid
that keeps text, equations, images, PDF and video in the DOM — rather than for a
full rasterizer rewrite. Its zoom p95 of 150.0ms was its own path cache
being cleared wholesale on every LOD band crossing. With that fixed the
comparison at 25k shapes stands at:

| 25k shapes       | pan fps | pan p95 | zoom fps | zoom p95 | zoom js p95 |
| ---------------- | ------- | ------- | -------- | -------- | ----------- |
| dom-svg          | 60      | 17.6ms  | 1        | 1099.9ms | 13.7ms      |
| dom-svg + raster | 24      | 50.1ms  | 4        | 1250.0ms | 19.8ms      |
| canvas-2d        | 60      | 17.6ms  | 31       | 83.3ms   | 76.8ms      |

The fix moved zoom from 24fps to 31fps and halved both tails (frame p95 150.0 to
83.3, js p95 154.3 to 76.8); at 10k the same rows read 35fps to 43fps and p95
83.4 to 50.0. Median `js` rose slightly (16.0 to 19.9) while the p95 fell, which
is the trade working as intended: deferring simplification makes the ordinary
frame fill somewhat more detail and removes the rebuild spikes entirely.

What is left is no longer path building. At 25k zoom `browser` reads 0.0 and the
whole frame is `js` filling 5320 paths, so the remaining headroom is the fill
itself — which is what instancing or a GPU pipeline addresses, and the point at
which a step past Canvas2D would have to justify itself.

Pan cost the canvas ~2.7ms of main thread per frame against the DOM layer's
0.10ms (the `-shapes` row reads 0.00). Both held 60fps, so it never dropped a
frame, but it is real work on a slower device — so a pan now shifts the pixels it
already has instead of repainting them.

A pan changes no geometry, so the bitmap is translated with a `copy`-composited
`drawImage` and only the edges that slid into view are repainted, their shapes
fetched from the spatial index rather than by walking the visible set. Measured
on the fixture at 4000 strokes: 67 shapes repainted per pan frame against 1372,
and 0.40ms median / 0.70ms p95 against 1.70ms / 3.30ms for the full path.

The offset is rounded to whole device pixels and `Bitmap.e/f` records where the
pixels actually sit, so the residual against the true camera stays under half a
device pixel rather than accumulating over a long gesture. That residual is why
the shift is restricted to gestures: a settle repaints exactly, which is also
what keeps a still board matching the DOM layer. Against a full repaint of the
same camera, a blitted frame differs on 52 of 620782 ink pixels (0.01%).

It gives up the bitmap whenever the pixels would mean something different — a
zoom (`z`), an edit (`documentEpoch`), the UI overlays (`uiEpoch`), a
theme flip, a resize, a settle — and whenever the shift exceeds half a viewport,
past which there is more exposed edge than retained middle.

Entries are keyed on the LOD inputs they were built from rather than on a global
epoch, so a band crossing re-conditions only the strokes whose answer moved. On
top of that, `isDetailedEnough` lets a gesture keep an entry that carries _more_
detail than the current zoom asks for — every LOD term only removes detail, so
too much of it costs fill time and changes nothing on screen. A zoom-out
therefore reuses what it has and defers the cheaper representation to settle; a
zoom-in, which needs detail the entry does not carry, rebuilds. At rest the
representation is always exact, which is what keeps the canvas matching the DOM
layer pixel for pixel on a settled board.

Measured on the bench fixture at 4000 strokes, zooming from z=1 to z=0.05 without
letting the camera settle: a cold cache conditions 1880 paths, all of them
first-time builds for strokes entering the viewport, then 4000 once at settle. The
same gesture over a warm cache conditions **0**. Before the change every band
crossing rebuilt everything on screen.

`data-canvas-2d-built` publishes the cumulative count. It is cumulative on
purpose — a per-paint counter is overwritten by whatever paint happens next, and
sampling it around a gesture reports zeros that are not there.

An early canvas run read 25.30ms per step at 10k shapes because the renderer
never set `scene.viewport`, and `visible` short-circuits to every id without
one — it was drawing the whole document each frame. The `cull` column reading
0.000 is what names that failure: the spatial index is never queried.

#### The hybrid: what the canvas paints, and what the DOM keeps

`canvas-2d-paint.ts` paints `draw`, `rectangle`, `ellipse`, `polygon`, `line`,
`arrow`, `text`, `image`, `video` and `frame` (`group` draws nothing). It builds
them from the geometry the SVG components already use — `curvePath`,
`arrowheadPath`, `synthesizeDrawPaths`, `mergedRectPath`, `layoutTextProps`,
`dashProps`, `shadowRings` — so the only thing restated on the canvas side is
which paint attribute goes where.

Four types stay in the DOM, and none of them is a rasterization problem worth
solving: `sticker` is lucide artwork authored as React elements, `equation` a
typeset MathJax document, `graph` owns its own wheel gesture, and `bookmark` is
a card of live text. Painting them would mean re-authoring them, and on the
boards this renderer is for they are rare enough that a DOM node each costs
nothing. They mount through `shape-dom-nodes.tsx` — the same `ShapeContainer`,
`HighlightOverlay` and cut preview `FlatShapeLayer` mounts, moved out of it and
given an id list — so neither renderer can drift on what a bookmark looks like.

Ops carry path **data**, not `Path2D`: building stays pure and unit-testable
without a DOM, and `compilePaint` makes the `Path2D` once, as the entry enters
the cache. Anything that depends on the camera is resolved at paint time
instead, so a zoom never rebuilds geometry: a `non-scaling-stroke` becomes
`width / zoom`, and the frame heading stays a `heading` op that lays itself out
against the current zoom, exactly as `LiveFrameHeading` does in the DOM.

Two deliberate differences from the SVG. The hatch fills are stroked as clipped
parallel lines rather than tiled from a `<pattern>`, because a pattern is a
bitmap and the camera would resample it — the lines stay one world unit wide at
every zoom, but their phase is the shape's own origin rather than the page's.
And the sticker's `feDropShadow` has no canvas counterpart — which is moot,
since stickers are the DOM's.

#### Stacking across the seam

A canvas is one element in one stacking slot, so DOM-owned content sits wholly
above or below everything painted. Paint order only decides anything where two
shapes overlap, so `canvas-2d-delegation.ts` states exactly that: a painted
shape above a DOM-owned one whose bounds it overlaps is handed to the DOM as
well, and transitively for whatever sits above *that*. The set is published as
`data-canvas-2d-delegated`.

On an ink board it is empty — DOM-owned content is rare, and usually the most
recently created thing on the page, so nothing is above it. The 25k repaint
bench reports `0 containers`. The pathological case is real and left standing:
ink drawn over a bookmark that has been sitting at the bottom of the z-order
delegates every stroke that touches it, which is the DOM layer's cost for those
strokes and correct stacking for all of them.

Frames clip through `ancestorState`, extracted from the scene's `presentation`
so both renderers read one ancestor walk: the DOM layer maps the mask into the
shape's own coordinates for a CSS `clip-path`, the canvas clips the context with
it in page space before the shape's transform goes down. Eraser cut previews
paint their fragments in place of their owner — fragments are whole shapes in
page coordinates, so they are placed like top-level ones — out of a cache that
is dropped whole when the cut changes. The live-stroke handoff matches
`FlatShapeLayer` term for term, down to a live highlighter keeping its underlay
pass and losing only the overlay.
