import { Button as ButtonPrimitive } from '@base-ui/react/button';
import { cva, type VariantProps } from 'class-variance-authority';

import { cn } from '@/lib/utils';

const buttonVariants = cva(
  'group/button inline-flex shrink-0 items-center justify-center border border-transparent font-medium whitespace-nowrap transition-colors duration-instant ease-out-quart select-none disabled:pointer-events-none disabled:border-border disabled:bg-panel disabled:text-fg-subtle [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default:
          'bg-action text-on-action hover:bg-action-hover active:bg-action-active',
        primary:
          'bg-action text-on-action hover:bg-action-hover active:bg-action-active',
        outline:
          'border-control-border bg-surface text-fg hover:bg-surface-hover',
        secondary:
          'border-border bg-panel text-fg hover:border-border-strong hover:bg-surface-hover',
        subtle: 'bg-panel text-fg hover:bg-surface-hover',
        // Hover resolves against whatever surface the button sits on. A fixed
        // `bg-panel` hover is invisible on the docked chrome panels, which are
        // themselves `bg-panel` — every control in the four corner panels had
        // no hover response at all. Surfaces that aren't panel-coloured set
        // `--chrome-hover`; everything else keeps the panel fallback.
        //
        // A variant with no resting fill must also not grow one when disabled,
        // or a greyed-out chrome button paints a chip the enabled one never
        // had and the row loses its rhythm.
        ghost:
          'bg-transparent text-fg-secondary hover:bg-[var(--chrome-hover,var(--color-panel))] hover:text-fg disabled:bg-transparent',
        destructive:
          'border-danger-control-border bg-surface text-danger-fg hover:bg-danger-bg',
        link: 'text-fg underline-offset-4 hover:underline disabled:bg-transparent',
      },
      size: {
        default: 'h-10 gap-2 rounded-control px-4 text-base',
        xs: "h-6 gap-1 rounded-compact px-2 text-2xs [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        sm: "h-8 gap-2 rounded-control px-3 text-sm [&>svg:not([class*='size-']):not([data-native-size])]:size-3.5",
        md: "h-10 gap-2 rounded-control px-4 text-base [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        lg: "h-12 gap-2 rounded-control px-5 text-md [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        icon: "size-10 rounded-control [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        'icon-xs':
          "size-6 rounded-compact [&>svg:not([class*='size-']):not([data-native-size])]:size-3",
        'icon-sm':
          "size-8 rounded-control [&>svg:not([class*='size-']):not([data-native-size])]:size-4",
        'icon-md':
          "size-10 rounded-control [&>svg:not([class*='size-']):not([data-native-size])]:size-4.5",
        'icon-lg':
          "size-12 rounded-control [&>svg:not([class*='size-']):not([data-native-size])]:size-5",
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function Button({
  className,
  variant = 'default',
  size = 'default',
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
