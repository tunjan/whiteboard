import { soundVolume, withAudio } from '@/lib/sound';

/**
 * The board agent answering: a notification, so unlike the pen it *is* a
 * chime — two notes, low and warm, a held interval the ear reads as "here".
 *
 * Done rises a fifth (G3 → D4); a failure falls a whole tone (E3 → D3), the
 * same timbre turned down so it reads as "no" without becoming an alarm. Each
 * note is a sine with a quiet octave on top for body, through a lowpass so
 * nothing in it is bright, and a slow-ish attack so it blooms rather than taps.
 */
export function playAgentSound(kind: 'done' | 'error'): void {
  withAudio((context) => {
    const volume = soundVolume();
    const now = context.currentTime + 0.01;
    const [first, second] = kind === 'done' ? [196, 293.66] : [164.81, 146.83];
    note(context, now, first, 0.55, 0.07 * volume);
    note(context, now + 0.11, second, 0.75, 0.06 * volume);
  });
}

function note(
  context: AudioContext,
  start: number,
  frequency: number,
  duration: number,
  level: number,
): void {
  const filter = context.createBiquadFilter();
  const gain = context.createGain();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1_400, start);
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.025);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
  filter.connect(gain).connect(context.destination);

  const partials = [
    [frequency, 1],
    [frequency * 2, 0.18],
  ] as const;
  const oscillators = partials.map(([hz, weight]) => {
    const oscillator = context.createOscillator();
    const partialGain = context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(hz, start);
    partialGain.gain.setValueAtTime(weight, start);
    oscillator.connect(partialGain).connect(filter);
    oscillator.start(start);
    oscillator.stop(start + duration);
    return { oscillator, partialGain };
  });
  oscillators[0]!.oscillator.onended = () => {
    for (const { oscillator, partialGain } of oscillators) {
      oscillator.disconnect();
      partialGain.disconnect();
    }
    filter.disconnect();
    gain.disconnect();
  };
}
