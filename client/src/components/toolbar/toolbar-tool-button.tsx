import { Fragment } from 'react';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useToolStore } from '@/canvas/use-tool-store';
import { EraserModeSelector } from '@/components/eraser-mode-selector';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { toolButtonClass, TOOL_ICON } from './toolbar-constants';

interface ToolButtonProps {
  toolId: string;
}

export function ToolButton({ toolId }: ToolButtonProps) {
  const activeToolId = useToolStore((state) => state.activeToolId);
  const setTool = useToolStore((state) => state.setTool);
  const tool = toolRegistry.get(toolId);

  if (!tool) return null;
  const Icon = tool.icon;
  const active = tool.id === activeToolId;

  const button = (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-toolbar-item
            variant="ghost"
            size="icon-md"
            tabIndex={active ? 0 : -1}
            onClick={() => setTool(tool.id)}
            aria-label={tool.label}
            aria-current={active ? 'true' : undefined}
            aria-keyshortcuts={tool.hotkey?.toUpperCase()}
            className={toolButtonClass(active)}
          />
        }
      >
        {Icon ? <Icon className={TOOL_ICON} /> : null}
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>{tool.label}</span>
        {tool.hotkey ? (
          <Kbd className="font-mono uppercase">{tool.hotkey}</Kbd>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );

  // The eraser carries its mode selector satellite anchored right above its button.
  if (tool.id === 'eraser') {
    return (
      <div key={tool.id} className="relative flex">
        {button}
        <EraserModeSelector active={active} />
      </div>
    );
  }

  return <Fragment key={tool.id}>{button}</Fragment>;
}
