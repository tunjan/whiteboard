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

- `shapes` (Y.Map): Default page (`page-default`) shapes.
- `shapes:<pageId>` (Y.Map): Shapes for subsequent pages.
- `pages` (Y.Map): Page metadata (`id`, `name`, `index`).
  - Page ops live in `use-document-store.ts`: `createPage`, `renamePage`, `deletePage`, `movePage(ToIndex)`, `duplicatePage`, `moveShapesToPage`.
  - `duplicatePage` clones shapes with **fresh** ids, remapping `parentId` and connector bindings within the copy; `moveShapesToPage` **keeps** ids and world positions, re-rooting any moved shape whose parent stays behind.
  - Undo is per page (one `Y.UndoManager` per page's shapes map). A cross-page move writes to two maps, so the initiating page's manager takes the target map into scope and `crossPageMoveOwner` makes exactly one manager capture the transaction — otherwise undo would restore the shapes on the source while the copies stayed on the target.
- `documents` (Y.Map): Shared file repository metadata.
- `stickers` (Y.Array): Custom sticker library for the board.
- `comments` (Y.Map): Canvas thread comments (not shapes, no undo).
- `music` (Y.Map): Shared playlist playback state.

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
| `board-repository.ts` | `BoardMeta`, `BoardRepository` interface for dashboard.                                                                                                                                                                                                                              |

---

### `client/src/canvas/` — Infinite Canvas Engine & State

#### Core Engine & Orchestration

| File                                      | Responsibility                                                                                                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `Canvas.tsx`                              | Main canvas controller: orchestrates SVG layers, pointer events, wheel/pinch zoom, keyboard shortcuts, paste/drop handlers, context menu, and active tool routing. |
| `editor.ts`                               | `Editor` interface contract (`getShape`, `getShapes`, `createShape`, `updateShape`, `deleteShapes`, `transact`).                                                   |
| `use-document-store.ts`                   | Zustand store + Yjs provider + UndoManager. Manages board lifecycle (`loadBoard`), shape CRUD, page navigation, spatial index synchronization, and document state. |
| `ShapeView.tsx`                           | Polymorphic shape renderer invoking registered `ShapeUtil.Component`.                                                                                              |
| `Background.tsx`                          | Dot grid, graph paper, line grid, or blank background renderer matching camera zoom/pan.                                                                           |
| `SelectionLayer.tsx`                      | Selection bounding box, 8 resize handles, rotation handle, and custom shape handles.                                                                               |
| `SelectionToolbar.tsx`                    | Floating quick-actions toolbar above active selection.                                                                                                             |
| `CommentsLayer.tsx`                       | Canvas thread comment pins and popup dialogs.                                                                                                                      |
| `CommentText.tsx`                         | Renders a comment body: Markdown marks as elements, `$…$` / `$$…$$` as MathJax-typeset math (shares the equation render cache).                                     |
| `comment-markdown.ts`                     | Parser for the Markdown-with-LaTeX subset comment bodies are written in (`parseCommentMarkdown`, `parseInline`).                                                    |
| `LaserLayer.tsx`                          | Real-time fading laser pointer trails.                                                                                                                             |
| `DrawingCursor.tsx` / `EraserCursor.tsx` / `EraserTrail.tsx` | Dynamic SVG cursor overlays matching brush/eraser size, plus the eraser's swipe trail.                                                                                                           |
| `TextEditorOverlay.tsx`                   | In-place rich/plain text editor overlay for text shapes.                                                                                                           |
| `ImageCropOverlay.tsx`                    | Visual image cropping controls.                                                                                                                                    |
| `VideoPlayerOverlay.tsx`                  | YouTube iframe player overlay.                                                                                                                                     |
| `CanvasControls.tsx` / `UndoControls.tsx` | Bottom-left/bottom-right zoom, mini-map, page navigation, and undo/redo HUD.                                                                                       |
| `use-pass-through-wheel.ts`               | Forwards wheel events from floating UI onto `[data-canvas-surface]`, so scrolling over a panel still pans/zooms the board unless that panel genuinely scrolls.     |

#### Geometry, Snapping & Spatial Indexing

| File                                                                  | Responsibility                                                                                                          |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| `camera.ts`                                                           | Screen $\leftrightarrow$ World transforms, discrete zoom calculation (`nextDiscreteZoom`).                              |
| `use-camera-store.ts`                                                 | Camera Zustand store (`x`, `y`, `zoom`).                                                                                |
| `spatial-index.ts`                                                    | RBush R-tree index wrapping all shapes on the page for fast $O(\log N)$ viewport culling and hit-testing.               |
| `snapping.ts` / `snap-geometry.ts` / `snap-targets.ts`                | Alignment guide calculation (center lines, bounding edges, 15° rotation snap).                                          |
| `selection-geometry.ts`                                               | Bounds calculation for multi-selection, rigid body rotation/scaling.                                                    |
| `shape-bounds.ts`                                                     | Rotated AABB and OBB bounding box extractors.                                                                           |
| `binding-graph.ts`                                                    | Dependency graph connecting arrow endpoints to target shapes.                                                           |
| `order.ts` / `z-order.ts`                                             | Fractional indexing string generation and layer reordering commands (bring forward, send to back).                      |
| `commands.ts`                                                         | Composite canvas actions: duplicate, group, ungroup, delete with cascade.                                               |
| `hierarchy.ts`                                                        | Parent-child tree traversal for groups and frames.                                                                      |
| `page-names.ts`                                                       | Collision-free page naming (`getIncrementedName`): reuses a trailing counter instead of stacking suffixes.              |
| `clipboard.ts` / `board/clipboard-os.ts`                              | Internal and OS clipboard serialization for shapes, images, and text.                                                   |
| `export-png.tsx` / `png-phys.ts`                                      | Headless SVG-to-Canvas PNG exporter with DPI scaling and physical metadata.                                             |
| `graph-parser.ts` / `graph-sampler.ts` / `graph-intersections.ts`     | 2D graphing engine: parses expressions/parameters, samples curve vertices, computes Newton-Raphson curve intersections. |
| `equation-render.ts` / `equation-source.ts`                           | MathJax display-equation SVG compilation and caching.                                                                   |
| `equation-complete.ts` / `equation-shortcuts.ts`                      | LaTeX command catalog for the panel's autocomplete, plus pure typing edits (auto-brackets, Tab slots, environment rows). |
| `ink-to-latex.ts`                                                     | Handwriting → equation: rasterize the strokes, transcribe them via `/api/ai/latex/ink`, swap ink for a typeset shape in one undo step. |
| `link-url.ts` / `place-image.ts` / `place-link.ts` / `place-video.ts` | Asset drop and paste placement handlers.                                                                                |

#### Canvas Zustand Stores & Hooks

- `use-selection-store.ts` — Selected shape IDs (`selectedIds: string[]`).
- `use-style-store.ts` — Active stroke color, fill style, dash style, stroke size, font settings.
- `use-canvas-ui-store.ts` — Canvas HUD visibility, grid mode, performance stats toggles.
- `use-tool-store.ts` / `use-tool-lock-store.ts` — Active tool ID and tool lock state.
- `use-eraser-store.ts` / `use-eraser-cut-store.ts` — Precision path cutting state.
- `use-eraser-trail-store.ts` — Self-consuming swipe trail (ring buffer, ≤8 points), drawn by `EraserTrail.tsx`.
- `use-comments-store.ts` — Active comment threads.
- `use-documents-store.ts` — Board file attachment drawer, plus which attachments this user hasn't opened yet (`unread`, owned by `board/document-notifications.ts`).
- `use-custom-stickers-store.ts` — User custom sticker library.
- `use-camera-interaction.ts` / `use-wheel.ts` / `use-space-pan.ts` / `use-safari-gestures.ts` — Viewport pan/zoom input handling.

---

### `client/src/canvas/shapes/` — Shape Implementations (`ShapeUtil`)

Every shape implements `ShapeUtil<T>` (registered in `register.ts`):

| Shape Type  | File                                                            | Key Features                                                                                                               |
| ----------- | --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `draw`      | `draw.tsx`, `ink-engine.ts`, `ink-points.ts`, `perfect-dash.ts` | Variable-width ink with Catmull-Rom smoothing, pressure simulation, fill patterns (solid, hatch, crosshatch), dash styles. |
| `rectangle` | `rectangle.tsx`                                                 | Box shape with fills and border dashes.                                                                                    |
| `ellipse`   | `ellipse.tsx`                                                   | Ellipse/circle with fills and border dashes.                                                                               |
| `polygon`   | `polygon.tsx`, `polygon-geometry.ts`                            | Triangle, diamond, trapezoid, pentagon, hexagon.                                                                           |
| `line`      | `line.tsx`, `line-geometry.ts`                                  | Polyline with straight/smooth spline interpolation and center label.                                                       |
| `arrow`     | `arrow.tsx`, `connector-routing.ts`, `connector-handles.ts`     | Straight, arc, or elbow connectors with terminal shape bindings.                                                           |
| `text`      | `text.tsx`, `text-measure.ts`                                   | Auto-width or fixed-width text with font families (`sans`, `serif`, `mono`, `hand`).                                       |
| `image`     | `image.tsx`                                                     | Server blob-backed image with non-destructive fractional cropping.                                                         |
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
| `draw`                  | `draw-tool.ts`                                            | Hotkey `d` / `p` / `b`. Freehand ink drawing with hardware coalesced samples. `createDrawTool(config)` also backs the highlighter.                                                                          |
| `highlighter`           | `draw-tool.ts`                                            | Hotkey `i`. The same freehand state machine laying marker ink: constant width, translucent, stacked under the drawing.                                  |
| `wand`                  | `wand-tool.ts`                                            | Hotkey `w`. Gesture-recognizing pen that auto-converts strokes to neat shapes.                                                                         |
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
| `style-panel.tsx`         | Floating property inspector: stroke color, fill type, stroke width, opacity, font size, align.     |
| `graph-panel.tsx`         | Graph equation list, function curves, slider variables, viewport range bounds.                     |
| `equation-panel.tsx`      | LaTeX source editor: command autocomplete, Quick-LaTeX typing shortcuts, and "describe an equation" generation. |
| `documents-panel.tsx`     | Drawer for uploading, downloading, and viewing board file attachments; carries the unread dot.     |
| `page-menu.tsx`           | Multi-page list switcher, reordering, creation, and deletion.                                      |
| `canvas-context-menu.tsx` | Right-click context menu (Cut, Copy, Paste, Bring to Front, Send to Back, Group, Lock).            |
| `board-notes-dialog.tsx`  | Tutor-only private student notes.                                                                  |
| `board-actions-menu.tsx`  | Board ⋯ menu: dialogs, PNG copy/export + resolution, and all board preferences (theme, snapping, pen, sound, perf overlay). |
| `music/music-player.tsx`  | Whiteboard background music audio player and playlist selector.                                    |

---

### `server/src/` — Backend API, Collab & Database

| File                                                          | Responsibility                                                                                                |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `index.ts`                                                    | HTTP server (Hono) on port 3001, static client file serving, WebSocket upgrade handler.                       |
| `env.ts`                                                      | Validates environment variables (`TUTOR_PASSWORD`, `SESSION_SECRET`, `DATABASE_URL`, `PORT`).                 |
| `db/schema.ts`                                                | Drizzle ORM schema: `boards` (metadata table) and `board_documents` (binary Yjs state table).                 |
| `db/client.ts`                                                | Postgres connection pool using `postgres.js` and Drizzle.                                                     |
| `collab/hocuspocus.ts`                                        | Hocuspocus collaboration server: loads and debounces saves of binary Yjs state to Postgres `board_documents`. |
| `auth/routes.ts` / `auth/jwt.ts` / `auth/password.ts`         | Tutor authentication with constant-time password check and JWT cookies.                                       |
| `boards/routes.ts`                                            | Board CRUD endpoints (`/api/boards`) and tutor notes (`/api/boards/:id/notes`).                               |
| `blobs/routes.ts` / `blobs/store.ts`                          | Content-addressed binary storage (SHA256) for images and custom stickers.                                     |
| `documents/routes.ts` / `documents/store.ts`                  | Board attachment storage with MIME validation (`/api/docs`).                                                  |
| `links/routes.ts` / `links/fetch-remote.ts` / `links/meta.ts` | OpenGraph HTML scraper for link preview cards (downloads images to blob store).                               |
| `ai/routes.ts` / `ai/openrouter.ts` / `ai/latex.ts` | OpenRouter proxy for the two AI LaTeX actions (`/api/ai`). Prompts and reply unwrapping live in `latex.ts`. |
| `music/routes.ts`                                             | Scans `server/data/music` for audio files and serves streaming tracks.                                        |

---

## 4. Developer Recipes for Common Changes

### Recipe 1: Adding a New Shape Type

1. **Define Contract in `shared/src/shapes/`:**
   - In `shapes.ts`, add `MyShapeProps` interface, `MyShape = BaseShape<'myshape', MyShapeProps>`, add `MyShape` to `Shape` union and `ShapeMap`.
2. **Create ShapeUtil in `client/src/canvas/shapes/myshape.tsx`:**
   - Implement `ShapeUtil<'myshape'>` with `getBounds()`, `hitTest()`, `Component()`, and optional `getHandles()` / `onHandleDrag()`.
3. **Register Shape:**
   - In `client/src/canvas/shapes/register.ts`, import `myShapeUtil` and call `shapeRegistry.register(myShapeUtil)`.

### Recipe 2: Adding a New Tool

1. **Create Tool in `client/src/canvas/tools/my-tool.ts`:**
   - Implement `Tool` interface (`id`, `label`, `hotkey`, `cursor`, `icon`, `onPointerDown`, `onPointerMove`, `onPointerUp`).
2. **Register Tool:**
   - In `client/src/canvas/tools/register.ts`, call `toolRegistry.register(createMyTool())`.
3. **Add Toolbar Icon (if applicable):**
   - Add button entry to `client/src/components/toolbar.tsx`.

### Recipe 3: Mutating Canvas Content from a Component or Hook

```typescript
import { editor } from '@/canvas/use-document-store';

// Single mutation
editor.updateShape(shapeId, {
  x: 100,
  y: 200,
  props: { color: '#ef4444' },
});

// Atomic multi-shape mutation (1 undo step, 1 re-render)
editor.transact(() => {
  for (const id of shapeIds) {
    editor.updateShape(id, { opacity: 0.5 });
  }
});
```

### Recipe 4: Converting Coordinates

```typescript
import { screenToWorld, worldToScreen } from '@/canvas/camera';
import { useCameraStore } from '@/canvas/use-camera-store';

const camera = useCameraStore.getState();
const worldPoint = screenToWorld(
  { x: event.clientX, y: event.clientY },
  camera,
);
const screenPoint = worldToScreen(worldPoint, camera);
```

---

## 5. Verification & Test Commands

Run checks before committing any changes:

```bash
npm run check        # Run strict typecheck across shared, client, server + all vitest tests
npm run typecheck    # Strict TypeScript check only
npm test             # Run client & server vitest test suites
npm run build        # Build production bundles
```
