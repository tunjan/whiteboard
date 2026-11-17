/**
 * Markdown and `$…$` / `$$…$$` math in text shapes.
 *
 * Text written without any marks keeps the line layout in `text-measure`. Text
 * that uses a mark is laid out here instead, into positioned runs and formula
 * boxes the shape draws as plain SVG. The grammar is the comment dialect
 * (`comment-markdown`) and the math goes through the board's MathJax pipeline
 * (`equation-render`), so a formula looks the same in a text box, a comment and
 * an equation shape.
 *
 * The layout is computed rather than left to the browser for the same reason
 * the plain engine is: bounds, hit-testing and resizing need the box as a pure
 * function of the props, and PNG export rasterizes the SVG as an image, where
 * HTML (`<foreignObject>`) taints the canvas and fails the export.
 *
 * Editing still shows the source — the textarea overlay lays it out with
 * `layoutTextProps` — and the rendered view returns on commit.
 */
import type { FontFamily, FontWeight, TextProps } from '@whiteboard/shared';
import {
  parseCommentMarkdown,
  type BlockNode,
  type InlineNode,
} from '../comment-markdown';
import { getEquationRender, inlineMathBox } from '../equation-render';
import {
  MIN_TEXT_WIDTH,
  fontMetrics,
  fontWeight,
  layoutTextProps,
  measureTextWidth,
  resolveLineHeightPx,
  textLineHeight,
  textMetricsEpoch,
  textSizingMode,
} from './text-measure';

export interface MathRef {
  latex: string;
  display: boolean;
}

/** One drawable piece, in shape-local coordinates. */
export type RichTextItem =
  | {
      kind: 'text';
      x: number;
      /** Baseline. */
      y: number;
      text: string;
      size: number;
      family: FontFamily;
      weight: FontWeight;
      italic: boolean;
    }
  /** Strike-through and underline strokes. */
  | { kind: 'rule'; x: number; y: number; width: number; thickness: number }
  /** The tint behind inline code. */
  | { kind: 'code'; x: number; y: number; width: number; height: number }
  /** A typeset formula; `svg` is MathJax output with its own viewBox. */
  | { kind: 'math'; x: number; y: number; width: number; height: number; svg: string };

type TextItem = Extract<RichTextItem, { kind: 'text' }>;

export interface RichTextLayout {
  width: number;
  height: number;
  items: RichTextItem[];
  /** Formulas drawn as their source because no render was cached yet. Their
   *  arrival changes the box, so the shape asks for them and re-lays out. */
  pendingMath: MathRef[];
}

/** Cheap pre-check: text with none of these cannot hold a mark, so the common
 *  case never reaches the parser. */
const MARKUP_HINT = /[*_~`$#\\[]|^\s{0,3}(?:[-+]|\d{1,9}[.)])\s/m;

const CACHE_MAX = 512;
const blocksCache = new Map<string, BlockNode[] | null>();
const layoutCache = new Map<string, RichTextLayout>();
let layoutCacheEpoch = -1;

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  if (cache.size >= CACHE_MAX) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(key, value);
  return value;
}

function isPlain(blocks: BlockNode[]): boolean {
  return blocks.every(
    (block) =>
      block.type === 'paragraph' &&
      block.children.every((node) => node.type === 'text'),
  );
}

/** The parsed blocks when `text` uses any mark, or null for plain text. */
export function richTextBlocks(text: string): BlockNode[] | null {
  if (!MARKUP_HINT.test(text)) return null;
  const cached = blocksCache.get(text);
  if (cached !== undefined) return cached;
  const blocks = parseCommentMarkdown(text);
  // A backslash escape is a mark too: `\$5` has to render as `$5`.
  const rich = text.includes('\\') || !isPlain(blocks) ? blocks : null;
  return remember(blocksCache, text, rich);
}

export function isRichText(text: string): boolean {
  return richTextBlocks(text) !== null;
}

// --- Inline content as atoms ------------------------------------------------

interface RunStyle {
  size: number;
  family: FontFamily;
  weight: FontWeight;
  italic: boolean;
  strike: boolean;
  underline: boolean;
  code: boolean;
}

type Atom =
  | { kind: 'text'; text: string; style: RunStyle; width: number; space: boolean }
  | { kind: 'break' }
  | {
      kind: 'math';
      display: boolean;
      width: number;
      /** Above and below the baseline. */
      ascent: number;
      depth: number;
      svg: string;
    };

/** Inline code and untypeset formulas are set a little smaller, as in CSS. */
const CODE_SCALE = 0.9;
const BOLD: FontWeight = 700;

function textAtoms(text: string, style: RunStyle, out: Atom[]): void {
  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (index > 0) out.push({ kind: 'break' });
    for (const piece of line.split(/(\s+)/)) {
      if (!piece) continue;
      out.push({
        kind: 'text',
        text: piece,
        style,
        width: measureTextWidth(piece, style.size, style.family, style.weight, style.italic),
        space: /^\s/.test(piece),
      });
    }
  });
}

/** Code is one unbreakable atom, so its tint stays one rectangle. */
function codeAtom(value: string, style: RunStyle, out: Atom[]): void {
  const code = { ...style, family: 'mono' as const, size: style.size * CODE_SCALE, code: true };
  const text = value.replace(/\n/g, ' ');
  out.push({
    kind: 'text',
    text,
    style: code,
    width: measureTextWidth(text, code.size, code.family, code.weight, code.italic),
    space: false,
  });
}

function inlineAtoms(
  nodes: InlineNode[],
  style: RunStyle,
  out: Atom[],
  pending: MathRef[],
): void {
  for (const node of nodes) {
    switch (node.type) {
      case 'text':
        textAtoms(node.value, style, out);
        break;
      case 'strong':
        inlineAtoms(node.children, { ...style, weight: BOLD }, out, pending);
        break;
      case 'em':
        inlineAtoms(node.children, { ...style, italic: true }, out, pending);
        break;
      case 'strike':
        inlineAtoms(node.children, { ...style, strike: true }, out, pending);
        break;
      // Shown, not followed: pointer input on the board belongs to the canvas.
      case 'link':
        inlineAtoms(node.children, { ...style, underline: true }, out, pending);
        break;
      case 'code':
        codeAtom(node.value, style, out);
        break;
      case 'math': {
        // `inline` is the typesetting style, the opposite of display math.
        const render = getEquationRender(node.latex, !node.display);
        if (render && !('error' in render)) {
          const box = inlineMathBox(render);
          out.push({
            kind: 'math',
            display: node.display,
            width: box.width * style.size,
            ascent: (box.height - box.depth) * style.size,
            depth: box.depth * style.size,
            svg: render.svg,
          });
        } else {
          // Unrenderable, or not typeset yet: the source keeps it readable.
          if (!render) pending.push({ latex: node.latex, display: node.display });
          codeAtom(node.latex, style, out);
        }
        break;
      }
    }
  }
}

// --- Lines ------------------------------------------------------------------

interface Line {
  atoms: { atom: Exclude<Atom, { kind: 'break' }>; x: number }[];
  width: number;
  /** Baseline offset from the line top, and the line's full height. */
  baseline: number;
  height: number;
  indent: number;
  centered: boolean;
  /** List marker drawn left of the line's first atom. */
  marker?: { text: string; style: RunStyle; width: number };
}

interface BlockFrame {
  style: RunStyle;
  lineHeightFactor: number;
  /** Wrap width, or Infinity for auto-sized text. */
  wrap: number;
  indent: number;
}

/** Break atoms into lines, greedily, at whitespace. */
function breakLines(atoms: Atom[], frame: BlockFrame): Line[] {
  const { size, family, weight } = frame.style;
  const lineHeight = resolveLineHeightPx(size, frame.lineHeightFactor);
  const { ascent } = fontMetrics(size, family, weight);
  const textBaseline = Math.max(0, lineHeight - size) / 2 + ascent;
  const available = frame.wrap - frame.indent;
  const pad = size * 0.1;

  const lines: Line[] = [];
  const open = (centered = false): Line => ({
    atoms: [],
    width: 0,
    baseline: textBaseline,
    height: lineHeight,
    indent: frame.indent,
    centered,
  });
  let line = open();
  let softWrapped = false;
  const isSpace = (atom: Atom | undefined) => atom?.kind === 'text' && atom.space;
  const close = () => {
    // Spaces a wrap left at the end of a line take no room.
    while (isSpace(line.atoms.at(-1)?.atom)) line.width = line.atoms.pop()!.x;
    lines.push(line);
    line = open();
  };

  for (const atom of atoms) {
    if (atom.kind === 'break') {
      close();
      softWrapped = false;
      continue;
    }
    if (atom.kind === 'math' && atom.display) {
      if (line.atoms.length) close();
      line = open(true);
      line.atoms.push({ atom, x: 0 });
      line.width = atom.width;
      line.baseline = Math.max(textBaseline, atom.ascent + size * 0.25);
      line.height = Math.max(lineHeight, line.baseline + atom.depth + size * 0.25);
      close();
      softWrapped = false;
      continue;
    }
    const space = isSpace(atom);
    if (space && line.atoms.length === 0 && softWrapped) continue;
    if (!space && line.atoms.length && line.width + atom.width > available) {
      close();
      softWrapped = true;
    }
    line.atoms.push({ atom, x: line.width });
    line.width += atom.width;
    if (atom.kind === 'math') {
      const below = line.height - line.baseline;
      line.baseline = Math.max(line.baseline, atom.ascent + pad);
      line.height = line.baseline + Math.max(below, atom.depth + pad);
    }
  }
  close();
  return lines;
}

const HEADING_SCALE = { 1: 1.5, 2: 1.25, 3: 1.1 } as const;
/** Space between blocks, and the list indent, in ems of the base size. */
const BLOCK_GAP = 0.4;
const LIST_INDENT = 1.4;

function blockLines(block: BlockNode, base: BlockFrame, pending: MathRef[]): Line[] {
  if (block.type === 'paragraph' || block.type === 'heading') {
    const frame =
      block.type === 'heading'
        ? {
            ...base,
            style: { ...base.style, size: base.style.size * HEADING_SCALE[block.level], weight: BOLD },
            lineHeightFactor: 1.2,
          }
        : base;
    const atoms: Atom[] = [];
    inlineAtoms(block.children, frame.style, atoms, pending);
    return breakLines(atoms, frame);
  }

  const frame = { ...base, indent: base.style.size * LIST_INDENT };
  return block.items.flatMap((item, index) => {
    const atoms: Atom[] = [];
    inlineAtoms(item, frame.style, atoms, pending);
    const lines = breakLines(atoms, frame);
    const text = block.ordered ? `${block.start + index}.` : '•';
    const { size, family, weight } = frame.style;
    lines[0]!.marker = {
      text,
      style: frame.style,
      width: measureTextWidth(text, size, family, weight),
    };
    return lines;
  });
}

const ALIGN_FACTOR = { start: 0, middle: 0.5, end: 1 } as const;

/** Lay out blocks and turn the lines into positioned items. */
export function layoutRichBlocks(
  blocks: BlockNode[],
  props: TextProps,
  pending: MathRef[],
): Omit<RichTextLayout, 'pendingMath'> {
  const fixed = textSizingMode(props) === 'fixed';
  const size = Math.max(1, props.fontSize);
  const base: BlockFrame = {
    style: {
      size,
      family: props.fontFamily ?? 'sans',
      weight: fontWeight(props.fontWeight),
      italic: false,
      strike: false,
      underline: false,
      code: false,
    },
    lineHeightFactor: textLineHeight(props),
    wrap: fixed ? Math.max(MIN_TEXT_WIDTH, props.width) : Infinity,
    indent: 0,
  };

  const placed: { line: Line; top: number }[] = [];
  let y = 0;
  blocks.forEach((block, index) => {
    if (index > 0) y += size * BLOCK_GAP;
    for (const line of blockLines(block, base, pending)) {
      placed.push({ line, top: y });
      y += line.height;
    }
  });

  const width = fixed
    ? base.wrap
    : Math.max(
        MIN_TEXT_WIDTH,
        // Rounded up, plus a pixel, for the same subpixel slack as plain text.
        Math.ceil(Math.max(0, ...placed.map(({ line }) => line.indent + line.width))) + 1,
      );

  const items: RichTextItem[] = [];
  for (const { line, top } of placed) {
    const free = width - line.indent - line.width;
    const factor = line.centered ? 0.5 : (ALIGN_FACTOR[props.align] ?? 0);
    const left = line.indent + Math.max(0, free) * factor;
    const baseline = top + line.baseline;

    if (line.marker) {
      const { text, style, width: markerWidth } = line.marker;
      items.push({
        kind: 'text',
        x: left - markerWidth - style.size * 0.35,
        y: baseline,
        text,
        size: style.size,
        family: style.family,
        weight: style.weight,
        italic: false,
      });
    }

    // Adjacent undecorated atoms in one font become one run, so a sentence is
    // one element rather than one per word.
    let run: TextItem | null = null;
    for (const { atom, x } of line.atoms) {
      const at = left + x;
      if (atom.kind === 'math') {
        items.push({
          kind: 'math',
          x: at,
          y: baseline - atom.ascent,
          width: atom.width,
          height: atom.ascent + atom.depth,
          svg: atom.svg,
        });
        run = null;
        continue;
      }
      const { style } = atom;
      const decorated = style.code || style.strike || style.underline;
      if (
        !decorated &&
        run &&
        run.size === style.size &&
        run.family === style.family &&
        run.weight === style.weight &&
        run.italic === style.italic
      ) {
        run.text += atom.text;
        continue;
      }
      if (style.code) {
        items.push({
          kind: 'code',
          x: at - style.size * 0.2,
          y: baseline - style.size,
          width: atom.width + style.size * 0.4,
          height: style.size * 1.3,
        });
      }
      const item: TextItem = {
        kind: 'text',
        x: at,
        y: baseline,
        text: atom.text,
        size: style.size,
        family: style.family,
        weight: style.weight,
        italic: style.italic,
      };
      items.push(item);
      run = decorated ? null : item;
      const thickness = Math.max(1, style.size / 14);
      if (style.strike) {
        items.push({ kind: 'rule', x: at, y: baseline - style.size * 0.3, width: atom.width, thickness });
      }
      if (style.underline) {
        items.push({ kind: 'rule', x: at, y: baseline + style.size * 0.12, width: atom.width, thickness });
      }
    }
  }

  return { width, height: Math.max(resolveLineHeightPx(size, base.lineHeightFactor), y), items };
}

/** Layout for a text shape that uses marks, or null for plain text. */
export function richTextLayout(props: TextProps): RichTextLayout | null {
  const blocks = richTextBlocks(props.text);
  if (!blocks) return null;

  const epoch = textMetricsEpoch();
  if (epoch !== layoutCacheEpoch) {
    // Fonts landed or a formula was typeset: every layout is suspect.
    layoutCache.clear();
    layoutCacheEpoch = epoch;
  }
  const fixed = textSizingMode(props) === 'fixed';
  const key = [
    props.text,
    props.fontSize,
    props.fontFamily,
    fontWeight(props.fontWeight),
    textLineHeight(props),
    props.align,
    fixed ? props.width : 'auto',
  ].join('\u0000');
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const pendingMath: MathRef[] = [];
  const layout = layoutRichBlocks(blocks, props, pendingMath);
  return remember(layoutCache, key, { ...layout, pendingMath });
}

/** The box a text shape occupies as drawn, rendered marks included. */
export function textBoxSize(props: TextProps): { width: number; height: number } {
  return richTextLayout(props) ?? layoutTextProps(props);
}
