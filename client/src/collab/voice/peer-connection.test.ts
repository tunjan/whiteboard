import type {
  VoiceIceCandidate,
  VoiceSignal,
} from '@whiteboard/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { VoicePeerConnection } from './peer-connection';

const LOCAL_SESSION = 'local-session-12345';
const PEER_SESSION = 'peer-session-123456';

class FakeMediaStream {
  readonly tracks: MediaStreamTrack[];

  constructor(tracks: MediaStreamTrack[] = []) {
    this.tracks = tracks;
  }

  addTrack(track: MediaStreamTrack) {
    this.tracks.push(track);
  }
}

class FakePeerConnection {
  static instances: FakePeerConnection[] = [];

  connectionState: RTCPeerConnectionState = 'new';
  localDescription: RTCSessionDescription | null = null;
  remoteDescription: RTCSessionDescription | null = null;
  onicecandidate: RTCPeerConnection['onicecandidate'] = null;
  ontrack: RTCPeerConnection['ontrack'] = null;
  onconnectionstatechange: RTCPeerConnection['onconnectionstatechange'] = null;
  sender = { replaceTrack: vi.fn().mockResolvedValue(undefined) };
  createOffer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: 'offer',
      sdp: 'offer-sdp',
    }),
  );
  createAnswer = vi.fn(
    async (): Promise<RTCSessionDescriptionInit> => ({
      type: 'answer',
      sdp: 'answer-sdp',
    }),
  );
  setLocalDescription = vi.fn(
    async (description: RTCLocalSessionDescriptionInit) => {
      this.localDescription = description as RTCSessionDescription;
    },
  );
  setRemoteDescription = vi.fn(
    async (description: RTCSessionDescriptionInit) => {
      this.remoteDescription = description as RTCSessionDescription;
    },
  );
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn(() => this.sender as unknown as RTCRtpSender);
  close = vi.fn(() => {
    this.connectionState = 'closed';
  });

  constructor() {
    FakePeerConnection.instances.push(this);
  }
}

function addressed(
  signal:
    | { kind: 'offer' | 'answer'; sdp: string }
    | { kind: 'ice'; candidate: VoiceIceCandidate }
    | { kind: 'bye' },
): VoiceSignal {
  return {
    from: 2,
    to: 1,
    fromSessionId: PEER_SESSION,
    toSessionId: LOCAL_SESSION,
    ...signal,
  };
}

function makePeer(localClientId = 1, peerClientId = 2) {
  const sendSignal = vi.fn();
  const peer = new VoicePeerConnection({
    localClientId,
    peerClientId,
    localSessionId: LOCAL_SESSION,
    peerSessionId: PEER_SESSION,
    localTrack: {} as MediaStreamTrack,
    sendSignal,
    onRemoteStream: vi.fn(),
    onConnectionStateChange: vi.fn(),
  });
  return {
    peer,
    connection: FakePeerConnection.instances.at(-1)!,
    sendSignal,
  };
}

beforeEach(() => {
  FakePeerConnection.instances = [];
  vi.stubGlobal('MediaStream', FakeMediaStream);
  vi.stubGlobal('RTCPeerConnection', FakePeerConnection);
});

describe('VoicePeerConnection', () => {
  it('allows the lower client id to create exactly one offer', async () => {
    const { peer, connection, sendSignal } = makePeer();

    await Promise.all([peer.start(), peer.start()]);

    expect(connection.createOffer).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'offer',
        fromSessionId: LOCAL_SESSION,
        toSessionId: PEER_SESSION,
      }),
    );
  });

  it('does not send an offer after closing during an async operation', async () => {
    let resolveOffer!: (offer: RTCSessionDescriptionInit) => void;
    const offer = new Promise<RTCSessionDescriptionInit>((resolve) => {
      resolveOffer = resolve;
    });
    const { peer, connection, sendSignal } = makePeer();
    connection.createOffer.mockReturnValueOnce(offer);

    const starting = peer.start();
    peer.close();
    resolveOffer({ type: 'offer', sdp: 'late-offer' });
    await starting;

    expect(connection.setLocalDescription).not.toHaveBeenCalled();
    expect(sendSignal).not.toHaveBeenCalled();
  });

  it('serializes and ignores a duplicate offer', async () => {
    const { peer, connection, sendSignal } = makePeer(2, 1);
    const offer: VoiceSignal = {
      from: 1,
      to: 2,
      fromSessionId: PEER_SESSION,
      toSessionId: LOCAL_SESSION,
      kind: 'offer',
      sdp: 'remote-offer',
    };

    await Promise.all([peer.handleSignal(offer), peer.handleSignal(offer)]);

    expect(connection.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(connection.createAnswer).toHaveBeenCalledTimes(1);
    expect(sendSignal).toHaveBeenCalledTimes(1);
  });

  it('rejects excess unique ICE candidates before SDP', async () => {
    const { peer } = makePeer();

    for (let index = 0; index < 128; index += 1) {
      await peer.handleSignal(
        addressed({
          kind: 'ice',
          candidate: { candidate: `candidate:${index}` },
        }),
      );
    }
    await expect(
      peer.handleSignal(
        addressed({
          kind: 'ice',
          candidate: { candidate: 'candidate:overflow' },
        }),
      ),
    ).rejects.toThrow('Too many voice ICE candidates');
  });

  it('ignores signals from a stale session', async () => {
    const { peer, connection } = makePeer();

    await peer.handleSignal({
      ...addressed({ kind: 'answer', sdp: 'stale-answer' }),
      fromSessionId: 'stale-session-123',
    });

    expect(connection.setRemoteDescription).not.toHaveBeenCalled();
  });
});
