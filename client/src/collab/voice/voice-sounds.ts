import { useVoiceStore } from './use-voice-store';

export type VoiceSound =
  | 'join'
  | 'leave'
  | 'mute'
  | 'unmute'
  | 'error';

let audioContext: AudioContext | null = null;

function soundAllowed(): boolean {
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

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function primeVoiceSounds(): void {
  if (!soundAllowed()) return;
  const context = getAudioContext();
  if (context?.state === 'suspended') {
    void context.resume().catch(() => {});
  }
}

export function playVoiceSound(sound: VoiceSound): void {
  if (!soundAllowed()) return;
  const context = getAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state === 'closed') return;
    synthesize(context, sound, useVoiceStore.getState().soundEffectsVolume);
  };

  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

function synthesize(
  context: AudioContext,
  sound: VoiceSound,
  volume: number,
): void {
  const now = context.currentTime + 0.006;

  switch (sound) {
    case 'join':
      tap(context, now, 3_600, 0.035 * volume);
      tone(context, now, 0.09, 500, 515, 0.055 * volume);
      break;
    case 'leave':
      tap(context, now, 3_200, 0.03 * volume);
      tone(context, now, 0.085, 410, 398, 0.05 * volume);
      break;
    case 'mute':
      tap(context, now, 3_200, 0.15 * volume);
      break;
    case 'unmute':
      tap(context, now, 4_200, 0.15 * volume);
      break;
    case 'error':
      tone(context, now, 0.14, 270, 258, 0.055 * volume);
      break;
  }
}

function tone(
  context: AudioContext,
  start: number,
  duration: number,
  startFrequency: number,
  endFrequency: number,
  level: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  const attackEnd = start + Math.min(0.012, duration * 0.25);

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    endFrequency,
    start + duration,
  );
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, attackEnd);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

function tap(
  context: AudioContext,
  start: number,
  frequency: number,
  level: number,
): void {
  const duration = 0.012;
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      (Math.random() * 2 - 1) * Math.exp(-index / (length * 0.18));
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = 'bandpass';
  filter.frequency.setValueAtTime(frequency, start);
  filter.Q.setValueAtTime(3, start);
  gain.gain.setValueAtTime(level, start);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  source.connect(filter).connect(gain).connect(context.destination);
  source.start(start);
  source.stop(start + duration);
  source.onended = () => {
    source.disconnect();
    filter.disconnect();
    gain.disconnect();
  };
}
