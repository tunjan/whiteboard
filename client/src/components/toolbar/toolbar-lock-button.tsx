import { LockGlyph, LockOpenGlyph } from '@/components/ui/glyphs';
import { useToolLockStore } from '@/canvas/use-tool-lock-store';
import { ToolbarItem } from './toolbar-primitives';

export function ToolLockButton() {
  const locked = useToolLockStore((state) => state.locked);
  const toggle = useToolLockStore((state) => state.toggle);
  const Icon = locked ? LockGlyph : LockOpenGlyph;

  return (
    <ToolbarItem
      label="Tool lock"
      hotkey="q"
      mark="pressed"
      selected={locked}
      onClick={toggle}
    >
      <Icon />
    </ToolbarItem>
  );
}
