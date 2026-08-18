import {
  Check,
  CircleAlert,
  CircleQuestionMark,
  Eye,
  Flame,
  Heart,
  PartyPopper,
  Sparkles,
  Star,
  ThumbsDown,
  ThumbsUp,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { MindBlown, Skull } from './sticker-icons';

/**
 * The app's accent language: one evenly spaced hue wheel at a shared lightness
 * and chroma (L 0.70 / C 0.15), listed in hue order. Sticker artwork keeps one
 * fixed color across a theme switch and through the PNG export, so this stays
 * a literal hex set rather than a theme-aware CSS variable.
 */
const ACCENT = {
  red: '#ed756e',
  orange: '#e48233',
  amber: '#c79600',
  lime: '#9ca81f',
  green: '#5bb661',
  teal: '#00b89a',
  cyan: '#00b3c2',
  blue: '#00abed',
  indigo: '#709afb',
  violet: '#a689f1',
  magenta: '#cc7bd1',
  rose: '#e573a3',
} as const;

/**
 * The built-in stamp set. A sticker is a lucide glyph drawn twice: a fat white
 * pass underneath (the die-cut halo you see on a real sticker) and the colored
 * glyph on top. Two passes rather than one `paint-order: stroke` pass, so the
 * artwork does not depend on a CSS property surviving the PNG export's SVG
 * rasterization.
 *
 * `filled` says whether the glyph reads as a silhouette (star, thumbs) or as
 * line art (question, eye). Filling a line-art icon would swallow its interior
 * detail — a filled question mark is just a disc.
 */
export interface StickerDef {
  id: string;
  label: string;
  Icon: LucideIcon;
  /** Fixed per sticker, as in FigJam — not a style-panel property. */
  color: string;
  filled: boolean;
}

// Colors come from the shared ACCENT set: bright enough to read as stamp art,
// and legible on either canvas once the white halo separates it from the
// background.
export const STICKERS: StickerDef[] = [
  { id: 'thumbs-up', label: 'Thumbs up', Icon: ThumbsUp, color: ACCENT.green, filled: true },
  { id: 'thumbs-down', label: 'Thumbs down', Icon: ThumbsDown, color: ACCENT.indigo, filled: true },
  { id: 'star', label: 'Star', Icon: Star, color: ACCENT.amber, filled: true },
  { id: 'heart', label: 'Heart', Icon: Heart, color: ACCENT.rose, filled: true },
  { id: 'flame', label: 'Fire', Icon: Flame, color: ACCENT.orange, filled: true },
  { id: 'zap', label: 'Zap', Icon: Zap, color: ACCENT.amber, filled: true },
  { id: 'party', label: 'Party', Icon: PartyPopper, color: ACCENT.violet, filled: true },
  { id: 'sparkles', label: 'Sparkles', Icon: Sparkles, color: ACCENT.magenta, filled: true },
  { id: 'mind-blown', label: 'Mind blown', Icon: MindBlown, color: ACCENT.red, filled: true },
  { id: 'skull', label: 'Skull', Icon: Skull, color: ACCENT.teal, filled: true },
  { id: 'question', label: 'Question', Icon: CircleQuestionMark, color: ACCENT.red, filled: false },
  { id: 'alert', label: 'Alert', Icon: CircleAlert, color: ACCENT.orange, filled: false },
  { id: 'check', label: 'Check', Icon: Check, color: ACCENT.green, filled: false },
  { id: 'eyes', label: 'Eyes on this', Icon: Eye, color: ACCENT.cyan, filled: false },
];

const FALLBACK = STICKERS[0]!;

/** Unknown ids (a peer on a newer build) fall back rather than rendering nothing. */
export function getSticker(id: string): StickerDef {
  return STICKERS.find((s) => s.id === id) ?? FALLBACK;
}

// Lucide art is authored in a 24×24 box. The padded viewBox gives the halo
// stroke room to extend past the glyph without the nested <svg> viewport
// clipping it.
const ART_VIEW_BOX = '-4 -4 32 32';
const HALO_STROKE = 5;
const GLYPH_STROKE = 2;

/**
 * The sticker artwork, positioned in the caller's coordinate space. Shared by
 * the canvas shape and the toolbar picker so the two can never drift.
 *
 * Pure: renders SVG only, so it also runs under the PNG export's static render.
 */
export function StickerArt({
  def,
  x = 0,
  y = 0,
  w,
  h,
}: {
  def: StickerDef;
  x?: number;
  y?: number;
  w: number;
  h: number;
}) {
  const { Icon, color, filled } = def;
  const box = {
    x,
    y,
    width: w,
    height: h,
    viewBox: ART_VIEW_BOX,
    preserveAspectRatio: 'xMidYMid meet',
  } as const;
  // Stroke widths go through `style`, not the attribute: the toolbar surface
  // sets `[&_svg]:stroke-2` on every descendant svg, and a class rule beats a
  // presentation attribute — which would flatten the halo in the picker.
  return (
    <>
      <Icon
        {...box}
        fill="#ffffff"
        stroke="#ffffff"
        style={{ strokeWidth: HALO_STROKE }}
      />
      <Icon
        {...box}
        fill={filled ? color : 'none'}
        stroke={color}
        style={{ strokeWidth: GLYPH_STROKE }}
      />
    </>
  );
}

/** Standalone preview for the toolbar picker. */
export function StickerPreview({ def, size }: { def: StickerDef; size: number }) {
  return (
    <svg
      width={size}
      height={size}
      data-native-size
      overflow="visible"
      aria-hidden="true"
    >
      <StickerArt def={def} w={size} h={size} />
    </svg>
  );
}
