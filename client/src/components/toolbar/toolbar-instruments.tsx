import { useId } from 'react';
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
  INSTRUMENT_CLIP,
  INSTRUMENT_SLOT,
  INSTRUMENT_TILT,
  INSTRUMENT_TRACK,
  hueVars,
} from './toolbar-constants';

const VIEW_BOX = '0 0 28 56';
type ArtProps = { ink: string; active?: boolean; artId: string };

function Pencil({ ink, artId }: ArtProps) {
  return (
    <>
      <path
        d="M9 16Q14 14 19 16L20 49Q20 52 17 52H10Q7 52 7 49Z"
        fill={`url(#${artId}-body)`}
      />
      <path d="M9 16Q10 8 14 2Q15 0 16 3Q19 9 19 16Q14 14 9 16Z" fill={ink} />
      <path
        d="M7.2 43Q13.5 41 19.8 43L20 49Q20 52 17 52H10Q7 52 7 49Z"
        fill="#a4c7ff"
      />
      <ellipse cx="13.5" cy="50" rx="6.2" ry="2" fill="#7faff6" />
      <path
        d="M10 20L9.5 40"
        stroke="#fff"
        strokeWidth="2"
        strokeLinecap="round"
        opacity=".7"
      />
    </>
  );
}

function Marker({ artId }: ArtProps) {
  return (
    <>
      <path
        d="M8 15H20L22 45Q22 51 18 52H9Q5 51 5 46Z"
        fill={`url(#${artId}-body)`}
      />
      <path d="M8 16V10L17 2Q18 1 19 3L21 8L20 16Z" fill="#24252b" />
      <path
        d="M5.5 42Q13 39 21.5 42L22 47Q22 52 18 52H9Q5 52 5 47Z"
        fill="#ffe18a"
      />
      <ellipse cx="13.5" cy="50" rx="8" ry="2" fill="#f3cd60" />
    </>
  );
}

function Eraser({ artId }: ArtProps) {
  return (
    <>
      <path
        d="M10 13H18Q24 13 24 20V45Q24 49 19 49H8Q4 49 4 45V20Q4 13 10 13Z"
        fill={`url(#${artId}-pink)`}
      />
      <path d="M4 37Q13 35 24 38V45Q24 49 19 49H8Q4 49 4 45Z" fill="#fff1ed" />
      <path d="M4 44Q13 42 24 45Q24 49 19 49H8Q4 49 4 44Z" fill="#f1c3c7" />
    </>
  );
}

function Laser({ artId, active }: ArtProps) {
  return (
    <>
      {active && (
        <ellipse cx="14" cy="8" rx="8" ry="10" fill="#ff6743" opacity=".16" />
      )}
      <path
        d="M10 11H18L21 47Q21 51 17 52H11Q7 51 7 47Z"
        fill={`url(#${artId}-body)`}
      />
      <path d="M10 12Q10 6 13 2Q15 -1 17 3Q19 7 18 12Z" fill="#ff643c" />
      <path
        d="M7.5 42Q14 39 20.5 42L21 48Q21 51 17 52H11Q7 51 7 48Z"
        fill="#785048"
      />
      <ellipse cx="14" cy="50" rx="6.8" ry="2.5" fill="#ff6c3a" />
    </>
  );
}

const BODIES: Record<string, (props: ArtProps) => React.JSX.Element> = {
  draw: Pencil,
  highlighter: Marker,
  eraser: Eraser,
  laser: Laser,
};

function InstrumentButton({ toolId }: { toolId: string }) {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  const artId = useId();
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
            'relative transition-transform duration-slow ease-out-quart overflow-visible',
            'motion-reduce:transition-none',
            INSTRUMENT_TILT,
            active ? '-translate-y-1' : 'group-hover/slot:-translate-y-0.5',
          )}
        >
          <defs>
            <linearGradient id={`${artId}-body`} x1="0" x2="1" y1="0" y2="0">
              <stop stopColor="#ffffff" />
              <stop offset=".45" stopColor="#fcfdff" />
              <stop offset="1" stopColor="#d7deea" />
            </linearGradient>
            <linearGradient id={`${artId}-pink`} x1="0" x2="1" y1="0" y2=".3">
              <stop stopColor="#ff9ca3" />
              <stop offset=".55" stopColor="#ff868d" />
              <stop offset="1" stopColor="#ed6773" />
            </linearGradient>
          </defs>
          <Body ink={ink} active={active} artId={artId} />
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

  return (
    <div
      className={INSTRUMENT_SLOT}
      data-held={active ? 'true' : undefined}
      style={hueVars(tool.id)}
    >
      {button}
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
