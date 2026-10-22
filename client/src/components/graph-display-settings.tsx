import type { GraphProps } from '@whiteboard/shared';
import { Switch } from '@/components/ui/switch';

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

/** How the graph is drawn: one labelled toggle per row, label left, toggle right. */
export function DisplaySettings({
  showAxisLabels,
  showIntersections,
  onPatch,
}: {
  showAxisLabels: boolean;
  showIntersections: boolean;
  onPatch: (patch: Partial<GraphProps>) => void;
}) {
  const values = { showAxisLabels, showIntersections };
  return (
    <div className="flex shrink-0 flex-col border-t border-border px-4 py-2">
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
