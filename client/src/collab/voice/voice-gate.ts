export const MIN_VOICE_LEVEL_DB = -60;
export const MAX_VOICE_LEVEL_DB = -10;
export const DEFAULT_GATE_THRESHOLD_DB = -45;

export interface VoiceGateLevel {
  levelDb: number;
  speaking: boolean;
}

export interface VoiceGate {
  readonly outboundTrack: MediaStreamTrack;
  setMuted: (muted: boolean) => void;
  setThreshold: (thresholdDb: number) => void;
  replaceInput: (track: MediaStreamTrack) => void;
  stop: () => void;
}

interface VoiceGateOptions {
  thresholdDb: number;
  onLevel: (level: VoiceGateLevel) => void;
}

/** Create an audio-thread noise gate whose output track stays stable for WebRTC. */
export async function createVoiceGate(
  inputTrack: MediaStreamTrack,
  { thresholdDb, onLevel }: VoiceGateOptions,
): Promise<VoiceGate> {
  const context = new AudioContext();
  let source: MediaStreamAudioSourceNode | null = null;
  let node: AudioWorkletNode | null = null;
  let destination: MediaStreamAudioDestinationNode | null = null;

  try {
    await context.audioWorklet.addModule(
      `${import.meta.env.BASE_URL}voice-gate-worklet.js`,
    );
    source = context.createMediaStreamSource(
      new MediaStream([inputTrack]),
    );
    node = new AudioWorkletNode(context, 'whiteboard-voice-gate', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    destination = context.createMediaStreamDestination();
    source.connect(node).connect(destination);

    const outboundTrack = destination.stream.getAudioTracks()[0];
    if (!outboundTrack) throw new Error('Voice gate unavailable');

    node.port.onmessage = ({ data }: MessageEvent<unknown>) => {
      if (!isVoiceGateLevel(data)) return;
      onLevel({
        levelDb: clampVoiceLevel(data.levelDb),
        speaking: data.speaking,
      });
    };
    node.port.postMessage({
      type: 'threshold',
      value: clampGateThreshold(thresholdDb),
    });
    node.port.postMessage({ type: 'muted', value: true });

    await context.resume();
    inputTrack.enabled = true;

    let currentInput = inputTrack;
    let currentSource = source;
    let stopped = false;
    return {
      outboundTrack,
      setMuted: (muted) => {
        if (!stopped) node?.port.postMessage({ type: 'muted', value: muted });
      },
      setThreshold: (nextThresholdDb) => {
        if (!stopped) {
          node?.port.postMessage({
            type: 'threshold',
            value: clampGateThreshold(nextThresholdDb),
          });
        }
      },
      replaceInput: (nextTrack) => {
        if (stopped || !node) {
          nextTrack.stop();
          return;
        }
        const nextSource = context.createMediaStreamSource(
          new MediaStream([nextTrack]),
        );
        nextSource.connect(node);
        currentSource.disconnect();
        currentInput.enabled = false;
        nextTrack.enabled = true;
        currentInput = nextTrack;
        currentSource = nextSource;
      },
      stop: () => {
        if (stopped) return;
        stopped = true;
        currentSource.disconnect();
        node!.port.onmessage = null;
        node!.disconnect();
        destination!.disconnect();
        outboundTrack.stop();
        void context.close();
      },
    };
  } catch (error) {
    inputTrack.enabled = false;
    source?.disconnect();
    if (node) {
      node.port.onmessage = null;
      node.disconnect();
    }
    destination?.disconnect();
    destination?.stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw error;
  }
}

export function clampGateThreshold(thresholdDb: number): number {
  return Math.min(
    MAX_VOICE_LEVEL_DB,
    Math.max(MIN_VOICE_LEVEL_DB, Math.round(thresholdDb)),
  );
}

export function clampVoiceLevel(levelDb: number): number {
  if (!Number.isFinite(levelDb)) return MIN_VOICE_LEVEL_DB;
  return Math.min(
    MAX_VOICE_LEVEL_DB,
    Math.max(MIN_VOICE_LEVEL_DB, levelDb),
  );
}

export function voiceLevelPercent(levelDb: number): number {
  return (
    ((clampVoiceLevel(levelDb) - MIN_VOICE_LEVEL_DB) /
      (MAX_VOICE_LEVEL_DB - MIN_VOICE_LEVEL_DB)) *
    100
  );
}

function isVoiceGateLevel(value: unknown): value is VoiceGateLevel {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.levelDb === 'number' &&
    Number.isFinite(candidate.levelDb) &&
    typeof candidate.speaking === 'boolean'
  );
}
