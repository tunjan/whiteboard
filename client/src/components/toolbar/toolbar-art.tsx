import { useId, type CSSProperties, type ReactNode } from 'react';
import type { PolygonKind } from '@whiteboard/shared';
import { polygonPointsForBox } from '@/canvas/shapes/polygon-geometry';

/**
 * The drawer's tools, drawn as objects rather than glyphs.
 *
 * Every piece is 48×60 and stands on its bottom edge, which the bar cuts off:
 * the tools sit in the drawer and only their tops show, and the one in hand
 * rises far enough to show a bare shape whole. Colours are the objects' own,
 * not theme tokens — a pen is white in either theme — except the ink, which is
 * the tool's current colour, and bare shapes, which take the bar's ink.
 *
 * Proportions and greys are measured off the reference screenshots.
 */

/** Bare shapes take the bar's ink (`--drawer-ink`), so they read in either theme. */
const INK = 'currentColor';
/** Line work printed on a white object stays grey whatever the theme. */
const PRINT = '#646464';
/** The grey rim of a white object. */
const RIM = '#c9c9c9';
/** The rim of a card, a little lighter than a tool's. */
const CARD_RIM = '#d2d2d2';
/** The dark that an unpainted part of a tool is made of. */
const GRAPHITE = '#3d4149';
/** The laser's own red, as `LaserMark` draws it on the board. */
const LASER = '#FF182B';

/** A filled part's rim: its own colour, a little darker. */
function edge(color: string): string {
  return `color-mix(in srgb, ${color} 84%, black)`;
}

/** `slim` art stands in a glyph-width key, so holding it never resizes the bar. */
function Art({
  children,
  slim = false,
  viewBox = '0 0 48 60',
}: {
  children: ReactNode;
  slim?: boolean;
  viewBox?: string;
}) {
  return (
    <svg
      width={48}
      height={60}
      viewBox={viewBox}
      className={slim ? 'drawer-art-slim' : undefined}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/** A horizontal sheen: lit on the left, turning grey toward the right. */
function Sheen({ id, stops }: { id: string; stops: [number, string][] }) {
  return (
    <linearGradient id={id} x1="0" x2="1" y1="0" y2="0">
      {stops.map(([offset, color]) => (
        <stop key={offset} offset={offset} stopColor={color} />
      ))}
    </linearGradient>
  );
}

/** The shadow a collar casts down a body, from `y1` to nothing at `y2`. */
function CollarShade({ id, y1, y2 }: { id: string; y1: number; y2: number }) {
  return (
    <linearGradient id={id} gradientUnits="userSpaceOnUse" x1="0" x2="0" y1={y1} y2={y2}>
      <stop offset="0" stopColor="#000" stopOpacity="0.07" />
      <stop offset="1" stopColor="#000" stopOpacity="0" />
    </linearGradient>
  );
}

const PEN_BODY: [number, string][] = [
  [0.3, '#f8f8f8'],
  [0.5, '#f4f4f4'],
  [0.75, '#e9e9e9'],
  [1, '#d9d9d9'],
];

export function PencilArt({ color }: { color: string }) {
  const id = useId();
  const body = 'M18.1 19.7 C15.5 27.5 11.5 37 10 49 L9.6 62 H38.4 L38 49 C36.5 37 32.5 27.5 29.9 19.7 Z';
  return (
    <Art>
      <defs>
        <Sheen id={id} stops={PEN_BODY} />
        <CollarShade id={`${id}shade`} y1={20} y2={44} />
      </defs>
      <path
        d="M19.2 19.4 C20.6 13 21.6 9 22.3 6.6 C22.6 5.5 23.2 5 24 5 C24.8 5 25.4 5.5 25.7 6.6 C26.4 9 27.4 13 28.8 19.4 Z"
        fill={color}
        stroke={edge(color)}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path d={body} fill={`url(#${id})`} stroke={RIM} strokeWidth={1.1} strokeLinejoin="round" />
      <path d={body} fill={`url(#${id}shade)`} />
    </Art>
  );
}

export function HighlighterArt({ color }: { color: string }) {
  const id = useId();
  const body = 'M16 13 H32 Q32.7 13 32.8 13.7 L35.4 34 L36.2 62 H11.8 L12.6 34 L15.2 13.7 Q15.3 13 16 13 Z';
  return (
    <Art>
      <defs>
        <Sheen
          id={id}
          stops={[
            [0.1, '#f8f8f8'],
            [0.45, '#eeeeee'],
            [0.75, '#e1e1e1'],
            [1, '#d9d9d9'],
          ]}
        />
        <CollarShade id={`${id}shade`} y1={13} y2={19} />
      </defs>
      {/* Lighter than the ink, as a chisel tip soaked in it is. */}
      <path
        d="M17.2 13.2 L18.1 6.7 Q18.3 5.4 19.6 5 L27.5 2.5 Q29.8 1.9 30 4.1 L30.2 13.2 Z"
        fill={`color-mix(in srgb, ${color} 65%, white)`}
        stroke={`color-mix(in srgb, ${color} 88%, white)`}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
      <path d={body} fill={`url(#${id})`} stroke={RIM} strokeWidth={1} strokeLinejoin="round" />
      <path d={body} fill={`url(#${id}shade)`} />
    </Art>
  );
}

export function EraserArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <linearGradient id={`${id}cap`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f8bdb7" />
          <stop offset="0.75" stopColor="#f3a9a3" />
          <stop offset="1" stopColor="#e6948e" />
        </linearGradient>
        <Sheen
          id={`${id}sleeve`}
          stops={[
            [0, '#f1f1f1'],
            [0.45, '#f8f8f8'],
            [1, '#ececec'],
          ]}
        />
      </defs>
      <rect x="10" y="5" width="28" height="22" rx="3.8" fill={`url(#${id}cap)`} />
      {/* The rubber turning away at its right end. */}
      <path d="M32.8 27 V13 C32.8 9 34.2 6.4 36 6 C37.2 6.6 37.6 7.6 37.6 8.8 V27 Z" fill="#e28d87" />
      <rect x="10" y="5" width="28" height="22" rx="3.8" fill="none" stroke="#c97570" strokeWidth={1.2} />
      <path
        d="M10 23.7 L34 22.9 V62 H8.6 V25 Q8.6 23.8 10 23.7 Z"
        fill={`url(#${id}sleeve)`}
        stroke="#ababab"
        strokeLinejoin="round"
      />
      <path d="M34 22.9 L38 23.4 Q39.4 23.6 39.4 25 V62 H34 Z" fill="#b4b4b4" stroke="#ababab" strokeWidth={0.8} />
    </Art>
  );
}

export type ShapeArtKind = 'rectangle' | 'ellipse' | 'line' | PolygonKind;

/** A shape's inside: solid in hand, and at rest a tint, so a dark shape does not outweigh the tool in hand. */
function shapeCore(color: string) {
  return {
    className: 'drawer-shape-core',
    fill: color,
    stroke: color,
    style: { '--shape-ink': color } as CSSProperties,
  };
}

export function ShapeArt({ kind, color = INK }: { kind: ShapeArtKind; color?: string }) {
  if (kind === 'rectangle') {
    return (
      <Art>
        <rect x="2.1" y="4.2" width="43.8" height="42" rx="3.4" fill={color} stroke={edge(color)} />
        <rect x="4.3" y="6.4" width="39.4" height="37.6" rx="1.6" strokeWidth={0} {...shapeCore(color)} />
      </Art>
    );
  }
  if (kind === 'ellipse') {
    return (
      <Art>
        <circle cx="24" cy="25" r="21" fill={color} stroke={edge(color)} />
        <circle cx="24" cy="25" r="18.8" strokeWidth={0} {...shapeCore(color)} />
      </Art>
    );
  }
  if (kind === 'line') {
    return (
      <Art>
        <path d="M9 38 L39 6" stroke={color} strokeWidth={4} strokeLinecap="round" />
      </Art>
    );
  }
  // Square, or the regular kinds (star, pentagon, hexagon) squash.
  const points = polygonPointsForBox(kind, 6.5, 7.5, 35, 35);
  return (
    <Art>
      {/* A round join is what rounds the corners, so the rim goes under it. */}
      <polygon points={points} fill={color} stroke={edge(color)} strokeWidth={8} strokeLinejoin="round" />
      <polygon points={points} fill={color} stroke={color} strokeWidth={6} strokeLinejoin="round" />
      <polygon points={points} strokeWidth={2} strokeLinejoin="round" {...shapeCore(color)} />
    </Art>
  );
}

export function ArrowArt({ color = INK }: { color?: string }) {
  return (
    <Art>
      <path
        d="M24 62 V5 M10.8 18.2 L24 5 L37.2 18.2"
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Art>
  );
}

/** A white card, the stock most of the objects are printed on. */
function Card({ y = 8, fill = '#ffffff' }: { y?: number; fill?: string }) {
  return <rect x="3" y={y} width="42" height={64 - y} rx="5" fill={fill} stroke={CARD_RIM} />;
}

/** A square of paper with a hand-lettered T, dark on white in either theme. */
export function TextArt() {
  return (
    <Art>
      <rect x="2.2" y="4.2" width="43.6" height="42.2" rx="3.3" fill="#ffffff" stroke={CARD_RIM} />
      <path
        d="M18.6 18.9 C22 19.5 26 19.4 30.2 18.8 M24.6 19.8 C23.6 23 23.2 27 23.9 31.6"
        fill="none"
        stroke={GRAPHITE}
        strokeWidth={3.2}
        strokeLinecap="round"
      />
    </Art>
  );
}

export function FrameArt() {
  return (
    <Art>
      <path
        d="M2 66 V7.3 Q2 4.3 5 4.3 H19 Q22 4.3 22 7.3 V10.3 H43 Q46 10.3 46 13.3 V66 Z"
        fill="#e6e6e6"
        stroke="#b4b4b4"
        strokeLinejoin="round"
      />
    </Art>
  );
}

export function ImageArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <linearGradient id={`${id}sky`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#dad7dd" />
          <stop offset="0.14" stopColor="#f3d18e" />
          <stop offset="0.32" stopColor="#f6bf55" />
        </linearGradient>
        <linearGradient id={`${id}back`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#a9b4ef" />
          <stop offset="0.6" stopColor="#8d9be6" />
        </linearGradient>
        <linearGradient id={`${id}front`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#6c80e0" />
          <stop offset="0.6" stopColor="#4f63cf" />
        </linearGradient>
        <linearGradient id={`${id}inset`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#000" stopOpacity="0.1" />
          <stop offset="1" stopColor="#000" stopOpacity="0" />
        </linearGradient>
      </defs>
      <Card y={4} />
      <rect x="7" y="10" width="34" height="56" rx="1.5" fill={`url(#${id}sky)`} />
      <circle cx="30.2" cy="16.6" r="5.6" fill="#fbefd2" stroke="#fff7e6" strokeWidth={0.6} />
      <path d="M7 19 C13 20 20 20.5 25.5 22.6 C31 24.8 36.5 29 41 34.3 V66 H7 Z" fill={`url(#${id}back)`} />
      <path
        d="M7 19.4 C9 17.8 12.5 17.4 15.5 20 S23 26.5 27 29.5 S36 36.5 41 39 V66 H7 Z"
        fill={`url(#${id}front)`}
      />
      {/* The photo sits just below the card's surface. */}
      <rect x="7" y="10" width="34" height="4" rx="1.5" fill={`url(#${id}inset)`} />
      <rect x="7" y="10" width="34" height="56" rx="1.5" fill="none" stroke="rgba(0,0,0,.08)" strokeWidth={0.75} />
    </Art>
  );
}

/** A graphing calculator: a curve on its dark screen, its keys down in the drawer. */
export function GraphArt() {
  const id = useId();
  return (
    <Art>
      <defs>
        <Sheen id={id} stops={PEN_BODY} />
      </defs>
      <rect x="6" y="4" width="36" height="62" rx="4" fill={`url(#${id})`} stroke={RIM} strokeWidth={1.1} />
      <rect x="10" y="8" width="28" height="23.5" rx="2" fill={GRAPHITE} stroke={edge(GRAPHITE)} strokeWidth={0.8} />
      <path d="M12.5 20 H35.5 M17 10.5 V29" stroke="#737880" strokeWidth={0.9} strokeLinecap="round" />
      <path
        d="M12.8 26.5 C17 26.5 18 12.8 23 12.8 C27.5 12.8 28 22 35.2 15.4"
        fill="none"
        stroke="#7db0fa"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <path
        d="M11.5 37 H16.5 M21.5 37 H26.5 M31.5 37 H36.5 M11.5 43 H16.5 M21.5 43 H26.5 M31.5 43 H36.5 M11.5 49 H16.5 M21.5 49 H26.5 M31.5 49 H36.5"
        stroke="#c4c4c4"
        strokeWidth={3}
        strokeLinecap="round"
      />
    </Art>
  );
}

/** A die-cut stamp, as the board lays one: a star in its white halo, set on a slant. */
export function StickerArt() {
  const id = useId();
  const star = polygonPointsForBox('star', 7, 7.5, 34, 32);
  return (
    <Art>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#f8c452" />
          <stop offset="1" stopColor="#ea9f22" />
        </linearGradient>
      </defs>
      <g transform="rotate(-8 24 23)" strokeLinejoin="round">
        <polygon points={star} fill={RIM} stroke={RIM} strokeWidth={10.6} />
        <polygon points={star} fill="#ffffff" stroke="#ffffff" strokeWidth={9} />
        <polygon points={star} fill={`url(#${id})`} stroke="#eead30" strokeWidth={1.6} />
      </g>
    </Art>
  );
}

/**
 * A pen's sibling: a dark nose, a red button on the barrel, and the red dot it
 * throws, which is lit only in hand. The dot stands above the art's top line.
 */
export function LaserArt() {
  const id = useId();
  return (
    <Art slim>
      <defs>
        <radialGradient id={`${id}glow`}>
          <stop offset="0.2" stopColor={LASER} stopOpacity="0.9" />
          <stop offset="1" stopColor={LASER} stopOpacity="0" />
        </radialGradient>
        <Sheen id={id} stops={PEN_BODY} />
        <CollarShade id={`${id}shade`} y1={19} y2={36} />
      </defs>
      <g transform="translate(0 -6)">
        <g className="drawer-laser-beam">
          <circle cx="24" cy="8" r="4.5" fill={`url(#${id}glow)`} />
          <circle cx="24" cy="8" r="1.7" fill="#fff5f5" />
        </g>
        <path
          d="M20.6 12.6 Q20.6 11 22.2 11 H25.8 Q27.4 11 27.4 12.6 L29 19 H19 Z"
          fill={GRAPHITE}
          stroke={edge(GRAPHITE)}
          strokeWidth={0.8}
          strokeLinejoin="round"
        />
        <path
          d="M18.4 18.6 H29.6 Q31.4 18.6 31.6 20.4 L33 68 H15 L16.4 20.4 Q16.6 18.6 18.4 18.6 Z"
          fill={`url(#${id})`}
          stroke={RIM}
          strokeWidth={1.1}
        />
        <path d="M18.4 18.6 H29.6 Q31.4 18.6 31.6 20.4 L33 68 H15 L16.4 20.4 Q16.6 18.6 18.4 18.6 Z" fill={`url(#${id}shade)`} />
        <rect x="21.6" y="25" width="4.8" height="9" rx="2.4" fill={LASER} stroke={edge(LASER)} strokeWidth={0.7} />
      </g>
    </Art>
  );
}

export function CommentArt() {
  return (
    <Art slim>
      <path
        d="M10 7 H38 Q44.5 7 44.5 13.5 V31.5 Q44.5 38 38 38 H21 L11 46 V38 H10 Q3.5 38 3.5 31.5 V13.5 Q3.5 7 10 7 Z"
        fill="#fff"
        stroke={CARD_RIM}
        strokeLinejoin="round"
      />
      <rect x="10.5" y="15" width="27" height="3.4" rx="1.7" fill="#cecece" />
      <rect x="10.5" y="23" width="18" height="3.4" rx="1.7" fill="#cecece" />
    </Art>
  );
}

export function EquationArt() {
  return (
    <Art slim>
      <Card />
      <path
        d="M32 20 V16.5 H16 L25 27 L16 37.5 H32 V34"
        fill="none"
        stroke={PRINT}
        strokeWidth={2.4}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Art>
  );
}

export function StraightedgeArt() {
  const id = useId();
  return (
    <Art slim>
      <defs>
        <Sheen id={id} stops={PEN_BODY} />
      </defs>
      <rect x="13" y="5" width="22" height="62" rx="2.5" fill={`url(#${id})`} stroke={RIM} strokeWidth={1.1} />
      <path
        d="M13 11 H21 M13 17 H18 M13 23 H21 M13 29 H18 M13 35 H21 M13 41 H18 M13 47 H21"
        stroke={PRINT}
        strokeWidth={1}
      />
    </Art>
  );
}

export function CompassArt() {
  const id = useId();
  return (
    <Art slim>
      <defs>
        <Sheen id={id} stops={PEN_BODY} />
      </defs>
      <path d="M21 13 L9.5 62 H14 L24.6 16 Z" fill={`url(#${id})`} stroke={RIM} strokeLinejoin="round" />
      <path d="M27 13 L38.5 62 H34 L23.4 16 Z" fill={`url(#${id})`} stroke={RIM} strokeLinejoin="round" />
      <rect x="22.2" y="2.5" width="3.6" height="7" rx="1.2" fill={GRAPHITE} stroke={edge(GRAPHITE)} strokeWidth={0.7} />
      <circle cx="24" cy="12.5" r="5.2" fill={GRAPHITE} stroke={edge(GRAPHITE)} strokeWidth={0.8} />
      <circle cx="24" cy="12.5" r="1.5" fill="#f4f4f4" />
    </Art>
  );
}

/** A tape measure: the case, its spool, the yellow tape run out of the side. */
export function MeasureArt() {
  const id = useId();
  return (
    <Art slim>
      <defs>
        <Sheen id={id} stops={PEN_BODY} />
      </defs>
      <path d="M36 31 H45.5 V37.5 H43.8 V35.6 H36 Z" fill="#f8d784" stroke="#cdb26d" strokeWidth={0.8} strokeLinejoin="round" />
      <rect x="3.5" y="7" width="34" height="56" rx="9" fill={`url(#${id})`} stroke={RIM} strokeWidth={1.1} />
      <circle cx="20.5" cy="24.5" r="9" fill={GRAPHITE} stroke={edge(GRAPHITE)} strokeWidth={0.8} />
      <circle cx="20.5" cy="24.5" r="2.4" fill="#f4f4f4" />
    </Art>
  );
}

/**
 * The select key's pointer: a solid arrow in a white keyline, its tail cut
 * square. Traced off the reference; `.drawer-glyph`'s tile sits behind it.
 */
export function PointerArt() {
  return (
    <svg
      width={36}
      height={36}
      viewBox="0 0 36 36"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1.5px 2.5px rgba(0, 0, 0, 0.3))' }}
    >
      <path d="M7 7 L28.2 18.3 L22 20.8 L24.7 24.7 L20.5 28.5 L17.2 24.7 L13.3 30.3 Z" fill="#ffffff" />
      <path d="M9.7 10.3 L24 17.9 L19 19.9 L22.2 24.9 L20.7 26.1 L17.3 21.3 L13.8 25.8 Z" fill="#202020" />
    </svg>
  );
}

const HAND =
  'M157 245 V115 C157 95 172 85 190 85 C212 85 226 94 232 110 C240 98 250 96 262 97 C282 98 298 112 305 130 C314 116 324 112 335 112 C352 112 366 124 372 142 C380 130 392 127 405 127 C430 127 450 150 450 178 V290 C450 320 420 365 395 425 V483 H345 L332 435 L318 483 H187 V432 C170 405 130 378 100 358 C86 348 80 332 80 318 V210 C80 180 105 154 157 152';

/** The hand key's grip: a fist drawn as the pointer is, solid in a white keyline. */
export function HandArt() {
  return (
    <svg
      width={36}
      height={36}
      viewBox="-15 5 560 560"
      aria-hidden="true"
      style={{ filter: 'drop-shadow(0 1px 2px rgba(0, 0, 0, 0.25))' }}
    >
      <path d={HAND} fill="#ffffff" stroke="#ffffff" strokeWidth={70} strokeLinejoin="round" />
      <path d={HAND} fill="#202020" stroke="#202020" strokeWidth={10} strokeLinejoin="round" />
      <path d="M260 258 V365 M313 258 V365 M367 258 V365" stroke="#ffffff" strokeWidth={18} strokeLinecap="round" />
    </svg>
  );
}
