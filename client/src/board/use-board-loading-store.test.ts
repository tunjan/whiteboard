import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useConnectionStore } from '@/collab/use-connection-store';
import { BOARD_READY_DEADLINE_MS } from './board-readiness';
import {
  beginBoardLoad,
  updateBoardLoading,
  useBoardLoadingStore,
} from './use-board-loading-store';

let stop: (() => void) | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  useConnectionStore.setState({ status: 'connecting', latencyMs: null });
});

afterEach(() => {
  stop?.();
  stop = null;
  vi.useRealTimers();
});

const ready = () => useBoardLoadingStore.getState().ready;

describe('beginBoardLoad', () => {
  // The configuration every existing `loadBoard(id)` test uses: no local cache
  // and no server, so nothing is ever going to sync.
  it('is ready as soon as a sourceless board reports disconnected', () => {
    stop = beginBoardLoad({ localSynced: true, remoteSynced: true });
    expect(ready()).toBe(false);
    useConnectionStore.getState().setStatus('disconnected');
    expect(ready()).toBe(true);
  });

  it('lifts on the deadline when nothing ever syncs', () => {
    stop = beginBoardLoad({ localSynced: false, remoteSynced: false });
    vi.advanceTimersByTime(BOARD_READY_DEADLINE_MS);
    expect(ready()).toBe(true);
  });

  it('cancels the deadline when the load is disposed', () => {
    stop = beginBoardLoad({ localSynced: false, remoteSynced: false });
    stop();
    stop = null;
    vi.advanceTimersByTime(BOARD_READY_DEADLINE_MS * 2);
    expect(ready()).toBe(false);
  });

  // Otherwise the next board's first frame paints as ready, which is exactly
  // the flash of an empty canvas this whole thing exists to remove.
  it('resets to not-ready when the load is disposed', () => {
    stop = beginBoardLoad({ localSynced: true, remoteSynced: true });
    useConnectionStore.getState().setStatus('disconnected');
    expect(ready()).toBe(true);
    stop();
    stop = null;
    expect(ready()).toBe(false);
  });

  it('stops listening to the connection once disposed', () => {
    stop = beginBoardLoad({ localSynced: true, remoteSynced: true });
    stop();
    stop = null;
    useConnectionStore.getState().setStatus('disconnected');
    expect(ready()).toBe(false);
  });
});

describe('updateBoardLoading', () => {
  it('advances through the stages as each source lands', () => {
    stop = beginBoardLoad({ localSynced: false, remoteSynced: false });
    expect(useBoardLoadingStore.getState().stage).toBe('local');
    updateBoardLoading({ localSynced: true });
    expect(useBoardLoadingStore.getState().stage).toBe('remote');
    updateBoardLoading({ remoteSynced: true });
    expect(useBoardLoadingStore.getState().stage).toBe('page');
    updateBoardLoading({ pageSettled: true, pageSynced: true });
    expect(useBoardLoadingStore.getState().stage).toBe('ready');
  });

  // A disconnect mid-session must not drop the veil back over a board the user
  // is already drawing on.
  it('never goes back to not-ready within one load', () => {
    stop = beginBoardLoad({ localSynced: true, remoteSynced: true });
    updateBoardLoading({ pageSettled: true, pageSynced: true });
    expect(ready()).toBe(true);
    updateBoardLoading({ localSynced: false, pageSynced: false });
    expect(ready()).toBe(true);
  });
});
