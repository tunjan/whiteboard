import { Axis3D, Blend } from 'lucide-react';
import type { GraphProps } from '@whiteboard/shared';
import { Field, FieldLabel } from '@/components/ui/field';
import { Switch } from '@/components/ui/switch';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/* ─── Compact Display Toggles ───────────────────────────────────────────── */

export function DisplaySettings({
  showAxisLabels,
  showIntersections,
  onPatch,
}: {
  showAxisLabels: boolean;
  showIntersections: boolean;
  onPatch: (patch: Partial<GraphProps>) => void;
}) {
  return (
    <TooltipProvider delay={300}>
      <div className="flex items-center justify-around gap-4 px-1 py-0.5">
        <Tooltip>
          <TooltipTrigger
            render={
              <Field
                orientation="horizontal"
                className="items-center gap-2"
              >
                <Switch
                  id="graph-axis-numbers"
                  checked={showAxisLabels}
                  onCheckedChange={(checked) => onPatch({ showAxisLabels: checked })}
                />
                <FieldLabel
                  htmlFor="graph-axis-numbers"
                  className="cursor-pointer select-none text-fg-secondary hover:text-fg"
                >
                  <span className="grid size-5 place-items-center">
                    <Axis3D className="size-4" aria-hidden="true" />
                  </span>
                  <span className="sr-only">Axis numbers</span>
                </FieldLabel>
              </Field>
            }
          />
          <TooltipContent side="bottom">Axis numbers</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger
            render={
              <Field
                orientation="horizontal"
                className="items-center gap-2"
              >
                <Switch
                  id="graph-intersections"
                  checked={showIntersections}
                  onCheckedChange={(checked) =>
                    onPatch({ showIntersections: checked })
                  }
                />
                <FieldLabel
                  htmlFor="graph-intersections"
                  className="cursor-pointer select-none text-fg-secondary hover:text-fg"
                >
                  <span className="grid size-5 place-items-center">
                    <Blend className="size-4" aria-hidden="true" />
                  </span>
                  <span className="sr-only">Intersections</span>
                </FieldLabel>
              </Field>
            }
          />
          <TooltipContent side="bottom">Intersections</TooltipContent>
        </Tooltip>
      </div>
    </TooltipProvider>
  );
}
