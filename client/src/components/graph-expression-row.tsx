import { useEffect, useMemo, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { AlertCircle, Check, Eye, EyeOff, Trash2 } from 'lucide-react';
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
  TooltipProvider,
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
import { cn } from '@/lib/utils';
import { formatNumber, useDebouncedValue } from './graph-panel-utils';

const DASHES: StrokeDash[] = ['solid', 'dashed', 'dotted'];
function useParsedExpression(
  source: string,
  definitions: GraphFunctionDefinitions,
) {
  return useMemo(
    () => (source.trim() ? parseGraphExpression(source, definitions) : null),
    [source, definitions],
  );
}

/* ─── Dash SVG preview ────────────────────────────────────────────────────── */

function DashPreview({
  dash,
  color = 'currentColor',
  width = 2.5,
}: {
  dash: StrokeDash;
  color?: string;
  width?: number;
}) {
  const dasharray =
    dash === 'dashed' ? '5 4' : dash === 'dotted' ? '0.1 4' : undefined;
  return (
    <svg width={24} height={12} viewBox="0 0 24 12" aria-hidden="true">
      <line
        x1={2}
        y1={6}
        x2={22}
        y2={6}
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeDasharray={dasharray}
      />
    </svg>
  );
}

/* ─── Accessible Color Radiogroup with Roving Tabindex ─────────────────────── */

function ColorRadioGroup({
  value,
  onChange,
  label = 'Color',
}: {
  value: string;
  onChange: (color: string) => void;
  label?: string;
}) {
  const theme = useThemeStore((s) => s.theme);
  const colors = graphColors(theme);
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    let nextIndex = index;
    if (e.key === 'ArrowRight') nextIndex = (index + 1) % colors.length;
    else if (e.key === 'ArrowLeft')
      nextIndex = (index - 1 + colors.length) % colors.length;
    else if (e.key === 'ArrowDown') nextIndex = (index + 4) % colors.length;
    else if (e.key === 'ArrowUp')
      nextIndex = (index - 4 + colors.length) % colors.length;
    else return;

    e.preventDefault();
    const next = colors[nextIndex]!;
    onChange(next.value);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="grid grid-cols-4 gap-1.5"
    >
      {colors.map((paletteColor, index) => {
        const active = value === paletteColor.value;
        return (
          <button
            key={paletteColor.value}
            ref={(el) => {
              buttonRefs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            aria-label={paletteColor.name}
            title={paletteColor.name}
            onKeyDown={(e) => handleKeyDown(e, index)}
            onClick={() => onChange(paletteColor.value)}
            className={cn(
              'relative grid size-8 place-items-center rounded-md border transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1',
              active
                ? 'border-primary ring-2 ring-focus ring-offset-1 bg-surface'
                : 'border-border/60 hover:border-border-strong hover:bg-subtle/80',
            )}
          >
            <span
              className="size-4 rounded-full shadow-inner"
              style={{ background: paletteColor.value }}
            />
            {active && (
              <span className="absolute inset-0 grid place-items-center text-white drop-shadow-xs">
                <Check className="size-2.5 stroke-[3]" />
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/* ─── Curve style popover ────────────────────────────────────────────────── */

function CurveStylePopover({
  expression,
  onPatch,
}: {
  expression: GraphExpression;
  onPatch: (patch: Partial<GraphExpression>) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  return (
    <Popover>
      <PopoverTrigger
        aria-label={`Curve style: ${graphColorName(expression.color, theme)}, ${expression.dash} line`}
        title="Color & style"
        className="group/swatch relative grid size-8 place-items-center rounded-lg transition-all hover:bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus focus-visible:ring-offset-1"
      >
        <span
          className="size-5 rounded-full ring-1 ring-border-strong shadow-xs transition-transform duration-instant group-hover/swatch:scale-110"
          style={{
            background: expression.visible ? expression.color : 'transparent',
            borderColor: expression.color,
            borderWidth: expression.visible ? 0 : 2,
          }}
        />
      </PopoverTrigger>

      <PopoverContent
        side="left"
        align="start"
        sideOffset={8}
        className="w-52 gap-2.5 p-2.5 shadow-e3"
      >
        <ColorRadioGroup
          value={expression.color}
          onChange={(color) => onPatch({ color })}
          label="Color"
        />

        <ToggleGroup
          aria-label="Line style"
          value={[expression.dash]}
          onValueChange={(value) => {
            const dash = value[0] as StrokeDash | undefined;
            if (dash) onPatch({ dash });
          }}
          className="w-full pt-1"
        >
          {DASHES.map((dash) => (
            <ToggleGroupItem
              key={dash}
              value={dash}
              title={`${dash[0]!.toUpperCase()}${dash.slice(1)} line`}
              aria-label={`${dash[0]!.toUpperCase()}${dash.slice(1)} line`}
              className="grow basis-0"
            >
              <DashPreview dash={dash} color={expression.color} />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>

        <ToggleGroup
          aria-label="Line thickness"
          value={[String(expression.width ?? DEFAULT_GRAPH_CURVE_WIDTH)]}
          onValueChange={(value) => {
            const width = Number(value[0]);
            if (Number.isFinite(width)) onPatch({ width });
          }}
          className="w-full"
        >
          {GRAPH_CURVE_WIDTHS.map((width) => (
            <ToggleGroupItem
              key={width}
              value={String(width)}
              title={`${width}px line`}
              aria-label={`${width} pixel line`}
              className="grow basis-0"
            >
              <DashPreview
                dash={expression.dash}
                color={expression.color}
                width={width}
              />
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PopoverContent>
    </Popover>
  );
}

/* ─── Parametric t-domain row ────────────────────────────────────────────── */

function DomainRow({
  domain,
  onChange,
}: {
  domain: GraphParametricDomain;
  onChange: (domain: GraphParametricDomain) => void;
}) {
  const [minDraft, setMinDraft] = useState(formatNumber(domain.min));
  const [maxDraft, setMaxDraft] = useState(formatNumber(domain.max));

  useEffect(() => setMinDraft(formatNumber(domain.min)), [domain.min]);
  useEffect(() => setMaxDraft(formatNumber(domain.max)), [domain.max]);

  const commit = (bound: 'min' | 'max', raw: string) => {
    const value = Number(raw);
    const next = { ...domain, [bound]: value };
    if (Number.isFinite(value) && next.min < next.max) onChange(next);
    else if (bound === 'min') setMinDraft(formatNumber(domain.min));
    else setMaxDraft(formatNumber(domain.max));
  };

  const inputClass =
    'h-5.5 w-11 !rounded-none !border-0 !bg-transparent px-0.5 text-center font-[\'KaTeX_Main\',serif] text-xs font-normal tabular-nums text-fg-secondary hover:text-fg !shadow-none focus:!bg-subtle/60 focus:text-fg focus:!outline-none focus:!ring-0 focus-visible:!outline-none [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none';

  // pl-12 clears the index + swatch gutter, so this lines up with the field.
  return (
    <div className="flex items-center gap-1 pb-1.5 pl-12 text-xs text-fg-subtle">
      <Input
        type="number"
        step="any"
        inputMode="decimal"
        aria-label="t minimum"
        value={minDraft}
        onChange={(e) => setMinDraft(e.target.value)}
        onBlur={(e) => commit('min', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit('min', minDraft);
            e.currentTarget.blur();
          }
        }}
        className={inputClass}
      />
      <span className="font-['KaTeX_Math','KaTeX_Main',serif] italic select-none">≤ t ≤</span>
      <Input
        type="number"
        step="any"
        inputMode="decimal"
        aria-label="t maximum"
        value={maxDraft}
        onChange={(e) => setMaxDraft(e.target.value)}
        onBlur={(e) => commit('max', e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit('max', maxDraft);
            e.currentTarget.blur();
          }
        }}
        className={inputClass}
      />
    </div>
  );
}

/* ─── Expression row with Zero-CLS Error Badge ───────────────────────────── */

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
  const settled = useDebouncedValue(expression.expression, 400);
  // One parse serves both the error badge and the parametric domain row; the
  // badge additionally waits for typing to settle so it doesn't flash on every
  // keystroke.
  const parsed = useParsedExpression(settled, definitions);
  const error =
    settled === expression.expression && parsed && !parsed.ok
      ? parsed.message
      : null;
  const parametric = parsed?.ok === true && parsed.kind === 'parametric';

  const fieldRef = useRef<MathfieldElement | null>(null);

  // The math column reads as one text field, so a press that lands on the
  // column but misses the mathfield (the gap beside the error badge, the strip
  // above/below a short formula) still opens the expression for editing, with
  // the caret at the end.
  const editOnColumnPress = (event: React.PointerEvent<HTMLDivElement>) => {
    const field = fieldRef.current;
    if (!field || event.target === field) return;
    if ((event.target as HTMLElement).closest('button')) return;
    event.preventDefault();
    field.focus();
    field.executeCommand('moveToMathfieldEnd');
  };

  return (
    <div className="group/row relative flex min-h-16 flex-col px-3 py-2.5 transition-colors duration-instant hover:bg-subtle/40 focus-within:bg-subtle/60">
      <div className="flex flex-1 items-center gap-2">
        {/* Left gutter: Index + Swatch */}
        <div className="flex shrink-0 items-center gap-2">
          <span className="w-4 text-right text-base font-medium text-tertiary select-none">
            {index + 1}
          </span>
          <CurveStylePopover expression={expression} onPatch={onPatch} />
        </div>

        {/* Math field container */}
        <div
          className="flex min-w-0 flex-1 cursor-text items-center gap-1"
          onPointerDown={editOnColumnPress}
        >
          <MathField
            id={`graph-expression-${expression.id}`}
            aria-label={`Expression ${index + 1}`}
            aria-invalid={error ? true : undefined}
            className="graph-expression-field w-full self-stretch"
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

          {/* Zero-CLS Error Indicator with accessible tooltip */}
          {error ? (
            <TooltipProvider delay={0}>
              <Tooltip>
                <TooltipTrigger
                  type="button"
                  aria-label={`Syntax error: ${error}`}
                  className="grid size-5.5 shrink-0 place-items-center rounded text-danger hover:bg-danger-bg focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-danger"
                >
                  <AlertCircle className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="bg-inverse text-fg-inverse text-xs px-2.5 py-1 max-w-xs shadow-e3 border-none rounded-md"
                >
                  <span>{error}</span>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          ) : null}
        </div>

        {/* Row Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon-md"
            aria-label={
              expression.visible
                ? `Hide curve ${index + 1}`
                : `Show curve ${index + 1}`
            }
            title={expression.visible ? 'Hide' : 'Show'}
            onClick={() => onPatch({ visible: !expression.visible })}
          >
            {expression.visible ? (
              <Eye
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            ) : (
              <EyeOff
                data-icon="inline-start"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            )}
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon-md"
            aria-label={`Delete curve ${index + 1}`}
            title="Delete"
            onClick={onDelete}
          >
            <Trash2
              data-icon="inline-start"
              aria-hidden="true"
              strokeWidth={1.75}
            />
          </Button>
        </div>
      </div>

      {parametric ? (
        <DomainRow
          domain={parametricDomain(expression.domain)}
          onChange={(domain) => onPatch({ domain })}
        />
      ) : null}
    </div>
  );
}
