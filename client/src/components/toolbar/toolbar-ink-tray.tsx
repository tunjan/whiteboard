import { Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useCanvasUiStore, type EraserMode } from '@/canvas/use-canvas-ui-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { PenSettingsItems } from '@/components/board-actions-menu';
import { ERASER_MODES } from '@/components/style-previews';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { INKING_TOOLS } from './toolbar-constants';
import { KeyTip, refocusForKeyboard, useToolbarSide } from './toolbar-primitives';
import { toolArt } from './toolbar-tool-button';
import { arrowDelta } from './toolbar-tray-controls';

/** One inking tool in the tray, standing in its slot like the bar's. */
function InkSlot({ toolId, checked }: { toolId: string; checked: boolean }) {
  const setTool = useToolStore((state) => state.setTool);
  const tool = toolRegistry.get(toolId);
  if (!tool) return null;
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={tool.label}
            aria-keyshortcuts={tool.hotkey?.toUpperCase()}
            tabIndex={checked ? 0 : -1}
            // Taken on the press, as on the bar.
            onPointerDown={(event) => event.button === 0 && setTool(toolId)}
            onClick={() => setTool(toolId)}
            className="drawer-cell"
          />
        }
      >
        <span className="drawer-art">{toolArt(toolId)}</span>
      </TooltipTrigger>
      <KeyTip label={tool.label} hotkey={tool.hotkey} />
    </Tooltip>
  );
}

/**
 * The chevron beside an inking tool: how that instrument feels. The pen has
 * the board menu's whole Pen panel; the highlighter lays a fixed band, so
 * prediction is the one setting it reads; the eraser picks what it takes.
 */
function InkSettings({ toolId }: { toolId: (typeof INKING_TOOLS)[number] }) {
  const side = useToolbarSide();
  const prediction = useCanvasUiStore((s) => s.pencilPrediction);
  const setPrediction = useCanvasUiStore((s) => s.setPencilPrediction);
  const eraserMode = useCanvasUiStore((s) => s.eraserMode);
  const setEraserMode = useCanvasUiStore((s) => s.setEraserMode);
  const label = toolRegistry.get(toolId)?.label ?? toolId;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <button
            type="button"
            aria-label={`${label} settings`}
            className="drawer-ink-more"
          />
        }
      >
        <ChevronDown aria-hidden="true" className="tray-chevron" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={side}
        // From the chevron, past the tray's edge, to where the tray's own menus
        // stand: the scaled tray above the chevron, then their 8px.
        sideOffset={side === 'top' ? 16 : undefined}
        finalFocus={refocusForKeyboard}
        // Not the trigger's width, which is the chevron's.
        className={cn(
          'drawer-popup',
          toolId === 'draw' ? 'w-[min(18rem,calc(100vw-1rem))]' : 'w-max',
        )}
      >
        {toolId === 'draw' ? (
          <PenSettingsItems />
        ) : toolId === 'eraser' ? (
          <DropdownMenuRadioGroup
            value={eraserMode}
            onValueChange={(mode) => setEraserMode(mode as EraserMode)}
          >
            {ERASER_MODES.map(({ mode, label }) => (
              <DropdownMenuRadioItem key={mode} value={mode}>
                {label}
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
        ) : (
          <DropdownMenuCheckboxItem
            checked={prediction}
            onCheckedChange={setPrediction}
          >
            Predict stroke ahead
          </DropdownMenuCheckboxItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** Pen, highlighter and eraser: the slot on the bar holds whichever is in hand. */
export function InkTray({ activeToolId }: { activeToolId: string }) {
  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const delta = arrowDelta(event.key);
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const index = INKING_TOOLS.indexOf(activeToolId as (typeof INKING_TOOLS)[number]);
    const next = INKING_TOOLS[(index + delta + INKING_TOOLS.length) % INKING_TOOLS.length]!;
    useToolStore.getState().setTool(next);
    // React clears `currentTarget` once the handler returns.
    const group = event.currentTarget;
    requestAnimationFrame(() =>
      group.querySelector<HTMLElement>('[aria-checked="true"]')?.focus(),
    );
  };
  return (
    <div
      role="radiogroup"
      aria-label="Inking tool"
      onKeyDown={onKeyDown}
      className="drawer-tray-ink"
    >
      {INKING_TOOLS.map((id) => (
        <Fragment key={id}>
          <InkSlot toolId={id} checked={id === activeToolId} />
          <InkSettings toolId={id} />
        </Fragment>
      ))}
    </div>
  );
}
