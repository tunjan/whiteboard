import { useId, useMemo, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { Eye, EyeOff, X } from 'lucide-react';
import type {
  GraphExpression,
  GraphParametricDomain,
  StrokeDash,
} from '@whiteboard/shared';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MathField } from '@/components/ui/math-field';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { graphColorName, graphColors } from '@/canvas/graph-colors';
import {
  DEFAULT_GRAPH_CURVE_WIDTH,
  GRAPH_CURVE_WIDTHS,
  parametricDomain,
} from '@/canvas/graph-defaults';
import {
  parseGraphExpression,
  type GraphFunctionDefinitions,
} from '@/canvas/graph-parser';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';
import {
  MATH_SYMBOL,
  QUIET_NUMBER,
  SEGMENTED_ITEM,
  SEGMENTED_TRACK,
} from './graph-panel-styles';
import { formatNumber, useDebouncedValue } from './graph-panel-utils';

const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];
const SWATCH_COLUMNS = 6;

/** Row actions stay out of sight until the row is reached; always there on touch. */
const ROW_REVEAL =
  'touch-reveal opacity-0 transition-opacity duration-fast group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100';

function useParsedExpression(
  source: string,
  definitions: GraphFunctionDefinitions,
) {
  return useMemo(
    () => (source.trim() ? parseGraphExpression(source, definitions) : null),
    [source, definitions],
  );
}

function capitalize(word: string) {
  return `${word[0]!.toUpperCase()}${word.slice(1)}`;
}

function LinePreview({
  dash,
  color,
  width = 2.25,
}: {
  dash: StrokeDash;
  color: string;
  width?: number;
}) {
  const dasharray =
    dash === 'dashed' ? '5 4' : dash === 'dotted' ? '0.1 4' : undefined;
  return (
    <svg width={28} height={12} viewBox="0 0 28 12" aria-hidden="true">
      <line
        x1={3}
        y1={6}
        x2={25}
        y2={6}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
    </svg>
  );
}

/* ─── Curve style: the swatch opens colour, line and weight ─────────────── */

function CurveStyle({
  expression,
  onPatch,
}: {
  expression: GraphExpression;
  onPatch: (patch: Partial<GraphExpression>) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const colors = graphColors(theme);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const width = expression.width ?? DEFAULT_GRAPH_CURVE_WIDTH;

  const moveSwatch = (event: React.KeyboardEvent, index: number) => {
    const step =
      event.key === 'ArrowRight'
        ? 1
        : event.key === 'ArrowLeft'
          ? -1
          : event.key === 'ArrowDown'
            ? SWATCH_COLUMNS
            : event.key === 'ArrowUp'
              ? -SWATCH_COLUMNS
              : 0;
    if (!step) return;
    event.preventDefault();
    const next = (index + step + colors.length) % colors.length;
    onPatch({ color: colors[next]!.value });
    swatchRefs.current[next]?.focus();
  };

  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Style: ${graphColorName(expression.color, theme)}, ${expression.dash}`}
        className="grid size-8 shrink-0 place-items-center rounded-control transition-colors duration-fast hover:bg-tb-track focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
      >
        <span
          className="size-3.5 rounded-full border-2 transition-colors duration-fast"
          style={{
            borderColor: expression.color,
            background: expression.visible ? expression.color : 'transparent',
          }}
        />
      </PopoverTrigger>

      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-56 gap-2 p-2"
      >
        <div
          role="radiogroup"
          aria-label="Color"
          className="grid grid-cols-6 gap-0.5"
        >
          {colors.map((paletteColor, index) => {
            const active = expression.color === paletteColor.value;
            return (
              <button
                key={paletteColor.value}
                ref={(el) => {
                  swatchRefs.current[index] = el;
                }}
                type="button"
                role="radio"
                aria-checked={active}
                aria-label={paletteColor.name}
                title={paletteColor.name}
                tabIndex={active ? 0 : -1}
                onKeyDown={(e) => moveSwatch(e, index)}
                onClick={() => onPatch({ color: paletteColor.value })}
                className="grid h-8 place-items-center rounded-control transition-colors duration-fast hover:bg-tb-track focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
              >
                <span
                  className={cn(
                    'size-4.5 rounded-full border',
                    active &&
                      'ring-2 ring-ring ring-offset-2 ring-offset-popup-surface',
                  )}
                  style={{
                    backgroundColor: paletteColor.value,
                    borderColor: swatchBorder(paletteColor.value),
                  }}
                />
              </button>
            );
          })}
        </div>

        <ToggleGroup
          aria-label="Line style"
          value={[expression.dash]}
          onValueChange={(value) => {
            const dash = value[0] as StrokeDash | undefined;
            if (dash) onPatch({ dash });
          }}
          className={cn(SEGMENTED_TRACK, 'w-full')}
        >
          {DASHES.map((dash) => (
            <ToggleGroupItem
              key={dash}
              value={dash}
              aria-label={capitalize(dash)}
              title={capitalize(dash)}
              className={SEGMENTED_ITEM}
            >
              <LinePreview dash={dash} color="currentColor" />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ToggleGroup
          aria-label="Line weight"
          value={[String(width)]}
          onValueChange={(value) => {
            const next = Number(value[0]);
            if (Number.isFinite(next)) onPatch({ width: next });
          }}
          className={cn(SEGMENTED_TRACK, 'w-full')}
        >
          {GRAPH_CURVE_WIDTHS.map((w) => (
            <ToggleGroupItem
              key={w}
              value={String(w)}
              aria-label={`${w} pixels`}
              title={`${w}px`}
              className={SEGMENTED_ITEM}
            >
              <LinePreview dash="solid" color="currentColor" width={w} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Parametric t-domain ───────────────────────────────────────────────── */

function DomainRow({
  domain,
  onChange,
}: {
  domain: GraphParametricDomain;
  onChange: (domain: GraphParametricDomain) => void;
}) {
  const [draft, setDraft] = useState({
    min: formatNumber(domain.min),
    max: formatNumber(domain.max),
  });

  // A domain changed elsewhere replaces the draft during render, not an
  // effect later, so the row never paints a frame of stale bounds.
  const [synced, setSynced] = useState(domain);
  if (synced.min !== domain.min || synced.max !== domain.max) {
    setSynced(domain);
    setDraft({ min: formatNumber(domain.min), max: formatNumber(domain.max) });
  }

  const commit = (bound: 'min' | 'max') => {
    const text = draft[bound].trim();
    // `Number('')` is 0: a cleared field reverts rather than committing 0.
    const value = text === '' ? NaN : Number(text);
    const next = { ...domain, [bound]: value };
    if (Number.isFinite(value) && next.min < next.max) onChange(next);
    else setDraft((d) => ({ ...d, [bound]: formatNumber(domain[bound]) }));
  };

  const field = (bound: 'min' | 'max') => (
    <Input
      type="number"
      step="any"
      inputMode="decimal"
      aria-label={`t ${bound === 'min' ? 'minimum' : 'maximum'}`}
      value={draft[bound]}
      onChange={(e) => setDraft((d) => ({ ...d, [bound]: e.target.value }))}
      onBlur={() => commit(bound)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
      }}
      className={QUIET_NUMBER}
    />
  );

  // Indented to the formula, so it reads as belonging to it.
  return (
    <div className="flex items-center gap-1 pb-1.5 pl-10 text-xs text-fg-subtle">
      {field('min')}
      <span className={cn(MATH_SYMBOL, 'text-xs text-fg-subtle')}>≤ t ≤</span>
      {field('max')}
    </div>
  );
}

/* ─── Expression row ────────────────────────────────────────────────────── */

export function ExpressionRow({
  expression,
  index,
  onPatch,
  onDelete,
  onEnter,
  onBackspaceEmpty,
  onMoveOut,
  onEscape,
  registerField,
  definitions,
}: {
  expression: GraphExpression;
  index: number;
  onPatch: (patch: Partial<GraphExpression>) => void;
  onDelete: () => void;
  onEnter: () => void;
  onBackspaceEmpty: () => void;
  onMoveOut: (direction: 'upward' | 'downward') => void;
  onEscape: () => void;
  registerField: (el: MathfieldElement | null) => void;
  definitions: GraphFunctionDefinitions;
}) {
  const errorId = useId();
  const settled = useDebouncedValue(expression.expression, 400);
  // One parse serves both the error line and the parametric domain row; the
  // error additionally waits for typing to settle so it doesn't flash on every
  // keystroke.
  const parsed = useParsedExpression(settled, definitions);
  const error =
    settled === expression.expression && parsed && !parsed.ok
      ? parsed.message
      : null;
  const parametric = parsed?.ok === true && parsed.kind === 'parametric';

  const fieldRef = useRef<MathfieldElement | null>(null);

  // The math column reads as one text field, so a press that lands on the
  // column but misses the mathfield still opens the expression for editing,
  // with the caret at the end.
  const editOnColumnPress = (event: React.PointerEvent<HTMLDivElement>) => {
    const field = fieldRef.current;
    if (!field || event.target === field) return;
    event.preventDefault();
    field.focus();
    field.executeCommand('moveToMathfieldEnd');
  };

  const label = `Expression ${index + 1}`;

  return (
    <div className="group/row relative px-2 transition-colors duration-fast hover:bg-surface-hover/60 focus-within:bg-surface-hover">
      {/* The accent edge marks the row being edited. */}
      <span
        aria-hidden="true"
        className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-check opacity-0 transition-opacity duration-fast group-focus-within/row:opacity-100"
      />
      <div className="flex items-center gap-1">
        <CurveStyle expression={expression} onPatch={onPatch} />

        <div
          className={cn(
            'min-w-0 flex-1 cursor-text transition-opacity duration-fast',
            !expression.visible && 'opacity-45',
          )}
          onPointerDown={editOnColumnPress}
        >
          <MathField
            id={`graph-expression-${expression.id}`}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            className="graph-expression-field w-full"
            value={expression.expression}
            placeholder="y = sin(x)"
            elementRef={(el) => {
              fieldRef.current = el;
              registerField(el);
            }}
            onChange={(value) => onPatch({ expression: value })}
            onEnter={onEnter}
            onBackspaceEmpty={onBackspaceEmpty}
            onMoveOut={onMoveOut}
            onEscape={onEscape}
          />
        </div>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-pressed={!expression.visible}
                aria-label={`Hide ${label.toLowerCase()}`}
                onClick={() => onPatch({ visible: !expression.visible })}
                className={cn(
                  'text-fg-subtle',
                  expression.visible && ROW_REVEAL,
                )}
              >
                {expression.visible ? (
                  <Eye aria-hidden="true" strokeWidth={1.5} />
                ) : (
                  <EyeOff aria-hidden="true" strokeWidth={1.5} />
                )}
              </Button>
            }
          />
          <TooltipContent side="top">
            {expression.visible ? 'Hide' : 'Show'}
          </TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove ${label.toLowerCase()}`}
                onClick={onDelete}
                className={cn(
                  'text-fg-subtle hover:bg-danger-bg hover:text-danger',
                  ROW_REVEAL,
                )}
              >
                <X aria-hidden="true" strokeWidth={1.5} />
              </Button>
            }
          />
          <TooltipContent side="top">Remove</TooltipContent>
        </Tooltip>
      </div>

      {error ? (
        <p
          id={errorId}
          role="status"
          className="pb-2 pl-10 text-xs text-danger"
        >
          {error}
        </p>
      ) : null}

      {parametric ? (
        <DomainRow
          domain={parametricDomain(expression.domain)}
          onChange={(domain) => onPatch({ domain })}
        />
      ) : null}
    </div>
  );
}
