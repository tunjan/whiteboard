import type { Vec } from '@whiteboard/shared';
import { PathBuilder } from './path-builder';

export interface DrawSynthesisOptions {
  /** Stable shape id or another persistent key. */
  seed: string;
  size: number;
  closed?: boolean;
  passes?: number;
}

const DEFAULT_PASSES = 2;

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Small deterministic PRNG; one seed is created for each shape/pass pair. */
function randomFor(seed: string): () => number {
  let state = hashString(seed) || 0x6d2b79f5;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function length(x: number, y: number): number {
  return Math.hypot(x, y);
}

function unit(from: Vec, to: Vec): Vec {
  const x = to.x - from.x;
  const y = to.y - from.y;
  const magnitude = length(x, y) || 1;
  return { x: x / magnitude, y: y / magnitude };
}

function distance(a: Vec, b: Vec): number {
  return length(b.x - a.x, b.y - a.y);
}

function displaced(points: readonly Vec[], seed: string, size: number): Vec[] {
  const random = randomFor(seed);
  const maximum = Math.max(0, size) / 3;
  return points.map((point) => {
    let x = random() - 0.5;
    let y = random() - 0.5;
    const directionLength = length(x, y);
    if (directionLength === 0) {
      x = 1;
      y = 0;
    } else {
      x /= directionLength;
      y /= directionLength;
    }
    const magnitude = Math.sqrt(random()) * maximum;
    return { x: point.x + x * magnitude, y: point.y + y * magnitude };
  });
}

function cornerRadius(
  previous: Vec,
  point: Vec,
  next: Vec,
  baseRadius: number,
): number {
  const towardPrevious = unit(point, previous);
  const towardNext = unit(point, next);
  const dot = Math.max(
    -1,
    Math.min(
      1,
      towardPrevious.x * towardNext.x + towardPrevious.y * towardNext.y,
    ),
  );
  const interior = Math.acos(dot);
  // A right angle receives the full radius; a straight continuation none.
  const modulation = Math.max(
    0,
    Math.min(1, (Math.PI - interior) / (Math.PI / 2)),
  );
  return Math.min(
    baseRadius * modulation,
    distance(previous, point) / 4,
    distance(point, next) / 4,
  );
}

interface RoundedVertex {
  point: Vec;
  before: Vec;
  after: Vec;
}

function roundedVertices(
  points: readonly Vec[],
  closed: boolean,
  size: number,
): RoundedVertex[] {
  const baseRadius = Math.max(1.5, size * 1.5);
  return points.map((point, index) => {
    const previous = points[index - 1] ?? (closed ? points.at(-1) : undefined);
    const next = points[index + 1] ?? (closed ? points[0] : undefined);
    if (!previous || !next) return { point, before: point, after: point };
    const radius = cornerRadius(previous, point, next, baseRadius);
    const incoming = unit(point, previous);
    const outgoing = unit(point, next);
    return {
      point,
      before: {
        x: point.x + incoming.x * radius,
        y: point.y + incoming.y * radius,
      },
      after: {
        x: point.x + outgoing.x * radius,
        y: point.y + outgoing.y * radius,
      },
    };
  });
}

function pathForPass(
  input: readonly Vec[],
  closed: boolean,
  size: number,
  seed: string,
): string {
  if (input.length < 2) return '';
  const points = displaced(input, seed, size);
  const vertices = roundedVertices(points, closed, size);
  const path = new PathBuilder();

  if (closed) {
    const first = vertices[0]!;
    path.move(first.after);
    for (let index = 1; index < vertices.length; index++) {
      const vertex = vertices[index]!;
      path.line(vertex.before).quadratic(vertex.point, vertex.after);
    }
    path.line(first.before).quadratic(first.point, first.after).close();
  } else {
    path.move(vertices[0]!.point);
    for (let index = 1; index < vertices.length - 1; index++) {
      const vertex = vertices[index]!;
      path.line(vertex.before).quadratic(vertex.point, vertex.after);
    }
    path.line(vertices.at(-1)!.point);
  }
  return path.toD();
}

/**
 * Stable, multi-pass hand-drawn geometry for a polyline or closed perimeter.
 * The same seed and points always produce byte-identical SVG paths.
 */
export function synthesizeDrawPaths(
  points: readonly Vec[],
  options: DrawSynthesisOptions,
): string[] {
  if (points.length < 2 || !(options.size > 0)) return [];
  const closed = options.closed === true;
  const normalized =
    closed &&
    points.length > 2 &&
    points[0]!.x === points.at(-1)!.x &&
    points[0]!.y === points.at(-1)!.y
      ? points.slice(0, -1)
      : points;
  const passes = Math.max(1, Math.floor(options.passes ?? DEFAULT_PASSES));
  const output: string[] = [];
  for (let pass = 0; pass < passes; pass++) {
    const path = pathForPass(
      normalized,
      closed,
      options.size,
      `${options.seed}:${pass}`,
    );
    if (path) output.push(path);
  }
  return output;
}

/** Vertices for a closed ellipse perimeter, suitable for draw synthesis. */
export function ellipseSynthesisPoints(
  centerX: number,
  centerY: number,
  radiusX: number,
  radiusY: number,
  count = 32,
): Vec[] {
  const samples = Math.max(12, Math.floor(count));
  return Array.from({ length: samples }, (_, index) => {
    const angle = (index / samples) * Math.PI * 2;
    return {
      x: centerX + Math.cos(angle) * radiusX,
      y: centerY + Math.sin(angle) * radiusY,
    };
  });
}
