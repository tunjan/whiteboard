import { useEffect, useRef, useState } from 'react';
import type { MathfieldElement } from 'mathlive';
import { Keyboard } from 'lucide-react';
import type { EquationShape } from '@whiteboard/shared';
import { useAnimationStore } from '@/animation/use-animation-store';
import { consumeEquationFocus } from '@/canvas/equation-focus';
import {
  ensureMathJax,
  getEquationRender,
  typesetEquation,
  useEquationRenderStore,
  type EquationRender,
} from '@/canvas/equation-render';
import { EQUATION_DEFAULT_SIZE } from '@/canvas/shapes/equation';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { paletteColors, useStyleStore } from '@/canvas/use-style-store';
import { ToolPanelPresence } from '@/components/tool-panel-presence';
import { Button } from '@/components/ui/button';
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { MathField } from '@/components/ui/math-field';
import { PanelLabel } from '@/components/ui/panel-label';
import { Surface } from '@/components/ui/surface';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { useThemeStore } from '@/use-theme-store';

const swatchBorder = (color: string) => `color-mix(in srgb, ${color} 75%, #000)`;

// Equations reflow on every keystroke, so dragging a resize handle to a target
// size fights a moving box. These presets give repeatable sizes instead.
const FONT_SIZES = [
  { name: 'S', value: 20 },
  { name: 'M', value: 28 },
  { name: 'L', value: 40 },
  { name: 'XL', value: 56 },
];

function useDebouncedValue<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);
  return debounced;
}

/** A touch/pen-primary device, where a math keyboard is the only way to type. */
function prefersVirtualKeyboard(): boolean {
  return window.matchMedia('(pointer: coarse)').matches;
}

/**
 * MathJax's messages are written for TeX authors. Rewrite the few that a
 * whiteboard user actually hits; pass anything else through.
 */
function readableError(message: string): string {
  const unknown = /undefined control sequence:?\s*(\\[a-zA-Z@]+)/i.exec(message);
  if (unknown) return `Unknown command ${unknown[1]} — check the spelling.`;
  if (/(missing|extra).*(brace|\{|\})/i.test(message)) {
    return 'Unbalanced braces — every { needs a matching }.';
  }
  if (/missing.*\\(right|left)|extra.*\\(right|left)/i.test(message)) {
    return 'Unbalanced \\left and \\right.';
  }
  return message;
}

/**
 * Resize around the box center. Anchoring to the top-left instead would make
 * the formula creep right and down with every character typed, and centers are
 * also the pivot the rotation transform uses.
 */
function centeredMove(
  shape: EquationShape,
  w: number,
  h: number,
): { x: number; y: number } {
  return {
    x: shape.x + (shape.props.w - w) / 2,
    y: shape.y + (shape.props.h - h) / 2,
  };
}

function patchEquationFromRender(
  shapeId: string,
  latex: string,
  render: EquationRender,
): void {
  const current = editor.getShape(shapeId);
  if (!current || current.type !== 'equation') return;
  if ('error' in render) {
    editor.updateShape(shapeId, { props: { latex } });
    return;
  }
  const scale = current.props.fontSize / 16;
  const w = render.width * scale;
  const h = render.height * scale;
  editor.updateShape(shapeId, {
    ...centeredMove(current, w, h),
    props: { latex, w, h },
  });
}

function EquationPanelContent({ shape }: { shape: EquationShape }) {
  const fieldRef = useRef<MathfieldElement | null>(null);
  const inputVersion = useRef(0);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [keyboardOpen, setKeyboardOpen] = useState(false);
  const theme = useThemeStore((state) => state.theme);
  const paletteId = useStyleStore((state) => state.paletteId);
  const setStyleColor = useStyleStore((state) => state.setColor);
  useEquationRenderStore((state) => state.version);

  useEffect(() => {
    let active = true;
    setReady(false);
    setLoadError(null);
    void ensureMathJax()
      .then(() => {
        if (active) setReady(true);
      })
      .catch((error: unknown) => {
        if (!active) return;
        setLoadError(
          error instanceof Error
            ? error.message
            : 'The equation renderer could not be loaded.',
        );
      });
    return () => {
      active = false;
    };
  }, []);

  // Only a freshly placed equation takes focus, and only a touch device opens
  // the math keyboard with it — on desktop the physical keyboard is enough and
  // the panel would otherwise cover the canvas on every selection.
  useEffect(() => {
    if (!consumeEquationFocus(shape.id)) return;
    let frame = 0;
    const focusField = (tries: number) => {
      if (fieldRef.current) {
        fieldRef.current.focus();
        if (prefersVirtualKeyboard()) {
          window.mathVirtualKeyboard.show({ animate: true });
        }
      } else if (tries > 0) {
        frame = requestAnimationFrame(() => focusField(tries - 1));
      }
    };
    frame = requestAnimationFrame(() => focusField(5));
    return () => cancelAnimationFrame(frame);
  }, [shape.id]);

  // Track the keyboard's real visibility (it can also be dismissed from its own
  // close button) and make sure it never outlives the panel.
  useEffect(() => {
    const keyboard = window.mathVirtualKeyboard;
    const sync = () => setKeyboardOpen(keyboard.visible);
    sync();
    // The interface is an EventTarget at runtime; its typings omit that.
    const target = keyboard as unknown as EventTarget;
    target.addEventListener('virtual-keyboard-toggle', sync);
    return () => {
      target.removeEventListener('virtual-keyboard-toggle', sync);
      keyboard.hide({ animate: false });
    };
  }, []);

  const settledLatex = useDebouncedValue(shape.props.latex, 500);
  const settledKey = settledLatex.trim();
  const settledRender = settledKey
    ? getEquationRender(settledKey)
    : undefined;
  const renderError =
    settledLatex === shape.props.latex ? settledRender?.error : undefined;
  const rawError = loadError ?? renderError ?? null;
  const error = rawError ? readableError(rawError) : null;
  const errorId = `equation-error-${shape.id}`;

  const updateLatex = (latex: string) => {
    const version = ++inputVersion.current;
    const key = latex.trim();
    if (!key) {
      editor.updateShape(shape.id, {
        ...centeredMove(shape, EQUATION_DEFAULT_SIZE.w, EQUATION_DEFAULT_SIZE.h),
        props: {
          latex,
          w: EQUATION_DEFAULT_SIZE.w,
          h: EQUATION_DEFAULT_SIZE.h,
        },
      });
      return;
    }

    // Once MathJax is warm this fills the cache synchronously, letting one
    // document patch carry source and measured geometry per keystroke. Before
    // then the field still accepts input and the shape catches up on load.
    const pending = typesetEquation(key);
    const immediate = getEquationRender(key);
    if (immediate) {
      patchEquationFromRender(shape.id, latex, immediate);
      return;
    }
    void pending.then((render) => {
      if (version === inputVersion.current) {
        patchEquationFromRender(shape.id, latex, render);
      }
    });
  };

  // Swatches always include the active color, so a value from another palette
  // or theme still reads as selected (mirrors the style panel).
  const colors = paletteColors(paletteId, theme);
  const swatches = colors.some((c) => c.value === shape.props.color)
    ? colors
    : [...colors, { name: 'Current color', value: shape.props.color }];
  const swatchRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const applyColor = (color: string) => {
    setStyleColor(color);
    editor.updateShape(shape.id, { props: { color } });
  };

  const moveSwatchFocus = (from: number, delta: number) => {
    const next = (from + delta + swatches.length) % swatches.length;
    const swatch = swatches[next];
    if (!swatch) return;
    applyColor(swatch.value);
    swatchRefs.current[next]?.focus();
  };

  // Font size scales the cached render, so the box scales with it.
  const applyFontSize = (fontSize: number) => {
    const scale = fontSize / shape.props.fontSize;
    const w = shape.props.w * scale;
    const h = shape.props.h * scale;
    editor.updateShape(shape.id, {
      ...centeredMove(shape, w, h),
      props: { fontSize, w, h },
    });
  };

  const toggleKeyboard = () => {
    const keyboard = window.mathVirtualKeyboard;
    const next = !keyboard.visible;
    if (next) {
      fieldRef.current?.focus();
      keyboard.show({ animate: true });
    } else {
      keyboard.hide({ animate: true });
    }
    setKeyboardOpen(next);
  };

  // Escape hands the keyboard back to the canvas, where Delete, nudge and tool
  // hotkeys work again.
  const releaseFocus = () => {
    fieldRef.current?.blur();
    window.mathVirtualKeyboard.hide({ animate: true });
  };

  return (
    <Surface
      role="region"
      aria-label="Equation controls"
      className="touch-targets flex max-h-[calc(100dvh-9rem-env(safe-area-inset-top))] w-[min(20rem,calc(100vw-2rem))] flex-col gap-4 overflow-y-auto p-4 sm:max-h-[calc(100dvh-6.25rem-env(safe-area-inset-top))]"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-content-emphasis">
            Equation
          </div>
          <div className="text-xs text-content-subtle">
            {loadError
              ? 'Renderer unavailable'
              : ready
                ? 'Type LaTeX, e.g. \\frac{a}{b}'
                : 'Preparing renderer…'}
          </div>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="Math keyboard"
          aria-pressed={keyboardOpen}
          title="Math keyboard"
          onClick={toggleKeyboard}
          className={cn('shrink-0', keyboardOpen && 'bg-bg-muted')}
        >
          <Keyboard aria-hidden="true" />
        </Button>
      </div>

      <FieldGroup className="gap-2">
        <Field data-invalid={error ? true : undefined}>
          <FieldLabel htmlFor={`equation-${shape.id}`}>Formula</FieldLabel>
          <div
            className={cn(
              'rounded-md border border-border-subtle bg-bg-muted px-1 py-2 transition-[background-color,border-color,box-shadow] duration-150',
              'focus-within:border-border-emphasis focus-within:ring-2 focus-within:ring-border-emphasis',
              'group-data-[invalid]/field:border-content-error group-data-[invalid]/field:ring-2 group-data-[invalid]/field:ring-content-error/20',
            )}
          >
            <MathField
              id={`equation-${shape.id}`}
              // Matches the visible label: a mismatch breaks voice control.
              aria-label="Formula"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? errorId : undefined}
              className="w-full"
              value={shape.props.latex}
              format="latex"
              virtualKeyboardPolicy="manual"
              placeholder="Type an equation…"
              elementRef={(element) => {
                fieldRef.current = element;
              }}
              onChange={updateLatex}
              onEscape={releaseFocus}
            />
          </div>
          {error ? (
            <FieldError id={errorId} role="status">
              {error}
            </FieldError>
          ) : null}
        </Field>
      </FieldGroup>

      <div className="flex flex-col gap-1.5">
        <PanelLabel>Size</PanelLabel>
        <ToggleGroup
          aria-label="Equation size"
          value={[String(shape.props.fontSize)]}
          onValueChange={(values) =>
            values[0] && applyFontSize(Number(values[0]))
          }
        >
          {FONT_SIZES.map((size) => (
            <ToggleGroupItem key={size.value} value={String(size.value)}>
              {size.name}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </div>

      <div className="flex flex-col gap-1.5">
        <PanelLabel>Color</PanelLabel>
        <div
          role="radiogroup"
          aria-label="Equation color"
          className="grid grid-cols-4 gap-1"
        >
          {swatches.map((swatch, index) => {
            const active = shape.props.color === swatch.value;
            return (
              <button
                key={swatch.value}
                ref={(node) => {
                  swatchRefs.current[index] = node;
                }}
                type="button"
                role="radio"
                aria-label={swatch.name}
                aria-checked={active}
                tabIndex={active ? 0 : -1}
                title={swatch.name}
                onClick={() => applyColor(swatch.value)}
                onKeyDown={(event) => {
                  const delta =
                    event.key === 'ArrowRight' || event.key === 'ArrowDown'
                      ? 1
                      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
                        ? -1
                        : 0;
                  if (!delta) return;
                  event.preventDefault();
                  moveSwatchFocus(index, delta);
                }}
                className="flex size-8 items-center justify-center rounded-md transition-colors hover:bg-bg-muted"
              >
                <span
                  className={cn(
                    'size-4 rounded-full border',
                    active &&
                      'ring-2 ring-content-emphasis ring-offset-2 ring-offset-bg-default',
                  )}
                  style={{
                    background: swatch.value,
                    borderColor: swatchBorder(swatch.value),
                  }}
                />
              </button>
            );
          })}
        </div>
      </div>
    </Surface>
  );
}

export function EquationPanel() {
  const selectedIds = useSelectionStore((state) => state.selectedIds);
  const selectedId = selectedIds.length === 1 ? selectedIds[0] : null;
  // Subscribe to the one selected shape, not the whole page record — see the
  // same note in graph-panel.tsx.
  const selectedShape = useDocumentStore((state) =>
    selectedId
      ? state.doc.pages[state.currentPageId]?.shapes[selectedId]
      : undefined,
  );
  const playbackActive = useAnimationStore((state) => state.playbackActive);
  const equationShape =
    selectedShape?.type === 'equation' ? selectedShape : undefined;
  const panelVisible = !playbackActive && Boolean(equationShape);

  // An equation left empty is editing scaffolding, not content: drop it when
  // the selection moves on, rather than stranding a placeholder box on the
  // board (and in exports).
  const lastEditedId = useRef<string | null>(null);
  useEffect(() => {
    if (playbackActive) return;
    const previous = lastEditedId.current;
    lastEditedId.current = equationShape?.id ?? null;
    if (!previous || previous === equationShape?.id) return;
    const stale = editor.getShape(previous);
    if (stale?.type === 'equation' && !stale.props.latex.trim()) {
      editor.deleteShapes([previous]);
    }
  }, [equationShape?.id, playbackActive]);

  return (
    <ToolPanelPresence visible={panelVisible}>
      {panelVisible && equationShape ? (
        <EquationPanelContent shape={equationShape} />
      ) : null}
    </ToolPanelPresence>
  );
}
