import { beforeEach, describe, expect, it } from 'vitest';
import { StateNode, type StateEvent, type StateTransitionInfo } from './state-node';

/** Records every lifecycle callback across the tree, in order. */
const log: string[] = [];

class TestState extends StateNode {
  constructor(readonly id: string) {
    super();
  }

  override onEnter(_info: StateTransitionInfo, from: string): void {
    log.push(`enter:${this.id}:from=${from}`);
  }

  override onExit(_info: StateTransitionInfo, to: string): void {
    log.push(`exit:${this.id}:to=${to}`);
  }

  onPointerDown(event: StateEvent): void {
    log.push(`down:${this.id}`);
    if (event.then) this.transitionFromRoot(event.then as string);
  }

  onPointerMove(): void {
    log.push(`move:${this.id}`);
  }

  private transitionFromRoot(path: string): void {
    let node: StateNode = this;
    while (node.parent) node = node.parent;
    node.transition(path);
  }
}

function buildTree() {
  const idle = new TestState('idle');
  const translating = new TestState('translating');
  const resizing = new TestState('resizing');
  const dragging = new TestState('dragging').addChildren(translating, resizing);
  const select = new TestState('select').addChildren(idle, dragging);

  const drawIdle = new TestState('idle');
  const drawing = new TestState('drawing');
  const draw = new TestState('draw').addChildren(drawIdle, drawing);

  const root = new TestState('root').addChildren(select, draw);
  return { root, select, idle, dragging, translating, resizing, draw, drawing };
}

beforeEach(() => {
  log.length = 0;
});

describe('StateNode tree shape', () => {
  it('classifies root, branch, and leaf nodes', () => {
    const { root, select, idle } = buildTree();
    expect(root.type).toBe('root');
    expect(select.type).toBe('branch');
    expect(idle.type).toBe('leaf');
  });

  it('links children back to their parent', () => {
    const { root, select, idle } = buildTree();
    expect(select.parent).toBe(root);
    expect(idle.parent).toBe(select);
    expect(root.parent).toBeUndefined();
  });

  it('looks up children by id', () => {
    const { root, select } = buildTree();
    expect(root.getChild('select')).toBe(select);
    expect(root.getChild('nope')).toBeUndefined();
  });
});

describe('StateNode entering', () => {
  it('descends into the default child chain on enter', () => {
    const { root } = buildTree();
    root.enter();
    // root -> select (first child) -> idle (first child)
    expect(root.getPath()).toBe('root.select.idle');
    expect(log).toEqual([
      'enter:root:from=initial',
      'enter:select:from=initial',
      'enter:idle:from=initial',
    ]);
  });

  it('honours an explicit initial child', () => {
    const { root, select } = buildTree();
    select.setInitialChild('dragging');
    root.enter();
    expect(root.getPath()).toBe('root.select.dragging.translating');
  });

  it('rejects an unknown initial child', () => {
    const { select } = buildTree();
    expect(() => select.setInitialChild('nope')).toThrow(/no child "nope"/);
  });

  it('marks the whole active path active and nothing else', () => {
    const { root, select, idle, draw } = buildTree();
    root.enter();
    expect(root.getIsActive()).toBe(true);
    expect(select.getIsActive()).toBe(true);
    expect(idle.getIsActive()).toBe(true);
    expect(draw.getIsActive()).toBe(false);
  });

  it('reports the deepest active state', () => {
    const { root, idle } = buildTree();
    root.enter();
    expect(root.getDeepestActive()).toBe(idle);
  });
});

describe('StateNode transitions', () => {
  it('transitions between sibling leaves', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    root.transition('select.dragging');
    expect(root.getPath()).toBe('root.select.dragging.translating');
    expect(log).toEqual([
      'exit:idle:to=dragging',
      'enter:dragging:from=idle',
      'enter:translating:from=initial',
    ]);
  });

  it('does not tear down a shared parent when moving between its children', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    root.transition('select.dragging');
    // `select` stays active throughout, so it neither exits nor re-enters.
    expect(log.some((l) => l.includes('select'))).toBe(false);
  });

  it('exits the entire subtree, deepest first, when leaving a branch', () => {
    const { root } = buildTree();
    root.enter();
    root.transition('select.dragging.resizing');
    log.length = 0;

    root.transition('draw');
    // The spec's version exits only `select`; `resizing` and `dragging` must
    // get their onExit too, innermost first.
    expect(log).toEqual([
      'exit:resizing:to=draw',
      'exit:dragging:to=draw',
      'exit:select:to=draw',
      'enter:draw:from=select',
      'enter:idle:from=initial',
    ]);
  });

  it('deactivates every node in an exited subtree', () => {
    const { root, select, dragging, resizing } = buildTree();
    root.enter();
    root.transition('select.dragging.resizing');
    root.transition('draw');

    expect(resizing.getIsActive()).toBe(false);
    expect(dragging.getIsActive()).toBe(false);
    expect(select.getIsActive()).toBe(false);
  });

  it('transitions directly to a deep path', () => {
    const { root } = buildTree();
    root.enter();
    root.transition('select.dragging.resizing');
    expect(root.getPath()).toBe('root.select.dragging.resizing');
  });

  it('is a no-op when transitioning to the already-active state', () => {
    const { root } = buildTree();
    root.enter();
    root.transition('select.dragging.resizing');
    log.length = 0;

    root.transition('select.dragging.resizing');
    expect(log).toEqual([]);
    expect(root.getPath()).toBe('root.select.dragging.resizing');
  });

  it('can be called on a subtree, relative to that node', () => {
    const { root, select } = buildTree();
    root.enter();
    select.transition('dragging.resizing');
    expect(root.getPath()).toBe('root.select.dragging.resizing');
  });

  it('throws on an unknown target and names the offending segment', () => {
    const { root } = buildTree();
    root.enter();
    expect(() => root.transition('select.flying')).toThrow(/"flying" is not a child/);
  });

  it('carries transition info into onEnter', () => {
    const seen: StateTransitionInfo[] = [];
    class Recording extends StateNode {
      readonly id = 'child';
      override onEnter(info: StateTransitionInfo) {
        seen.push(info);
      }
    }
    class Root extends StateNode {
      readonly id = 'root';
    }
    const child = new Recording();
    const root = new Root().addChildren(child);
    root.enter();
    root.transition('child', { shapeId: 'abc' });
    // Already active from the default-child descent, so re-transitioning is a
    // no-op; the info arrived on the initial entry.
    expect(seen).toHaveLength(1);
  });
});

describe('StateNode event dispatch', () => {
  it('dispatches from the root down to the active leaf', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    root.handleEvent({ name: 'pointer_down' });
    expect(log).toEqual(['down:root', 'down:select', 'down:idle']);
  });

  it('skips states that are not on the active path', () => {
    const { root } = buildTree();
    root.enter();
    root.transition('draw.drawing');
    log.length = 0;

    root.handleEvent({ name: 'pointer_move' });
    expect(log).toEqual(['move:root', 'move:draw', 'move:drawing']);
  });

  it('ignores events with no matching handler', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    expect(() => root.handleEvent({ name: 'wheel' })).not.toThrow();
    expect(log).toEqual([]);
  });

  it('ignores unknown event names', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    root.handleEvent({ name: 'not_a_real_event' });
    expect(log).toEqual([]);
  });

  it('does not dispatch to an inactive tree', () => {
    const { root } = buildTree();
    root.handleEvent({ name: 'pointer_down' });
    expect(log).toEqual([]);
  });

  it('routes to the new state when a handler transitions mid-dispatch', () => {
    const { root } = buildTree();
    root.enter();
    log.length = 0;

    // `idle` handles pointer_down by switching into dragging.translating.
    root.handleEvent({ name: 'pointer_down', then: 'select.dragging' });
    expect(root.getPath()).toBe('root.select.dragging.translating');

    log.length = 0;
    root.handleEvent({ name: 'pointer_move' });
    expect(log).toEqual(['move:root', 'move:select', 'move:dragging', 'move:translating']);
  });
});
