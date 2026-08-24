import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Exercises the worker path, which the rest of the suite never reaches: with no
 * `Worker` in Node, every other test converts in-process. A fake one lets the
 * lifecycle around a conversion — timing out, replacing a wedged thread, and
 * deciding which requests deserve a second run — be driven directly.
 */

interface PostedMessage {
  id: number;
  latex: string;
}

class FakeWorker {
  static instances: FakeWorker[] = [];

  posted: PostedMessage[] = [];
  terminated = false;
  private listeners = new Map<string, Set<(event: unknown) => void>>();

  constructor() {
    FakeWorker.instances.push(this);
  }

  addEventListener(type: string, listener: (event: unknown) => void): void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(listener);
    this.listeners.set(type, set);
  }

  postMessage(message: PostedMessage): void {
    this.posted.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  /** Answer a request the way the real worker would. */
  reply(id: number, render: unknown): void {
    for (const listener of this.listeners.get('message') ?? []) {
      listener({ data: { id, render } });
    }
  }

  /** Fail the way a worker that cannot start does. */
  fail(): void {
    for (const listener of this.listeners.get('error') ?? []) {
      listener({ message: 'boom' });
    }
  }
}

async function loadClient() {
  vi.resetModules();
  FakeWorker.instances = [];
  vi.stubGlobal('Worker', FakeWorker);
  return import('./equation-typeset-client');
}

const only = () => {
  const [worker] = FakeWorker.instances;
  if (!worker) throw new Error('no worker was spawned');
  return worker;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('typesetting on a worker thread', () => {
  it('resolves with what the worker sent back', async () => {
    const { typesetOnce } = await loadClient();
    const render = { svg: '<svg />', width: 10, height: 5 };

    const pending = typesetOnce('x^2');
    expect(only().posted).toEqual([
      { id: expect.any(Number), latex: 'x^2', inline: false },
    ]);

    only().reply(only().posted[0]!.id, render);
    await expect(pending).resolves.toEqual(render);
  });

  // The style is half of what identifies a render, so it has to survive the
  // trip: a worker told only the source would answer every request in display
  // style and the caller would cache the answer under the style it asked for.
  it('sends the requested style across with the source', async () => {
    const { typesetOnce } = await loadClient();

    void typesetOnce('x^2', true);
    expect(only().posted).toEqual([
      { id: expect.any(Number), latex: 'x^2', inline: true },
    ]);
  });

  it('keeps concurrent requests apart', async () => {
    const { typesetOnce } = await loadClient();

    const first = typesetOnce('a');
    const second = typesetOnce('b');
    const [postedFirst, postedSecond] = only().posted;

    // Answered out of order, because a worker is free to do that.
    only().reply(postedSecond!.id, { svg: '<svg>b</svg>', width: 2, height: 2 });
    only().reply(postedFirst!.id, { svg: '<svg>a</svg>', width: 1, height: 1 });

    await expect(first).resolves.toMatchObject({ svg: '<svg>a</svg>' });
    await expect(second).resolves.toMatchObject({ svg: '<svg>b</svg>' });
  });

  // A conversion cannot be interrupted from inside; abandoning the thread is
  // the only way out, which is the whole reason the work moved off the main one.
  it('gives up on a conversion that never finishes and replaces the thread', async () => {
    const { typesetOnce } = await loadClient();

    const pending = typesetOnce('\\wedged');
    await vi.advanceTimersByTimeAsync(5_000);

    // Settled as an ordinary render error, so it caches like any other result
    // rather than being retried into the next worker.
    await expect(pending).resolves.toEqual({
      error: 'This equation took too long to render.',
    });
    expect(only().terminated).toBe(true);
  });

  it('re-runs the requests that were only queued behind the wedged one', async () => {
    const { typesetOnce } = await loadClient();

    const wedged = typesetOnce('\\wedged');
    const innocent = typesetOnce('x');
    const [wedgedPost] = only().posted;

    // Only the first request's timer fires; the second was still waiting.
    await vi.advanceTimersByTimeAsync(5_000);
    await expect(wedged).resolves.toMatchObject({ error: expect.any(String) });

    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1]!;
    const resent = replacement.posted.find((m) => m.latex === 'x');
    expect(resent).toBeDefined();
    expect(resent?.id).not.toBe(wedgedPost?.id);

    replacement.reply(resent!.id, { svg: '<svg>x</svg>', width: 1, height: 1 });
    await expect(innocent).resolves.toMatchObject({ svg: '<svg>x</svg>' });
  });

  it('stops re-running a request that a second thread also lost', async () => {
    const { typesetOnce } = await loadClient();

    const first = typesetOnce('\\wedged');
    const second = typesetOnce('\\alsoWedged');
    const bystander = typesetOnce('x');
    // Attached before any timer runs: advancing them settles these promises,
    // and a rejection with no handler yet attached is an unhandled one.
    const outcomes = Promise.all([
      expect(first).resolves.toMatchObject({ error: expect.any(String) }),
      expect(second).resolves.toMatchObject({ error: expect.any(String) }),
      expect(bystander).rejects.toThrow(/restarted/),
    ]);

    // The first thread is abandoned; the other two were merely queued, so both
    // get a run on the replacement.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(FakeWorker.instances).toHaveLength(2);

    // The replacement wedges too. Whichever request ran out of time owns that
    // failure, but the bystander has now been carried through two dead threads
    // — retrying it again would just follow them down.
    await vi.advanceTimersByTimeAsync(5_000);
    await outcomes;
  });

  it('abandons in-flight work when the worker itself breaks', async () => {
    const { typesetOnce } = await loadClient();

    const pending = typesetOnce('x');
    only().fail();

    await expect(pending).rejects.toThrow(/stopped unexpectedly/);
  });

  // A rejected request is deliberately not cached by `equation-render`, so the
  // next render retries it — which needs a working thread to retry onto.
  it('starts a fresh worker for the request after a failure', async () => {
    const { typesetOnce } = await loadClient();

    const failed = typesetOnce('x');
    only().fail();
    await expect(failed).rejects.toThrow();

    const retry = typesetOnce('x');
    expect(FakeWorker.instances).toHaveLength(2);
    const replacement = FakeWorker.instances[1]!;
    replacement.reply(replacement.posted[0]!.id, {
      svg: '<svg />',
      width: 1,
      height: 1,
    });
    await expect(retry).resolves.toMatchObject({ svg: '<svg />' });
  });
});
