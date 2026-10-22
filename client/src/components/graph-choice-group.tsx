import { Toggle } from '@base-ui/react/toggle';
import { ToggleGroup } from '@base-ui/react/toggle-group';

import { cn } from '@/lib/utils';

/**
 * Atlassian's button group with a selected state: subtle 32px buttons, the
 * chosen one in `background.selected` / `text.selected`. Atlassian has no
 * segmented control, so there is no track and no gliding plate.
 */
export function ChoiceGroup({ className, ...props }: ToggleGroup.Props) {
  return (
    <ToggleGroup
      className={cn('flex items-center gap-0.5', className)}
      {...props}
    />
  );
}

export function ChoiceItem({ className, ...props }: Toggle.Props) {
  return (
    <Toggle
      className={cn(
        'grid h-8 min-w-8 flex-1 place-items-center rounded-control text-fg-secondary transition-colors duration-fast hover:bg-tb-track hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus aria-pressed:bg-tb-sel-bg aria-pressed:text-tb-sel-fg aria-pressed:hover:bg-tb-sel-bg-hover',
        className,
      )}
      {...props}
    />
  );
}
