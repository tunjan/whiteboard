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
  INSTRUMENT_BODY,
  INSTRUMENT_CLIP,
  INSTRUMENT_DARK,
  INSTRUMENT_EDGE as EDGE,
  INSTRUMENT_SEAM,
  INSTRUMENT_SLOT,
  INSTRUMENT_TRACK,
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
 * They are drawn flat: one fill per part, a single soft edge line around it,
 * and nothing else. No gradient across a barrel, no sheen, no cast light. At
 * 36 x 72 a moulded highlight is a smear rather than a cue, and it puts the
 * tray in relief on a bar that is deliberately flat everywhere else. What is
 * left to carry each object is its outline and its colour, so both are pushed:
 * the silhouettes are deliberately unlike each other — a taper, a chisel, a
 * blunt block, a slim barrel, a wide plate — and the palette is four flat
 * colours, fixed rather than themed. A pencil is the colour of a pencil on
 * either canvas, and these are objects, not chrome.
 */
const VIEW_BOX = '0 0 28 56';

/**
 * The pencil, and the marker below it, show the live ink at the nib.
 *
 * A white stylus rather than a hexagonal wooden pencil: a flat cone standing
 * on a barrel whose shoulders swell out from under it, and a seam a third of
 * the way down. The seam is a band rather than a line — at this size a
 * hairline reads as a scratch, and a band reads as a joint.
 */
function Pencil({ ink }: { ink: string }) {
  const body =
    'M11 9.4C10.2 12.4 5.5 16.4 5.5 21.6V56h17V21.6c0-5.2-4.7-9.2-5.5-12.2';
  return (
    <>
      <path d={`${body}Z`} fill={INSTRUMENT_BODY} />
      <rect x={5.5} y={25.2} width={17} height={2.6} fill={INSTRUMENT_SEAM} />
      <path
        d={body}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* Drawn last so it sits on the barrel, and stroked in its own fill so
          the apex and the two base corners come back rounded. */}
      <path
        d="M10.1 10 L13.05 3.1 Q14 1.3 14.95 3.1 L17.9 10 Z"
        fill={ink}
        stroke={ink}
        strokeWidth={0.8}
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * A chunky chisel-tip highlighter: an angled wedge nib standing out of a
 * white collar with a slender neck, flaring shoulders that curve into a
 * wider barrel, and a live-ink lower body with rounded corners at its base.
 *
 * The white upper body meets the colored lower half at a clean horizontal seam,
 * giving it the recognizable mini desk-highlighter silhouette.
 */
function Marker({ ink }: { ink: string }) {
  const nib =
    'M10.1 12V5.8Q10.1 4.6 11.2 4.3L17.4 2.2Q17.9 2 17.9 2.5V12Z';
  const barrel =
    'M5.3 28h17.4v14.8a2.6 2.6 0 0 1-2.6 2.6H7.9a2.6 2.6 0 0 1-2.6-2.6Z';
  const collar =
    'M9.3 11.6Q9.3 10.8 10.1 10.8h7.8q0.8 0 0.8 0.8v3.9c0 4 4 3.7 4 7.5v6H5.3v-6c0-3.8 4-3.5 4-7.5Z';
  return (
    <>
      {/* The wedge nib. Cut back with an angled slant to the right, and drawn
          first so the collar's mouth laps over its foot. */}
      <path d={nib} fill={ink} />
      <path
        d={nib}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The lower barrel in the live ink, with rounded base corners. */}
      <path d={barrel} fill={ink} />
      <path
        d={barrel}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The white collar and upper body: slender neck flaring out into the
          wide barrel, with its bottom edge drawing the seam across the body. */}
      <path d={collar} fill={INSTRUMENT_BODY} />
      <path
        d={collar}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * The school rubber: a pink block sitting in a paper sleeve.
 *
 * The sleeve is the recognition. A bare pink block at this size is just a
 * rounded rectangle in a warm colour — it could be a sticky note or a swatch.
 * The band of blue with its printed panel is what names the object, so it is
 * given the one saturated colour in the tray and the only hard-edged detail
 * in it.
 */
function Eraser() {
  const sleeve =
    'M8.1 30h11.8a3.4 3.4 0 0 1 3.4 3.4V56H4.7V33.4A3.4 3.4 0 0 1 8.1 30Z';
  return (
    <>
      {/* The block, drawn first so the sleeve laps over its foot. */}
      <rect
        x={4.5}
        y={3.5}
        width={19}
        height={34.5}
        rx={5.4}
        fill="#e2a099"
        stroke={EDGE}
        strokeWidth={1}
      />
      <path d={sleeve} fill="#4038d8" />
      {/* The printed panel: a pale field carrying the bar. Kept inside the
          straight sides so it needs no clip against the folded corners. */}
      <path d="M11 30h6v26h-6z" fill="#f4f3f1" />
      <rect
        x={11.7}
        y={33.4}
        width={4.6}
        height={2.4}
        rx={0.3}
        fill="#1d1b20"
      />
      <path
        d={sleeve}
        fill="none"
        stroke={EDGE}
        strokeWidth={1}
        strokeLinejoin="round"
      />
    </>
  );
}

/**
 * The laser pointer. Slim where the marker is fat, so the two never trade
 * places at a glance: a dark barrel, a white collar at the joint, and a white
 * nose narrowing to the emitter.
 *
 * The dome is seated on the mouth rather than perched over it, and the red at
 * the nose is the only warm mark on an otherwise black-and-white object: this
 * is the one tool whose mark is not ink, and the emitter is what says so.
 */
function Laser({ active }: { active?: boolean }) {
  const barrel = 'M5.3 25V56h17.4V25Z';
  const nose =
    'M10.4 7.7C9.8 7.7 9.2 8.6 9.2 10.8C9.2 14.5 8.2 19 6.9 22.8V25h14.2v-2.2C19.8 19 18.8 14.5 18.8 10.8C18.8 8.6 18.2 7.7 17.6 7.7Z';
  const emitter = 'M10.4 7.7V5.4a3.6 3.6 0 0 1 7.2 0v2.3Z';
  return (
    <>
      {active && (
        <defs>
          <radialGradient id="tb-laser-glow" cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor="#FF3B30" stopOpacity={0.65} />
            <stop offset="50%" stopColor="#FF3B30" stopOpacity={0.25} />
            <stop offset="100%" stopColor="#FF3B30" stopOpacity={0} />
          </radialGradient>
        </defs>
      )}

      {/* Flat ambient laser glow aura emanating from the tip */}
      {active && (
        <circle
          cx={14}
          cy={5.4}
          r={9}
          fill="url(#tb-laser-glow)"
          className="laser-tip-glow pointer-events-none"
        />
      )}

      <path d={barrel} fill={INSTRUMENT_DARK} />
      <path
        d={barrel}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The head: curves outward from the emitter to a slender neck, then
          flutes outward to meet the ferrule. */}
      <path d={nose} fill={INSTRUMENT_BODY} />
      <path
        d={nose}
        fill="none"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
      {/* The ferrule, a rounded capsule covering the joint. */}
      <rect
        x={4.9}
        y={22.4}
        width={18.2}
        height={4.4}
        rx={2.2}
        fill={INSTRUMENT_BODY}
        stroke={EDGE}
        strokeWidth={0.9}
      />
      {/* The emitter ("cherry on top"), flat-bottomed on the mouth. */}
      <path
        d={emitter}
        fill="#FF3B30"
        stroke={EDGE}
        strokeWidth={0.9}
        strokeLinejoin="round"
      />
    </>
  );
}

const BODIES: Record<
  string,
  (props: { ink: string; active?: boolean }) => React.JSX.Element
> = {
  draw: Pencil,
  highlighter: Marker,
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
        <svg
          viewBox={VIEW_BOX}
          width={INSTRUMENT_ART_WIDTH}
          height={INSTRUMENT_ART_HEIGHT}
          aria-hidden="true"
          className={cn(
            // Positioned, so it paints over the absolutely placed well rather
            // than under it.
            'relative transition-transform duration-base ease-out-quart overflow-visible',
            'motion-reduce:transition-none',
            // Standing up *is* the selection now that no chip marks it, and
            // hover is that same movement begun: the instrument rises a
            // little under the pointer and the rest of the way once held.
            active
              ? 'translate-y-0'
              : 'translate-y-3.5 group-hover/slot:translate-y-2',
          )}
        >
          <Body ink={ink} active={active} />
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
