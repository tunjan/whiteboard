import type { Tool } from './types';

/**
 * Registry of tools, keyed by id. Toolbar and keyboard routing iterate this —
 * adding a tool means registering it here, not editing the canvas. Insertion
 * order is preserved for stable toolbar ordering.
 */
class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): void {
    this.tools.set(tool.id, tool);
  }

  get(id: string): Tool | undefined {
    return this.tools.get(id);
  }

  has(id: string): boolean {
    return this.tools.has(id);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  /** Find a tool by its hotkey. */
  byHotkey(key: string): Tool | undefined {
    const lower = key.toLowerCase();
    for (const tool of this.tools.values()) {
      if (tool.hotkey?.toLowerCase() === lower) return tool;
    }
    return undefined;
  }
}

export const toolRegistry = new ToolRegistry();
