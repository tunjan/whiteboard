import { LockGlyph, LockOpenGlyph } from '@/components/ui/glyphs';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { Button } from '@/components/ui/button';
import { Kbd } from '@/components/ui/kbd';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { chromeButtonClass, TOOL_ICON } from './toolbar-constants';

export function ToolLockButton() {
  const locked = useToolLockStore((state) => state.locked);
  const toggle = useToolLockStore((state) => state.toggle);
  const Icon = locked ? LockGlyph : LockOpenGlyph;

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            data-toolbar-item
            variant="ghost"
            size="icon-md"
            tabIndex={-1}
            onClick={toggle}
            aria-pressed={locked}
            aria-label="Tool lock"
            aria-keyshortcuts="Q"
            className={chromeButtonClass(locked)}
          />
        }
      >
        <Icon className={TOOL_ICON} />
      </TooltipTrigger>
      <TooltipContent side="top" className="flex items-center gap-2">
        <span>Tool lock</span>
        <Kbd className="font-mono uppercase">Q</Kbd>
      </TooltipContent>
    </Tooltip>
  );
}
