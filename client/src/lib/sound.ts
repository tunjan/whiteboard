import { useVoiceStore } from '@/collab/voice/use-voice-store';

let audioContext: AudioContext | null = null;

/**
 * One context for every synthesised UI sound. Browsers cap how many a page may
 * hold, and each one is a device-latency-sized allocation, so the voice chime
 * and the tool sounds share this rather than each opening their own.
 */
export function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  return audioContext;
}

/**
 * The one preference behind every sound the app makes — the "Sound effects"
 * switch and its volume in the board menu. Reduced motion silences them too:
 * the setting is the closest thing the platform gives us to "don't decorate".
 */
export function soundAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  const { soundEffectsEnabled, soundEffectsVolume } =
    useVoiceStore.getState();
  const prefersReducedMotion =
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  return (
    soundEffectsEnabled &&
    soundEffectsVolume > 0 &&
    !prefersReducedMotion
  );
}

export function soundVolume(): number {
  return useVoiceStore.getState().soundEffectsVolume;
}

/** Run `play` once the context is awake, or drop it if it never wakes. */
export function withAudio(play: (context: AudioContext) => void): void {
  if (!soundAllowed()) return;
  const context = getAudioContext();
  if (!context) return;

  const run = () => {
    if (context.state === 'closed') return;
    play(context);
  };

  if (context.state === 'suspended') {
    void context.resume().then(run).catch(() => {});
  } else {
    run();
  }
}
