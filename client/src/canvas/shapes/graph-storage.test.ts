import { describe, expect, it } from 'vitest';
import * as Y from 'yjs';
import type { GraphExpression } from '@whiteboard/shared';
import {
  encodeGraphExpressionsForStorage,
  ensureGraphExpressionsArray,
  readGraphExpressions,
  syncYGraphExpressions,
  type YGraphExpression,
} from './graph-storage';

const curve = (
  id: string,
  expression: string,
  overrides: Partial<GraphExpression> = {},
): GraphExpression => ({
  id,
  expression,
  color: '#1d1d1d',
  visible: true,
  dash: 'solid',
  ...overrides,
});

const baseProps = {
  w: 420,
  h: 280,
  viewport: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
  parameters: {},
  showAxisLabels: true,
};

/** A graph shape in the current storage form: one Y.Map per curve. */
function modernShape(expressions: GraphExpression[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'graph');
  m.set('props', { ...baseProps });
  m.set('expressions', Y.Array.from(encodeGraphExpressionsForStorage(expressions)));
  return m;
}

/** A graph shape as boards written before expressions left `props` store it. */
function legacyShape(expressions: GraphExpression[]): Y.Map<unknown> {
  const doc = new Y.Doc();
  const m = new Y.Map<unknown>();
  doc.getMap('shapes').set('s', m);
  m.set('type', 'graph');
  m.set('props', { ...baseProps, expressions });
  return m;
}

function expressionsOf(m: Y.Map<unknown>): GraphExpression[] {
  return readGraphExpressions(
    m,
    (m.get('props') as Record<string, unknown>) ?? {},
  );
}

function arrayOf(m: Y.Map<unknown>): Y.Array<YGraphExpression> {
  return m.get('expressions') as Y.Array<YGraphExpression>;
}

describe('graph expression storage', () => {
  it('round-trips expressions through the array', () => {
    const expressions = [
      curve('a', 'y=sin(x)'),
      curve('b', 'x^2+y^2=4', { color: '#ff0000', dash: 'dashed', width: 3.5 }),
      curve('c', '(cos(t), sin(t))', { domain: { min: 0, max: 3.14 } }),
    ];

    expect(expressionsOf(modernShape(expressions))).toEqual(expressions);
  });

  it('omits absent optional fields rather than storing undefined', () => {
    const stored = expressionsOf(modernShape([curve('a', 'y=x')]))[0]!;

    expect('width' in stored).toBe(false);
    expect('domain' in stored).toBe(false);
  });

  it('reads a legacy props-array graph in place', () => {
    const expressions = [curve('a', 'y=sin(x)')];
    const m = legacyShape(expressions);

    expect(m.get('expressions')).toBeUndefined();
    expect(expressionsOf(m)).toEqual(expressions);
  });

  it('promotes a legacy graph to a Y.Array on first write', () => {
    const m = legacyShape([curve('a', 'y=sin(x)')]);

    syncYGraphExpressions(ensureGraphExpressionsArray(m), [
      curve('a', 'y=cos(x)'),
    ]);

    expect(m.get('expressions')).toBeInstanceOf(Y.Array);
    expect(expressionsOf(m)[0]!.expression).toBe('y=cos(x)');
  });

  it('adds, removes and reorders rows by id', () => {
    const m = modernShape([curve('a', 'y=x'), curve('b', 'y=2*x')]);
    const arr = arrayOf(m);

    syncYGraphExpressions(arr, [
      curve('b', 'y=2*x'),
      curve('c', 'y=3*x'),
      curve('a', 'y=x'),
    ]);

    expect(expressionsOf(m).map((e) => e.id)).toEqual(['b', 'c', 'a']);

    syncYGraphExpressions(arr, [curve('c', 'y=3*x')]);
    expect(expressionsOf(m).map((e) => e.id)).toEqual(['c']);
  });

  it('keeps concurrent edits to different rows', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    const m = new Y.Map<unknown>();
    local.getMap('shapes').set('s', m);
    m.set('type', 'graph');
    m.set('props', { ...baseProps });
    m.set(
      'expressions',
      Y.Array.from(
        encodeGraphExpressionsForStorage([
          curve('a', 'y=sin(x)'),
          curve('b', 'y=cos(x)'),
        ]),
      ),
    );
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    const remoteMap = remote.getMap('shapes').get('s') as Y.Map<unknown>;
    // Two people, one row each, neither having seen the other's edit.
    syncYGraphExpressions(arrayOf(m), [
      curve('a', 'y=sin(2*x)'),
      curve('b', 'y=cos(x)'),
    ]);
    syncYGraphExpressions(arrayOf(remoteMap), [
      curve('a', 'y=sin(x)'),
      curve('b', 'y=cos(3*x)'),
    ]);

    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    expect(expressionsOf(m).map((e) => e.expression)).toEqual([
      'y=sin(2*x)',
      'y=cos(3*x)',
    ]);
  });

  it('keeps concurrent edits to different fields of one row', () => {
    const local = new Y.Doc();
    const remote = new Y.Doc();
    const m = new Y.Map<unknown>();
    local.getMap('shapes').set('s', m);
    m.set('type', 'graph');
    m.set('props', { ...baseProps });
    m.set(
      'expressions',
      Y.Array.from(encodeGraphExpressionsForStorage([curve('a', 'y=sin(x)')])),
    );
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));
    const remoteMap = remote.getMap('shapes').get('s') as Y.Map<unknown>;

    syncYGraphExpressions(arrayOf(m), [
      curve('a', 'y=sin(x)', { color: '#ff0000' }),
    ]);
    syncYGraphExpressions(arrayOf(remoteMap), [
      curve('a', 'y=sin(x)', { dash: 'dotted' }),
    ]);

    Y.applyUpdate(local, Y.encodeStateAsUpdate(remote));
    Y.applyUpdate(remote, Y.encodeStateAsUpdate(local));

    const merged = expressionsOf(m)[0]!;
    expect(merged.color).toBe('#ff0000');
    expect(merged.dash).toBe('dotted');
  });

  it('writes only the row that changed', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    doc.getMap('shapes').set('s', m);
    m.set('type', 'graph');
    m.set('props', { ...baseProps });
    const expressions = Array.from({ length: 8 }, (_, i) =>
      curve(`e${i}`, `y=${i}*sin(${i}*x)+cos(x)`),
    );
    m.set(
      'expressions',
      Y.Array.from(encodeGraphExpressionsForStorage(expressions)),
    );

    const before = Y.encodeStateAsUpdate(doc).byteLength;
    // One keystroke in one row.
    syncYGraphExpressions(arrayOf(m), [
      ...expressions.slice(0, 3),
      curve('e3', 'y=3*sin(3*x)+cos(x)+1'),
      ...expressions.slice(4),
    ]);
    const growth = Y.encodeStateAsUpdate(doc).byteLength - before;

    // The one new string, not a fresh copy of all eight rows.
    expect(growth).toBeLessThan(80);
  });

  it('leaves the document untouched when nothing changed', () => {
    const doc = new Y.Doc();
    const m = new Y.Map<unknown>();
    doc.getMap('shapes').set('s', m);
    m.set('type', 'graph');
    m.set('props', { ...baseProps });
    const expressions = [
      curve('a', 'y=sin(x)', { width: 2.25, domain: { min: 0, max: 6.28 } }),
      curve('b', 'y=cos(x)'),
    ];
    m.set(
      'expressions',
      Y.Array.from(encodeGraphExpressionsForStorage(expressions)),
    );

    const before = Y.encodeStateAsUpdate(doc).byteLength;
    syncYGraphExpressions(arrayOf(m), expressions.map((e) => ({ ...e })));

    expect(Y.encodeStateAsUpdate(doc).byteLength).toBe(before);
  });
});
