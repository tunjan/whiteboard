// Hierarchical state machine for interaction tools.
//
// A tool is a tree of states: `select` is a branch whose leaves are `idle`,
// `translating`, `resizing`, and so on. Exactly one path through the tree is
// active at a time, and events are dispatched along that path from the root
// down to the active leaf. Each state owns its own transient interaction data,
// which is what keeps a drag's bookkeeping from leaking into the idle state.
//
// Transitions are addressed by dotted path relative to the node you call them
// on: `root.transition('select.translating')`.

export interface StateEvent {
  /** e.g. 'pointer_down'. Mapped to an `onPointerDown` handler. */
  name: string;
  [key: string]: unknown;
}

/** Arbitrary payload handed to `onEnter`/`onExit` and carried by a transition. */
export type StateTransitionInfo = Record<string, unknown>;

const EVENT_HANDLER_NAMES: Record<string, string> = {
  pointer_down: 'onPointerDown',
  pointer_move: 'onPointerMove',
  pointer_up: 'onPointerUp',
  double_click: 'onDoubleClick',
  key_down: 'onKeyDown',
  key_up: 'onKeyUp',
  wheel: 'onWheel',
  cancel: 'onCancel',
  complete: 'onComplete',
};

export abstract class StateNode {
  abstract readonly id: string;

  parent?: StateNode;

  private readonly childStates = new Map<string, StateNode>();
  private initialChildId?: string;
  private activeChild?: StateNode;
  private active = false;

  /** 'root' and 'branch' have children; a 'leaf' does not. */
  get type(): 'root' | 'branch' | 'leaf' {
    if (this.childStates.size === 0) return 'leaf';
    return this.parent ? 'branch' : 'root';
  }

  /**
   * Register child states. The first one registered is the default entry point
   * unless another is named via {@link setInitialChild}.
   */
  addChildren(...children: StateNode[]): this {
    for (const child of children) {
      child.parent = this;
      this.childStates.set(child.id, child);
      this.initialChildId ??= child.id;
    }
    return this;
  }

  setInitialChild(id: string): this {
    if (!this.childStates.has(id)) {
      throw new Error(`StateNode "${this.id}" has no child "${id}"`);
    }
    this.initialChildId = id;
    return this;
  }

  getChild(id: string): StateNode | undefined {
    return this.childStates.get(id);
  }

  getCurrent(): StateNode | undefined {
    return this.activeChild;
  }

  getIsActive(): boolean {
    return this.active;
  }

  /** Dotted path of the active branch below (and including) this node. */
  getPath(): string {
    const current = this.activeChild;
    return current ? `${this.id}.${current.getPath()}` : this.id;
  }

  /** The deepest active descendant, or this node when it is a leaf. */
  getDeepestActive(): StateNode {
    return this.activeChild ? this.activeChild.getDeepestActive() : this;
  }

  /**
   * Activate the state at `path` (dotted, relative to this node), exiting
   * whatever was active along the way. Re-entering the state that is already
   * active at a given level is a no-op at that level, so a transition to a
   * sibling leaf does not tear down and rebuild the shared parent.
   */
  transition(path: string, info: StateTransitionInfo = {}): this {
    const segments = path.split('.').filter(Boolean);
    if (segments.length === 0) return this;

    let node: StateNode = this;
    for (const segment of segments) {
      const next = node.childStates.get(segment);
      if (!next) {
        throw new Error(
          `Invalid state transition: "${segment}" is not a child of "${node.getPath()}"`,
        );
      }
      const previous = node.activeChild;
      if (previous === next) {
        node = next;
        continue;
      }
      // Tear the old branch down from its deepest state upwards before the new
      // one is entered, so an exiting leaf still sees a consistent tree.
      if (previous) previous.exit(info, next.id);
      node.activeChild = next;
      next.enterSelf(info, previous?.id ?? 'initial');
      node = next;
    }

    // Landing on a branch continues into its default child.
    node.enterInitialChild(info);
    return this;
  }

  /** Enter this node (and its default child chain). Used for the root state. */
  enter(info: StateTransitionInfo = {}, from = 'initial'): void {
    this.enterSelf(info, from);
    this.enterInitialChild(info);
  }

  /** Exit this node, deepest active descendant first. */
  exit(info: StateTransitionInfo = {}, to = 'none'): void {
    if (this.activeChild) {
      this.activeChild.exit(info, to);
      this.activeChild = undefined;
    }
    if (!this.active) return;
    this.active = false;
    this.onExit?.(info, to);
  }

  /**
   * Dispatch an event down the active path: this node handles it first, then
   * the active child, and so on to the leaf. A handler may call `transition`,
   * which is why the child is re-read after the local handler runs.
   */
  handleEvent(event: StateEvent): void {
    if (!this.active) return;
    const handlerName = EVENT_HANDLER_NAMES[event.name];
    if (handlerName) {
      const handler = (this as unknown as Record<string, unknown>)[handlerName];
      if (typeof handler === 'function') {
        (handler as (e: StateEvent) => void).call(this, event);
      }
    }
    this.activeChild?.handleEvent(event);
  }

  private enterSelf(info: StateTransitionInfo, from: string): void {
    this.active = true;
    this.onEnter?.(info, from);
  }

  private enterInitialChild(info: StateTransitionInfo): void {
    if (this.activeChild || !this.initialChildId) return;
    const child = this.childStates.get(this.initialChildId);
    if (!child) return;
    this.activeChild = child;
    child.enterSelf(info, 'initial');
    child.enterInitialChild(info);
  }

  onEnter?(info: StateTransitionInfo, from: string): void;
  onExit?(info: StateTransitionInfo, to: string): void;
}
