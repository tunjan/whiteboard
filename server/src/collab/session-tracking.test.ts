import { describe, expect, it, vi } from 'vitest';
import * as Y from 'yjs';
import { signSession } from '../auth/jwt';
import {
  AFK_GRACE_MS,
  type SessionStore,
  countAddedShapes,
  createSessionTracker,
} from './session-tracking';

interface Row {
  boardId: string;
  name: string;
  color: string | null;
  isTutor: boolean;
  startedAt: Date;
  lastSeenAt: Date;
  edits: number;
}

function fakeStore() {
  const rows = new Map<number, Row>();
  let next = 1;
  const store: SessionStore = {
    async open(row) {
      const id = next++;
      rows.set(id, { ...row, lastSeenAt: row.startedAt, edits: 0 });
      return id;
    },
    async update(id, row) {
      rows.set(id, { ...rows.get(id)!, ...row });
    },
  };
  return { store, rows };
}

function tracker(store: SessionStore, now: () => number) {
  return createSessionTracker({ store, now, autoFlush: false });
}

// What actually arrives: Node's `IncomingMessage.headers`, a plain object,
// whatever the Hocuspocus types promise. A `Headers` still has to work, since
// that is what the hook is typed as and what other transports hand over.
const headers: Record<string, string | string[] | undefined> = {};

describe('session tracking', () => {
  it('reads the session cookie off either header shape', async () => {
    const { store, rows } = fakeStore();
    const t = tracker(store, () => 1_000_000);

    await t.connected({
      socketId: 's1',
      documentName: 'board-1',
      requestHeaders: { cookie: 'other=1; wb_session=not-a-real-token' },
    });
    await t.connected({
      socketId: 's2',
      documentName: 'board-1',
      requestHeaders: new Headers({ cookie: 'other=1' }),
    });

    // Neither token verifies, so both are students — the point is that reading
    // the header did not throw on either shape.
    expect([...rows.values()].map((r) => r.isTutor)).toEqual([false, false]);
  });


  it('opens a row on connect and closes it with the time last seen', async () => {
    const { store, rows } = fakeStore();
    let clock = 1_000_000;
    const t = tracker(store, () => clock);

    await t.connected({
      socketId: 's1',
      documentName: 'board-1',
      requestHeaders: headers,
    });
    expect(rows.size).toBe(1);

    clock += 60_000;
    t.awareness({
      socketId: 's1',
      documentName: 'board-1',
      user: { name: 'Ada', color: '#4F70A8' },
    });
    await t.disconnected({ socketId: 's1', documentName: 'board-1' });

    expect(rows.get(1)).toMatchObject({
      boardId: 'board-1',
      name: 'Ada',
      color: '#4F70A8',
      isTutor: false,
      edits: 0,
    });
    expect(
      rows.get(1)!.lastSeenAt.getTime() - rows.get(1)!.startedAt.getTime(),
    ).toBe(60_000);
    expect(t.size()).toBe(0);
  });

  it('opens one session per board, not per page document', async () => {
    const { store, rows } = fakeStore();
    const t = tracker(store, () => 1_000_000);

    await t.connected({
      socketId: 's1',
      documentName: 'board-1',
      requestHeaders: headers,
    });
    await t.connected({
      socketId: 's1',
      documentName: 'board-1/pages/page-2',
      requestHeaders: headers,
    });
    expect(rows.size).toBe(1);

    // A page edit still belongs to the board's session.
    t.change({ socketId: 's1', documentName: 'board-1/pages/page-2' });
    t.change({ socketId: 's1', documentName: 'board-1' });
    await t.flush();
    expect(rows.get(1)!.edits).toBe(2);
  });

  it('keeps two people on one board apart', async () => {
    const { store, rows } = fakeStore();
    const t = tracker(store, () => 1_000_000);

    await t.connected({
      socketId: 's1',
      documentName: 'board-1',
      requestHeaders: headers,
    });
    await t.connected({
      socketId: 's2',
      documentName: 'board-1',
      requestHeaders: headers,
    });
    t.awareness({
      socketId: 's1',
      documentName: 'board-1',
      user: { name: 'Ada' },
    });
    t.awareness({
      socketId: 's2',
      documentName: 'board-1',
      user: { name: 'Ben' },
    });
    await t.flush();

    expect([...rows.values()].map((r) => r.name)).toEqual(['Ada', 'Ben']);
  });

  it('writes nothing while a session is idle', async () => {
    const { store } = fakeStore();
    const update = vi.spyOn(store, 'update');
    const t = tracker(store, () => 1_000_000);

    await t.connected({
      socketId: 's1',
      documentName: 'board-1',
      requestHeaders: headers,
    });
    await t.flush();
    expect(update).not.toHaveBeenCalled();

    t.change({ socketId: 's1', documentName: 'board-1' });
    await t.flush();
    expect(update).toHaveBeenCalledTimes(1);

    await t.flush();
    expect(update).toHaveBeenCalledTimes(1);
  });

  it('ignores traffic from a connection it never opened', async () => {
    const { store, rows } = fakeStore();
    const t = tracker(store, () => 1_000_000);

    t.change({ socketId: 'ghost', documentName: 'board-1' });
    t.awareness({
      socketId: 'ghost',
      documentName: 'board-1',
      user: { name: 'Ada' },
    });
    await t.disconnected({ socketId: 'ghost', documentName: 'board-1' });
    expect(rows.size).toBe(0);
  });

  it('lists the boards a student is on, once each, and forgets them on leave', async () => {
    const { store } = fakeStore();
    const t = tracker(store, () => 1_000_000);

    for (const [socketId, documentName] of [
      ['s1', 'board-1'],
      ['s2', 'board-1'],
      ['s3', 'board-2'],
    ] as const) {
      await t.connected({ socketId, documentName, requestHeaders: headers });
    }
    expect(
      t
        .liveBoards()
        .map((b) => b.id)
        .sort(),
    ).toEqual(['board-1', 'board-2']);

    await t.disconnected({ socketId: 's3', documentName: 'board-2' });
    expect(t.liveBoards().map((b) => b.id)).toEqual(['board-1']);
  });
});

describe('countAddedShapes', () => {
  function updatesOf(doc: Y.Doc, run: () => void): Uint8Array[] {
    const updates: Uint8Array[] = [];
    const listen = (update: Uint8Array) => updates.push(update);
    doc.on('update', listen);
    run();
    doc.off('update', listen);
    return updates;
  }
  const total = (updates: Uint8Array[]) =>
    updates.reduce((sum, u) => sum + countAddedShapes(u), 0);

  it('counts new shapes, not edits to them', () => {
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes');
    const added = updatesOf(doc, () => {
      doc.transact(() => {
        for (const id of ['a', 'b']) {
          const shape = new Y.Map<unknown>();
          shape.set('id', id);
          shapes.set(id, shape);
        }
      });
    });
    expect(total(added)).toBe(2);

    const edited = updatesOf(doc, () => {
      shapes.get('a')!.set('x', 10);
      shapes.delete('b');
    });
    expect(total(edited)).toBe(0);
  });

  it('does not count a shape put back under the id it had', () => {
    const doc = new Y.Doc();
    const shapes = doc.getMap<Y.Map<unknown>>('shapes');
    shapes.set('a', new Y.Map());
    shapes.delete('a');
    const redone = updatesOf(doc, () => shapes.set('a', new Y.Map()));
    expect(total(redone)).toBe(0);
  });

  it('ignores other root maps', () => {
    const doc = new Y.Doc();
    const updates = updatesOf(doc, () =>
      doc.getMap('comments').set('c', new Y.Map()),
    );
    expect(total(updates)).toBe(0);
  });
});

describe('AFK tracking', () => {
  const MIN = 60_000;

  async function joined() {
    const { store, rows } = fakeStore();
    let clock = 1_000_000;
    const t = tracker(store, () => clock);
    await t.connected({
      socketId: 's1',
      documentName: 'b',
      requestHeaders: headers,
    });
    const publish = (activity: number) =>
      t.awareness({
        socketId: 's1',
        documentName: 'b',
        user: { name: 'Ada' },
        attention: { activity, away: null },
      });
    const advance = (ms: number) => {
      clock += ms;
    };
    const afk = () =>
      (rows.get(1) as unknown as { afk?: [number, number][] }).afk;
    return { t, publish, advance, afk, start: clock };
  }

  it('records the gap past the grace once input resumes', async () => {
    const { t, publish, advance, afk, start } = await joined();
    publish(0);
    advance(20 * MIN);
    // Awareness renewals carry the same counter and are not input.
    publish(0);
    advance(MIN);
    publish(1);
    await t.flush();
    expect(afk()).toEqual([[start + AFK_GRACE_MS, start + 21 * MIN]]);
  });

  it('leaves a pause shorter than the grace alone', async () => {
    const { t, publish, advance, afk } = await joined();
    publish(0);
    advance(4 * MIN);
    publish(1);
    await t.flush();
    expect(afk()).toEqual([]);
  });

  it('writes a stretch still open up to the last sighting', async () => {
    const { t, publish, advance, afk, start } = await joined();
    publish(0);
    advance(12 * MIN);
    publish(0);
    await t.disconnected({ socketId: 's1', documentName: 'b' });
    expect(afk()).toEqual([[start + AFK_GRACE_MS, start + 12 * MIN]]);
  });

  it('never marks a client that publishes no counter as AFK', async () => {
    const { t, advance, afk } = await joined();
    advance(30 * MIN);
    t.awareness({ socketId: 's1', documentName: 'b', user: { name: 'Ada' } });
    await t.flush();
    expect(afk()).toEqual([]);
  });

  it('reports an idle student live, only past the grace', async () => {
    const { t, publish, advance } = await joined();
    publish(0);
    advance(AFK_GRACE_MS);
    expect(t.liveBoards()).toEqual([{ id: 'b', afk: [] }]);
    advance(7 * MIN);
    // Awareness renewals keep arriving from an idle tab; a frozen one sends none.
    publish(0);
    expect(t.liveBoards()).toEqual([
      { id: 'b', afk: [{ name: 'Ada', idleMinutes: 12 }] },
    ]);
    advance(MIN);
    publish(1);
    expect(t.liveBoards()).toEqual([{ id: 'b', afk: [] }]);
  });

  it('never reports a student AFK with a tutor on the board', async () => {
    const { t, publish, advance } = await joined();
    publish(0);
    advance(20 * MIN);
    expect(t.liveBoards()[0]!.afk).toHaveLength(1);

    const token = await signSession({ role: 'tutor', name: 'Tutor' });
    await t.connected({
      socketId: 'tutor',
      documentName: 'b',
      requestHeaders: { cookie: `wb_session=${token}` },
    });
    expect(t.liveBoards()).toEqual([{ id: 'b', afk: [] }]);

    await t.disconnected({ socketId: 'tutor', documentName: 'b' });
    expect(t.liveBoards()[0]!.afk).toHaveLength(1);
  });

  it('keeps a student active while another of their tabs is', async () => {
    const { t, publish, advance } = await joined();
    publish(0);
    await t.connected({
      socketId: 's2',
      documentName: 'b',
      requestHeaders: headers,
    });
    const other = (activity: number) =>
      t.awareness({
        socketId: 's2',
        documentName: 'b',
        user: { name: 'Ada' },
        attention: { activity, away: null },
      });
    other(0);
    advance(20 * MIN);
    other(1);
    expect(t.liveBoards()).toEqual([{ id: 'b', afk: [] }]);
    advance(20 * MIN);
    expect(t.liveBoards()).toEqual([
      { id: 'b', afk: [{ name: 'Ada', idleMinutes: 20 }] },
    ]);
  });
});
