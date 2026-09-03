import { useState } from 'react';
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
import {
  FlyoutCaret,
  INSTRUMENT_CLIP,
  INSTRUMENT_SLOT,
  MiniShape,
  POLYGON_KINDS,
  SHAPE_TOOLS,
  ShapeClusterGlyph,
  ShapeClusterObject,
  menuItemClass,
  TOOL_ICON,
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
  /**
   * `key` is a glyph on the bar, which is what the compact bar wants. `tray`
   * stands the shapes in the instrument tray as an object at instrument
   * scale — a square, an arrow and a circle lying with the pens — so the wide
   * bar has one run of things you pick up rather than a run of pens and then
   * a picture of some shapes.
   */
  variant?: 'key' | 'tray';
}

export function ShapeMenu({
  activeToolId,
  lastShapeId,
  onLastShapeChange,
  variant = 'key',
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
  const FallbackIcon = displayedTool?.icon ?? ShapeClusterGlyph;

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

  // In the tray the resting state is the cluster drawn at instrument scale.
  // Once a shape is chosen the cluster gives way to that shape alone, drawn
  // large in the same slot — the tray always shows what it is holding.
  // `pt-6` re-centres against the slot: the clipping window starts 24px above
  // it and ends level with its foot, so the raw middle of that window sits
  // high.
  const trayArt = active ? (
    <span className="relative flex h-full w-full items-center justify-center pt-6 text-fg transition-all duration-slow ease-out-quart motion-reduce:transition-none">
      {isPolygon ? (
        <MiniShape kind={polygonKind} size={26} />
      ) : (
        <FallbackIcon className="size-7 stroke-[1.5]" />
      )}
    </span>
  ) : (
    <ShapeClusterObject className="relative translate-y-3.5 transition-transform duration-slow ease-out-quart group-hover/slot:translate-y-2 motion-reduce:transition-none" />
  );

  const trigger =
    variant === 'tray' ? (
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              data-toolbar-item
              tabIndex={active ? 0 : -1}
              aria-label={label}
              aria-current={active ? 'true' : undefined}
              className={INSTRUMENT_CLIP}
            />
          }
        >
          {trayArt}
          <FlyoutCaret active={active} />
        </TooltipTrigger>
        <TooltipContent side="top" className="flex items-center gap-2">
          <span>{label}</span>
          {active && displayedTool?.hotkey ? (
            <Kbd className="font-mono uppercase">{displayedTool.hotkey}</Kbd>
          ) : null}
        </TooltipContent>
      </Tooltip>
    ) : (
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
          {/* Both arms at the same 18px as every other glyph on the bar: the
              trigger changes what it draws when you pick a shape, not how
              heavy it is. */}
          {isPolygon ? (
            <MiniShape kind={polygonKind} size={18} />
          ) : (
            <FallbackIcon className={TOOL_ICON} />
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
    );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      {variant === 'tray' ? (
        <div className={INSTRUMENT_SLOT}>{trigger}</div>
      ) : (
        trigger
      )}

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
                      className={menuItemClass(isSelected)}
                    />
                  }
                >
                  {Icon ? <Icon className={TOOL_ICON} /> : null}
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
                      className={menuItemClass(isSelected)}
                    />
                  }
                >
                  <MiniShape kind={kind} size={18} />
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
