import type { Bounds, Shape, Vec } from '@whiteboard/shared';
import { unionBounds } from '@whiteboard/shared';
import { collectSubtree } from './commands';
import type { Editor, ShapePatch } from './editor';
import { selectionRoots } from './frame-operations';
import { shapeRotatedBounds } from './shape-bounds';
import { shapeRegistry } from './shapes/shape-registry';

/** Which way the selection is mirrored: `horizontal` swaps left and right. */
export type FlipAxis = 'horizontal' | 'vertical';

/**
 * What mirroring does to one shape beyond moving it.
 *
 * Mirroring a shape is `T(mirrored centre) ∘ R(-rotation) ∘ (mirrored local
 * geometry)` — a mirror reverses orientation, so the rotation negates and
 * whatever asymmetry the shape carries in its own frame has to be reversed too.
 * `props` is that local mirror; `turn` is the extra half turn a shape needs when
 * its local mirror can only be expressed as one (see the polygon case); and
 * `keepRotation` opts a shape out of turning at all.
 */
interface LocalMirror {
  props?: Record<string, unknown>;
  turn?: boolean;
  keepRotation?: boolean;
}

/** Mirror a path's local points. The axis choice is free — `x → -x` is fine
 * because the caller re-derives the position from the resulting bounds. */
function mirrorPoints<T extends Vec>(points: T[], horizontal: boolean): T[] {
  return points.map((p) => ({
    ...p,
    ...(horizontal ? { x: -p.x } : { y: -p.y }),
  }));
}

/**
 * Mirror a bound terminal's anchor, which is normalized inside the target's
 * unrotated box: the point at 20% across a box is at 80% across its mirror.
 * Only targets being flipped alongside the connector move, so a terminal bound
 * to a shape outside the selection keeps the anchor it has.
 */
function mirrorBindings(
  bindings: NonNullable<Extract<Shape, { type: 'arrow' }>['props']['bindings']>,
  horizontal: boolean,
  flipped: ReadonlySet<string>,
): NonNullable<Extract<Shape, { type: 'arrow' }>['props']['bindings']> {
  const out = { ...bindings };
  for (const terminal of ['start', 'end'] as const) {
    const binding = out[terminal];
    if (!binding || !flipped.has(binding.shapeId)) continue;
    out[terminal] = {
      ...binding,
      anchor: horizontal
        ? { ...binding.anchor, x: 1 - binding.anchor.x }
        : { ...binding.anchor, y: 1 - binding.anchor.y },
    };
  }
  return out;
}

function localMirror(
  shape: Shape,
  horizontal: boolean,
  flipped: ReadonlySet<string>,
): LocalMirror {
  switch (shape.type) {
    case 'draw':
      return {
        props: {
          // Tilt is the direction the barrel leans, so it mirrors with the ink.
          points: shape.props.points.map((p) => ({
            ...p,
            ...(horizontal
              ? {
                  x: -p.x,
                  ...(p.tiltX === undefined ? null : { tiltX: -p.tiltX }),
                }
              : {
                  y: -p.y,
                  ...(p.tiltY === undefined ? null : { tiltY: -p.tiltY }),
                }),
          })),
        },
      };

    case 'line':
      return {
        props: {
          points: mirrorPoints(shape.props.points, horizontal),
          // `bend` offsets the apex along the chord's perpendicular. Mirroring
          // reverses which side that perpendicular points to, so the stored
          // offset has to reverse with it to keep the same apex.
          bend: -(shape.props.bend ?? 0),
        },
      };

    case 'arrow':
      return {
        props: {
          points: mirrorPoints(shape.props.points, horizontal),
          bend: -(shape.props.bend ?? 0),
          ...(shape.props.bindings
            ? {
                bindings: mirrorBindings(
                  shape.props.bindings,
                  horizontal,
                  flipped,
                ),
              }
            : null),
        },
      };

    // Every polygon kind is symmetric about its own vertical axis, so a
    // left-right mirror is already the shape it has. That symmetry is also what
    // lets the up-down mirror be a half turn: mirroring in y is mirroring in x
    // then turning 180°, and the first half is a no-op here.
    case 'polygon':
      return { turn: !horizontal };

    // Content that is read rather than drawn. A mirrored label or a reversed
    // photograph is never what a flip was asking for, so these keep their
    // rotation and only their box moves.
    case 'text':
    case 'equation':
    case 'image':
    case 'video':
    case 'bookmark':
    case 'sticker':
    case 'graph':
      return { keepRotation: true };

    // Rectangles, ellipses, frames and groups carry no asymmetry of their own.
    default:
      return {};
  }
}

/** A local mirror reverses no bindings when nothing else is being flipped. */
const NOTHING_FLIPPED: ReadonlySet<string> = new Set();

/**
 * `shape` with its own geometry mirrored about one of its *local* axes, keeping
 * the page rotation it has.
 *
 * This is the mirror a resize handle dragged past its anchor asks for: the box
 * turns inside out along an axis of the shape's own frame, which is the frame
 * the handle runs in. `flipShapes` mirrors about a *page* axis instead, and has
 * to negate the rotation to say the same thing.
 *
 * Content that is read rather than drawn carries no local mirror, so its box
 * turns over and the content does not — the rule a flip command already
 * follows, and the reason a reversed photograph never falls out of a resize.
 */
export function mirrorShapeLocally(shape: Shape, horizontal: boolean): Shape {
  const { props, turn } = localMirror(shape, horizontal, NOTHING_FLIPPED);
  if (!props && !turn) return shape;
  return {
    ...shape,
    ...(props ? { props: { ...shape.props, ...props } } : null),
    // A polygon is symmetric about its own vertical axis, so its local mirror
    // in y is the half turn that mirror is equivalent to.
    ...(turn ? { rotation: shape.rotation + Math.PI } : null),
  } as Shape;
}

/**
 * Mirror the selection across the centre of its own bounding box, in one undo
 * step. Locked roots are left alone; a locked child still follows its unlocked
 * container, as it does for a nudge or a drag.
 *
 * Bound connectors resolve their terminals from their targets on the next
 * mutation, so the anchors are what has to be mirrored — the endpoint follows.
 */
export function flipShapes(
  editor: Editor,
  ids: string[],
  axis: FlipAxis,
): void {
  const roots = selectionRoots(editor, ids).filter(
    (id) => !editor.getShape(id)?.locked,
  );
  if (roots.length === 0) return;
  // A group has no geometry of its own — its box is derived from its children
  // and its rotation is ignored everywhere — so it is neither mirrored nor
  // allowed to drag the mirror line towards its degenerate origin.
  const subtree = collectSubtree(editor, roots).filter(
    (s) => s.type !== 'group',
  );
  if (subtree.length === 0) return;

  let union: Bounds | null = null;
  for (const shape of subtree) {
    const b = shapeRotatedBounds(shape);
    union = union ? unionBounds(union, b) : b;
  }
  if (!union) return;

  const horizontal = axis === 'horizontal';
  // Twice the mirror line, which is all the reflection below needs.
  const twiceAxis = horizontal
    ? union.minX + union.maxX
    : union.minY + union.maxY;
  const flipped = new Set(subtree.map((s) => s.id));

  editor.transact(() => {
    for (const shape of subtree) {
      const util = shapeRegistry.getFor(shape);
      if (!util) continue;
      const { props, turn, keepRotation } = localMirror(
        shape,
        horizontal,
        flipped,
      );
      const before = util.getBounds(shape as never);
      // Where the local mirror left the shape, before it is moved. Deriving the
      // move from the mirrored geometry's own bounds keeps the two in step
      // whatever a shape chose to do above — including doing nothing.
      const after = props
        ? util.getBounds({
            ...shape,
            props: { ...shape.props, ...props },
          } as never)
        : before;
      const patch: ShapePatch = props ? { props } : {};
      if (horizontal)
        patch.x = shape.x + (twiceAxis - before.maxX) - after.minX;
      else patch.y = shape.y + (twiceAxis - before.maxY) - after.minY;
      if (!keepRotation) {
        patch.rotation = -(shape.rotation ?? 0) + (turn ? Math.PI : 0);
      }
      editor.updateShape(shape.id, patch);
    }
  });
}
