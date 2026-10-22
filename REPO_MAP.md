# REPO_MAP.md — Fast Context for AI Coding Agents

> **Purpose:** Read this map first to understand architecture, file responsibilities, state flow, and extension patterns without scanning hundreds of source files.

---

## 1. Executive Summary & Monorepo Architecture

A self-hostable, real-time collaborative whiteboard built for tutoring. Uses an infinite 2D canvas, Yjs CRDT synchronization with Hocuspocus WebSocket server, and Postgres bytea persistence.

```
/
├── shared/     [@whiteboard/shared] Cross-cutting pure TS types, contracts & geometry (no build step)
├── client/     React 19 + Vite + Tailwind v4 + Base UI + Yjs + Zustand
└── server/     Node.js + Hono HTTP API + Hocuspocus v4 WS + Drizzle ORM + Postgres
```

### Key Technologies

- **Language/Runtime:** TypeScript (strict), Node.js 22+, npm workspaces
- **Frontend:** React 19, Vite, Zustand 5, Tailwind CSS v4 (`@theme` in `index.css`), Base UI primitives, Lucide icons, MathLive (authoring) / MathJax (typesetting), RBush (R-tree spatial index)
- **Sync & Collab:** Yjs CRDT, `y-indexeddb` (offline local cache), Hocuspocus v4 (server sync), WebRTC Mesh (audio voice chat)
- **Backend:** Hono, Drizzle ORM, Postgres (`bytea` for Yjs binary dumps), `jose` (JWT cookie auth)

---

## 2. Core Mental Model & Invariants

### A. The `Editor` Seam & State Flow

- **Single Seam:** All shape mutations must go through the `Editor` interface (`client/src/canvas/editor.ts`) implemented in `use-document-store.ts`.
- **Atomic Batches:** For multi-shape updates or drags, wrap mutations in `editor.transact(() => { ... })` to prevent per-shape snapshot recalculation and re-rendering.
- **Undo/Redo Isolation:**
  - `LOCAL_ORIGIN` (`local-user`) is the only undoable origin tracked by `Y.UndoManager`.
  - Non-undoable origins: `COMMENT_ORIGIN`, `DOCUMENTS_ORIGIN`, `STICKERS_ORIGIN`, `EPHEMERAL_ORIGIN`.

### B. Yjs Document Structure

A board is a **tree of documents**, not one. The board document holds the page
registry and everything board-level; each page's shapes are a document of their
own, synced only while that page is resident. Joining a 40-page board syncs the
registry plus the page being looked at.

**Board document** (Hocuspocus name: the board id):

- `pages` (Y.Map): Page metadata (`id`, `name`, `index`).
  - Page ops live in `use-document-store.ts`: `createPage`, `renamePage`, `deletePage`, `movePage(ToIndex)`, `duplicatePage` (async — it awaits the source page's document), `moveShapesToPage`.
  - `duplicatePage` clones shapes with **fresh** ids, remapping `parentId` and connector bindings within the copy; it copies with `Y.Map.clone()`, carrying ink chunks and text sequences across as structure rather than decoding and re-encoding them. `moveShapesToPage` **keeps** ids and world positions, re-rooting any moved shape whose parent stays behind.
- `documents` (Y.Map): Shared file repository metadata.
- `stickers` (Y.Array): Custom sticker library for the board.
- `comments` (Y.Map): Canvas thread comments (not shapes, no undo).
- `music` (Y.Map): Shared playlist playback state.
- `shapes` / `shapes:<pageId>` (Y.Map): **Legacy only.** Where pages lived before the split. `page-migration.ts` moves one page at a time into its own document, the first time that page is opened, and empties the map behind it.

**Page document** (Hocuspocus name: `<boardId>/pages/<pageId>`, from `pageDocumentName` in `@whiteboard/shared`):

- `shapes` (Y.Map): That page's shapes, and nothing else. Each shape is a Y.Map whose base fields (id, type, x, y, rotation, index, parentId, locked, hidden, opacity) are one positional array under `base` (`packShapeBase` / `readShapeBase` in `shared/src/shapes/base.ts`), beside `props` and any sequence (`text`, `points`, `expressions`). Older per-field maps are rewritten by `npm run migrate:shapes -w server`.
- Residency is managed by `page-docs.ts`: the open page and any page pinned for its undo history stay in memory, plus the two most recently used beyond them. Eviction is skipped entirely when a board has neither a local cache nor a server, since there would be nowhere to reload from.
- A page document is created and written to before it has synced — the shapes carry their own ids, so a cross-page move into a page nobody has opened merges when it arrives, with no round trip.
- Deleting a page removes it from the registry (every client then drops its local copy) and `DELETE /api/pages/:boardId/:pageId` deletes the stored row, which the CRDT protocol has no way to express.

**Undo** is per page — one `Y.UndoManager` per page document, owned by `page-history.ts`. A cross-page move writes to two documents, which no single manager can revert, so only the outgoing half is tracked and the incoming half is handed to `PageHistory.recordMove` as a replay (kept against the stack item) and run by hand in `undo`/`redo`. History cannot outlive its document, so an edited page is pinned resident, capped at `MAX_HISTORY_PAGES`. A cross-page move's target is pinned for as long as the source page's history lives (`movePins`), and released with it.

### C. Fractional Indexing (Z-Order)

- Shape stacking order is determined by `shape.index` (fractional string key generated via `generateKeyBetween` / `jitterKeyBetween` in `order.ts`), **never** array order.
- Guarantees deterministic, conflict-free stacking under concurrent CRDT edits.

### D. Coordinate Spaces & Transforms

1. **Screen Space:** Viewport CSS pixels relative to canvas container element.
2. **World Space:** Infinite 2D space `(x, y)` where shapes, lines, and cameras live.
   - Screen to World: `screenToWorld(screenPt, camera)` (`client/src/canvas/camera.ts`)
   - World to Screen: `worldToScreen(worldPt, camera)`
3. **Shape Local Space:** Origin `(0, 0)` is top-left of box shapes or first point of paths. `shape.x` and `shape.y` define world position.

### E. Board Stacking Layers

- Overlays never pick a raw `z-index`; they use a named token (`z-[var(--z-canvas-front)]`, `z-[var(--z-ui)]`). The scales are defined and explained in section 7 of `client/src/index.css`.
- Three nested stacking contexts keep the scales independent: `.wb-board` (root, `isolation: isolate`) → `.wb-canvas-surface` (`contain: strict`) and `.wb-ui-layer` (the click-through panel shell).
- Ties inside a band resolve by DOM order.
- Portaled surfaces (dialogs, popovers, menus, tooltips, toasts) mount on `document.body`, outside `.wb-board`, so they always paint above the board and stay outside these scales.

### F. Pluggable Registries

- **`shapeRegistry`** (`client/src/canvas/shapes/shape-registry.ts`): Extensible map of shape definitions (`ShapeUtil`). The canvas renders and hit-tests shapes polymorphically without switch statements.
- **`toolRegistry`** (`client/src/canvas/tools/tool-registry.ts`): Extensible map of interactive tools (`Tool`). Routes pointer, gesture, and keyboard events based on active tool ID.

---

## 3. Directory & File Index

### `shared/src/` — Cross-Cutting Types & Pure Contracts

| File                  | Responsibility                                                                                                                                                                                                                                                                       |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `geometry.ts`         | Pure 2D math: `Vec`, `Point`, `Bounds`, `Rect`, box intersections, rotation transforms, polygon containment (`pointInPolygon`).                                                                                                                                                      |
| `id.ts`               | `genId()` — collision-resistant nanoid generator for shapes, pages, assets.                                                                                                                                                                                                          |
| `shapes/base.ts`      | `BaseShape<Type, Props>` — common fields (`id`, `type`, `x`, `y`, `rotation`, `index`, `props`, `parentId`, `locked`, `hidden`, `opacity`).                                                                                                                                          |
| `shapes/shapes.ts`    | Discriminated union `Shape` and all prop interfaces (`DrawProps`, `RectangleProps`, `EllipseProps`, `PolygonProps`, `LineProps`, `ArrowProps`, `TextProps`, `ImageProps`, `StickerProps`, `VideoProps`, `BookmarkProps`, `GraphProps`, `EquationProps`, `GroupProps`, `FrameProps`). |
| `document.ts`         | `Page` and `WhiteboardDocument` interfaces.                                                                                                                                                                                                                                          |
| `documents.ts`        | `BoardDocumentMeta`, MIME table (`DOCUMENT_MIME`), safe inline extensions (`INLINE_DOCUMENT_EXTS`).                                                                                                                                                                                  |
| `stickers.ts`         | `CustomStickerMeta`, dimension limits, max stickers constant.                                                                                                                                                                                                                        |
| `links.ts`            | `LinkMetaResponse`, URL sanitization contract.                                                                                                                                                                                                                                       |
| `music.ts`            | `MusicTrack`, `MusicPlaylist`, `MusicPlaybackState`.                                                                                                                                                                                                                                 |
| `voice.ts`            | WebRTC signaling types (`VoiceSignalMessage`, `VoicePeerState`).                                                                                                                                                                                                                     |
| `ai-latex.ts`         | AI LaTeX endpoint contract: request/response shapes, size caps, the `UNREADABLE` refusal sentinel.                                                                                                                                                                                   |
| `latency.ts`          | Ping/pong latency measurement constants.                                                                                                                                                                                                                                             |
| `analytics.ts`        | Attendance contracts (`AnalyticsSummary`, `AnalyticsBoard`, `AnalyticsJoiner`, `AnalyticsVisit`) and the day/week/month/year ranges.                                                                                                                                                                    |
| `ink-codec.ts`        | Binary ink chunk format (`encodeInkChunk` / `decodeInkChunk`): 1/32-unit fixed-point, zigzag-varint deltas, pressure/tilt in 1/256. The only stored form of draw points; `sameStoredPoint` is the append path's equality. |
| `board-repository.ts` | `BoardMeta`, `BoardRepository` interface for dashboard.                                                                                                                                                                                                                              |

---

### `client/src/canvas/` — Infinite Canvas Engine & State

#### Core Engine & Orchestration

| File                                      | Responsibility                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Canvas.tsx`                              | Main canvas controller: orchestrates SVG layers, context-menu selection and wheel zoom. Pointer routing lives in `gesture-arbiter.ts`, keyboard shortcuts in `canvas-shortcuts.ts`, paste and file drop in `canvas-paste-drop.ts`. |
| `gesture-arbiter.ts`                      | `GestureArbiter`: decides what each pointer on the canvas surface is — a stroke of the active tool, a pan (middle/right-drag/Space/finger), a pinch, one-finger or Quick Zoom, or a context menu — and owns all the state that decision rests on (live touches, palm rejection, stale-touch healing, long-press, spring-loaded tool return). `Canvas.tsx` binds its `onPointer*` handlers and calls `abandonAll()` on page switch. Tools keep their own state machines below it. Tested as event sequences in `gesture-arbiter.test.ts`. |
| `editor.ts`                               | `Editor` interface contract (`getShape`, `getShapes`, `createShape`, `updateShape`, `deleteShapes`, `transact`).                                                   |
| `use-document-store.ts`                   | Zustand store + Yjs providers + UndoManagers. Manages board lifecycle (`loadBoard`), shape CRUD, page navigation, spatial index synchronization, and document state. Leaving a page *parks* its derived state (shape cache, sorted array, spatial index, binding graph) so returning to it is a pointer swap; a peer's edit to a parked page records the touched shape ids, and the return patches just those (re-deriving the whole page only when more than a quarter of it changed). Shapes are **not** in the zustand store: each publish writes them once into `engine/shape-store.ts`, and only page/registry metadata stays in zustand. |
| `page-derived.ts`                         | `PageDerivedState`: everything derived from one page's `shapes` map — decoded shapes, z-sorted order (incremental splice), spatial index, binding graph, hierarchy/equation flags — behind `rebuild` / `patch(ids)` / `adopt` / `clear`. The store holds one for the active page (built on the exported `spatialIndex` / `bindingGraph` singletons) and one per parked page; parking is an `adopt`. Also `yToShape` and `collectTouchedShapeIds` (deep-observer events → shape ids). Testable against a bare `Y.Doc`. |
| `board-records.ts`                        | The board document's shared records — comment threads, document repository, custom sticker library, music playback. `bindBoardRecords(doc)` mirrors each map into its store and returns a disposer; the write API (`addComment`, `addBoardDocument`, `addCustomSticker`, `setMusicPlayback`, …) lives here, not in the document store. Needs only a `Y.Doc`. |
| `page-history.ts`                         | `PageHistory` + `useUndoStore`: one `Y.UndoManager` per page, `open(pageId, shapes)` on page switch, `undo` / `redo` / `breakCapture`, history pinning (`MAX_HISTORY_PAGES`), and `recordMove` for the cross-page move a single manager cannot revert. Pin/unpin are injected. The store's `undo` / `redo` / `breakUndoCapture` delegate to it. |
| `scene-ui.ts`                             | What the interaction stores mean for a scene, derived once for every renderer: `bindSceneUi(scene, getShape)` publishes suppressed / pinned / hidden / erasing and keeps them current; `deriveSceneUi` is the pure rule. `activeShapeInteraction` / `isShapeInteractionActive` / `subscribeShapeInteraction` read the text-editing, frame-editing, cropping, video-playing and live-stroke stores as one. Both renderers and the raster cache go through it. |
| `engine/shape-store.ts`                  | `shapeStore`: the one reactive copy of the page's shapes — an atom per shape plus the z-sorted list, written once per publish. The renderers' `CanvasScene` nodes read these atoms (no mirror); React reads them through `use-shapes.ts` (`useShape`, `useShapes`, `useShapesById`, `useStoreValue`). `editor.getShape` still reads the synchronous cache, which runs ahead of the store for the local live stroke and paced peer edits. |
| `ShapeView.tsx`                           | Polymorphic shape renderer invoking registered `ShapeUtil.Component`.                                                                                              |
| `Background.tsx`                          | Dot grid, graph paper, line grid, or blank background renderer matching camera zoom/pan.                                                                           |
| `SelectionLayer.tsx`                      | Selection bounding box, 8 resize handles, rotation handle, and custom shape handles. Shapes that expose `getIndicatorPath()` (connectors) are traced along their own outline instead of boxed. |
| `HoverLayer.tsx`                          | Outline of the shape a click would select, under the select tool only. Traced or boxed by the same rules as the selection, and resolved through the select tool's own `topmostHit` so hover and click cannot disagree. |
| `SelectionToolbar.tsx`                    | Floating quick-actions toolbar above active selection.                                                                                                             |
| `CommentsLayer.tsx`                       | Canvas thread comment pins and popup dialogs.                                                                                                                      |
| `CommentText.tsx`                         | Renders a comment body: Markdown marks as elements, `$…$` / `$$…$$` as MathJax-typeset math (shares the equation render cache).                                     |
| `comment-markdown.ts`                     | Parser for the Markdown-with-LaTeX subset comment bodies are written in (`parseCommentMarkdown`, `parseInline`).                                                    |
| `DrawingCursor.tsx` / `EraserTrail.tsx`   | Dynamic SVG cursor overlay matching brush size, plus the eraser's swipe trail.                                                                                                                   |
| `ImageCropOverlay.tsx`                    | Visual image cropping controls.                                                                                                                                    |
| `VideoPlayerOverlay.tsx`                  | YouTube iframe player overlay.                                                                                                                                     |
| `CanvasControls.tsx` / `UndoControls.tsx` | Bottom-left/bottom-right zoom, mini-map, page navigation, and undo/redo HUD.                                                                                       |
| `use-pass-through-wheel.ts`               | Forwards wheel events from floating UI onto `[data-canvas-surface]`, so scrolling over a panel still pans/zooms the board unless that panel genuinely scrolls.     |

#### Geometry, Snapping & Spatial Indexing

| File                                                                  | Responsibility                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `camera.ts`                                                           | Screen $\leftrightarrow$ World transforms, discrete zoom calculation (`nextDiscreteZoom`).                              |
| `use-camera-store.ts`                                                 | Camera Zustand store (`x`, `y`, `zoom`).                                                                                |
| `spatial-index.ts`                                                    | RBush R-tree index wrapping all shapes on the page for fast $O(\log N)$ viewport culling and hit-testing. `loadAll` bulk-builds it for a page; `adopt` swaps a parked page's index back in without rebuilding. |
| `snapping.ts` / `snap-geometry.ts` / `snap-targets.ts`                | Alignment guide calculation (center lines, bounding edges, 15° rotation snap).                                          |
| `selection-geometry.ts`                                               | Bounds calculation for multi-selection, rigid body rotation/scaling.                                                    |
| `shape-bounds.ts`                                                     | Rotated AABB and OBB bounding box extractors.                                                                           |
| `binding-graph.ts`                                                    | Dependency graph connecting arrow endpoints to target shapes.                                                           |
| `order.ts` / `z-order.ts`                                             | Fractional indexing string generation and layer reordering commands (bring forward, send to back).                      |
| `commands.ts`                                                         | Composite canvas actions: duplicate, group, ungroup, delete with cascade.                                               |
| `align.ts` / `flip.ts`                                                | Align/distribute to a shared edge; mirror the selection across its own box. A flip negates rotation and reverses local asymmetry (ink and connector points, `bend`, bound anchors); read content (text, equations, images, media) is moved but never turned. |
| `hierarchy.ts`                                                        | Parent-child tree traversal for groups and frames.                                                                      |
| `page-names.ts`                                                       | Collision-free page naming (`getIncrementedName`): reuses a trailing counter instead of stacking suffixes.              |
| `page-docs.ts`                                                        | The board's pages as separate CRDT documents: lazy creation, one shared websocket, pinning, and LRU residency.          |
| `page-migration.ts`                                                   | Legacy boards, whose pages lived inside the board document. Moves one page into its own document, idempotently.         |
| `clipboard.ts` / `board/clipboard-os.ts`                              | Internal and OS clipboard serialization for shapes, images, and text.                                                   |
| `style-clipboard.ts`                                                  | Copy/paste style (⌥⌘C / ⌥⌘V). A property lands only where the target type's `getDefaultProps()` declares it, so the registry — not a second table — decides what a shape can take. Never writes the style new shapes inherit. |
| `export-png.tsx` / `png-phys.ts`                                      | Headless SVG-to-Canvas PNG exporter with DPI scaling and physical metadata.                                             |
| `graph-parser.ts` / `graph-sampler.ts` / `graph-intersections.ts`     | 2D graphing engine: parses expressions/parameters, samples curve vertices, computes Newton-Raphson curve intersections. |
| `equation-render.ts` / `equation-source.ts`                           | MathJax display-equation SVG compilation and caching.                                                                   |
| `equation-complete.ts` / `equation-shortcuts.ts`                      | LaTeX command catalog for the panel's autocomplete, plus pure typing edits (auto-brackets, Tab slots, environment rows). |
| `ink-to-latex.ts`                                                     | Handwriting or pasted image → equation: rasterize the selection, transcribe it via `/api/ai/latex/ink`, swap the source for a typeset shape in one undo step. |
| `link-url.ts` / `place-image.ts` / `place-link.ts` / `place-video.ts` | Asset drop and paste placement handlers.                                                                                |
| `place-preset.ts`                                                     | More → Templates: unit circle (circle, axes, dashed special-angle spokes) and blank ruled tables (size chosen on an 8×8 hover grid), dropped at view centre as one selected group. |
| `place-pdf.ts` / `pdf-render.ts`                                      | Pasted/dropped PDF → one `image` shape per page, stacked in a column. `pdf-render.ts` is the only module that touches pdf.js (lazily imported; its fonts/CMaps/wasm are copied into `public/pdfjs` by `client/scripts/copy-pdfjs-assets.mjs`). Pages are rasterized and uploaded *before* any document write, then created in one `transact` — one undo step, and peers never see a half-imported document. |

#### Canvas Zustand Stores & Hooks

- `use-selection-store.ts` — Selected shape IDs (`selectedIds: string[]`).
- `use-hover-store.ts` — The shape the select tool is pointing at, resolved to what a click would catch (a group, not its child). Written per pointer move but only when the answer changes, so hovering within one shape re-renders nothing.
- `use-style-store.ts` — Style new shapes inherit. Color, size, fill, dash and opacity are **one shared set** across every tool (tldraw's `stylesForNextShape`): a colour chosen with the pen in hand is what the rectangle tool and the highlighter lay down too. `nextShapeStyle()` reads it outside React. Font, arrow, spline, polygon and sticker settings sit alongside it. Only a control the user moved writes here — selecting a shape does not.
- `use-style-controls.ts` — The one answer to "which style controls apply right now, what does each one read, and what does it write?": derives the visibility flags from the active tool plus the selection, reads each value from the selection where it agrees on one (falling back to the style store), and returns setters that update the style store *and* every selected shape carrying that property. Consumed by `tool-properties-satellite.tsx`.
- `use-canvas-ui-store.ts` — Canvas HUD visibility, grid mode, performance stats toggles.
- `use-tool-store.ts` / `use-tool-lock-store.ts` — Active tool ID and tool lock state.
- `use-eraser-store.ts` / `use-eraser-cut-store.ts` — Precision path cutting state.
- `use-eraser-trail-store.ts` — Self-consuming swipe trail (ring buffer, ≤8 points), drawn by `EraserTrail.tsx`.
- `use-comments-store.ts` — Active comment threads.
- `use-pdf-import-store.ts` — The one pending PDF page-range request. Inverted from the app's other dialogs: `place-pdf.ts` awaits a promise and `pdf-range-dialog.tsx` settles it.
- `use-documents-store.ts` — Board file attachment drawer, plus which attachments this user hasn't opened yet (`unread`, owned by `board/document-notifications.ts`).
- `use-custom-stickers-store.ts` — User custom sticker library.
- `use-camera-interaction.ts` / `use-wheel.ts` / `use-space-pan.ts` / `use-safari-gestures.ts` — Viewport pan/zoom input handling.
- `touch-input.ts` — What a finger does, as pure decisions the canvas routes on: `fingerDraws` (the `fingerAction` preference — draw / pan / auto, where `auto` switches to pan once a stylus has been seen), `isFingerTap` (a pan that went nowhere, replayed to the tool so a finger can still select), and `multiTouchTapAction` (two-finger tap = undo, three = redo).
- `platform.ts` — `isDarwin` / `isIos` / `isCoarsePointer`. Sniffing that changes *input semantics*, not styling.

---

### `client/src/canvas/shapes/` — Shape Implementations (`ShapeUtil`)

Every shape implements `ShapeUtil<T>` (registered in `register.ts`):

| Shape Type  | File                                                            | Key Features                                                                                                               |
| ----------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `draw`      | `draw.tsx`, `ink-engine.ts`, `ink-points.ts`, `perfect-dash.ts` | Variable-width ink with Catmull-Rom smoothing, pressure simulation, stylus tilt broadening, velocity-driven lift tapers, fill patterns (solid, hatch, crosshatch), dash styles. |
| `rectangle` | `rectangle.tsx`                                                 | Box shape with fills and border dashes.                                                                                    |
| `ellipse`   | `ellipse.tsx`                                                   | Ellipse/circle with fills and border dashes.                                                                               |
| `polygon`   | `polygon.tsx`, `polygon-geometry.ts`                            | Triangle, diamond, trapezoid, pentagon, hexagon.                                                                           |
| `line`      | `line.tsx`, `line-geometry.ts`                                  | Polyline with straight/smooth spline interpolation and center label.                                                       |
| `arrow`     | `arrow.tsx`, `connector-routing.ts`, `connector-handles.ts`     | Straight, arc, or elbow connectors with terminal shape bindings.                                                           |
| `text`      | `text.tsx`, `text-measure.ts`                                   | Auto-width or fixed-width text with font families (`sans`, `serif`, `mono`, `hand`).                                       |
| `image`     | `image.tsx`                                                     | Server blob-backed image with non-destructive fractional cropping; drawn from a 512px `thumbBlobId` copy once zoomed out. |
| `sticker`   | `sticker.tsx`, `sticker-catalog.tsx`, `sticker-icons.ts`        | Vector stamp catalog and user custom sticker images.                                                                       |
| `video`     | `video.tsx`                                                     | YouTube embed player with aspect ratio preservation.                                                                       |
| `bookmark`  | `bookmark.tsx`                                                  | Unfurled link card with preview image, favicon, domain name.                                                               |
| `graph`     | `graph.tsx`, `graph-storage.ts`, `graph-interaction.ts`         | 2D cartesian plot with pan/zoom viewport, dynamic expressions, parameters.                                                 |
| `equation`  | `equation.tsx`                                                  | LaTeX math equation with MathJax SVG renderer.                                                                             |
| `group`     | `group.tsx`                                                     | Composite container shape (bounds = union of children).                                                                    |
| `frame`     | `frame.tsx`                                                     | Named slide/artboard container shape.                                                                                      |

---

### `client/src/canvas/tools/` — Interactive Tool State Machines

All tools implement `Tool` (registered in `register.ts`):

| Tool ID                 | File                                                      | Activation & Behavior                                                                                                                                  |
| ----------------------- | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `select`                | `select-tool.ts`                                          | Hotkey `v` / `s`. Pointer dragging, multi-selection marquee, 8 resize handles, rotation handle, handle dragging, double-click to edit text/open group. |
| `hand`                  | `hand-tool.ts`                                            | Hotkey `h` / `Space`. Click-drag canvas panning.                                                                                                       |
| `draw`                  | `draw-tool.ts`                                            | Hotkey `d` / `p` / `b`. Freehand ink drawing with hardware coalesced samples. `createDrawTool(config)` also backs the highlighter. Shift draws straight segments; the live frame densifies them (`densifyStraight`) so the streamline filter reaches the cursor. Closed-stroke fills are painted in both `draw.tsx` (SVG) and `canvas-2d-renderer.tsx` (`CachedInk.fill`). Shift draws straight segments; the live frame densifies them (`densifyStraight`) so the streamline filter reaches the cursor. Closed-stroke fills are painted in both `draw.tsx` (SVG) and `canvas-2d-renderer.tsx` (`CachedInk.fill`).                                                                          |
| `highlighter`           | `draw-tool.ts`                                            | Hotkey `i`. The same freehand state machine laying marker ink: constant width, translucent, stacked under the drawing.                                  |
| `line` / `arrow`        | `line-tool.ts`                                            | Hotkey `l` / `a`. Drag to create line/arrow; snaps endpoints to shape anchor points.                                                                   |
| `rectangle` / `ellipse` | `box-tool.ts`                                             | Hotkey `r` / `o`. Drag to create boxes/ellipses (Shift for 1:1 square/circle).                                                                         |
| `polygon`               | `polygon-tool.ts`                                         | Drag to create regular polygons.                                                                                                                       |
| `text`                  | `text-tool.ts`                                            | Hotkey `t`. Click to place auto-sizing text; drag horizontally for a fixed-width wrapping box. Opens the inline editor either way.                      |
| `eraser`                | `eraser-tool.ts`, `erase.ts`, `erase-geometry.ts`, `cut-polyline.ts`, `precision-erase.ts` | Hotkey `e`. Whole-object deletion or precision path slicing. Groups erase as a unit unless the swipe starts inside one; frame clips are respected; ⌘/Ctrl takes only the topmost shape.                                                                                           |
| `laser`                 | `laser-tool.ts`                                           | Hotkey `k`. Transient presenter laser trail.                                                                                                           |
| `graph`                 | `graph-tool.ts`                                           | Hotkey `g`. Click/drag to drop a new 2D graphing coordinate plane.                                                                                     |
| `equation`              | `equation-tool.ts`                                        | Hotkey `m`. Click/drag to drop a LaTeX equation.                                                                                                       |
| `sticker`               | `sticker-tool.ts`                                         | Stamp selected sticker onto board.                                                                                                                     |
| `frame`                 | `frame-tool.ts`                                           | Hotkey `f`. Drag to create a frame container.                                                                                                          |
| `comment`               | `comment-tool.ts`                                         | Hotkey `c`. Click to drop a discussion comment pin.                                                                                                    |
| `straightedge` / `compass` | `line-tool.ts` (`construction`), `compass-tool.ts`, `../construction-snap.ts` | More menu. Ruler-and-compass constructions: segment / circle by centre and radius point. Both snap to shape points and outline crossings (exact for circles) regardless of the snapping preference; Alt bypasses. Sticky, like the pen. |
| `measure`               | `measure-tool.ts`, `../MeasureLayer.tsx`, `../use-measure-store.ts` | More menu. Drag between two points to read length (board units) and angle; snaps like the straightedge. Transient: local only, cleared on next press, tool switch or page switch. |

---

### `client/src/hooks/` — Cross-Screen Browser Adaptation

| File                   | Responsibility                                                                                                                                                                                                                                               |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `keyboard-inset.ts`    | Pure: how much of the layout viewport the on-screen keyboard covers, derived from the visual viewport. iPadOS draws the keyboard *over* the page rather than shrinking it.                                                                                     |
| `use-keyboard-inset.ts`| Publishes that as `--wb-keyboard-inset` on `<html>`; `--wb-inset-bottom` (section 3 of `index.css`) folds it together with the device safe area, and every bottom-anchored surface — toolbar, both corner HUDs, minimap, call panel — anchors to that instead. |
| `use-wake-lock.ts`     | Holds a screen wake lock while a board is open, re-acquiring on every return to visibility (the OS drops it on backgrounding). A watched board is not an idle one.                                                                                            |
| `use-hover-cursor.ts` / `use-roving-toolbar.ts` / `use-shape-anchor.ts` / `use-mobile.ts` | Pointer cursor resolution, toolbar arrow-key roving, shape-anchored overlay positioning, viewport width query.                                        |

---

### `client/src/collab/` — Real-Time Presence, Follow & Voice

| File                                          | Responsibility                                                                                               |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `presence.ts`                                 | Awareness broadcast: local user identity, cursor position, selected shape IDs, in-progress erase marks, active page, viewport bounds. Momentary fields (cursor/laser/erasing) are not republished on rebind. |
| `CursorsLayer.tsx`                            | Renders smooth multiplayer cursors with username tags and color swatches.                                    |
| `PeerSelectionLayer.tsx`                      | Renders color-coded selection bounding boxes for collaborators.                                              |
| `use-presence-store.ts`                       | Zustand store tracking all active peers in the room.                                                         |
| `use-follow-store.ts` / `follow-controls.tsx` | Viewport follow mode (smoothly locks camera to target peer's viewport).                                      |
| `latency.ts` / `latency-warning-toast.tsx`    | Heartbeat latency ping/pong monitoring.                                                                      |
| `foreground-reconnect.ts`                     | Reconnects the board socket the moment the tab returns to the foreground. iPadOS suspends a backgrounded tab's socket silently, and Hocuspocus's own retry is on a backoff by then. |
| `attention.ts`                                | Publishes this client's own attention facts (input counter + tab visibility/focus) over awareness. No heartbeat: readers time the changes. |
| `attention-state.ts`                          | Pure fold from those facts to `attentive`/`idle`/`away` on the reader's clock, plus the once-per-episode alert edge. |
| `use-attention-store.ts` / `attention-toast.tsx` | Tutor-only read of every student's attention, and the toast it raises. Inert for students and when alerts are off. |
| `voice/voice-session.ts`                      | WebRTC Mesh audio room manager: creates peer connections, coordinates SDP offers/answers over Yjs awareness. |
| `voice/voice-gate.ts`                         | Web Audio API Voice Activity Detection (VAD) / noise gate.                                                   |
| `voice/use-voice-store.ts`                    | Audio state store (mute, deafen, speaking indicators, active speakers).                                      |

---

### `client/src/components/` — UI Panels, Dialogs & Controls

| Component                 | Responsibility                                                                                     |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `board-ui-layer.tsx`      | Click-through shell holding every floating panel; one stacking band + one wheel forwarder.         |
| `toolbar.tsx`             | Main floating tool palette (docked bottom or top).                                                 |
| `board-chrome.tsx`        | Top header bar: board title, back button, share button, page navigation, voice HUD, presence list. |
| `tool-properties-satellite.tsx` | **The style surface.** Every style control, as a second bar above the toolbar: stroke weight and colour inline, and fill / stroke style / opacity / text / arrow / line behind keys that preview their current value. Drives both the active tool's defaults and the selection. |
| `style-previews.tsx`      | Shared option tables and glyphs for those controls (fill, dash, spline, typeface, weight, align, arrow route).                                       |
| `style-panel.tsx`         | *Legacy, not mounted.* The top-right property inspector the satellite bar replaced; still reads `use-style-controls.ts`, so it cannot disagree with the live UI. |
| `graph-panel.tsx`         | Graph equation list, function curves, slider variables, viewport range bounds.                     |
| `equation-panel.tsx`      | LaTeX source editor: command autocomplete, Quick-LaTeX typing shortcuts, and "describe an equation" generation. |
| `documents-panel.tsx`     | Drawer for uploading, downloading, and viewing board file attachments; carries the unread dot.     |
| `page-menu.tsx`           | Multi-page list switcher, reordering, creation, and deletion.                                      |
| `pdf-range-dialog.tsx`    | Which pages of an over-long PDF to import; also how the page limit is announced.                   |
| `canvas-context-menu.tsx` | Right-click context menu (Cut, Copy, Paste, Bring to Front, Send to Back, Group, Lock).            |
| `board-notes-dialog.tsx`  | Tutor-only student notes: standing notes, error log, and per-session dated notes on a calendar.                                                                  |
| `board-actions-menu.tsx`  | Board ⋯ menu: dialogs, PNG copy/export + resolution, and all board preferences (theme, snapping, pen, sound, perf overlay, tutor-only attention thresholds). |
| `music/music-player.tsx`  | Whiteboard background music audio player and playlist selector.                                    |

---

### `server/src/` — Backend API, Collab & Database

| File                                                          | Responsibility                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                    | HTTP server (Hono) on port 3001, static client file serving, WebSocket upgrade handler.                       |
| `env.ts`                                                      | Validates environment variables (`TUTOR_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, `PORT`).                 |
| `db/schema.ts`                                                | Drizzle ORM schema: `boards` (metadata), `board_documents` (binary Yjs state), `board_session_notes` (dated tutor notes) and `board_sessions` (attendance).                 |
| `db/client.ts`                                                | Postgres connection pool using `postgres.js` and Drizzle.                                                     |
| `collab/hocuspocus.ts`                                        | Hocuspocus collaboration server: loads and debounces saves of binary Yjs state to Postgres `board_documents`. |
| `collab/session-tracking.ts`                                  | Attendance: opens a `board_sessions` row per connection to a board document and writes back time and edits on a slow tick. The app's only usage signal.       |
| `collab/migrate-ink.ts` / `scripts/migrate-ink.ts`            | One-time rewrite of pre-chunk strokes (Base64 Float16, number triples, point objects, `props.points`) into `ink-codec` chunks. `npm run migrate:ink -w server [-- --apply]`, server stopped. |
| `analytics/routes.ts` / `analytics/aggregate.ts`              | `GET /api/analytics` (tutor-only): the queries behind the register, and the pure fold that turns connection rows into per-board visits, people, drawings and time without the tutor.       |
| `auth/routes.ts` / `auth/jwt.ts` / `auth/password.ts`         | Tutor authentication with constant-time password check and JWT cookies.                                       |
| `boards/routes.ts`                                            | Board CRUD endpoints (`/api/boards`), tutor notes (`/api/boards/:id/notes`), dated session notes (`/api/boards/:id/sessions`), and the share link (`/:id/access`, `/:id/access/reset`, `/:id/remove`).                               |
| `boards/access.ts`                                            | Who may do what on a board: tutor cookie, or the board's `share_key` + `share_mode` (edit/view/off). `requireBoardEdit` gates uploads, AI, unfurl and page delete; Hocuspocus `onAuthenticate` uses `boardAccess`. |
| `rate-limit.ts` / `storage-quota.ts` / `client-errors.ts`     | Per-client fixed-window limits (`CLIENT_IP_HEADER` behind a proxy), the upload disk quota (`UPLOAD_QUOTA_GB`), and `POST /api/client-errors` (browser crashes → server log). |
| `blobs/routes.ts` / `blobs/store.ts`                          | Content-addressed binary storage (SHA256) for images and custom stickers.                                     |
| `boards/board-file.ts`                                        | `.board` file: gzipped JSON of the board doc, every registry page doc (V2 updates) and every referenced image/file. `GET /api/boards/:id/export` (anyone the share link admits), `POST /api/boards/import` (tutor; new board, hashes checked before any write). |
| `documents/routes.ts` / `documents/store.ts`                  | Board attachment storage with MIME validation (`/api/docs`).                                                  |
| `links/routes.ts` / `links/fetch-remote.ts` / `links/meta.ts` | OpenGraph HTML scraper for link preview cards (downloads images to blob store).                               |
| `ai/routes.ts` / `ai/openrouter.ts` / `ai/latex.ts` | OpenRouter proxy for the two AI LaTeX actions (`/api/ai`). Prompts and reply unwrapping live in `latex.ts`. |
| `music/routes.ts`                                             | Scans `server/data/music` for audio files and serves streaming tracks.                                        |

---


## 5. Verification & Test Commands

Run checks before committing any changes:

```bash
npm run check        # Run strict typecheck across shared, client, server + all vitest tests
npm run typecheck    # Strict TypeScript check only
npm test             # Run client & server vitest test suites
npm run build        # Build production bundles
```
