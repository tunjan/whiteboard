import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useRovingToolbar } from '@/hooks/use-roving-toolbar';

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
    <div
      data-ui-layer
      className="absolute left-[env(safe-area-inset-left)] bottom-[env(safe-area-inset-bottom)] max-sm:bottom-[calc(4rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
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
          className="flex items-center gap-0.5 rounded-none rounded-tr-xl border-0 p-1"
        >
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
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
