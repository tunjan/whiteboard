# Whiteboard

A real-time collaborative whiteboard for tutoring: a board of pages, each an infinite canvas of shapes that a tutor and students edit together.

## Language

**Page derived state**:
Everything computed from one page's shapes rather than stored: the decoded shapes, their stacking order, the spatial index, the binding graph, and whether the page has any hierarchy or equations.
_Avoid_: Shape cache, page snapshot, page index

**Board record**:
Shared state that belongs to the board rather than to a page and is never undone: a comment thread, a repository document, a custom sticker, the music playback.
_Avoid_: Board-level state, shared map

**Page history**:
The undo and redo steps made on one page. It lives and dies with that page being resident.
_Avoid_: Undo stack, undo manager

**Gesture**:
What one pointer interaction on the canvas is taken to mean: a stroke of the active tool, a pan, a pinch, a zoom, or a context menu.
_Avoid_: Interaction, pointer mode

**Shape interaction**:
The one shape the user is currently inside: text being edited, a frame title being edited, an image being cropped, a video playing, or a stroke being drawn.
_Avoid_: Editing state, active shape
