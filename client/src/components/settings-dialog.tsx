import {
  type BackgroundType,
  BACKGROUND_LABELS,
  BACKGROUND_TYPES,
} from '@/canvas/grid';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { ConnectionIndicator } from '@/components/connection-indicator';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { PanelLabel } from '@/components/ui/panel-label';
import { Slider } from '@/components/ui/slider';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { type Theme, useThemeStore } from '@/use-theme-store';

import '@/canvas/tools/register';

const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

interface Shortcut {
  label: string;
  keys: string;
}

const ACTION_SHORTCUTS: Shortcut[] = [
  { label: 'Undo', keys: `${MOD} Z` },
  { label: 'Redo', keys: `${MOD} ⇧ Z` },
  { label: 'Copy / Cut / Paste', keys: `${MOD} C / X / V` },
  { label: 'Duplicate', keys: `${MOD} D` },
  { label: 'Group / Ungroup', keys: `${MOD} G / ${MOD} ⇧ G` },
  { label: 'Delete', keys: 'Delete' },
  { label: 'Select all', keys: `${MOD} A` },
  { label: 'Nudge (fine / coarse)', keys: 'Arrows / ⇧ Arrows' },
  { label: 'Bring forward / backward', keys: `${MOD} ] / [` },
  { label: 'Bring to front / back', keys: `${MOD} ⇧ ] / [` },
  { label: 'Zoom in / out / reset', keys: `${MOD} + / − / 0` },
  { label: 'Disable snapping', keys: 'Alt-drag' },
  { label: 'Pan', keys: 'Space-drag' },
  { label: 'Zoom', keys: `${MOD}-scroll / pinch` },
  { label: 'Back to select', keys: 'Esc' },
];

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2.5">
      <PanelLabel as="h3">{title}</PanelLabel>
      {children}
    </section>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
      {children}
    </kbd>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const theme = useThemeStore((s) => s.theme);
  const setTheme = useThemeStore((s) => s.setTheme);
  const background = useCanvasUiStore((s) => s.background);
  const setBackground = useCanvasUiStore((s) => s.setBackground);
  const pencilStabilization = useCanvasUiStore((s) => s.pencilStabilization);
  const setPencilStabilization = useCanvasUiStore(
    (s) => s.setPencilStabilization,
  );
  const pencilStabilizationPercent = Math.round(pencilStabilization * 100);

  const toolShortcuts: Shortcut[] = toolRegistry
    .list()
    .filter((t) => t.hotkey)
    .map((t) => ({ label: t.label, keys: t.hotkey!.toUpperCase() }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] gap-5 overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Settings</DialogTitle>
          <DialogDescription>
            Preferences are stored locally on this device.
          </DialogDescription>
        </DialogHeader>

        <Section title="Appearance">
          <ToggleGroup
            value={[theme]}
            onValueChange={(v) => v[0] && setTheme(v[0] as Theme)}
          >
            <ToggleGroupItem value="light">Light</ToggleGroupItem>
            <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
          </ToggleGroup>
        </Section>

        <Section title="Canvas background">
          <ToggleGroup
            value={[background]}
            onValueChange={(v) => v[0] && setBackground(v[0] as BackgroundType)}
          >
            {BACKGROUND_TYPES.map((t) => (
              <ToggleGroupItem key={t} value={t}>
                {BACKGROUND_LABELS[t]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </Section>

        <Section title="Pencil">
          <Field>
            <div className="flex items-center justify-between gap-3">
              <FieldLabel>Stroke stabilisation</FieldLabel>
              <span className="shrink-0 font-mono text-xs text-muted-foreground">
                {pencilStabilizationPercent}%
              </span>
            </div>
            <Slider
              aria-label="Stroke stabilisation"
              min={0}
              max={1}
              step={0.01}
              value={pencilStabilization}
              onValueChange={(value) =>
                setPencilStabilization(Array.isArray(value) ? value[0]! : value)
              }
            />
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Low</span>
              <span>High</span>
            </div>
          </Field>
        </Section>

        <Section title="Connection">
          <div className="flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-sm">
            <ConnectionIndicator />
            <span className="text-muted-foreground">
              Real-time collaboration via the board link.
            </span>
          </div>
        </Section>

        <Section title="Tools">
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5">
            {toolShortcuts.map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-sm">{s.label}</span>
                <Kbd>{s.keys}</Kbd>
              </div>
            ))}
          </div>
        </Section>

        <Section title="Shortcuts">
          <div className="flex flex-col gap-1.5">
            {ACTION_SHORTCUTS.map((s) => (
              <div key={s.label} className="flex items-center justify-between">
                <span className="text-sm">{s.label}</span>
                <Kbd>{s.keys}</Kbd>
              </div>
            ))}
          </div>
        </Section>
      </DialogContent>
    </Dialog>
  );
}
