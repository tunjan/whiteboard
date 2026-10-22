import { Fragment } from 'react';
import { ChevronDown } from 'lucide-react';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { PenSettingsItems } from '@/components/board-actions-menu';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import { INKING_TOOLS } from './toolbar-constants';
import { KeyTip, useToolbarSide } from './toolbar-primitives';
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
 * The chevron beside the pen or highlighter: how that instrument feels. The
 * pen has the board menu's whole Pen panel; the highlighter lays a fixed
 * band, so prediction is the one setting it reads.
 */
function InkSettings({ toolId }: { toolId: 'draw' | 'highlighter' }) {
  const side = useToolbarSide();
  const prediction = useCanvasUiStore((s) => s.pencilPrediction);
  const setPrediction = useCanvasUiStore((s) => s.setPencilPrediction);
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
        className="w-[min(16rem,calc(100vw-1rem))]"
      >
        {toolId === 'draw' ? (
          <PenSettingsItems />
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
    requestAnimationFrame(() =>
      event.currentTarget
        ?.querySelector<HTMLElement>('[aria-checked="true"]')
        ?.focus(),
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
          {id !== 'eraser' && <InkSettings toolId={id} />}
        </Fragment>
      ))}
    </div>
  );
}
