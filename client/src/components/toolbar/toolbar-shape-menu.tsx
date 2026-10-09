import { useState } from 'react';
import type { PolygonKind } from '@whiteboard/shared';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { ShapesGlyph } from '@/components/ui/glyphs';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toolbarButtonVariants } from '@/components/ui/toolbar';
import { MiniShape, POLYGON_KINDS, SHAPE_TOOLS } from './toolbar-constants';
import { ToolKey } from './toolbar-tool-button';

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

/**
 * The shape tools behind one key.
 *
 * Ten shapes would be most of the bar, so the key carries the last shape
 * chosen and opens the rest — the standard desktop "tool with a flyout".
 */
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
  const isPolygon = currentOrLastId === 'polygon';
  const displayedTool = toolRegistry.get(currentOrLastId);
  const FallbackIcon = displayedTool?.icon ?? ShapesGlyph;

  const currentLabel = isPolygon
    ? (POLYGON_KINDS.find((p) => p.kind === polygonKind)?.label ?? 'Polygon')
    : (displayedTool?.label ?? 'Shape');
  const label = active ? `Shapes, ${currentLabel} selected` : 'Shapes';

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
      <ToolKey
        label={label}
        hotkey={active ? displayedTool?.hotkey : undefined}
        pressed={active}
        render={<PopoverTrigger />}
      >
        {isPolygon ? <MiniShape kind={polygonKind} /> : <FallbackIcon />}
      </ToolKey>

      <PopoverContent side="top" sideOffset={8} className="w-auto p-1">
        <PopoverTitle className="sr-only">Shapes</PopoverTitle>
        <div className="grid grid-cols-5 gap-0.5" role="group" aria-label="Shapes">
          {BASIC_SHAPES.map((toolId) => {
            const tool = toolRegistry.get(toolId);
            if (!tool) return null;
            const Icon = tool.icon;
            return (
              <button
                key={toolId}
                type="button"
                title={tool.label}
                aria-label={tool.label}
                aria-keyshortcuts={tool.hotkey?.toUpperCase()}
                aria-pressed={active && activeToolId === toolId}
                onClick={() => selectBasicShape(tool.id)}
                className={toolbarButtonVariants()}
              >
                {Icon ? <Icon /> : null}
              </button>
            );
          })}
          {POLYGON_KINDS.map(({ kind, label: polygonLabel }) => (
            <button
              key={kind}
              type="button"
              title={polygonLabel}
              aria-label={polygonLabel}
              aria-pressed={
                active && activeToolId === 'polygon' && polygonKind === kind
              }
              onClick={() => selectPolygon(kind)}
              className={toolbarButtonVariants()}
            >
              <MiniShape kind={kind} />
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
