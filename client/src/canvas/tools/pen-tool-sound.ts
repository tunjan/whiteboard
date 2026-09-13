// A soft, low tone marking the pen tool switching on or off — deliberately
// deep and understated rather than a UI "blip", so it doesn't compete with
// the sound of actually drawing.

let audioContext: AudioContext | null = null;

function reducedMotionPreferred(): boolean {
  return (
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}

function getAudioContext(): AudioContext | null {
  if (typeof AudioContext === 'undefined') return null;
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new AudioContext();
  }
  return audioContext;
}

export function playPenToolSound(kind: 'activate' | 'deactivate'): void {
  if (typeof window === 'undefined' || reducedMotionPreferred()) return;
  const context = getAudioContext();
  if (!context) return;

  const play = () => {
    if (context.state === 'closed') return;
    const now = context.currentTime + 0.005;
    const [from, to] = kind === 'activate' ? [146, 174] : [174, 138];
    tone(context, now, from, to);
  };

  if (context.state === 'suspended') {
    void context.resume().then(play).catch(() => {});
  } else {
    play();
  }
}

function tone(
  context: AudioContext,
  start: number,
  startFrequency: number,
  endFrequency: number,
): void {
  const duration = 0.1;
  const level = 0.05;
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(startFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    endFrequency,
    start + duration,
  );
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.015);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}
