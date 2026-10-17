import { beforeAll, expect, it } from 'vitest';
import type { GraphExpression } from '@whiteboard/shared';
import { ensureGraphMath } from './graph-math';
import { EMPTY_GRAPH_FUNCTIONS } from './graph-parser';
import {
  packGraphSample,
  sampleGraph,
  unpackGraphSample,
} from './graph-sample-client';

beforeAll(ensureGraphMath);

const expression = (source: string): GraphExpression => ({
  id: source,
  expression: source,
  visible: true,
  color: '#000',
  dash: 'solid',
});

it('packs a sample for the worker and unpacks it unchanged', () => {
  const output = sampleGraph(
    {
      expressions: ['tan(x)', 'x^2+y^2<4', '(1, 2)', 'y=sin('].map(expression),
      viewport: { xMin: -5, xMax: 5, yMin: -3, yMax: 3 },
      parameters: {},
      samples: 300,
      verticalSamples: 200,
      intersections: true,
    },
    EMPTY_GRAPH_FUNCTIONS,
  );
  expect(output.results[0]!.segments.length).toBeGreaterThan(1);
  expect(unpackGraphSample(packGraphSample(output))).toEqual(output);
});
