import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { ChevronUpGlyph } from '@/components/ui/glyphs';
import '@/canvas/tools/register';
import { useHistoryStep, useUndoStore } from '@/canvas/page-history';
import { pickAndPlaceImages } from '@/canvas/place-image';
import { isDarwin } from '@/canvas/platform';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { redo, undo } from '@/canvas/use-document-store';
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
import { INKING_TOOLS, NAVIGATE_TOOLS } from './toolbar-constants';
import { ToolbarSideContext } from './toolbar-primitives';
import { ShapeMenu } from './toolbar-shape-menu';
import {
  ToolButton,
  ToolKey,
  toolArt,
  useLastHeld,
} from './toolbar-tool-button';

/**
 * The width at which the full row stops crowding the viewport. With a mouse the
 * corner HUDs share the bar's row, so that is the bar plus both corners. A
 * touch screen lifts the corners above it (see `CanvasControls`), so the bar
 * only has to fit itself — ~540px at touch key size — which every iPad does
 * in portrait.
 */
const WIDE_QUERY =
  '(min-width: 1060px), (pointer: coarse) and (min-width: 600px)';

/**
 * The same question for the left rail, which spends height instead: the full
 * rail plus the two left corner instruments it has to clear.
 */
const TALL_QUERY = '(min-height: 700px)';

/** Undo and redo's chords, as the platform writes them. */
const MAC = isDarwin();
const UNDO_KEYS = MAC ? '⌘Z' : 'Ctrl+Z';
const REDO_KEYS = MAC ? '⇧⌘Z' : 'Ctrl+Shift+Z';

/** Room for all twelve colours on the style bar rather than eight and a key. */
const FULL_PALETTE_QUERY = '(min-width: 1060px)';

/**
 * One layout is mounted at a time, not two toggled in CSS: the toolbar's
 * arrow-key navigation walks every registered button, hidden or not.
 */
function useMediaQuery(query: string) {
  return useSyncExternalStore(
    (onChange) => {
      const list = window.matchMedia(query);
      list.addEventListener('change', onChange);
      return () => list.removeEventListener('change', onChange);
    },
    () => window.matchMedia(query).matches,
    () => true,
  );
}

/** The bar's keys, in arrow-key order. */
function barKeys(root: HTMLElement | null): HTMLElement[] {
  return [
    ...(root?.querySelectorAll<HTMLElement>('[data-slot="toolbar-button"]') ?? []),
  ];
}

/**
 * The canvas toolbar: a drawer of tools.
 *
 * Each slot holds a drawn tool, cut off by the bar's bottom edge, with its
 * hotkey printed above it; the one in hand rises. Modes fill the drawer —
 * move around, mark freehand, place an object — and undo and redo close it
 * at the right end. The three inking tools share one slot, and their tray
 * (with the colours and weights) slides out from behind the bar.
 *
 * It is still one Base UI toolbar, so the bar is one tab stop and arrow keys,
 * Home and End move across every slot.
 *
 * Narrow viewports keep one key from each group in the same order and
 * overflow the rest. Docks along the bottom by default, or as a rail down
 * the left edge (`toolbarPlacement`, switched from the More menu).
 */
export function Toolbar() {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const canUndo = useUndoStore((s) => s.canUndo);
  const canRedo = useUndoStore((s) => s.canRedo);
  const rail = useCanvasUiStore((state) => state.toolbarPlacement) === 'left';
  const wideRow = useMediaQuery(WIDE_QUERY);
  const tallRail = useMediaQuery(TALL_QUERY);
  const wide = rail ? tallRail : wideRow;
  const fullPalette = useMediaQuery(FULL_PALETTE_QUERY);
  const [hidden, setHidden] = useState(false);
  const showButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const inkId = useLastHeld(INKING_TOOLS, activeToolId);
  const stepFromBar = useRef(false);

  // A step taken off the bar — ⌘Z, the two-finger tap — turns its key as a
  // press would, so the undo is seen to land even where nothing on screen
  // visibly changed. The bar's own keys already turn under the press.
  useEffect(
    () =>
      useHistoryStep.subscribe(({ dir }) => {
        if (stepFromBar.current) return;
        if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
        toolbarRef.current
          ?.querySelector(`[aria-label="${dir === 'undo' ? 'Undo' : 'Redo'}"] svg`)
          ?.animate(
            { rotate: ['0deg', dir === 'undo' ? '-24deg' : '24deg', '0deg'] },
            { duration: 360, easing: 'cubic-bezier(0.25, 1, 0.5, 1)' },
          );
      }),
    [],
  );

  const stepOnBar = (step: () => void) => () => {
    stepFromBar.current = true;
    step();
    stepFromBar.current = false;
  };

  const hideToolbar = () => {
    setHidden(true);
    requestAnimationFrame(() => showButtonRef.current?.focus());
  };

  const showToolbar = () => {
    setHidden(false);
    requestAnimationFrame(() => {
      const keys = barKeys(toolbarRef.current);
      const pressed = keys.find((key) => key.getAttribute('aria-pressed') === 'true');
      (pressed ?? keys[0])?.focus();
    });
  };

  // Base UI's toolbar moves by arrow keys only; Home and End are ours.
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Home' && event.key !== 'End') return;
    const keys = barKeys(event.currentTarget);
    const target = event.key === 'Home' ? keys[0] : keys[keys.length - 1];
    if (!target) return;
    event.preventDefault();
    target.focus();
  };

  return (
    <TooltipProvider delay={250}>
      <ToolbarSideContext.Provider value={rail ? 'right' : 'top'}>
      {/* Bar menus portal below this layer, so the style plate steps aside
          while one of them is open rather than covering it. */}
      <div
        data-arrive="up"
        data-placement={rail ? 'left' : 'bottom'}
        style={{ '--arrive-i': 2 } as React.CSSProperties}
        // The browser's own menu has nothing to offer a drawer of tools.
        onContextMenu={(event) => event.preventDefault()}
        className={cn(
          'absolute z-[var(--z-ui)] scale-[var(--drawer-scale)] [&:has([role=toolbar]_[aria-expanded=true])_.tbar-style]:invisible',
          rail
            ? 'top-1/2 left-3 origin-left -translate-y-1/2'
            : 'bottom-[calc(0.75rem+var(--wb-inset-bottom))] left-1/2 origin-bottom -translate-x-1/2',
        )}
      >
        <ToolbarRoot
          ref={toolbarRef}
          aria-label="Canvas tools"
          aria-hidden={hidden}
          inert={hidden}
          orientation={rail ? 'vertical' : 'horizontal'}
          onKeyDown={onKeyDown}
          className={cn(
            // The drawer: the plate, edge and shadow are `.drawer-bar`'s.
            'drawer-bar relative z-[1]',
            'transition-[opacity,translate] duration-base ease-out-quart motion-reduce:transition-none',
            rail
              ? 'max-h-[calc(100vh-1rem)] origin-left'
              : 'max-w-[calc(100vw-1rem)] origin-bottom',
            hidden &&
              (rail
                ? 'pointer-events-none -translate-x-[calc(100%+0.75rem)] opacity-0'
                : 'pointer-events-none translate-y-[calc(100%+0.75rem)] opacity-0'),
          )}
        >
          <ToolbarGroup className="drawer-group" aria-label="Navigate">
            {wide ? (
              NAVIGATE_TOOLS.map((id) => <ToolButton key={id} toolId={id} />)
            ) : (
              <ToolButton toolId="select" />
            )}
          </ToolbarGroup>
          {/* The inking tools share one slot; picking it opens their tray
              above the bar, where the other two are. */}
          <ToolbarGroup className="drawer-group drawer-ink" aria-label="Draw">
            <ToolButton toolId={inkId} />
          </ToolbarGroup>
          {/* Shapes sit with the objects, not with the ink: a rectangle is a
              thing you place and then move, like text or an image. */}
          <ToolbarGroup className="drawer-group" aria-label="Insert">
            <ShapeMenu activeToolId={activeToolId} tray={!rail} />
            {wide && <ToolButton toolId="arrow" />}
            <ToolButton toolId="text" />
            {wide && (
              <>
                <ToolButton toolId="frame" />
                <ToolKey label="Add image" onClick={() => void pickAndPlaceImages()} art>
                  {toolArt('image')}
                </ToolKey>
                <ToolButton toolId="graph" />
                <ToolButton toolId="sticker" />
              </>
            )}
            <CompactMoreMenu
              activeToolId={activeToolId}
              onHide={hideToolbar}
              expanded={wide}
            />
          </ToolbarGroup>
          <ToolbarGroup className="drawer-group drawer-history" aria-label="History">
            <ToolKey label="Undo" shortcut={UNDO_KEYS} disabled={!canUndo} onClick={stepOnBar(undo)}>
              <Undo2 />
            </ToolKey>
            <ToolKey label="Redo" shortcut={REDO_KEYS} disabled={!canRedo} onClick={stepOnBar(redo)}>
              <Redo2 />
            </ToolKey>
          </ToolbarGroup>
        </ToolbarRoot>

        {/* The tool's own properties, as a second plate beside the bar
            rather than as an extension of it. */}
        {!hidden && (
          <ToolPropertiesSatellite
            activeToolId={activeToolId}
            placement={rail ? 'left' : 'bottom'}
            fullPalette={fullPalette}
          />
        )}

        <Button
          ref={showButtonRef}
          type="button"
          variant="outline"
          size="sm"
          onClick={showToolbar}
          aria-hidden={!hidden}
          tabIndex={hidden ? 0 : -1}
          className={cn(
            'absolute rounded-toolbar shadow-toolbar [@media(pointer:coarse)]:min-h-11',
            rail
              ? 'top-1/2 left-0 -translate-y-1/2'
              : 'bottom-0 left-1/2 -translate-x-1/2',
            'transition-[opacity,translate] duration-base ease-out-quart motion-reduce:transition-none',
            hidden
              ? 'opacity-100'
              : cn('pointer-events-none opacity-0', rail ? '-translate-x-2' : 'translate-y-2'),
          )}
        >
          <ChevronUpGlyph className={cn('text-fg-muted', rail && 'rotate-90')} />
          Show toolbar
        </Button>
      </div>
      </ToolbarSideContext.Provider>
    </TooltipProvider>
  );
}
