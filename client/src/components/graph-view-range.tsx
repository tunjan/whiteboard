import { useCallback, useEffect, useState } from 'react';
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
import { GRAPH_VIEWPORT_PRESETS } from '@/canvas/graph-presets';
import { cn } from '@/lib/utils';
import { ChoiceGroup, ChoiceItem } from './graph-choice-group';
import { MATH_SYMBOL, NUMBER_FIELD } from './graph-panel-styles';
import { formatNumber } from './graph-panel-utils';

const VIEW_RANGE_AXES = [
  { label: 'X axis', symbol: 'x', minKey: 'xMin', maxKey: 'xMax' },
  { label: 'Y axis', symbol: 'y', minKey: 'yMin', maxKey: 'yMax' },
] as const;

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
  const plotAspect = Math.max(
    0.1,
    (shapeProps.w - 32) / Math.max(1, shapeProps.h - 32),
  );

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

  const activePreset = GRAPH_VIEWPORT_PRESETS.find((preset) => {
    const targetVp = aspectLocked
      ? applyIsotropicY(preset.viewport)
      : preset.viewport;
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

  const bound = (key: keyof GraphViewport, label: string) => (
    <Input
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={label}
      value={draft[key]}
      onChange={(event) =>
        setDraft((current) => ({ ...current, [key]: event.target.value }))
      }
      onBlur={() => commit(key, draft[key])}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur();
      }}
      className={cn(NUMBER_FIELD, 'min-w-0 flex-1')}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-0.5">
        <ChoiceGroup
          aria-label="Window"
          value={activePreset ? [activePreset.name] : []}
          onValueChange={(value) => {
            if (value[0]) applyPreset(value[0]);
          }}
          className="min-w-0 flex-1"
        >
          {GRAPH_VIEWPORT_PRESETS.map((preset) => (
            <Tooltip key={preset.name}>
              <TooltipTrigger
                render={
                  <ChoiceItem
                    value={preset.name}
                    aria-label={`${preset.name}, ${preset.label}`}
                  />
                }
              >
                <PresetIcon name={preset.name} />
              </TooltipTrigger>
              <TooltipContent side="top">{preset.name}</TooltipContent>
            </Tooltip>
          ))}
        </ChoiceGroup>

        <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border" />

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
          <TooltipContent side="top">1:1 scale</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label="Reset view"
                onClick={() => {
                  const next = { ...DEFAULT_GRAPH_VIEWPORT };
                  onChange(aspectLocked ? applyIsotropicY(next) : next);
                }}
                className="text-fg-subtle"
              >
                <RotateCcw className="size-4" aria-hidden="true" />
              </Button>
            }
          />
          <TooltipContent side="top">Reset</TooltipContent>
        </Tooltip>
      </div>

      <div className="flex items-center gap-3">
        {VIEW_RANGE_AXES.map(({ label, symbol, minKey, maxKey }) => (
          <div key={label} className="flex min-w-0 flex-1 items-center gap-1">
            <span aria-hidden="true" className={cn(MATH_SYMBOL, 'w-4 shrink-0 text-center text-base')}>
              {symbol}
            </span>
            {bound(minKey, `${label} minimum`)}
            <span aria-hidden="true" className="text-xs text-fg-subtle">
              –
            </span>
            {bound(maxKey, `${label} maximum`)}
          </div>
        ))}
      </div>
    </div>
  );
}
