import {
  MAX_CHECK_SOURCE_CHARS,
  MAX_CHECK_SOURCES,
  boundsIntersect,
  unionBounds,
  type Bounds,
  type CheckError,
  type CheckSource,
  type Shape,
} from '@whiteboard/shared';
import { create } from 'zustand';
import { checkWork } from '@/board/latex-ai';
import { toast } from '@/components/ui/toast';
import { applyAgentActions } from './agent-actions';
import { addComment, setThreadResolved } from './board-records';
import { requestCanvasZoomToBounds } from './camera-requests';
import { screenToWorld } from './camera';
import { renderShapesForRecognition } from './export-png';
import { blockAround, linesOf, type Line } from './ink-lines';
import { shapeRotatedBounds } from './shape-bounds';
import { type CommentMessage, useCommentsStore } from './use-comments-store';
import { useSelectionStore } from './use-selection-store';
import { useCameraStore } from './use-camera-store';
import { editor, onLocalShapesChanged, useDocumentStore } from './use-document-store';

/**
 * The work checker: a page of working → its mistakes, each pinned to the board
 * as a comment thread on the wrong line, with the corrected line one click away.
 *
 * Mistakes are located by line, not by coordinates. The shapes are grouped
 * into lines of working here, each line is tagged with a number in a margin of
 * the image the model reads, and the model answers with a tag. The comment's
 * box is then the line's real bounds — exact, whatever the model.
 *
 * Threads are ordinary comments, so they sync and resolve like any other; a
 * `box` on the root is what marks one as the checker's.
 */

const CHECKER = { name: 'Checker', color: '#e5484d' };

/** What can hold working: ink, typeset maths, text, and pasted pictures. */
export function isCheckable(shape: Shape | undefined): boolean {
  return (
    shape?.type === 'draw' ||
    shape?.type === 'equation' ||
    shape?.type === 'text' ||
    shape?.type === 'image'
  );
}

/** The numbered tags in the image's left margin, one per line. */
function lineTags(lines: Line[], bounds: Bounds) {
  const centres = lines.map((l) => (l.bounds.minY + l.bounds.maxY) / 2);
  const closest = centres
    .slice(1)
    .reduce((gap, c, i) => Math.min(gap, c - centres[i]!), Infinity);
  const lineHeight =
    lines.reduce((sum, l) => sum + l.bounds.maxY - l.bounds.minY, 0) / lines.length;
  // In proportion to the writing, so the model reads tag and maths at the same
  // scale, and shrunk to keep the tags of tightly spaced lines from touching.
  const size = Math.max(1, Math.min(lineHeight * 0.7, closest * 0.9));
  const left = size * 1.8;
  const x = bounds.minX - left + size * 0.2;
  return {
    left,
    node: (
      <g>
        {centres.map((cy, i) => (
          <g key={i}>
            <rect
              x={x}
              y={cy - size / 2}
              width={size * 1.3}
              height={size}
              rx={size * 0.25}
              fill="#2563eb"
            />
            <text
              x={x + size * 0.65}
              y={cy}
              fill="#ffffff"
              fontFamily="Inter Variable, sans-serif"
              fontWeight={600}
              fontSize={size * 0.7}
              textAnchor="middle"
              dominantBaseline="central"
            >
              {i + 1}
            </text>
          </g>
        ))}
      </g>
    ),
  };
}

const area = (b: Bounds) => Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY);

/** Whether two boxes mark mostly the same place. */
function samePlace(a: Bounds, b: Bounds): boolean {
  const overlap = area({
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  });
  return overlap > 0.6 * Math.min(area(a), area(b));
}

const pad = (b: Bounds, by: number): Bounds => ({
  minX: b.minX - by,
  minY: b.minY - by,
  maxX: b.maxX + by,
  maxY: b.maxY + by,
});

type Mistake = CommentMessage & { box: Bounds };

/**
 * What a check's reply does to the checker's threads on the page, `threads`.
 * Each mistake keeps an open thread already marking the same place, so a
 * re-check doesn't make its pin blink, or gets a new one. Open threads on the
 * lines the model saw that it no longer reports are resolved: the mistake was
 * fixed. `skipDismissed` passes over a mistake whose thread a person dismissed
 * (or added the correction of): an always-on checker must not re-raise it on
 * every edit nearby. Only while that line's shapes all still exist — a line
 * erased and rewritten is new working — and never for a thread the checker
 * resolved itself, which may have been raised on a half-written line.
 *
 * `clean` is whether the reply leaves nothing to show: every mistake in it was
 * one the user dismissed. A tag that names no line is a reply that can't be
 * placed, so pins nothing and isn't clean either.
 */
export function planPins(
  errors: CheckError[],
  lines: Line[],
  threads: Mistake[],
  skipDismissed: boolean,
  exists: (id: string) => boolean,
): {
  pins: { error: CheckError; line: Line; box: Bounds; thread?: Mistake }[];
  resolve: string[];
  clean: boolean;
} {
  const seen = threads.filter((t) =>
    lines.some(
      (l) =>
        samePlace(t.box, pad(l.bounds, 6)) || t.shapeIds?.some((id) => l.ids.includes(id)),
    ),
  );
  const dismissed = (t: Mistake, line: Line) =>
    t.resolved &&
    t.dismissed &&
    Boolean(t.shapeIds?.length) &&
    t.shapeIds!.every(exists) &&
    t.shapeIds!.some((id) => line.ids.includes(id));
  const pins: { error: CheckError; line: Line; box: Bounds; thread?: Mistake }[] = [];
  let clean = true;
  for (const error of errors) {
    const line = lines[error.line - 1];
    if (!line) {
      clean = false;
      continue;
    }
    if (skipDismissed && seen.some((t) => dismissed(t, line))) continue;
    clean = false;
    const box = pad(line.bounds, 6);
    pins.push({ error, line, box, thread: seen.find((t) => !t.resolved && samePlace(t.box, box)) });
  }
  const kept = new Set(pins.map((p) => p.thread?.id));
  const resolve = seen.filter((t) => !t.resolved && !kept.has(t.id)).map((t) => t.id);
  return { pins, resolve, clean };
}

/** Apply `planPins` to the board; the mistakes it leaves showing, in order. */
function pinMistakes(
  errors: CheckError[],
  lines: Line[],
  pageId: string,
  skipDismissed: boolean,
): { id: string; box: Bounds }[] {
  const threads = Object.values(useCommentsStore.getState().messages).filter(
    (m): m is Mistake => m.id === m.threadId && m.pageId === pageId && Boolean(m.box),
  );
  const { pins, resolve } = planPins(
    errors,
    lines,
    threads,
    skipDismissed,
    (id) => Boolean(editor.getShape(id)),
  );
  const reported = pins.map(({ error, line, box, thread }) =>
    thread
      ? { id: thread.id, box: thread.box }
      : {
          box,
          id: addComment({
            pageId,
            x: box.maxX,
            y: box.minY,
            text: error.message,
            author: CHECKER,
            box,
            correction: error.correction,
            shapeIds: line.ids,
          }),
        },
  );
  for (const id of resolve) setThreadResolved(id, true);
  return reported;
}

/**
 * The checker's open threads whose line has gone: none of its shapes is left
 * among `shapes` (the page's checkable ones), or, for a thread from before
 * shapes were recorded, none lies under its box. An edit that only deletes
 * sends nothing to the model, so these are found without it.
 */
export function orphanedMistakes(
  threads: Mistake[],
  shapes: { id: string; bounds: Bounds }[],
): string[] {
  const ids = new Set(shapes.map((s) => s.id));
  return threads
    .filter(
      (t) =>
        !t.resolved &&
        (t.shapeIds?.length
          ? !t.shapeIds.some((id) => ids.has(id))
          : !shapes.some((s) => boundsIntersect(s.bounds, t.box))),
    )
    .map((t) => t.id);
}

/**
 * What the model would be shown, minus pure style: each shape's identity,
 * place and content. A recolour leaves it unchanged; a move or an edit not.
 */
export function workSignature(shapes: { shape: Shape; bounds: Bounds }[]): string {
  return shapes
    .map(({ shape, bounds }) => {
      const content =
        shape.type === 'draw'
          ? shape.props.points.length
          : shape.type === 'equation'
            ? shape.props.latex
            : shape.type === 'text'
              ? shape.props.text
              : shape.type === 'image'
                ? shape.props.blobId
                : '';
      const place = [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY].map(Math.round);
      return `${shape.id} ${shape.type} ${place.join(',')} ${content}`;
    })
    .sort()
    .join('\n');
}

/**
 * Whether an edit to the shape `id`, now at `bounds` (none once deleted),
 * outdates a check that read `sent`: it is one of the shapes read, or lies on
 * a row that was. Writing on below the block doesn't — that reply still stands.
 */
export function outdates(
  sent: { ids: ReadonlySet<string>; rows: Bounds[] },
  id: string,
  bounds: Bounds | undefined,
): boolean {
  return (
    sent.ids.has(id) ||
    Boolean(bounds && sent.rows.some((r) => bounds.minY <= r.maxY && bounds.maxY >= r.minY))
  );
}

/** The check in flight, if any: one at a time. */
let inFlight: AbortController | null = null;
/** Whether it is an always-on one, which a new edit may cancel. */
let inFlightQuiet = false;

/** `workSignature` of what the last completed always-on check read. */
let lastSignature = '';

const AUTO_CHECK_KEY = 'whiteboard:auto-check';

function readAutoCheck(): boolean {
  try {
    return localStorage.getItem(AUTO_CHECK_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * Whether always-on checking is switched on, remembered per browser. Set from
 * the board menu; `AgentBar` starts and stops the checker from it.
 */
export const useAutoCheckStore = create<{ on: boolean }>(() => ({ on: readAutoCheck() }));

export function setAutoCheck(on: boolean): void {
  useAutoCheckStore.setState({ on });
  try {
    localStorage.setItem(AUTO_CHECK_KEY, on ? '1' : '');
  } catch {
    // Remembering it is a convenience; the switch works without storage.
  }
}

/** The checker's unresolved threads on `pageId`, in reading order. */
export function openMistakes(
  messages: Record<string, CommentMessage>,
  pageId: string,
): Mistake[] {
  return Object.values(messages)
    .filter(
      (m): m is Mistake =>
        m.id === m.threadId && m.pageId === pageId && Boolean(m.box) && !m.resolved,
    )
    .sort((a, b) => a.box.minY - b.box.minY || a.box.minX - b.box.minX);
}

/**
 * Bring `box` to the middle of the screen at the current zoom: a pan, not a
 * zoom-to-fit, which would blow one line up to fill the window. Zooms out only
 * for a box larger than the view.
 */
function reveal(box: Bounds): void {
  const { z } = useCameraStore.getState().camera;
  // Canvas fits bounds to 0.75 of the viewport; a box of that size at this
  // zoom keeps the zoom where it is.
  const w = (window.innerWidth * 0.75) / z;
  const h = (window.innerHeight * 0.75) / z;
  const k = Math.max(1, (box.maxX - box.minX) / w, (box.maxY - box.minY) / h);
  const cx = (box.minX + box.maxX) / 2;
  const cy = (box.minY + box.maxY) / 2;
  requestCanvasZoomToBounds({
    minX: cx - (w * k) / 2,
    minY: cy - (h * k) / 2,
    maxX: cx + (w * k) / 2,
    maxY: cy + (h * k) / 2,
  });
}

/** Whether `box` is wholly on screen. */
function onScreen(box: Bounds): boolean {
  const { camera } = useCameraStore.getState();
  const a = screenToWorld({ x: 0, y: 0 }, camera);
  const b = screenToWorld({ x: window.innerWidth, y: window.innerHeight }, camera);
  return box.minX >= a.x && box.minY >= a.y && box.maxX <= b.x && box.maxY <= b.y;
}

/** Open a mistake's thread and bring its line into view. */
export function showMistake(mistake: Mistake): void {
  useCommentsStore.getState().setOpenThreadId(mistake.id);
  reveal(mistake.box);
}

/**
 * Check `ids` for mistakes and pin what is found. `quiet` is the always-on
 * mode: no toasts, no popup, and dismissed mistakes stay dismissed. Throws
 * with a toast-ready message otherwise.
 */
export async function checkShapes(ids: string[], quiet = false): Promise<void> {
  if (inFlight) return;
  const pageId = useDocumentStore.getState().currentPageId;
  const shapes = ids.flatMap((id) => {
    const shape = editor.getShape(id);
    return isCheckable(shape) ? [{ id, shape: shape!, bounds: shapeRotatedBounds(shape!) }] : [];
  });
  const lines = linesOf(shapes);
  if (!lines.length) return;
  // Nothing but style changed since the last always-on check read this: its
  // pins still stand, and no fresh tick is earned.
  const signature = workSignature(shapes);
  if (quiet && signature === lastSignature) return;

  // Typeset shapes' exact source, so the model needn't read them from pixels.
  const byId = new Map(shapes.map((s) => [s.id, s.shape]));
  const sources = lines
    .flatMap((line, i) =>
      line.ids.flatMap((id): CheckSource[] => {
        const shape = byId.get(id);
        const source =
          shape?.type === 'equation'
            ? shape.props.latex
            : shape?.type === 'text'
              ? shape.props.text
              : '';
        return source.trim() && source.length <= MAX_CHECK_SOURCE_CHARS
          ? [{ line: i + 1, kind: shape!.type === 'equation' ? 'latex' : 'text', source }]
          : [];
      }),
    )
    .slice(0, MAX_CHECK_SOURCES);

  const controller = new AbortController();
  inFlight = controller;
  inFlightQuiet = quiet;
  try {
    const png = await renderShapesForRecognition(
      shapes.map((s) => s.id),
      (bounds) => lineTags(lines, bounds),
    );
    if (!png) return;
    // Always-on checks have each mistake confirmed by a second call: a false
    // pin costs more there than the wait. A manual check keeps its latency.
    const errors = await checkWork(png, controller.signal, { sources, confirm: quiet });
    if (controller.signal.aborted) return;
    // The user has moved to another page: its lines are not these.
    if (useDocumentStore.getState().currentPageId !== pageId) return;
    const reported = pinMistakes(errors, lines, pageId, quiet);
    if (quiet) {
      lastSignature = signature;
      return;
    }
    const first = reported[0];
    if (!first) {
      toast.add({ title: 'Looks correct', type: 'success' });
      return;
    }
    // The open thread, its box and the count pill already say it: no toast.
    // The selection goes, so its handles and toolbar don't sit on the box.
    useSelectionStore.getState().setSelection([]);
    useCommentsStore.getState().setOpenThreadId(first.id);
    // With room for the pin on its corner, which a box at the edge cuts off.
    if (!onScreen(pad(first.box, 24))) reveal(first.box);
  } catch (err) {
    if (controller.signal.aborted) return;
    throw err;
  } finally {
    if (inFlight === controller) inFlight = null;
  }
}

/**
 * Add a checker thread's correction beside its line, then resolve it. Exactly
 * beside it: pulled into view like the agent's own shapes, a correction for a
 * line that ends near the screen's edge was pushed back over the line. If it
 * runs off screen instead, the camera pans to show line and correction.
 */
export async function addCorrection(root: CommentMessage): Promise<void> {
  if (!root.box || !root.correction) return;
  const height = root.box.maxY - root.box.minY;
  await applyAgentActions(
    editor,
    [
      {
        type: 'create_equation',
        latex: root.correction,
        x: root.box.maxX + 32,
        y: root.box.minY,
        fontSize: Math.min(40, Math.max(16, height * 0.5)),
        color: 'green',
      },
    ],
    { exact: true },
  );
  setThreadResolved(root.id, true, true);
  // `applyAgentActions` selects what it created.
  const created = useSelectionStore
    .getState()
    .selectedIds.flatMap((id) => {
      const shape = editor.getShape(id);
      return shape ? [shapeRotatedBounds(shape)] : [];
    });
  const both = created.reduce(unionBounds, root.box);
  if (!onScreen(both)) reveal(both);
}

/**
 * Idle time after the user's last edit before the always-on check runs. Long
 * enough to span the gap between strokes of one line; a check that lands on a
 * half-written line is redone, and its pin resolved, on the next pause.
 */
const IDLE_MS = 2000;

/** How often a pause that came mid-check looks again for that check to end. */
const BUSY_RETRY_MS = 250;

let stopAuto: (() => void) | null = null;

/** Check the user's own work by itself, a few seconds after each pause. */
export function startAutoCheck(): void {
  if (stopAuto) return;
  const touched = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | undefined;
  /** What the last always-on check read, and the edits that set it off. */
  let sent: { ids: Set<string>; rows: Bounds[]; seeds: string[] } | null = null;

  const run = () => {
    // Still answering the last pause: look again once it is back.
    if (inFlight) {
      timer = setTimeout(run, BUSY_RETRY_MS);
      return;
    }
    const shapes = editor
      .getShapes()
      .flatMap((s) => (isCheckable(s) ? [{ id: s.id, bounds: shapeRotatedBounds(s) }] : []));
    // Pins whose line was erased, which a delete alone never sends to check.
    const { messages } = useCommentsStore.getState();
    const pageId = useDocumentStore.getState().currentPageId;
    for (const id of orphanedMistakes(openMistakes(messages, pageId), shapes)) {
      setThreadResolved(id, true);
    }
    // The whole block of working the edit is in: whole lines, the ones above
    // it that it follows from, and the ones below that follow from it.
    const seeds = [...touched];
    const ids = blockAround(shapes, seeds);
    touched.clear();
    if (!ids.length) return;
    const block = new Set(ids);
    sent = {
      ids: block,
      rows: linesOf(shapes.filter((s) => block.has(s.id))).map((l) => l.bounds),
      seeds,
    };
    // Silence would read as "no mistakes"; the toast de-duplicates a repeat.
    checkShapes(ids, true).catch((err: unknown) =>
      toast.add({
        title: 'Auto-check failed',
        description: err instanceof Error ? err.message : undefined,
        type: 'error',
      }),
    );
  };

  const off = onLocalShapesChanged((ids) => {
    for (const id of ids) touched.add(id);
    // A reply about rows that have since changed would pin stale bounds: drop
    // it and read them again on the next pause. Writing on below the block
    // leaves it standing, or a student who never stops would never hear.
    // Never a manual check, though: the user asked for that one.
    const read = sent;
    if (
      inFlight &&
      inFlightQuiet &&
      read &&
      [...ids].some((id) => {
        const shape = editor.getShape(id);
        return outdates(read, id, isCheckable(shape) ? shapeRotatedBounds(shape!) : undefined);
      })
    ) {
      inFlight.abort();
      for (const id of read.seeds) touched.add(id);
    }
    clearTimeout(timer);
    timer = setTimeout(run, IDLE_MS);
  });
  stopAuto = () => {
    off();
    clearTimeout(timer);
    inFlight?.abort();
  };
}

export function stopAutoCheck(): void {
  stopAuto?.();
  stopAuto = null;
}
