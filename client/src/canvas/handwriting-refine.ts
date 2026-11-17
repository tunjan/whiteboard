import type { DrawPoint, DrawShape } from '@whiteboard/shared';
import { linesOf } from './ink-lines';
import { simplifyRDP } from './shapes/simplify';
import { breakUndoCapture, editor } from './use-document-store';

/**
 * Tidy handwriting: messy ink → a neater copy of the same hand, the way Apple
 * Notes' "Refine" does, but by geometry instead of a model.
 *
 * Per line of writing: the baseline is levelled, the slant stood upright, the
 * letters sat back onto the baseline, and each stroke smoothed of the jitter a
 * mouse leaves. Nothing is recognised, so maths, diagrams and any script tidy
 * the same way. Every tolerance is a fraction of the line's typical glyph
 * height, so the result does not depend on zoom or writing size.
 *
 * ponytail: no per-letter resizing or spacing — both would wreck superscripts
 * and fractions; add them behind a recogniser if plain text ever needs it.
 */

/** Fewest glyphs a line needs before its baseline and slant mean anything. */
const MIN_GLYPHS = 3;
/** A tilt steeper than this was written on purpose (a sloped label). */
const MAX_TILT = (15 * Math.PI) / 180;
/** Segments this near vertical are the ones that show the slant. */
const SLANT_WINDOW = (30 * Math.PI) / 180;
/** Most slant that is corrected; beyond it the hand meant italics. */
const MAX_SLANT = (25 * Math.PI) / 180;
/** Glyph bottoms within this of the baseline (× glyph height) sit on it. */
const BASELINE_BAND = 0.25;
/** Glyphs shorter than this (× glyph height) float on purpose: = - . , ' */
const MIN_SNAP_HEIGHT = 0.5;
/** Strokes taller than this (× glyph height) are drawing, not writing. */
const MAX_STROKE_HEIGHT = 3;
/** Resample spacing for smoothing, × glyph height. */
const SMOOTH_SPACING = 1 / 32;
/** Arc length either side a corner's turn is measured over, × glyph height. */
const CORNER_SPAN = 1 / 6;
/** A turn sharper than this is a corner the smoothing must keep. */
const CORNER_TURN = (60 * Math.PI) / 180;
/** Width of the smoothing Gaussian, × glyph height. */
const SMOOTH_SIGMA = 1 / 12;
/** Simplification tolerance after smoothing, × glyph height. */
const SIMPLIFY_EPSILON = 1 / 150;

type Stroke = DrawPoint[];

interface Box {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

function boxOf(points: readonly DrawPoint[]): Box {
  const box = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of points) {
    box.minX = Math.min(box.minX, p.x);
    box.minY = Math.min(box.minY, p.y);
    box.maxX = Math.max(box.maxX, p.x);
    box.maxY = Math.max(box.maxY, p.y);
  }
  return box;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[sorted.length >> 1] ?? 0;
}

interface Glyph extends Box {
  strokes: number[];
}

/** Strokes whose x-ranges overlap form one glyph: the dot with its i, the bar with its t. */
function glyphsOf(strokes: readonly Stroke[]): Glyph[] {
  const order = strokes
    .map((s, i) => ({ i, box: boxOf(s) }))
    .filter(({ box }) => Number.isFinite(box.minX))
    .sort((a, b) => a.box.minX - b.box.minX);
  const glyphs: Glyph[] = [];
  for (const { i, box } of order) {
    const last = glyphs.at(-1);
    if (last && box.minX <= last.maxX) {
      last.strokes.push(i);
      last.minY = Math.min(last.minY, box.minY);
      last.maxX = Math.max(last.maxX, box.maxX);
      last.maxY = Math.max(last.maxY, box.maxY);
    } else {
      glyphs.push({ ...box, strokes: [i] });
    }
  }
  return glyphs;
}

const map = (strokes: Stroke[], f: (p: DrawPoint) => { x: number; y: number }): Stroke[] =>
  strokes.map((s) => s.map((p) => ({ ...p, ...f(p) })));

/** Least-squares slope of the glyph bottoms, refitted once without outliers (descenders, superscripts). */
function baselineTilt(glyphs: Glyph[], height: number): { angle: number; cx: number; cy: number } {
  const fit = (gs: Glyph[]) => {
    const xs = gs.map((g) => (g.minX + g.maxX) / 2);
    const ys = gs.map((g) => g.maxY);
    const mx = xs.reduce((a, b) => a + b, 0) / xs.length;
    const my = ys.reduce((a, b) => a + b, 0) / ys.length;
    let sxy = 0;
    let sxx = 0;
    xs.forEach((x, i) => {
      sxy += (x - mx) * (ys[i]! - my);
      sxx += (x - mx) ** 2;
    });
    const slope = sxx > 0 ? sxy / sxx : 0;
    return { slope, mx, my };
  };
  const first = fit(glyphs);
  const kept = glyphs.filter(
    (g) =>
      Math.abs(g.maxY - (first.my + first.slope * ((g.minX + g.maxX) / 2 - first.mx))) <=
      BASELINE_BAND * height,
  );
  const { slope, mx, my } = kept.length >= 2 ? fit(kept) : first;
  return { angle: Math.atan(slope), cx: mx, cy: my };
}

/** Length-weighted lean of the near-vertical segments, radians; negative leans right. */
function slantOf(strokes: readonly Stroke[]): number {
  let weighted = 0;
  let total = 0;
  for (const s of strokes) {
    for (let i = 1; i < s.length; i++) {
      let dx = s[i]!.x - s[i - 1]!.x;
      let dy = s[i]!.y - s[i - 1]!.y;
      if (dy < 0) {
        dx = -dx;
        dy = -dy;
      }
      const len = Math.hypot(dx, dy);
      const lean = Math.atan2(dx, dy);
      if (len === 0 || Math.abs(lean) > SLANT_WINDOW) continue;
      weighted += lean * len;
      total += len;
    }
  }
  return total > 0 ? weighted / total : 0;
}

function lerp(a: DrawPoint, b: DrawPoint, t: number): DrawPoint {
  const out: DrawPoint = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  if (a.pressure !== undefined && b.pressure !== undefined)
    out.pressure = a.pressure + (b.pressure - a.pressure) * t;
  if (a.tiltX !== undefined && b.tiltX !== undefined) out.tiltX = a.tiltX + (b.tiltX - a.tiltX) * t;
  if (a.tiltY !== undefined && b.tiltY !== undefined) out.tiltY = a.tiltY + (b.tiltY - a.tiltY) * t;
  return out;
}

/** Points every `spacing` along the stroke's length, ends included. */
function resampleEvenly(points: Stroke, spacing: number): Stroke {
  const out: Stroke = [points[0]!];
  let carry = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let at = spacing - carry;
    for (; at <= len; at += spacing) out.push(lerp(a, b, at / len));
    carry = len - (at - spacing);
  }
  const last = points[points.length - 1]!;
  if (carry > spacing * 0.25 || out.length === 1) out.push(last);
  else out[out.length - 1] = last;
  return out;
}

/**
 * Gaussian blur along the stroke, never across a pinned sample: each run
 * between pins is smoothed on its own, so corners and ends stay exactly where
 * the hand put them.
 */
function blur(p: readonly DrawPoint[], pinned: Uint8Array, sigma: number): Stroke {
  const radius = Math.ceil(sigma * 3);
  const weights = Array.from({ length: radius + 1 }, (_, d) => Math.exp(-(d * d) / (2 * sigma * sigma)));
  const out = p.slice();
  let runStart = 0;
  for (let i = 1; i < p.length; i++) {
    if (!pinned[i]) continue;
    for (let j = runStart + 1; j < i; j++) {
      let x = 0;
      let y = 0;
      let w = 0;
      for (let k = Math.max(runStart, j - radius); k <= Math.min(i, j + radius); k++) {
        const wk = weights[Math.abs(k - j)]!;
        x += p[k]!.x * wk;
        y += p[k]!.y * wk;
        w += wk;
      }
      out[j] = { ...p[j]!, x: x / w, y: y / w };
    }
    runStart = i;
  }
  return out;
}

/**
 * Smooth one stroke of mouse jitter, keeping its corners. A Gaussian of a
 * twelfth of a glyph shrinks a loop the size of an o by about a
 * hundredth of its height, so letters keep their shape and size.
 */
export function smoothStroke(points: Stroke, height: number): Stroke {
  if (points.length < 3 || height <= 0) return points;
  const p = resampleEvenly(points, height * SMOOTH_SPACING);
  const n = p.length;
  if (n < 3) return points;
  const pinned = new Uint8Array(n);
  pinned[0] = 1;
  pinned[n - 1] = 1;
  const sigma = SMOOTH_SIGMA / SMOOTH_SPACING;
  // Corners are found on a smoothed copy, measured over a sixth of a glyph
  // either side: on the raw samples mouse jitter turns as sharply as a v does.
  const rough = blur(p, pinned, sigma);
  const k = Math.max(1, Math.round(CORNER_SPAN / SMOOTH_SPACING));
  for (let i = k; i < n - k; i++) {
    const ax = rough[i]!.x - rough[i - k]!.x;
    const ay = rough[i]!.y - rough[i - k]!.y;
    const bx = rough[i + k]!.x - rough[i]!.x;
    const by = rough[i + k]!.y - rough[i]!.y;
    const turn = Math.abs(Math.atan2(ax * by - ay * bx, ax * bx + ay * by));
    if (turn > CORNER_TURN) pinned[i] = 1;
  }
  return simplifyRDP(blur(p, pinned, sigma), height * SIMPLIFY_EPSILON);
}

/**
 * Tidy one line of handwriting. Strokes are in a shared (world) space and
 * come back in the same order; strokes that are drawing rather than writing
 * come back untouched.
 */
export function refineLine(input: readonly Stroke[]): Stroke[] {
  const heights = glyphsOf(input).map((g) => g.maxY - g.minY);
  const height = median(heights);
  if (height <= 0) return input.map((s) => s.slice());
  const writing = input.map((s) => {
    const box = boxOf(s);
    return box.maxY - box.minY <= MAX_STROKE_HEIGHT * height;
  });
  // Smoothed first: jitter scatters the segment angles the slant is read from.
  let strokes = input.filter((_, i) => writing[i]).map((s) => smoothStroke(s, height));

  if (glyphsOf(strokes).length >= MIN_GLYPHS) {
    // Level the baseline.
    const tilt = baselineTilt(glyphsOf(strokes), height);
    if (Math.abs(tilt.angle) <= MAX_TILT) {
      const cos = Math.cos(-tilt.angle);
      const sin = Math.sin(-tilt.angle);
      strokes = map(strokes, (p) => ({
        x: tilt.cx + (p.x - tilt.cx) * cos - (p.y - tilt.cy) * sin,
        y: tilt.cy + (p.x - tilt.cx) * sin + (p.y - tilt.cy) * cos,
      }));
    }

    // Stand the slant upright, sheared about the baseline so letters stay put.
    const base = median(glyphsOf(strokes).map((g) => g.maxY));
    const lean = slantOf(strokes);
    if (Math.abs(lean) <= MAX_SLANT) {
      const shear = Math.tan(lean);
      strokes = map(strokes, (p) => ({ x: p.x - (p.y - base) * shear, y: p.y }));
    }

    // Sit each letter that is nearly on the baseline exactly on it.
    for (const g of glyphsOf(strokes)) {
      const drop = base - g.maxY;
      if (g.maxY - g.minY < MIN_SNAP_HEIGHT * height) continue;
      if (drop === 0 || Math.abs(drop) > BASELINE_BAND * height) continue;
      for (const i of g.strokes) strokes[i] = strokes[i]!.map((p) => ({ ...p, y: p.y + drop }));
    }
  }

  let next = 0;
  return input.map((s, i) => (writing[i] ? strokes[next++]! : s.slice()));
}

/** A stroke the tidy may rewrite: pen ink, upright, unlocked. */
function isTidyable(shape: ReturnType<typeof editor.getShape>): shape is DrawShape {
  return (
    shape?.type === 'draw' &&
    !shape.locked &&
    shape.rotation === 0 &&
    shape.props.inkKind !== 'highlight' &&
    shape.props.points.length > 1
  );
}

/** Whether any of these shapes would be tidied. */
export function hasTidyableInk(ids: readonly string[]): boolean {
  return ids.some((id) => isTidyable(editor.getShape(id)));
}

/**
 * Tidy the handwriting among these shapes, line by line, as one undo step.
 * Anything that isn't upright pen ink is left alone. Returns whether
 * anything was written.
 */
export function refineHandwriting(ids: readonly string[]): boolean {
  const shapes = ids.map((id) => editor.getShape(id)).filter(isTidyable);
  if (shapes.length === 0) return false;
  const world = new Map(
    shapes.map((s) => [s.id, s.props.points.map((p) => ({ ...p, x: p.x + s.x, y: p.y + s.y }))]),
  );
  const lines = linesOf(shapes.map((s) => ({ id: s.id, bounds: boxOf(world.get(s.id)!) })));
  // Its own step: Yjs would otherwise merge it into the stroke just drawn, and
  // one undo would take the whole word away instead of the tidy.
  breakUndoCapture();
  editor.transact(() => {
    for (const line of lines) {
      const refined = refineLine(line.ids.map((id) => world.get(id)!));
      line.ids.forEach((id, i) => {
        const shape = editor.getShape(id)!;
        editor.updateShape(id, {
          props: { points: refined[i]!.map((p) => ({ ...p, x: p.x - shape.x, y: p.y - shape.y })) },
        });
      });
    }
  });
  return true;
}

/** Quiet time after the last mouse stroke before it is tidied. */
const AUTO_IDLE_MS = 1000;
let autoQueue: string[] = [];
let autoTimer: ReturnType<typeof setTimeout> | null = null;

/** Queue a just-finished stroke for tidying once the hand pauses. */
export function queueAutoRefine(id: string): void {
  autoQueue.push(id);
  if (autoTimer !== null) clearTimeout(autoTimer);
  autoTimer = setTimeout(() => {
    autoTimer = null;
    const ids = autoQueue;
    autoQueue = [];
    // A peer may have erased some meanwhile; refineHandwriting skips those.
    refineHandwriting(ids);
  }, AUTO_IDLE_MS);
}

/** A new stroke began: the word isn't finished, so hold the tidy until the next pause. */
export function holdAutoRefine(): void {
  if (autoTimer !== null) {
    clearTimeout(autoTimer);
    autoTimer = null;
  }
}
