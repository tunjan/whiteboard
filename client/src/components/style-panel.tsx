import { useRef } from 'react';
import { ArrowLeft, ArrowRight } from 'lucide-react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  LineSpline,
  StrokeDash,
  TextAlign,
} from '@whiteboard/shared';
import { fontStack } from '@/canvas/shapes/text-measure';
import { paletteColors, SIZE_OPTIONS } from '@/canvas/use-style-store';
import { useStyleControls } from '@/canvas/use-style-controls';
import { useToolStore } from '@/canvas/use-tool-store';
import { useThemeStore } from '@/use-theme-store';
import { cn, swatchBorder } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { OpacitySlider } from '@/components/opacity-slider';
import {
  ALIGNS,
  ARROW_TOPOLOGIES,
  DASHES,
  DASH_LABELS,
  DashPreview,
  FILLS,
  FILL_LABELS,
  FONTS,
  FillPreview,
  WEIGHTS,
} from '@/components/style-previews';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { ToolPanelPresence } from '@/components/tool-panel-presence';

// Toggle rows span the panel and divide it evenly, so every row lines up with
// the swatch grid's edges (and its columns, for four-option rows).
const TOGGLE_ROW = 'w-full';
const TOGGLE_ITEM = 'grow basis-0';

/**
 * Color, stroke width, fill, dash, and text styling for the selection and for
 * new shapes, docked top-right.
 *
 * Superseded and no longer mounted: every control it carries now rides on the
 * toolbar's satellite bar, where the pointer already is. Kept because it is
 * still the only laid-out-in-a-column arrangement of these controls, and both
 * it and the bar now read their state from the same `useStyleControls`, so it
 * cannot rot into disagreeing with the live UI about what a control does.
 */
export function StylePanel() {
  const activeToolId = useToolStore((s) => s.activeToolId);
  const { visible, show, targetType, values, apply } =
    useStyleControls(activeToolId);
  const {
    color,
    size,
    fill,
    dash,
    opacity,
    arrowStart,
    arrowEnd,
    arrowTopology,
    lineSpline,
    fontFamily,
    fontWeight,
    align,
    connectorLabel,
  } = values;
  const theme = useThemeStore((s) => s.theme);
  const colors = paletteColors(theme);

  const panelContentKey =
    activeToolId === 'select'
      ? `selection-${targetType ?? 'default'}`
      : `tool-${targetType ?? 'default'}`;

  // Swatches always include the active color: a persisted choice can hold a
  // value the current palette does not contain, and a color grid with
  // nothing selected reads as "no color set".
  const offPalette = !colors.some((c) => c.value === color);
  const swatches = offPalette
    ? [...colors, { name: 'Current color', value: color }]
    : colors;
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  // Arrow keys move between swatches, matching radiogroup conventions.
  const moveSwatchFocus = (from: number, delta: number) => {
    const next = (from + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    apply.color(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  return (
    <ToolPanelPresence visible={visible}>
      {visible ? (
        <Surface
          role="region"
          aria-label="Style controls"
          className="touch-targets w-[min(14.5rem,calc(100vw-2rem))] max-h-[calc(100dvh-8rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain p-3.5 sm:max-h-[calc(100dvh-5.5rem-env(safe-area-inset-top)-env(safe-area-inset-bottom))]"
        >
          <TooltipProvider delay={300}>
            <div
              key={panelContentKey}
              className="tool-panel-content flex flex-col gap-2.5"
            >
              <div className="flex flex-col gap-2">
                {show.color ? (
                  <>
                    <div className="flex flex-col gap-1.5">
                      <div
                        role="radiogroup"
                        aria-label="Color"
                        className="grid grid-cols-4 gap-1.5"
                      >
                        {swatches.map((paletteColor, index) => {
                          const active = color === paletteColor.value;
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
                                    onClick={() =>
                                      apply.color(paletteColor.value)
                                    }
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
                                    className="flex h-8 w-full items-center justify-center rounded-md transition-colors duration-150 ease-out hover:bg-accent active:scale-[0.98] motion-reduce:transition-none"
                                  />
                                }
                              >
                                <span
                                  className={cn(
                                    'size-5 rounded-full border',
                                    active &&
                                      'ring-2 ring-ring ring-offset-2 ring-offset-background',
                                  )}
                                  style={{
                                    backgroundColor: paletteColor.value,
                                    borderColor: swatchBorder(
                                      paletteColor.value,
                                    ),
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="left">
                                {paletteColor.name}
                              </TooltipContent>
                            </Tooltip>
                          );
                        })}
                      </div>
                    </div>
                  </>
                ) : null}

                {show.opacity ? (
                  <Tooltip>
                    <TooltipTrigger render={<div />}>
                      <OpacitySlider
                        aria-label="Opacity"
                        value={opacity}
                        onValueChange={apply.opacity}
                      />
                    </TooltipTrigger>
                    <TooltipContent side="left">
                      Opacity {Math.round(opacity * 100)}%
                    </TooltipContent>
                  </Tooltip>
                ) : null}
              </div>

              {show.fill ||
              show.dash ||
              show.size ||
              show.font ||
              show.align ||
              show.arrows ||
              show.lineOptions ||
              show.connectorLabel ? (
                <div className="flex flex-col gap-2">
                  {show.fill ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Fill style"
                      value={[fill]}
                      onValueChange={(values) =>
                        values[0] && apply.fill(values[0] as FillStyle)
                      }
                    >
                      {FILLS.map((fillStyle) => (
                        <Tooltip key={fillStyle}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={fillStyle}
                                aria-label={FILL_LABELS[fillStyle]}
                              />
                            }
                          >
                            <FillPreview style={fillStyle} />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {FILL_LABELS[fillStyle]}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.dash ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Stroke style"
                      value={[dash]}
                      onValueChange={(values) =>
                        values[0] && apply.dash(values[0] as StrokeDash)
                      }
                    >
                      {DASHES.map((strokeDash) => (
                        <Tooltip key={strokeDash}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={strokeDash}
                                aria-label={DASH_LABELS[strokeDash]}
                              />
                            }
                          >
                            <DashPreview dash={strokeDash} />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {DASH_LABELS[strokeDash]}
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.size ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Stroke weight"
                      value={[String(size)]}
                      onValueChange={(values) =>
                        values[0] && apply.size(Number(values[0]))
                      }
                    >
                      {SIZE_OPTIONS.map((option) => (
                        <Tooltip key={option.name}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={String(option.value)}
                                aria-label={`${option.name}, ${option.value} pixels`}
                              />
                            }
                          >
                            {option.name}
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {option.name} — {option.value}px
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.font ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Typeface"
                      value={[fontFamily]}
                      onValueChange={(values) =>
                        values[0] && apply.fontFamily(values[0] as FontFamily)
                      }
                    >
                      {FONTS.map(({ family, label }) => (
                        <Tooltip key={family}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={family}
                                aria-label={`${family} typeface`}
                                style={{ fontFamily: fontStack(family) }}
                              />
                            }
                          >
                            {label}
                          </TooltipTrigger>
                          <TooltipContent side="left">{family}</TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.font ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Font weight"
                      value={[String(fontWeight)]}
                      onValueChange={(values) =>
                        values[0] &&
                        apply.fontWeight(Number(values[0]) as FontWeight)
                      }
                    >
                      {WEIGHTS.map(({ weight, label }) => (
                        <Tooltip key={weight}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={String(weight)}
                                aria-label={`${label} weight`}
                                // Preview each option in the weight it applies, using
                                // the typeface currently selected.
                                style={{
                                  fontFamily: fontStack(fontFamily),
                                  fontWeight: weight,
                                }}
                              />
                            }
                          >
                            A
                          </TooltipTrigger>
                          <TooltipContent side="left">{label}</TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.align ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Text alignment"
                      value={[align]}
                      onValueChange={(values) =>
                        values[0] && apply.align(values[0] as TextAlign)
                      }
                    >
                      {ALIGNS.map(({ align: textAlign, Icon }) => (
                        <Tooltip key={textAlign}>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value={textAlign}
                                aria-label={`${textAlign} alignment`}
                              />
                            }
                          >
                            <Icon aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            {textAlign} alignment
                          </TooltipContent>
                        </Tooltip>
                      ))}
                    </ToggleGroup>
                  ) : null}

                  {show.lineOptions ? (
                    <ToggleGroup
                      className={TOGGLE_ROW}
                      aria-label="Line interpolation"
                      value={[lineSpline ?? 'linear']}
                      onValueChange={(values) =>
                        values[0] && apply.lineSpline(values[0] as LineSpline)
                      }
                    >
                      <ToggleGroupItem className={TOGGLE_ITEM} value="linear">
                        Linear
                      </ToggleGroupItem>
                      <ToggleGroupItem className={TOGGLE_ITEM} value="smooth">
                        Smooth
                      </ToggleGroupItem>
                    </ToggleGroup>
                  ) : null}

                  {show.arrows ? (
                    <>
                      <ToggleGroup
                        className={TOGGLE_ROW}
                        aria-label="Arrow route"
                        value={[arrowTopology ?? 'straight']}
                        onValueChange={(values) =>
                          values[0] &&
                          apply.arrowTopology(values[0] as ArrowTopology)
                        }
                      >
                        {ARROW_TOPOLOGIES.map((option) => (
                          <Tooltip key={option.value}>
                            <TooltipTrigger
                              render={
                                <ToggleGroupItem
                                  className={TOGGLE_ITEM}
                                  value={option.value}
                                  aria-label={option.label}
                                />
                              }
                            >
                              <span
                                className="text-base leading-none"
                                aria-hidden="true"
                              >
                                {option.glyph}
                              </span>
                            </TooltipTrigger>
                            <TooltipContent side="left">
                              {option.label}
                            </TooltipContent>
                          </Tooltip>
                        ))}
                      </ToggleGroup>
                      <ToggleGroup
                        className={TOGGLE_ROW}
                        multiple
                        aria-label="Arrowheads"
                        value={[
                          ...(arrowStart ? ['start'] : []),
                          ...(arrowEnd ? ['end'] : []),
                        ]}
                        onValueChange={(values) => {
                          apply.arrowStart(values.includes('start'));
                          apply.arrowEnd(values.includes('end'));
                        }}
                      >
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value="start"
                                aria-label="Arrowhead at start"
                              />
                            }
                          >
                            <ArrowLeft aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Arrowhead at start
                          </TooltipContent>
                        </Tooltip>
                        <Tooltip>
                          <TooltipTrigger
                            render={
                              <ToggleGroupItem
                                className={TOGGLE_ITEM}
                                value="end"
                                aria-label="Arrowhead at end"
                              />
                            }
                          >
                            <ArrowRight aria-hidden="true" />
                          </TooltipTrigger>
                          <TooltipContent side="left">
                            Arrowhead at end
                          </TooltipContent>
                        </Tooltip>
                      </ToggleGroup>
                    </>
                  ) : null}

                  {show.connectorLabel ? (
                    <Input
                      aria-label="Connector label"
                      placeholder="Label"
                      value={connectorLabel}
                      onChange={(event) =>
                        apply.connectorLabel(event.target.value)
                      }
                    />
                  ) : null}
                </div>
              ) : null}
            </div>
          </TooltipProvider>
        </Surface>
      ) : null}
    </ToolPanelPresence>
  );
}
