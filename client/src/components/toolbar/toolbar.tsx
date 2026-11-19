import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type RefObject,
} from 'react';
import { Redo2, Undo2 } from 'lucide-react';
import { ChevronUpGlyph } from '@/components/ui/glyphs';
import { isTypingTarget } from '@/canvas/canvas-shortcuts';
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
import { HIDE_KEYS, INKING_TOOLS, NAVIGATE_TOOLS } from './toolbar-constants';
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
 * corner HUDs share the bar's row, so that is the bar plus both corners:
 * measured 2026-11-19, the full bar is 712px at 0.72 scale and the view
 * cluster 228px, so it fits from ~1210px (at 1060 the two overlapped by 66px).
 * Below 840px the narrow bar no longer fits either, and the corners lift
 * (`max-[840px]` in `CanvasControls`). A touch screen always lifts them, so
 * the bar only has to fit itself — ~540px at touch key size — which every
 * iPad does in portrait.
 */
const WIDE_QUERY =
  '(min-width: 1220px), (pointer: coarse) and (min-width: 600px)';

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

/** A phone, where even four colours push the tray's last key off its end. */
const FEW_COLOURS_QUERY = '(max-width: 429px)';

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

/** How long a press on undo or redo waits to become a hold, then its pace. */
const HOLD_DELAY_MS = 420;
const HOLD_REPEAT_MS = 110;

/** How close a press may come, in screen px, before the bar clears out. */
const DUCK_MARGIN = 20;

/**
 * The bar and tray sit over the board, so ink carried under them is out of
 * sight just as it is being drawn. While a press that began on the board runs
 * near them they fade out of its way, and return on release. Panning is left
 * alone: there the pointer says nothing about where the eye is.
 */
function useDuckUnderPress(root: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    let press: { id: number; plates: DOMRect[] } | null = null;

    const onDown = (event: PointerEvent) => {
      const target = event.target as Element;
      if (press || !root.current || target.closest('[data-ui-layer]')) return;
      if (!target.closest('.wb-board')) return;
      if (useToolStore.getState().activeToolId === 'hand') return;
      const plates = root.current.querySelectorAll(
        '[role="toolbar"], [data-visible="true"]',
      );
      press = {
        id: event.pointerId,
        plates: [...plates].map((plate) => plate.getBoundingClientRect()),
      };
    };
    const onMove = ({ pointerId, clientX: x, clientY: y }: PointerEvent) => {
      if (pointerId !== press?.id) return;
      root.current?.toggleAttribute(
        'data-ducked',
        press.plates.some(
          (r) =>
            x > r.left - DUCK_MARGIN &&
            x < r.right + DUCK_MARGIN &&
            y > r.top - DUCK_MARGIN &&
            y < r.bottom + DUCK_MARGIN,
        ),
      );
    };
    const onUp = ({ pointerId }: PointerEvent) => {
      if (pointerId !== press?.id) return;
      press = null;
      root.current?.removeAttribute('data-ducked');
    };

    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('pointermove', onMove, true);
    window.addEventListener('pointerup', onUp, true);
    window.addEventListener('pointercancel', onUp, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('pointermove', onMove, true);
      window.removeEventListener('pointerup', onUp, true);
      window.removeEventListener('pointercancel', onUp, true);
    };
  }, [root]);
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
  const fewColours = useMediaQuery(FEW_COLOURS_QUERY);
  const [hidden, setHidden] = useState(false);
  const showButtonRef = useRef<HTMLButtonElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const inkId = useLastHeld(INKING_TOOLS, activeToolId);
  const stepFromBar = useRef(false);
  const heldStep = useRef(false);

  useDuckUnderPress(rootRef);

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

  const stepOnBar = (step: () => void) => {
    stepFromBar.current = true;
    step();
    stepFromBar.current = false;
  };

  // Held, a history key keeps stepping: backing out of a run of strokes is one
  // long press rather than a dozen clicks. The release's click must not add
  // one more.
  const holdStep = (step: () => void, more: () => boolean) => (event: React.PointerEvent) => {
    heldStep.current = false;
    if (event.button !== 0) return;
    const stop = () => {
      clearTimeout(timer);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
    };
    const tick = () => {
      heldStep.current = true;
      stepOnBar(step);
      timer = setTimeout(tick, HOLD_REPEAT_MS);
      if (!more()) stop();
    };
    let timer = setTimeout(tick, HOLD_DELAY_MS);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  };

  const clickStep = (step: () => void) => () => {
    if (!heldStep.current) stepOnBar(step);
    heldStep.current = false;
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

  // Not `hideToolbar`: from the keyboard, focus stays on the board.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.key !== '.') return;
      if (isTypingTarget(event.target)) return;
      event.preventDefault();
      setHidden((value) => !value);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // A press on the bar picks a tool; the keyboard stays with the board. Left
  // on a key, focus lights its ring at the next hotkey and lets Space press it
  // again. React bubbles a portaled menu's press through here too, and a text
  // field being edited still needs its blur to commit.
  const onMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as Element;
    if (!event.currentTarget.contains(target)) return;
    if (target.closest('input') || isTypingTarget(document.activeElement)) return;
    event.preventDefault();
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
        ref={rootRef}
        data-arrive="up"
        data-canvas-toolbar=""
        data-placement={rail ? 'left' : 'bottom'}
        style={{ '--arrive-i': 2 } as React.CSSProperties}
        // The browser's own menu has nothing to offer a drawer of tools.
        onContextMenu={(event) => event.preventDefault()}
        onMouseDown={onMouseDown}
        className={cn(
          'absolute z-[var(--z-ui)] scale-[var(--drawer-scale)]',
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
              ? 'max-h-[calc((100vh-1rem)/var(--drawer-scale))] origin-left'
              : 'max-w-[calc((100vw-1rem)/var(--drawer-scale))] origin-bottom',
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
                <ToolKey label="Add image" hotkey="u" onClick={() => void pickAndPlaceImages()} art>
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
            <ToolKey
              label="Undo"
              shortcut={UNDO_KEYS}
              disabled={!canUndo}
              onClick={clickStep(undo)}
              onPointerDown={holdStep(undo, () => useUndoStore.getState().canUndo)}
            >
              <Undo2 />
            </ToolKey>
            <ToolKey
              label="Redo"
              shortcut={REDO_KEYS}
              disabled={!canRedo}
              onClick={clickStep(redo)}
              onPointerDown={holdStep(redo, () => useUndoStore.getState().canRedo)}
            >
              <Redo2 />
            </ToolKey>
          </ToolbarGroup>
        </ToolbarRoot>

        {/* The tool's own properties, as a second plate beside the bar
            rather than as an extension of it. */}
        <ToolPropertiesSatellite
          activeToolId={activeToolId}
          placement={rail ? 'left' : 'bottom'}
          fullPalette={fullPalette}
          fewColours={fewColours}
          barHidden={hidden}
        />

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
          <span className="text-fg-muted pointer-coarse:hidden">{HIDE_KEYS}</span>
        </Button>
      </div>
      </ToolbarSideContext.Provider>
    </TooltipProvider>
  );
}
