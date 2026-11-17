import type { GraphProps } from '@whiteboard/shared';
import { Switch } from '@/components/ui/switch';
import { ChoiceGroup, ChoiceItem } from './graph-choice-group';

const ANGLE_UNITS = [
  { value: 'rad', label: 'Radians' },
  { value: 'deg', label: 'Degrees' },
] as const;

const TOGGLES = [
  { key: 'showAxisLabels', label: 'Axis numbers' },
  { key: 'showIntersections', label: 'Intersections' },
] as const;

/**
 * Atlassian's Toggle: `background.neutral.bold` off, `background.success.bold`
 * on, an `icon.inverse` thumb, and a 2px `border.focused` ring.
 */
const ATLASSIAN_TOGGLE =
  'data-unchecked:bg-[var(--ds-background-neutral-bold)] data-unchecked:hover:bg-[var(--ds-background-neutral-bold-hovered)] data-unchecked:active:bg-[var(--ds-background-neutral-bold-pressed)] ' +
  'data-checked:bg-[var(--ds-background-success-bold)] data-checked:hover:bg-[var(--ds-background-success-bold-hovered)] data-checked:active:bg-[var(--ds-background-success-bold-pressed)] ' +
  '[&>[data-slot=switch-thumb]]:bg-[var(--ds-icon-inverse)] [&>[data-slot=switch-thumb]]:shadow-none ' +
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ds-border-focused)]';

/**
 * How the graph is drawn and read: one labelled control per row, label left,
 * control right.
 */
export function DisplaySettings({
  showAxisLabels,
  showIntersections,
  angleUnit,
  onAngleUnit,
  onPatch,
}: {
  showAxisLabels: boolean;
  showIntersections: boolean;
  angleUnit: 'rad' | 'deg';
  onAngleUnit: (unit: 'rad' | 'deg') => void;
  onPatch: (patch: Partial<GraphProps>) => void;
}) {
  const values = { showAxisLabels, showIntersections };
  return (
    <div className="flex shrink-0 flex-col border-t border-border px-4 py-2">
      <div className="flex h-10 items-center justify-between gap-3 text-sm text-fg">
        <span id="graph-angle-unit" className="select-none">
          Angles
        </span>
        <ChoiceGroup
          aria-labelledby="graph-angle-unit"
          value={[angleUnit]}
          onValueChange={(value) => {
            const unit = value[0] as 'rad' | 'deg' | undefined;
            if (unit) onAngleUnit(unit);
          }}
        >
          {ANGLE_UNITS.map(({ value, label }) => (
            <ChoiceItem
              key={value}
              value={value}
              className="flex-none px-2.5 text-sm"
            >
              {label}
            </ChoiceItem>
          ))}
        </ChoiceGroup>
      </div>
      {TOGGLES.map(({ key, label }) => (
        <label
          key={key}
          className="flex h-10 cursor-pointer items-center justify-between gap-3 text-sm text-fg select-none"
        >
          {label}
          <Switch
            checked={values[key]}
            onCheckedChange={(checked) => onPatch({ [key]: checked })}
            className={ATLASSIAN_TOGGLE}
          />
        </label>
      ))}
    </div>
  );
}
