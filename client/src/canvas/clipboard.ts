import { genId, unionBounds, type Point, type Shape } from '@whiteboard/shared';
import { collectSubtree, materializeClones } from './commands';
import type { Editor } from './editor';
import { shapeRotatedBounds } from './shape-bounds';

const PASTE_OFFSET = 16;

// In-app clipboard (deep clones, including container children). Kept in-memory
// rather than the system clipboard so paste works without permissions and
// preserves full shape fidelity. Each paste nudges further so repeats don't
// stack exactly (only used when no explicit paste point is given).
let buffer: Shape[] = [];
let roots: string[] = [];
let pasteCount = 0;
// Tag written into the OS clipboard (see clipboard-os.ts) so paste can tell our
// own copy apart from a foreign/stale clipboard. Regenerated on every copy.
let token = '';

/** Copy the given shapes (and their descendants) into the in-app clipboard. */
export function copyShapes(editor: Editor, ids: string[]): void {
  buffer = collectSubtree(editor, ids).map(
    (s) => ({ ...s, props: structuredClone(s.props) }) as Shape,
  );
  roots = [...ids];
  pasteCount = 0;
  token = genId();
}

export function hasClipboard(): boolean {
  return buffer.length > 0;
}

/** Tag identifying the current in-app copy; mirrored into the OS clipboard. */
export function clipboardToken(): string {
  return token;
}

/** HTML payload stamped into the OS clipboard to mark an in-app copy. */
export function wbClipHtml(tok: string): string {
  return `<div data-wb-clip="${tok}"></div>`;
}

/** Extract the in-app copy token from an OS clipboard `text/html` payload. */
export function wbClipToken(html: string): string | null {
  return /data-wb-clip="([^"]+)"/.exec(html)?.[1] ?? null;
}

/**
 * Paste clipboard contents as new shapes, returning new root ids. With `at`,
 * the copied content's bounding-box center lands there (paste-at-cursor);
 * without it, each paste nudges further from the original.
 */
export function pasteShapes(editor: Editor, at?: Point): string[] {
  if (buffer.length === 0) return [];
  if (at) {
    const center = contentCenter();
    const offset = center
      ? { x: at.x - center.x, y: at.y - center.y }
      : { x: 0, y: 0 };
    return materializeClones(editor, buffer, roots, offset, false);
  }
  pasteCount += 1;
  const d = PASTE_OFFSET * pasteCount;
  return materializeClones(editor, buffer, roots, { x: d, y: d }, false);
}

/** Center of the copied content's world bounds (groups have no geometry). */
function contentCenter(): Point | null {
  let bounds = null as ReturnType<typeof shapeRotatedBounds> | null;
  for (const s of buffer) {
    if (s.type === 'group') continue;
    const b = shapeRotatedBounds(s);
    bounds = bounds ? unionBounds(bounds, b) : b;
  }
  if (!bounds) return null;
  return { x: (bounds.minX + bounds.maxX) / 2, y: (bounds.minY + bounds.maxY) / 2 };
}
