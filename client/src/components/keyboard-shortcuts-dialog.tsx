import { Fragment } from 'react';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import '@/canvas/tools/register';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Kbd } from '@/components/ui/kbd';

const EDIT_SHORTCUTS = [
  { label: 'Undo', keys: ['⌘/Ctrl', 'Z'] },
  { label: 'Redo', keys: ['⌘/Ctrl', 'Shift', 'Z'] },
  { label: 'Copy selection', keys: ['⌘/Ctrl', 'C'] },
  { label: 'Copy selection as PNG', keys: ['⌘/Ctrl', 'Shift', 'C'] },
  { label: 'Cut selection', keys: ['⌘/Ctrl', 'X'] },
  { label: 'Paste', keys: ['⌘/Ctrl', 'V'] },
  { label: 'Select all', keys: ['⌘/Ctrl', 'A'] },
  { label: 'Duplicate selection', keys: ['⌘/Ctrl', 'D'] },
  { label: 'Delete selection', keys: ['Delete'] },
  { label: 'Edit selected text or equation', keys: ['Enter'] },
] as const;

const ARRANGE_SHORTCUTS = [
  { label: 'Group selection', keys: ['⌘/Ctrl', 'G'] },
  { label: 'Ungroup selection', keys: ['⌘/Ctrl', 'Shift', 'G'] },
  { label: 'Bring forward', keys: ['⌘/Ctrl', ']'] },
  { label: 'Bring to front', keys: ['⌘/Ctrl', 'Shift', ']'] },
  { label: 'Send backward', keys: ['⌘/Ctrl', '['] },
  { label: 'Send to back', keys: ['⌘/Ctrl', 'Shift', '['] },
  { label: 'Move selection', keys: ['Arrow keys'] },
  { label: 'Move selection by 10', keys: ['Shift', 'Arrow keys'] },
  { label: 'Lock selected objects', keys: ['Shift', 'L'] },
] as const;

const VIEW_SHORTCUTS = [
  { label: 'Zoom in', keys: ['⌘/Ctrl', '+'] },
  { label: 'Zoom out', keys: ['⌘/Ctrl', '−'] },
  { label: 'Reset zoom', keys: ['⌘/Ctrl', '0'] },
] as const;

const GENERAL_SHORTCUTS = [
  { label: 'Reset tool and selection', keys: ['Esc'] },
  { label: 'Tool lock', keys: ['Q'] },
] as const;

function ShortcutKeys({ keys }: { keys: readonly string[] }) {
  return (
    <span className="flex flex-wrap justify-end gap-1">
      {keys.map((key, index) => (
        <Fragment key={`${key}-${index}`}>
          <Kbd className="font-mono">{key}</Kbd>
        </Fragment>
      ))}
    </span>
  );
}

function ShortcutList({
  items,
}: {
  items: ReadonlyArray<{ label: string; keys: readonly string[] }>;
}) {
  return (
    <dl className="grid gap-1">
      {items.map((item) => (
        <div
          key={item.label}
          className="grid min-h-8 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-md px-2 py-1 text-sm odd:bg-panel/60"
        >
          <dt className="text-secondary">{item.label}</dt>
          <dd>
            <ShortcutKeys keys={item.keys} />
          </dd>
        </div>
      ))}
    </dl>
  );
}

function ShortcutSection({
  id,
  title,
  items,
}: {
  id: string;
  title: string;
  items: ReadonlyArray<{ label: string; keys: readonly string[] }>;
}) {
  return (
    <section aria-labelledby={id} className="grid gap-2">
      <h3
        id={id}
        className="text-xs font-medium tracking-wide text-tertiary uppercase"
      >
        {title}
      </h3>
      <ShortcutList items={items} />
    </section>
  );
}

export function KeyboardShortcutsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const toolShortcuts = toolRegistry
    .list()
    .filter((tool) => tool.hotkey)
    .map((tool) => ({ label: tool.label, keys: [tool.hotkey!.toUpperCase()] }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[min(42rem,calc(100dvh-2rem))] gap-4 overflow-y-auto p-4 sm:max-w-lg">
        <DialogHeader className="pr-10">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Tool keys work while focus is outside a text or equation editor.
          </DialogDescription>
        </DialogHeader>
        <ShortcutSection
          id="tool-shortcuts-heading"
          title="Tools"
          items={toolShortcuts}
        />
        <ShortcutSection
          id="edit-shortcuts-heading"
          title="Edit"
          items={EDIT_SHORTCUTS}
        />
        <ShortcutSection
          id="arrange-shortcuts-heading"
          title="Arrange"
          items={ARRANGE_SHORTCUTS}
        />
        <ShortcutSection
          id="view-shortcuts-heading"
          title="View"
          items={VIEW_SHORTCUTS}
        />
        <ShortcutSection
          id="general-shortcuts-heading"
          title="General"
          items={GENERAL_SHORTCUTS}
        />
      </DialogContent>
    </Dialog>
  );
}
