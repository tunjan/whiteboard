// Registers all tools. Importing this module (once) populates the tool
// registry, which the toolbar and keyboard routing iterate.
import { ArrowUpRight, Circle, Slash, Square } from 'lucide-react';
import { toolRegistry } from './tool-registry';
import { createSelectTool } from './select-tool';
import { createHandTool } from './hand-tool';
import { createLassoTool } from './lasso-tool';
import { createBoxTool } from './box-tool';
import { createDrawTool } from './draw-tool';
import { createLineTool } from './line-tool';
import { createEraserTool } from './eraser-tool';
import { createTextTool } from './text-tool';
import { createPolygonTool } from './polygon-tool';
import { createFrameTool } from './frame-tool';
import { createGraphTool } from './graph-tool';

toolRegistry.register(createSelectTool());
toolRegistry.register(createHandTool());
toolRegistry.register(createLassoTool());
toolRegistry.register(createDrawTool());
toolRegistry.register(createTextTool());
toolRegistry.register(createGraphTool());
toolRegistry.register(createPolygonTool());
toolRegistry.register(createFrameTool());
toolRegistry.register(
  createBoxTool({
    id: 'rectangle',
    type: 'rectangle',
    label: 'Rectangle',
    hotkey: 'r',
    icon: Square,
  }),
);
toolRegistry.register(
  createBoxTool({
    id: 'ellipse',
    type: 'ellipse',
    label: 'Ellipse',
    hotkey: 'o',
    icon: Circle,
  }),
);
toolRegistry.register(
  createLineTool({
    id: 'line',
    type: 'line',
    label: 'Line',
    hotkey: 'l',
    icon: Slash,
  }),
);
toolRegistry.register(
  createLineTool({
    id: 'arrow',
    type: 'arrow',
    label: 'Arrow',
    hotkey: 'a',
    icon: ArrowUpRight,
  }),
);
toolRegistry.register(createEraserTool());
