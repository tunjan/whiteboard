import { describe, expect, it } from 'vitest';
import type { ArrowShape, RectangleShape, Shape } from '@whiteboard/shared';
import { BindingGraph } from './binding-graph';

function arrow(
  id: string,
  bindings: ArrowShape['props']['bindings'] = {},
): ArrowShape {
  return {
    id,
    type: 'arrow',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a0',
    props: {
      points: [
        { x: 0, y: 0 },
        { x: 10, y: 10 },
      ],
      color: '#000',
      size: 2,
      dash: 'solid',
      arrowStart: false,
      arrowEnd: true,
      bend: 0,
      topology: 'straight',
      bindings,
      label: '',
    },
  };
}

function bindTo(shapeId: string) {
  return { shapeId, anchor: { x: 0.5, y: 0.5 } };
}

function rectangle(id: string): RectangleShape {
  return {
    id,
    type: 'rectangle',
    x: 0,
    y: 0,
    rotation: 0,
    index: 'a1',
    props: { w: 10, h: 10, color: '#000', fillStyle: 'none', dash: 'solid', size: 2 },
  };
}

const sorted = (ids: Iterable<string>) => [...ids].sort();

describe('BindingGraph', () => {
  it('starts empty', () => {
    const g = new BindingGraph();
    expect(g.isEmpty).toBe(true);
    expect(g.arrowsBoundTo('box')).toEqual([]);
  });

  it('indexes an arrow bound at one end', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box') }));
    expect(g.arrowsBoundTo('box')).toEqual(['a']);
    expect(g.isEmpty).toBe(false);
  });

  it('indexes both endpoints of an arrow', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box1'), end: bindTo('box2') }));
    expect(g.arrowsBoundTo('box1')).toEqual(['a']);
    expect(g.arrowsBoundTo('box2')).toEqual(['a']);
  });

  it('records an arrow once when both ends bind the same target', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box'), end: bindTo('box') }));
    expect(g.arrowsBoundTo('box')).toEqual(['a']);
  });

  it('collects several arrows bound to one target', () => {
    const g = new BindingGraph();
    g.update(arrow('a1', { start: bindTo('box') }));
    g.update(arrow('a2', { end: bindTo('box') }));
    expect(sorted(g.arrowsBoundTo('box'))).toEqual(['a1', 'a2']);
  });

  it('ignores non-arrow shapes', () => {
    const g = new BindingGraph();
    g.update(rectangle('box'));
    expect(g.isEmpty).toBe(true);
  });

  it('ignores an arrow with no bindings', () => {
    const g = new BindingGraph();
    g.update(arrow('a'));
    expect(g.isEmpty).toBe(true);
  });

  it('treats a null binding as unbound', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: null, end: null }));
    expect(g.isEmpty).toBe(true);
  });

  it('drops the old edge when an arrow is rebound to a different target', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box1') }));
    g.update(arrow('a', { start: bindTo('box2') }));
    expect(g.arrowsBoundTo('box1')).toEqual([]);
    expect(g.arrowsBoundTo('box2')).toEqual(['a']);
  });

  it('removes the edge when an arrow is unbound', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box') }));
    g.update(arrow('a', {}));
    expect(g.arrowsBoundTo('box')).toEqual([]);
    expect(g.isEmpty).toBe(true);
  });

  it('is idempotent when an arrow is reindexed unchanged', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box') }));
    g.update(arrow('a', { start: bindTo('box') }));
    expect(g.arrowsBoundTo('box')).toEqual(['a']);
  });

  it('removes an arrow entirely', () => {
    const g = new BindingGraph();
    g.update(arrow('a1', { start: bindTo('box') }));
    g.update(arrow('a2', { start: bindTo('box') }));
    g.remove('a1');
    expect(g.arrowsBoundTo('box')).toEqual(['a2']);
    g.remove('a2');
    expect(g.arrowsBoundTo('box')).toEqual([]);
    expect(g.isEmpty).toBe(true);
  });

  it('tolerates removing an unknown id', () => {
    const g = new BindingGraph();
    expect(() => g.remove('nope')).not.toThrow();
  });

  it('clears everything', () => {
    const g = new BindingGraph();
    g.update(arrow('a', { start: bindTo('box') }));
    g.clear();
    expect(g.isEmpty).toBe(true);
    expect(g.arrowsBoundTo('box')).toEqual([]);
  });

  describe('expand', () => {
    it('returns the changed ids themselves', () => {
      const g = new BindingGraph();
      expect(sorted(g.expand(['x', 'y']))).toEqual(['x', 'y']);
    });

    it('pulls in arrows bound to a changed target', () => {
      const g = new BindingGraph();
      g.update(arrow('a1', { start: bindTo('box') }));
      g.update(arrow('a2', { end: bindTo('box') }));
      expect(sorted(g.expand(['box']))).toEqual(['a1', 'a2', 'box']);
    });

    it('does not pull in arrows bound to untouched targets', () => {
      const g = new BindingGraph();
      g.update(arrow('a1', { start: bindTo('box1') }));
      g.update(arrow('a2', { start: bindTo('box2') }));
      expect(sorted(g.expand(['box1']))).toEqual(['a1', 'box1']);
    });

    it('does not duplicate an arrow that both changed and is bound', () => {
      const g = new BindingGraph();
      g.update(arrow('a', { start: bindTo('box') }));
      expect(sorted(g.expand(['box', 'a']))).toEqual(['a', 'box']);
    });

    it('expands a multi-target change set', () => {
      const g = new BindingGraph();
      g.update(arrow('a1', { start: bindTo('box1') }));
      g.update(arrow('a2', { start: bindTo('box2') }));
      expect(sorted(g.expand(['box1', 'box2']))).toEqual([
        'a1',
        'a2',
        'box1',
        'box2',
      ]);
    });

    it('stays single-hop: an arrow bound to a box does not drag in the box’s other arrows', () => {
      // Arrows are not bindable targets, so expansion terminates after one step.
      const g = new BindingGraph();
      g.update(arrow('a1', { start: bindTo('box') }));
      g.update(arrow('a2', { start: bindTo('box') }));
      expect(sorted(g.expand(['a1']))).toEqual(['a1']);
    });

    it('returns an empty set for no changes', () => {
      const g = new BindingGraph();
      g.update(arrow('a', { start: bindTo('box') }));
      expect([...g.expand([])]).toEqual([]);
    });
  });

  it('takes over another graph and leaves it empty', () => {
    const parked = new BindingGraph();
    parked.update(arrow('a', { start: bindTo('box') }));

    const live = new BindingGraph();
    live.update(arrow('other', { start: bindTo('elsewhere') }));
    live.adopt(parked);

    expect(live.arrowsBoundTo('box')).toEqual(['a']);
    expect(live.arrowsBoundTo('elsewhere')).toEqual([]);
    expect(parked.isEmpty).toBe(true);

    // Both sides keep their own maps: writing to one must not reach the other.
    parked.update(arrow('c', { start: bindTo('box') }));
    expect(live.arrowsBoundTo('box')).toEqual(['a']);
  });

  it('accepts a heterogeneous shape stream without special-casing at the call site', () => {
    const g = new BindingGraph();
    const stream: Shape[] = [
      rectangle('box'),
      arrow('a', { start: bindTo('box') }),
      rectangle('box2'),
    ];
    for (const s of stream) g.update(s);
    expect(g.arrowsBoundTo('box')).toEqual(['a']);
    expect(g.arrowsBoundTo('box2')).toEqual([]);
  });
});
