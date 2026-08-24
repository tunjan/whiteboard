import { useState } from 'react';
import { Shapes } from 'lucide-react';
import type { PolygonKind } from '@whiteboard/shared';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import {
  FlyoutCaret,
  MiniShape,
  POLYGON_KINDS,
  SHAPE_TOOLS,
  TOOL_PRESSED,
  toolButtonClass,
} from './toolbar-constants';

const BASIC_SHAPES = [
  'rectangle',
  'ellipse',
  'arrow',
  'line',
  'frame',
] as const;

interface ShapeMenuProps {
  activeToolId: string;
  lastShapeId: string;
  onLastShapeChange: (toolId: string) => void;
}

export function ShapeMenu({
  activeToolId,
  lastShapeId,
  onLastShapeChange,
}: ShapeMenuProps) {
  const [open, setOpen] = useState(false);
  const setTool = useToolStore((state) => state.setTool);
  const polygonKind = useStyleStore((state) => state.polygonKind);
  const setPolygonKind = useStyleStore((state) => state.setPolygonKind);

  const active = SHAPE_TOOLS.includes(
    activeToolId as (typeof SHAPE_TOOLS)[number],
  );
  const currentOrLastId = active ? activeToolId : lastShapeId;

  // Compute dynamic trigger icon
  const isPolygon = currentOrLastId === 'polygon';
  const displayedTool = toolRegistry.get(currentOrLastId);
  const FallbackIcon = displayedTool?.icon ?? Shapes;

  const currentLabel = isPolygon
    ? (POLYGON_KINDS.find((p) => p.kind === polygonKind)?.label ?? 'Polygon')
    : (displayedTool?.label ?? 'Shape');
  const label = active ? `${currentLabel} selected` : 'Shapes';

  const selectBasicShape = (toolId: string) => {
    onLastShapeChange(toolId);
    setTool(toolId);
    setOpen(false);
  };

  const selectPolygon = (kind: PolygonKind) => {
    setPolygonKind(kind);
    onLastShapeChange('polygon');
    setTool('polygon');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              data-toolbar-item
              tabIndex={active ? 0 : -1}
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              className={toolButtonClass(active)}
            />
          }
        >
          {isPolygon ? (
            <MiniShape kind={polygonKind} size={18} />
          ) : (
            <FallbackIcon className="size-4.5" />
          )}
          <FlyoutCaret active={active} />
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span>{label}</span>
          {active && displayedTool?.hotkey ? (
            <Kbd className="font-mono uppercase">{displayedTool.hotkey}</Kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="center"
        sideOffset={8}
        className="w-auto p-1.5"
      >
        <PopoverHeader className="sr-only">
          <PopoverTitle>Shapes</PopoverTitle>
          <PopoverDescription>
            Select a geometric shape or polygon
          </PopoverDescription>
        </PopoverHeader>

        <div
          className="grid grid-cols-5 gap-1"
          role="group"
          aria-label="Shapes"
        >
          {BASIC_SHAPES.map((toolId) => {
            const tool = toolRegistry.get(toolId);
            if (!tool) return null;
            const Icon = tool.icon;
            const isSelected = active && activeToolId === toolId;

            return (
              <Tooltip key={toolId}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => selectBasicShape(tool.id)}
                      aria-label={tool.label}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'size-9 rounded-lg transition-colors duration-fast',
                        isSelected
                          ? TOOL_PRESSED
                          : 'text-fg-secondary hover:bg-panel hover:text-fg active:bg-panel/80',
                      )}
                    />
                  }
                >
                  {Icon ? <Icon className="size-4.5" /> : null}
                </TooltipTrigger>
                <TooltipContent
                  side="top"
                  className="flex items-center gap-1.5"
                >
                  <span>{tool.label}</span>
                  {tool.hotkey && (
                    <Kbd className="font-mono uppercase">{tool.hotkey}</Kbd>
                  )}
                </TooltipContent>
              </Tooltip>
            );
          })}

          {POLYGON_KINDS.map(({ kind, label: polygonLabel }) => {
            const isSelected =
              active && activeToolId === 'polygon' && polygonKind === kind;

            return (
              <Tooltip key={kind}>
                <TooltipTrigger
                  render={
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      onClick={() => selectPolygon(kind)}
                      aria-label={polygonLabel}
                      aria-current={isSelected ? 'true' : undefined}
                      className={cn(
                        'size-9 rounded-lg transition-colors duration-fast',
                        isSelected
                          ? TOOL_PRESSED
                          : 'text-fg-secondary hover:bg-panel hover:text-fg active:bg-panel/80',
                      )}
                    />
                  }
                >
                  <MiniShape kind={kind} size={16} />
                </TooltipTrigger>
                <TooltipContent side="top">
                  <span>{polygonLabel}</span>
                </TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
