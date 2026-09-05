import { atom, computed, transact, type Atom } from '@tldraw/state';
import { pointsBounds, type Shape, type Point } from '@whiteboard/shared';
import type { Camera } from '../camera';
import { DEFAULT_CAMERA } from '../camera';
import { quantizedCullRegion } from '../geometry';
import { framePolygon } from '../frame-geometry';
import { resolveOpacity } from '../opacity';
import { shapeRegistry } from '../shapes/shape-registry';
import { arrowPoints, curvePoints } from '../shapes/line-geometry';
import type { SpatialIndex } from '../spatial-index';
import { paintOrder } from './paint-order';
import { intersectConvexPolygons, polygonCss } from './clipping';
import {
  inverse,
  matrixCss,
  rotationAt,
  transformPoint,
  type Matrix,
} from './matrix';

function shallowEqual(a: object, b: object) {
  if (a === b) return true;
  const keys = Object.keys(a) as (keyof typeof a)[];
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.is(a[key], b[key]))
  );
}

type RenderShape = Shape & { contentRevision: number };

export function contentEqual(
  a: RenderShape | undefined,
  b: RenderShape | undefined,
): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.id === b.id &&
      a.type === b.type &&
      a.contentRevision === b.contentRevision &&
      shallowEqual(a.props, b.props))
  );
}

/** Existing documents store PAGE coordinates and rotate around geometry centers.
 * Keep that contract at the renderer boundary; parenting must not apply a second
 * transform to coordinates the tools have already moved with their parent. */
function shapeCenter(shape: Shape): Point {
  let bounds;
  if (shape.type === 'draw') bounds = pointsBounds(shape.props.points);
  else if (shape.type === 'arrow')
    bounds = pointsBounds(
      arrowPoints(
        shape.props.points,
        shape.props.topology ??
          (Math.abs(shape.props.bend ?? 0) >= 0.5 ? 'arc' : 'straight'),
        shape.props.bend ?? 0,
      ),
    );
  else if (shape.type === 'line')
    bounds = pointsBounds(
      curvePoints(
        shape.props.points,
        shape.props.bend ?? 0,
        shape.props.spline ?? 'linear',
      ),
    );
  else {
    const b = shapeRegistry.getFor(shape)?.getBounds(shape);
    bounds = b
      ? {
          minX: b.minX - shape.x,
          minY: b.minY - shape.y,
          maxX: b.maxX - shape.x,
          maxY: b.maxY - shape.y,
        }
      : { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  }
  return {
    x: (bounds.minX + bounds.maxX) / 2,
    y: (bounds.minY + bounds.maxY) / 2,
  };
}

export function shapeMatrix(shape: Shape): Matrix {
  if (!shape.rotation) return [1, 0, 0, 1, shape.x, shape.y];
  const center = shapeCenter(shape);
  return rotationAt(shape.x, shape.y, shape.rotation, center.x, center.y);
}

export interface SceneUi {
  hidden: Record<string, boolean>;
  erasing: Record<string, boolean>;
  suppressed: ReadonlySet<string>;
  pinned: ReadonlySet<string>;
}
const EMPTY_UI: SceneUi = {
  hidden: {},
  erasing: {},
  suppressed: new Set(),
  pinned: new Set(),
};

export class SceneNode {
  readonly shape: Atom<Shape | undefined>;
  readonly content;
  readonly presentation;
  readonly z = atom('shape z', 0);
  readonly contentRevision = atom('content revision', 0);
  constructor(
    readonly scene: CanvasScene,
    readonly id: string,
    shape?: Shape,
  ) {
    this.shape = atom<Shape | undefined>(`shape:${id}`, shape);
    this.content = computed(
      `content:${id}`,
      () => {
        const s = this.shape.get();
        return s
          ? ({
              ...s,
              x: 0,
              y: 0,
              rotation: 0,
              contentRevision: this.contentRevision.get(),
            } as RenderShape)
          : undefined;
      },
      { isEqual: contentEqual },
    );
    const center = computed(
      `center:${id}`,
      () => {
        const s = this.content.get();
        return s ? shapeCenter(s) : { x: 0, y: 0 };
      },
      { isEqual: shallowEqual },
    );
    this.presentation = computed(
      `presentation:${id}`,
      () => {
        const s = this.shape.get();
        if (!s)
          return {
            transform: '',
            clipPath: 'none',
            opacity: '0',
            visibility: 'hidden',
          };
        const ui = scene.ui.get();
        const getShape = (id: string) => scene.record(id).shape.get();
        let mask: Point[] | null = null;
        let hidden = !!ui.hidden[s.id] || !!s.hidden;
        const seen = new Set([s.id]);
        let parentId = s.parentId;
        while (parentId && !seen.has(parentId)) {
          seen.add(parentId);
          const parent = getShape(parentId);
          if (!parent) break;
          hidden ||= !!ui.hidden[parent.id] || !!parent.hidden;
          // Existing connectors deliberately escape frame masks.
          if (parent.type === 'frame' && s.type !== 'arrow') {
            const polygon = framePolygon(parent);
            mask =
              mask === null ? polygon : intersectConvexPolygons(mask, polygon);
          }
          parentId = parent.parentId;
        }
        const pivot = s.rotation ? center.get() : { x: 0, y: 0 };
        const matrix = rotationAt(s.x, s.y, s.rotation, pivot.x, pivot.y);
        const inverted = mask === null ? null : inverse(matrix);
        const localMask =
          mask === null ? null : mask.map((p) => transformPoint(inverted!, p));
        return {
          transform: matrixCss(matrix),
          clipPath: polygonCss(localMask),
          opacity: String(
            resolveOpacity(s, getShape, (id) => !!ui.erasing[id]),
          ),
          visibility: hidden || ui.suppressed.has(s.id) ? 'hidden' : 'visible',
        };
      },
      { isEqual: shallowEqual },
    );
  }
}

/** Per-record signals isolate content and transforms; only topology changes
 * publish a new id list. Culling has a single observer for the entire page. */
export class CanvasScene {
  private records = new Map<string, SceneNode>();
  readonly ids = atom<readonly string[]>('render ids', []);
  readonly camera = atom<Camera>('camera', DEFAULT_CAMERA);
  readonly viewport = atom('viewport', { width: 0, height: 0 });
  readonly boundsEpoch = atom('bounds epoch', 0);
  private readonly children = atom(
    'scene children',
    new Map<string, string[]>(),
  );
  readonly ui = atom<SceneUi>('scene ui', EMPTY_UI);
  readonly visible;

  constructor(readonly index: SpatialIndex) {
    const region = computed(
      'cull region',
      () => {
        const { width, height } = this.viewport.get();
        return quantizedCullRegion(this.camera.get(), width, height);
      },
      { isEqual: shallowEqual },
    );
    this.visible = computed('visible shapes', () => {
      this.boundsEpoch.get();
      const { width, height } = this.viewport.get();
      const ui = this.ui.get();
      if (!width || !height) return new Set(this.ids.get());
      const ids = new Set(index.search(region.get()));
      const children = this.children.get();
      const stack = [...ui.pinned],
        pinned = new Set<string>();
      while (stack.length) {
        const id = stack.pop()!;
        if (pinned.has(id)) continue;
        pinned.add(id);
        ids.add(id);
        for (const child of children.get(id) ?? []) stack.push(child);
      }
      return ids;
    });
  }

  record(id: string): SceneNode {
    let node = this.records.get(id);
    if (!node) {
      node = new SceneNode(this, id);
      this.records.set(id, node);
    }
    return node;
  }

  apply(
    shapes: ReadonlyMap<string, Shape>,
    changed: ReadonlySet<string> | null,
    contentIds?: ReadonlySet<string> | null,
  ): void {
    transact(() => {
      const ids =
        changed ?? new Set([...this.records.keys(), ...shapes.keys()]);
      let topologyChanged = changed === null;
      let membershipChanged = changed === null;
      for (const id of ids) {
        const node = this.record(id);
        const prev = node.shape.get(),
          next = shapes.get(id);
        membershipChanged ||= !!prev !== !!next || prev?.type !== next?.type;
        topologyChanged ||=
          !prev ||
          !next ||
          prev.index !== next.index ||
          prev.parentId !== next.parentId;
        node.shape.set(next);
        if (changed === null || contentIds?.has(id))
          node.contentRevision.update((n) => n + 1);
      }
      if (membershipChanged) {
        const nextIds = [...shapes.values()]
          .filter((s) => s.type !== 'group')
          .map((s) => s.id)
          .sort();
        const previous = this.ids.get();
        if (
          previous.length !== nextIds.length ||
          previous.some((id, i) => id !== nextIds[i])
        )
          this.ids.set(nextIds);
      }
      if (topologyChanged) this.updateOrder(shapes);
      this.boundsEpoch.update((n) => n + 1);
    });
  }

  private updateOrder(shapes: ReadonlyMap<string, Shape>) {
    const children = new Map<string, string[]>();
    for (const shape of shapes.values())
      if (shape.parentId) {
        const bucket = children.get(shape.parentId) ?? [];
        bucket.push(shape.id);
        children.set(shape.parentId, bucket);
      }
    this.children.set(children);
    let z = 0;
    for (const shape of paintOrder(shapes)) this.record(shape.id).z.set(++z);
  }
}
