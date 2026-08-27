import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import '@/canvas/tools/register';
import { useToolStore } from '@/canvas/use-tool-store';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
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
} from './toolbar-constants';
import { InsertMenu } from './toolbar-insert-menu';
import { ToolLockButton } from './toolbar-lock-button';
import { ShapeMenu } from './toolbar-shape-menu';
import { ToolButton } from './toolbar-tool-button';

export function Toolbar() {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const [hidden, setHidden] = useState(false);
  const [lastShapeId, setLastShapeId] = useState('rectangle');
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

  const renderGroup = (label: string, tools: readonly string[]) => (
    <div role="group" aria-label={label} className="flex items-center gap-1">
      {tools.map((id) => (
        <ToolButton key={id} toolId={id} />
      ))}
    </div>
  );

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
            'relative flex w-max max-w-[calc(100vw-1rem)] items-center rounded-xl',
            'border-border bg-surface/92 p-1.5 tb-shell',
            'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
            'motion-reduce:transition-none',
            hidden &&
              'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0',
          )}
        >
          <div className="hidden items-center gap-2.5 sm:flex">
            {renderGroup('Navigate', NAVIGATE_TOOLS)}

            {renderGroup('Inking', INKING_TOOLS)}

            <div
              role="group"
              aria-label="Creation"
              className="flex items-center gap-1"
            >
              <ToolButton toolId="text" />
              <ShapeMenu
                activeToolId={activeToolId}
                lastShapeId={lastShapeId}
                onLastShapeChange={setLastShapeId}
              />
              <ToolButton toolId="comment" />
            </div>

            {renderGroup('Math and STEM', STEM_TOOLS)}

            <div
              role="group"
              aria-label="Media and Stickers"
              className="flex items-center gap-1"
            >
              <InsertMenu active={activeToolId === 'sticker'} />
            </div>

            <div
              role="group"
              aria-label="Utilities"
              className="flex items-center gap-1"
            >
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
                  <ChevronDown className="size-4.5" />
                </TooltipTrigger>
                <TooltipContent side="top">Hide toolbar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div
            role="group"
            aria-label="Compact canvas tools"
            className="flex items-center gap-2.5 sm:hidden"
          >
            <div className="flex items-center gap-1">
              {COMPACT_PRIMARY_TOOLS.map((id) => (
                <ToolButton key={id} toolId={id} />
              ))}
            </div>
            <ShapeMenu
              activeToolId={activeToolId}
              lastShapeId={lastShapeId}
              onLastShapeChange={setLastShapeId}
            />
            <CompactMoreMenu activeToolId={activeToolId} onHide={hideToolbar} />
          </div>
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
                  'absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-lg px-3 py-1.5',
                  // Same relief as the bar, but a pill this small sits closer
                  // to the canvas than the bar does, so it takes the panel
                  // shadow instead of the bar's wider ambient one.
                  'border-border bg-surface/92 tb-shell [--s-toolbar:var(--s-panel)] hover:bg-panel',
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
