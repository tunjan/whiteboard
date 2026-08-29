import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import '@/canvas/tools/register';
import { useToolStore } from '@/canvas/use-tool-store';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import { ToolPropertiesSatellite } from '@/components/tool-properties-satellite';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
import { cn } from '@/lib/utils';
import { CompactMoreMenu } from './toolbar-compact-menu';
import {
  COMPACT_PRIMARY_TOOLS,
  INKING_TOOLS,
  NAVIGATE_TOOLS,
  SHAPE_TOOLS,
  STEM_TOOLS,
  toolButtonClass,
  TOOL_GROUP,
  TOOL_ICON,
} from './toolbar-constants';
import { InsertMenu } from './toolbar-insert-menu';
import { InstrumentTray } from './toolbar-instruments';
import { ToolLockButton } from './toolbar-lock-button';
import { ShapeMenu } from './toolbar-shape-menu';
import { ToolButton } from './toolbar-tool-button';

/**
 * The canvas toolbar: a soft white card floating over the board, with the
 * inking tools lying in it as drawn instruments and everything else as glyph
 * keys either side of them.
 *
 * The bar reads left to right as four things you might reach for, each in a
 * shallow recess of its own with clear board between them:
 *
 *   move the view · pick something up · place something · bar
 *
 * Grouping is by container rather than by rule. A recess is read at a glance
 * and at any bar width; a hairline has to be found first, and on a bar this
 * wide the one in the middle stopped separating anything. Every box on the
 * card is concentric with the one outside it — card 20, recess 16, key 12,
 * off the card's 4px padding — so the corners step down evenly rather than
 * each control rounding to its own taste.
 *
 * The tray is the middle because it is the reason the bar exists, and because
 * an object among glyphs is the one thing on a bar this wide that can be found
 * without reading. The instruments are drawn bigger than their slots and hung
 * so they break out at both ends — tip above the card's top edge and out over
 * the canvas, handle cut off flat behind the tray's front lip. Nothing else on
 * the bar leaves its recess, which is what makes the tray the thing the eye
 * lands on.
 *
 * The active tool's quick properties ride above the bar in their own pill; see
 * `ToolPropertiesSatellite`.
 */
export function Toolbar() {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const [hidden, setHidden] = useState(false);
  const [lastShapeId, setLastShapeId] = useState('');
  const showButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbar = useRovingToolbar<HTMLDivElement>();

  useEffect(() => {
    if (SHAPE_TOOLS.includes(activeToolId as (typeof SHAPE_TOOLS)[number])) {
      setLastShapeId(activeToolId);
    }
  }, [activeToolId]);

  const hideToolbar = () => {
    setHidden(true);
    requestAnimationFrame(() => showButtonRef.current?.focus());
  };

  const showToolbar = () => {
    setHidden(false);
    requestAnimationFrame(() => {
      const visibleItems = [
        ...(toolbar.ref.current?.querySelectorAll<HTMLElement>(
          '[data-toolbar-item]',
        ) ?? []),
      ].filter((item) => item.getClientRects().length > 0);
      const active = visibleItems.find(
        (item) =>
          item.getAttribute('aria-pressed') === 'true' ||
          item.getAttribute('aria-current') === 'true',
      );
      (active ?? visibleItems[0])?.focus();
    });
  };

  return (
    <TooltipProvider delay={250}>
      <div className="absolute bottom-[calc(0.75rem+env(safe-area-inset-bottom))] left-1/2 z-[var(--z-ui)] -translate-x-1/2">
        <Surface
          ref={toolbar.ref}
          mode="floating"
          chrome
          role="toolbar"
          aria-label="Canvas tools"
          aria-orientation="horizontal"
          aria-hidden={hidden}
          inert={hidden}
          onKeyDown={toolbar.onKeyDown}
          onFocusCapture={toolbar.onFocusCapture}
          className={cn(
            'relative flex w-max max-w-[calc(100vw-1rem)] items-center rounded-toolbar',
            // Opaque, and unbordered on the light canvas. A rule around a card
            // this pale only competes with its own shadow; on the dark canvas
            // the shadow has nothing to fall on, so the border comes back to
            // do the separating instead.
            'border-transparent bg-surface p-1 tb-shell dark:border-border',
            'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
            'motion-reduce:transition-none',
            hidden &&
              'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0',
          )}
        >
          <div className="hidden items-stretch gap-1.5 sm:flex">
            <div role="group" aria-label="Navigate" className={TOOL_GROUP}>
              {NAVIGATE_TOOLS.map((id) => (
                <ToolButton key={id} toolId={id} />
              ))}
            </div>

            {/* The shapes stand in the tray with the pens rather than beside
                it as a glyph: both are things you pick up, and splitting them
                across two idioms made the bar read as three groups here
                instead of one. */}
            <InstrumentTray tools={INKING_TOOLS}>
              <ShapeMenu
                variant="tray"
                activeToolId={activeToolId}
                lastShapeId={lastShapeId}
                onLastShapeChange={setLastShapeId}
              />
            </InstrumentTray>

            <div role="group" aria-label="Place" className={TOOL_GROUP}>
              <ToolButton toolId="text" />
              {STEM_TOOLS.map((id) => (
                <ToolButton key={id} toolId={id} />
              ))}
              <ToolButton toolId="comment" />
              <InsertMenu active={activeToolId === 'sticker'} />
            </div>

            <div role="group" aria-label="Utilities" className={TOOL_GROUP}>
              <ToolLockButton />
              <Tooltip>
                <TooltipTrigger
                  render={
                    <Button
                      data-toolbar-item
                      variant="ghost"
                      size="icon-md"
                      tabIndex={-1}
                      aria-label="Hide toolbar"
                      onClick={hideToolbar}
                      className={toolButtonClass(false)}
                    />
                  }
                >
                  <ChevronDown className={TOOL_ICON} />
                </TooltipTrigger>
                <TooltipContent side="top">Hide toolbar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div
            role="group"
            aria-label="Compact canvas tools"
            className={cn(TOOL_GROUP, 'sm:hidden')}
          >
            {COMPACT_PRIMARY_TOOLS.map((id) => (
              <ToolButton key={id} toolId={id} />
            ))}
            <ShapeMenu
              activeToolId={activeToolId}
              lastShapeId={lastShapeId}
              onLastShapeChange={setLastShapeId}
            />
            <CompactMoreMenu activeToolId={activeToolId} onHide={hideToolbar} />
          </div>

          <ToolPropertiesSatellite activeToolId={activeToolId} />
        </Surface>

        <Tooltip>
          <TooltipTrigger
            ref={showButtonRef}
            render={
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={showToolbar}
                aria-label="Show toolbar"
                aria-hidden={!hidden}
                tabIndex={hidden ? 0 : -1}
                className={cn(
                  'absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-full px-3.5 py-2',
                  // Same slab as the bar, and `tb-shell` for the same reason:
                  // it is what strips the shadow `Button variant="outline"`
                  // would otherwise bring.
                  'border-transparent bg-surface tb-shell hover:bg-panel dark:border-border',
                  'transition-[opacity,transform] duration-base ease-out-quart motion-reduce:transition-none',
                  hidden
                    ? 'translate-y-0 opacity-100'
                    : 'pointer-events-none translate-y-2 opacity-0',
                )}
              />
            }
          >
            <ChevronUp className="size-3.5 text-fg-muted" />
            <span className="text-xs font-medium text-fg-secondary">Tools</span>
          </TooltipTrigger>
          <TooltipContent side="top">Show toolbar</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
