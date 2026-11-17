/**
 * The loading veil's underline: one brush stroke under the board's title, the
 * way a tutor underlines the heading before the lesson starts.
 *
 * What makes it read as a hand rather than a rule is all here: the brush
 * lands light and swells to full load, the line sags a hair in the middle and
 * drifts uphill as the wrist travels, it overshoots the title at both ends,
 * and it leaves the paper on an upward flick that thins and runs dry.
 *
 * Seeded per board (from the title), so every board has its own underline and
 * keeps it: the same board loads with the same mark every time, while a
 * figure that reshuffled itself on each visit would read as generated, not
 * drawn.
 *
 * The stroke yields two paths. `outline` is the silhouette — spine plus a low
 * wobble, a width that follows the pressure, a toothed edge, uneven round ends
 * and a few dry-brush gaps in the flick — used as a clip path. `pass` is one
 * fat line down the same spine that paints the silhouette in, in the direction
 * it was drawn. It overshoots both ends so its round caps never show; the
 * clip, not the pass, owns the shape.
 */

type Pt = [number, number];

/** Full brush load, in px: about a quarter of the title's 24px type, heavy
 *  enough to carry texture without outweighing the words. */
const LOAD = 6;

/** Spine samples per px of length. */
const DENSITY = 1 / 3;

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
 *  thing along the tight flick as along the long run. */
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

const smoothstep = (x: number) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

function pathLength(pts: Pt[]) {
  let sum = 0;
  for (let i = 1; i < pts.length; i++) {
    sum += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  }
  return sum;
}

/** Edge roughness: fine tooth everywhere, plus shallow nicks where a bristle
 *  skipped. Frequencies are per px, so a long title is not smoother. */
function edge(px: number, side: number, seed: number) {
  const k = seed * 53 + side * 91;
  const tooth = 0.1 * fbm(px / 9 + k, 3) + 0.05 * noise(px / 3 + k);
  const nick = Math.max(0, noise(px / 20 + k) - 0.55) * -0.8;
  return 1 + tooth + nick;
}

/** An outline can swing at most this far past the local half-thickness. */
const MAX_REACH = 1.25;

/** A stable seed from a title: same board, same hand. */
export function underlineSeed(title: string): number {
  let h = 2166136261;
  for (let i = 0; i < title.length; i++) {
    h = Math.imul(h ^ title.charCodeAt(i), 16777619);
  }
  return (h >>> 0) % 997;
}

export type Underline = {
  outline: string;
  pass: string;
  passWidth: number;
  /** In the stroke's own px, origin at the title's left edge on the line. */
  viewBox: { x: number; y: number; width: number; height: number };
  /** Where along `pass` (as a fraction of its length, the unit
   *  `pathLength={1}` dashes in) the ink starts, and where the run ends and
   *  the flick begins. Progress is laid between these two; the flick is
   *  saved for the finish. */
  inkStart: number;
  runEnd: number;
};

/** The underline for a title `width` px wide. */
export function underline(width: number, seed: number): Underline {
  const r = mulberry32(seed + 1);
  const w = Math.max(width, 48);
  // Starts a touch before the first letter and runs a touch past the last,
  // which is what a hand does and a border never does.
  const x0 = -w * (0.03 + 0.03 * r());
  const x1 = w * (0.98 + 0.03 * r());
  const drift = w * (0.018 + 0.02 * r());
  const sag = Math.min(w * (0.008 + 0.01 * r()), 4);
  const run: Pt[] = [];
  for (let k = 0; k <= 6; k++) {
    const u = k / 6;
    run.push([x0 + (x1 - x0) * u, -drift * u + sag * Math.sin(Math.PI * u)]);
  }
  // The lift: the wrist turns up and out as the brush leaves the paper. A
  // long shallow curve, not a hook — a sharp turn at the end reads as a tick.
  const f = Math.min(Math.max(w * 0.13, 18), 40);
  const angle = (16 + 10 * r()) * (Math.PI / 180);
  const [ex, ey] = run[run.length - 1]!;
  const flick: Pt[] = [
    [ex + f * 0.5 * Math.cos(angle * 0.4), ey - f * 0.5 * Math.sin(angle * 0.4)],
    [ex + f * Math.cos(angle), ey - f * Math.sin(angle)],
  ];

  const base = resampleSpine([...run, ...flick]);
  const baseN = normals(base);
  const last = base.length - 1;
  const runLen = pathLength(resampleSpine(run));
  const totalLen = pathLength(base);
  const flickAt = runLen / totalLen;

  // Pressure: lands at under half load, swells to full within the first
  // stretch, holds with a slow breathing, then thins hard through the flick.
  const halfWidth = base.map((_, i) => {
    const t = i / last;
    const land = 0.3 + 0.7 * smoothstep(t / 0.16);
    const lift = 1 - 0.85 * smoothstep((t - flickAt + 0.14) / (1 - flickAt + 0.14));
    const breath = 1 + 0.12 * fbm(t * 3 + seed * 0.19, 2);
    return (LOAD / 2) * land * lift * breath;
  });

  // A low wobble off the ideal line: no hand holds a straight that evenly.
  const spine = base.map(([x, y], i): Pt => {
    const off = 0.9 * fbm((i / last) * 3 + seed * 0.07, 2);
    return [x + baseN[i]![0] * off, y + baseN[i]![1] * off];
  });
  const n = normals(spine);
  const along = spine.map((_, i) => (i / last) * totalLen);

  const top: Pt[] = [];
  const bottom: Pt[] = [];
  spine.forEach(([x, y], i) => {
    const hw = halfWidth[i]!;
    const up = Math.min(hw * edge(along[i]!, 1, seed), hw * MAX_REACH);
    const down = Math.min(hw * edge(along[i]!, -1, seed), hw * MAX_REACH);
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
      const rad = halfWidth[i]! * (1 + 0.12 * noise(k * 1.9 + seed * 0.11 + dir));
      const c = Math.cos(a) * dir;
      const s = Math.sin(a) * dir;
      out.push([x + (-nx * c + tx * s) * rad, y + (-ny * c + ty * s) * rad]);
    }
    return out;
  };
  const ring = [...top, ...cap(last, 1), ...bottom.reverse(), ...cap(0, -1)];

  // Dry-brush gaps where the brush is moving fastest and carrying least: the
  // last of the run and into the flick. Cut out with `clip-rule="evenodd"`,
  // so they stay inside the outline.
  const streaks = [
    { t0: flickAt - 0.3, t1: flickAt + 0.02, lat: -0.35 + 0.1 * r(), w: 0.09 },
    { t0: flickAt - 0.16, t1: Math.min(0.97, flickAt + 0.1), lat: 0.28, w: 0.1 },
  ];
  const holes = streaks.map(({ t0, t1, lat, w: sw }) => {
    const a: Pt[] = [];
    const b: Pt[] = [];
    const i0 = Math.round(t0 * last);
    const i1 = Math.round(t1 * last);
    for (let i = i0; i <= i1; i++) {
      const [x, y] = spine[i]!;
      const [nx, ny] = n[i]!;
      const hw = halfWidth[i]!;
      const off = hw * (lat + 0.06 * noise(i * 0.8 + lat * 50));
      const half = hw * sw * Math.sin((Math.PI * (i - i0)) / (i1 - i0));
      a.push([x + nx * (off - half), y + ny * (off - half)]);
      b.push([x + nx * (off + half), y + ny * (off + half)]);
    }
    return toPath([...a, ...b.reverse()], true);
  });

  // The pass: wide enough for the widest swing of the outline, run out past
  // both ends along the tangent far enough that its round caps sit clear of
  // the silhouette's own ends.
  const passWidth = 2 * Math.max(...halfWidth) * (MAX_REACH + 0.1);
  const reach = (i: number) => halfWidth[i]! * 1.2 + passWidth / 2 + 2;
  const extend = (i: number, j: number): Pt => {
    const [x, y] = spine[i]!;
    const [px, py] = spine[j]!;
    const len = Math.hypot(x - px, y - py) || 1;
    const d = reach(i);
    return [x + ((x - px) / len) * d, y + ((y - py) / len) * d];
  };
  const passPts = [extend(0, 1), ...spine, extend(last, last - 1)];
  const passLen = pathLength(passPts);
  const lead = reach(0);

  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const PAD = 2;
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;

  return {
    outline: `${toPath(ring, true)} ${holes.join(' ')}`,
    pass: toPath(passPts, false),
    passWidth,
    viewBox: {
      x: minX,
      y: minY,
      width: Math.max(...xs) + PAD - minX,
      height: Math.max(...ys) + PAD - minY,
    },
    // The pass's round cap reaches `passWidth / 2` ahead of its dash end, so
    // the ink starts showing that much before `lead`.
    inkStart: (lead - passWidth / 2) / passLen,
    runEnd: (lead + runLen) / passLen,
  };
}

function toPath(pts: Pt[], close: boolean) {
  const d = pts
    .map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join('');
  return close ? `${d}Z` : d;
}
