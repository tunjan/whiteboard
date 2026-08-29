import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { EraserModeSelector } from '@/components/eraser-mode-selector';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  INSTRUMENT_ART_HEIGHT,
  INSTRUMENT_ART_WIDTH,
  INSTRUMENT_CLIP,
  INSTRUMENT_EDGE as EDGE,
  INSTRUMENT_SLOT,
  INSTRUMENT_TRACK,
  INSTRUMENT_WELL,
} from './toolbar-constants';

/**
 * Every instrument is drawn standing upright in the same 28 x 56 box, with its
 * business end at the top and its handle running off the bottom.
 *
 * The box is taller than the tray is deep, and it is hung so that it breaks
 * out of it at both ends: the tip stands clear above the bar's top edge, out
 * over the canvas, and the handle runs down past the slot and is cut off flat
 * behind the tray's front lip. That pair of overruns is the whole illusion. A
 * drawing that fits inside its slot is a picture of a pencil; one the slot
 * cannot contain is a pencil lying in it.
 *
 * The silhouettes are deliberately unlike each other — a taper, a chisel, a
 * blunt block, a slim barrel — because at this size a tray is read by outline
 * first and colour second. Colours are fixed rather than themed: a pencil is
 * the colour of a pencil on either canvas, and these are objects, not chrome.
 */
const VIEW_BOX = '0 0 28 56';

/**
 * The pencil, and the marker below it, show the live ink at the nib.
 *
 * A white stylus rather than a hexagonal wooden pencil: a black cone standing
 * on a barrel whose shoulders swell out from under it, and a seam a third of
 * the way down. The barrel is lit across its width — bright just left of
 * centre, shaded at both edges — which is what makes a flat fill read as a
 * round body at this size.
 */
function Pencil({ ink }: { ink: string }) {
  return (
    <>
      <defs>
        <linearGradient
          id="tb-instrument-pencil"
          x1="5.5"
          y1="0"
          x2="22.5"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#c4c2bf" />
          <stop offset="0.18" stopColor="#ffffff" />
          <stop offset="0.48" stopColor="#f4f3f1" />
          <stop offset="0.84" stopColor="#dbd9d6" />
          <stop offset="1" stopColor="#aeacaa" />
        </linearGradient>
      </defs>
      <path
        d="M11 9.4C10.2 12.4 5.5 16.4 5.5 21.6V56h17V21.6c0-5.2-4.7-9.2-5.5-12.2Z"
        fill="url(#tb-instrument-pencil)"
      />
      {/* The seam. A hairline of shade with a lit edge under it — two marks,
          because a single line reads as a scratch rather than a joint. */}
      <path d="M5.5 25.6h17" stroke="rgba(12, 10, 9, 0.16)" strokeWidth={0.9} />
      <path
        d="M5.5 26.7h17"
        stroke="rgba(255, 255, 255, 0.85)"
        strokeWidth={0.8}
      />
      <path
        d="M11 9.4C10.2 12.4 5.5 16.4 5.5 21.6V56h17V21.6c0-5.2-4.7-9.2-5.5-12.2"
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* Drawn last so it sits on the barrel, and stroked in its own fill so
          the apex and the two base corners come back rounded. */}
      <path
        d="M10.3 9.9 L13.15 3.3 Q14 1.6 14.85 3.3 L17.7 9.9 Z"
        fill={ink}
        stroke={ink}
        strokeWidth={0.7}
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * A chisel-tip highlighter, drawn as the real object: a wedge nib standing out
 * of a white collar whose shoulders flare from the nib's width to the barrel's,
 * and then the barrel itself in the live ink.
 *
 * The collar is the whole recognition — a marker is told apart from a pen at
 * this size by that flare, not by the nib. Both nib and barrel take the ink and
 * are shaded with alpha overlays rather than fixed colours, so the shape reads
 * as round and lit at any hue.
 */
function Marker({ ink }: { ink: string }) {
  return (
    <>
      <defs>
        <linearGradient
          id="tb-instrument-marker-collar"
          x1="5.8"
          y1="0"
          x2="22.2"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#c9c7c4" />
          <stop offset="0.16" stopColor="#ffffff" />
          <stop offset="0.5" stopColor="#f6f5f3" />
          <stop offset="0.84" stopColor="#dedcd9" />
          <stop offset="1" stopColor="#b3b1ae" />
        </linearGradient>
        <linearGradient
          id="tb-instrument-marker-barrel"
          x1="6"
          y1="0"
          x2="22"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#000000" stopOpacity={0.14} />
          <stop offset="0.14" stopColor="#ffffff" stopOpacity={0.34} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.06} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.2} />
        </linearGradient>
        <linearGradient
          id="tb-instrument-marker-nib"
          x1="11.4"
          y1="0"
          x2="17.6"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.3} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.26} />
        </linearGradient>
      </defs>
      {/* The wedge. Cut back to the left so the writing edge faces up-right,
          and drawn first so the collar laps over its foot. */}
      <path d="M11.4 9.6V4.4L17.6 1.4v8.2Z" fill={ink} />
      <path
        d="M11.4 9.6V4.4L17.6 1.4v8.2Z"
        fill="url(#tb-instrument-marker-nib)"
      />
      <path
        d="M11.4 9.6V4.4L17.6 1.4v8.2Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The barrel, tucked under the collar's foot so no seam shows. */}
      <path
        d="M7.8 24h12.4a1.8 1.8 0 0 1 1.8 1.8V56H6V25.8A1.8 1.8 0 0 1 7.8 24Z"
        fill={ink}
      />
      <path
        d="M7.8 24h12.4a1.8 1.8 0 0 1 1.8 1.8V56H6V25.8A1.8 1.8 0 0 1 7.8 24Z"
        fill="url(#tb-instrument-marker-barrel)"
      />
      <path
        d="M7.8 24h12.4a1.8 1.8 0 0 1 1.8 1.8V56H6V25.8A1.8 1.8 0 0 1 7.8 24Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The collar. Straight down out of the nib, then an S out to the full
          width — the concave half of that curve is what makes it a marker. */}
      <path
        d="M10.4 11Q10.4 9.4 12 9.4h4Q17.6 9.4 17.6 11v3.2c0 4.6 4.6 5 4.6 9.6v1.2q0 1.6-1.6 1.6H7.4q-1.6 0-1.6-1.6v-1.2c0-4.6 4.6-5 4.6-9.6Z"
        fill="url(#tb-instrument-marker-collar)"
      />
      <path
        d="M10.4 11Q10.4 9.4 12 9.4h4Q17.6 9.4 17.6 11v3.2c0 4.6 4.6 5 4.6 9.6v1.2q0 1.6-1.6 1.6H7.4q-1.6 0-1.6-1.6v-1.2c0-4.6 4.6-5 4.6-9.6Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </>
  );
}

function Wand() {
  return (
    <>
      <path d="M14 2 18 10.5h-8Z" fill="#c9b8f8" />
      <path d="M8.6 10.5h10.8V56H8.6z" fill="#7c5cd6" />
      <path d="M15.2 10.5h4.2V56h-4.2z" fill="#6746bd" />
      <path d="M10.1 10.5h2.4V56h-2.4z" fill="#a58ce8" />
      <path d="M8.6 19.6h10.8v3.2H8.6z" fill="#5b3aa8" />
      <path
        d="M14 2 19.4 10.5V56H8.6V10.5Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
        strokeLinejoin="round"
      />
      {/* The sparkles are the only part that says "this pen guesses" — the
          barrel alone would just read as a second pencil. */}
      <path
        d="M20.6 3.4 21.5 5.7 23.8 6.6 21.5 7.5 20.6 9.8 19.7 7.5 17.4 6.6 19.7 5.7Z"
        fill="#f6c64a"
      />
      <path
        d="M7.2 8.2 7.8 9.7 9.3 10.3 7.8 10.9 7.2 12.4 6.6 10.9 5.1 10.3 6.6 9.7Z"
        fill="#f6c64a"
      />
    </>
  );
}

/**
 * The school rubber: a pink block sitting in a paper sleeve.
 *
 * The sleeve is the recognition. A bare pink block at this size is just a
 * rounded rectangle in a warm colour — it could be a sticky note or a swatch.
 * The band of blue with its printed stripes is what names the object, so it is
 * given the saturated colour and the only hard-edged detail in the tray.
 *
 * The block is lit across its width like the pencil beside it, with a sheen
 * laid over the top third: rubber is the one soft material here, and the
 * gloss is what keeps it from reading as flat card.
 */
function Eraser() {
  return (
    <>
      <defs>
        <linearGradient
          id="tb-instrument-eraser-block"
          x1="4.5"
          y1="0"
          x2="23.5"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#d98d84" />
          <stop offset="0.2" stopColor="#f3b3a9" />
          <stop offset="0.55" stopColor="#e79f95" />
          <stop offset="1" stopColor="#c47d74" />
        </linearGradient>
        <linearGradient
          id="tb-instrument-eraser-sheen"
          x1="0"
          y1="6"
          x2="0"
          y2="22"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ffffff" stopOpacity={0.5} />
          <stop offset="1" stopColor="#ffffff" stopOpacity={0} />
        </linearGradient>
        <linearGradient
          id="tb-instrument-eraser-sleeve"
          x1="4.5"
          y1="0"
          x2="23.5"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#4338ca" />
          <stop offset="0.22" stopColor="#7b74ee" />
          <stop offset="0.6" stopColor="#5f57e0" />
          <stop offset="1" stopColor="#3d33b8" />
        </linearGradient>
      </defs>
      {/* The block, drawn first so the sleeve laps over its foot. */}
      <rect
        x={4.5}
        y={6}
        width={19}
        height={32}
        rx={4.6}
        fill="url(#tb-instrument-eraser-block)"
      />
      <path
        d="M9.1 6h9.8a4.6 4.6 0 0 1 4.6 4.6V22H4.5V10.6A4.6 4.6 0 0 1 9.1 6Z"
        fill="url(#tb-instrument-eraser-sheen)"
      />
      <rect
        x={4.5}
        y={6}
        width={19}
        height={32}
        rx={4.6}
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
      />
      {/* The sleeve. Rounded where it is cut and folded over the block, and
          running straight off the bottom of the box like every handle here. */}
      <path
        d="M8.1 30h11.8a3.6 3.6 0 0 1 3.6 3.6V56H4.5V33.6A3.6 3.6 0 0 1 8.1 30Z"
        fill="url(#tb-instrument-eraser-sleeve)"
      />
      {/* The printed panel: a pale field carrying the bars. Kept inside the
          straight sides so it needs no clip against the folded corners. */}
      <path d="M11 30h6v26h-6z" fill="#f4f4f6" />
      <g fill="#17161c">
        <rect x={11.7} y={34.4} width={4.6} height={1.7} rx={0.3} />
        <rect x={11.7} y={38.4} width={4.6} height={1.7} rx={0.3} />
        <rect x={11.7} y={42.4} width={4.6} height={1.7} rx={0.3} />
        <rect x={11.7} y={46.4} width={4.6} height={1.7} rx={0.3} />
        <rect x={11.7} y={50.4} width={4.6} height={1.7} rx={0.3} />
      </g>
      <path
        d="M8.1 30h11.8a3.6 3.6 0 0 1 3.6 3.6V56H4.5V33.6A3.6 3.6 0 0 1 8.1 30Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * The laser pointer. Same material language as the marker — a chrome head
 * shaded across its width, a ring at the joint, a dark barrel lit off-centre —
 * but slim where the marker is fat, so the two never trade places at a glance.
 *
 * The lens is seated in the mouth rather than perched on top, and the halo
 * around it is the only light any instrument casts: this is the one tool whose
 * mark is not ink, and the glow is what says so.
 */
function Laser() {
  return (
    <>
      <defs>
        <linearGradient
          id="tb-instrument-laser-nose"
          x1="8.2"
          y1="0"
          x2="19.8"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#a5a29f" />
          <stop offset="0.16" stopColor="#fbfbfa" />
          <stop offset="0.5" stopColor="#e7e5e2" />
          <stop offset="0.84" stopColor="#c3c1be" />
          <stop offset="1" stopColor="#918e8b" />
        </linearGradient>
        <linearGradient
          id="tb-instrument-laser-ring"
          x1="7.6"
          y1="0"
          x2="20.4"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#8d8a87" />
          <stop offset="0.18" stopColor="#ffffff" />
          <stop offset="0.52" stopColor="#dedcd9" />
          <stop offset="0.86" stopColor="#b0adaa" />
          <stop offset="1" stopColor="#7d7a77" />
        </linearGradient>
        <linearGradient
          id="tb-instrument-laser-barrel"
          x1="8.2"
          y1="0"
          x2="19.8"
          y2="0"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#000000" stopOpacity={0.2} />
          <stop offset="0.14" stopColor="#ffffff" stopOpacity={0.32} />
          <stop offset="0.5" stopColor="#ffffff" stopOpacity={0.06} />
          <stop offset="1" stopColor="#000000" stopOpacity={0.3} />
        </linearGradient>
        <radialGradient
          id="tb-instrument-laser-glow"
          cx="14"
          cy="7"
          r="7"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#ef4444" stopOpacity={0.55} />
          <stop offset="0.55" stopColor="#ef4444" stopOpacity={0.14} />
          <stop offset="1" stopColor="#ef4444" stopOpacity={0} />
        </radialGradient>
        <radialGradient
          id="tb-instrument-laser-lens"
          cx="14"
          cy="7"
          r="2.4"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0" stopColor="#fca5a5" />
          <stop offset="0.45" stopColor="#ef4444" />
          <stop offset="1" stopColor="#b91c1c" />
        </radialGradient>
      </defs>
      <circle cx={14} cy={7} r={7} fill="url(#tb-instrument-laser-glow)" />
      <path
        d="M9.4 21.6h9.2a1.2 1.2 0 0 1 1.2 1.2V56H8.2V22.8a1.2 1.2 0 0 1 1.2-1.2Z"
        fill="#4a4441"
      />
      <path
        d="M9.4 21.6h9.2a1.2 1.2 0 0 1 1.2 1.2V56H8.2V22.8a1.2 1.2 0 0 1 1.2-1.2Z"
        fill="url(#tb-instrument-laser-barrel)"
      />
      <path
        d="M9.4 21.6h9.2a1.2 1.2 0 0 1 1.2 1.2V56H8.2V22.8a1.2 1.2 0 0 1 1.2-1.2Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The head. Straight out of the mouth, then flaring to the barrel — the
          marker's shoulder run through a narrower gap. */}
      <path
        d="M11.4 8.2Q11.4 6.9 12.7 6.9h2.6q1.3 0 1.3 1.3c0 4.3 3 7.9 3 11.4a1.2 1.2 0 0 1-1.2 1.2H9.4a1.2 1.2 0 0 1-1.2-1.2c0-3.5 3-7.1 3-11.4Z"
        fill="url(#tb-instrument-laser-nose)"
      />
      <path
        d="M11.4 8.2Q11.4 6.9 12.7 6.9h2.6q1.3 0 1.3 1.3c0 4.3 3 7.9 3 11.4a1.2 1.2 0 0 1-1.2 1.2H9.4a1.2 1.2 0 0 1-1.2-1.2c0-3.5 3-7.1 3-11.4Z"
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The ferrule, laid over the joint so the head looks fitted rather than
          drawn in one piece. */}
      <rect
        x={7.6}
        y={19.4}
        width={12.8}
        height={3.4}
        rx={1.1}
        fill="url(#tb-instrument-laser-ring)"
      />
      <rect
        x={7.6}
        y={19.4}
        width={12.8}
        height={3.4}
        rx={1.1}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
      />
      {/* The aperture behind the lens, so the glass has something to sit in. */}
      <path
        d="M11.4 8.2Q11.4 6.9 12.7 6.9h2.6q1.3 0 1.3 1.3v0.6h-5.2Z"
        fill="#3a3532"
      />
      <ellipse
        cx={14}
        cy={7.3}
        rx={2.1}
        ry={1.5}
        fill="url(#tb-instrument-laser-lens)"
      />
      <ellipse cx={14} cy={7} rx={0.8} ry={0.5} fill="#fee2e2" opacity={0.9} />
    </>
  );
}

const BODIES: Record<string, (props: { ink: string }) => React.JSX.Element> = {
  draw: Pencil,
  highlighter: Marker,
  wand: Wand,
  eraser: Eraser,
  laser: Laser,
};

/**
 * One instrument in the tray.
 *
 * Three nested boxes do three jobs — see `INSTRUMENT_SLOT` for what each is.
 * The one to hold on to here is that `overflow-hidden` sits on the button,
 * whose window starts above the bar and ends below it: the handle is cut off
 * at the bar's lower edge, the tip never is.
 *
 * The drawing slides up and down inside that window to show selection. A
 * selected instrument rises; an idle one sinks back, showing less of itself
 * above the bar and more of it swallowed below. That vertical travel is the
 * primary cue and the accent well is the secondary one, which is the reverse
 * of every other key on the bar — a drawn object can move, and a glyph cannot.
 */
function InstrumentButton({ toolId }: { toolId: string }) {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  const ink = useStyleStore((state) => state.color);
  const tool = toolRegistry.get(toolId);
  const Body = BODIES[toolId];

  if (!tool || !Body) return null;
  const active = tool.id === activeToolId;

  const button = (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            data-toolbar-item
            type="button"
            tabIndex={active ? 0 : -1}
            onClick={() => setTool(tool.id)}
            aria-label={tool.label}
            aria-current={active ? 'true' : undefined}
            aria-keyshortcuts={tool.hotkey?.toUpperCase()}
            className={INSTRUMENT_CLIP}
          />
        }
      >
        {/* The well stays inside the bar while the object leaves it. The same
            flat chip filling the same recess that marks every other selected
            key on the bar, so one vocabulary marks "loaded" everywhere. */}
        <span
          className={cn(
            INSTRUMENT_WELL,
            active
              ? 'bg-tb-accent'
              : 'bg-transparent group-hover/slot:bg-tb-accent/60',
          )}
        />
        <svg
          viewBox={VIEW_BOX}
          width={INSTRUMENT_ART_WIDTH}
          height={INSTRUMENT_ART_HEIGHT}
          aria-hidden="true"
          className={cn(
            // Positioned, so it paints over the absolutely placed well rather
            // than under it.
            'relative transition-transform duration-base ease-out-quart',
            'motion-reduce:transition-none',
            active ? 'translate-y-0' : 'translate-y-3.5',
          )}
        >
          <Body ink={ink} />
        </svg>
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{tool.label}</span>
        {tool.hotkey ? (
          <Kbd className="font-mono uppercase">{tool.hotkey}</Kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );

  // The eraser's mode selector has to hang outside the clipping window, so it
  // is anchored to the slot rather than to the button itself.
  return (
    <div className={INSTRUMENT_SLOT}>
      {button}
      {tool.id === 'eraser' ? <EraserModeSelector active={active} /> : null}
    </div>
  );
}

/**
 * The instrument tray: the inking tools as drawn objects tucked into the bar
 * rather than as glyphs printed on it.
 *
 * It is the middle of the bar and the only place there that carries any
 * material, which is the point — the tools you hold are found by shape, and
 * everything either side of them is found by reading an icon.
 */
export function InstrumentTray({
  tools,
  children,
}: {
  tools: readonly string[];
  children?: React.ReactNode;
}) {
  return (
    <div role="group" aria-label="Instruments" className={INSTRUMENT_TRACK}>
      {tools.map((id) => (
        <InstrumentButton key={id} toolId={id} />
      ))}
      {children}
    </div>
  );
}
