import { Redo2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Surface } from '@/components/ui/surface';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';

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
  return (
    <div
      data-ui-layer
      className="touch-targets absolute left-[calc(1rem+env(safe-area-inset-left))] bottom-[calc(1rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
    >
      <TooltipProvider delay={300}>
        <Surface className="flex h-12 items-center gap-1 p-1.5 shadow-hover">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Undo"
                  disabled={disabled || !canUndo}
                  onClick={onUndo}
                  className="disabled:border-transparent disabled:bg-transparent disabled:text-content-muted"
                />
              }
            >
              <Undo2 />
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Undo</span>
            </TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-lg"
                  aria-label="Redo"
                  disabled={disabled || !canRedo}
                  onClick={onRedo}
                  className="disabled:border-transparent disabled:bg-transparent disabled:text-content-muted"
                />
              }
            >
              <Redo2 />
            </TooltipTrigger>
            <TooltipContent side="top">
              <span>Redo</span>
            </TooltipContent>
          </Tooltip>
        </Surface>
      </TooltipProvider>
    </div>
  );
}
