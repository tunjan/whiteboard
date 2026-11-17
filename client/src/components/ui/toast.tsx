import * as React from 'react';
import { Toast as ToastPrimitive } from '@base-ui/react/toast';
import {
  CircleCheck,
  Info,
  Loader2,
  OctagonX,
  TriangleAlert,
  X,
} from 'lucide-react';

import { cn } from '@/lib/utils';
import { Avatar, AvatarFallback, AvatarGroup } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';

/** What a toast can show beyond its words. `ToastList` draws all of it. */
interface ToastData {
  /** Who this is about: their discs take the place of the type icon. */
  people?: { name: string; color: string }[];
  /** How far a `loading` toast has got, 0 to 1, along its bottom edge. */
  progress?: number;
  /** Run the toast's time down its bottom edge, for a window that matters. */
  countdown?: boolean;
}

const manager = ToastPrimitive.createToastManager<ToastData>();

type ToastOptions = Parameters<typeof manager.update<ToastData>>[1];

/**
 * A beat to notice it, then time to read every word of it. An error gets half
 * as long again: it is the one toast the reader may have to act on.
 */
function readingTimeMs({ title, description, type }: ToastOptions): number {
  const words = [title, description].filter((text) => typeof text === 'string');
  const ms = 3_000 + words.join('').length * 60;
  return Math.min(type === 'error' ? ms * 1.5 : ms, 12_000);
}

function withDefaults<Options extends ToastOptions>(options: Options): Options {
  return {
    timeout: readingTimeMs(options),
    ...(options.type === 'error' ? { priority: 'high' as const } : null),
    ...options,
  };
}

/**
 * The app's handle on its toasts. Timing comes from the text, so callers rarely
 * name a timeout, and an error that fires again restarts the one already up
 * instead of stacking a copy of itself.
 */
const toast = {
  ...manager,
  add(options: Parameters<typeof manager.add<ToastData>>[0]) {
    const repeatable =
      options.type === 'error'
        ? `error:${options.title}:${options.description}`
        : undefined;
    return manager.add({ id: repeatable, ...withDefaults(options) });
  },
  update(id: string, updates: ToastOptions) {
    // A new type is a new message: a finished upload has to start its clock.
    manager.update(id, updates.type ? withDefaults(updates) : updates);
  },
};

function ToastProvider({ ...props }: ToastPrimitive.Provider.Props) {
  return <ToastPrimitive.Provider {...props} />;
}

function ToastPortal({ ...props }: ToastPrimitive.Portal.Props) {
  return <ToastPrimitive.Portal data-slot="toast-portal" {...props} />;
}

function ToastViewport({ className, ...props }: ToastPrimitive.Viewport.Props) {
  return (
    <ToastPrimitive.Viewport
      data-slot="toast-viewport"
      className={cn(
        // Top right, under the people the news is usually about: clear of the
        // toolbar and the view controls, and of the hand holding the pen. High
        // enough on a phone for the top band to wrap, and just under Home's nav.
        'pointer-events-none fixed inset-x-4 top-[calc(5.5rem+env(safe-area-inset-top))] z-50 mx-auto w-auto max-w-sm outline-none sm:top-[calc(4rem+env(safe-area-inset-top))] sm:right-[max(0.75rem,env(safe-area-inset-right))] sm:left-auto sm:mx-0 sm:w-[22.5rem]',
        className,
      )}
      {...props}
    />
  );
}

function Toast({ className, ...props }: ToastPrimitive.Root.Props) {
  return (
    <ToastPrimitive.Root
      data-slot="toast"
      className={cn(
        'group/toast pointer-events-auto absolute top-0 right-0 z-[calc(1000-var(--toast-index))] w-full origin-top rounded-overlay border border-border bg-popup-surface text-fg shadow-overlay will-change-transform select-none',
        '[--gap:0.5rem] [--height:var(--toast-frontmost-height,var(--toast-height))] [--offset-y:calc(var(--toast-offset-y)+var(--toast-index)*var(--gap)+var(--toast-swipe-movement-y))] [--peek:0.5rem] [--scale:calc(max(0,1-var(--toast-index)*0.05))] [--shrink:calc(1-var(--scale))]',
        'h-(--height) [transform:translateX(var(--toast-swipe-movement-x))_translateY(calc(var(--toast-swipe-movement-y)+var(--toast-index)*var(--peek)+var(--shrink)*var(--height)))_scale(var(--scale))]',
        // Arrives unhurried and leaves at once. `translate` and `opacity` sit
        // apart from the stack's `transform`, so a toast fading from the middle
        // of an expanded stack fades where it stands.
        '[transition:transform_320ms_var(--ease-out-expo),translate_320ms_var(--ease-out-expo),opacity_180ms_ease-out,height_200ms_var(--ease-out-expo)] data-ending-style:[transition-duration:160ms] motion-reduce:[transition:opacity_150ms_ease-out]',
        "after:absolute after:bottom-full after:left-0 after:h-[calc(var(--gap)+1px)] after:w-full after:content-['']",
        'data-expanded:h-(--toast-height) data-expanded:[transform:translateX(var(--toast-swipe-movement-x))_translateY(var(--offset-y))]',
        'data-limited:opacity-0 data-starting-style:-translate-y-3 data-starting-style:opacity-0 [&[data-ending-style]:not([data-swipe-direction])]:opacity-0',
        'data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]',
        'data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]',
        'data-expanded:data-ending-style:data-[swipe-direction=right]:[transform:translateX(calc(var(--toast-swipe-movement-x)+150%))_translateY(var(--offset-y))]',
        'data-expanded:data-ending-style:data-[swipe-direction=up]:[transform:translateY(calc(var(--toast-swipe-movement-y)-150%))]',
        // A stroke passing underneath shouldn't be drawn blind, or end on a toast.
        '[:root[data-canvas-held]_&]:pointer-events-none [:root[data-canvas-held]_&]:opacity-20',
        className,
      )}
      {...props}
    />
  );
}

function ToastContent({ className, ...props }: ToastPrimitive.Content.Props) {
  return (
    <ToastPrimitive.Content
      data-slot="toast-content"
      className={cn(
        // One 12px inset all round. The leading disc or icon, the title's line and
        // the close glyph share one 24px row, so both top corners mirror.
        'relative flex h-full items-start gap-3 overflow-hidden rounded-[inherit] p-3 transition-opacity duration-250 ease-[cubic-bezier(0.22,1,0.36,1)] data-behind:opacity-0 data-expanded:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function ToastTitle({ className, ...props }: ToastPrimitive.Title.Props) {
  return (
    <ToastPrimitive.Title
      data-slot="toast-title"
      className={cn(
        'text-sm/6 font-semibold [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

function ToastDescription({
  className,
  ...props
}: ToastPrimitive.Description.Props) {
  return (
    <ToastPrimitive.Description
      data-slot="toast-description"
      className={cn(
        'line-clamp-3 text-sm/5 text-pretty text-fg-secondary tabular-nums [overflow-wrap:anywhere]',
        className,
      )}
      {...props}
    />
  );
}

function ToastAction({
  className,
  render = <Button variant="outline" size="sm" />,
  ...props
}: ToastPrimitive.Action.Props) {
  return (
    <ToastPrimitive.Action
      data-slot="toast-action"
      render={render}
      className={cn('-my-1 shrink-0', className)}
      {...props}
    />
  );
}

function ToastClose({
  className,
  children,
  render = <Button variant="ghost" size="icon-sm" />,
  ...props
}: ToastPrimitive.Close.Props) {
  return (
    <ToastPrimitive.Close
      data-slot="toast-close"
      aria-label="Dismiss"
      render={render}
      className={cn(
        "relative -my-1 -mr-1 shrink-0 text-fg-muted after:absolute after:-inset-2 after:content-[''] hover:text-fg",
        className,
      )}
      {...props}
    >
      {children ?? <X aria-hidden="true" />}
    </ToastPrimitive.Close>
  );
}

type ToastItem = ToastPrimitive.Root.ToastObject<ToastData>;

function ToastIcon({ item }: { item: ToastItem }) {
  const { people } = item.data ?? {};
  if (people) {
    return (
      <AvatarGroup className="shrink-0*:data-[slot=avatar]:ring-popup-surface">
        {people.slice(-3).map(({ name, color }) => (
          <Avatar key={`${name}${color}`} size="sm">
            <AvatarFallback style={{ backgroundColor: color, color: '#FFFFFF' }}>
              {name.trim().charAt(0).toUpperCase() || '?'}
            </AvatarFallback>
          </Avatar>
        ))}
      </AvatarGroup>
    );
  }

  let icon: React.ReactNode = null;

  if (item.type === 'success')
    icon = <CircleCheck className="text-success" aria-hidden="true" />;
  if (item.type === 'info')
    icon = <Info className="text-info" aria-hidden="true" />;
  if (item.type === 'warning')
    icon = <TriangleAlert className="text-warning" aria-hidden="true" />;
  if (item.type === 'error')
    icon = <OctagonX className="text-danger-fg" aria-hidden="true" />;
  if (item.type === 'loading')
    icon = (
      <Loader2 className="animate-spin text-fg-muted" aria-hidden="true" />
    );

  if (!icon) {
    return null;
  }

  return (
    <span
      data-slot="toast-icon"
      className="flex size-6 shrink-0 items-center justify-center motion-safe:animate-[toast-icon-in_260ms_var(--ease-out-expo)] [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4"
    >
      {icon}
    </span>
  );
}

/** The bottom edge: how far along the work is, or how long is left. */
function ToastMeter({ item }: { item: ToastItem }) {
  const { progress, countdown } = item.data ?? {};
  const edge = 'absolute inset-x-0 bottom-0 h-0.5 origin-left';

  if (item.type === 'loading' && progress !== undefined) {
    return (
      <span
        aria-hidden="true"
        className={cn(edge, 'bg-action transition-transform duration-200')}
        style={{ transform: `scaleX(${progress})` }}
      />
    );
  }
  if (countdown) {
    // Paused with the timer, which stops on hover and focus. It also stops when
    // the window loses focus, where this keeps running: the bar can only ever
    // promise less time than there is, never more.
    return (
      <span
        key={item.updateKey}
        aria-hidden="true"
        className={cn(
          edge,
          'animate-[toast-countdown_linear_forwards] bg-fg-subtle group-data-expanded/toast:[animation-play-state:paused]',
        )}
        style={{ animationDuration: `${item.timeout}ms` }}
      />
    );
  }
  return null;
}

function ToastList() {
  const { toasts } = ToastPrimitive.useToastManager<ToastData>();

  return toasts.map((item) => (
    <Toast key={item.id} toast={item} swipeDirection={['up', 'right']}>
      <ToastContent>
        {/* Remounted to replay its arrival when the message changes: a failed
            upload, a repeat of the same error, one more person joining. */}
        <ToastIcon
          key={item.type === 'loading' ? 'loading' : item.updateKey}
          item={item}
        />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <ToastTitle />
          <ToastDescription />
          {/* Under a description, whose line it would otherwise wrap. */}
          {item.description ? (
            <ToastAction className="my-0 mt-1.5 self-start" />
          ) : null}
        </div>
        {item.description ? null : <ToastAction />}
        {/* Work in progress can't be waved away; only finishing it ends it. */}
        {item.type === 'loading' ? null : <ToastClose />}
        <ToastMeter item={item} />
      </ToastContent>
    </Toast>
  ));
}

/** Publish a held gesture on the canvas, for toasts to get out of its way. */
function useCanvasHeld(): void {
  React.useEffect(() => {
    const root = document.documentElement;
    const press = (event: PointerEvent) => {
      if ((event.target as Element).closest?.('.wb-canvas-surface')) {
        root.toggleAttribute('data-canvas-held', true);
      }
    };
    const release = () => root.toggleAttribute('data-canvas-held', false);
    window.addEventListener('pointerdown', press, true);
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
    return () => {
      window.removeEventListener('pointerdown', press, true);
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
    };
  }, []);
}

function Toaster({
  children,
  toastManager = manager,
  ...props
}: ToastPrimitive.Provider.Props) {
  useCanvasHeld();

  return (
    <ToastProvider toastManager={toastManager} {...props}>
      {children}
      <ToastPortal>
        <ToastViewport>
          <ToastList />
        </ToastViewport>
      </ToastPortal>
    </ToastProvider>
  );
}

const createToastManager = ToastPrimitive.createToastManager;
const useToastManager = ToastPrimitive.useToastManager;

export {
  Toaster,
  Toast,
  ToastAction,
  ToastClose,
  ToastContent,
  ToastDescription,
  ToastPortal,
  ToastProvider,
  ToastTitle,
  ToastViewport,
  createToastManager,
  toast,
  useToastManager,
};
