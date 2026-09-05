import type { Point } from '@whiteboard/shared';

/** Column-vector affine matrix, in the same order as CSS matrix(). */
export type Matrix = readonly [number, number, number, number, number, number];

export function multiply(a: Matrix, b: Matrix): Matrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5],
  ];
}

export function inverse(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (Math.abs(det) < Number.EPSILON)
    throw new Error('Singular canvas transform');
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function transformPoint(m: Matrix, p: Point): Point {
  return {
    x: m[0] * p.x + m[2] * p.y + m[4],
    y: m[1] * p.x + m[3] * p.y + m[5],
  };
}

export function rotationAt(
  x: number,
  y: number,
  angle: number,
  cx: number,
  cy: number,
): Matrix {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return [c, s, -s, c, x + cx - c * cx + s * cy, y + cy - s * cx - c * cy];
}

export function matrixCss(m: Matrix): string {
  return `matrix(${m.join(',')})`;
}
