/**
 * The loading veil's brush figure, built once at module load.
 *
 * Three strokes, one per wait, traced from a hand-drawn reference: an arch
 * coming down hard into a point, a flick back up and out to the right, and a
 * drop that swings away along the bottom. Each is painted in the direction it
 * was drawn, so the figure fills in the order and the directions a hand would
 * lay it down.
 *
 * Everything is deterministic (fixed noise offsets), so the figure is the
 * same on every load and in every test snapshot: a hand-made thing that
 * reshuffled itself each visit would read as generated, not drawn. The cost is
 * a few thousand noise samples, paid once; nothing is recomputed per render.
 *
 * Each stroke yields two paths. `outline` is the silhouette — the traced
 * spine plus a low wobble, a width that follows the pen's pressure, nicked
 * edges, uneven round ends and a few dry-brush gaps — used as a clip path.
 * `pass` is one fat line down the same spine that paints the silhouette in.
 * It overshoots both ends so its round caps never show; the clip, not the
 * pass, owns the shape.
 */

type Pt = [number, number];

type StrokeSpec = {
  /** Spine through the reference drawing, in drawing pixels, in the order it
   *  was drawn. */
  points: Pt[];
  /** Full thickness where the stroke lands and where it lifts. */
  from: number;
  to: number;
  /** Decorrelates this stroke's noise from the others'. */
  seed: number;
  /** Dry-brush gaps: span along the stroke, then lateral position and
   *  half-width as fractions of the local half-thickness. */
  streaks: { t0: number; t1: number; lat: number; w: number }[];
};

const STROKES: StrokeSpec[] = [
  {
    points: [
      [135, 200],
      [210, 172],
      [265, 172],
      [330, 198],
      [382, 240],
      [424, 292],
      [462, 368],
      [484, 440],
      [492, 512],
      [497, 588],
    ],
    from: 22,
    to: 44,
    seed: 1,
    streaks: [
      { t0: 0.3, t1: 0.62, lat: -0.42, w: 0.07 },
      { t0: 0.48, t1: 0.9, lat: 0.3, w: 0.08 },
      { t0: 0.6, t1: 0.82, lat: -0.05, w: 0.06 },
    ],
  },
  {
    points: [
      [533, 597],
      [556, 540],
      [592, 470],
      [642, 404],
      [720, 320],
      [830, 236],
      [950, 186],
      [1082, 162],
    ],
    from: 18,
    to: 38,
    seed: 2,
    streaks: [
      { t0: 0.22, t1: 0.5, lat: 0.35, w: 0.07 },
      { t0: 0.4, t1: 0.78, lat: -0.3, w: 0.08 },
      { t0: 0.62, t1: 0.92, lat: 0.1, w: 0.06 },
    ],
  },
  {
    points: [
      [1111, 212],
      [1110, 292],
      [1124, 380],
      [1160, 462],
      [1222, 532],
      [1320, 586],
      [1420, 616],
      [1490, 634],
    ],
    from: 30,
    to: 34,
    seed: 3,
    streaks: [
      { t0: 0.16, t1: 0.44, lat: -0.3, w: 0.07 },
      { t0: 0.5, t1: 0.86, lat: 0.34, w: 0.08 },
      { t0: 0.7, t1: 0.95, lat: -0.12, w: 0.06 },
    ],
  },
];

/** Spine samples per drawing pixel of length. */
const DENSITY = 1 / 5;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = mulberry32(0x5eed_b7a5);
const lattice = Array.from({ length: 256 }, () => rand() * 2 - 1);

/** Smooth 1D value noise in [-1, 1], defined for any t. */
function noise(t: number) {
  const i = Math.floor(t);
  const f = t - i;
  const a = lattice[((i % 256) + 256) % 256]!;
  const b = lattice[(((i + 1) % 256) + 256) % 256]!;
  return a + (b - a) * f * f * (3 - 2 * f);
}

function fbm(t: number, octaves: number) {
  let sum = 0;
  let amp = 0.5;
  let freq = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(t * freq + o * 37.1);
    amp *= 0.5;
    freq *= 2.1;
  }
  return sum;
}

function catmullRom(p0: Pt, p1: Pt, p2: Pt, p3: Pt, t: number): Pt {
  const t2 = t * t;
  const t3 = t2 * t;
  const f = (a: number, b: number, c: number, d: number) =>
    0.5 *
    (2 * b +
      (c - a) * t +
      (2 * a - 5 * b + 4 * c - d) * t2 +
      (3 * b - a - 3 * c + d) * t3);
  return [f(p0[0], p1[0], p2[0], p3[0]), f(p0[1], p1[1], p2[1], p3[1])];
}

/** The spine as evenly spaced samples, so noise frequencies mean the same
 *  thing along a tight curve as along a straight run. */
function resampleSpine(points: Pt[]): Pt[] {
  const dense: Pt[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[Math.max(0, i - 1)]!;
    const p3 = points[Math.min(points.length - 1, i + 2)]!;
    for (let s = 0; s < 32; s++) {
      dense.push(catmullRom(p0, points[i]!, points[i + 1]!, p3, s / 32));
    }
  }
  dense.push(points[points.length - 1]!);

  const lengths = [0];
  for (let i = 1; i < dense.length; i++) {
    const [ax, ay] = dense[i - 1]!;
    const [bx, by] = dense[i]!;
    lengths.push(lengths[i - 1]! + Math.hypot(bx - ax, by - ay));
  }
  const total = lengths[lengths.length - 1]!;
  const n = Math.max(24, Math.round(total * DENSITY));
  const out: Pt[] = [];
  let j = 0;
  for (let k = 0; k <= n; k++) {
    const at = (total * k) / n;
    while (j < dense.length - 2 && lengths[j + 1]! < at) j++;
    const span = lengths[j + 1]! - lengths[j]! || 1;
    const f = (at - lengths[j]!) / span;
    const [ax, ay] = dense[j]!;
    const [bx, by] = dense[j + 1]!;
    out.push([ax + (bx - ax) * f, ay + (by - ay) * f]);
  }
  return out;
}

/** Unit normals by central difference. */
function normals(pts: Pt[]): Pt[] {
  return pts.map((_, i) => {
    const [ax, ay] = pts[Math.max(0, i - 1)]!;
    const [bx, by] = pts[Math.min(pts.length - 1, i + 1)]!;
    const len = Math.hypot(bx - ax, by - ay) || 1;
    return [-(by - ay) / len, (bx - ax) / len];
  });
}

const smoothstep = (x: number) => x * x * (3 - 2 * x);

/** Edge roughness: fine tooth everywhere, plus sharp nicks where a bristle
 *  skipped. Coarser than a real brush would show, because the figure is drawn
 *  at about a quarter of the reference's size. */
function edge(t: number, side: number, seed: number) {
  const k = seed * 53 + side * 91;
  const tooth = 0.1 * fbm(t * 38 + k, 3) + 0.05 * noise(t * 110 + k);
  const nick = Math.max(0, noise(t * 17 + k) - 0.55) * -0.9;
  return 1 + tooth + nick;
}

/** An outline can swing at most this far past the local half-thickness. */
const MAX_REACH = 1.25;

export type BrushStroke = { outline: string; pass: string; passWidth: number };

function buildStroke({ points, from, to, seed, streaks }: StrokeSpec) {
  const base = resampleSpine(points);
  const baseN = normals(base);
  const last = base.length - 1;
  const halfWidth = base.map((_, i) => {
    const t = i / last;
    const pressure = from + (to - from) * smoothstep(t);
    return (pressure / 2) * (1 + 0.1 * fbm(t * 3 + seed * 19, 2));
  });

  // A low wobble off the traced line: the reference is a clean pen stroke,
  // and a brush never holds a curve that evenly.
  const spine = base.map(([x, y], i): Pt => {
    const off = halfWidth[i]! * 0.35 * fbm((i / last) * 4 + seed * 7, 2);
    return [x + baseN[i]![0] * off, y + baseN[i]![1] * off];
  });
  const n = normals(spine);

  const top: Pt[] = [];
  const bottom: Pt[] = [];
  spine.forEach(([x, y], i) => {
    const t = i / last;
    const hw = halfWidth[i]!;
    const up = Math.min(hw * edge(t, 1, seed), hw * MAX_REACH);
    const down = Math.min(hw * edge(t, -1, seed), hw * MAX_REACH);
    top.push([x - n[i]![0] * up, y - n[i]![1] * up]);
    bottom.push([x + n[i]![0] * down, y + n[i]![1] * down]);
  });

  // Uneven round ends: around the lifting end (dir 1) from the top edge to
  // the bottom one, then around the landing end (dir -1) back to the top.
  const cap = (i: number, dir: 1 | -1) => {
    const [x, y] = spine[i]!;
    const [nx, ny] = n[i]!;
    const [tx, ty] = [ny, -nx];
    const out: Pt[] = [];
    for (let k = 1; k < 10; k++) {
      const a = (Math.PI * k) / 10;
      const r = halfWidth[i]! * (1 + 0.12 * noise(k * 1.9 + seed * 11 + dir));
      const c = Math.cos(a) * dir;
      const s = Math.sin(a) * dir;
      out.push([x + (-nx * c + tx * s) * r, y + (-ny * c + ty * s) * r]);
    }
    return out;
  };
  const ring = [...top, ...cap(last, 1), ...bottom.reverse(), ...cap(0, -1)];

  // Dry-brush gaps, cut out with `clip-rule="evenodd"`, so they must stay
  // inside the outline.
  const holes = streaks.map(({ t0, t1, lat, w }) => {
    const a: Pt[] = [];
    const b: Pt[] = [];
    const i0 = Math.round(t0 * last);
    const i1 = Math.round(t1 * last);
    for (let i = i0; i <= i1; i++) {
      const [x, y] = spine[i]!;
      const [nx, ny] = n[i]!;
      const hw = halfWidth[i]!;
      const off = hw * (lat + 0.06 * noise(i * 0.8 + lat * 50));
      const half = hw * w * Math.sin((Math.PI * (i - i0)) / (i1 - i0));
      a.push([x + nx * (off - half), y + ny * (off - half)]);
      b.push([x + nx * (off + half), y + ny * (off + half)]);
    }
    return toPath([...a, ...b.reverse()], true);
  });

  // The pass: wide enough for the widest swing of the outline, run out past
  // both ends along the tangent far enough that its round caps sit clear of
  // the silhouette's own ends.
  const passWidth = 2 * Math.max(...halfWidth) * (MAX_REACH + 0.1);
  const extend = (i: number, j: number): Pt => {
    const [x, y] = spine[i]!;
    const [px, py] = spine[j]!;
    const len = Math.hypot(x - px, y - py) || 1;
    const d = halfWidth[i]! * 1.2 + passWidth / 2 + 2;
    return [x + ((x - px) / len) * d, y + ((y - py) / len) * d];
  };
  const pass = toPath([extend(0, 1), ...spine, extend(last, last - 1)], false);

  return {
    outline: `${toPath(ring, true)} ${holes.join(' ')}`,
    pass,
    passWidth,
    ring,
  };
}

function toPath(pts: Pt[], close: boolean) {
  const d = pts
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join('');
  return close ? `${d}Z` : d;
}

const built = STROKES.map(buildStroke);

export const BRUSH_STROKES: readonly BrushStroke[] = built.map(
  ({ outline, pass, passWidth }) => ({ outline, pass, passWidth }),
);

const extent = built.flatMap((s) => s.ring);
const PAD = 4;
const minX = Math.min(...extent.map((p) => p[0])) - PAD;
const minY = Math.min(...extent.map((p) => p[1])) - PAD;
const maxX = Math.max(...extent.map((p) => p[0])) + PAD;
const maxY = Math.max(...extent.map((p) => p[1])) + PAD;

export const BRUSH_VIEW_BOX = [minX, minY, maxX - minX, maxY - minY]
  .map((v) => v.toFixed(1))
  .join(' ');
