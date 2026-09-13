# Canvas rendering engine

The interactive canvas uses a retained, flat DOM/SVG scene. `FlatShapeLayer`
mounts one HTML container per shape (with an independent local SVG), ordered by
shape id. Logical parenting, fractional ordering, and visibility never reorder,
reparent, or unmount those containers. Deleting a shape or switching pages does.
The existing pure shape renderers continue to serve both this layer and export.

## State and rendering

- `@tldraw/state` supplies transactional atoms, lazy computed signals, epoch
  tracking, dependency capture, and equality-based early stopping.
- Yjs remains the collaborative document and undo source. `document-changes`
  bridges its accumulated record/content diffs to the scene at publication.
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

## Geometry, stacking, and culling

`matrix.ts` implements composition, inversion, and point transforms.
`clipping.ts` intersects convex ancestor frame polygons, then maps the result
back into each shape's local coordinates for CSS `clip-path`. An empty mask
means fully clipped; it must never become an absent mask. Ancestor record reads
track dependencies, so frame changes invalidate descendant masks and opacity.

`paint-order.ts` projects fractional sibling order through a depth-first walk
into integer z-indices. Stable id ordering independently controls DOM placement.
Picking shares this paint order and rejects masked/hidden ancestor pixels before
running registered shape geometry tests. Frame labels remain pickable outside
model bounds, and frame interiors yield to underlying geometry before serving
as an empty-frame fallback.

The existing incremental RBush index supplies viewport candidates. Quantized,
overscanned query bounds reuse searches during small camera changes. One page
reactor applies only visibility differences via `display`; selected/editing
shapes and their descendants stay resident and uncullable. The live ink layer,
text/video/crop editors, and precision-eraser previews retain their existing
ownership of transient visuals.

## Compatibility with the supplied tldraw architecture

This is an integration into the existing whiteboard, not a tldraw document
migration. Persisted positions remain page-space coordinates with center-based
rotation; the existing tools already move descendants explicitly. Applying a
second parent transform would move them twice. Camera x/y remain the world
coordinates at the viewport origin (the negative of the supplied translation
convention). Bound arrows retain this app's ability to escape ancestor frame
clips. Existing ink, geometry, fractional jitter, tool state machines, snapping,
and connector routing remain in their established modules.

## Verification

`scene.test.ts` covers signal isolation, ancestor invalidation, stacking,
clipping, culling, affine round trips, and picking. `FlatShapeLayer.test.tsx`
uses a real React DOM root, StrictMode, Yjs, and embedded iframes to check node
identity, content updates, movement, culling, undo/redo, and effect cleanup.

With the client dev server running, open
`/prototypes/canvas-engine/` for an isolated manual fixture. It uses in-memory
Yjs with persistence and collaboration disabled. It exercises the real canvas
and includes controls for movement, parenting, and camera culling. This fixture
is not an entry point in the production build.
