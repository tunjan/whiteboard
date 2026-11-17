import { useRef, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import type { Graph3dView, GraphViewport } from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { DEFAULT_GRAPH_VIEWPORT } from '@/canvas/graph-defaults';
import { DEFAULT_GRAPH_3D_ANGLE } from '@/canvas/graph3d';
import { cn } from '@/lib/utils';
import { FIELD_GROUP, GROUPED_NUMBER, MATH_SYMBOL } from './graph-panel-styles';
import { formatBound, parseBound } from './graph-panel-utils';

type Range3 = GraphViewport & { zMin: number; zMax: number };
type Bound = keyof Range3;

const AXES = [
  { symbol: 'x', label: 'X axis', min: 'xMin', max: 'xMax' },
  { symbol: 'y', label: 'Y axis', min: 'yMin', max: 'yMax' },
  { symbol: 'z', label: 'Z axis', min: 'zMin', max: 'zMax' },
] as const;

const DEFAULT_RANGE: Range3 = {
  ...DEFAULT_GRAPH_VIEWPORT,
  zMin: DEFAULT_GRAPH_VIEWPORT.yMin,
  zMax: DEFAULT_GRAPH_VIEWPORT.yMax,
};

/**
 * One bound of one axis. Typing is a draft until Enter or blur; Escape puts
 * the value back; the arrows step it to the next tick of a grid one tenth of
 * the axis (Shift: the whole axis's order).
 */
function BoundField({
  value,
  span,
  label,
  accepts,
  onCommit,
}: {
  value: number;
  span: number;
  label: string;
  accepts: (value: number) => boolean;
  onCommit: (value: number) => void;
}) {
  const [draft, setDraft] = useState(() => formatBound(value, span));
  // A value changed elsewhere (a wheel zoom, a peer) replaces the draft
  // during render, so no frame shows a stale bound.
  const [synced, setSynced] = useState(value);
  if (synced !== value) {
    setSynced(value);
    setDraft(formatBound(value, span));
  }
  // Escape reverts; the blur it causes must not then commit the typed text.
  const reverting = useRef(false);

  const commit = (next: number) => {
    if (Number.isFinite(next) && accepts(next) && next !== value) onCommit(next);
    // Rewritten even when nothing changed, so a typed `2pi` reads back `2π`.
    else setDraft(formatBound(value, span));
  };
  const typed = parseBound(draft);
  // An empty field is mid-edit, not wrong; it reverts on blur.
  const invalid = draft.trim() !== '' && !(Number.isFinite(typed) && accepts(typed));

  return (
    <Input
      type="text"
      autoComplete="off"
      spellCheck={false}
      enterKeyHint="done"
      aria-label={label}
      aria-invalid={invalid || undefined}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.currentTarget.select()}
      onBlur={() => {
        if (reverting.current) reverting.current = false;
        else commit(typed);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
        else if (event.key === 'Escape') {
          reverting.current = true;
          setDraft(formatBound(value, span));
          event.currentTarget.blur();
        } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault();
          const step = 10 ** Math.floor(Math.log10(span)) / (event.shiftKey ? 1 : 10);
          const from = (Number.isFinite(typed) ? typed : value) / step;
          const tick =
            event.key === 'ArrowUp' ? Math.floor(from + 1e-9) + 1 : Math.ceil(from - 1e-9) - 1;
          commit(Number((tick * step).toPrecision(12)));
        }
      }}
      className={cn(GROUPED_NUMBER, 'min-w-0 flex-1')}
    />
  );
}

/**
 * Where a 3D graph looks: a range for each of x, y and z, and a reset that
 * also squares the box back up to the first angle.
 */
export function Graph3dRange({
  viewport,
  view3d,
  onChange,
}: {
  viewport: GraphViewport;
  view3d: Graph3dView;
  onChange: (patch: { viewport: GraphViewport; view3d: Graph3dView }) => void;
}) {
  const range: Range3 = { ...viewport, zMin: view3d.zMin, zMax: view3d.zMax };
  const apply = ({ zMin, zMax, ...next }: Range3, angle: Partial<Graph3dView> = {}) =>
    onChange({ viewport: next, view3d: { ...view3d, ...angle, zMin, zMax } });

  const isDefault =
    (Object.keys(DEFAULT_RANGE) as Bound[]).every((key) => range[key] === DEFAULT_RANGE[key]) &&
    view3d.yaw === DEFAULT_GRAPH_3D_ANGLE.yaw &&
    view3d.pitch === DEFAULT_GRAPH_3D_ANGLE.pitch;

  const axisGroup = ({ symbol, label, min, max }: (typeof AXES)[number]) => {
    const span = range[max] - range[min];
    return (
      <div key={symbol} role="group" aria-label={label} className={cn(FIELD_GROUP, 'flex-1')}>
        <span aria-hidden="true" className={cn(MATH_SYMBOL, 'ml-1 px-1.5 text-[0.9375rem] leading-6 text-fg-secondary')}>
          {symbol}
        </span>
        <BoundField
          value={range[min]}
          span={span}
          label={`${label} minimum`}
          accepts={(value) => value < range[max]}
          onCommit={(value) => apply({ ...range, [min]: value })}
        />
        <span aria-hidden="true" className="h-3.5 w-px shrink-0 bg-[var(--ds-border)]" />
        <BoundField
          value={range[max]}
          span={span}
          label={`${label} maximum`}
          accepts={(value) => value > range[min]}
          onCommit={(value) => apply({ ...range, [max]: value })}
        />
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2">{AXES.slice(0, 2).map(axisGroup)}</div>
      <div className="flex items-center gap-2">
        {axisGroup(AXES[2])}
        <div className="flex flex-1 justify-end">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Reset view"
                  // Nothing to reset is shown, not clicked to find out.
                  disabled={isDefault}
                  onClick={() => apply(DEFAULT_RANGE, DEFAULT_GRAPH_3D_ANGLE)}
                  className="text-fg-subtle"
                >
                  <RotateCcw className="size-4" aria-hidden="true" />
                </Button>
              }
            />
            <TooltipContent side="top">Reset view</TooltipContent>
          </Tooltip>
        </div>
      </div>
    </div>
  );
}
