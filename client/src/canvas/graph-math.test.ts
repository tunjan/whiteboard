import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  isCoordinateExpression,
  type GraphExpressionParseResult,
  type ParsedGraphFunction,
} from './graph-parser';
import type { GraphExpression } from '@whiteboard/shared';

/**
 * The parser is module-level state, and these tests are about the window
 * before it loads — so each one starts from a fresh copy of the graph modules
 * rather than the one every other suite has already warmed up.
 */
async function freshGraphModules() {
  vi.resetModules();
  const math = await import('./graph-math');
  const parser = await import('./graph-parser');
  return { math, parser };
}

/** Narrow a parse result to the `y = …` case these tests evaluate. */
function asFunction(result: GraphExpressionParseResult): ParsedGraphFunction {
  if (!result.ok || isCoordinateExpression(result)) {
    throw new Error(
      `expected a parsed function, got ${JSON.stringify(result)}`,
    );
  }
  return result;
}

function definition(source: string): GraphExpression {
  return {
    id: `expr-${source}`,
    expression: source,
    color: '#000000',
    width: 2,
    dash: 'solid',
    visible: true,
  };
}

describe('graph parser loading', () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it('reports an unloaded parser instead of throwing', async () => {
    const { math, parser } = await freshGraphModules();
    expect(math.graphMathReady()).toBe(false);

    const result = parser.parseGraphExpression('y = x^2');
    expect(result.ok).toBe(false);
    expect(result.ok === false && result.message).toMatch(/loading/i);
    expect(() => math.parseMath('x')).toThrow();
  });

  it('does not cache the unloaded answer', async () => {
    const { math, parser } = await freshGraphModules();
    expect(parser.parseGraphExpression('y = x^2').ok).toBe(false);

    await math.ensureGraphMath();

    expect(math.graphMathReady()).toBe(true);
    expect(
      asFunction(parser.parseGraphExpression('y = x^2')).evaluate(3, {}),
    ).toBe(9);
  });

  it('resolves user function definitions once the parser is in', async () => {
    const { math, parser } = await freshGraphModules();
    const expressions = [definition('f(x) = 2x'), definition('y = f(x) + 1')];

    expect(parser.createGraphFunctionDefinitions(expressions).size).toBe(0);

    await math.ensureGraphMath();

    const definitions = parser.createGraphFunctionDefinitions(expressions);
    expect(definitions.size).toBe(1);
    const parsed = asFunction(
      parser.parseGraphExpression('y = f(x) + 1', definitions),
    );
    expect(parsed.evaluate(4, {})).toBe(9);
  });

  it('server-renders a graph either side of the load', async () => {
    // This is the PNG export path: `renderToStaticMarkup` cannot suspend, so
    // the shape has to draw something in both states — grid and axes while the
    // parser is out, the curve once export has awaited it in.
    vi.resetModules();
    const { ensureGraphMath } = await import('./graph-math');
    const { createDefaultGraphProps } = await import('./graph-defaults');
    const { graphUtil } = await import('./shapes/graph');

    const shape = {
      id: 'g1',
      type: 'graph' as const,
      x: 0,
      y: 0,
      rotation: 0,
      props: {
        ...createDefaultGraphProps(),
        expressions: [
          {
            ...definition('y = x^2'),
            color: '#ff0000',
          },
        ],
      },
    };
    const render = () =>
      renderToStaticMarkup(
        createElement(graphUtil.Component, { shape: shape as never }),
      );

    const before = render();
    expect(before).toContain('graph-clip-g1');
    expect(before).not.toContain('#ff0000');

    await ensureGraphMath();

    expect(render()).toContain('#ff0000');
  });

  it('shares one load between concurrent callers', async () => {
    const { math } = await freshGraphModules();
    await Promise.all([
      math.ensureGraphMath(),
      math.ensureGraphMath(),
      math.ensureGraphMath(),
    ]);
    expect(math.graphMathReady()).toBe(true);
  });
});
