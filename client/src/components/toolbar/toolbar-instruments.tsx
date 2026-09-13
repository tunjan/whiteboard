import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
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
  INSTRUMENT_SEAM,
  INSTRUMENT_SHADE,
  INSTRUMENT_SHADE_BAND,
  INSTRUMENT_SHEEN,
  INSTRUMENT_SHEEN_BAND,
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
 * They are drawn the way Apple draws the tools in its own markup palettes,
 * and the three rules that come with that are worth stating, because each one
 * is a thing this tray used to do the other way:
 *
 *   · **Nothing is outlined.** Every part is a flat fill meeting another flat
 *     fill. A hairline round each part is what makes a set of stickers, and it
 *     was the first thing standing between these drawings and reading as
 *     objects. What separates them from the board instead is the contact
 *     shadow they already carry (`tb-glyph`) and the fact that no body is
 *     pure white any more.
 *   · **One light, one shade, for the whole row.** Each object clips the same
 *     two bands — a sheen down its left quarter, a shade down its right — to
 *     its own silhouette (`Form`). That is all the modelling there is: no
 *     gradient along a barrel, no cast light, no second highlight. It is
 *     enough to make a cylinder, and stopping there is what keeps five small
 *     objects looking like one set rather than five illustrations.
 *   · **The ink is used confidently.** Where a tool lays down colour, the
 *     colour takes a whole part — the pen's entire nib, the highlighter's
 *     wedge and its lower barrel — rather than a token mark at the tip.
 *
 * What carries each object is then its outline and its colour, so both are
 * pushed: the silhouettes are deliberately unlike each other — a taper, a
 * chisel, a blunt block, a slim barrel, a wide plate — and the palette is a
 * few flat colours, fixed rather than themed. A pen is the colour of a pen on
 * either canvas, and these are objects, not chrome.
 */
const VIEW_BOX = '0 0 28 56';

/**
 * The modelling, and the whole of it: a sheen down the left of the object and
 * a shade down its right, both clipped to the silhouette handed in.
 *
 * Drawn as two bands across the full 28-wide box rather than as paths that
 * follow each barrel, so one pair of numbers lights every object in the row
 * from the same side, and a narrow instrument takes proportionally less of
 * both than a wide one — which is what happens to real cylinders standing in
 * the same light.
 *
 * `id` has to be unique per instrument but not per mount: two toolbars in one
 * document (the review harness renders a light board and a dark one) resolve a
 * duplicate id to the first, and the first is the identical shape.
 */
function Form({ id, d }: { id: string; d: string }) {
  return (
    <>
      <clipPath id={id}>
        <path d={d} />
      </clipPath>
      <g clipPath={`url(#${id})`}>
        <rect
          x={INSTRUMENT_SHEEN_BAND.x}
          y={0}
          width={INSTRUMENT_SHEEN_BAND.width}
          height={56}
          fill={INSTRUMENT_SHEEN}
        />
        <rect
          x={INSTRUMENT_SHADE_BAND.x}
          y={0}
          width={INSTRUMENT_SHADE_BAND.width}
          height={56}
          fill={INSTRUMENT_SHADE}
        />
      </g>
    </>
  );
}

/**
 * The pen. A long ink nib standing on a plain barrel, and nothing else on it.
 *
 * The nib is the whole point of the drawing and it is given a third of the
 * object's height in the live colour — the confident use of ink that separates
 * Apple's pen from a white pencil with a coloured dot at the tip. Under it the
 * barrel swells out of the neck in one continuous curve and runs straight off
 * the bottom, with a single printed seam across it. No ferrule, no band at the
 * joint, no second colour: the silhouette is a taper, and a taper is already
 * unlike everything else in the row.
 */
function Pencil({ ink }: { ink: string }) {
  const nib = 'M13 5.2Q14 2.1 15 5.2L18.5 17.1H9.5Z';
  const barrel =
    'M9.5 16.4H18.5V18.2C18.5 21.6 21.6 22.9 21.6 26.6V56H6.4V26.6C6.4 22.9 9.5 21.6 9.5 18.2Z';
  const silhouette =
    'M13 5.2Q14 2.1 15 5.2L18.5 18.2C18.5 21.6 21.6 22.9 21.6 26.6V56H6.4V26.6C6.4 22.9 9.5 21.6 9.5 18.2Z';
  return (
    <>
      <path d={barrel} fill={INSTRUMENT_BODY} />
      {/* The seam. A band rather than a hairline: at this size a line reads as
          a scratch on the barrel and a band reads as a joint in it. */}
      <rect x={6.4} y={30.4} width={15.2} height={2.8} fill={INSTRUMENT_SEAM} />
      <path d={nib} fill={ink} />
      <Form id="tb-form-pen" d={silhouette} />
    </>
  );
}

/**
 * The highlighter. Fat where the pen is slim, and cut off at an angle where
 * every other tip in the row is symmetrical.
 *
 * Two thirds of it are the live ink — the chisel wedge at the top and the
 * whole lower barrel — with a white collar between them carrying the seam.
 * That split is what makes it readable as a highlighter at 36px rather than
 * as a second, wider pen: you are looking at a lot of colour held in a short
 * body, which is what the object actually is.
 */
function Marker({ ink }: { ink: string }) {
  const nib = 'M9.4 13.6V6.3Q9.4 5.1 10.5 4.7L17.7 2.1Q18.6 1.8 18.6 2.8V13.6Z';
  const collar =
    'M8.8 13H19.2V17.6C19.2 20.4 23 21.8 23 26.2V29.2H5V26.2C5 21.8 8.8 20.4 8.8 17.6Z';
  const barrel = 'M5 28.6H23V56H5Z';
  const silhouette =
    'M9.4 6.3Q9.4 5.1 10.5 4.7L17.7 2.1Q18.6 1.8 18.6 2.8V17.6C18.6 20.4 23 21.8 23 26.2V56H5V26.2C5 21.8 8.8 20.4 8.8 17.6V13.6Q8.8 13 9.4 13Z';
  return (
    <>
      <path d={barrel} fill={ink} />
      <path d={collar} fill={INSTRUMENT_BODY} />
      <path d={nib} fill={ink} />
      <Form id="tb-form-marker" d={silhouette} />
    </>
  );
}

/**
 * The eraser. The one object in the row with no tip at all, which is most of
 * how it is recognised: a blunt block standing among four things that come to
 * a point.
 *
 * The school rubber's paper sleeve is gone with the outlines — a printed blue
 * band with a panel and a bar on it is a picture of a specific product, and at
 * 36px it was three details fighting for about eight pixels. What is left is
 * the shape, a soft coral block that widens very slightly towards its base,
 * and one flat neutral band across it where the sleeve used to be. The band is
 * doing the same job the sleeve did — it says "this is wrapped, you rub with
 * the end sticking out" — with one edge instead of five.
 */
function Eraser() {
  const block =
    'M10.4 3.4H17.6A5.2 5.2 0 0 1 22.8 8.6L23.6 56H4.4L5.2 8.6A5.2 5.2 0 0 1 10.4 3.4Z';
  return (
    <>
      <path d={block} fill="#ef9f98" />
      {/* Clipped to the block, so the band picks up the taper of its sides
          rather than overhanging them. */}
      <clipPath id="tb-form-eraser-block">
        <path d={block} />
      </clipPath>
      <rect
        x={0}
        y={34.6}
        width={28}
        height={8.4}
        fill="#f2f0ec"
        clipPath="url(#tb-form-eraser-block)"
      />
      <Form id="tb-form-eraser" d={block} />
    </>
  );
}

/**
 * The laser pointer. Slim where the highlighter is fat and dark where
 * everything else is pale, so the two never trade places at a glance.
 *
 * It is the one tool here whose mark is not ink, and the drawing says so by
 * being the one object with no live colour on it: a dark barrel, a white nose
 * flaring out of a ferrule, and a fixed red emitter seated on the mouth. When
 * the tool is held the emitter lights, which is the only thing in the tray
 * that changes for a reason other than selection.
 */
function Laser({ active }: { active?: boolean }) {
  const barrel = 'M5.6 24.4H22.4V56H5.6Z';
  const nose =
    'M10.6 7.4C10 7.4 9.4 8.4 9.4 10.6C9.4 14.4 8.4 18.9 7.2 22.6V24.4H20.8V22.6C19.6 18.9 18.6 14.4 18.6 10.6C18.6 8.4 18 7.4 17.4 7.4Z';
  const emitter = 'M10.6 7.4V5.2A3.4 3.4 0 0 1 17.4 5.2V7.4Z';
  const silhouette =
    'M10.6 5.2A3.4 3.4 0 0 1 17.4 5.2V10.6C17.4 14.4 19.6 18.9 20.8 22.6V56H7.2V22.6C8.4 18.9 10.6 14.4 10.6 10.6Z';
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
      <path d={nose} fill={INSTRUMENT_BODY} />
      {/* The ferrule, a rounded capsule covering the joint. */}
      <rect
        x={5.2}
        y={21.8}
        width={17.6}
        height={4.6}
        rx={2.3}
        fill={INSTRUMENT_BODY}
      />
      <path d={emitter} fill="#FF3B30" />
      <Form id="tb-form-laser" d={silhouette} />
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
  // Each instrument is drawn in the colour it will actually lay down — one
  // colour, shared by every tool, so the whole tray moves together.
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
            'relative transition-transform duration-slow ease-out-quart overflow-visible',
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

  return <div className={INSTRUMENT_SLOT}>{button}</div>;
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
