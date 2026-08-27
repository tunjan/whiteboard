import {
  genId,
  unionBounds,
  type Bounds,
  type EquationProps,
  type Shape,
} from '@whiteboard/shared';
import { latexFromInk } from '@/board/latex-ai';
import { deleteShapesWithCleanup } from './commands';
import { typesetEquation } from './equation-render';
import { requestEquationFocus } from './equation-focus';
import { renderShapesForRecognition } from './export-png';
import { getTopIndex } from './order';
import { shapeRotatedBounds } from './shape-bounds';
import {
  EQUATION_DEFAULT_FONT_SIZE,
  EQUATION_DEFAULT_SIZE,
  equationBoxSize,
  equationFontSizeForHeight,
} from './shapes/equation';
import { DEFAULT_SHAPE_STYLE } from './shapes/style';
import { editor } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

/**
 * Handwriting → equation: rasterize the strokes, have a vision model transcribe
 * them, and swap the ink for the typeset result.
 *
 * The swap is the whole point of the feature, so it is one transaction: a
 * single Ctrl+Z puts the handwriting back, rather than stepping through a
 * delete and a create the user never performed separately.
 */

/**
 * The strokes this action applies to, or null when the selection is not ink.
 *
 * Every selected shape has to be freehand: "convert this to an equation" has no
 * clear meaning for a selection that also holds a rectangle or an image, and
 * silently ignoring the rest would delete work the user could see was included.
 * Highlighter strokes are ordinary `draw` shapes and are accepted — a wash over
 * a line of working is translucent, so it rasterizes the way a reader sees it.
 */
export function inkStrokeIds(ids: readonly string[]): string[] | null {
  if (ids.length === 0) return null;
  for (const id of ids) {
    if (editor.getShape(id)?.type !== 'draw') return null;
  }
  return [...ids];
}

/** Combined world bounds of the strokes being replaced. */
function inkBounds(ids: string[]): Bounds | null {
  let bounds: Bounds | null = null;
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    const box = shapeRotatedBounds(shape);
    bounds = bounds ? unionBounds(bounds, box) : box;
  }
  return bounds;
}

/**
 * Bounds on the size the transcription is set at, matching the smallest and
 * largest presets in the equation panel's own size control (`FONT_SIZES` in
 * `equation-panel.tsx`).
 *
 * A one-to-one height match sounds exact but isn't: MathJax renders a fraction
 * tightly (numerator, bar, denominator in well under 3x a single line's
 * height), while a hand-drawn one rarely is — so an entirely ordinary two-line
 * formula already asks for a fontSize past anything selectable by hand. The
 * clamp is the fix, not a rounding of the estimate: a transcription should
 * never come out bigger than a user could have chosen for it themselves.
 */
const MIN_FONT_SIZE = 16;
const MAX_FONT_SIZE = 40;

/**
 * Where and how big the equation goes.
 *
 * Matched to the ink's *height* rather than its width, which is what makes the
 * swap read as a transcription: handwriting is far wider than typeset maths
 * saying the same thing, so matching widths would set the formula in giant
 * type. Centred on the ink, because the formula stands in for it and should not
 * drift to a corner of the space the handwriting occupied.
 */
export function placement(
  render: { width: number; height: number },
  bounds: Bounds,
): { x: number; y: number; fontSize: number; w: number; h: number } {
  const fontSize = Math.min(
    MAX_FONT_SIZE,
    Math.max(
      MIN_FONT_SIZE,
      equationFontSizeForHeight(render, bounds.maxY - bounds.minY),
    ),
  );
  const { w, h } = equationBoxSize(render, fontSize);
  return {
    x: (bounds.minX + bounds.maxX) / 2 - w / 2,
    y: (bounds.minY + bounds.maxY) / 2 - h / 2,
    fontSize,
    w,
    h,
  };
}

/**
 * Replace `ids` with an equation shape carrying `latex`.
 *
 * The strokes are re-read here rather than captured before the request: the
 * round trip takes seconds, and a collaborator may have erased or moved the ink
 * meanwhile. All gone means the conversion is abandoned — dropping an equation
 * onto a board where the handwriting no longer is would be a mystery.
 */
async function swapInkForEquation(
  ids: string[],
  latex: string,
  color: string,
): Promise<boolean> {
  // Typeset before writing anything, so the equation lands already sized. The
  // shape's box is a cache of its render: created at the default size, it would
  // flash a 120×48 placeholder onto every collaborator's canvas first.
  const render = await typesetEquation(latex).catch(() => null);

  const bounds = inkBounds(ids);
  const live = ids.filter((id) => editor.getShape(id));
  if (!bounds || live.length === 0) return false;

  const box =
    render && !('error' in render)
      ? placement(render, bounds)
      : {
          // A transcription MathJax rejects still gets placed — the panel opens
          // on it and the error is the user's to fix, which beats discarding an
          // answer that is usually one stray brace away from right.
          x: (bounds.minX + bounds.maxX) / 2 - EQUATION_DEFAULT_SIZE.w / 2,
          y: (bounds.minY + bounds.maxY) / 2 - EQUATION_DEFAULT_SIZE.h / 2,
          fontSize: EQUATION_DEFAULT_FONT_SIZE,
          ...EQUATION_DEFAULT_SIZE,
        };

  const id = genId();
  const props: EquationProps = {
    latex,
    color,
    fontSize: box.fontSize,
    w: box.w,
    h: box.h,
  };
  editor.transact(() => {
    // Delete first: the cleanup prunes any group the ink emptied, and it reads
    // the page through a cache that would not yet see a shape created above it.
    // The equation is created unparented either way, exactly as the equation
    // tool creates one — a frame claims it when it is next moved.
    deleteShapesWithCleanup(editor, live);
    editor.createShape({
      id,
      type: 'equation',
      x: box.x,
      y: box.y,
      rotation: 0,
      index: getTopIndex(editor.getShapes()),
      props,
    } as Shape);
  });

  useSelectionStore.getState().setSelection([id]);
  // Open the equation panel on the result: a transcription is a draft, and the
  // first thing anyone does with one is check it.
  requestEquationFocus(id);
  return true;
}

/**
 * The whole conversion. Resolves true when an equation replaced the ink, false
 * when there was nothing left to replace by the time the answer came back.
 * Throws with a message fit for a toast on any failure.
 */
export async function convertInkToEquation(ids: string[]): Promise<boolean> {
  // The transcription inherits the pen it was written with, so a formula
  // written in red comes back typeset in red.
  const first = editor.getShape(ids[0]!);
  const color =
    first?.type === 'draw' ? first.props.color : DEFAULT_SHAPE_STYLE.color;

  const png = await renderShapesForRecognition(ids);
  if (!png) throw new Error('Nothing to convert');

  return swapInkForEquation(ids, await latexFromInk(png), color);
}
