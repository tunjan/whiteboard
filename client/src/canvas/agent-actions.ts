import {
  AGENT_COLORS,
  MAX_AGENT_SUMMARY_SHAPES,
  genId,
  type AgentAction,
  type AgentAlign,
  type AgentArrowEnd,
  type AgentBoardSummary,
  type AgentColor,
  type AgentShapeSummary,
  type Point,
  type Shape,
} from '@whiteboard/shared';
import { generateSticker } from '@/board/custom-stickers';
import { alignShapes, distributeShapes, type AlignEdge } from './align';
import { useThemeStore } from '@/use-theme-store';
import { screenToWorld } from './camera';
import { deleteShapesWithCleanup, groupShapes } from './commands';
import type { Editor } from './editor';
import { typesetEquation } from './equation-render';
import { renderShapesForRecognition } from './export-png';
import { createGraphExpression } from './graph-defaults';
import { captureEnclosedShapes } from './frame-operations';
import { getBottomIndex, getTopIndex, jitterKeyBetween } from './order';
import { shapeRotatedBounds } from './shape-bounds';
import { bindingForPoint } from './shapes/connector-routing';
import { EQUATION_DEFAULT_FONT_SIZE, equationBoxSize } from './shapes/equation';
import { shapeRegistry } from './shapes/shape-registry';
import { customStickerSize } from './shapes/sticker';
import { useCameraStore } from './use-camera-store';
import { breakUndoCapture } from './use-document-store';
import { useSelectionStore } from './use-selection-store';
import { nextShapeStyle, paletteColors } from './use-style-store';
import { useToolStore } from './use-tool-store';

/**
 * The board agent's two ends on the client: what the model is told about the
 * page in view, and how the actions it answers with land on it.
 *
 * Every action is applied in one `transact`, so a whole instruction syncs as
 * one update and undoes as one step — except generated stickers, which wait
 * on the image model and the cut-out review and land as a step each. Actions are re-checked here against the
 * page as it is now — the request took seconds, and a collaborator may have
 * erased a shape the model was told about — and anything that no longer fits
 * is skipped rather than thrown.
 */

const round = (n: number) => Math.round(n);

/**
 * The screen band the chrome leaves free: below the top clusters, above the
 * toolbar. They are the elements that arrive from an edge (`data-arrive`); a
 * tall one (an open answer) is a passing overlay, not a band.
 */
function freeBand(): { top: number; bottom: number } {
  const h = window.innerHeight;
  let top = 0;
  let bottom = h;
  // No DOM in the node test environment: the whole window is free.
  if (typeof document === 'undefined') return { top, bottom };
  for (const el of document.querySelectorAll<HTMLElement>('[data-arrive]')) {
    const r = el.getBoundingClientRect();
    if (!r.height || r.height > h * 0.3) continue;
    if (el.dataset.arrive === 'down') top = Math.max(top, r.bottom);
    else if (el.dataset.arrive === 'up') bottom = Math.min(bottom, r.top);
  }
  return bottom - top > h / 3 ? { top, bottom } : { top: 0, bottom: h };
}

/** The world rectangle in view, minus the chrome over its edges. */
function viewRect(): AgentBoardSummary['viewport'] {
  const { camera } = useCameraStore.getState();
  const { top, bottom } = freeBand();
  const a = screenToWorld({ x: 0, y: top }, camera);
  const b = screenToWorld({ x: window.innerWidth, y: bottom }, camera);
  return { x: round(a.x), y: round(a.y), w: round(b.x - a.x), h: round(b.y - a.y) };
}

function contentOf(shape: Shape): Partial<AgentShapeSummary> {
  switch (shape.type) {
    case 'text':
      return { content: shape.props.text };
    case 'equation':
      return { content: shape.props.latex };
    case 'sticker':
      return { content: shape.props.sticker };
    case 'frame':
      return { content: shape.props.name };
    case 'line':
    case 'arrow':
      return shape.props.label ? { content: shape.props.label } : {};
    case 'graph':
      return { expressions: shape.props.expressions.map((e) => e.expression) };
    default:
      return {};
  }
}

/** The page in view as the model sees it: nearest the view centre first. */
export function boardSummary(editor: Editor): AgentBoardSummary {
  const viewport = viewRect();
  const cx = viewport.x + viewport.w / 2;
  const cy = viewport.y + viewport.h / 2;
  const all = editor.getShapes().map((shape): AgentShapeSummary & { d: number } => {
    const b = shapeRotatedBounds(shape);
    const props = shape.props as { color?: unknown };
    return {
      id: shape.id,
      type: shape.type,
      x: round(b.minX),
      y: round(b.minY),
      w: round(b.maxX - b.minX),
      h: round(b.maxY - b.minY),
      ...(typeof props.color === 'string' ? { color: props.color } : {}),
      ...contentOf(shape),
      ...(shape.parentId ? { parentId: shape.parentId } : {}),
      d: Math.hypot((b.minX + b.maxX) / 2 - cx, (b.minY + b.maxY) / 2 - cy),
    };
  });
  const shapes = all
    .sort((p, q) => p.d - q.d)
    .slice(0, MAX_AGENT_SUMMARY_SHAPES)
    .map(({ d: _d, ...shape }) => shape);
  return {
    viewport,
    selection: useSelectionStore.getState().selectedIds,
    shapes,
    omitted: all.length - shapes.length,
  };
}

/**
 * The picture the agent asks for with `look_at_board`: the selection, or
 * every shape in view when nothing is selected. Null when there is nothing.
 */
export function pictureForAgent(editor: Editor): Promise<Blob | null> {
  return renderShapesForRecognition(pictureScope(editor));
}

/** What a picture would show: the selection, else every shape in view. */
function pictureScope(editor: Editor): string[] {
  const selected = useSelectionStore.getState().selectedIds;
  if (selected.length) return selected;
  const view = viewRect();
  return editor
    .getShapes()
    .filter((shape) => {
      const b = shapeRotatedBounds(shape);
      return b.maxX >= view.x && b.minX <= view.x + view.w && b.maxY >= view.y && b.minY <= view.y + view.h;
    })
    .map((shape) => shape.id);
}

/**
 * Whether the model will need the picture whatever it is asked: the summary
 * has no words for handwriting or images, so it would only ask to look and
 * cost a second round trip. Sent up front instead.
 */
// ponytail: also sent for "add a circle" beside handwriting; ~1.5k image tokens. Gate on the instruction if the bill shows it.
export function agentNeedsPicture(editor: Editor): boolean {
  const scope = pictureScope(editor);
  const ids = new Set(scope);
  // A selected group or frame counts by what is inside it.
  return editor.getShapes().some(
    (shape) =>
      (ids.has(shape.id) || (!!shape.parentId && ids.has(shape.parentId))) &&
      (shape.type === 'draw' || shape.type === 'image'),
  );
}

/**
 * A colour name in the current theme. `AGENT_COLORS` is in palette slot order,
 * so slot 0 — the ink — is black on a light canvas and white on a dark one.
 */
export function colorOf(name: AgentColor | undefined, fallback: string): string {
  if (!name) return fallback;
  return paletteColors(useThemeStore.getState().theme)[AGENT_COLORS.indexOf(name)]?.value ?? fallback;
}

const ALIGN_EDGES: Record<Exclude<AgentAlign, `distribute-${string}`>, AlignEdge> = {
  left: 'left',
  center: 'centerX',
  right: 'right',
  top: 'top',
  middle: 'centerY',
  bottom: 'bottom',
};

/** Shapes typeset before the transaction opens, keyed by LaTeX source. */
type Renders = Map<string, { width: number; height: number } | null>;

async function typesetAll(actions: AgentAction[]): Promise<Renders> {
  const sources = new Set<string>();
  for (const a of actions) {
    if (a.type === 'create_equation') sources.add(a.latex);
    if (a.type === 'update_shape' && a.latex) sources.add(a.latex);
  }
  const renders: Renders = new Map();
  await Promise.all(
    [...sources].map(async (latex) => {
      const render = await typesetEquation(latex).catch(() => null);
      renders.set(latex, render && !('error' in render) ? render : null);
    }),
  );
  return renders;
}

function equationBox(renders: Renders, latex: string, fontSize: number) {
  const render = renders.get(latex);
  return render ? equationBoxSize(render, fontSize) : { w: 120, h: 48 };
}

/** A point for an arrow end: as given, or the centre of the shape named. */
function endPoint(editor: Editor, end: AgentArrowEnd): Point | null {
  if ('x' in end) return end;
  const shape = editor.getShape(end.shapeId);
  if (!shape) return null;
  const b = shapeRotatedBounds(shape);
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** Move a shape by a delta; a group's own origin is unused, so its children move. */
function translate(editor: Editor, id: string, dx: number, dy: number): void {
  const shape = editor.getShape(id);
  if (!shape) return;
  if (shape.type !== 'group') {
    editor.updateShape(id, { x: shape.x + dx, y: shape.y + dy });
    return;
  }
  for (const child of editor.getShapes()) {
    if (child.parentId === id) translate(editor, child.id, dx, dy);
  }
}

function update(
  editor: Editor,
  action: Extract<AgentAction, { type: 'update_shape' }>,
  renders: Renders,
): void {
  const shape = editor.getShape(action.id);
  if (!shape) return;
  const b = shapeRotatedBounds(shape);
  if (action.x !== undefined || action.y !== undefined) {
    translate(editor, shape.id, (action.x ?? b.minX) - b.minX, (action.y ?? b.minY) - b.minY);
  }

  const props: Record<string, unknown> = {};
  const current = shape.props as Record<string, unknown>;
  if (action.color && 'color' in current) {
    props.color = colorOf(action.color, current.color as string);
  }
  if (shape.type === 'text') {
    if (action.text !== undefined) props.text = action.text;
    if (action.fontSize) props.fontSize = action.fontSize;
    if (action.w) Object.assign(props, { width: action.w, sizingMode: 'fixed' });
  } else if (shape.type === 'equation') {
    if (action.latex !== undefined || action.fontSize) {
      const latex = action.latex ?? shape.props.latex;
      const fontSize = action.fontSize ?? shape.props.fontSize;
      const k = fontSize / shape.props.fontSize;
      // A resize alone was never typeset: its box is the old one, scaled.
      const box =
        action.latex === undefined
          ? { w: shape.props.w * k, h: shape.props.h * k }
          : equationBox(renders, latex, fontSize);
      Object.assign(props, { latex, fontSize, ...box });
    }
  } else if (shape.type === 'graph' && action.expressions) {
    props.expressions = action.expressions.map((expression, i) => ({
      ...createGraphExpression(i),
      expression,
    }));
  }
  if (action.fillStyle && 'fillStyle' in current) props.fillStyle = action.fillStyle;
  if ('w' in current && 'h' in current && shape.type !== 'equation') {
    if (action.w) props.w = action.w;
    if (action.h) props.h = action.h;
  }
  if (Object.keys(props).length) editor.updateShape(shape.id, { props });
}

/**
 * Apply one instruction's actions as one undo step and select what it created.
 * Returns how many actions took effect. `exact` keeps given positions even off
 * screen, for a caller that placed things against the board, not the view.
 */
export async function applyAgentActions(
  editor: Editor,
  actions: AgentAction[],
  {
    exact = false,
    onStep,
  }: {
    exact?: boolean;
    /** The slow parts as they start, for a progress line: typesetting, each sticker drawn. */
    onStep?: (step: { kind: 'typeset' } | { kind: 'sticker'; prompt: string }) => void;
  } = {},
): Promise<number> {
  if (actions.some((a) => a.type === 'create_equation' || (a.type === 'update_shape' && a.latex))) {
    onStep?.({ kind: 'typeset' });
  }
  const renders = await typesetAll(actions);
  const style = nextShapeStyle();
  const view = viewRect();
  const created: string[] = [];
  let applied = 0;
  // Items given no position stack down the middle of the view, in call order.
  let cursorY = view.y + view.h * 0.25;
  // Whatever the model asked for, new things land where the user is looking.
  const inView = (at: number, size: number, start: number, span: number) =>
    Math.max(start, Math.min(at, start + span - size));
  const place = (x: number | undefined, y: number | undefined, w: number, h: number) => {
    const at = {
      x: exact && x !== undefined ? x : inView(x ?? view.x + view.w / 2 - w / 2, w, view.x, view.w),
      y: exact && y !== undefined ? y : inView(y ?? cursorY, h, view.y, view.h),
    };
    if (y === undefined) cursorY = at.y + h + 40;
    return at;
  };
  let index = getTopIndex(editor.getShapes());
  const add = (shape: Omit<Shape, 'id' | 'index' | 'rotation'>) => {
    const id = genId();
    editor.createShape({ ...shape, id, index, rotation: 0, opacity: style.opacity } as Shape);
    index = jitterKeyBetween(index, null);
    created.push(id);
    applied++;
  };
  const defaults = (type: Shape['type']) =>
    shapeRegistry.get(type)?.getDefaultProps() as Record<string, unknown>;

  // Its own step even straight after a stroke the undo manager would merge.
  breakUndoCapture();
  editor.transact(() => {
    for (const action of actions) {
      switch (action.type) {
        case 'create_text': {
          const fontSize = action.fontSize ?? 24;
          const lines = action.text.split('\n');
          const w = Math.max(...lines.map((l) => l.length)) * fontSize * 0.55;
          add({
            type: 'text',
            ...place(action.x, action.y, w, lines.length * fontSize * 1.2),
            props: { ...defaults('text'), text: action.text, fontSize, color: colorOf(action.color, style.color) },
          } as Shape);
          break;
        }
        case 'create_equation': {
          const fontSize = action.fontSize ?? EQUATION_DEFAULT_FONT_SIZE;
          const box = equationBox(renders, action.latex, fontSize);
          add({
            type: 'equation',
            ...place(action.x, action.y, box.w, box.h),
            props: { latex: action.latex, fontSize, color: colorOf(action.color, style.color), ...box },
          } as Shape);
          break;
        }
        case 'create_graph': {
          const props = { ...defaults('graph') };
          const w = action.w ?? (props.w as number);
          const h = action.h ?? (props.h as number);
          add({
            type: 'graph',
            ...place(action.x, action.y, w, h),
            props: {
              ...props,
              w,
              h,
              ...(action.viewport ? { viewport: action.viewport } : {}),
              expressions: action.expressions.map((expression, i) => ({
                ...createGraphExpression(i),
                expression,
              })),
            },
          } as Shape);
          break;
        }
        case 'create_sticker': {
          const size = action.size ?? 96;
          add({
            type: 'sticker',
            ...place(action.x, action.y, size, size),
            props: { sticker: action.sticker, w: size, h: size },
          } as Shape);
          break;
        }
        case 'create_shape': {
          const type = action.kind === 'rectangle' || action.kind === 'ellipse' ? action.kind : 'polygon';
          add({
            type,
            ...place(action.x, action.y, action.w, action.h),
            props: {
              ...defaults(type),
              ...(type === 'polygon' ? { kind: action.kind } : {}),
              w: action.w,
              h: action.h,
              color: colorOf(action.color, style.color),
              size: style.size,
              ...(action.fillStyle ? { fillStyle: action.fillStyle } : {}),
            },
          } as Shape);
          break;
        }
        case 'create_arrow': {
          let from = endPoint(editor, action.from);
          let to = endPoint(editor, action.to);
          if (!from || !to) break;
          // Bound ends meet their shape's outline, as the arrow tool makes them.
          const bind = (end: AgentArrowEnd, at: Point, other: Point) => {
            const target = 'shapeId' in end ? editor.getShape(end.shapeId) : undefined;
            return target ? bindingForPoint(target, at, other) : null;
          };
          const start = bind(action.from, from, to);
          const end = bind(action.to, to, from);
          from = start?.point ?? from;
          to = end?.point ?? to;
          add({
            type: 'arrow',
            x: from.x,
            y: from.y,
            props: {
              ...defaults('arrow'),
              color: colorOf(action.color, style.color),
              size: style.size,
              label: action.label ?? '',
              points: [
                { x: 0, y: 0 },
                { x: to.x - from.x, y: to.y - from.y },
              ],
              bindings: { start: start?.binding ?? null, end: end?.binding ?? null },
            },
          } as Shape);
          break;
        }
        case 'update_shape':
          if (editor.getShape(action.id)) {
            update(editor, action, renders);
            applied++;
          }
          break;
        case 'delete_shapes': {
          const live = action.ids.filter((id) => editor.getShape(id));
          if (live.length) {
            deleteShapesWithCleanup(editor, live);
            applied++;
          }
          break;
        }
        case 'create_frame': {
          const around = (action.ids ?? [])
            .map((id) => editor.getShape(id))
            .filter((shape) => shape !== undefined)
            .map(shapeRotatedBounds);
          const pad = 32;
          const rect = around.length
            ? {
                x: Math.min(...around.map((b) => b.minX)) - pad,
                y: Math.min(...around.map((b) => b.minY)) - pad,
                w: Math.max(...around.map((b) => b.maxX)) - Math.min(...around.map((b) => b.minX)) + pad * 2,
                h: Math.max(...around.map((b) => b.maxY)) - Math.min(...around.map((b) => b.minY)) + pad * 2,
              }
            : undefined;
          const w = rect?.w ?? action.w ?? 480;
          const h = rect?.h ?? action.h ?? 320;
          const id = genId();
          // At the back, as the frame tool makes them.
          editor.createShape({
            id,
            type: 'frame',
            parentId: null,
            ...(rect ? { x: rect.x, y: rect.y } : place(action.x, action.y, w, h)),
            rotation: 0,
            opacity: 1,
            index: getBottomIndex(editor.getShapes().filter((shape) => !shape.parentId)),
            props: { ...defaults('frame'), name: action.name, w, h, color: style.color },
          } as Shape);
          // Named shapes go in by their top-level container (a shape in a
          // group takes its group along). Walked with `getShape`: the page
          // list doesn't see this transaction's own edits yet, which made a
          // capture pull shapes out of a group grouped a step earlier.
          if (action.ids?.length) {
            const roots = new Set<string>();
            for (const named of action.ids) {
              let shape = editor.getShape(named);
              while (shape?.parentId) shape = editor.getShape(shape.parentId);
              if (shape && shape.id !== id && !shape.locked) roots.add(shape.id);
            }
            for (const root of roots) editor.updateShape(root, { parentId: id });
          } else {
            captureEnclosedShapes(editor, id);
          }
          created.push(id);
          applied++;
          break;
        }
        case 'align_shapes': {
          const live = action.ids.filter((id) => editor.getShape(id));
          if (live.length < 2) break;
          if (action.align === 'distribute-horizontal') distributeShapes(editor, live, 'horizontal');
          else if (action.align === 'distribute-vertical') distributeShapes(editor, live, 'vertical');
          else alignShapes(editor, live, ALIGN_EDGES[action.align]);
          applied++;
          break;
        }
        case 'group_shapes': {
          const group = groupShapes(editor, action.ids.filter((id) => editor.getShape(id)));
          if (group) applied++;
          break;
        }
      }
    }
  });

  // Generated artwork takes an image model call and the user's cut-out review,
  // so it can't wait inside the transaction above: each lands as its own step
  // once it is in the board's sticker library.
  for (const action of actions) {
    if (action.type !== 'generate_sticker') continue;
    onStep?.({ kind: 'sticker', prompt: action.prompt });
    const sticker = await generateSticker(action.prompt);
    if (!sticker) continue;
    const natural = customStickerSize(sticker.width, sticker.height);
    const k = action.size ? action.size / Math.max(natural.w, natural.h) : 1;
    const w = natural.w * k;
    const h = natural.h * k;
    index = getTopIndex(editor.getShapes());
    editor.transact(() =>
      add({
        type: 'sticker',
        ...place(action.x, action.y, w, h),
        props: { sticker: sticker.id, blobId: sticker.blobId, w, h },
      } as Shape),
    );
  }

  if (created.length) {
    useToolStore.getState().setTool('select');
    useSelectionStore.getState().setSelection(created.filter((id) => editor.getShape(id)));
  }
  return applied;
}
