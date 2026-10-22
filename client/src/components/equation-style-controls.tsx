import { useRef } from 'react';
import type { EquationShape } from '@whiteboard/shared';
import { centeredMove } from '@/canvas/shapes/equation';
import { editor } from '@/canvas/use-document-store';
import { paletteColors } from '@/canvas/use-style-store';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';

/** The sizes on offer, in the shape's own `fontSize` units. */
const FONT_SIZES = [16, 22, 28, 40];

/**
 * The two ways TeX sets the same expression, named for what they are used for
 * rather than for the internal style they select.
 */
const STYLES = [
  {
    inline: false,
    label: 'Display',
    hint: 'Set as its own line: limits above ∑, full-size fractions',
  },
  {
    inline: true,
    label: 'Inline',
    hint: 'Set to sit in a line of text: limits beside ∑, smaller fractions',
  },
] as const;

/**
 * A segmented control: size, style. The toggle group's white plate marks the
 * chosen segment on its grey track.
 */
const SEGMENTED_ITEM = 'h-8 grow basis-0 px-2.5 text-xs font-medium';

/**
 * Each size draws its own sample glyph, scaled with the size it stands for, so
 * the control reads without a number or a label.
 */
const sizeGlyphPx = (size: number) => Math.round(8 + size / 3);

/**
 * Colour, size and style — the only things about an equation that aren't in
 * its source. One group, separated by air rather than labelled rows: the
 * swatches, the sized glyphs and the two style names each say what they set.
 *
 * Style is applied by the panel (`onInlineChange`): switching it re-measures
 * the box, and must cancel any source conversion still in flight.
 */
export function EquationStyleControls({
  shape,
  onInlineChange,
}: {
  shape: EquationShape;
  onInlineChange: (inline: boolean) => void;
}) {
  const inline = shape.props.inline ?? false;
  const theme = useThemeStore((state) => state.theme);
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Always include the equation's own color: a shape can carry a value the
  // current theme's palette doesn't hold, and a grid with nothing selected
  // reads as "no color set".
  const colors = paletteColors(theme);
  const swatches = colors.some((c) => c.value === shape.props.color)
    ? colors
    : [...colors, { name: 'Current color', value: shape.props.color }];

  const applyColor = (color: string) => {
    editor.updateShape(shape.id, { props: { color } });
  };

  const moveSwatchFocus = (from: number, delta: number) => {
    const next = (from + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    applyColor(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  const applyFontSize = (fontSize: number) => {
    const current = editor.getShape(shape.id);
    if (current?.type !== 'equation') return;
    const scale = fontSize / current.props.fontSize;
    if (!Number.isFinite(scale) || scale <= 0) return;
    const w = current.props.w * scale;
    const h = current.props.h * scale;
    editor.updateShape(shape.id, {
      ...centeredMove(current, w, h),
      props: { fontSize, w, h },
    });
  };

  return (
    <div className="flex shrink-0 flex-col gap-2 border-t border-border px-3 py-2.5">
      <div
        role="radiogroup"
        aria-label="Color"
        className="grid grid-cols-12 pointer-coarse:grid-cols-6"
      >
        {swatches.map((paletteColor, index) => {
          const active = shape.props.color === paletteColor.value;
          return (
            <Tooltip key={paletteColor.value}>
              <TooltipTrigger
                render={
                  <button
                    ref={(node) => {
                      swatchRefs.current[index] = node;
                    }}
                    type="button"
                    role="radio"
                    aria-label={paletteColor.name}
                    aria-checked={active}
                    tabIndex={active ? 0 : -1}
                    onClick={() => applyColor(paletteColor.value)}
                    onKeyDown={(event) => {
                      const delta =
                        event.key === 'ArrowRight' ||
                        event.key === 'ArrowDown'
                          ? 1
                          : event.key === 'ArrowLeft' ||
                              event.key === 'ArrowUp'
                            ? -1
                            : 0;
                      if (!delta) return;
                      event.preventDefault();
                      moveSwatchFocus(index, delta);
                    }}
                    className="flex h-8 w-full items-center justify-center rounded-control transition-colors duration-fast ease-out hover:bg-tb-track active:scale-[0.98] motion-reduce:transition-none"
                  />
                }
              >
                <span
                  className={cn(
                    'size-4.5 rounded-full border',
                    active &&
                      'ring-2 ring-ring ring-offset-2 ring-offset-surface',
                  )}
                  style={{
                    backgroundColor: paletteColor.value,
                    borderColor: swatchBorder(paletteColor.value),
                  }}
                />
              </TooltipTrigger>
              <TooltipContent side="top">{paletteColor.name}</TooltipContent>
            </Tooltip>
          );
        })}
      </div>

      <div className="flex gap-2">
        <ToggleGroup
          className="flex-[4]"
          aria-label="Size"
          value={[String(Math.round(shape.props.fontSize))]}
          onValueChange={(values) => {
            const next = values[0];
            if (next) applyFontSize(Number(next));
          }}
        >
          {FONT_SIZES.map((size) => (
            <Tooltip key={size}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    className={SEGMENTED_ITEM}
                    value={String(size)}
                    aria-label={`Size ${size}`}
                  />
                }
              >
                <span
                  aria-hidden="true"
                  className="font-serif leading-none italic"
                  style={{ fontSize: sizeGlyphPx(size) }}
                >
                  x
                </span>
              </TooltipTrigger>
              <TooltipContent side="top">Size {size}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>

        {/* Display or text style. Not a property of the source — the same
            LaTeX is valid in both — so it belongs beside colour and size
            rather than in the field. */}
        <ToggleGroup
          className="flex-[3]"
          aria-label="Style"
          value={[inline ? 'inline' : 'display']}
          onValueChange={(values) => {
            const next = values[0];
            if (next) onInlineChange(next === 'inline');
          }}
        >
          {STYLES.map((style) => (
            <Tooltip key={style.label}>
              <TooltipTrigger
                render={
                  <ToggleGroupItem
                    className={SEGMENTED_ITEM}
                    value={style.inline ? 'inline' : 'display'}
                    aria-label={style.label}
                  />
                }
              >
                {style.label}
              </TooltipTrigger>
              <TooltipContent side="top">{style.hint}</TooltipContent>
            </Tooltip>
          ))}
        </ToggleGroup>
      </div>
    </div>
  );
}
