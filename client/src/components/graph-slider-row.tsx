import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import type { GraphParameter } from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Slider } from '@/components/ui/slider';
import { breakUndoCapture } from '@/canvas/use-document-store';
import { useGraphAnimationStore } from '@/canvas/use-graph-animation-store';
import { cn } from '@/lib/utils';
import { formatNumber, valueFromSlider } from './graph-panel-utils';

/** How often a playing slider's sweep is written to the shared document. */
const ANIMATION_COMMIT_MS = 80;
/* ─── Fluid Slider row ───────────────────────────────────────────────────── */

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

  return (
    <div className="flex flex-col gap-2 p-2.5">
      {/* Top row: Play/Pause + Parameter LaTeX symbol + Editable value */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant={playing ? 'subtle' : 'ghost'}
            size="icon-sm"
            aria-label={playing ? `Pause ${name}` : `Animate ${name}`}
            onClick={() => setPlaying((p) => !p)}
            className={cn(
              'size-7 rounded-md text-fg-secondary hover:text-fg',
              playing && 'bg-panel text-fg font-semibold shadow-2xs',
            )}
          >
            {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
          </Button>
          <span
            className="font-['KaTeX_Math','KaTeX_Main',serif] text-base font-normal italic leading-none text-fg select-none"
            aria-label={`Parameter ${name}`}
          >
            {name}
          </span>
        </div>

        <div className="flex items-center gap-1">
          <Input
            type="number"
            step="any"
            inputMode="decimal"
            aria-label={`${name} value`}
            value={valueDraft}
            onChange={(e) => setValueDraft(e.target.value)}
            onBlur={(e) => commitValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                commitValue(valueDraft);
                e.currentTarget.blur();
              }
            }}
            className="h-6 w-14 !rounded-none !border-0 !bg-transparent px-1 text-right font-['KaTeX_Main',serif] text-sm font-normal tabular-nums text-fg hover:text-fg !shadow-none focus:!bg-subtle/60 focus:text-fg focus:!outline-none focus:!ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
          />
        </div>
      </div>

      {/* Bottom row: Min input + Slider track + Max input */}
      <div className="flex items-center gap-2">
        <Input
          type="number"
          step="any"
          inputMode="decimal"
          aria-label={`${name} minimum`}
          value={minDraft}
          onChange={(e) => setMinDraft(e.target.value)}
          onBlur={(e) => commitBound('min', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitBound('min', minDraft);
              e.currentTarget.blur();
            }
          }}
          className="h-5.5 w-11 !rounded-none !border-0 !bg-transparent px-0.5 text-center font-['KaTeX_Main',serif] text-xs font-normal tabular-nums text-fg-secondary hover:text-fg !shadow-none focus:!bg-subtle/60 focus:text-fg focus:!outline-none focus:!ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />

        <Slider
          aria-label={name}
          min={parameter.min}
          max={parameter.max}
          step={parameter.step}
          value={parameter.value}
          onValueChange={(value) =>
            onChange({ ...parameter, value: valueFromSlider(value) })
          }
          className="min-w-0 flex-1"
        />

        <Input
          type="number"
          step="any"
          inputMode="decimal"
          aria-label={`${name} maximum`}
          value={maxDraft}
          onChange={(e) => setMaxDraft(e.target.value)}
          onBlur={(e) => commitBound('max', e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitBound('max', maxDraft);
              e.currentTarget.blur();
            }
          }}
          className="h-5.5 w-11 !rounded-none !border-0 !bg-transparent px-0.5 text-center font-['KaTeX_Main',serif] text-xs font-normal tabular-nums text-fg-secondary hover:text-fg !shadow-none focus:!bg-subtle/60 focus:text-fg focus:!outline-none focus:!ring-0 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
        />
      </div>
    </div>
  );
}
