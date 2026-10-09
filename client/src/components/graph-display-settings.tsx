import type { GraphProps } from '@whiteboard/shared';
import { Switch } from '@/components/ui/switch';

const TOGGLES = [
  { key: 'showAxisLabels', label: 'Axis numbers' },
  { key: 'showIntersections', label: 'Intersections' },
] as const;

/** How the graph is drawn: a footer on the panel's recessed ground. */
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
    <div className="flex shrink-0 items-center gap-5 border-t border-border bg-panel px-3 py-2.5">
      {TOGGLES.map(({ key, label }) => (
        <label
          key={key}
          className="flex cursor-pointer items-center gap-2 text-xs text-fg-secondary select-none hover:text-fg"
        >
          <Switch
            size="sm"
            checked={values[key]}
            onCheckedChange={(checked) => onPatch({ [key]: checked })}
          />
          {label}
        </label>
      ))}
    </div>
  );
}
