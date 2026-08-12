import type {
  FontFamily,
  FontWeight,
  TextAlign,
  TextProps,
  TextSizingMode,
} from '@whiteboard/shared';

/**
 * One layout engine is shared by SVG rendering, bounds, hit-testing, resizing,
 * the DOM editor, and collaborator selections. Keeping all geometry here is
 * what prevents the static and editing representations from drifting apart.
 */

export const TEXT_FONT_FAMILY =
  "'Inter Variable', system-ui, -apple-system, sans-serif";
export const LINE_HEIGHT_FACTOR = 1.2;
export const MIN_TEXT_WIDTH = 8;

/** Concrete CSS font stacks for each selectable family. */
export const FONT_STACKS: Record<FontFamily, string> = {
  sans: TEXT_FONT_FAMILY,
  serif: "'Georgia', 'Times New Roman', serif",
  mono: "'Geist Mono Variable', ui-monospace, 'SF Mono', Menlo, monospace",
  hand: "'Caveat Variable', cursive",
};

export function fontStack(family: FontFamily | undefined): string {
  return FONT_STACKS[family ?? 'sans'];
}

export const DEFAULT_FONT_WEIGHT: FontWeight = 400;

export function fontWeight(weight: FontWeight | undefined): FontWeight {
  return weight ?? DEFAULT_FONT_WEIGHT;
}

export function textSizingMode(
  props: Pick<TextProps, 'sizingMode' | 'width'>,
): TextSizingMode {
  return props.sizingMode ?? (props.width > 0 ? 'fixed' : 'auto');
}

export function textLineHeight(
  props: Pick<TextProps, 'lineHeight'>,
): number {
  const value = props.lineHeight ?? LINE_HEIGHT_FACTOR;
  return Number.isFinite(value) && value > 0 ? value : LINE_HEIGHT_FACTOR;
}

let ctx: CanvasRenderingContext2D | null | undefined;

function getCtx(): CanvasRenderingContext2D | null {
  if (ctx === undefined) {
    ctx =
      typeof document === 'undefined'
        ? null
        : document.createElement('canvas').getContext('2d');
  }
  return ctx;
}

function fallbackWidth(text: string, fontSize: number): number {
  return Array.from(text).length * fontSize * 0.6;
}

const widthCache = new Map<string, number>();
const WIDTH_CACHE_MAX = 8000;

/** Browser advance width for a string, in shape-local/world units. */
export function measureTextWidth(
  text: string,
  fontSize: number,
  family?: FontFamily,
  weight?: FontWeight,
): number {
  if (!text) return 0;
  // Weight belongs in the key: a bolder face advances wider, so sharing an
  // entry across weights would wrap and position carets against stale metrics.
  const key = `${family ?? 'sans'}|${fontWeight(weight)}|${fontSize}|${text}`;
  const cached = widthCache.get(key);
  if (cached !== undefined) return cached;

  const c = getCtx();
  let width: number;
  if (c) {
    c.font = `${fontWeight(weight)} ${fontSize}px ${fontStack(family)}`;
    width = c.measureText(text).width;
  } else {
    width = fallbackWidth(text, fontSize);
  }

  if (widthCache.size >= WIDTH_CACHE_MAX) {
    const oldest = widthCache.keys().next().value;
    if (oldest !== undefined) widthCache.delete(oldest);
  }
  widthCache.set(key, width);
  return width;
}

interface GraphemeBoundary {
  start: number;
  end: number;
  text: string;
}

function graphemes(text: string, offset = 0): GraphemeBoundary[] {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    const Segmenter = Intl.Segmenter;
    const segmenter = new Segmenter(undefined, { granularity: 'grapheme' });
    return [...segmenter.segment(text)].map((part) => ({
      start: offset + part.index,
      end: offset + part.index + part.segment.length,
      text: part.segment,
    }));
  }

  const out: GraphemeBoundary[] = [];
  let index = 0;
  for (const value of Array.from(text)) {
    out.push({
      start: offset + index,
      end: offset + index + value.length,
      text: value,
    });
    index += value.length;
  }
  return out;
}

export interface TextLayoutLine {
  /** Raw line content, excluding explicit newline characters. */
  text: string;
  /** UTF-16 offsets into the shape's source string. */
  start: number;
  end: number;
  width: number;
  /** Alignment offset and line top in shape-local coordinates. */
  x: number;
  y: number;
  baseline: number;
  /** True when this line ends at an explicit `\n`. */
  hardBreak: boolean;
}

export interface TextLayout {
  text: string;
  fontSize: number;
  fontFamily: FontFamily;
  fontWeight: FontWeight;
  align: TextAlign;
  mode: TextSizingMode;
  width: number;
  height: number;
  lineHeight: number;
  ascent: number;
  descent: number;
  lines: TextLayoutLine[];
}

export interface TextLayoutOptions {
  text: string;
  fontSize: number;
  fontFamily?: FontFamily;
  fontWeight?: FontWeight;
  align?: TextAlign;
  sizingMode?: TextSizingMode;
  width?: number;
  lineHeight?: number;
}

interface UnpositionedLine {
  text: string;
  start: number;
  end: number;
  width: number;
  hardBreak: boolean;
}

function wrapParagraph(
  text: string,
  start: number,
  width: number,
  fontSize: number,
  family: FontFamily,
  weight: FontWeight,
): UnpositionedLine[] {
  if (text.length === 0) {
    return [{ text: '', start, end: start, width: 0, hardBreak: false }];
  }

  const units = graphemes(text, start);
  const lines: UnpositionedLine[] = [];
  let lineStartUnit = 0;

  while (lineStartUnit < units.length) {
    let fitEndUnit = lineStartUnit;
    let lastBreakUnit = -1;

    for (let i = lineStartUnit; i < units.length; i++) {
      const candidateStart = units[lineStartUnit]!.start - start;
      const candidateEnd = units[i]!.end - start;
      const candidate = text.slice(candidateStart, candidateEnd);
      if (measureTextWidth(candidate, fontSize, family, weight) <= width) {
        fitEndUnit = i + 1;
        if (/\s/u.test(units[i]!.text)) lastBreakUnit = i + 1;
        continue;
      }

      // Prefer the last whitespace boundary. If a single word is wider than
      // the box, split at a grapheme boundary so every fixed-width text shape
      // remains selectable and its geometry stays bounded.
      if (/\s/u.test(units[i]!.text) && i > lineStartUnit) fitEndUnit = i;
      else if (lastBreakUnit > lineStartUnit) fitEndUnit = lastBreakUnit;
      else if (fitEndUnit === lineStartUnit) fitEndUnit = i + 1;
      break;
    }

    if (fitEndUnit <= lineStartUnit) fitEndUnit = lineStartUnit + 1;
    const absoluteStart = units[lineStartUnit]!.start;
    const absoluteEnd = units[fitEndUnit - 1]!.end;
    const value = text.slice(absoluteStart - start, absoluteEnd - start);
    lines.push({
      text: value,
      start: absoluteStart,
      end: absoluteEnd,
      width: measureTextWidth(value, fontSize, family, weight),
      hardBreak: false,
    });
    lineStartUnit = fitEndUnit;
  }

  return lines;
}

function fontMetrics(fontSize: number, family: FontFamily, weight: FontWeight) {
  const c = getCtx();
  if (c) {
    c.font = `${weight} ${fontSize}px ${fontStack(family)}`;
    const m = c.measureText('Hg');
    return {
      ascent: m.actualBoundingBoxAscent || fontSize * 0.8,
      descent: m.actualBoundingBoxDescent || fontSize * 0.2,
    };
  }
  return { ascent: fontSize * 0.8, descent: fontSize * 0.2 };
}

/** Compute complete text geometry from source text and style. */
export function layoutText(options: TextLayoutOptions): TextLayout {
  const text = options.text ?? '';
  const fontSize = Math.max(1, options.fontSize);
  const fontFamily = options.fontFamily ?? 'sans';
  const weight = fontWeight(options.fontWeight);
  const align = options.align ?? 'start';
  const requestedWidth = Math.max(MIN_TEXT_WIDTH, options.width ?? 0);
  const mode =
    options.sizingMode ?? ((options.width ?? 0) > 0 ? 'fixed' : 'auto');
  const lineHeight = fontSize * Math.max(0.5, options.lineHeight ?? LINE_HEIGHT_FACTOR);
  const { ascent, descent } = fontMetrics(fontSize, fontFamily, weight);

  const rawLines: UnpositionedLine[] = [];
  let paragraphStart = 0;
  const paragraphs = text.split('\n');
  for (let i = 0; i < paragraphs.length; i++) {
    const paragraph = paragraphs[i]!;
    const wrapped =
      mode === 'fixed'
        ? wrapParagraph(
            paragraph,
            paragraphStart,
            requestedWidth,
            fontSize,
            fontFamily,
            weight,
          )
        : [
            {
              text: paragraph,
              start: paragraphStart,
              end: paragraphStart + paragraph.length,
              width: measureTextWidth(paragraph, fontSize, fontFamily, weight),
              hardBreak: false,
            },
          ];
    wrapped[wrapped.length - 1]!.hardBreak = i < paragraphs.length - 1;
    rawLines.push(...wrapped);
    paragraphStart += paragraph.length + (i < paragraphs.length - 1 ? 1 : 0);
  }

  const contentWidth = Math.max(
    MIN_TEXT_WIDTH,
    ...rawLines.map((line) => line.width),
  );
  const width = mode === 'fixed' ? requestedWidth : contentWidth;
  const lines: TextLayoutLine[] = rawLines.map((line, index) => {
    const x =
      align === 'middle'
        ? (width - line.width) / 2
        : align === 'end'
          ? width - line.width
          : 0;
    const y = index * lineHeight;
    const leading = Math.max(0, lineHeight - fontSize) / 2;
    return { ...line, x, y, baseline: y + leading + ascent };
  });

  return {
    text,
    fontSize,
    fontFamily,
    fontWeight: weight,
    align,
    mode,
    width,
    height: Math.max(lineHeight, lines.length * lineHeight),
    lineHeight,
    ascent,
    descent,
    lines,
  };
}

/** Normalize legacy TextProps and produce their layout. */
export function layoutTextProps(props: TextProps): TextLayout {
  return layoutText({
    text: props.text,
    fontSize: props.fontSize,
    fontFamily: props.fontFamily,
    fontWeight: props.fontWeight,
    align: props.align,
    sizingMode: textSizingMode(props),
    width: props.width,
    lineHeight: textLineHeight(props),
  });
}

export interface TextMetrics {
  width: number;
  height: number;
}

/** Backwards-compatible metric helper used by a few callers. */
export function measureText(
  text: string,
  fontSize: number,
  family?: FontFamily,
  width = 0,
  align: TextAlign = 'start',
  weight?: FontWeight,
): TextMetrics {
  const layout = layoutText({
    text,
    fontSize,
    fontFamily: family,
    fontWeight: weight,
    width,
    sizingMode: width > 0 ? 'fixed' : 'auto',
    align,
  });
  return { width: layout.width, height: layout.height };
}

function lineForIndex(layout: TextLayout, index: number): TextLayoutLine {
  const clamped = Math.max(0, Math.min(layout.text.length, index));
  for (let i = 0; i < layout.lines.length; i++) {
    const line = layout.lines[i]!;
    const next = layout.lines[i + 1];
    if (clamped < line.end) return line;
    if (clamped === line.end) {
      // A soft wrap shares its boundary with the next line; display the caret
      // at the next line's start, matching a textarea's visual behavior.
      if (next && !line.hardBreak && next.start === clamped) return next;
      return line;
    }
  }
  return layout.lines[layout.lines.length - 1]!;
}

export interface TextCaret {
  x: number;
  y: number;
  height: number;
  line: TextLayoutLine;
}

export function caretForTextIndex(layout: TextLayout, index: number): TextCaret {
  const line = lineForIndex(layout, index);
  const clamped = Math.max(line.start, Math.min(line.end, index));
  const prefix = layout.text.slice(line.start, clamped);
  return {
    x:
      line.x +
      measureTextWidth(
        prefix,
        layout.fontSize,
        layout.fontFamily,
        layout.fontWeight,
      ),
    y: line.y,
    height: layout.lineHeight,
    line,
  };
}

/** Map a shape-local pointer to the nearest native textarea string offset. */
export function textIndexAtPoint(
  layout: TextLayout,
  point: { x: number; y: number },
): number {
  const lineIndex = Math.max(
    0,
    Math.min(layout.lines.length - 1, Math.floor(point.y / layout.lineHeight)),
  );
  const line = layout.lines[lineIndex]!;
  const localX = point.x - line.x;
  if (localX <= 0) return line.start;
  if (localX >= line.width) return line.end;

  const units = graphemes(line.text, line.start);
  let previousX = 0;
  for (const unit of units) {
    const nextX = measureTextWidth(
      layout.text.slice(line.start, unit.end),
      layout.fontSize,
      layout.fontFamily,
      layout.fontWeight,
    );
    if (localX < (previousX + nextX) / 2) return unit.start;
    previousX = nextX;
  }
  return line.end;
}

export interface TextSelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Shape-local rectangles for a text selection, one per intersected line. */
export function textSelectionRects(
  layout: TextLayout,
  anchor: number,
  head: number,
): TextSelectionRect[] {
  const from = Math.max(0, Math.min(anchor, head, layout.text.length));
  const to = Math.max(0, Math.min(Math.max(anchor, head), layout.text.length));
  if (from === to) return [];

  const rects: TextSelectionRect[] = [];
  for (const line of layout.lines) {
    const start = Math.max(from, line.start);
    const end = Math.min(to, line.end);
    if (start > end || (start === end && !(from <= line.end && to > line.end))) {
      continue;
    }
    const x1 =
      line.x +
      measureTextWidth(
        layout.text.slice(line.start, start),
        layout.fontSize,
        layout.fontFamily,
        layout.fontWeight,
      );
    const x2 =
      line.x +
      measureTextWidth(
        layout.text.slice(line.start, end),
        layout.fontSize,
        layout.fontFamily,
        layout.fontWeight,
      );
    rects.push({
      x: x1,
      y: line.y,
      width: Math.max(1, x2 - x1),
      height: layout.lineHeight,
    });
  }
  return rects;
}
