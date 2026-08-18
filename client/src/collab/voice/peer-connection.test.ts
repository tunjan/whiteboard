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
  /** Media slots in creation order, so tests can assert the m-line layout. */
  mediaOrder: string[] = [];
  transceivers: {
    direction: string;
    receiver: { track: { kind: string } };
    sender: { replaceTrack: ReturnType<typeof vi.fn> };
  }[] = [];
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
      if (description.type === 'offer') this.answerVideoSlots();
    },
  );
  addIceCandidate = vi.fn().mockResolvedValue(undefined);
  addTrack = vi.fn(() => {
    this.mediaOrder.push('addTrack');
    return this.sender as unknown as RTCRtpSender;
  });
  addTransceiver = vi.fn((kind: string) => {
    this.mediaOrder.push(`addTransceiver:${kind}`);
    return this.pushVideoSlot('sendrecv') as unknown as RTCRtpTransceiver;
  });
  getTransceivers = vi.fn(
    () => this.transceivers as unknown as RTCRtpTransceiver[],
  );

  /**
   * Chrome ignores an answerer's own transceivers and creates `recvonly` ones
   * from the offer's m-lines. The fake reproduces that, because forgetting to
   * flip them back is exactly the bug this file guards.
   */
  answerVideoSlots(count = 2) {
    for (let index = 0; index < count; index += 1) {
      this.pushVideoSlot('recvonly');
    }
  }

  private pushVideoSlot(direction: string) {
    const transceiver = {
      direction,
      receiver: { track: { kind: 'video' } },
      sender: { replaceTrack: vi.fn().mockResolvedValue(undefined) },
    };
    this.transceivers.push(transceiver);
    return transceiver;
  }
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

function makePeer(
  localClientId = 1,
  peerClientId = 2,
  video: {
    cameraTrack?: MediaStreamTrack | null;
    screenTrack?: MediaStreamTrack | null;
  } = {},
) {
  const sendSignal = vi.fn();
  const onRemoteStream = vi.fn();
  const onRemoteVideoTrack = vi.fn();
  const peer = new VoicePeerConnection({
    localClientId,
    peerClientId,
    localSessionId: LOCAL_SESSION,
    peerSessionId: PEER_SESSION,
    localTrack: {} as MediaStreamTrack,
    cameraTrack: video.cameraTrack ?? null,
    screenTrack: video.screenTrack ?? null,
    sendSignal,
    onRemoteStream,
    onRemoteVideoTrack,
    onConnectionStateChange: vi.fn(),
  });
  return {
    peer,
    connection: FakePeerConnection.instances.at(-1)!,
    sendSignal,
    onRemoteStream,
    onRemoteVideoTrack,
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

  it('drops excess unique ICE candidates without failing the call', async () => {
    // Answering side, so the buffered candidates flush against a remote offer.
    const { peer, connection } = makePeer(2, 1);
    const fromPeer = (
      signal:
        | { kind: 'offer'; sdp: string }
        | { kind: 'ice'; candidate: VoiceIceCandidate },
    ): VoiceSignal => ({
      from: 1,
      to: 2,
      fromSessionId: PEER_SESSION,
      toSessionId: LOCAL_SESSION,
      ...signal,
    });

    for (let index = 0; index < 129; index += 1) {
      await peer.handleSignal(
        fromPeer({
          kind: 'ice',
          candidate: { candidate: `candidate:${index}` },
        }),
      );
    }
    await peer.handleSignal(fromPeer({ kind: 'offer', sdp: 'remote-offer' }));

    // The surplus candidate is ignored, but negotiation still completes.
    expect(connection.addIceCandidate).toHaveBeenCalledTimes(128);
    expect(connection.setRemoteDescription).toHaveBeenCalledTimes(1);
    expect(connection.createAnswer).toHaveBeenCalledTimes(1);
  });

  it('lays out the offering side as audio, camera, screen', () => {
    const { connection } = makePeer();

    expect(connection.mediaOrder).toEqual([
      'addTrack',
      'addTransceiver:video',
      'addTransceiver:video',
    ]);
    expect(connection.addTransceiver).toHaveBeenNthCalledWith(1, 'video', {
      direction: 'sendrecv',
    });
  });

  it('leaves the m-lines to the offer when it is the answering side', () => {
    const { connection } = makePeer(2, 1);

    // Chrome discards transceivers the answerer adds itself, so adding any
    // here would only produce stray m-lines.
    expect(connection.mediaOrder).toEqual(['addTrack']);
  });

  it('opts the answered video slots back into sending', async () => {
    const cameraTrack = { id: 'camera' } as unknown as MediaStreamTrack;
    const { peer, connection } = makePeer(2, 1, { cameraTrack });

    await peer.handleSignal({
      from: 1,
      to: 2,
      fromSessionId: PEER_SESSION,
      toSessionId: LOCAL_SESSION,
      kind: 'offer',
      sdp: 'remote-offer',
    });

    // A slot left `recvonly` can never publish, and no second negotiation is
    // coming to fix it.
    expect(connection.transceivers.map((t) => t.direction)).toEqual([
      'sendrecv',
      'sendrecv',
    ]);
    expect(connection.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(
      cameraTrack,
    );
    // Sending must be arranged before the answer describes it.
    const replaceOrder =
      connection.transceivers[0]!.sender.replaceTrack.mock.invocationCallOrder[0]!;
    expect(replaceOrder).toBeLessThan(
      connection.createAnswer.mock.invocationCallOrder[0]!,
    );
  });

  it('publishes video already live when the connection is built', () => {
    const cameraTrack = { id: 'camera' } as unknown as MediaStreamTrack;
    const { connection } = makePeer(1, 2, { cameraTrack });

    expect(connection.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(
      cameraTrack,
    );
    expect(connection.transceivers[1]?.sender.replaceTrack).toHaveBeenCalledWith(
      null,
    );
  });

  it('routes remote tracks by m-line order rather than by stream', () => {
    const { connection, onRemoteStream, onRemoteVideoTrack } = makePeer();
    const cameraTrack = { id: 'remote-camera' } as MediaStreamTrack;
    const screenTrack = { id: 'remote-screen' } as MediaStreamTrack;
    const audioTrack = { id: 'remote-audio' } as MediaStreamTrack;
    const audioStream = new FakeMediaStream([audioTrack]);
    // `ontrack` is typed with an RTCPeerConnection receiver the fake can't satisfy.
    const fireTrack = connection.ontrack as unknown as (
      event: RTCTrackEvent,
    ) => void;

    // Empty video transceivers arrive with no stream attached.
    fireTrack({
      streams: [],
      track: cameraTrack,
      transceiver: connection.transceivers[0],
    } as unknown as RTCTrackEvent);
    fireTrack({
      streams: [],
      track: screenTrack,
      transceiver: connection.transceivers[1],
    } as unknown as RTCTrackEvent);
    fireTrack({
      streams: [audioStream],
      track: audioTrack,
      transceiver: { id: 'audio' },
    } as unknown as RTCTrackEvent);

    expect(onRemoteVideoTrack.mock.calls).toEqual([
      ['camera', cameraTrack],
      ['screen', screenTrack],
    ]);
    expect(onRemoteStream).toHaveBeenCalledTimes(1);
    expect(onRemoteStream).toHaveBeenCalledWith(audioStream);
  });

  it('swaps a video slot without renegotiating', async () => {
    const { peer, connection, sendSignal } = makePeer();
    const track = { id: 'camera' } as MediaStreamTrack;

    await peer.setVideoTrack('camera', track);
    await peer.setVideoTrack('screen', null);

    expect(connection.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(
      track,
    );
    expect(connection.transceivers[1]?.sender.replaceTrack).toHaveBeenCalledWith(
      null,
    );
    expect(connection.createOffer).not.toHaveBeenCalled();
    expect(connection.setLocalDescription).not.toHaveBeenCalled();
    expect(sendSignal).not.toHaveBeenCalled();
  });

  it('holds video enabled before answering until the slots exist', async () => {
    const track = { id: 'camera' } as MediaStreamTrack;
    const { peer, connection } = makePeer(2, 1);

    // Turning the camera on while still waiting for the offer must not throw…
    await peer.setVideoTrack('camera', track);
    expect(connection.transceivers).toHaveLength(0);

    await peer.handleSignal({
      from: 1,
      to: 2,
      fromSessionId: PEER_SESSION,
      toSessionId: LOCAL_SESSION,
      kind: 'offer',
      sdp: 'remote-offer',
    });

    // …and must still reach the peer once the m-lines arrive.
    expect(connection.transceivers[0]?.sender.replaceTrack).toHaveBeenCalledWith(
      track,
    );
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
