import type { TextProps } from '@whiteboard/shared';
import { collectSubtree } from './commands';
import type { Editor, ShapePatch } from './editor';
import { shapeRegistry } from './shapes/shape-registry';
import { stabilizeTextPosition } from './shapes/text-measure';

/**
 * The properties a copied style carries: appearance, and nothing that is really
 * geometry. A connector's topology and a line's spline are routing decisions
 * (changing one rewrites the point list), and a text's font *size* is set by
 * dragging its box — none of them belong in a paste that is supposed to restyle
 * a shape without moving it. What is left is exactly the vocabulary the style
 * bar governs, plus shape-level opacity, which is handled separately.
 */
const STYLE_PROPS = [
  'color',
  'size',
  'fillStyle',
  'dash',
  'fontFamily',
  'fontWeight',
  'align',
  'arrowStart',
  'arrowEnd',
] as const;

interface CopiedStyle {
  props: Record<string, unknown>;
  opacity: number | undefined;
}

let copied: CopiedStyle | null = null;

/** Whether a style has been copied this session (a paste target exists). */
export function hasCopiedStyle(): boolean {
  return copied !== null;
}

/**
 * Copy the style of the first selected shape. Only the properties it actually
 * carries are taken, so copying from a pen stroke and pasting onto a text does
 * not hand the text a `fillStyle` it has no use for.
 */
export function copyStyle(editor: Editor, ids: string[]): void {
  const shape = ids.length ? editor.getShape(ids[0]!) : undefined;
  if (!shape) return;
  const source = shape.props as Record<string, unknown>;
  const props: Record<string, unknown> = {};
  for (const key of STYLE_PROPS) {
    if (source[key] !== undefined) props[key] = source[key];
  }
  copied = { props, opacity: shape.opacity };
}

/**
 * Apply the copied style to the selection, in one undo step.
 *
 * A property lands on a shape only when that shape's type declares it in its
 * default props — the registry already answers "does this shape have a fill?",
 * so there is no second table here to fall out of step with the shape
 * definitions. Containers declare no style props and are skipped by the same
 * rule, while their children are reached through the subtree: selecting a group
 * means the shapes in it.
 *
 * Deliberately does not touch the style new shapes inherit. The pen follows the
 * controls the user moved (see `use-style-store.ts`); restyling a selection is
 * not a statement about what to draw next.
 */
export function pasteStyle(editor: Editor, ids: string[]): void {
  if (!copied) return;
  const { props: style, opacity } = copied;
  editor.transact(() => {
    for (const shape of collectSubtree(editor, ids)) {
      if (shape.locked) continue;
      const carries = shapeRegistry.getFor(shape)?.getDefaultProps() as
        Record<string, unknown> | undefined;
      if (!carries) continue;
      const props: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(style)) {
        if (key in carries) props[key] = value;
      }
      const hasProps = Object.keys(props).length > 0;
      if (!hasProps && opacity === undefined) continue;
      const patch: ShapePatch = {};
      if (hasProps) patch.props = props;
      if (opacity !== undefined) patch.opacity = opacity;
      // A restyled text box grows about its anchored edge and its middle rather
      // than pushing right and down — the same correction the style bar makes.
      if (shape.type === 'text' && hasProps) {
        const next = { ...shape.props, ...props } as TextProps;
        const point = stabilizeTextPosition(shape, next);
        patch.x = point.x;
        patch.y = point.y;
      }
      editor.updateShape(shape.id, patch);
    }
  });
}
