import { describe, expect, it } from 'vitest';
import {
  type BoardReadinessInputs,
  boardLoadProgress,
  boardLoadStage,
  isBoardReady,
} from './board-readiness';

function inputs(
  patch: Partial<BoardReadinessInputs> = {},
): BoardReadinessInputs {
  return {
    localSynced: false,
    remoteSynced: false,
    pageSettled: false,
    pageSynced: false,
    offline: false,
    deadlinePassed: false,
    ...patch,
  };
}

describe('isBoardReady', () => {
  it('holds while the local cache has not replayed, whatever else has', () => {
    expect(
      isBoardReady(
        inputs({ remoteSynced: true, pageSettled: true, pageSynced: true }),
      ),
    ).toBe(false);
  });

  it('holds until the server has sent the board document', () => {
    expect(
      isBoardReady(
        inputs({ localSynced: true, pageSettled: true, pageSynced: true }),
      ),
    ).toBe(false);
  });

  // The page restore runs off the same sync events, so a board can look fully
  // synced one statement before it switches to the page it stored.
  it('holds while the open page could still change under the user', () => {
    expect(
      isBoardReady(
        inputs({ localSynced: true, remoteSynced: true, pageSynced: true }),
      ),
    ).toBe(false);
  });

  it("holds until the open page's own document has arrived", () => {
    expect(
      isBoardReady(
        inputs({ localSynced: true, remoteSynced: true, pageSettled: true }),
      ),
    ).toBe(false);
  });

  it('lifts once all four sources are in', () => {
    expect(
      isBoardReady(
        inputs({
          localSynced: true,
          remoteSynced: true,
          pageSettled: true,
          pageSynced: true,
        }),
      ),
    ).toBe(true);
  });

  // Offline the provider never syncs, so the restore never runs and the page
  // document never resolves. Waiting on either would be waiting forever.
  it('lifts on the local cache alone once the connection has given up', () => {
    expect(isBoardReady(inputs({ localSynced: true, offline: true }))).toBe(
      true,
    );
  });

  it('still waits for the local cache when offline', () => {
    expect(isBoardReady(inputs({ offline: true }))).toBe(false);
  });

  it('lifts on the deadline from a standing start', () => {
    expect(isBoardReady(inputs({ deadlinePassed: true }))).toBe(true);
  });
});

describe('boardLoadStage', () => {
  it('names the first source still outstanding', () => {
    expect(boardLoadStage(inputs())).toBe('local');
    expect(boardLoadStage(inputs({ localSynced: true }))).toBe('remote');
    expect(
      boardLoadStage(inputs({ localSynced: true, remoteSynced: true })),
    ).toBe('page');
    expect(
      boardLoadStage(
        inputs({
          localSynced: true,
          remoteSynced: true,
          pageSettled: true,
          pageSynced: true,
        }),
      ),
    ).toBe('ready');
  });
});

describe('boardLoadProgress', () => {
  it('advances through the stage sequence and ends full', () => {
    const stops = (['local', 'remote', 'page', 'ready'] as const).map(
      boardLoadProgress,
    );
    expect(stops).toEqual([...stops].sort((a, b) => a - b));
    expect(stops.at(-1)).toBe(1);
  });
});
