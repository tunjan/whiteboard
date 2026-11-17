import { useState, type ComponentType, type ReactElement, type ReactNode } from 'react';
import { Toolbar as ToolbarPrimitive } from '@base-ui/react/toolbar';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { slotColor, useStyleStore } from '@/canvas/use-style-store';
import { useToolStore } from '@/canvas/use-tool-store';
import { Tooltip, TooltipTrigger } from '@/components/ui/tooltip';
import {
  ArrowArt,
  CommentArt,
  CompassArt,
  EquationArt,
  EraserArt,
  FrameArt,
  GraphArt,
  HandArt,
  HighlighterArt,
  ImageArt,
  LaserArt,
  MeasureArt,
  PencilArt,
  PointerArt,
  StickerArt,
  StraightedgeArt,
  TextArt,
} from './toolbar-art';
import { KeyTip } from './toolbar-primitives';

interface ToolKeyProps {
  /** The accessible name; every key on the bar is icon-only. */
  label: string;
  /** Shown in the tooltip, over the key, and announced as `aria-keyshortcuts`. */
  hotkey?: string;
  /** A chord named only in the tooltip, never printed over the key (⌘Z). */
  shortcut?: string;
  /** The key is a mode and this is whether it is on. Omit for a command. */
  pressed?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  onPointerDown?: (event: React.PointerEvent) => void;
  /** A popup trigger to render the key as (`<PopoverTrigger />`, ...). */
  render?: ReactElement;
  /**
   * A drawn object standing in the drawer (`toolbar-art.tsx`), rather than a
   * glyph centred in the key.
   */
  art?: boolean;
  children: ReactNode;
}

/**
 * A slot in the drawer: the tool standing in it, and its hotkey printed above.
 * A drawn tool is cut off by the bar's bottom edge and rises when picked.
 */
export function ToolKey({
  label,
  hotkey,
  shortcut,
  pressed,
  disabled,
  onClick,
  onPointerDown,
  render,
  art = false,
  children,
}: ToolKeyProps) {
  return (
    <Tooltip>
      {/* The trigger's own slot would replace the button's, and the bar finds
          its keys by `toolbar-button`. */}
      <TooltipTrigger
        data-slot="toolbar-button"
        render={
          <ToolbarPrimitive.Button
            className="drawer-cell"
            aria-label={label}
            aria-keyshortcuts={hotkey?.toUpperCase()}
            aria-pressed={pressed}
            disabled={disabled}
            onClick={onClick}
            onPointerDown={onPointerDown}
            render={render}
          />
        }
      >
        {hotkey ? (
          <span aria-hidden="true" className="drawer-key">
            {hotkey}
          </span>
        ) : null}
        <span className={art ? 'drawer-art' : 'drawer-glyph'}>{children}</span>
      </TooltipTrigger>
      <KeyTip label={label} hotkey={hotkey ?? shortcut} />
    </Tooltip>
  );
}

/** The pen and highlighter are drawn in the colour they will lay down. */
function PenArt() {
  return <PencilArt color={useStyleStore((s) => slotColor(s, 'pen'))} />;
}

function MarkerArt() {
  return <HighlighterArt color={useStyleStore((s) => slotColor(s, 'highlighter'))} />;
}

/** So is the arrow; shapes do the same in `ShapeMenu`. */
function InkedArrowArt() {
  const color = useStyleStore((s) => slotColor(s, 'diagram'));
  return <ArrowArt color={color} />;
}

/** Tools drawn standing in the drawer. A new one is one entry here. */
const TOOL_ART: Partial<Record<string, ComponentType>> = {
  laser: LaserArt,
  draw: PenArt,
  highlighter: MarkerArt,
  eraser: EraserArt,
  arrow: InkedArrowArt,
  text: TextArt,
  frame: FrameArt,
  graph: GraphArt,
  sticker: StickerArt,
  image: ImageArt,
  comment: CommentArt,
  equation: EquationArt,
  straightedge: StraightedgeArt,
  compass: CompassArt,
  measure: MeasureArt,
};

/** Drawn glyphs that replace a tool's registry icon but stay centred. */
const TOOL_GLYPH: Partial<Record<string, ComponentType>> = {
  select: PointerArt,
  hand: HandArt,
};

/** The drawn object for a tool, or null for one that keeps its glyph. */
export function toolArt(toolId: string): ReactNode {
  const Art = TOOL_ART[toolId];
  return Art ? <Art /> : null;
}

/** The drawn glyph for a tool, or null for one that keeps its registry icon. */
export function toolGlyph(toolId: string): ReactNode {
  const Glyph = TOOL_GLYPH[toolId];
  return Glyph ? <Glyph /> : null;
}

/**
 * The tool from `group` most recently in hand, for one key that stands for a
 * set: while another tool is held, the key keeps showing the last one picked.
 */
export function useLastHeld(group: readonly string[], activeToolId: string): string {
  const held = group.includes(activeToolId);
  const [last, setLast] = useState(group[0]!);
  if (held && activeToolId !== last) setLast(activeToolId);
  return held ? activeToolId : last;
}

/** One registered tool, as a key on the bar. */
export function ToolButton({ toolId }: { toolId: string }) {
  // A boolean, so a tool change re-renders the two keys it touches, not all.
  const pressed = useToolStore((state) => state.activeToolId === toolId);
  const setTool = useToolStore((state) => state.setTool);
  const tool = toolRegistry.get(toolId);
  if (!tool) return null;

  const Art = TOOL_ART[toolId];
  const Glyph = TOOL_GLYPH[toolId] ?? tool.icon;

  return (
    <ToolKey
      label={tool.label}
      hotkey={tool.hotkey}
      pressed={pressed}
      // A mode is taken on the press, not the release, so the slot fills
      // under the finger; click still covers the keyboard. `setTool` ignores
      // the repeat.
      onPointerDown={(event) => event.button === 0 && setTool(tool.id)}
      onClick={() => setTool(tool.id)}
      art={Art !== undefined}
    >
      {Art ? <Art /> : Glyph ? <Glyph /> : null}
    </ToolKey>
  );
}
