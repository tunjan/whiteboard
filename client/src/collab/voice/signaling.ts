import {
  decodeVoiceSignal,
  type VoiceSignal,
} from '@whiteboard/shared';

export interface VoiceSignalingProvider {
  awareness: { clientID: number } | null;
  on: (
    event: string,
    listener: (event: { payload: string }) => void,
  ) => unknown;
  off: (
    event: string,
    listener: (event: { payload: string }) => void,
  ) => unknown;
  sendStateless: (payload: string) => void;
}

/** Receive addressed voice signals over the board's stateless message channel. */
export function startVoiceSignaling(
  provider: VoiceSignalingProvider,
  onSignal: (signal: VoiceSignal) => void,
): () => void {
  const clientId = provider.awareness?.clientID;
  const onStateless = ({ payload }: { payload: string }) => {
    if (clientId === undefined) return;
    const signal = decodeVoiceSignal(payload);
    if (!signal || signal.to !== clientId || signal.from === clientId) return;
    onSignal(signal);
  };

  provider.on('stateless', onStateless);
  return () => provider.off('stateless', onStateless);
}
