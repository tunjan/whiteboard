import { genId, type GraphProps, type Shape } from '@whiteboard/shared';
import { graphExpressionsFromImage, UnreadableError } from '@/board/latex-ai';
import { renderShapesForRecognition } from './export-png';
import { createGraphExpression } from './graph-defaults';
import { ensureGraphMath } from './graph-math';
import { reconcileGraphParameters } from './graph-parameters';
import { getTopIndex } from './order';
import { shapeRotatedBounds } from './shape-bounds';
import { GRAPH_DEFAULT_SIZE } from './shapes/graph';
import { shapeRegistry } from './shapes/shape-registry';
import { editor } from './use-document-store';
import { useSelectionStore } from './use-selection-store';

/**
 * Handwritten function → graph: rasterize the selection, have a vision model
 * read it as graph-parser rows, and drop a graph beside the source.
 *
 * Unlike the equation convert this adds rather than swaps — the handwriting is
 * the question and the plot sits next to it. Rows the parser rejects are kept:
 * the graph panel shows their error, and a mis-read is the user's to fix.
 */

/** Gap between the selection and the new graph, in world units. */
const GAP = 24;

/**
 * Resolves true when a graph was created, false when the source was gone by
 * the time the answer came back. Throws with a message fit for a toast.
 */
export async function convertSelectionToGraph(ids: string[]): Promise<boolean> {
  const png = await renderShapesForRecognition(ids);
  if (!png) throw new Error('Nothing to convert');

  let lines: string[];
  try {
    // The parser needs its math library to find slider variables below.
    [lines] = await Promise.all([graphExpressionsFromImage(png), ensureGraphMath()]);
  } catch (error) {
    if (error instanceof UnreadableError) throw new Error('No function found');
    throw error;
  }

  // Re-read after the round trip: a collaborator may have erased the source.
  let minY = Infinity;
  let maxX = -Infinity;
  for (const id of ids) {
    const shape = editor.getShape(id);
    if (!shape) continue;
    const box = shapeRotatedBounds(shape);
    minY = Math.min(minY, box.minY);
    maxX = Math.max(maxX, box.maxX);
  }
  const util = shapeRegistry.get('graph');
  if (maxX === -Infinity || !util) return false;

  const expressions = lines.map((expression, i) => ({
    ...createGraphExpression(i),
    expression,
  }));
  const id = genId();
  const props: GraphProps = {
    ...(util.getDefaultProps() as GraphProps),
    ...GRAPH_DEFAULT_SIZE,
    expressions,
    parameters: reconcileGraphParameters(expressions, {}),
  };
  editor.createShape({
    id,
    type: 'graph',
    x: maxX + GAP,
    y: minY,
    rotation: 0,
    index: getTopIndex(editor.getShapes()),
    props,
  } as Shape);

  useSelectionStore.getState().setSelection([id]);
  return true;
}
