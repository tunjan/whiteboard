import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';
import type { GraphExpression, GraphShape } from '@whiteboard/shared';
import { createDefaultGraphProps, DEFAULT_GRAPH_PARAMETER } from './graph-defaults';
import { ensureGraphMath } from './graph-math';
import { reconcileGraphParameters } from './graph-parameters';
import { GRAPH_3D_PRESETS } from './graph-presets';
import {
  createGraphFunctionDefinitions,
  parseGraph3dExpression,
  parseGraphExpression,
  type GraphPoint3,
  type ParsedGraph3dExpression,
} from './graph-parser';
import {
  axisLabels3d,
  buildScene3d,
  clipToBox,
  createProjection,
  orbitView,
  projectScene,
  tone,
  zoomGraph3d,
  type Box3,
  type Primitive3,
} from './graph3d';
import { graphUtil } from './shapes/graph';

beforeAll(() => ensureGraphMath());

const box: Box3 = { min: { x: -5, y: -5, z: -5 }, max: { x: 5, y: 5, z: 5 } };
const area = { x: 0, y: 0, w: 400, h: 400 };

function row(expression: string, extra: Partial<GraphExpression> = {}): GraphExpression {
  return { id: expression, expression, color: '#4465e9', visible: true, dash: 'solid', ...extra };
}

function parse(source: string): ParsedGraph3dExpression {
  const parsed = parseGraph3dExpression(source);
  if (!parsed.ok) throw new Error(`${source}: ${parsed.message}`);
  return parsed;
}

function errorOf(source: string): string {
  const parsed = parseGraph3dExpression(source);
  if (parsed.ok) throw new Error(`${source} parsed as ${parsed.kind}`);
  return parsed.message;
}

function at(source: string, t: number, parameters = {}): GraphPoint3 {
  const parsed = parse(source);
  if (parsed.kind !== 'point' && parsed.kind !== 'curve' && parsed.kind !== 'line') {
    throw new Error(`${source} is a ${parsed.kind}`);
  }
  return parsed.createEvaluator(parameters)(t);
}

function scene(...expressions: GraphExpression[]): Primitive3[] {
  return buildScene3d({
    expressions,
    parameters: {},
    definitions: createGraphFunctionDefinitions(expressions),
    box,
    angleUnit: 'rad',
    detail: 'low',
  }).filter((primitive) => typeof primitive.source === 'number');
}

function pointsOf(primitive: Primitive3): GraphPoint3[] {
  return primitive.kind === 'dot' ? [primitive.point] : primitive.points;
}

const within = (p: GraphPoint3) =>
  (['x', 'y', 'z'] as const).every((a) => p[a] >= box.min[a] - 1e-9 && p[a] <= box.max[a] + 1e-9);

describe('3D expressions', () => {
  it('reads z = f(x, y) either way round, or bare, as a surface', () => {
    for (const source of ['z = x^2 - y^2', 'x^2 - y^2 = z', 'x^2 - y^2']) {
      const parsed = parse(source);
      expect(parsed.kind, source).toBe('surface');
      if (parsed.kind !== 'surface') continue;
      expect(parsed.createEvaluator({})(2, 1)).toBeCloseTo(3);
    }
  });

  it('reads a linear equation in x, y and z as a plane', () => {
    const parsed = parse('2x - y + z = 4');
    expect(parsed.kind).toBe('plane');
    if (parsed.kind !== 'plane') return;
    const plane = parsed.createPlane({})!;
    expect(plane.normal.x).toBeCloseTo(2);
    expect(plane.normal.y).toBeCloseTo(-1);
    expect(plane.normal.z).toBeCloseTo(1);
    expect(plane.offset).toBeCloseTo(4);

    const wall = parse('x = 2');
    expect(wall.kind).toBe('plane');
  });

  it('gives a plane its sliders but never a z slider', () => {
    const parsed = parse('a x + y + 2z = 1');
    expect(parsed.variables).toEqual(['a']);
    if (parsed.kind !== 'plane') throw new Error(parsed.kind);
    const plane = parsed.createPlane({ a: { ...DEFAULT_GRAPH_PARAMETER, value: 3 } })!;
    expect(plane.normal.x).toBeCloseTo(3);
    expect(plane.normal.z).toBeCloseTo(2);
  });

  it('reads points, curves and vector lines', () => {
    expect(parse('(1, 2, 3)').kind).toBe('point');
    expect(at('(1, 2, 3)', 0)).toEqual({ x: 1, y: 2, z: 3 });

    const helix = at('(cos(t), sin(t), t/5)', Math.PI);
    expect(helix.x).toBeCloseTo(-1);
    expect(helix.y).toBeCloseTo(0);
    expect(helix.z).toBeCloseTo(Math.PI / 5);

    for (const source of [
      'r = (1, 2, 3) + λ(2, -1, 0)',
      'r = (1, 2, 3) + lambda*(2, -1, 0)',
      '(1, 2, 3) + t(2, -1, 0)',
    ]) {
      expect(parse(source).kind, source).toBe('line');
      expect(at(source, 1), source).toEqual({ x: 3, y: 1, z: 3 });
    }
    expect(at('(1, 2, 3) - s(1, 1, 1)', 1)).toEqual({ x: 0, y: 1, z: 2 });
  });

  it('calls helper functions and honours degrees', () => {
    const rows = [row('f(x) = x^2'), row('z = f(x) + y')];
    const definitions = createGraphFunctionDefinitions(rows);
    expect(parseGraph3dExpression('f(x) = x^2', definitions)).toMatchObject({ ok: true, kind: 'definition' });
    const surface = parseGraph3dExpression('z = f(x) + y', definitions);
    if (!surface.ok || surface.kind !== 'surface') throw new Error('not a surface');
    expect(surface.createEvaluator({})(3, 1)).toBeCloseTo(10);

    const degrees = createGraphFunctionDefinitions([], 'deg');
    const sine = parseGraph3dExpression('z = sin(x)', degrees);
    if (!sine.ok || sine.kind !== 'surface') throw new Error('not a surface');
    expect(sine.createEvaluator({})(90, 0)).toBeCloseTo(1);
  });

  it('says why a row draws nothing in 3D', () => {
    expect(errorOf('x^2 + y^2 + z^2 = 4')).toMatch(/z = f\(x, y\)/);
    expect(errorOf('(1, 2)')).toMatch(/three coordinates/);
    expect(errorOf('z > x')).toMatch(/Inequalities/);
    expect(errorOf('z = x {x > 0}')).toMatch(/Restrictions/);
    expect(errorOf('a = 5')).toMatch(/no x, y or z/);
    expect(errorOf('(t, z, 1)')).toMatch(/vary with t/);
  });

  it('leaves 2D parsing as it was', () => {
    expect(parseGraphExpression('(1, 2)')).toMatchObject({ ok: true, kind: 'point' });
    expect(parseGraphExpression('(1, 2, 3)').ok).toBe(false);
  });

  it('parses every 3D example', () => {
    for (const preset of GRAPH_3D_PRESETS) {
      expect(parseGraph3dExpression(preset.expression).ok, preset.name).toBe(true);
    }
  });

  it('makes sliders for a 3D graph without a z among them', () => {
    const rows = [row('z = a x + b')];
    expect(Object.keys(reconcileGraphParameters(rows, {}, true))).toEqual(['a', 'b']);
  });
});

describe('3D scene', () => {
  it('clips segments, and lines, to the box', () => {
    expect(clipToBox({ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, box)).toEqual([0.25, 0.75]);
    expect(clipToBox({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, box, true)).toEqual([-5, 5]);
    expect(clipToBox({ x: 0, y: 9, z: 0 }, { x: 1, y: 9, z: 0 }, box, true)).toBeNull();
  });

  it('tiles a surface across the box and clips it to the z range', () => {
    const flat = scene(row('z = 0'));
    expect(flat).toHaveLength(16 * 16);
    expect(flat.every((p) => p.kind === 'face' && pointsOf(p).every(within))).toBe(true);

    const bowl = scene(row('z = x^2 + y^2'));
    expect(bowl.length).toBeGreaterThan(0);
    expect(bowl.every((p) => pointsOf(p).every(within))).toBe(true);

    expect(scene(row('z = 100'))).toHaveLength(0);
  });

  it('lays a plane flat along its own axes', () => {
    const wall = scene(row('x = 2'));
    expect(wall.length).toBeGreaterThan(0);
    expect(wall.every((p) => pointsOf(p).every((q) => Math.abs(q.x - 2) < 1e-9))).toBe(true);
  });

  it('draws a line across the whole box and a curve only inside it', () => {
    const line = scene(row('(0, 0, 0) + t(1, 0, 0)'));
    const xs = line.flatMap(pointsOf).map((p) => p.x);
    expect(Math.min(...xs)).toBeCloseTo(-5);
    expect(Math.max(...xs)).toBeCloseTo(5);

    const spiral = scene(row('(t, 0, 0)', { domain: { min: -20, max: 20 } }));
    expect(spiral.every((p) => pointsOf(p).every(within))).toBe(true);
  });

  it('skips hidden rows and points outside the box', () => {
    expect(scene(row('z = 0', { visible: false }))).toHaveLength(0);
    expect(scene(row('(9, 0, 0)'))).toHaveLength(0);
    expect(scene(row('(1, 1, 1)'))).toEqual([{ kind: 'dot', point: { x: 1, y: 1, z: 1 }, source: 0 }]);
  });
});

describe('3D projection', () => {
  it('faces down y at no turn: x right, z up, −y nearest', () => {
    const projection = createProjection(box, { yaw: 0, pitch: 0 }, area);
    const origin = projection.project({ x: 0, y: 0, z: 0 });
    expect(origin.x).toBeCloseTo(200);
    expect(origin.y).toBeCloseTo(200);
    expect(projection.project({ x: 5, y: 0, z: 0 }).x).toBeGreaterThan(origin.x);
    expect(projection.project({ x: 0, y: 0, z: 5 }).y).toBeLessThan(origin.y);
    expect(projection.project({ x: 0, y: -5, z: 0 }).depth).toBeGreaterThan(
      projection.project({ x: 0, y: 5, z: 0 }).depth,
    );
  });

  it('keeps the box inside the plot at any angle', () => {
    for (const yaw of [-170, -125, -45, 0, 30, 90]) {
      for (const pitch of [-90, -30, 0, 25, 90]) {
        const projection = createProjection(box, { yaw, pitch }, area);
        for (const x of [-5, 5]) {
          for (const y of [-5, 5]) {
            for (const z of [-5, 5]) {
              const p = projection.project({ x, y, z });
              expect(p.x).toBeGreaterThanOrEqual(0);
              expect(p.x).toBeLessThanOrEqual(400);
              expect(p.y).toBeGreaterThanOrEqual(0);
              expect(p.y).toBeLessThanOrEqual(400);
            }
          }
        }
      }
    }
  });

  it('paints far to near', () => {
    const projection = createProjection(box, { yaw: -125, pitch: 25 }, area);
    const placed = projectScene(scene(row('z = x*y/5')), projection, box);
    const depth = (item: (typeof placed)[number]) => {
      const points = item.kind === 'dot' ? [item.point] : item.points;
      return points.reduce((sum, p) => sum + p.depth, 0) / points.length;
    };
    for (let i = 1; i < placed.length; i += 1) {
      expect(depth(placed[i]!)).toBeGreaterThanOrEqual(depth(placed[i - 1]!) - 1e-12);
    }
  });

  it('numbers each axis along an outer edge', () => {
    const projection = createProjection(box, { yaw: -125, pitch: 25 }, area);
    const labels = axisLabels3d(box, projection);
    expect(labels.map((label) => label.axis)).toEqual(['x', 'y', 'z']);
    for (const label of labels) {
      expect(label.ticks.length).toBeGreaterThan(1);
    }
    // z is numbered up its left side.
    const z = labels[2]!;
    expect(z.ticks.every((tick) => tick.x < projection.center.x)).toBe(true);
  });
});

describe('3D view edits', () => {
  const view = { yaw: 170, pitch: 80, zMin: -2, zMax: 4 };

  it('turns with the drag, wrapping yaw and stopping pitch at the poles', () => {
    const turned = orbitView(view, 40, 40);
    expect(turned.yaw).toBeCloseTo(-170);
    expect(turned.pitch).toBe(90);
    expect(orbitView(view, 0, -400).pitch).toBe(-90);
  });

  it('zooms all three ranges about their middles', () => {
    const zoomed = zoomGraph3d({ xMin: -10, xMax: 10, yMin: 0, yMax: 4 }, view, 0.5);
    expect(zoomed.viewport).toEqual({ xMin: -5, xMax: 5, yMin: 1, yMax: 3 });
    expect(zoomed.view3d).toMatchObject({ zMin: -0.5, zMax: 2.5, yaw: 170 });
  });

  it('lights hex colours toward white and shadows them toward black', () => {
    expect(tone('#808080', 0.5)).toBe('#808080');
    expect(tone('#000000', 1)).toBe('#666666');
    expect(tone('#ffffff', 0)).toBe('#999999');
    expect(tone('var(--x)', 1)).toBe('var(--x)');
  });
});

describe('3D graph rendering', () => {
  it('renders to plain SVG, as PNG export does', () => {
    const shape: GraphShape = {
      id: 'g',
      type: 'graph',
      x: 0,
      y: 0,
      rotation: 0,
      index: 'a0',
      props: {
        ...createDefaultGraphProps(),
        w: 400,
        h: 400,
        expressions: [row('z = x*y/10'), row('(1, 2, 3)')],
        view3d: { yaw: -125, pitch: 25, zMin: -10, zMax: 10 },
      },
    };
    const svg = renderToStaticMarkup(createElement(graphUtil.Component, { shape }));
    expect(svg.match(/fill-opacity="0.85"/g)?.length).toBeGreaterThan(100);
    expect(svg).toContain('<circle');
    expect(svg).toMatch(/>z<\/text>/);
    expect(svg).not.toContain('foreignObject');
  });
});
