import { useEffect, useRef, useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import '@/canvas/tools/register';
import { useToolStore } from '@/canvas/use-tool-store';
import { Button } from '@/components/ui/button';
import { HOVER_REVEAL, Surface } from '@/components/ui/surface';
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
  chromeButtonClass,
  COMPACT_PRIMARY_TOOLS,
  INKING_TOOLS,
  NAVIGATE_TOOLS,
  SHAPE_TOOLS,
  STEM_TOOLS,
  TOOL_GROUP,
} from './toolbar-constants';
import { InsertMenu } from './toolbar-insert-menu';
import { InstrumentTray } from './toolbar-instruments';
import { ToolLockButton } from './toolbar-lock-button';
import { ShapeMenu } from './toolbar-shape-menu';
import { ToolButton } from './toolbar-tool-button';

/**
 * The canvas toolbar: one soft pill floating over the board, with the inking
 * tools lying in it as drawn instruments and everything else as glyph keys
 * either side of them.
 *
 * The bar is built the way the call panel is: the content is the thing you
 * see, and the chrome around it takes up as little as it can get away with.
 *
 *   · No card, and nothing casting the shape of one. The bar has no fill, no
 *     border and no shadow of its own; what separates a control from the
 *     drawing under it is a halo on the glyph itself (`tb-glyph`), the way a
 *     player's controls are burned into the picture rather than laid on a
 *     panel over it.
 *   · No recesses either. The three groups used to stand in grooves and the
 *     instruments in a fourth; all four are gone, and the space between the
 *     groups does the grouping. The instruments still break out of the row at
 *     both ends — tip above it and out over the canvas, handle fading out
 *     below — but they lie on the board now rather than in a tray.
 *   · The bar's own controls fade out. Lock and hide act on the bar rather
 *     than on the board, and at rest they are not there at all; they arrive
 *     on hover, on focus, and permanently on touch. Nothing is hidden that
 *     the pointer has not already reached.
 *   · What is left that can be filled: a wash under a hovered key, and one
 *     solid chip on the key being held. Menus stay opaque — a flyout over ink
 *     is unreadable — so the rule is that controls are transparent and the
 *     things they open are not.
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
            'group/chrome relative flex w-max max-w-[calc(100vw-1rem)] items-center rounded-full',
            // No card. Not a translucent one either — the bar is the controls
            // and nothing else, the way a player's controls are the controls
            // and not a panel laid over the picture. What used to be the
            // slab's job is done twice over: each glyph carries its own halo,
            // and the one filled key is solid enough to read on any board.
            //
            // `shadow-none` explicitly: `Surface mode="floating"` brings a
            // panel shadow, and a shadow cast by a box with nothing in it
            // draws the outline of the card that was just removed.
            'border-transparent bg-transparent p-1 shadow-none',
            'origin-bottom transition-[opacity,transform] duration-base ease-out-quart',
            'motion-reduce:transition-none',
            hidden &&
              'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0',
          )}
        >
          {/* Space is the grouping: 2px between keys in a group, 18px across
              one, with no box anywhere on the bar to say it twice. */}
          <div className="hidden items-stretch gap-2.5 sm:flex">
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

            {/* The bar's own two controls, and the only things here that act
                on the bar rather than on the board. They are not drawn at all
                until the pointer is on the bar — by which time it has already
                arrived at them — so at rest the bar is nothing but tools. */}
            <div
              className={cn(
                'ms-0.5 flex items-center gap-0.5 self-center',
                HOVER_REVEAL,
              )}
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
                      className={chromeButtonClass()}
                    />
                  }
                >
                  {/* Drawn under tool weight, on a full-size target. It is a
                      handle on the bar, not a thing on the board, and the one
                      key here that is neither should not be the same size as
                      an icon that is. */}
                  <ChevronDown className="size-3.5" />
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
                  // The one control here that has to be found on an empty
                  // board rather than recognised, so it keeps a wash under it
                  // — the same wash a hovered key gets, no card. `tb-glyph`
                  // for the chevron, and `tb-shell` only to strip the shadow
                  // `Button variant="outline"` would otherwise bring.
                  'tb-glyph border-transparent bg-tb-track tb-shell hover:bg-surface dark:border-transparent',
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
