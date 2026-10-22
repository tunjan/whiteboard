import { useState } from 'react';
import type { PolygonKind } from '@whiteboard/shared';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import {
  Popover,
  PopoverContent,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { toolbarButtonVariants } from '@/components/ui/toolbar';
import { ShapeArt } from './toolbar-art';
import {
  MiniShape,
  POLYGON_KINDS,
  polygonLabel,
  SHAPE_MENU_TOOLS,
} from './toolbar-constants';
import { useToolbarSide } from './toolbar-primitives';
import { ToolKey, useLastHeld } from './toolbar-tool-button';

const BASIC_SHAPES = SHAPE_MENU_TOOLS.filter((id) => id !== 'polygon');

interface ShapeMenuProps {
  activeToolId: string;
  /** The shape tray lists every shape, so the key only picks one up. */
  tray?: boolean;
}

/**
 * The shape tools behind one key.
 *
 * Ten shapes would be most of the bar, so the key carries the last shape
 * chosen and opens the rest — the standard desktop "tool with a flyout".
 */
export function ShapeMenu({
  activeToolId,
  tray = false,
}: ShapeMenuProps) {
  const [open, setOpen] = useState(false);
  const side = useToolbarSide();
  const setTool = useToolStore((state) => state.setTool);
  const polygonKind = useStyleStore((state) => state.polygonKind);
  const setPolygonKind = useStyleStore((state) => state.setPolygonKind);

  const currentOrLastId = useLastHeld(SHAPE_MENU_TOOLS, activeToolId);
  const active = currentOrLastId === activeToolId;
  const isPolygon = currentOrLastId === 'polygon';
  const displayedTool = toolRegistry.get(currentOrLastId);

  const currentLabel = isPolygon
    ? polygonLabel(polygonKind)
    : (displayedTool?.label ?? 'Shape');
  const label = active ? `Shapes, ${currentLabel} selected` : 'Shapes';

  const pick = (toolId: string) => {
    setTool(toolId);
    setOpen(false);
  };

  const pickPolygon = (kind: PolygonKind) => {
    setPolygonKind(kind);
    pick('polygon');
  };

  const art = (
    <ShapeArt
      kind={
        isPolygon
          ? polygonKind
          : (currentOrLastId as 'rectangle' | 'ellipse' | 'line')
      }
    />
  );

  if (tray) {
    return (
      <ToolKey
        label={label}
        hotkey={displayedTool?.hotkey}
        pressed={active}
        onClick={() => setTool(currentOrLastId)}
        art
      >
        {art}
      </ToolKey>
    );
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <ToolKey
        label={label}
        hotkey={displayedTool?.hotkey}
        pressed={active}
        render={<PopoverTrigger />}
        art
      >
        {art}
      </ToolKey>

      <PopoverContent side={side} sideOffset={8} className="w-auto p-1">
        <PopoverTitle className="sr-only">Shapes</PopoverTitle>
        <div className="grid grid-cols-4 gap-0.5" role="group" aria-label="Shapes">
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
                onClick={() => pick(tool.id)}
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
              onClick={() => pickPolygon(kind)}
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
