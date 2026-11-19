import { afterEach, describe, expect, it } from 'vitest';
import { ALL_FEATURES, TOOL_FEATURE } from '@whiteboard/shared';
import '@/canvas/tools/register';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useToolStore } from '@/canvas/use-tool-store';
import { useFeaturesStore } from './features';

afterEach(() => {
  useFeaturesStore.setState({ features: ALL_FEATURES });
  useToolStore.setState({ activeToolId: 'select' });
});

describe('board features', () => {
  it('names only tools that are registered', () => {
    for (const toolId of Object.keys(TOOL_FEATURE)) {
      expect(toolRegistry.get(toolId), toolId).toBeDefined();
    }
  });

  it('refuses a tool whose feature is off, by any route to setTool', () => {
    useFeaturesStore.setState({ features: { ...ALL_FEATURES, graphs: false } });
    useToolStore.getState().setTool('graph');
    expect(useToolStore.getState().activeToolId).toBe('select');
    useToolStore.getState().setTool('equation');
    expect(useToolStore.getState().activeToolId).toBe('equation');
  });

  it('puts down the tool in hand when its feature is turned off', () => {
    useFeaturesStore.setState({ features: ALL_FEATURES });
    useToolStore.getState().setTool('compass');
    useFeaturesStore.setState({ features: { ...ALL_FEATURES, construction: false } });
    expect(useToolStore.getState().activeToolId).toBe('select');
  });
});
