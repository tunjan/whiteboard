import { useRef, useState } from 'react';
import { Compass, Lock, RotateCcw, Unlock } from 'lucide-react';
import type { GraphViewport } from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DEFAULT_GRAPH_VIEWPORT } from '@/canvas/graph-defaults';
import {
  GRAPH_VIEWPORT_PRESETS,
  type GraphViewportPreset,
} from '@/canvas/graph-presets';
import {
  fitViewport,
  isLinear,
  LINEAR_AXES,
  toPlotViewport,
  viewportFits,
  type GraphAxes,
} from '@/canvas/graph-scale';
import { cn } from '@/lib/utils';
import { ChoiceGroup, ChoiceItem } from './graph-choice-group';
import { FIELD_GROUP, GROUPED_NUMBER, MATH_SYMBOL } from './graph-panel-styles';
import { formatBound, parseBound } from './graph-panel-utils';

const VIEW_RANGE_AXES = [
  { label: 'X axis', symbol: 'x', minKey: 'xMin', maxKey: 'xMax' },
  { label: 'Y axis', symbol: 'y', minKey: 'yMin', maxKey: 'yMax' },
] as const;

const VIEWPORT_KEYS = ['xMin', 'xMax', 'yMin', 'yMax'] as const;

function PresetIcon({ name, className }: { name: string; className?: string }) {
  switch (name) {
    case 'Standard':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <rect x="2" y="2" width="12" height="12" rx="2" />
          <path d="M8 2v12M2 8h12" />
        </svg>
      );
    case 'Trig 2π':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <path d="M2 8c2-5 3.5-5 6 0s4 5 6 0" />
        </svg>
      );
    case 'Trig 4π':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <path d="M1 8c1.5-4.5 2.5-4.5 4 0s2.5 4.5 4 0 2.5-4.5 4 0 1.5 3 2 0" />
        </svg>
      );
    case 'Quadrant I':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <path d="M3 2v11h11" />
          <rect
            x="5.5"
            y="4.5"
            width="6"
            height="6"
            rx="1"
            fill="currentColor"
            fillOpacity={0.2}
            stroke="currentColor"
            strokeDasharray="1.5 1.5"
          />
        </svg>
      );
    case 'Unit Box':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <rect x="4.5" y="4.5" width="7" height="7" rx="1.5" />
          <path d="M8 2v2M8 12v2M2 8h2M12 8h2" opacity={0.6} />
        </svg>
      );
    case 'Square 10×10':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <rect x="2.5" y="2.5" width="11" height="11" rx="2" />
          <circle cx="8" cy="8" r="1.25" fill="currentColor" />
        </svg>
      );
    case 'Wide View':
      return (
        <svg
          width={16}
          height={16}
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
          className={cn('size-4', className)}
          aria-hidden="true"
        >
          <path d="M2.5 6V2.5H6M13.5 6V2.5H10M2.5 10v3.5H6M13.5 10v3.5H10" />
          <circle cx="8" cy="8" r="1.5" fill="currentColor" />
        </svg>
      );
    default:
      return <Compass className={cn('size-4', className)} aria-hidden="true" />;
  }
}

/** A trig window in the graph's unit: [−2π, 2π] reads [−360, 360] in degrees. */
function presetIn(preset: GraphViewportPreset, angleUnit: 'rad' | 'deg') {
  if (angleUnit === 'rad' || preset.category !== 'Trigonometric') {
    return { name: preset.name, viewport: preset.viewport };
  }
  const k = 180 / Math.PI;
  const { xMin, xMax } = preset.viewport;
  const degrees = Math.round(xMax * k);
  return {
    name: preset.name.replace(/\d*π/, `${degrees}°`),
    viewport: { ...preset.viewport, xMin: Math.round(xMin * k), xMax: degrees },
  };
}

const LOG_MANTISSAS = [1, 2, 5];

/** The next 1–2–5 value past `value` on a log axis; a whole decade with `big`. */
function logNudge(value: number, dir: 1 | -1, big: boolean): number {
  const k = Math.floor(Math.log10(value));
  const steps = [];
  for (let e = k - 2; e <= k + 2; e += 1) {
    for (const m of big ? [1] : LOG_MANTISSAS) steps.push(Number(`${m}e${e}`));
  }
  return dir > 0
    ? steps.find((v) => v > value * (1 + 1e-9))!
    : steps.reverse().find((v) => v < value * (1 - 1e-9))!;
}

export function ViewRange({
  viewport,
  shapeProps,
  axes,
  angleUnit,
  onChange,
  onScaleChange,
}: {
  viewport: GraphViewport;
  shapeProps: { w: number; h: number };
  axes: GraphAxes;
  angleUnit: 'rad' | 'deg';
  onChange: (viewport: GraphViewport) => void;
  onScaleChange: (axis: 'x' | 'y', scale: GraphAxes['x']) => void;
}) {
  // Shape plot aspect ratio (w / h after accounting for padding)
  const plotAspect = Math.max(
    0.1,
    (shapeProps.w - 32) / Math.max(1, shapeProps.h - 32),
  );

  /** Reshapes the axis that was not edited so one unit is as long on both. */
  const isotropic = (vp: GraphViewport, keep: 'x' | 'y'): GraphViewport => {
    if (keep === 'x') {
      const half = (vp.xMax - vp.xMin) / plotAspect / 2;
      const yCenter = (vp.yMin + vp.yMax) / 2;
      return { ...vp, yMin: yCenter - half, yMax: yCenter + half };
    }
    const half = ((vp.yMax - vp.yMin) * plotAspect) / 2;
    const xCenter = (vp.xMin + vp.xMax) / 2;
    return { ...vp, xMin: xCenter - half, xMax: xCenter + half };
  };

  // Starts locked when the window already is 1:1, so reopening the panel on
  // a square graph doesn't claim the lock was lost.
  const [aspectLocked, setAspectLocked] = useState(
    () =>
      Math.abs(
        (viewport.xMax - viewport.xMin) /
          (viewport.yMax - viewport.yMin) /
          plotAspect -
          1,
      ) < 0.01,
  );

  const [draft, setDraft] = useState(() => draftOf(viewport, axes));
  // A window changed elsewhere (a canvas pan, a peer) replaces the draft
  // during render, not an effect later, so no frame shows stale bounds.
  const [synced, setSynced] = useState({ viewport, axes });
  if (!sameViewport(synced.viewport, viewport, 0) || synced.axes !== axes) {
    setSynced({ viewport, axes });
    setDraft(draftOf(viewport, axes));
  }

  // Escape reverts; the blur it causes must not then commit the typed text.
  const reverting = useRef(false);

  const commit = (key: keyof GraphViewport, value: number) => {
    let next = { ...viewport, [key]: value };
    const valid = Number.isFinite(value) && viewportFits(next, axes);
    if (valid) {
      if (lockable && aspectLocked) next = isotropic(next, key[0] as 'x' | 'y');
      onChange(next);
    }
    // Rewritten even when nothing changed, so a typed `2pi` reads back `2π`.
    setDraft(draftOf(valid ? next : viewport, axes));
  };

  // Arrow keys step to the next tick of a grid one tenth of the window
  // (Shift: the whole window's order), so the graph moves as you hold them.
  const nudge = (key: keyof GraphViewport, dir: 1 | -1, big: boolean) => {
    if (axes[key[0] as 'x' | 'y'] === 'log') {
      const typed = parseBound(draft[key]);
      const from = typed > 0 ? typed : viewport[key];
      commit(key, logNudge(from, dir, big));
      return;
    }
    const span =
      key[0] === 'x'
        ? viewport.xMax - viewport.xMin
        : viewport.yMax - viewport.yMin;
    const step = 10 ** Math.floor(Math.log10(span)) / (big ? 1 : 10);
    const typed = parseBound(draft[key]);
    const from = (Number.isFinite(typed) ? typed : viewport[key]) / step;
    const tick =
      dir > 0 ? Math.floor(from + 1e-9) + 1 : Math.ceil(from - 1e-9) - 1;
    commit(key, Number((tick * step).toPrecision(12)));
  };

  const toggleAspectLock = () => {
    const nextLocked = !aspectLocked;
    setAspectLocked(nextLocked);
    if (nextLocked) {
      onChange(isotropic(viewport, 'x'));
    }
  };

  // One unit as long on both axes means nothing once either is logarithmic.
  const lockable = isLinear(axes);
  const fitted = (vp: GraphViewport) =>
    lockable && aspectLocked ? isotropic(vp, 'x') : { ...vp };

  // Windows a log axis can't show aren't offered, rather than offered broken.
  const presets = GRAPH_VIEWPORT_PRESETS.map((preset) => ({
    ...presetIn(preset, angleUnit),
    key: preset.name,
  })).filter((preset) => viewportFits(preset.viewport, axes));
  const activePreset = presets.find(
    (preset) =>
      sameViewport(viewport, preset.viewport, undefined, axes) ||
      sameViewport(viewport, fitted(preset.viewport), undefined, axes),
  );
  const resetTarget = fitted(fitViewport(DEFAULT_GRAPH_VIEWPORT, axes));

  const applyPreset = (key: string) => {
    const preset = presets.find((candidate) => candidate.key === key);
    if (preset) onChange(fitted(preset.viewport));
  };

  const bound = (
    key: keyof GraphViewport,
    other: keyof GraphViewport,
    label: string,
  ) => {
    const value = parseBound(draft[key]);
    // An empty field is mid-edit, not wrong; it reverts on blur.
    const invalid =
      draft[key].trim() !== '' &&
      (!(key.endsWith('Min')
        ? value < viewport[other]
        : value > viewport[other]) ||
        (axes[key[0] as 'x' | 'y'] === 'log' && !(value > 0)));
    return (
      <Input
        type="text"
        autoComplete="off"
        spellCheck={false}
        enterKeyHint="done"
        aria-label={label}
        aria-invalid={invalid || undefined}
        value={draft[key]}
        onChange={(event) =>
          setDraft((current) => ({ ...current, [key]: event.target.value }))
        }
        onFocus={(event) => event.currentTarget.select()}
        onBlur={() => {
          if (reverting.current) reverting.current = false;
          else commit(key, value);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') event.currentTarget.blur();
          else if (event.key === 'Escape') {
            reverting.current = true;
            setDraft(draftOf(viewport, axes));
            event.currentTarget.blur();
          } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
            event.preventDefault();
            nudge(key, event.key === 'ArrowUp' ? 1 : -1, event.shiftKey);
          }
        }}
        className={cn(GROUPED_NUMBER, 'min-w-0 flex-1')}
      />
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-0.5">
        <ChoiceGroup
          aria-label="Window"
          value={activePreset ? [activePreset.key] : []}
          onValueChange={(value) => {
            if (value[0]) applyPreset(value[0]);
          }}
          className="min-w-0 flex-1"
        >
          {presets.map((preset) => (
            <Tooltip key={preset.key}>
              <TooltipTrigger
                render={
                  <ChoiceItem
                    value={preset.key}
                    aria-label={`${preset.name}, ${windowText(preset.viewport, axes)}`}
                  />
                }
              >
                <PresetIcon name={preset.key} />
              </TooltipTrigger>
              <TooltipContent side="top">
                {preset.name}
                <span className="ml-1.5 tabular-nums opacity-70">
                  {windowText(preset.viewport, axes)}
                </span>
              </TooltipContent>
            </Tooltip>
          ))}
        </ChoiceGroup>

        {presets.length > 0 ? (
          <span
            aria-hidden="true"
            className="mx-1 h-5 w-px shrink-0 bg-border"
          />
        ) : null}

        {lockable ? (
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Lock 1:1 scale"
                  aria-pressed={aspectLocked}
                  onClick={toggleAspectLock}
                  className="text-fg-subtle aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg"
                >
                  {aspectLocked ? (
                    <Lock className="size-4" aria-hidden="true" />
                  ) : (
                    <Unlock className="size-4" aria-hidden="true" />
                  )}
                </Button>
              }
            />
            <TooltipContent side="top">
              {aspectLocked ? 'Unlock scale' : '1:1 scale'}
            </TooltipContent>
          </Tooltip>
        ) : null}

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Reset view"
                // Nothing to reset is shown, not clicked to find out.
                disabled={sameViewport(viewport, resetTarget, undefined, axes)}
                onClick={() => onChange(resetTarget)}
                className="text-fg-subtle"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent side="top">
            Reset
            <span className="ml-1.5 tabular-nums opacity-70">
              {windowText(resetTarget, axes)}
            </span>
          </TooltipContent>
        </Tooltip>
      </div>

      {/* Each axis is one control: its letter as the label inside the fill,
          then min and max split by a hairline. */}
      <div className="flex items-center gap-2">
        {VIEW_RANGE_AXES.map(({ label, symbol, minKey, maxKey }) => {
          const log = axes[symbol] === 'log';
          return (
            <div
              key={label}
              role="group"
              aria-label={label}
              className={cn(FIELD_GROUP, 'flex-1')}
            >
              {/* The axis letter is the axis's scale: pressed, it reads log x. */}
              <Tooltip>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-label={`Logarithmic ${symbol} axis`}
                      aria-pressed={log}
                      onClick={() =>
                        onScaleChange(symbol, log ? 'linear' : 'log')
                      }
                      className="ml-1 flex h-6 shrink-0 items-baseline gap-[0.2em] rounded-[4px] px-1.5 text-fg-secondary transition-colors duration-fast hover:bg-[var(--ds-background-neutral-subtle-hovered)] hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg"
                    />
                  }
                >
                  {log ? (
                    <span className="font-['KaTeX_Main',serif] text-[0.8125rem] leading-6 select-none">
                      log
                    </span>
                  ) : null}
                  <span
                    className={cn(
                      MATH_SYMBOL,
                      'text-[0.9375rem] leading-6 text-current',
                    )}
                  >
                    {symbol}
                  </span>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {log ? 'Linear scale' : 'Log scale'}
                </TooltipContent>
              </Tooltip>
              {bound(minKey, maxKey, `${label} minimum`)}
              <span
                aria-hidden="true"
                className="h-3.5 w-px shrink-0 bg-[var(--ds-border)]"
              />
              {bound(maxKey, minKey, `${label} maximum`)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** A log bound keeps three significant digits: 0.001, not 0. */
function formatLogBound(value: number): string {
  return Number.isFinite(value) ? Number(value.toPrecision(3)).toString() : '';
}

function draftOf(
  vp: GraphViewport,
  axes: GraphAxes,
): Record<keyof GraphViewport, string> {
  const xSpan = vp.xMax - vp.xMin;
  const ySpan = vp.yMax - vp.yMin;
  const x = (v: number) =>
    axes.x === 'log' ? formatLogBound(v) : formatBound(v, xSpan);
  const y = (v: number) =>
    axes.y === 'log' ? formatLogBound(v) : formatBound(v, ySpan);
  return {
    xMin: x(vp.xMin),
    xMax: x(vp.xMax),
    yMin: y(vp.yMin),
    yMax: y(vp.yMax),
  };
}

/** Compared in plot space, so on a log axis 0.01 and 0.03 are far apart. */
function sameViewport(
  a: GraphViewport,
  b: GraphViewport,
  tolerance = 0.05,
  axes: GraphAxes = LINEAR_AXES,
) {
  const pa = toPlotViewport(a, axes);
  const pb = toPlotViewport(b, axes);
  return VIEWPORT_KEYS.every((key) => Math.abs(pa[key] - pb[key]) <= tolerance);
}

/** `[−2π, 2π] × [−2, 2]`, for tooltips. */
function windowText(vp: GraphViewport, axes: GraphAxes): string {
  const d = draftOf(vp, axes);
  return `[${d.xMin}, ${d.xMax}] × [${d.yMin}, ${d.yMax}]`;
}
