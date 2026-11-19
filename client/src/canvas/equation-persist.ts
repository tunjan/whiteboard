/**
 * Typeset equations kept across page loads, in IndexedDB.
 *
 * A board opened again would otherwise boot the MathJax worker and re-typeset
 * every equation on it. With a hit for each one, the worker is never started.
 *
 * Best effort throughout: a private window, a blocked or full database, or no
 * IndexedDB at all (Node, the test suite) is a miss, never an error. Only
 * successful renders are stored; an error can depend on this session (the
 * timeout), and is cheap to reproduce anyway.
 */
import type { EquationRender } from './equation-convert';

const DB_NAME = 'equation-renders';
const STORE = 'renders';
/**
 * Bump whenever `convertEquation`'s output changes — a MathJax upgrade, the
 * font cache mode, the sanitizer, the package list — so old renders are not
 * served for the new pipeline.
 */
const FORMAT = 2;
/** Entries kept; the oldest written beyond this are dropped on open. */
const MAX_ENTRIES = 2000;

interface StoredRender {
  key: string;
  svg: string;
  width: number;
  height: number;
  at: number;
}

let opening: Promise<IDBDatabase | null> | null = null;

function done(request: IDBRequest): Promise<unknown> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function prune(db: IDBDatabase): Promise<void> {
  const store = db.transaction(STORE, 'readwrite').objectStore(STORE);
  let excess = ((await done(store.count())) as number) - MAX_ENTRIES;
  if (excess <= 0) return;
  const cursor = store.index('at').openCursor();
  cursor.onsuccess = () => {
    const current = cursor.result;
    if (!current || excess-- <= 0) return;
    current.delete();
    current.continue();
  };
}

function open(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  opening ??= new Promise<IDBDatabase | null>((resolve) => {
    const request = indexedDB.open(DB_NAME, FORMAT);
    request.onupgradeneeded = () => {
      // A new format invalidates everything stored by the old one.
      const db = request.result;
      if (db.objectStoreNames.contains(STORE)) db.deleteObjectStore(STORE);
      db.createObjectStore(STORE, { keyPath: 'key' }).createIndex('at', 'at');
    };
    request.onsuccess = () => {
      const db = request.result;
      void prune(db).catch(() => undefined);
      resolve(db);
    };
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
  return opening;
}

export async function readPersistedRender(
  key: string,
): Promise<EquationRender | undefined> {
  try {
    const db = await open();
    if (!db) return undefined;
    const stored = (await done(
      db.transaction(STORE).objectStore(STORE).get(key),
    )) as StoredRender | undefined;
    return stored
      ? { svg: stored.svg, width: stored.width, height: stored.height }
      : undefined;
  } catch {
    return undefined;
  }
}

export function persistRender(key: string, render: EquationRender): void {
  if (render.error !== undefined) return;
  void open()
    .then((db) => {
      if (!db) return;
      const entry: StoredRender = {
        key,
        svg: render.svg,
        width: render.width,
        height: render.height,
        at: Date.now(),
      };
      db.transaction(STORE, 'readwrite').objectStore(STORE).put(entry);
    })
    .catch(() => undefined);
}
