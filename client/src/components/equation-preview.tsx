import { useEffect, useRef, useState } from 'react';
import { Check, Copy, PenLine, Plus } from 'lucide-react';
import type { EquationShape } from '@whiteboard/shared';
import type { EquationRender } from '@/canvas/equation-render';
import { wrapMathLatex } from '@/canvas/equation-source';
import { setPeeking, useConversionStore } from '@/canvas/use-conversion-store';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export type TypesetRender = Extract<EquationRender, { svg: string }>;

/**
 * The tallest the preview draws a formula, in pixels. A `\sum` with limits or
 * a pmatrix is several lines tall at the base size; past this it is scaled
 * down to fit rather than allowed to push the source field off the panel.
 */
const PREVIEW_MAX_H = 96;

/**
 * Whether the element `resolve` finds is scrolling content its box can't show,
 * re-measured when `key` changes and whenever the box is resized.
 *
 * Measured rather than guessed: a content heuristic ("this many characters")
 * misses `\int_{-\infty}^{\infty} e^{-x^2}\,dx`, which runs past the preview
 * in about thirty, and fires on long expressions that happen to fit.
 */
function useOverflowing(resolve: () => Element | null, key: unknown): boolean {
  const [overflowing, setOverflowing] = useState(false);
  const resolveRef = useRef(resolve);
  resolveRef.current = resolve;

  useEffect(() => {
    const element = resolveRef.current();
    if (!element) {
      setOverflowing(false);
      return;
    }
    const measure = () => {
      setOverflowing(element.scrollWidth - element.clientWidth > 1);
    };
    // MathJax lays out after the value lands, so the first read waits a frame
    // rather than measuring a box that is still empty.
    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
    // `resolve` is read through a ref so a fresh closure each render doesn't
    // tear the observer down and rebuild it on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return overflowing;
}

/**
 * The box the preview draws the formula in, from the size the renderer
 * measured — scaled down as one piece when the formula is taller than the
 * preview allows, so it shrinks rather than clips.
 */
function previewBox(render: TypesetRender): { width: number; height: number } {
  const scale = Math.min(1, PREVIEW_MAX_H / render.height);
  return { width: render.width * scale, height: render.height * scale };
}

/**
 * The equation itself leads the panel, on the dimmed ground of the content
 * rather than the controls. The two actions that are about the equation as a
 * whole sit in its corner instead of a title bar.
 */
export function EquationPreview({
  shape,
  currentKey,
  render,
  stale,
  ready,
  loadError,
  onAddBelow,
}: {
  shape: EquationShape;
  /** The trimmed source; empty means there is nothing to preview. */
  currentKey: string;
  /** The current render, or the last good one while the source is broken. */
  render: TypesetRender | null;
  /** `render` is the last good one, not the current source's. */
  stale: boolean;
  ready: boolean;
  loadError: string | null;
  onAddBelow: () => void;
}) {
  const inline = shape.props.inline ?? false;
  const previewRef = useRef<HTMLDivElement | null>(null);
  const copiedTimer = useRef<number | null>(null);
  const [copied, setCopied] = useState(false);
  const overflowing = useOverflowing(() => previewRef.current, currentKey);
  // Present only for an equation that replaced handwriting this session.
  const hasOriginal = useConversionStore(
    (s) => s.original?.equationId === shape.id,
  );
  const peeking = useConversionStore((s) => s.peeking);
  // The control can unmount mid-hold (selection moves on): never leave the
  // handwriting stuck over the board.
  useEffect(() => () => setPeeking(false), []);

  useEffect(
    () => () => {
      if (copiedTimer.current !== null) {
        window.clearTimeout(copiedTimer.current);
      }
    },
    [],
  );

  const copyLatex = async (bodyOnly: boolean) => {
    const text = bodyOnly
      ? shape.props.latex
      : wrapMathLatex(shape.props.latex, inline);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(true);
    if (copiedTimer.current !== null) window.clearTimeout(copiedTimer.current);
    copiedTimer.current = window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    <section
      aria-label="Preview"
      className="relative shrink-0 border-b border-border bg-panel"
    >
      <div className="absolute top-1 right-1 z-10 flex gap-0.5">
          {hasOriginal ? (
            <Tooltip>
              <TooltipTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label="Compare with handwriting"
                    aria-pressed={peeking}
                    // Held, not toggled: letting go is the way back, so it can
                    // never be left on by accident. Pointer capture keeps the
                    // hold alive if the cursor drifts off the key.
                    onPointerDown={(event) => {
                      event.currentTarget.setPointerCapture(event.pointerId);
                      setPeeking(true);
                    }}
                    onPointerUp={() => setPeeking(false)}
                    onPointerCancel={() => setPeeking(false)}
                    onKeyDown={(event) => {
                      if (event.key === ' ' || event.key === 'Enter') {
                        event.preventDefault();
                        setPeeking(true);
                      }
                    }}
                    onKeyUp={() => setPeeking(false)}
                    onBlur={() => setPeeking(false)}
                    className="aria-pressed:bg-tb-track"
                  />
                }
              >
                <PenLine className="size-4" aria-hidden="true" />
              </TooltipTrigger>
              <TooltipContent side="top">Hold to compare with handwriting</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Add equation below"
                  disabled={!currentKey}
                  onClick={onAddBelow}
                  className="disabled:opacity-40"
                />
              }
            >
              <Plus className="size-4" aria-hidden="true" />
            </TooltipTrigger>
            <TooltipContent side="top">
              Add equation below (⌘/Ctrl + Enter)
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={copied ? 'LaTeX copied' : 'Copy LaTeX'}
                  disabled={!currentKey}
                  onClick={(event) => void copyLatex(event.altKey)}
                  className="disabled:opacity-40"
                />
              }
            >
              {copied ? (
                <Check className="size-4 text-success" aria-hidden="true" />
              ) : (
                <Copy className="size-4" aria-hidden="true" />
              )}
            </TooltipTrigger>
            <TooltipContent side="top">
              Copy as {inline ? 'inline' : 'display'} math (Alt: body only)
            </TooltipContent>
          </Tooltip>
      </div>
      <div
        ref={previewRef}
        data-overflow={overflowing ? true : undefined}
        aria-busy={stale || undefined}
        className="equation-fade-end equation-preview-box scrollbar-none flex min-h-24 items-center justify-center overflow-x-auto px-10 py-4 text-center"
      >
        {!ready && !loadError ? (
          <span role="status" className="text-xs text-fg-muted">
            Preparing renderer — what you type is saved.
          </span>
        ) : !currentKey ? (
          <span role="status" className="text-xs text-fg-muted">
            Start typing to preview the equation.
          </span>
        ) : render ? (
          <div
            role="img"
            aria-label={`Preview of equation: ${currentKey}`}
            className={cn('equation-output-preview', stale && 'opacity-60')}
            style={{
              color: shape.props.color,
              ...previewBox(render),
            }}
            dangerouslySetInnerHTML={{ __html: render.svg }}
          />
        ) : (
          <span role="status" className="text-xs text-fg-muted">
            Rendering…
          </span>
        )}
      </div>
    </section>
  );
}
