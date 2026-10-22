import type { Vec } from '@whiteboard/shared';
import { PathBuilder } from './path-builder';

// The `draw` stroke style, ported from tldraw's `PathBuilder.toDrawD`
// (packages/tldraw/src/lib/shapes/shared/PathBuilder.tsx, v5.5.2). Each vertex
// is nudged by a seeded random offset once per pass, and the corner into the
// next straight segment is rounded by an amount that fades out as the turn
// tightens past a right angle. Every pass goes into one path, so overlapping
// passes are painted once rather than darkening each other.

/** One vertex of the outline, and the segment that arrives at it. */
export type DrawCommand =
  | (DrawVertexOpts & { type: 'move'; x: number; y: number })
  | (DrawVertexOpts & { type: 'line'; x: number; y: number })
  | (DrawVertexOpts & {
      type: 'cubic';
      x: number;
      y: number;
      cp1: Vec;
      cp2: Vec;
    });

interface DrawVertexOpts {
  /** Jitter radius at this vertex; defaults to the path's `offset`. */
  offset?: number;
  /** Corner rounding into the next segment; defaults to `size * 2`. */
  roundness?: number;
}

export interface DrawPathOptions {
  /** Stable shape id or another persistent key. */
  seed: string;
  size: number;
  closed?: boolean;
  passes?: number;
  /** Default jitter radius; tldraw's is a third of the stroke width. */
  offset?: number;
}

interface SegmentInfo {
  tangentStart: Vec;
  tangentEnd: Vec;
  length: number;
}

/** tldraw's seeded xorshift128; returns values in [-1, 1). */
function rng(seed: string): () => number {
  let x = 0;
  let y = 0;
  let z = 0;
  let w = 0;
  function next(): number {
    const t = x ^ (x << 11);
    x = y;
    y = z;
    z = w;
    w ^= ((w >>> 19) ^ t ^ (t >>> 8)) >>> 0;
    return (w / 0x100000000) * 2;
  }
  for (let k = 0; k < seed.length + 64; k++) {
    x ^= seed.charCodeAt(k) | 0;
    next();
  }
  return next;
}

function sub(a: Vec, b: Vec): Vec {
  return { x: a.x - b.x, y: a.y - b.y };
}

function uni(v: Vec): Vec {
  const l = Math.hypot(v.x, v.y);
  return l === 0 ? { x: 0, y: 0 } : { x: v.x / l, y: v.y / l };
}

function len2(v: Vec): number {
  return v.x * v.x + v.y * v.y;
}

function angleBetween(a: Vec, b: Vec): number {
  const p = a.x * b.x + a.y * b.y;
  const n = Math.sqrt(len2(a) * len2(b));
  const sign = a.x * b.y - a.y * b.x < 0 ? -1 : 1;
  return sign * Math.acos(Math.max(-1, Math.min(1, p / n)));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function cubicLength(a: Vec, c: Extract<DrawCommand, { type: 'cubic' }>): number {
  const STEPS = 16;
  let total = 0;
  let prev = a;
  for (let i = 1; i <= STEPS; i++) {
    const t = i / STEPS;
    const mt = 1 - t;
    const point = {
      x: mt ** 3 * a.x + 3 * mt * mt * t * c.cp1.x + 3 * mt * t * t * c.cp2.x + t ** 3 * c.x,
      y: mt ** 3 * a.y + 3 * mt * mt * t * c.cp1.y + 3 * mt * t * t * c.cp2.y + t ** 3 * c.y,
    };
    total += Math.hypot(point.x - prev.x, point.y - prev.y);
    prev = point;
  }
  return total;
}

/** Tangents point back along the segment, as tldraw's do. */
function segmentInfo(previous: Vec, current: DrawCommand): SegmentInfo {
  if (current.type === 'cubic') {
    return {
      tangentStart: uni(sub(current.cp1, previous)),
      tangentEnd: uni(sub(current.cp2, current)),
      length: cubicLength(previous, current),
    };
  }
  const tangent = uni(sub(previous, current));
  return {
    tangentStart: tangent,
    tangentEnd: tangent,
    length: Math.hypot(current.x - previous.x, current.y - previous.y),
  };
}

/** A closed outline ends on its start vertex, which `toDrawD` re-offsets to match. */
function withClose(commands: readonly DrawCommand[]): {
  commands: DrawCommand[];
  closeIdx: number;
} {
  const first = commands[0]!;
  const last = commands.at(-1)!;
  const out = [...commands];
  if (Math.abs(first.x - last.x) > 1e-4 || Math.abs(first.y - last.y) > 1e-4) {
    out.push({ type: 'line', x: first.x, y: first.y });
  }
  return { commands: out, closeIdx: out.length - 1 };
}

/**
 * Hand-drawn SVG path data for one subpath starting with a `move`. The same
 * seed and commands always produce the same string.
 */
export function drawPathData(
  input: readonly DrawCommand[],
  options: DrawPathOptions,
): string {
  if (input.length < 2 || !(options.size > 0)) return '';
  const { seed, size, passes = 2 } = options;
  const defaultOffset = options.offset ?? size / 3;
  const defaultRoundness = size * 2;
  const { commands, closeIdx } = options.closed
    ? withClose(input)
    : { commands: [...input], closeIdx: -1 };

  const info: (SegmentInfo | undefined)[] = commands.map((command, i) =>
    i === 0 ? undefined : segmentInfo(commands[i - 1]!, command),
  );

  const resolved = commands.map((command, i) => {
    const offset = command.offset ?? defaultOffset;
    const roundness = command.roundness ?? defaultRoundness;
    const nextIdx =
      i === closeIdx ? 1 : i + 1 < commands.length ? i + 1 : undefined;
    const current = info[i];
    const next = nextIdx === undefined ? undefined : info[nextIdx];
    const nextType = nextIdx === undefined ? undefined : commands[nextIdx]!.type;
    const tangentToPrev = current?.tangentEnd;
    const tangentToNext = next?.tangentStart;
    const rounds =
      command.type !== 'cubic' &&
      nextType !== undefined &&
      nextType !== 'cubic' &&
      tangentToPrev &&
      tangentToNext &&
      len2(tangentToPrev) > 0.01 &&
      len2(tangentToNext) > 0.01;
    // Full roundness up to a right angle, none at a hairpin.
    const roundnessForAngle = rounds
      ? clamp(
          roundness +
            ((Math.abs(angleBetween(tangentToPrev, tangentToNext)) - Math.PI / 2) /
              (Math.PI / 2)) *
              -roundness,
          0,
          roundness,
        )
      : 0;
    const shortest = Math.min(
      current?.length ?? Infinity,
      next?.length ?? Infinity,
    );
    return {
      command,
      offsetAmount: clamp(offset, 0, (shortest - roundnessForAngle * 2) / 4),
      roundnessBefore: Math.min(
        roundnessForAngle,
        (current?.length ?? Infinity) / 4,
      ),
      roundnessAfter: Math.min(
        roundnessForAngle,
        (next?.length ?? Infinity) / 4,
      ),
      tangentToPrev,
      tangentToNext,
    };
  });
  // The start vertex is also the closing corner: it begins past the rounding.
  if (closeIdx >= 0) resolved[0]!.roundnessAfter = resolved[closeIdx]!.roundnessAfter;

  const path = new PathBuilder();
  for (let pass = 0; pass < passes; pass++) {
    const random = rng(seed + pass);
    let startOffset: Vec = { x: 0, y: 0 };
    for (const [i, v] of resolved.entries()) {
      const { command } = v;
      let offset: Vec;
      if (i === closeIdx) {
        offset = startOffset;
      } else {
        const direction = uni({ x: random(), y: random() });
        const magnitude = Math.sqrt(Math.abs(random())) * v.offsetAmount;
        offset = { x: direction.x * magnitude, y: direction.y * magnitude };
      }
      if (command.type === 'move') startOffset = offset;

      const at = { x: command.x + offset.x, y: command.y + offset.y };
      const end =
        v.tangentToNext && v.roundnessAfter > 0
          ? {
              x: at.x - v.tangentToNext.x * v.roundnessAfter,
              y: at.y - v.tangentToNext.y * v.roundnessAfter,
            }
          : at;
      const start =
        v.tangentToPrev && v.roundnessBefore > 0
          ? {
              x: at.x + v.tangentToPrev.x * v.roundnessBefore,
              y: at.y + v.tangentToPrev.y * v.roundnessBefore,
            }
          : at;
      const rounded = end !== at && start !== at;

      if (command.type === 'move') path.move(end);
      else if (command.type === 'line') {
        if (rounded) path.line(start).quadratic(at, end);
        else path.line(end);
      } else {
        path.cubic(
          { x: command.cp1.x + offset.x, y: command.cp1.y + offset.y },
          { x: command.cp2.x + offset.x, y: command.cp2.y + offset.y },
          rounded ? at : end,
        );
      }
    }
  }
  return path.toD();
}

/**
 * A polyline as draw commands. `endOffset` overrides the jitter at the two
 * ends of an open line, which tldraw pins so the line still meets what it was
 * drawn to.
 */
export function polylineDrawCommands(
  points: readonly Vec[],
  opts: { endOffset?: number; offset?: number; roundness?: number } = {},
): DrawCommand[] {
  const { endOffset, offset, roundness } = opts;
  return points.map((point, i): DrawCommand => ({
    type: i === 0 ? 'move' : 'line',
    x: point.x,
    y: point.y,
    offset: i === 0 || i === points.length - 1 ? (endOffset ?? offset) : offset,
    roundness,
  }));
}

/**
 * An ellipse as four quarter-arc cubics clockwise from its left-most point —
 * tldraw's two half-arcs after its `arcTo` splits them at every 90°.
 */
export function ellipseDrawCommands(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): DrawCommand[] {
  const handle = (4 / 3) * Math.tan(Math.PI / 8);
  const at = (t: number) => ({ x: cx + rx * Math.cos(t), y: cy + ry * Math.sin(t) });
  const tangent = (t: number) => ({ x: -rx * Math.sin(t), y: ry * Math.cos(t) });
  const commands: DrawCommand[] = [{ type: 'move', ...at(Math.PI) }];
  for (let i = 0; i < 4; i++) {
    const t1 = Math.PI + (i * Math.PI) / 2;
    const t2 = t1 + Math.PI / 2;
    const a = at(t1);
    const b = at(t2);
    const d1 = tangent(t1);
    const d2 = tangent(t2);
    commands.push({
      type: 'cubic',
      ...b,
      cp1: { x: a.x + handle * d1.x, y: a.y + handle * d1.y },
      cp2: { x: b.x - handle * d2.x, y: b.y - handle * d2.y },
    });
  }
  return commands;
}
