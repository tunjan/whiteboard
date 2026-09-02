import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Identity } from '@/collab/identity';
import type { PeerPresence } from '@/collab/use-presence-store';
import { VideoPanel } from './video-panel';

// Zustand feeds `useSyncExternalStore` its *initial* state as the server
// snapshot, so a server-rendered component never sees `setState`. The stores
// are stubbed instead, which also keeps the panel isolated from the mesh.
const stores = vi.hoisted(() => {
  const voiceState = { status: 'idle' as string };
  const videoState = {
    cameraEnabled: false,
    screenEnabled: false,
    error: null as string | null,
    localCamera: null as MediaStream | null,
    localScreen: null as MediaStream | null,
    remoteCameras: new Map<number, MediaStream>(),
    remoteScreens: new Map<number, MediaStream>(),
    mode: 'floating' as string,
    selfView: 'pip' as string,
    position: null as { x: number; y: number } | null,
    spotlightKey: null as string | null,
  };
  const presenceState = { peers: [] as unknown[] };
  const stub = <T extends object>(state: T) =>
    Object.assign((selector: (value: T) => unknown) => selector(state), {
      getState: () => state,
    });
  return { voiceState, videoState, presenceState, stub };
});

const { voiceState, videoState, presenceState } = stores;

vi.mock('@/collab/voice/use-voice-store', () => ({
  useVoiceStore: stores.stub(stores.voiceState),
}));
vi.mock('@/collab/voice/use-video-store', () => ({
  useVideoStore: stores.stub(stores.videoState),
}));
vi.mock('@/collab/use-presence-store', () => ({
  usePresenceStore: stores.stub(stores.presenceState),
}));
vi.mock('@/collab/voice/video-session', () => ({
  enableCamera: vi.fn(),
  disableCamera: vi.fn(),
  enableScreen: vi.fn(),
  disableScreen: vi.fn(),
}));

const IDENTITY: Identity = { name: 'Tutor', color: '#DC2626', isTutor: true };
const ANCHOR_CLASS = 'bottom-[calc(3.25rem+env(safe-area-inset-bottom))]';

function render(identity: Identity | null = IDENTITY): string {
  return renderToStaticMarkup(<VideoPanel identity={identity} />);
}

function joined(): void {
  voiceState.status = 'joined';
}

function peer(
  clientId: number,
  video: { camera?: boolean; screen?: boolean },
): PeerPresence {
  return {
    clientId,
    name: 'Student',
    color: '#2f6df6',
    voice: {
      inCall: true,
      muted: false,
      speaking: false,
      camera: video.camera ?? false,
      screen: video.screen ?? false,
      sessionId: `session-${clientId}-abcdef`,
    },
  } as PeerPresence;
}

beforeEach(() => {
  voiceState.status = 'idle';
  Object.assign(videoState, {
    cameraEnabled: false,
    screenEnabled: false,
    error: null,
    localCamera: null,
    localScreen: null,
    remoteCameras: new Map(),
    remoteScreens: new Map(),
    mode: 'floating',
    selfView: 'pip',
    position: null,
    spotlightKey: null,
  });
  presenceState.peers = [];
});

describe('VideoPanel', () => {
  it('stays out of the way until the call is joined', () => {
    expect(render()).toBe('');

    voiceState.status = 'connecting';
    expect(render()).toBe('');
  });

  it('renders nothing without an identity', () => {
    joined();

    expect(render(null)).toBe('');
  });

  it('offers the camera and screen toggles once joined', () => {
    joined();
    const markup = render();

    expect(markup).toContain('aria-label="Turn on camera"');
    expect(markup).toContain('aria-label="Share your screen"');
    expect(markup).toContain('Turn on your camera or share your screen');
  });

  it('mutes every tile and mirrors only the local camera', () => {
    joined();
    videoState.cameraEnabled = true;
    videoState.screenEnabled = true;
    const markup = render();

    // Your screen in the grid, your camera as the thumbnail.
    const videos = markup.match(/<video[^>]*>/g) ?? [];
    expect(videos).toHaveLength(2);
    // Call audio comes from the voice sinks, and an unmuted tile would be
    // blocked outright by the autoplay policy.
    expect(videos.every((video) => video.includes('muted'))).toBe(true);
    expect(videos.every((video) => video.includes('playsInline'))).toBe(true);
    expect(
      videos.filter((video) => video.includes('-scale-x-100')),
    ).toHaveLength(1);
  });

  it('shows a tile per source a peer publishes when maximized', () => {
    joined();
    videoState.mode = 'maximized';
    presenceState.peers = [peer(9, { camera: true, screen: true })];
    const markup = render();

    expect(markup.match(/<video[^>]*>/g) ?? []).toHaveLength(2);
    expect(markup).toContain('Student&#x27;s screen');
  });

  it('spends the minimised panel on one view, and offers the rest', () => {
    joined();
    presenceState.peers = [
      peer(9, { camera: true, screen: true }),
      peer(11, { camera: true }),
    ];
    const markup = render();

    // Three views, one tile: the panel stays the size of a single camera.
    expect(markup.match(/<video[^>]*>/g) ?? []).toHaveLength(1);
    // Screens lead, so the unpicked views are the two cameras.
    expect(markup).toContain('Student&#x27;s screen');
    expect(markup.match(/<button[^>]*>/g) ?? []).not.toHaveLength(0);
  });

  it('gives the minimised tile to the view you pick', () => {
    joined();
    presenceState.peers = [peer(9, { camera: true, screen: true })];
    videoState.spotlightKey = '9:camera';
    const markup = render();

    expect(markup.match(/<video[^>]*>/g) ?? []).toHaveLength(1);
    // The label belongs to the camera now, and the screen is the offer.
    expect(markup.indexOf('Student&#x27;s screen')).toBeGreaterThan(
      markup.indexOf('Student</span>'),
    );
  });

  it('falls back to the first view when the pick leaves the call', () => {
    joined();
    presenceState.peers = [peer(9, { camera: true })];
    videoState.spotlightKey = '11:camera';

    // A stale pick must not blank the panel.
    expect(render().match(/<video[^>]*>/g) ?? []).toHaveLength(1);
  });

  it('hides the tiles and controls when collapsed to a bar', () => {
    joined();
    videoState.cameraEnabled = true;
    videoState.mode = 'bar';
    const markup = render();

    expect(markup).toContain('aria-label="Show video"');
    expect(markup).not.toContain('<video');
    expect(markup).not.toContain('aria-label="Turn off camera"');
  });

  it('gives each mode its own geometry', () => {
    joined();
    const floating = render();
    videoState.mode = 'maximized';
    const maximized = render();

    expect(floating).not.toBe(maximized);
    expect(floating).toContain(ANCHOR_CLASS);
    expect(maximized).not.toContain(ANCHOR_CLASS);
    expect(maximized).toContain('aria-label="Restore video panel"');
  });

  it('keeps your own camera to a thumbnail you can dismiss', () => {
    joined();
    videoState.cameraEnabled = true;
    const shown = render();

    // A full tile for yourself would halve the space in a one-to-one call.
    expect(shown).toContain('aria-label="Hide your own camera"');
    expect(shown).toContain('Waiting for someone else to turn on their camera');
    expect(shown.match(/<video[^>]*>/g) ?? []).toHaveLength(1);

    videoState.selfView = 'hidden';
    const hidden = render();

    expect(hidden).toContain('aria-label="Show your own camera"');
    expect(hidden.match(/<video[^>]*>/g) ?? []).toHaveLength(0);
  });

  it('gives the whole grid to the other person in a one-to-one call', () => {
    joined();
    videoState.cameraEnabled = true;
    presenceState.peers = [peer(9, { camera: true })];
    videoState.selfView = 'hidden';

    // One remote camera, and nothing of your own competing with it.
    expect(render().match(/<video[^>]*>/g) ?? []).toHaveLength(1);
  });

  it('offers no self-view control while the camera is off', () => {
    joined();

    expect(render()).not.toContain('your own camera');
  });

  it('only offers spotlight when maximized', () => {
    joined();
    presenceState.peers = [peer(9, { camera: true })];
    expect(render()).not.toContain('Spotlight');

    videoState.mode = 'maximized';
    expect(render()).toContain("aria-label=\"Spotlight Student&#x27;s camera\"");
  });

  it('lays the controls over the video instead of framing it', () => {
    joined();
    presenceState.peers = [peer(9, { camera: true })];
    const markup = render();

    // No header or footer band: the controls hide until the panel is hovered,
    // and stay put for touch and keyboard users.
    expect(markup).not.toContain('<header');
    expect(markup).not.toContain('<footer');
    expect(markup).toContain('touch-reveal');
    expect(markup).toContain('group-hover/panel:opacity-100');
  });

  it('keeps the controls up while there is no video to hide them over', () => {
    joined();

    expect(render()).not.toContain('touch-reveal');
  });

  it('drops the edge anchor once the panel has been dragged', () => {
    joined();
    videoState.position = { x: 40, y: 60 };
    const markup = render();

    expect(markup).toContain('left:40px');
    expect(markup).toContain('top:60px');
    expect(markup).not.toContain(ANCHOR_CLASS);
  });

  it('surfaces a capture error without forking the theme', () => {
    joined();
    videoState.error = 'Camera blocked';
    const markup = render();

    expect(markup).toContain('Camera blocked');
    // The app draws one global focus outline and themes through tokens.
    expect(markup).not.toContain('focus-visible:ring');
    expect(markup).not.toMatch(/\bdark:(bg|text|border)-/);
  });
});
