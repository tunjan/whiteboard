import { useId, type ReactNode } from 'react';
import type { PolygonKind } from '@whiteboard/shared';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';

/**
 * The drawer's tools, drawn as objects rather than glyphs.
 *
 * Every piece is 48×60 and stands on its bottom edge, which the bar cuts off:
 * the tools sit in the drawer and only their tops show (bare shapes stand
 * whole). Colours are the
 * objects' own, not theme tokens — a pencil is white in either theme — except
 * the ink, which is the tool's current colour, and bare shapes, which take the
 * bar's ink.
 */

/** Bare shapes take the bar's ink (`--drawer-ink`), so they read in either theme. */
const INK = 'currentColor';
/** Print on a white card stays dark whatever the theme. */
const PRINT = '#2b2f36';

function Art({ children }: { children: ReactNode }) {
  return (
    <svg width={48} height={60} viewBox="0 0 48 60" aria-hidden="true">
      {children}
    </svg>
  );
}

/** A vertical sheen: lit on the left, turning grey toward the right. */
function Sheen({ id, from = '#ffffff', to = '#d4d6da' }: { id: string; from?: string; to?: string }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      <stop offset="0" stopColor={from} />
      <stop offset="0.55" stopColor={from} />
      <stop offset="1" stopColor={to} />
    </linearGradient>
  );
}

export function PencilArt({ color }: { color: string }) {
  const id = useId();
  return (
    <Art>
      <defs>
        <Sheen id={id} />
      </defs>
      <path d="M24 2 L36 44 V60 H12 V44 Z" fill={`url(#${id})`} stroke="rgba(0,0,0,.1)" />
      <path d="M24 2 L28.6 18 Q24 20.5 19.4 18 Z" fill={color} />
    </Art>
  );
}

export function HighlighterArt({ color }: { color: string }) {
  const id = useId();
  return (
    <Art>
      <defs>
        <Sheen id={id} />
      </defs>
      <path d="M17 8 L31 3 V18 H17 Z" fill={color} />
      <rect x="13" y="18" width="22" height="9" rx="2" fill={`url(#${id})`} stroke="rgba(0,0,0,.1)" />
      <rect x="11" y="26" width="26" height="34" rx="3" fill={`url(#${id})`} stroke="rgba(0,0,0,.1)" />
    </Art>
  );
}

export function EraserArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <Sheen id={id} to="#dcdde0" />
      </defs>
      <rect x="6" y="4" width="36" height="30" rx="5" fill={`url(#${id})`} stroke="rgba(0,0,0,.1)" />
      <rect x="6" y="30" width="36" height="30" rx="2" fill="#e4e5e8" stroke="rgba(0,0,0,.1)" />
      <path d="M32 34 V60 M36 34 V60" stroke="rgba(0,0,0,.08)" />
    </Art>
  );
}

export type ShapeArtKind = 'rectangle' | 'ellipse' | 'line' | PolygonKind;

export function ShapeArt({ kind }: { kind: ShapeArtKind }) {
  // Unlike the tools, a shape stands whole in its slot, clear of the bar's edge.
  if (kind === 'rectangle') return <Art><rect x="3" y="1" width="42" height="42" rx="7" fill={INK} /></Art>;
  if (kind === 'ellipse') return <Art><circle cx="24" cy="22" r="21" fill={INK} /></Art>;
  if (kind === 'line') {
    return (
      <Art>
        <path d="M8 40 L40 4" stroke={INK} strokeWidth={4} strokeLinecap="round" />
      </Art>
    );
  }
  return (
    <Art>
      <polygon points={polygonPointsForBox(kind, 6, 4, 36, 36)} fill={INK} strokeLinejoin="round" stroke={INK} strokeWidth={6} />
    </Art>
  );
}

export function ArrowArt() {
  return (
    <Art>
      <path
        d="M24 62 V6 M11 19 L24 6 L37 19"
        fill="none"
        stroke={INK}
        strokeWidth={3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Art>
  );
}

/** A white card, the stock most of the objects are printed on. */
function Card({ y = 8, fill = '#ffffff' }: { y?: number; fill?: string }) {
  return <rect x="3" y={y} width="42" height={64 - y} rx="6" fill={fill} stroke="rgba(0,0,0,.14)" />;
}

export function TextArt() {
  return (
    <Art>
      <Card />
      <path d="M15 23 H33 M24 23 V44" stroke={PRINT} strokeWidth={5} strokeLinecap="round" />
    </Art>
  );
}

export function FrameArt() {
  return (
    <Art>
      <rect x="5" y="3" width="17" height="8" rx="4" fill="#b9bbc0" />
      <Card y={15} fill="#eceef1" />
    </Art>
  );
}

export function ImageArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#ffc95a" />
          <stop offset="0.7" stopColor="#ffeec2" />
        </linearGradient>
        <radialGradient id={`${id}sun`}>
          <stop offset="0.5" stopColor="#fffaf0" />
          <stop offset="1" stopColor="#fffaf0" stopOpacity="0" />
        </radialGradient>
        <linearGradient id={`${id}back`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#8fadf5" />
          <stop offset="1" stopColor="#6283e6" />
        </linearGradient>
        <linearGradient id={`${id}front`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5a7de0" />
          <stop offset="1" stopColor="#3a58c0" />
        </linearGradient>
        <linearGradient id={`${id}inset`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.14" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
        <filter id={`${id}soft`} x="-20%" y="-50%" width="140%" height="200%">
          <feGaussianBlur stdDeviation="1.2" />
        </filter>
      </defs>
      <Card />
      <rect x="7" y="12" width="34" height="52" rx="2" fill={`url(#${id}sky)`} />
      <circle cx="31" cy="22" r="8" fill={`url(#${id}sun)`} opacity={0.6} />
      <circle cx="31" cy="22" r="4.5" fill="#fffaf0" />
      <path d="M7 40 Q17 30 26 38 T41 34 V64 H7 Z" fill={`url(#${id}back)`} />
      {/* The front hill's shadow on the back one. */}
      <path d="M7 46 Q20 38 30 45 T41 44 V64 H7 Z" fill="#1d2f73" opacity={0.35} filter={`url(#${id}soft)`} />
      <path d="M7 48 Q20 40 30 47 T41 46 V64 H7 Z" fill={`url(#${id}front)`} />
      <path d="M7 48 Q20 40 30 47 T41 46" fill="none" stroke="#ffffff" strokeOpacity={0.25} strokeWidth={0.75} />
      {/* The photo sits just below the card's surface. */}
      <rect x="7" y="12" width="34" height="5" rx="2" fill={`url(#${id}inset)`} />
      <rect x="7" y="12" width="34" height="52" rx="2" fill="none" stroke="rgba(0,0,0,.1)" strokeWidth={0.75} />
    </Art>
  );
}

export function GraphArt() {
  const id = useId();
  const curve = 'M10 50 C17 50 18 20 24 20 S31 46 38 30';
  return (
    <Art>
      <defs>
        <linearGradient id={`${id}area`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#2f8f6a" stopOpacity="0.22" />
          <stop offset="1" stopColor="#2f8f6a" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${id}ink`} x1="0" x2="1" y1="0" y2="0">
          <stop offset="0" stopColor="#3aa57c" />
          <stop offset="1" stopColor="#24785a" />
        </linearGradient>
        <filter id={`${id}soft`} x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur stdDeviation="1" />
        </filter>
      </defs>
      <Card />
      <path d={`${curve} V58 H10 Z`} fill={`url(#${id}area)`} />
      <path d="M10 38 H38 M14 16 V58" stroke="#c4c6cb" strokeWidth={1.5} strokeLinecap="round" />
      {/* The line lifts off the paper: a soft shadow, then the ink, then a glint. */}
      <path d={curve} fill="none" stroke="#0f3d2c" strokeOpacity={0.3} strokeWidth={3} strokeLinecap="round" transform="translate(0 1.5)" filter={`url(#${id}soft)`} />
      <path d={curve} fill="none" stroke={`url(#${id}ink)`} strokeWidth={3} strokeLinecap="round" />
      <path d="M19.5 26 C21 22 22.4 20.6 24 20.6" fill="none" stroke="#ffffff" strokeOpacity={0.45} strokeWidth={0.9} strokeLinecap="round" />
    </Art>
  );
}

export function StickerArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <linearGradient id={id} x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#ff5bd0" />
          <stop offset="1" stopColor="#7a3cff" />
        </linearGradient>
      </defs>
      <g transform="rotate(-14 24 34)">
        <rect x="7" y="12" width="34" height="34" rx="8" fill="#ffffff" stroke="rgba(0,0,0,.12)" />
        <rect x="10" y="15" width="28" height="28" rx="6" fill={`url(#${id})`} />
        <path
          d="M24 20 L26.6 26.4 L33 27 L28.1 31.2 L29.6 37.6 L24 34.2 L18.4 37.6 L19.9 31.2 L15 27 L21.4 26.4 Z"
          fill="#ffffff"
        />
      </g>
    </Art>
  );
}

/** The select key's pointer: a solid arrow with a white keyline. */
export function PointerArt() {
  return (
    <svg
      width={36}
      height={36}
      viewBox="0 0 24 24"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1px 1.5px rgba(0, 0, 0, 0.35))' }}
    >
      <path
        d="M5 3 L19 12.5 L12.6 13.6 L9.2 19.6 Z"
        fill="#16181c"
        stroke="#ffffff"
        strokeWidth={1.75}
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** The hand key's grip: a closed hand, white with a grey keyline. */
export function HandArt() {
  return (
    <svg width={36} height={36} viewBox="0 0 24 24" aria-hidden="true">
      <path
        d="M6.5 11.5 V7.6 a1.75 1.75 0 0 1 3.5 0 V7 a1.75 1.75 0 0 1 3.5 0 V7.4 a1.75 1.75 0 0 1 3.5 0 V8.6 a1.75 1.75 0 0 1 3.5 0 V14.5 c0 2.4 -1 3.8 -2.2 4.8 V21.5 H9 V19.6 C7.4 18.4 5.6 16.2 4.2 14.2 a1.6 1.6 0 0 1 2.3 -2.2 Z"
        fill="#ffffff"
        stroke="#4b4f56"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      <path d="M12 13.5 V16.5 M14.25 13.5 V16.5 M16.5 13.5 V16.5" stroke="#4b4f56" strokeWidth={1.3} strokeLinecap="round" />
    </svg>
  );
}
