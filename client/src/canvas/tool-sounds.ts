import { withAudio, soundVolume } from '@/lib/sound';

/**
 * Picking the pen up and setting it down.
 *
 * Not a chime. Two pitches held long enough to make an interval is the form a
 * notification takes, and it reads as one no matter how deep or soft it gets —
 * a melody is a message, and the pen is not sending one. So there is no
 * interval here, and no note: one soft knock, a pitch falling away too fast to
 * land anywhere the ear can name.
 *
 * Engage and disengage are the same knock at two weights. Picking the pen up
 * is the brighter, firmer of the two; setting it down is darker, drops further
 * and takes longer to go. That difference carries the direction without either
 * one becoming a tone.
 */
export function playPenSound(active: boolean): void {
  withAudio((context) => {
    const volume = soundVolume();
    const now = context.currentTime + 0.006;

    if (active) {
      knock(context, now, 190, 104, 0.075, 0.2, 0.09 * volume);
      contact(context, now, 820, 0.022, 0.05 * volume);
    } else {
      knock(context, now, 148, 72, 0.095, 0.27, 0.085 * volume);
      contact(context, now, 430, 0.02, 0.035 * volume);
    }
  });
}

/**
 * A held stroke settling into its clean shape: the same knock as the pen, far
 * lighter and higher, so it reads as the nib clicking into place rather than
 * as the pen being picked up.
 */
export function playSnapSound(): void {
  withAudio((context) => {
    const volume = soundVolume();
    const now = context.currentTime + 0.004;
    knock(context, now, 420, 260, 0.03, 0.09, 0.05 * volume);
    contact(context, now, 2600, 0.012, 0.03 * volume);
  });
}

/**
 * An erase landing: the snap's knock, dropped low and given more breath, so it
 * reads as rubber lifting off paper rather than a nib clicking home. Only for a
 * swipe that actually took something.
 */
export function playEraseSound(): void {
  withAudio((context) => {
    const volume = soundVolume();
    const now = context.currentTime + 0.004;
    knock(context, now, 210, 118, 0.05, 0.13, 0.04 * volume);
    contact(context, now, 1300, 0.045, 0.03 * volume);
  });
}

/**
 * The body: a sine whose pitch collapses through the first tenth of a second.
 * A pitch that never settles is what separates a struck object from a note —
 * it is the whole reason this doesn't sound like a chime.
 */
function knock(
  context: AudioContext,
  start: number,
  fromFrequency: number,
  toFrequency: number,
  bend: number,
  duration: number,
  level: number,
): void {
  const oscillator = context.createOscillator();
  const gain = context.createGain();

  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(fromFrequency, start);
  oscillator.frequency.exponentialRampToValueAtTime(
    toFrequency,
    start + bend,
  );

  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(level, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  oscillator.connect(gain).connect(context.destination);
  oscillator.start(start);
  oscillator.stop(start + duration);
  oscillator.onended = () => {
    oscillator.disconnect();
    gain.disconnect();
  };
}

/**
 * The moment of touch: a breath of noise under a low shelf, gone in 20ms. Too
 * short to have a pitch, it only gives the body something to start from — a
 * sine fading up out of nothing is a swell, and a swell is what makes a knock
 * sound synthesised.
 */
function contact(
  context: AudioContext,
  start: number,
  cutoff: number,
  duration: number,
  level: number,
): void {
  const length = Math.ceil(context.sampleRate * duration);
  const buffer = context.createBuffer(1, length, context.sampleRate);
  const samples = buffer.getChannelData(0);

  for (let index = 0; index < samples.length; index += 1) {
    samples[index] =
      (Math.random() * 2 - 1) * Math.exp(-index / (length * 0.3));
  }

  const source = context.createBufferSource();
  const filter = context.createBiquadFilter();
  const gain = context.createGain();

  source.buffer = buffer;
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(cutoff, start);
  filter.Q.setValueAtTime(0.7, start);
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
