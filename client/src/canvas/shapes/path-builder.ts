import type { Vec } from '@whiteboard/shared';
import { CentiPixelPathWriter, toCenti } from './fmt';

type MoveCommand = { type: 'move'; to: Vec };
type LineCommand = { type: 'line'; to: Vec };
type QuadraticCommand = { type: 'quadratic'; control: Vec; to: Vec };
type CubicCommand = { type: 'cubic'; control1: Vec; control2: Vec; to: Vec };
type ArcCommand = {
  type: 'arc';
  radiusX: number;
  radiusY: number;
  rotation: number;
  largeArc: boolean;
  sweep: boolean;
  to: Vec;
};
type CloseCommand = { type: 'close' };

export type PathCommand =
  | MoveCommand
  | LineCommand
  | QuadraticCommand
  | CubicCommand
  | ArcCommand
  | CloseCommand;

const writer = new CentiPixelPathWriter();
const TAU = Math.PI * 2;

function copy(point: Vec): Vec {
  return { x: point.x, y: point.y };
}

function distance(a: Vec, b: Vec): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function pointOnQuadratic(a: Vec, control: Vec, b: Vec, t: number): Vec {
  const mt = 1 - t;
  return {
    x: mt * mt * a.x + 2 * mt * t * control.x + t * t * b.x,
    y: mt * mt * a.y + 2 * mt * t * control.y + t * t * b.y,
  };
}

function pointOnCubic(
  a: Vec,
  control1: Vec,
  control2: Vec,
  b: Vec,
  t: number,
): Vec {
  const mt = 1 - t;
  const mt2 = mt * mt;
  const t2 = t * t;
  return {
    x:
      mt2 * mt * a.x +
      3 * mt2 * t * control1.x +
      3 * mt * t2 * control2.x +
      t2 * t * b.x,
    y:
      mt2 * mt * a.y +
      3 * mt2 * t * control1.y +
      3 * mt * t2 * control2.y +
      t2 * t * b.y,
  };
}

function signedAngle(ux: number, uy: number, vx: number, vy: number): number {
  return Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
}

interface CenterArc {
  center: Vec;
  radiusX: number;
  radiusY: number;
  rotation: number;
  startAngle: number;
  delta: number;
}

/** Convert SVG's endpoint arc representation to a center representation. */
function centerArc(from: Vec, command: ArcCommand): CenterArc | null {
  let radiusX = Math.abs(command.radiusX);
  let radiusY = Math.abs(command.radiusY);
  if (radiusX === 0 || radiusY === 0 || distance(from, command.to) === 0) {
    return null;
  }

  const rotation = (command.rotation * Math.PI) / 180;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  const halfX = (from.x - command.to.x) / 2;
  const halfY = (from.y - command.to.y) / 2;
  const localX = cos * halfX + sin * halfY;
  const localY = -sin * halfX + cos * halfY;

  const scale =
    (localX * localX) / (radiusX * radiusX) +
    (localY * localY) / (radiusY * radiusY);
  if (scale > 1) {
    const factor = Math.sqrt(scale);
    radiusX *= factor;
    radiusY *= factor;
  }

  const rx2 = radiusX * radiusX;
  const ry2 = radiusY * radiusY;
  const x2 = localX * localX;
  const y2 = localY * localY;
  const denominator = rx2 * y2 + ry2 * x2;
  const numerator = Math.max(0, rx2 * ry2 - denominator);
  const sign = command.largeArc === command.sweep ? -1 : 1;
  const coefficient =
    denominator > 0 ? sign * Math.sqrt(numerator / denominator) : 0;
  const centerLocalX = (coefficient * radiusX * localY) / radiusY;
  const centerLocalY = (-coefficient * radiusY * localX) / radiusX;
  const center = {
    x: cos * centerLocalX - sin * centerLocalY + (from.x + command.to.x) / 2,
    y: sin * centerLocalX + cos * centerLocalY + (from.y + command.to.y) / 2,
  };

  const startX = (localX - centerLocalX) / radiusX;
  const startY = (localY - centerLocalY) / radiusY;
  const endX = (-localX - centerLocalX) / radiusX;
  const endY = (-localY - centerLocalY) / radiusY;
  const startAngle = signedAngle(1, 0, startX, startY);
  let delta = signedAngle(startX, startY, endX, endY);
  if (!command.sweep && delta > 0) delta -= TAU;
  if (command.sweep && delta < 0) delta += TAU;

  return { center, radiusX, radiusY, rotation, startAngle, delta };
}

function pointOnArc(arc: CenterArc, t: number): Vec {
  const angle = arc.startAngle + arc.delta * t;
  const localX = Math.cos(angle) * arc.radiusX;
  const localY = Math.sin(angle) * arc.radiusY;
  const cos = Math.cos(arc.rotation);
  const sin = Math.sin(arc.rotation);
  return {
    x: arc.center.x + cos * localX - sin * localY,
    y: arc.center.y + sin * localX + cos * localY,
  };
}

/**
 * Half-interval 12-point Gauss-Legendre nodes and weights, as `[node, weight]`
 * pairs on `[0, 1]` — the abscissae are symmetric about the midpoint, so each
 * pair is evaluated at `0.5 ± node` and both samples take the same weight.
 *
 * Twelve points integrate a degree-23 polynomial exactly. The speed `|B'(t)|`
 * of a curve is a square root and so is not polynomial, but for the curvature a
 * drawn shape can hold the residual is far below the hundredth of a unit the
 * dash lengths are rounded to anyway.
 */
const GAUSS_LEGENDRE: readonly (readonly [number, number])[] = [
  [0.1252334085114689 / 2, 0.2491470458134028],
  [0.3678314989981802 / 2, 0.2334925365383548],
  [0.587317954286617 / 2, 0.2031674267230659],
  [0.7699026741943047 / 2, 0.1600783285433462],
  [0.9041172563704749 / 2, 0.1069393259953184],
  [0.9815606342467192 / 2, 0.0471753363865118],
];

/** Speed of a quadratic Bezier at `t`, as a scalar pair to stay allocation-free. */
function quadraticSpeed(a: Vec, control: Vec, b: Vec, t: number): number {
  const mt = 1 - t;
  const x = 2 * (mt * (control.x - a.x) + t * (b.x - control.x));
  const y = 2 * (mt * (control.y - a.y) + t * (b.y - control.y));
  return Math.hypot(x, y);
}

/** Speed of a cubic Bezier at `t`. */
function cubicSpeed(
  a: Vec,
  control1: Vec,
  control2: Vec,
  b: Vec,
  t: number,
): number {
  const mt = 1 - t;
  const x =
    3 * mt * mt * (control1.x - a.x) +
    6 * mt * t * (control2.x - control1.x) +
    3 * t * t * (b.x - control2.x);
  const y =
    3 * mt * mt * (control1.y - a.y) +
    6 * mt * t * (control2.y - control1.y) +
    3 * t * t * (b.y - control2.y);
  return Math.hypot(x, y);
}

/**
 * Speed along an arc at `t`.
 *
 * The arc's rotation is a rigid transform, so it cannot change a speed and is
 * left out. A circular arc reduces this to the constant `|delta| * radius`,
 * which the quadrature then integrates exactly.
 */
function arcSpeed(arc: CenterArc, t: number): number {
  const angle = arc.startAngle + arc.delta * t;
  return (
    Math.abs(arc.delta) *
    Math.hypot(Math.sin(angle) * arc.radiusX, Math.cos(angle) * arc.radiusY)
  );
}

/** Integrate a speed function over `[0, 1]`. See {@link GAUSS_LEGENDRE}. */
function integrateSpeed(speed: (t: number) => number): number {
  let total = 0;
  for (const [node, weight] of GAUSS_LEGENDRE) {
    total += weight * (speed(0.5 - node) + speed(0.5 + node));
  }
  return total / 2;
}

/** Arc length of one drawing command starting at `from`. */
function segmentLength(from: Vec, command: PathCommand): number {
  switch (command.type) {
    case 'line':
      return distance(from, command.to);
    case 'quadratic':
      return integrateSpeed((t) =>
        quadraticSpeed(from, command.control, command.to, t),
      );
    case 'cubic':
      return integrateSpeed((t) =>
        cubicSpeed(from, command.control1, command.control2, command.to, t),
      );
    case 'arc': {
      const arc = centerArc(from, command);
      return arc
        ? integrateSpeed((t) => arcSpeed(arc, t))
        : distance(from, command.to);
    }
    default:
      return 0;
  }
}

/**
 * Command graph for exact geometric paths.
 *
 * The interface stays deliberately small: callers build commands, serialize
 * once, and can ask for the same geometry flattened for length, hit-testing, or
 * stochastic synthesis. Commands and returned points are copied, so a builder
 * is unaffected by later caller mutation.
 */
export class PathBuilder {
  private readonly commands: PathCommand[] = [];

  move(to: Vec): this {
    this.commands.push({ type: 'move', to: copy(to) });
    return this;
  }

  line(to: Vec): this {
    this.commands.push({ type: 'line', to: copy(to) });
    return this;
  }

  quadratic(control: Vec, to: Vec): this {
    this.commands.push({
      type: 'quadratic',
      control: copy(control),
      to: copy(to),
    });
    return this;
  }

  cubic(control1: Vec, control2: Vec, to: Vec): this {
    this.commands.push({
      type: 'cubic',
      control1: copy(control1),
      control2: copy(control2),
      to: copy(to),
    });
    return this;
  }

  arc(
    radiusX: number,
    radiusY: number,
    rotation: number,
    largeArc: boolean,
    sweep: boolean,
    to: Vec,
  ): this {
    this.commands.push({
      type: 'arc',
      radiusX: Math.abs(radiusX),
      radiusY: Math.abs(radiusY),
      rotation,
      largeArc,
      sweep,
      to: copy(to),
    });
    return this;
  }

  close(): this {
    this.commands.push({ type: 'close' });
    return this;
  }

  getCommands(): readonly PathCommand[] {
    return this.commands;
  }

  toD(): string {
    writer.reset(this.commands.length * 48 + 32);
    for (const command of this.commands) {
      switch (command.type) {
        case 'move':
          writer.moveTo(toCenti(command.to.x), toCenti(command.to.y));
          break;
        case 'line':
          writer.lineTo(toCenti(command.to.x), toCenti(command.to.y));
          break;
        case 'quadratic':
          writer.quadraticTo(
            toCenti(command.control.x),
            toCenti(command.control.y),
            toCenti(command.to.x),
            toCenti(command.to.y),
          );
          break;
        case 'cubic':
          writer.cubicTo(
            toCenti(command.control1.x),
            toCenti(command.control1.y),
            toCenti(command.control2.x),
            toCenti(command.control2.y),
            toCenti(command.to.x),
            toCenti(command.to.y),
          );
          break;
        case 'arc':
          writer.ellipticArcTo(
            toCenti(command.radiusX),
            toCenti(command.radiusY),
            toCenti(command.rotation),
            command.largeArc,
            command.sweep,
            toCenti(command.to.x),
            toCenti(command.to.y),
          );
          break;
        case 'close':
          writer.close();
          break;
      }
    }
    return writer.finish();
  }

  /** Flatten the command graph, preserving each move as a new subpath break. */
  toPolylines(curveSteps = 16): Vec[][] {
    const steps = Math.max(2, Math.floor(curveSteps));
    const paths: Vec[][] = [];
    let path: Vec[] | null = null;
    let current: Vec | null = null;
    let start: Vec | null = null;

    const append = (point: Vec) => {
      if (!path) {
        path = [];
        paths.push(path);
      }
      path.push(copy(point));
      current = point;
    };

    for (const command of this.commands) {
      if (command.type === 'move') {
        path = [];
        paths.push(path);
        append(command.to);
        start = command.to;
        continue;
      }
      if (!current) continue;
      if (command.type === 'line') {
        append(command.to);
      } else if (command.type === 'quadratic') {
        const from = current;
        for (let i = 1; i <= steps; i++) {
          append(
            pointOnQuadratic(from, command.control, command.to, i / steps),
          );
        }
      } else if (command.type === 'cubic') {
        const from = current;
        for (let i = 1; i <= steps; i++) {
          append(
            pointOnCubic(
              from,
              command.control1,
              command.control2,
              command.to,
              i / steps,
            ),
          );
        }
      } else if (command.type === 'arc') {
        const arc = centerArc(current, command);
        if (!arc) {
          append(command.to);
        } else {
          const arcSteps = Math.max(
            2,
            Math.ceil((Math.abs(arc.delta) / TAU) * steps * 4),
          );
          for (let i = 1; i <= arcSteps; i++)
            append(pointOnArc(arc, i / arcSteps));
        }
      } else if (command.type === 'close' && start) {
        if (distance(current, start) > 0) append(start);
        current = start;
      }
    }
    return paths.filter((points) => points.length > 0);
  }

  /**
   * Arc length of the command graph, integrated on the curves themselves.
   *
   * Measuring a flattened copy instead always reports short — a chord is the
   * shortest path between its endpoints — and by an amount that depends on how
   * many steps the flattener was given and how sharply the curve bends. That
   * error lands directly on the dash distribution, which fits a whole number
   * of dashes to this length: at 16 steps a small, tight arc came back about a
   * percent short, enough to drop a dash from the fit and visibly change the
   * spacing on a shape while it was being resized. See {@link segmentLength}.
   */
  length(): number {
    let total = 0;
    let current: Vec | null = null;
    let start: Vec | null = null;

    for (const command of this.commands) {
      if (command.type === 'move') {
        current = command.to;
        start = command.to;
        continue;
      }
      if (!current) continue;
      if (command.type === 'close') {
        if (start) {
          total += distance(current, start);
          current = start;
        }
        continue;
      }
      total += segmentLength(current, command);
      current = command.to;
    }
    return total;
  }
}
