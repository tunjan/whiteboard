// Registers all tools. Importing this module (once) populates the tool
// registry, which the toolbar and keyboard routing iterate.
import {
  ArrowGlyph,
  EllipseGlyph,
  HighlighterGlyph,
  LineGlyph,
  RectGlyph,
  StraightedgeGlyph,
} from '@/components/ui/glyphs';
import { toolRegistry } from './tool-registry';
import { createSelectTool } from './select-tool';
import { createHandTool } from './hand-tool';
import { createBoxTool } from './box-tool';
import { createDrawTool } from './draw-tool';
import { createLineTool } from './line-tool';
import { createEraserTool } from './eraser-tool';
import { createLaserTool } from './laser-tool';
import { createTextTool } from './text-tool';
import { createPolygonTool } from './polygon-tool';
import { createStickerTool } from './sticker-tool';
import { createFrameTool } from './frame-tool';
import { createGraphTool } from './graph-tool';
import { createEquationTool } from './equation-tool';
import { createCommentTool } from './comment-tool';
import { createCompassTool } from './compass-tool';

toolRegistry.register(createSelectTool());
toolRegistry.register(createHandTool());
toolRegistry.register(createDrawTool());
// The same freehand state machine laying marker ink instead of pencil ink.
toolRegistry.register(
  createDrawTool({
    id: 'highlighter',
    label: 'Highlighter',
    hotkey: 'i',
    icon: HighlighterGlyph,
    ink: 'marker',
  }),
);
toolRegistry.register(createTextTool());
toolRegistry.register(createGraphTool());
toolRegistry.register(createEquationTool());
toolRegistry.register(createCommentTool());
toolRegistry.register(createPolygonTool());
toolRegistry.register(createStickerTool());
toolRegistry.register(createFrameTool());
toolRegistry.register(
  createBoxTool({
    id: 'rectangle',
    type: 'rectangle',
    label: 'Rectangle',
    hotkey: 'r',
    icon: RectGlyph,
  }),
);
toolRegistry.register(
  createBoxTool({
    id: 'ellipse',
    type: 'ellipse',
    label: 'Ellipse',
    hotkey: 'o',
    icon: EllipseGlyph,
  }),
);
toolRegistry.register(
  createLineTool({
    id: 'line',
    type: 'line',
    label: 'Line',
    hotkey: 'l',
    icon: LineGlyph,
  }),
);
toolRegistry.register(
  createLineTool({
    id: 'arrow',
    type: 'arrow',
    label: 'Arrow',
    hotkey: 'a',
    icon: ArrowGlyph,
  }),
);
toolRegistry.register(
  createLineTool({
    id: 'straightedge',
    type: 'line',
    label: 'Straightedge',
    icon: StraightedgeGlyph,
    construction: true,
  }),
);
toolRegistry.register(createCompassTool());
toolRegistry.register(createEraserTool());
toolRegistry.register(createLaserTool());
