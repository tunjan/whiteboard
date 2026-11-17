/**
 * Where a graph axis puts its gridlines and what it writes under them.
 *
 * Positions are in plot space (see `graph-scale`): the value itself on a
 * linear axis, its log10 on a log one. Labels are set the way a textbook would
 * set them — a true minus, `10⁻³` rather than `1e-3`, `3π/2` on a trig plot,
 * `90°` in degrees.
 */
import { niceStep } from './grid';

export interface Tick {
  at: number;
  /** Null for a gridline drawn without a number, between labelled ones. */
  label: string | null;
}

export interface AxisTicks {
  /** Gridlines at the stronger weight; labelled unless `label` is null. */
  major: Tick[];
  /** Fainter subdivisions between them. */
  minor: number[];
}

/**
 * What an axis counts in. `pi` and `degrees` are for the x axis of a trig plot,
 * and fall back to plain numbers when zoomed past where they read well.
 */
export type TickStyle = 'linear' | 'log' | 'pi' | 'degrees';

/** Room each label is given along its axis, in plot pixels. */
const LABEL_GAP_PX = 70;
/** `π/2`, `90°` and decade labels are short, so they can sit closer. */
const SHORT_LABEL_GAP_PX = 44;
/** Below this a subdivision is texture, not a line, and is left out. */
const MINOR_GAP_PX = 7;

const MINUS = '−';
const SUPERSCRIPT: Record<string, string> = {
  '0': '⁰',
  '1': '¹',
  '2': '²',
  '3': '³',
  '4': '⁴',
  '5': '⁵',
  '6': '⁶',
  '7': '⁷',
  '8': '⁸',
  '9': '⁹',
  '-': '⁻',
};

function superscript(n: number): string {
  return String(n).replace(/[-0-9]/g, (c) => SUPERSCRIPT[c]!);
}

/** One number as an axis writes it: `−2`, `0.25`, `10⁶`, `2.5×10⁻⁴`. */
export function formatTick(value: number): string {
  if (value === 0 || !Number.isFinite(value)) return value === 0 ? '0' : '';
  const abs = Math.abs(value);
  const sign = value < 0 ? MINUS : '';
  if (abs >= 1e5 || abs < 1e-3) {
    let exponent = Math.floor(Math.log10(abs));
    let mantissa = Number((abs / 10 ** exponent).toPrecision(3));
    // 9.996e4 rounds its mantissa up to 10.
    if (mantissa >= 10) {
      mantissa /= 10;
      exponent += 1;
    }
    const power = `10${superscript(exponent)}`;
    return sign + (mantissa === 1 ? power : `${mantissa}×${power}`);
  }
  return sign + Number(abs.toPrecision(6)).toString();
}

/** `k` multiples of `step`, without the drift of adding `step` up. */
function multiples(min: number, max: number, step: number): number[] {
  const out: number[] = [];
  const first = Math.ceil(min / step - 1e-9);
  for (
    let k = first, i = 0;
    k * step <= max + step * 1e-9 && i < 1000;
    k++, i++
  ) {
    out.push(Number((k * step).toPrecision(12)));
  }
  return out;
}

/**
 * Majors every `step`, each split into `parts` minors where those still clear
 * MINOR_GAP_PX.
 */
function stepped(
  min: number,
  max: number,
  size: number,
  step: number,
  parts: number,
  label: (value: number) => string,
): AxisTicks {
  const major = multiples(min, max, step).map((at) => ({
    at,
    label: label(at),
  }));
  const minorStep = step / parts;
  const minor =
    parts > 1 && (minorStep / (max - min)) * size >= MINOR_GAP_PX
      ? multiples(min, max, minorStep).filter(
          (at) => Math.abs(at / step - Math.round(at / step)) > 1e-6,
        )
      : [];
  return { major, minor };
}

function linearTicks(
  min: number,
  max: number,
  size: number,
  suffix = '',
): AxisTicks {
  const step = niceStep(
    (max - min) / Math.max(2, Math.floor(size / LABEL_GAP_PX)),
  );
  // 1 and 5 split into fifths, 2 into quarters: minors land on round numbers.
  const mantissa = Math.round(step / 10 ** Math.floor(Math.log10(step)));
  return stepped(
    min,
    max,
    size,
    step,
    mantissa === 2 ? 4 : 5,
    (v) => formatTick(v) + suffix,
  );
}

/** The first of `steps` that leaves a label room, if it isn't far too coarse. */
function angleStep(
  span: number,
  size: number,
  steps: readonly number[],
): number | null {
  const px = (step: number) => (step / span) * size;
  // Zoomed in so far the finest step is four label gaps wide: plain numbers
  // describe that window better than a single π/4.
  if (px(steps[0]!) > LABEL_GAP_PX * 4) return null;
  return steps.find((step) => px(step) >= SHORT_LABEL_GAP_PX) ?? null;
}

const PI_FRACTIONS = [0.25, 0.5, 1, 2, 4, 8, 16, 32, 64];

/** `k·π/4` reduced: `π/2`, `−π`, `3π/2`, `4π`. */
function formatPi(value: number): string {
  const quarters = Math.round((value / Math.PI) * 4);
  if (quarters === 0) return '0';
  let num = Math.abs(quarters);
  let den = 4;
  while (den > 1 && num % 2 === 0) {
    num /= 2;
    den /= 2;
  }
  const sign = quarters < 0 ? MINUS : '';
  return `${sign}${num === 1 ? '' : num}π${den === 1 ? '' : `/${den}`}`;
}

/** `value` written as a multiple of π/4 when it is one, else null. */
export function exactPi(value: number): string | null {
  const quarters = Math.round((value / Math.PI) * 4);
  const onGrid = Math.abs(value - (quarters * Math.PI) / 4) < 1e-6;
  return quarters !== 0 && onGrid ? formatPi(value) : null;
}

function piTicks(min: number, max: number, size: number): AxisTicks {
  const unit = angleStep(
    max - min,
    size,
    PI_FRACTIONS.map((f) => f * Math.PI),
  );
  return unit === null
    ? linearTicks(min, max, size)
    : stepped(min, max, size, unit, 2, formatPi);
}

const DEGREE_STEPS = [15, 30, 45, 90, 180, 360, 720, 1440, 2880, 5760];

function degreeTicks(min: number, max: number, size: number): AxisTicks {
  const step = angleStep(max - min, size, DEGREE_STEPS);
  if (step === null) return linearTicks(min, max, size, '°');
  // 15° → 5°, 90° → 30°: thirds where they land on whole degrees.
  return stepped(
    min,
    max,
    size,
    step,
    step < 180 ? 3 : 2,
    (v) => `${formatTick(v)}°`,
  );
}

const DECADE_STRIDES = [1, 2, 3, 5, 10, 20, 25, 50, 100];
const MANTISSAS = [2, 3, 4, 5, 6, 7, 8, 9];

/**
 * A log axis over the data range [min, max] (both positive). Decades are
 * labelled — every one when there is room, else every 2nd, 3rd, 5th… — and
 * filled in with the 2–9 lines of log paper. Zoomed into a decade the 2s and
 * 5s, then all nine, earn labels too. Deeper than that, where a log axis is
 * all but linear, the linear ticks are used at their log positions.
 */
function logTicks(min: number, max: number, size: number): AxisTicks {
  const lo = Math.log10(min);
  const hi = Math.log10(max);
  const pxPerDecade = size / (hi - lo);
  const stride =
    DECADE_STRIDES.find((s) => s * pxPerDecade >= SHORT_LABEL_GAP_PX) ?? 100;
  const major: Tick[] = [];
  const minor: number[] = [];
  for (let k = Math.ceil(lo - 1e-9); k <= hi + 1e-9; k += 1) {
    if (k % stride === 0)
      major.push({ at: k, label: formatTick(Number(`1e${k}`)) });
    else if (pxPerDecade >= MINOR_GAP_PX) minor.push(k);
  }
  if (stride === 1) {
    const labelled =
      pxPerDecade >= 600 ? MANTISSAS : pxPerDecade >= 220 ? [2, 5] : [];
    const drawn =
      pxPerDecade >= 60 ? MANTISSAS : pxPerDecade >= 24 ? [2, 5] : [];
    for (let k = Math.floor(lo); k <= Math.ceil(hi); k += 1) {
      for (const m of MANTISSAS) {
        const at = k + Math.log10(m);
        if (at < lo || at > hi) continue;
        if (labelled.includes(m)) {
          major.push({ at, label: formatTick(Number(`${m}e${k}`)) });
        } else if (drawn.includes(m)) {
          minor.push(at);
        }
      }
    }
    major.sort((a, b) => a.at - b.at);
  }
  if (major.length >= 3) return { major, minor };
  const linear = linearTicks(min, max, size);
  return {
    major: linear.major
      .filter(({ at }) => at > 0)
      .map(({ at, label }) => ({ at: Math.log10(at), label })),
    minor: linear.minor.filter((at) => at > 0).map(Math.log10),
  };
}

/**
 * Ticks for one axis showing [min, max] (data units) across `size` plot pixels.
 */
export function axisTicks(
  min: number,
  max: number,
  size: number,
  style: TickStyle,
): AxisTicks {
  if (!(max > min) || !(size > 0)) return { major: [], minor: [] };
  switch (style) {
    case 'log':
      return logTicks(min, max, size);
    case 'pi':
      return piTicks(min, max, size);
    case 'degrees':
      return degreeTicks(min, max, size);
    default:
      return linearTicks(min, max, size);
  }
}

const TRIG_CALL = /\b(?:sin|cos|tan|sec|csc|cot)\b/;
/** Coordinates and polar curves take angles of t and θ, not of x. */
const NOT_IN_X = /^\s*(?:\(|r\s*=)/;
const POLAR = /^\s*r\s*=/;

/** Whether a row's free variable is an angle: it feeds a trig call, or is θ. */
export function usesAngles(expression: string): boolean {
  return TRIG_CALL.test(expression) || POLAR.test(expression);
}

/**
 * Whether the x axis of a graph reads as an angle: some visible curve takes
 * a trig function of it. Tested on the typed text rather than the parse, so
 * the axis doesn't wait on the parser chunk or flicker while a row is
 * mid-edit — and it holds still under pan, unlike a test on the window.
 */
export function plotsTrig(
  expressions: readonly { expression: string; visible: boolean }[],
): boolean {
  return expressions.some(
    ({ expression, visible }) =>
      visible && TRIG_CALL.test(expression) && !NOT_IN_X.test(expression),
  );
}
