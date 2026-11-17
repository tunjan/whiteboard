import { Slider } from '@/components/ui/slider';

/**
 * The style panel's opacity fader.
 *
 * It is the shared capsule `Slider` — a thumb big enough to grab, stepping in
 * fives so a quick drag lands on 50%, not 47% — wrapped to own the 0–1 range
 * and to hand its caller a bare number rather than base-ui's number-or-array.
 *
 * It runs thinner than the shared control, and fills soft grey rather than
 * ink: this sits in the style panel among the colour swatches, where a
 * full-height black bar reads as a colour choice instead of an amount.
 */
export function OpacitySlider({
  value,
  onValueChange,
  'aria-label': ariaLabel,
}: {
  value: number;
  onValueChange: (value: number) => void;
  'aria-label': string;
}) {
  return (
    <Slider
      aria-label={ariaLabel}
      min={0}
      max={1}
      step={0.05}
      value={value}
      onValueChange={(next) =>
        onValueChange(Array.isArray(next) ? next[0]! : next)
      }
      className="[--wb-slider-thumb:1.125rem] [--wb-slider-track:1rem] [&_[data-slot=slider-range]]:bg-fg-subtle/40"
    />
  );
}
