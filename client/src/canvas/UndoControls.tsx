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
}

export function UndoControls({
  canUndo,
  canRedo,
  onUndo,
  onRedo,
}: UndoControlsProps) {
  return (
    <div
      data-ui-layer
      className="touch-targets absolute left-[calc(1rem+env(safe-area-inset-left))] bottom-[calc(1rem+env(safe-area-inset-bottom))] [@media(pointer:coarse)]:bottom-[calc(7rem+env(safe-area-inset-bottom))] select-none"
    >
      <TooltipProvider delay={300}>
        <Surface className="flex items-center gap-1 p-2 shadow-floating">
          <Tooltip>
            <TooltipTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Undo"
                  disabled={!canUndo}
                  onClick={onUndo}
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
                  size="icon-sm"
                  aria-label="Redo"
                  disabled={!canRedo}
                  onClick={onRedo}
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
