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

// The panel's own inline hints cover these while it is open, and vanish with it.
const EQUATION_SHORTCUTS = [
  { label: 'Commit and return to the canvas', keys: ['Esc'] },
  { label: 'Search LaTeX commands', keys: ['\\'] },
  { label: 'Accept the highlighted command', keys: ['Enter'] },
  { label: 'Dismiss the command list', keys: ['Esc'] },
  { label: 'Next empty slot or matrix cell', keys: ['Tab'] },
  { label: 'New row inside aligned or cases', keys: ['Enter'] },
  { label: 'New equation below this one', keys: ['⌘/Ctrl', 'Enter'] },
] as const;

const GENERAL_SHORTCUTS = [
  { label: 'Reset tool and selection', keys: ['Esc'] },
  { label: 'Tool lock', keys: ['Q'] },
  { label: 'Borrow a tool while its key is held', keys: ['Hold tool key'] },
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
          <dt className="text-fg-secondary">{item.label}</dt>
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
    <section
      aria-labelledby={id}
      // `break-inside-avoid` keeps a section whole when the columns balance;
      // the bottom margin replaces the flex gap columns don't provide.
      className="mb-4 grid break-inside-avoid gap-2"
    >
      <h3
        id={id}
        className="text-xs font-medium tracking-wide text-fg-muted uppercase"
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
      {/* Six sections, forty-nine rows: in one 32rem column that was three
          screens of scrolling behind a full-height scrollbar. Reference sheets
          are read by scanning, not by scrolling, so the sections flow into
          balanced columns as the viewport allows — two from `sm`, three from
          `lg`, where the whole sheet fits at once and no scrollbar appears.
          Narrow screens still scroll, minus the scrollbar track. */}
      <DialogContent className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto p-4 scrollbar-none sm:max-w-3xl lg:max-w-5xl">
        <DialogHeader className="pr-10">
          <DialogTitle>Keyboard shortcuts</DialogTitle>
          <DialogDescription>
            Tool keys work while focus is outside a text or equation editor.
          </DialogDescription>
        </DialogHeader>
        <div className="columns-1 gap-x-6 sm:columns-2 lg:columns-3">
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
            id="equation-shortcuts-heading"
            title="Equations"
            items={EQUATION_SHORTCUTS}
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
        </div>
      </DialogContent>
    </Dialog>
  );
}
