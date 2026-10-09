import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronUpGlyph, ImageGlyph } from '@/components/ui/glyphs';
import '@/canvas/tools/register';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { useToolStore } from '@/canvas/use-tool-store';
import { Button } from '@/components/ui/button';
import { ToolPropertiesSatellite } from '@/components/tool-properties-satellite';
import {
  Toolbar as ToolbarRoot,
  ToolbarGroup,
} from '@/components/ui/toolbar';
import { TooltipProvider } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { CompactMoreMenu } from './toolbar-compact-menu';
import {
  INKING_TOOLS,
  NAVIGATE_TOOLS,
  SHAPE_TOOLS,
} from './toolbar-constants';
import { ShapeMenu } from './toolbar-shape-menu';
import { ToolButton, ToolKey } from './toolbar-tool-button';

/**
 * The width at which the full row stops crowding the viewport. With a mouse the
 * corner HUDs share the bar's row, so that is the bar plus both corners. A
 * touch screen lifts the corners above it (see `CanvasControls`), so the bar
 * only has to fit itself — ~540px at touch key size — which every iPad does
 * in portrait.
 */
const WIDE_QUERY =
  '(min-width: 1060px), (pointer: coarse) and (min-width: 600px)';

function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}

/**
 * One layout is mounted at a time, not two toggled in CSS: the toolbar's
 * arrow-key navigation walks every registered button, hidden or not.
 */
function useWide() {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE_QUERY).matches,
    () => true,
  );
}

/**
 * The canvas toolbar.
 *
 * The bar holds one kind of thing: what the pointer does next. Every key on it
 * is a mode, so exactly one is pressed. One-shot commands live elsewhere: undo
 * and redo in their own corner instrument, everything else behind More.
 *
 * Keys are grouped by what they make — move around, mark freehand, place an
 * object, more — with a rule between groups. Built on the Base UI toolbar, so
 * the bar is one tab stop and arrow keys, Home and End move within it.
 *
 * Narrow viewports keep one key from each group in the same order and
 * overflow the rest. The active tool's properties float on their own plate
 * above the bar.
 */
export function Toolbar() {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const wide = useWide();
  const [hidden, setHidden] = useState(false);
  const [lastShapeId, setLastShapeId] = useState('');
  const showButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

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
      const keys = toolbarRef.current?.querySelectorAll<HTMLElement>(
        '[data-slot="toolbar-button"]',
      );
      const pressed = [...(keys ?? [])].find(
        (key) => key.getAttribute('aria-pressed') === 'true',
      );
      (pressed ?? keys?.[0])?.focus();
    });
  };

  // Base UI's toolbar moves by arrow keys only; Home and End are ours.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Home' && event.key !== 'End') return;
    const keys = event.currentTarget.querySelectorAll<HTMLElement>(
      '[data-slot="toolbar-button"]',
    );
    const target = event.key === 'Home' ? keys[0] : keys[keys.length - 1];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  const shapeMenu = (
    <ShapeMenu
      activeToolId={activeToolId}
      lastShapeId={lastShapeId}
      onLastShapeChange={setLastShapeId}
    />
  );

  return (
    <TooltipProvider delay={250}>
      {/* Bar menus portal below this layer, so the style plate steps aside
          while one of them is open rather than covering it. */}
      <div
        data-arrive="up"
        style={{ '--arrive-i': 2 } as React.CSSProperties}
        className="absolute bottom-[calc(0.75rem+var(--wb-inset-bottom))] left-1/2 z-[var(--z-ui)] -translate-x-1/2 [&:has([role=toolbar]_[aria-expanded=true])_.tbar-style]:invisible"
      >
        <ToolbarRoot
          ref={toolbarRef}
          aria-label="Canvas tools"
          aria-hidden={hidden}
          inert={hidden}
          onKeyDown={onKeyDown}
          className={cn(
            'max-w-[calc(100vw-1rem)] origin-bottom transition-[opacity,translate] duration-base ease-out-quart motion-reduce:transition-none',
            hidden && 'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0',
          )}
        >
          <ToolbarGroup className="gap-1" aria-label="Navigate">
            {wide ? (
              NAVIGATE_TOOLS.map((id) => <ToolButton key={id} toolId={id} />)
            ) : (
              <ToolButton toolId="select" />
            )}
          </ToolbarGroup>
          <ToolbarGroup className="gap-1" aria-label="Draw">
            {wide ? (
              INKING_TOOLS.map((id) => <ToolButton key={id} toolId={id} />)
            ) : (
              <>
                <ToolButton toolId="draw" />
                <ToolButton toolId="eraser" />
              </>
            )}
          </ToolbarGroup>
          {/* Shapes sit with the objects, not with the ink: a rectangle is a
              thing you place and then move, like text or an image. */}
          <ToolbarGroup className="gap-1" aria-label="Insert">
            {shapeMenu}
            <ToolButton toolId="text" />
            {wide && (
              <>
                <ToolKey label="Add image" onClick={() => void pickAndPlaceImages()}>
                  <ImageGlyph />
                </ToolKey>
                <ToolButton toolId="comment" />
              </>
            )}
          </ToolbarGroup>
          <ToolbarGroup className="gap-1" aria-label="More">
            <CompactMoreMenu
              activeToolId={activeToolId}
              onHide={hideToolbar}
              expanded={wide}
            />
          </ToolbarGroup>
        </ToolbarRoot>

        {/* The tool's own properties, as a second plate stacked over the bar
            rather than as an extension of it. */}
        {!hidden && <ToolPropertiesSatellite activeToolId={activeToolId} />}

        <Button
          ref={showButtonRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={showToolbar}
          aria-hidden={!hidden}
          tabIndex={hidden ? 0 : -1}
          className={cn(
            'absolute bottom-0 left-1/2 -translate-x-1/2 rounded-toolbar shadow-toolbar [@media(pointer:coarse)]:min-h-11',
            'transition-[opacity,translate] duration-base ease-out-quart motion-reduce:transition-none',
            hidden ? 'translate-y-0 opacity-100' : 'pointer-events-none translate-y-2 opacity-0',
          )}
        >
          <ChevronUpGlyph className="text-fg-muted" />
          Show toolbar
        </Button>
      </div>
    </TooltipProvider>
  );
}
