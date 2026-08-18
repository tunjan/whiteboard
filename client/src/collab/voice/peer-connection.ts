import type {
  VideoKind,
  VoiceIceCandidate,
  VoiceSignal,
} from '@whiteboard/shared';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

/**
 * Bounds what one peer can make us buffer. Connectivity is established from the
 * first few candidates, so a host that trickles more than this (many interfaces,
 * VPN, IPv6) loses only redundant paths — never the connection itself.
 */
const MAX_REMOTE_ICE_CANDIDATES = 128;

interface VoicePeerConnectionOptions {
  localClientId: number;
  peerClientId: number;
  localSessionId: string;
  peerSessionId: string;
  localTrack: MediaStreamTrack;
  /** Video already being published when this connection is built. */
  cameraTrack: MediaStreamTrack | null;
  screenTrack: MediaStreamTrack | null;
  sendSignal: (signal: VoiceSignal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onRemoteVideoTrack: (kind: VideoKind, track: MediaStreamTrack) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

/**
 * One WebRTC connection in the room mesh: audio plus two video slots.
 *
 * Negotiation runs exactly once (see `start`), so the video m-lines are created
 * up front and left empty; publishing later is a `replaceTrack`, which the spec
 * guarantees never triggers renegotiation.
 *
 * Only the offering peer pre-adds the transceivers. Chrome does not match a
 * remote offer's m-lines onto transceivers the answerer added itself — it
 * creates fresh ones and answers `recvonly`, which silently leaves the answerer
 * unable to send and its inbound video unattributable. So the answerer adopts
 * whatever the offer produced and opts back into sending before answering (see
 * `adoptVideoSlots`). Slots are addressed by m-line order rather than by object
 * identity for the same reason.
 */
export class VoicePeerConnection {
  readonly peerClientId: number;
  readonly peerSessionId: string;

  private readonly localClientId: number;
  private readonly localSessionId: string;
  private readonly connection: RTCPeerConnection;
  private readonly sender: RTCRtpSender;
  /** Desired video per slot, applied whenever the m-lines exist. */
  private readonly videoTracks: Record<VideoKind, MediaStreamTrack | null>;
  private readonly sendSignal: (signal: VoiceSignal) => void;
  private readonly onRemoteStream: (stream: MediaStream) => void;
  private readonly onRemoteVideoTrack: (
    kind: VideoKind,
    track: MediaStreamTrack,
  ) => void;
  private readonly onConnectionStateChange: (
    state: RTCPeerConnectionState,
  ) => void;
  private readonly fallbackRemoteStream = new MediaStream();
  private readonly pendingIce: VoiceIceCandidate[] = [];
  private readonly receivedIce = new Set<string>();
  private signalQueue = Promise.resolve();
  private negotiationState:
    | 'new'
    | 'offering'
    | 'waiting-answer'
    | 'answering'
    | 'complete' = 'new';
  private closed = false;

  constructor({
    localClientId,
    peerClientId,
    localSessionId,
    peerSessionId,
    localTrack,
    cameraTrack,
    screenTrack,
    sendSignal,
    onRemoteStream,
    onRemoteVideoTrack,
    onConnectionStateChange,
  }: VoicePeerConnectionOptions) {
    this.localClientId = localClientId;
    this.peerClientId = peerClientId;
    this.localSessionId = localSessionId;
    this.peerSessionId = peerSessionId;
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onRemoteVideoTrack = onRemoteVideoTrack;
    this.onConnectionStateChange = onConnectionStateChange;
    this.connection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });
    this.sender = this.connection.addTrack(
      localTrack,
      new MediaStream([localTrack]),
    );
    this.videoTracks = { camera: cameraTrack, screen: screenTrack };
    if (localClientId < peerClientId) {
      // Offering side: m-line order is audio, camera, screen.
      this.connection.addTransceiver('video', { direction: 'sendrecv' });
      this.connection.addTransceiver('video', { direction: 'sendrecv' });
      this.applyVideoTracks();
    }

    this.connection.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.send({
        kind: 'ice',
        candidate: {
          candidate: event.candidate.candidate,
          sdpMid: event.candidate.sdpMid,
          sdpMLineIndex: event.candidate.sdpMLineIndex,
          usernameFragment: event.candidate.usernameFragment,
        },
      });
    };
    this.connection.ontrack = (event) => {
      // Empty transceivers carry no msid, so `event.streams` is empty for the
      // video slots. Route on m-line order instead, before the audio path can
      // fold both video tracks into one stream.
      const slot = this.videoSlots().indexOf(event.transceiver);
      if (slot === 0 || slot === 1) {
        this.onRemoteVideoTrack(slot === 0 ? 'camera' : 'screen', event.track);
        return;
      }
      const stream = event.streams[0] ?? this.fallbackRemoteStream;
      if (event.streams.length === 0) {
        this.fallbackRemoteStream.addTrack(event.track);
      }
      this.onRemoteStream(stream);
    };
    this.connection.onconnectionstatechange = () => {
      if (!this.closed) {
        this.onConnectionStateChange(this.connection.connectionState);
      }
    };
  }

  /** Only the lower awareness client id creates the single offer. */
  async start(): Promise<void> {
    if (
      this.localClientId > this.peerClientId ||
      this.closed ||
      this.negotiationState !== 'new'
    ) {
      return;
    }
    this.negotiationState = 'offering';
    try {
      const offer = await this.connection.createOffer();
      if (this.closed) return;
      await this.connection.setLocalDescription(offer);
      if (this.closed) return;
      this.negotiationState = 'waiting-answer';
      const sdp = this.connection.localDescription?.sdp ?? offer.sdp;
      if (sdp) this.send({ kind: 'offer', sdp });
    } catch (error) {
      if (this.closed) return;
      throw error;
    }
  }

  handleSignal(signal: VoiceSignal): Promise<void> {
    const operation = this.signalQueue.then(() => this.applySignal(signal));
    this.signalQueue = operation.catch(() => {});
    return operation;
  }

  sendBye(): void {
    if (!this.closed) this.send({ kind: 'bye' });
  }

  private async applySignal(signal: VoiceSignal): Promise<void> {
    if (
      this.closed ||
      signal.from !== this.peerClientId ||
      signal.to !== this.localClientId ||
      signal.fromSessionId !== this.peerSessionId ||
      signal.toSessionId !== this.localSessionId
    ) {
      return;
    }
    if (signal.kind === 'bye') {
      this.close();
      return;
    }

    if (signal.kind === 'ice') {
      const candidateKey = JSON.stringify(signal.candidate);
      if (
        this.receivedIce.has(candidateKey) ||
        this.receivedIce.size >= MAX_REMOTE_ICE_CANDIDATES
      ) {
        return;
      }
      this.receivedIce.add(candidateKey);
      if (!this.connection.remoteDescription) {
        this.pendingIce.push(signal.candidate);
        return;
      }
      await this.connection.addIceCandidate(signal.candidate);
      return;
    }

    if (signal.kind === 'offer') {
      if (
        this.localClientId < this.peerClientId ||
        this.negotiationState !== 'new'
      ) {
        return;
      }
      this.negotiationState = 'answering';
      await this.connection.setRemoteDescription({
        type: 'offer',
        sdp: signal.sdp,
      });
      if (this.closed) return;
      this.adoptVideoSlots();
      await this.flushPendingIce();
      if (this.closed) return;
      const answer = await this.connection.createAnswer();
      if (this.closed) return;
      await this.connection.setLocalDescription(answer);
      if (this.closed) return;
      this.negotiationState = 'complete';
      const sdp = this.connection.localDescription?.sdp ?? answer.sdp;
      if (sdp) this.send({ kind: 'answer', sdp });
      return;
    }

    // `retry` is handled by the session, which rebuilds the connection rather
    // than routing the signal into an instance that is already failing.
    if (
      signal.kind !== 'answer' ||
      this.localClientId > this.peerClientId ||
      this.negotiationState !== 'waiting-answer'
    ) {
      return;
    }
    await this.connection.setRemoteDescription({
      type: 'answer',
      sdp: signal.sdp,
    });
    if (this.closed) return;
    await this.flushPendingIce();
    if (!this.closed) this.negotiationState = 'complete';
  }

  replaceTrack(track: MediaStreamTrack): Promise<void> {
    return this.sender.replaceTrack(track);
  }

  /** Publish or clear one video slot. Never renegotiates. */
  setVideoTrack(
    kind: VideoKind,
    track: MediaStreamTrack | null,
  ): Promise<void> {
    if (this.closed) return Promise.resolve();
    this.videoTracks[kind] = track;
    // Until this peer has answered an offer it has no video m-lines yet; the
    // track is applied by `adoptVideoSlots` when they arrive.
    const slot = this.videoSlots()[kind === 'camera' ? 0 : 1];
    return slot ? slot.sender.replaceTrack(track) : Promise.resolve();
  }

  /** The video m-lines, in the order both peers agreed on: camera, screen. */
  private videoSlots(): RTCRtpTransceiver[] {
    return this.connection
      .getTransceivers()
      .filter((transceiver) => transceiver.receiver.track?.kind === 'video');
  }

  /**
   * Take ownership of the video m-lines a remote offer just created. They
   * arrive `recvonly`, so they have to be switched back to `sendrecv` before
   * the answer is built or this peer can never publish.
   */
  private adoptVideoSlots(): void {
    for (const slot of this.videoSlots()) slot.direction = 'sendrecv';
    this.applyVideoTracks();
  }

  private applyVideoTracks(): void {
    const slots = this.videoSlots();
    void slots[0]?.sender.replaceTrack(this.videoTracks.camera);
    void slots[1]?.sender.replaceTrack(this.videoTracks.screen);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.connection.onicecandidate = null;
    this.connection.ontrack = null;
    this.connection.onconnectionstatechange = null;
    this.pendingIce.length = 0;
    this.receivedIce.clear();
    this.connection.close();
  }

  private async flushPendingIce(): Promise<void> {
    for (const candidate of this.pendingIce.splice(0)) {
      await this.connection.addIceCandidate(candidate);
    }
  }

  private send(
    signal:
      | { kind: 'offer' | 'answer'; sdp: string }
      | { kind: 'ice'; candidate: VoiceIceCandidate }
      | { kind: 'bye' },
  ): void {
    if (this.closed) return;
    this.sendSignal({
      from: this.localClientId,
      to: this.peerClientId,
      fromSessionId: this.localSessionId,
      toSessionId: this.peerSessionId,
      ...signal,
    });
  }
}
