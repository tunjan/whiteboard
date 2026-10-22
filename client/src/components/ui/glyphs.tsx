import type { LucideIcon, LucideProps } from 'lucide-react';
import {
  ChartSpline,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Circle,
  CircleDot,
  Ellipsis,
  Eraser,
  DraftingCompass,
  Frame,
  Hand,
  HandGrab,
  Hexagon,
  Highlighter,
  Image,
  Lasso,
  Lock,
  LockOpen,
  MessageCircle,
  MousePointer2,
  MousePointerClick,
  MoveUpRight,
  Pencil,
  Plus,
  Shapes,
  Sigma,
  Slash,
  Square,
  Sticker,
  Type,
  Undo2,
  Redo2,
  Ruler,
  RulerDimensionLine,
  Video,
  X,
} from 'lucide-react';

/**
 * The toolbar's glyphs, named for what they do on the bar and drawn by lucide.
 *
 * The bar names its own symbols — `PenGlyph`, `LaserGlyph`, `FrameGlyph` —
 * rather than importing lucide at each key, so which icon stands for a tool is
 * decided once, here, instead of thirty times across the tool files. Swapping
 * one is a line in the table below.
 *
 * They are stroked in `currentColor` and take their size from the class the
 * call site gives them, so nothing here knows about the toolbar and the same
 * glyph works on a key, in a menu row, or in a tooltip.
 */
type GlyphProps = LucideProps;

/**
 * Names a lucide icon as one of the bar's glyphs, and marks it decorative:
 * every key already carries its own `aria-label`, so the symbol inside it must
 * not be announced a second time.
 */
function glyph(Icon: LucideIcon, name: string) {
  const Named = (props: GlyphProps) => <Icon aria-hidden="true" {...props} />;
  Named.displayName = name;
  return Named;
}

/* ── Navigate ─────────────────────────────────────────────────────────── */

export const CursorGlyph = glyph(MousePointer2, 'CursorGlyph');
export const HandGlyph = glyph(Hand, 'HandGlyph');
export const HandGrabGlyph = glyph(HandGrab, 'HandGrabGlyph');
export const LassoGlyph = glyph(Lasso, 'LassoGlyph');
/** The laser pointer points at the board and leaves nothing behind, so it
    sits with the navigate tools and wears a pointer, not a pen. */
export const LaserGlyph = glyph(MousePointerClick, 'LaserGlyph');

/* ── Draw ─────────────────────────────────────────────────────────────── */

export const PenGlyph = glyph(Pencil, 'PenGlyph');
export const HighlighterGlyph = glyph(Highlighter, 'HighlighterGlyph');
export const EraserGlyph = glyph(Eraser, 'EraserGlyph');

/* ── Place ────────────────────────────────────────────────────────────── */

export const TextGlyph = glyph(Type, 'TextGlyph');
/** The grapher plots functions, so axes under a curve rather than under bars. */
export const GraphGlyph = glyph(ChartSpline, 'GraphGlyph');
export const SigmaGlyph = glyph(Sigma, 'SigmaGlyph');
export const CommentGlyph = glyph(MessageCircle, 'CommentGlyph');
export const StickerGlyph = glyph(Sticker, 'StickerGlyph');
export const ImageGlyph = glyph(Image, 'ImageGlyph');
export const VideoGlyph = glyph(Video, 'VideoGlyph');

/* ── Construct ──────────────────────────────────────────────────────── */

export const StraightedgeGlyph = glyph(Ruler, 'StraightedgeGlyph');
export const CompassGlyph = glyph(DraftingCompass, 'CompassGlyph');
export const MeasureGlyph = glyph(RulerDimensionLine, 'MeasureGlyph');
export const UnitCircleGlyph = glyph(CircleDot, 'UnitCircleGlyph');

/* ── Shapes ───────────────────────────────────────────────────────────── */

export const RectGlyph = glyph(Square, 'RectGlyph');
export const EllipseGlyph = glyph(Circle, 'EllipseGlyph');
export const LineGlyph = glyph(Slash, 'LineGlyph');
export const ArrowGlyph = glyph(MoveUpRight, 'ArrowGlyph');
/** Four crossing rules: the frame marks a region of the board, not an object. */
export const FrameGlyph = glyph(Frame, 'FrameGlyph');
/** A hexagon stands for the polygon menu — the named shapes are their own keys. */
export const PolygonGlyph = glyph(Hexagon, 'PolygonGlyph');
/** The shape menu's own mark, for when no shape has been chosen yet. */
export const ShapesGlyph = glyph(Shapes, 'ShapesGlyph');

/* ── The bar's own controls ───────────────────────────────────────────── */

export const LockGlyph = glyph(Lock, 'LockGlyph');
export const LockOpenGlyph = glyph(LockOpen, 'LockOpenGlyph');
export const ChevronDownGlyph = glyph(ChevronDown, 'ChevronDownGlyph');
export const ChevronUpGlyph = glyph(ChevronUp, 'ChevronUpGlyph');
export const ChevronLeftGlyph = glyph(ChevronLeft, 'ChevronLeftGlyph');
export const ChevronRightGlyph = glyph(ChevronRight, 'ChevronRightGlyph');
export const MoreGlyph = glyph(Ellipsis, 'MoreGlyph');
export const PlusGlyph = glyph(Plus, 'PlusGlyph');
export const CloseGlyph = glyph(X, 'CloseGlyph');
export const UndoGlyph = glyph(Undo2, 'UndoGlyph');
export const RedoGlyph = glyph(Redo2, 'RedoGlyph');
