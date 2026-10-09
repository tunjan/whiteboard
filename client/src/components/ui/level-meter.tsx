import { cn } from '@/lib/utils';

/**
 * The "sounding now" mark.
 *
 * One glyph for one claim: audio is coming out of this, right now. Wherever
 * the board makes that claim it makes it with this figure — the music rail
 * trigger and the playing row in its library, the voice trigger and the person
 * currently talking. Learned once, then recognised without a label.
 *
 * It is deliberately neither a speaker nor a microphone. Those figures name a
 * device, and both are already spoken for by controls that set one: the music
 * panel's volume, the voice panel's mic key. A level is the only figure here
 * that describes sound rather than hardware.
 *
 * Geometry and the animation live in section 9 of `index.css` alongside the
 * board's other motion, including the reduced-motion fallback that freezes the
 * bars at three different heights so it still reads as a level.
 */
export function LevelMeter({ className }: { className?: string }) {
  return (
    <span aria-hidden="true" className={cn('wb-level-meter', className)}>
      <span />
      <span />
      <span />
    </span>
  );
}
