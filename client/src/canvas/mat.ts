// 2D affine transforms as 3x3 homogeneous matrices in compact 6-parameter form:
//
//     | a  c  e |
//     | b  d  f |
//     | 0  0  1 |
//
// This is the same (a, b, c, d, e, f) ordering used by CSS `matrix()`, SVG
// `matrix()`, and DOMMatrix, so a Mat can be handed to the DOM without
// reshuffling. Operations return new instances — the rest of the geometry layer
// is immutable and the sharing bugs from in-place mutation are not worth the
// allocation saved.

import type { Point } from '@whiteboard/shared';

/** The plain-object form of a matrix, for serialization and cheap literals. */
export interface MatModel {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Scale, rotation, and translation recovered from an affine matrix. */
export interface MatDecomposition {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  /** Radians. */
  rotation: number;
}

export class Mat implements MatModel {
  constructor(
    public readonly a = 1,
    public readonly b = 0,
    public readonly c = 0,
    public readonly d = 1,
    public readonly e = 0,
    public readonly f = 0,
  ) {}

  static Identity(): Mat {
    return new Mat(1, 0, 0, 1, 0, 0);
  }

  static Translate(x: number, y: number): Mat {
    return new Mat(1, 0, 0, 1, x, y);
  }

  /** Uniform when `y` is omitted. */
  static Scale(x: number, y = x): Mat {
    return new Mat(x, 0, 0, y, 0, 0);
  }

  /** Rotation by `radians` about the origin, or about `center` when given. */
  static Rotate(radians: number, center?: Point): Mat {
    const cos = Math.cos(radians);
    const sin = Math.sin(radians);
    if (!center) return new Mat(cos, sin, -sin, cos, 0, 0);
    // Translate to origin, rotate, translate back — folded into one matrix.
    return new Mat(
      cos,
      sin,
      -sin,
      cos,
      center.x - center.x * cos + center.y * sin,
      center.y - center.x * sin - center.y * cos,
    );
  }

  static from(m: MatModel): Mat {
    return new Mat(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  /**
   * Compose left-to-right: `Mat.Compose(A, B)` applies B first, then A — the
   * same order as the matrix product A x B.
   */
  static Compose(...matrices: MatModel[]): Mat {
    let acc = Mat.Identity();
    for (const m of matrices) acc = acc.multiply(m);
    return acc;
  }

  /** This matrix times `m` (i.e. `m` is applied to a point first). */
  multiply(m: MatModel): Mat {
    const { a, b, c, d, e, f } = this;
    return new Mat(
      a * m.a + c * m.b,
      b * m.a + d * m.b,
      a * m.c + c * m.d,
      b * m.c + d * m.d,
      a * m.e + c * m.f + e,
      b * m.e + d * m.f + f,
    );
  }

  /**
   * The inverse transform. Throws on a singular (non-invertible) matrix rather
   * than returning Infinity-filled garbage that would silently poison every
   * downstream coordinate.
   */
  invert(): Mat {
    const { a, b, c, d, e, f } = this;
    const det = a * d - b * c;
    if (det === 0 || !Number.isFinite(det)) {
      throw new Error('Mat.invert: matrix is not invertible (determinant 0)');
    }
    return new Mat(
      d / det,
      -b / det,
      -c / det,
      a / det,
      (c * f - d * e) / det,
      (b * e - a * f) / det,
    );
  }

  applyToPoint(p: Point): Point {
    return {
      x: this.a * p.x + this.c * p.y + this.e,
      y: this.b * p.x + this.d * p.y + this.f,
    };
  }

  applyToPoints(points: readonly Point[]): Point[] {
    return points.map((p) => this.applyToPoint(p));
  }

  /**
   * Recover translation, scale, and rotation.
   *
   * `scaleX` is the length of the transformed x-axis basis vector (a, b) and
   * the rotation is that vector's angle; `scaleY` then falls out of the
   * determinant (which is the signed area scale, `scaleX * scaleY`). A matrix
   * carrying shear cannot be represented by this triple and will not round-trip
   * exactly — decomposition assumes a rotate/scale/translate composition.
   */
  decompose(): MatDecomposition {
    const { a, b, c, d, e, f } = this;
    const scaleX = Math.hypot(a, b);
    return {
      x: e,
      y: f,
      scaleX,
      scaleY: scaleX === 0 ? 0 : (a * d - b * c) / scaleX,
      rotation: Math.atan2(b, a),
    };
  }

  equals(m: MatModel): boolean {
    return (
      this.a === m.a &&
      this.b === m.b &&
      this.c === m.c &&
      this.d === m.d &&
      this.e === m.e &&
      this.f === m.f
    );
  }

  toModel(): MatModel {
    const { a, b, c, d, e, f } = this;
    return { a, b, c, d, e, f };
  }

  /** CSS/SVG `matrix(...)` string. */
  toCss(): string {
    const { a, b, c, d, e, f } = this;
    return `matrix(${a}, ${b}, ${c}, ${d}, ${e}, ${f})`;
  }
}
