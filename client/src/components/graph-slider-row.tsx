import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { GraphParameter } from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider as SliderPrimitive } from '@base-ui/react/slider';
import { breakUndoCapture } from '@/canvas/use-document-store';
import { useGraphAnimationStore } from '@/canvas/use-graph-animation-store';
import { cn } from '@/lib/utils';
import { MATH_SYMBOL, NUMBER_FIELD, QUIET_NUMBER } from './graph-panel-styles';
import { formatNumber, valueFromSlider } from './graph-panel-utils';

/**
 * Atlassian's Range: a 4px `background.neutral` track filled with, and
 * dragged by a 16px thumb in, `background.neutral.bold`; the thumb takes a
 * 2px `border.focused` ring offset by 2px from the keyboard.
 */
function Range({ className, ...props }: SliderPrimitive.Root.Props) {
  return (
    <SliderPrimitive.Root
      thumbAlignment="edge"
      data-slot="range"
      className={cn('group/range w-full', className)}
      {...props}
    >
      <SliderPrimitive.Control className="relative flex h-8 w-full touch-none items-center select-none">
        <SliderPrimitive.Track className="relative h-1 w-full rounded-full bg-[var(--ds-background-neutral)] transition-colors duration-150 group-hover/range:bg-[var(--ds-background-neutral-hovered)]">
          <SliderPrimitive.Indicator className="h-full rounded-full bg-[var(--ds-background-neutral-bold)] transition-colors duration-150 group-hover/range:bg-[var(--ds-background-neutral-bold-hovered)]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="size-4 rounded-full bg-[var(--ds-background-neutral-bold)] outline-2 outline-offset-2 outline-transparent transition-colors duration-150 group-hover/range:bg-[var(--ds-background-neutral-bold-hovered)] has-[:focus-visible]:outline-[var(--ds-border-focused)] data-dragging:bg-[var(--ds-background-neutral-bold-pressed)]" />
      </SliderPrimitive.Control>
    </SliderPrimitive.Root>
  );
}

/** How often a playing slider's sweep is written to the shared document. */
const ANIMATION_COMMIT_MS = 80;
export function SliderRow({
  shapeId,
  name,
  parameter,
  onChange,
}: {
  shapeId: string;
  name: string;
  parameter: GraphParameter;
  onChange: (parameter: GraphParameter) => void;
}) {
  const [minDraft, setMinDraft] = useState(formatNumber(parameter.min));
  const [maxDraft, setMaxDraft] = useState(formatNumber(parameter.max));
  const [valueDraft, setValueDraft] = useState(formatNumber(parameter.value));
  const [playing, setPlaying] = useState(false);

  useEffect(() => setMinDraft(formatNumber(parameter.min)), [parameter.min]);
  useEffect(() => setMaxDraft(formatNumber(parameter.max)), [parameter.max]);
  useEffect(() => setValueDraft(formatNumber(parameter.value)), [parameter.value]);

  const paramRef = useRef(parameter);
  paramRef.current = parameter;
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // Fluid requestAnimationFrame loop (~60fps). The sweep itself is local — see
  // use-graph-animation-store.ts — and only reaches the document on this
  // cadence, which is often enough for peers to see the curve move without
  // retaining 60 shape updates a second in the CRDT forever.
  useEffect(() => {
    if (!playing) return;
    breakUndoCapture();
    const { setValue, clearValue } = useGraphAnimationStore.getState();
    let raf = 0;
    let last = performance.now();
    let lastCommit = last;
    let dir = 1;
    let v = paramRef.current.value;
    const tick = (now: number) => {
      const p = paramRef.current;
      const span = p.max - p.min || 1;
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      v += dir * (span / 4) * dt;
      if (v >= p.max) {
        v = p.max;
        dir = -1;
      } else if (v <= p.min) {
        v = p.min;
        dir = 1;
      }
      setValue(shapeId, name, v);
      if (now - lastCommit >= ANIMATION_COMMIT_MS) {
        lastCommit = now;
        onChangeRef.current({ ...p, value: v });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      // Land on the value the sweep stopped at before dropping the override,
      // so pausing leaves the curve where it was rather than snapping back.
      onChangeRef.current({ ...paramRef.current, value: v });
      clearValue(shapeId, name);
    };
  }, [playing, shapeId, name]);

  const commitBound = (bound: 'min' | 'max', raw: string) => {
    const value = Number(raw);
    const next =
      bound === 'min'
        ? { min: value, max: parameter.max }
        : { min: parameter.min, max: value };
    if (Number.isFinite(value) && next.min < next.max) {
      onChange({
        ...parameter,
        ...next,
        value: Math.min(next.max, Math.max(next.min, parameter.value)),
      });
    } else if (bound === 'min') {
      setMinDraft(formatNumber(parameter.min));
    } else {
      setMaxDraft(formatNumber(parameter.max));
    }
  };

  const commitValue = (raw: string) => {
    const value = Number(raw);
    if (Number.isFinite(value)) {
      const clamped = Math.min(parameter.max, Math.max(parameter.min, value));
      onChange({ ...parameter, value: clamped });
      setValueDraft(formatNumber(clamped));
    } else {
      setValueDraft(formatNumber(parameter.value));
    }
  };

  const bound = (which: 'min' | 'max') => (
    <Input
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={`${name} ${which === 'min' ? 'minimum' : 'maximum'}`}
      value={which === 'min' ? minDraft : maxDraft}
      onChange={(e) =>
        (which === 'min' ? setMinDraft : setMaxDraft)(e.target.value)
      }
      onBlur={(e) => commitBound(which, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={cn(QUIET_NUMBER, 'w-14 shrink-0')}
    />
  );

  // Two lines: the name, play and value above; the track between its bounds.
  return (
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={`Animate ${name}`}
          aria-pressed={playing}
          onClick={() => setPlaying((p) => !p)}
          className="text-fg-subtle aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg"
        >
          {playing ? (
            <Pause className="size-3.5" aria-hidden="true" />
          ) : (
            <Play className="size-3.5" aria-hidden="true" />
          )}
        </Button>
        <span
          aria-hidden="true"
          className={cn(MATH_SYMBOL, 'flex-1 text-base')}
        >
          {name}
        </span>
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          aria-label={`${name} value`}
          value={valueDraft}
          onChange={(e) => setValueDraft(e.target.value)}
          onBlur={(e) => commitValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          className={cn(NUMBER_FIELD, 'w-16 shrink-0')}
        />
      </div>

      <div className="flex items-center gap-1">
        {bound('min')}
        <Range
          aria-label={name}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={parameter.value}
          onValueChange={(value) =>
            onChange({ ...parameter, value: valueFromSlider(value) })
          }
          className="min-w-0 flex-1 px-1"
        />
        {bound('max')}
      </div>
    </div>
  );
}
