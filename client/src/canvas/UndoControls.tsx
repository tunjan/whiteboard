import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { INSTRUMENT, INSTRUMENT_KEY, Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';
import { cn } from '@/lib/utils';

interface UndoControlsProps {
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  disabled?: boolean;
}

export function UndoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  disabled = false,
}: UndoControlsProps) {
  const toolbar = useRovingToolbar<HTMLDivElement>();

  return (
    /* The only undo on the board: the toolbar carries modes, not commands. */
    <div
      data-ui-layer
      data-arrive="up"
      style={{ '--arrive-i': 3 } as React.CSSProperties}
      className="wb-undo-hud absolute left-[calc(0.75rem+env(safe-area-inset-left))] bottom-[calc(0.75rem+var(--wb-inset-bottom))] z-[var(--z-canvas-hud)] max-sm:bottom-[calc(4.75rem+var(--wb-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7.75rem+var(--wb-inset-bottom))] select-none"
    >
      <TooltipProvider delay={300}>
        <Surface
          ref={toolbar.ref}
          role="toolbar"
          aria-label="History controls"
          aria-orientation="horizontal"
          mode="docked"
          chrome
          onFocusCapture={toolbar.onFocusCapture}
          onKeyDown={toolbar.onKeyDown}
          className={cn('relative', INSTRUMENT)}
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={INSTRUMENT_KEY}
                  data-toolbar-item
                  tabIndex={0}
                  aria-label="Undo"
                  aria-keyshortcuts="Control+Z Meta+Z"
                  disabled={disabled || !canUndo}
                  onClick={onUndo}
                />
              }
            >
              <Undo2 />
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Undo</span>
              <Kbd>⌘/Ctrl Z</Kbd>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className={INSTRUMENT_KEY}
                  data-toolbar-item
                  tabIndex={-1}
                  aria-label="Redo"
                  aria-keyshortcuts="Control+Shift+Z Meta+Shift+Z"
                  disabled={disabled || !canRedo}
                  onClick={onRedo}
                />
              }
            >
              <Redo2 />
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Redo</span>
              <Kbd>⌘/Ctrl ⇧ Z</Kbd>
            </TooltipContent>
          </Tooltip>
        </Surface>
      </TooltipProvider>
    </div>
  );
}
