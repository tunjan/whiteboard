import type { SVGProps } from 'react';

/**
 * The toolbar's glyphs, drawn rather than imported.
 *
 * Every key on the bar used to wear a lucide icon, and lucide is a good set —
 * but it is a *general* set, and a bar of tools is the one place in an app
 * where the icons are the product. What was wrong with it here was never any
 * single symbol; it was that a mouse pointer, a chat bubble, a padlock and a
 * sigma had each been designed by different rules, and the row read as a row
 * of stock icons rather than as one alphabet.
 *
 * So this is one alphabet, drawn to Apple's rules for SF Symbols:
 *
 *   · **One grid, one weight.** 24 x 24, everything inside a 4–20 live area,
 *     a single uninterrupted stroke weight, round caps and round joins on
 *     every path. Nothing is filled; nothing is a different weight to make a
 *     point. The bar renders these at 18px and `CHROME_CONTROLS` sets the
 *     weight there (1.75), so `STROKE` below is what they are authored at and
 *     what they fall back to anywhere else.
 *   · **Optical, not geometric.** A circle overshoots a square of the same
 *     nominal size, because it reads smaller; a symbol is centred on its own
 *     visual mass rather than on its bounding box. Where the two disagree the
 *     eye wins — see `EllipseGlyph`, which is drawn larger than `RectGlyph`
 *     and looks the same size next to it.
 *   · **Simplify to the idea.** Apple's symbols carry one idea each and throw
 *     away every detail that is not it. The eraser is a block on a line. The
 *     highlighter is a chisel on a line. The difference between them is the
 *     end of the barrel, which is exactly the difference between the tools.
 *   · **A family resemblance across the set.** The same corner radius on every
 *     rounded rectangle, the same 45° on every diagonal, the same cap height
 *     on every upright. Two symbols that share a part share it exactly.
 *
 * They are stroked in `currentColor` and inherit their size from the class the
 * call site gives them (`TOOL_ICON`), so nothing here knows about the toolbar
 * and the same glyph works on a key, in a menu row, or in a tooltip.
 */
const STROKE = 1.75;

type GlyphProps = SVGProps<SVGSVGElement>;

/**
 * The shared frame. Stated once so that no symbol in the set can quietly drift
 * onto a different grid, a different weight, or a square cap — the three ways
 * an icon set stops looking like one.
 */
function Glyph({ children, ...props }: GlyphProps) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={STROKE}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      {children}
    </svg>
  );
}

/* ── Navigate ─────────────────────────────────────────────────────────── */

/**
 * The pointer. Apple's own arrow, which is not the symmetrical dart most icon
 * sets draw: the left edge is near-vertical and all of the angle is on the
 * right, which is what makes it read as *the* cursor rather than as an arrow
 * that happens to point up-left. The tail is kept, because an arrowhead with
 * no tail is a "play" triangle rotated.
 */
export function CursorGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.9 3.4v15.1l3.8-3.6 2.5 5.5 2.5-1.1-2.4-5.4h5.2Z" />
    </Glyph>
  );
}

/**
 * The open hand, for panning. Three fingers and a thumb: the fourth finger is
 * dropped because at 18px it closes the gap between the other three and the
 * whole shape turns into a mitten.
 */
export function HandGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M9.4 11.2V5.6a1.8 1.8 0 0 1 3.6 0v4.9" />
      <path d="M13 10.5V4.6a1.8 1.8 0 0 1 3.6 0v6.6" />
      <path d="M16.6 11.2V7.4a1.8 1.8 0 0 1 3.6 0v7.2c0 3.4-2.8 5.9-6.3 5.9h-1.1c-1.8 0-3.4-.8-4.5-2.2l-3.1-3.8a1.8 1.8 0 0 1 2.7-2.3l1.5 1.6V9.1a1.8 1.8 0 0 1 3.6 0v2.1" />
    </Glyph>
  );
}

/** The same hand closed, shown while a drag is actually under way. */
export function HandGrabGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M16.8 11.1V9.4a1.8 1.8 0 0 0-3.6 0" />
      <path d="M13.2 11.1V8.6a1.8 1.8 0 0 0-3.6 0v2.5" />
      <path d="M9.6 11.3V9.8a1.8 1.8 0 0 0-3.6 0v4.4" />
      <path d="M6 12.9a1.8 1.8 0 0 0-3.1 1.8l1.6 2.8a7.2 7.2 0 0 0 6.2 3.6h1.6a7.2 7.2 0 0 0 7.2-7.2v-2.8a1.8 1.8 0 0 0-3.6 0" />
    </Glyph>
  );
}

/* ── Inking ───────────────────────────────────────────────────────────── */

/**
 * The pen. A barrel on a 45° diagonal with the nib at the bottom-left, and one
 * crease across it where the ferrule sits — the same two-part construction
 * Apple's `pencil` uses, and the reason it reads as a pen at 14px when a more
 * detailed drawing does not.
 */
export function PenGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.2 19.8 5 16.1 16.2 4.9a2.1 2.1 0 0 1 3 0l.9.9a2.1 2.1 0 0 1 0 3L7.9 19Z" />
      <path d="m14.5 6.6 2.9 2.9" />
    </Glyph>
  );
}

/**
 * The highlighter: the pen's barrel cut off square instead of tapered, sitting
 * on the stroke it lays down. The flat foot and the line under it are the
 * whole difference from `PenGlyph`, which is the whole difference between the
 * two tools — one comes to a point, the other wipes a band.
 */
export function HighlighterGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M15.6 4.4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8l-7.9 7.9H7.1v-4.6Z" />
      <path d="M4.6 20.4h14.8" />
    </Glyph>
  );
}

/**
 * The eraser: the same barrel again, blunt at both ends, on the same baseline
 * as the highlighter. Three tools built from one form, told apart by what
 * happens at the end of it — which is how a symbol family is supposed to work.
 */
export function EraserGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M10.2 19.6 4.4 13.8a2 2 0 0 1 0-2.9l6.6-6.6a2 2 0 0 1 2.9 0l5.8 5.8a2 2 0 0 1 0 2.9l-6.6 6.6Z" />
      <path d="M10.2 19.6h9.4" />
      <path d="m7.6 10.6 5.8 5.8" />
    </Glyph>
  );
}

/**
 * The laser. The one inking tool that leaves no mark, so it is the one drawn
 * as an emitter rather than as a barrel: a flat muzzle instead of a nib, and
 * the beam broken into a segment and a dot — a detached mark is how a symbol
 * says "this is light, not ink".
 */
export function LaserGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M8.6 11.4 3.4 16.6a2.7 2.7 0 0 0 3.8 3.8l5.2-5.2Z" />
      <path d="m13.2 10.8 2.4-2.4" />
      <circle cx="18.4" cy="5.6" r="1.1" />
    </Glyph>
  );
}

/* ── Place ────────────────────────────────────────────────────────────── */

/**
 * Text. The bar has turned-down ends rather than plain terminals: a bare cross
 * is a lower-case "t", and the two ticks are what make it a capital set in
 * type. Apple's `textformat` does the same thing for the same reason.
 */
export function TextGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.2 8.4V6.6a1 1 0 0 1 1-1h11.6a1 1 0 0 1 1 1v1.8" />
      <path d="M12 5.6v12.8" />
      <path d="M9.2 18.4h5.6" />
    </Glyph>
  );
}

/**
 * The graph. Axes drawn as one continuous L — two separate strokes meeting at
 * a corner is a corner you can see — and a single curve over them. A curve
 * rather than a polyline, because this tool plots functions and a zig-zag is
 * what a chart of measurements looks like.
 */
export function GraphGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.6 4.2v13.4a1.8 1.8 0 0 0 1.8 1.8h13" />
      <path d="M7.8 16.2c2.8 0 2.2-8.6 5.2-8.6s2.2 5.6 5.2 5.6" />
    </Glyph>
  );
}

/**
 * The equation. A sigma with its arms turned in at all four ends — an open Σ
 * drawn in a monoline weight loses its terminals and reads as a "3" lying on
 * its side, and the four short returns are what stop that happening.
 */
export function SigmaGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M17.6 7.6V5.4H6.6L12 12l-5.4 6.6h11v-2.2" />
    </Glyph>
  );
}

/**
 * The comment. A bubble much rounder than a rounded rectangle, with a short
 * tail dropped from the lower-left — Apple's bubbles are closer to an ellipse
 * than to a box, and the tail is stubby rather than drawn out to a point.
 */
export function CommentGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 4.4c4.6 0 8.3 3.1 8.3 7s-3.7 7-8.3 7c-.9 0-1.8-.1-2.6-.3l-4.1 2 1-3.3c-1.7-1.3-2.6-3.2-2.6-5.4 0-3.9 3.7-7 8.3-7Z" />
    </Glyph>
  );
}

/**
 * The sticker: a rounded square with one corner peeled back. The fold is drawn
 * as its own arc rather than as a triangle, so it reads as paper lifting off
 * the board rather than as a chunk cut out of the square.
 */
export function StickerGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M16.6 4.3H7.4a3.1 3.1 0 0 0-3.1 3.1v9.2a3.1 3.1 0 0 0 3.1 3.1h5.3l7-7V7.4a3.1 3.1 0 0 0-3.1-3.1Z" />
      <path d="M12.7 19.7v-3.9a3.1 3.1 0 0 1 3.1-3.1h3.9" />
    </Glyph>
  );
}

/** Media. A frame with a horizon and a sun, which is Apple's `photo` exactly. */
export function ImageGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3.9" y="5.2" width="16.2" height="13.6" rx="3.2" />
      <path d="m4.4 16.6 4.3-4.3a2 2 0 0 1 2.8 0l4.6 4.6" />
      <circle cx="15.4" cy="9.8" r="1.3" />
    </Glyph>
  );
}

/** Video. The same frame with a play triangle in it, at the same radius. */
export function VideoGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="3.4" y="5.4" width="17.2" height="13.2" rx="3.2" />
      <path d="M10.6 9.4 15.8 12l-5.2 2.6Z" />
    </Glyph>
  );
}

/* ── Shapes ───────────────────────────────────────────────────────────── */

/**
 * The rectangle. Wider than tall and softly cornered: a perfect square at this
 * weight reads as a checkbox, and the corner radius is the one used by every
 * other rounded box in the set.
 */
export function RectGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="4.2" y="5.8" width="15.6" height="12.4" rx="3" />
    </Glyph>
  );
}

/**
 * The ellipse. Drawn a touch larger than the rectangle's height, because a
 * circle of the same nominal size reads smaller than a square — the standard
 * optical overshoot, and the reason the two look level side by side.
 */
export function EllipseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="12" cy="12" r="7.8" />
    </Glyph>
  );
}

/** The line. A plain 45° run, corner to corner of the live area. */
export function LineGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.4 18.6 18.6 5.4" />
    </Glyph>
  );
}

/** The arrow: the same 45° run, with a head on it drawn as two equal arms. */
export function ArrowGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M5.6 18.4 18.4 5.6" />
      <path d="M9.6 5.6h8.8v8.8" />
    </Glyph>
  );
}

/**
 * The frame. Four rules crossing, rather than a rectangle with marks on it:
 * the tool draws a region *over* the board, and a grid of rules says "this
 * area" where a closed box says "this object".
 */
export function FrameGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M4.2 8.8h15.6" />
      <path d="M4.2 15.2h15.6" />
      <path d="M8.8 4.2v15.6" />
      <path d="M15.2 4.2v15.6" />
    </Glyph>
  );
}

/**
 * The polygon. A hexagon standing on a point, which is the one regular figure
 * that is unmistakably "a polygon" rather than a specific shape with a name
 * the user is looking for elsewhere on the bar.
 */
export function PolygonGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 3.8 19.1 7.9v8.2L12 20.2 4.9 16.1V7.9Z" />
    </Glyph>
  );
}

/* ── The bar's own controls ───────────────────────────────────────────── */

/**
 * Tool lock. A body at the set's corner radius with a shackle over it; the
 * open state lifts the right leg of the shackle clear rather than tilting the
 * whole thing, so the two states differ by one short stroke and read as the
 * same object in two positions.
 */
export function LockGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="3" />
      <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0v2.6" />
    </Glyph>
  );
}

export function LockOpenGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <rect x="4.8" y="10.4" width="14.4" height="9.4" rx="3" />
      <path d="M8.2 10.4V7.8a3.8 3.8 0 0 1 7.6 0" />
    </Glyph>
  );
}

/**
 * The chevron that hides and shows the bar. Shallow and short — Apple's
 * chevrons are a hint of direction rather than an arrowhead, and a steep one
 * here would compete with the arrow tool three keys away.
 */
export function ChevronDownGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m6.8 9.8 5.2 5 5.2-5" />
    </Glyph>
  );
}

export function ChevronUpGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m6.8 14.2 5.2-5 5.2 5" />
    </Glyph>
  );
}

/** More. Three dots on the set's baseline, at the stroke's own width. */
export function MoreGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <circle cx="5.6" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="18.4" cy="12" r="1.1" fill="currentColor" stroke="none" />
    </Glyph>
  );
}

/** Add, and close. The two verbs that show up inside the bar's flyouts. */
export function PlusGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="M12 5.6v12.8" />
      <path d="M5.6 12h12.8" />
    </Glyph>
  );
}

export function CloseGlyph(props: GlyphProps) {
  return (
    <Glyph {...props}>
      <path d="m6.8 6.8 10.4 10.4" />
      <path d="M17.2 6.8 6.8 17.2" />
    </Glyph>
  );
}
