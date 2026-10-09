import type { ReactElement, ReactNode } from 'react';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useToolStore } from '@/canvas/use-tool-store';
import { Kbd } from '@/components/ui/kbd';
import { ToolbarButton } from '@/components/ui/toolbar';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

interface ToolKeyProps {
  /** The accessible name; every key on the bar is icon-only. */
  label: string;
  /** Shown in the tooltip and announced as `aria-keyshortcuts`. */
  hotkey?: string;
  /** The key is a mode and this is whether it is on. Omit for a command. */
  pressed?: boolean;
  onClick?: () => void;
  /** A popup trigger to render the key as (`<PopoverTrigger />`, ...). */
  render?: ReactElement;
  children: ReactNode;
}

/** A key on the canvas toolbar: a toolbar button with its name and hotkey in a tooltip. */
export function ToolKey({
  label,
  hotkey,
  pressed,
  onClick,
  render,
  children,
}: ToolKeyProps) {
  return (
    <Tooltip>
      {/* The trigger's own slot would replace the button's, and the bar finds
          its keys by `toolbar-button`. */}
      <TooltipTrigger
        data-slot="toolbar-button"
        render={
          <ToolbarButton
            size="lg"
            aria-label={label}
            aria-keyshortcuts={hotkey?.toUpperCase()}
            aria-pressed={pressed}
            onClick={onClick}
            render={render}
          />
        }
      >
        {children}
      </TooltipTrigger>
      <TooltipContent side="top">
        {label}
        {hotkey ? <Kbd className="font-mono uppercase">{hotkey}</Kbd> : null}
      </TooltipContent>
    </Tooltip>
  );
}

/** One registered tool, as a key on the bar. */
export function ToolButton({ toolId }: { toolId: string }) {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  const tool = toolRegistry.get(toolId);

  if (!tool) return null;
  const Icon = tool.icon;

  return (
    <ToolKey
      label={tool.label}
      hotkey={tool.hotkey}
      pressed={tool.id === activeToolId}
      onClick={() => setTool(tool.id)}
    >
      {Icon ? <Icon /> : null}
    </ToolKey>
  );
}
