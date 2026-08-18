import { useCallback, useEffect, useState } from 'react';
import { Compass, Lock, Minus, Plus, RefreshCw, Unlock } from 'lucide-react';
import type { GraphViewport } from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from '@/components/ui/input-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { DEFAULT_GRAPH_VIEWPORT } from '@/canvas/graph-defaults';
import { GRAPH_VIEWPORT_PRESETS } from '@/canvas/graph-presets';
import { cn } from '@/lib/utils';
import { formatNumber } from './graph-panel-utils';

/* ─── Precision Viewport with Quick Framing Presets & 1:1 Aspect Lock ──────── */

const VIEW_RANGE_AXES = [
  { label: 'X axis', symbol: 'x', minKey: 'xMin', maxKey: 'xMax' },
  { label: 'Y axis', symbol: 'y', minKey: 'yMin', maxKey: 'yMax' },
] as const;

function RangeStepper({
  id,
  label,
  value,
  onValueChange,
  onCommit,
  onNudge,
  className,
}: {
  id: string;
  label: string;
  value: string;
  onValueChange: (value: string) => void;
  onCommit: () => void;
  onNudge: (delta: number) => void;
  className?: string;
}) {
  return (
    <InputGroup
      className={cn(
        'h-8 overflow-hidden rounded-md shadow-e1 focus-within:ring-0 focus-within:border-border-strong',
        className,
      )}
    >
      <InputGroupAddon
        align="inline-start"
        className="h-full border-r border-border p-0 m-0 has-[>button]:ml-0 shrink-0"
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={`Decrease ${label.toLowerCase()}`}
          onClick={() => onNudge(-1)}
          className="h-full w-6.5 rounded-none text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:relative focus-visible:z-1 focus-visible:ring-0 focus-visible:outline-none"
        >
          <Minus className="size-3" data-icon="inline-start" aria-hidden="true" />
        </Button>
      </InputGroupAddon>
      <InputGroupInput
        id={id}
        type="number"
        step="any"
        inputMode="decimal"
        aria-label={label}
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        onBlur={onCommit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            onCommit();
            event.currentTarget.blur();
          }
        }}
        className="h-full !px-1 text-center font-mono text-xs font-medium tabular-nums shadow-none outline-none ring-0 focus:outline-none focus:ring-0 focus-visible:outline-none focus-visible:ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
      />
      <InputGroupAddon
        align="inline-end"
        className="h-full border-l border-border p-0 m-0 has-[>button]:mr-0 shrink-0"
      >
        <Button
          type="button"
          variant="ghost"
          aria-label={`Increase ${label.toLowerCase()}`}
          onClick={() => onNudge(1)}
          className="h-full w-6.5 rounded-none text-fg-secondary hover:bg-surface-hover hover:text-fg focus-visible:relative focus-visible:z-1 focus-visible:ring-0 focus-visible:outline-none"
        >
          <Plus className="size-3" data-icon="inline-start" aria-hidden="true" />
        </Button>
      </InputGroupAddon>
    </InputGroup>
  );
}

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

export function ViewRange({
  viewport,
  shapeProps,
  onChange,
}: {
  viewport: GraphViewport;
  shapeProps: { w: number; h: number };
  onChange: (viewport: GraphViewport) => void;
}) {
  const [draft, setDraft] = useState({
    xMin: formatNumber(viewport.xMin),
    xMax: formatNumber(viewport.xMax),
    yMin: formatNumber(viewport.yMin),
    yMax: formatNumber(viewport.yMax),
  });
  const [aspectLocked, setAspectLocked] = useState(false);

  useEffect(() => {
    setDraft({
      xMin: formatNumber(viewport.xMin),
      xMax: formatNumber(viewport.xMax),
      yMin: formatNumber(viewport.yMin),
      yMax: formatNumber(viewport.yMax),
    });
  }, [viewport.xMin, viewport.xMax, viewport.yMin, viewport.yMax]);

  // Shape plot aspect ratio (w / h after accounting for padding)
  const plotAspect = Math.max(0.1, (shapeProps.w - 32) / Math.max(1, shapeProps.h - 32));

  const applyIsotropicY = useCallback(
    (currentVp: GraphViewport): GraphViewport => {
      const xSpan = currentVp.xMax - currentVp.xMin;
      const targetYSpan = xSpan / plotAspect;
      const yCenter = (currentVp.yMin + currentVp.yMax) / 2;
      return {
        ...currentVp,
        yMin: Math.round((yCenter - targetYSpan / 2) * 100) / 100,
        yMax: Math.round((yCenter + targetYSpan / 2) * 100) / 100,
      };
    },
    [plotAspect],
  );

  const toggleAspectLock = () => {
    const nextLocked = !aspectLocked;
    setAspectLocked(nextLocked);
    if (nextLocked) {
      onChange(applyIsotropicY(viewport));
    }
  };

  const commit = (key: keyof GraphViewport, val: string) => {
    const num = Number(val);
    if (Number.isFinite(num)) {
      const rounded = Math.round(num * 100) / 100;
      let next = { ...viewport, [key]: rounded };
      if (next.xMin < next.xMax && next.yMin < next.yMax) {
        if (aspectLocked && (key === 'xMin' || key === 'xMax')) {
          next = applyIsotropicY(next);
        }
        setDraft((current) => ({ ...current, [key]: formatNumber(rounded) }));
        onChange(next);
        return;
      }
    }
    setDraft((current) => ({ ...current, [key]: formatNumber(viewport[key]) }));
  };

  const nudge = (key: keyof GraphViewport, delta: number) => {
    const drafted = Number(draft[key]);
    const value = Number.isFinite(drafted) ? drafted : viewport[key];
    commit(key, formatNumber(value + delta));
  };

  const activePreset = GRAPH_VIEWPORT_PRESETS.find((preset) => {
    const targetVp = aspectLocked ? applyIsotropicY(preset.viewport) : preset.viewport;
    const directMatch =
      Math.abs(viewport.xMin - preset.viewport.xMin) < 0.05 &&
      Math.abs(viewport.xMax - preset.viewport.xMax) < 0.05 &&
      Math.abs(viewport.yMin - preset.viewport.yMin) < 0.05 &&
      Math.abs(viewport.yMax - preset.viewport.yMax) < 0.05;
    const isotropicMatch =
      aspectLocked &&
      Math.abs(viewport.xMin - targetVp.xMin) < 0.05 &&
      Math.abs(viewport.xMax - targetVp.xMax) < 0.05 &&
      Math.abs(viewport.yMin - targetVp.yMin) < 0.05 &&
      Math.abs(viewport.yMax - targetVp.yMax) < 0.05;
    return directMatch || isotropicMatch;
  });

  const applyPreset = (presetName: string) => {
    const preset = GRAPH_VIEWPORT_PRESETS.find(
      (candidate) => candidate.name === presetName,
    );
    if (!preset) return;
    const nextViewport = { ...preset.viewport };
    onChange(aspectLocked ? applyIsotropicY(nextViewport) : nextViewport);
  };

  return (
    <div className="flex flex-col gap-2">
      {/* ── Quick Range Presets & Viewport Actions ── */}
      <TooltipProvider delay={200}>
        <div className="flex w-full items-center gap-1">
          <div
            role="group"
            aria-label="Quick range presets"
            className="flex min-w-0 grow items-center divide-x divide-border overflow-hidden rounded-lg border border-border bg-surface shadow-e1"
          >
            {GRAPH_VIEWPORT_PRESETS.map((preset) => {
              const isActive = activePreset?.name === preset.name;
              return (
              <Tooltip key={preset.name}>
                <TooltipTrigger
                  render={
                    <button
                      type="button"
                      aria-pressed={isActive}
                      aria-label={`${preset.name}: ${preset.label}`}
                      onClick={() => applyPreset(preset.name)}
                      className={cn(
                        'flex h-8 min-w-0 grow basis-0 items-center justify-center transition-colors duration-instant select-none outline-none focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-focus',
                        isActive
                          ? 'bg-panel text-fg shadow-2xs'
                          : 'text-fg-secondary hover:bg-surface-hover hover:text-fg',
                      )}
                    >
                      <PresetIcon name={preset.name} />
                    </button>
                  }
                />
                <TooltipContent side="top" className="flex flex-col gap-0.5 text-center">
                  <span className="font-semibold text-xs">{preset.name}</span>
                  <span className="font-mono text-[10px] text-fg-subtle">
                    {preset.label} · {preset.description}
                  </span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>

          <div className="flex items-center gap-0.5 shrink-0">
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant={aspectLocked ? 'subtle' : 'ghost'}
                    size="icon-sm"
                    aria-label={
                      aspectLocked
                        ? 'Unlock 1:1 aspect ratio'
                        : 'Lock 1:1 aspect ratio'
                    }
                    aria-pressed={aspectLocked}
                    onClick={toggleAspectLock}
                    className={cn(
                      'size-8 rounded-lg text-fg-secondary hover:text-fg border border-transparent',
                      aspectLocked && 'border-border bg-panel text-fg font-semibold shadow-2xs',
                    )}
                  >
                    {aspectLocked ? (
                      <Lock className="size-3.5" data-icon="inline-start" aria-hidden="true" />
                    ) : (
                      <Unlock className="size-3.5" data-icon="inline-start" aria-hidden="true" />
                    )}
                  </Button>
                }
              />
              <TooltipContent side="top">
                {aspectLocked ? 'Unlock 1:1 aspect' : 'Lock 1:1 aspect'}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Reset to standard [-10, 10]"
                    onClick={() => {
                      const next = { ...DEFAULT_GRAPH_VIEWPORT };
                      onChange(aspectLocked ? applyIsotropicY(next) : next);
                    }}
                    className="size-8 rounded-lg text-fg-secondary hover:text-fg"
                  >
                    <RefreshCw className="size-3.5" data-icon="inline-start" aria-hidden="true" />
                  </Button>
                }
              />
              <TooltipContent side="top">Reset (Standard)</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* ── Axis Coordinate Range Steppers ── */}
      <div className="flex flex-col gap-1.5">
        {VIEW_RANGE_AXES.map(({ label, symbol, minKey, maxKey }) => (
          <div key={label} className="flex items-center gap-2">
            <span
              className="grid size-7 shrink-0 place-items-center rounded-md border border-border/70 bg-subtle font-mono text-xs font-semibold text-fg-secondary select-none"
              aria-hidden="true"
            >
              {symbol}
            </span>

            <div className="flex min-w-0 flex-1 items-center gap-1.5">
              <label htmlFor={`graph-range-${minKey}`} className="sr-only">
                {label} minimum
              </label>
              <RangeStepper
                id={`graph-range-${minKey}`}
                label={`${label} minimum`}
                value={draft[minKey]}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, [minKey]: value }))
                }
                onCommit={() => commit(minKey, draft[minKey])}
                onNudge={(delta) => nudge(minKey, delta)}
              />

              <label htmlFor={`graph-range-${maxKey}`} className="sr-only">
                {label} maximum
              </label>
              <RangeStepper
                id={`graph-range-${maxKey}`}
                label={`${label} maximum`}
                value={draft[maxKey]}
                onValueChange={(value) =>
                  setDraft((current) => ({ ...current, [maxKey]: value }))
                }
                onCommit={() => commit(maxKey, draft[maxKey])}
                onNudge={(delta) => nudge(maxKey, delta)}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
