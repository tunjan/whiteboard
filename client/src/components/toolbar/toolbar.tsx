import { useEffect, useRef, useState } from 'react';
import { ChevronDownGlyph, ChevronUpGlyph } from '@/components/ui/glyphs';
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
  hueVars,
  COMPACT_PRIMARY_TOOLS,
  INKING_TOOLS,
  NAVIGATE_TOOLS,
  SHAPE_TOOLS,
  STEM_TOOLS,
  toolKeyClass,
  TOOL_GROUP,
} from './toolbar-constants';
import { InsertMenu } from './toolbar-insert-menu';
import { InstrumentTray } from './toolbar-instruments';
import { ToolLockButton } from './toolbar-lock-button';
import { ToolbarPlate } from './toolbar-plate';
import { ShapeMenu } from './toolbar-shape-menu';
import { ToolButton } from './toolbar-tool-button';

/** Canvas controls on a plain floating bar. */
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
      <div className="absolute bottom-[calc(0.75rem+var(--wb-inset-bottom))] left-1/2 z-[var(--z-ui)] -translate-x-1/2">
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
            'group/chrome relative flex w-max max-w-[calc(100vw-1rem)] items-center',
            'toolbar-reference border-0 bg-transparent shadow-none px-2 py-1',
            'origin-bottom transition-[opacity,transform] duration-slow ease-out-quart',
            'motion-reduce:transition-none',
            hidden &&
              'pointer-events-none translate-y-[calc(100%+0.75rem)] scale-[0.96] opacity-0',
          )}
        >
          <ToolbarPlate />
          <div className="toolbar-desktop relative z-10 items-stretch gap-1">
            <div role="group" aria-label="Navigate" className={TOOL_GROUP}>
              {NAVIGATE_TOOLS.map((id) => (
                <ToolButton key={id} toolId={id} />
              ))}
            </div>
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
            <div className="ms-0.5 flex items-center gap-0.5 self-center">
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
                      style={hueVars()}
                      className={toolKeyClass()}
                    />
                  }
                >
                  <ChevronDownGlyph className="size-3.5" />
                </TooltipTrigger>
                <TooltipContent side="top">Hide toolbar</TooltipContent>
              </Tooltip>
            </div>
          </div>

          <div
            role="group"
            aria-label="Compact canvas tools"
            className={cn(TOOL_GROUP, 'toolbar-compact relative z-10')}
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
        </Surface>
        {!hidden && <ToolPropertiesSatellite activeToolId={activeToolId} />}

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
                  'absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-1.5 px-3.5 py-2',
                  'toolbar-bar rounded-full',
                  'transition-[opacity,transform] duration-slow ease-out-quart motion-reduce:transition-none',
                  hidden
                    ? 'translate-y-0 scale-100 opacity-100'
                    : 'pointer-events-none translate-y-2 scale-95 opacity-0',
                )}
              />
            }
          >
            <ChevronUpGlyph className="size-3.5 text-fg-muted" />
            <span className="text-xs font-medium text-fg-secondary">Tools</span>
          </TooltipTrigger>
          <TooltipContent side="top">Show toolbar</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
