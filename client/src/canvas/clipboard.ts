import type { Shape } from '@whiteboard/shared';
import { collectSubtree, materializeClones } from './commands';
import type { Editor } from './editor';

const PASTE_OFFSET = 16;

// In-app clipboard (deep clones, including container children). Kept in-memory
// rather than the system clipboard so paste works without permissions and
// preserves full shape fidelity. Each paste nudges further so repeats don't
// stack exactly.
let buffer: Shape[] = [];
let roots: string[] = [];
let pasteCount = 0;

/** Copy the given shapes (and their descendants) into the in-app clipboard. */
export function copyShapes(editor: Editor, ids: string[]): void {
  buffer = collectSubtree(editor, ids).map(
    (s) => ({ ...s, props: structuredClone(s.props) }) as Shape,
  );
  roots = [...ids];
  pasteCount = 0;
}

export function hasClipboard(): boolean {
  return buffer.length > 0;
}

/** Paste clipboard contents as new shapes (offset), returning new root ids. */
export function pasteShapes(editor: Editor): string[] {
  if (buffer.length === 0) return [];
  pasteCount += 1;
  return materializeClones(editor, buffer, roots, PASTE_OFFSET * pasteCount, false);
}
