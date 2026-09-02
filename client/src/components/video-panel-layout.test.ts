import { describe, expect, it } from 'vitest';
import type { PeerPresence } from '@/collab/use-presence-store';
import {
  clampPanelPosition,
  mainTileKey,
  selfCameraTile,
  spotlightOrder,
  videoGridLayout,
  videoTiles,
  type VideoTile,
} from './video-panel-layout';

const LOCAL = {
  clientId: 1,
  name: 'Tutor',
  color: '#DC2626',
  camera: false,
  screen: false,
};

function peer(
  clientId: number,
  voice: { camera?: boolean; screen?: boolean; inCall?: boolean } | null,
): PeerPresence {
  return {
    clientId,
    name: `Student ${clientId}`,
    color: '#2f6df6',
    voice: voice
      ? {
          inCall: voice.inCall ?? true,
          muted: false,
          speaking: false,
          camera: voice.camera ?? false,
          screen: voice.screen ?? false,
          sessionId: `session-${clientId}-abcdef`,
        }
      : null,
  } as PeerPresence;
}

describe('videoTiles', () => {
  it('gives a peer publishing both sources two tiles', () => {
    const tiles = videoTiles({
      local: LOCAL,
      peers: [peer(9, { camera: true, screen: true })],
    });

    expect(tiles.map((tile) => tile.key)).toEqual(['9:screen', '9:camera']);
    expect(tiles.every((tile) => tile.isLocal)).toBe(false);
  });

  it('leads with shared screens and keeps your own camera out of the grid', () => {
    const tiles = videoTiles({
      local: { ...LOCAL, camera: true, screen: true },
      peers: [peer(9, { camera: true }), peer(10, { screen: true })],
    });

    // Your own screen stays — you need to see what you are sharing — but your
    // camera would otherwise halve the space given to the other person.
    expect(tiles.map((tile) => tile.key)).toEqual([
      '1:screen',
      '10:screen',
      '9:camera',
    ]);
  });

  it('renders nothing for peers who publish no video', () => {
    expect(
      videoTiles({
        local: LOCAL,
        peers: [peer(9, {}), peer(10, null)],
      }),
    ).toEqual([]);
  });

  it('leaves the grid empty when only your own camera is on', () => {
    expect(
      videoTiles({ local: { ...LOCAL, camera: true }, peers: [] }),
    ).toEqual([]);
  });

  it('ignores video flags from a peer who has left the call', () => {
    expect(
      videoTiles({
        local: LOCAL,
        peers: [peer(9, { inCall: false, camera: true })],
      }),
    ).toEqual([]);
  });
});

describe('selfCameraTile', () => {
  it('offers the thumbnail while the camera is on and shown', () => {
    const tile = selfCameraTile({ ...LOCAL, camera: true }, 'pip');

    expect(tile?.key).toBe('1:camera');
    expect(tile?.isLocal).toBe(true);
  });

  it('offers nothing when the camera is off or the view is hidden', () => {
    expect(selfCameraTile(LOCAL, 'pip')).toBeNull();
    expect(selfCameraTile({ ...LOCAL, camera: true }, 'hidden')).toBeNull();
  });
});

describe('videoGridLayout', () => {
  it('splits a wide container into near-16:9 tiles', () => {
    const wide = 16 / 9;
    expect(videoGridLayout(1, wide)).toEqual({ columns: 1, rows: 1 });
    expect(videoGridLayout(2, wide)).toEqual({ columns: 1, rows: 2 });
    expect(videoGridLayout(4, wide)).toEqual({ columns: 2, rows: 2 });
    expect(videoGridLayout(6, wide)).toEqual({ columns: 2, rows: 3 });
  });

  it('adds columns as the container gets wider', () => {
    expect(videoGridLayout(4, 6).columns).toBeGreaterThan(
      videoGridLayout(4, 16 / 9).columns,
    );
  });

  it('never asks for more columns than tiles', () => {
    expect(videoGridLayout(1, 20)).toEqual({ columns: 1, rows: 1 });
  });

  it('handles an empty panel and an unmeasured container', () => {
    expect(videoGridLayout(0, 1.5)).toEqual({ columns: 0, rows: 0 });
    expect(videoGridLayout(4, 0)).toEqual({ columns: 2, rows: 2 });
    expect(videoGridLayout(4, Number.NaN)).toEqual({ columns: 2, rows: 2 });
  });
});

describe('clampPanelPosition', () => {
  const size = { width: 320, height: 200 };
  const viewport = { width: 1000, height: 800 };

  it('leaves an in-bounds position alone', () => {
    expect(clampPanelPosition({ x: 400, y: 300 }, size, viewport, 12)).toEqual({
      x: 400,
      y: 300,
    });
  });

  it('pulls the panel back inside each edge', () => {
    expect(clampPanelPosition({ x: -80, y: -80 }, size, viewport, 12)).toEqual({
      x: 12,
      y: 12,
    });
    expect(
      clampPanelPosition({ x: 5000, y: 5000 }, size, viewport, 12),
    ).toEqual({ x: 668, y: 588 });
  });

  it('pins a panel larger than the viewport to the top-left margin', () => {
    expect(
      clampPanelPosition(
        { x: 400, y: 400 },
        { width: 1200, height: 900 },
        viewport,
        12,
      ),
    ).toEqual({ x: 12, y: 12 });
  });
});

describe('spotlightOrder', () => {
  const tiles = [
    { key: '9:screen' },
    { key: '9:camera' },
    { key: '1:camera' },
  ] as VideoTile[];

  it('lifts the spotlit tile out of the strip', () => {
    const { hero, filmstrip } = spotlightOrder(tiles, '9:camera');

    expect(hero?.key).toBe('9:camera');
    expect(filmstrip.map((tile) => tile.key)).toEqual(['9:screen', '1:camera']);
  });

  it('falls back to the grid with no spotlight', () => {
    expect(spotlightOrder(tiles, null)).toEqual({ hero: null, filmstrip: tiles });
  });

  it('falls back to the grid when the spotlit tile disappears', () => {
    // The peer stopped sharing, or left, while their tile was spotlit.
    expect(spotlightOrder(tiles, '42:screen')).toEqual({
      hero: null,
      filmstrip: tiles,
    });
  });
});

describe('mainTileKey', () => {
  const tiles = [{ key: '9:screen' }, { key: '9:camera' }] as VideoTile[];

  it('keeps the picked view', () => {
    expect(mainTileKey(tiles, '9:camera')).toBe('9:camera');
  });

  it('leads with the first view when nothing is picked', () => {
    expect(mainTileKey(tiles, null)).toBe('9:screen');
  });

  it('falls back when the pick has left the call', () => {
    // The one-tile panel must never be left with nothing in it.
    expect(mainTileKey(tiles, '42:camera')).toBe('9:screen');
    expect(mainTileKey([], '9:camera')).toBeNull();
  });
});
