import type { VoiceIceCandidate, VoiceSignal } from '@whiteboard/shared';

const ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
];

interface VoicePeerConnectionOptions {
  localClientId: number;
  peerClientId: number;
  localSessionId: string;
  peerSessionId: string;
  localTrack: MediaStreamTrack;
  sendSignal: (signal: VoiceSignal) => void;
  onRemoteStream: (stream: MediaStream) => void;
  onConnectionStateChange: (state: RTCPeerConnectionState) => void;
}

/** One static audio-only WebRTC connection in the room mesh. */
export class VoicePeerConnection {
  readonly peerClientId: number;
  readonly peerSessionId: string;

  private readonly localClientId: number;
  private readonly localSessionId: string;
  private readonly connection: RTCPeerConnection;
  private readonly sender: RTCRtpSender;
  private readonly sendSignal: (signal: VoiceSignal) => void;
  private readonly onRemoteStream: (stream: MediaStream) => void;
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
    sendSignal,
    onRemoteStream,
    onConnectionStateChange,
  }: VoicePeerConnectionOptions) {
    this.localClientId = localClientId;
    this.peerClientId = peerClientId;
    this.localSessionId = localSessionId;
    this.peerSessionId = peerSessionId;
    this.sendSignal = sendSignal;
    this.onRemoteStream = onRemoteStream;
    this.onConnectionStateChange = onConnectionStateChange;
    this.connection = new RTCPeerConnection({
      iceServers: ICE_SERVERS,
    });
    this.sender = this.connection.addTrack(
      localTrack,
      new MediaStream([localTrack]),
    );

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
      if (this.receivedIce.has(candidateKey)) return;
      if (this.receivedIce.size >= 128) {
        throw new Error('Too many voice ICE candidates');
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

    if (
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
