import { type BackgroundType, BACKGROUND_LABELS, BACKGROUND_TYPES } from '@/canvas/grid';
import { toolRegistry } from '@/canvas/tools/tool-registry';
import { useCanvasUiStore } from '@/canvas/use-canvas-ui-store';
import { ConnectionIndicator } from '@/components/connection-indicator';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { PanelLabel } from '@/components/ui/panel-label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { type Theme, useThemeStore } from '@/use-theme-store';
import {
  Gauge,
  Keyboard,
  Monitor,
  PenTool,
  Wifi,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useState } from 'react';

import '@/canvas/tools/register';

const isMac =
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.platform || navigator.userAgent);
const MOD = isMac ? '⌘' : 'Ctrl';

interface Shortcut {
  label: string;
  keys: string;
}

type SettingsPage =
  | 'general'
  | 'pencil'
  | 'shortcuts'
  | 'connection'
  | 'debug';

interface SettingsNavItem {
  id: SettingsPage;
  label: string;
  icon: LucideIcon;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'general', label: 'General', icon: Monitor },
  { id: 'pencil', label: 'Pencil', icon: PenTool },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'connection', label: 'Connection', icon: Wifi },
  { id: 'debug', label: 'Debug', icon: Gauge },
];

const ACTIVE_SECTION_CLASS =
  'bg-bg-info text-content-info hover:bg-bg-info hover:text-content-info';

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
  { label: 'Temporarily disable snapping', keys: 'Alt-drag' },
  { label: 'Pan', keys: 'Space-drag' },
  { label: 'Zoom', keys: `${MOD}-scroll / pinch` },
  { label: 'Back to select', keys: 'Esc' },
];

function PreferenceRow({
  label,
  children,
  className,
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <Field
      orientation="horizontal"
      className={cn(
        'min-h-20 rounded-xl border border-border-subtle bg-bg-default p-4 sm:p-5 max-sm:flex-col max-sm:items-stretch',
        className,
      )}
    >
      <FieldLabel className="text-sm font-medium">{label}</FieldLabel>
      {children}
    </Field>
  );
}

function SliderField({
  label,
  value,
  display,
  min,
  max,
  step,
  onChange,
}: {
  label: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
}) {
  return (
    <PreferenceRow label={label} className="min-h-[5.5rem]">
      <div className="flex w-full max-w-[19rem] flex-col gap-2.5">
        <span className="text-right font-mono text-xs tabular-nums text-muted-foreground">
          {display}
        </span>
        <Slider
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onValueChange={(nextValue) =>
            onChange(Array.isArray(nextValue) ? nextValue[0]! : nextValue)
          }
        />
      </div>
    </PreferenceRow>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-sm border border-border-subtle bg-bg-muted px-2 py-1 font-mono text-[10px] text-content-subtle">
      {children}
    </kbd>
  );
}

function SettingsNavigation({
  activePage,
  onPageChange,
  className,
}: {
  activePage: SettingsPage;
  onPageChange: (page: SettingsPage) => void;
  className?: string;
}) {
  return (
    <nav aria-label="Settings sections" className={className}>
      {SETTINGS_NAV.map(({ id, label, icon: Icon }) => {
        const isActive = activePage === id;

        return (
          <Button
            key={id}
            type="button"
            variant="ghost"
            size="default"
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onPageChange(id)}
            className={cn(
              'h-11 w-full justify-start gap-3 px-3.5 text-left',
              isActive && ACTIVE_SECTION_CLASS,
            )}
          >
            <Icon aria-hidden="true" data-icon="inline-start" />
            {label}
          </Button>
        );
      })}
    </nav>
  );
}

function GeneralSettings() {
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const background = useCanvasUiStore((state) => state.background);
  const setBackground = useCanvasUiStore((state) => state.setBackground);
  const snappingEnabled = useCanvasUiStore((state) => state.snappingEnabled);
  const setSnappingEnabled = useCanvasUiStore(
    (state) => state.setSnappingEnabled,
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PreferenceRow label="Theme">
        <ToggleGroup
          className="w-full max-w-56"
          value={[theme]}
          onValueChange={(value) => value[0] && setTheme(value[0] as Theme)}
        >
          <ToggleGroupItem value="light">Light</ToggleGroupItem>
          <ToggleGroupItem value="dark">Dark</ToggleGroupItem>
        </ToggleGroup>
      </PreferenceRow>

      <PreferenceRow label="Canvas background">
        <ToggleGroup
          className="w-full max-w-80"
          value={[background]}
          onValueChange={(value) =>
            value[0] && setBackground(value[0] as BackgroundType)
          }
        >
          {BACKGROUND_TYPES.map((type) => (
            <ToggleGroupItem key={type} value={type}>
              {BACKGROUND_LABELS[type]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
      </PreferenceRow>

      <PreferenceRow label="Object snapping">
        <Switch
          aria-label="Object snapping"
          checked={snappingEnabled}
          onCheckedChange={setSnappingEnabled}
        />
      </PreferenceRow>
    </div>
  );
}

function PencilSettings() {
  const pencilStabilization = useCanvasUiStore(
    (state) => state.pencilStabilization,
  );
  const setPencilStabilization = useCanvasUiStore(
    (state) => state.setPencilStabilization,
  );
  const pencilThinning = useCanvasUiStore((state) => state.pencilThinning);
  const setPencilThinning = useCanvasUiStore(
    (state) => state.setPencilThinning,
  );
  const pencilSmoothing = useCanvasUiStore((state) => state.pencilSmoothing);
  const setPencilSmoothing = useCanvasUiStore(
    (state) => state.setPencilSmoothing,
  );
  const pencilStartTaper = useCanvasUiStore(
    (state) => state.pencilStartTaper,
  );
  const setPencilStartTaper = useCanvasUiStore(
    (state) => state.setPencilStartTaper,
  );
  const pencilEndTaper = useCanvasUiStore(
    (state) => state.pencilEndTaper,
  );
  const setPencilEndTaper = useCanvasUiStore(
    (state) => state.setPencilEndTaper,
  );
  const pencilSimulatePressure = useCanvasUiStore(
    (state) => state.pencilSimulatePressure,
  );
  const setPencilSimulatePressure = useCanvasUiStore(
    (state) => state.setPencilSimulatePressure,
  );
  const resetPencil = useCanvasUiStore((state) => state.resetPencil);
  const signedPercent = `${pencilThinning > 0 ? '+' : ''}${Math.round(
    pencilThinning * 100,
  )}%`;

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <SliderField
        label="Stroke stabilisation"
        value={pencilStabilization}
        display={`${Math.round(pencilStabilization * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        onChange={setPencilStabilization}
      />
      <SliderField
        label="Pressure response"
        value={pencilThinning}
        display={signedPercent}
        min={-1}
        max={1}
        step={0.05}
        onChange={setPencilThinning}
      />
      <SliderField
        label="Smoothing"
        value={pencilSmoothing}
        display={`${Math.round(pencilSmoothing * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        onChange={setPencilSmoothing}
      />
      <SliderField
        label="Start taper"
        value={pencilStartTaper}
        display={`${Math.round(pencilStartTaper)}px`}
        min={0}
        max={50}
        step={1}
        onChange={setPencilStartTaper}
      />
      <PreferenceRow label="Taper end to a point">
        <Switch
          checked={pencilEndTaper}
          onCheckedChange={setPencilEndTaper}
        />
      </PreferenceRow>
      <PreferenceRow label="Simulate pressure">
        <Switch
          checked={pencilSimulatePressure}
          onCheckedChange={setPencilSimulatePressure}
        />
      </PreferenceRow>
      <div className="rounded-xl border border-border-subtle bg-bg-default p-4 sm:p-5">
        <Button variant="outline" size="sm" onClick={resetPencil}>
          Restore defaults
        </Button>
      </div>
    </div>
  );
}

function ShortcutList({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <div className="flex flex-col divide-y divide-border-muted rounded-xl border border-border-subtle bg-bg-default">
      {shortcuts.map((shortcut) => (
        <div
          key={shortcut.label}
          className="flex min-h-10 items-center justify-between gap-3 px-3.5 py-2"
        >
          <span className="min-w-0 leading-5 text-content-default">
            {shortcut.label}
          </span>
          <Kbd>{shortcut.keys}</Kbd>
        </div>
      ))}
    </div>
  );
}

function ShortcutsSettings() {
  const toolShortcuts: Shortcut[] = toolRegistry
    .list()
    .filter((tool) => tool.hotkey)
    .map((tool) => ({ label: tool.label, keys: tool.hotkey!.toUpperCase() }));

  return (
    <div className="grid gap-6 p-4 sm:p-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-3">
        <PanelLabel as="h3" className="text-content-muted">
          Tools
        </PanelLabel>
        <ShortcutList shortcuts={toolShortcuts} />
      </section>
      <section className="flex min-w-0 flex-col gap-3">
        <PanelLabel as="h3" className="text-content-muted">
          Actions
        </PanelLabel>
        <ShortcutList shortcuts={ACTION_SHORTCUTS} />
      </section>
    </div>
  );
}

function ConnectionSettings() {
  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PreferenceRow label="Board connection">
        <div className="flex size-8 items-center justify-center rounded-full bg-bg-subtle">
          <ConnectionIndicator />
        </div>
      </PreferenceRow>
    </div>
  );
}

function DebugSettings() {
  const debugPerformance = useCanvasUiStore((state) => state.debugPerformance);
  const setDebugPerformance = useCanvasUiStore(
    (state) => state.setDebugPerformance,
  );

  return (
    <div className="flex flex-col gap-4 p-4 sm:p-6">
      <PreferenceRow label="Performance overlay">
        <Switch
          checked={debugPerformance}
          onCheckedChange={setDebugPerformance}
        />
      </PreferenceRow>
      <p className="px-1 text-sm text-content-subtle">
        Shows a live readout of frame rate, worst frame time, shape count, and
        heap usage in the top-left corner of the canvas.
      </p>
    </div>
  );
}

export function SettingsDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [activePage, setActivePage] = useState<SettingsPage>('general');
  const activeItem = SETTINGS_NAV.find((item) => item.id === activePage)!;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="!flex h-[min(44rem,calc(100dvh-2rem))] w-[calc(100%_-_2rem)] max-w-none gap-0 overflow-hidden rounded-2xl border-border-subtle bg-bg-default p-0 sm:w-[min(68rem,calc(100%_-_4rem))] sm:max-w-none"
      >
        <aside className="hidden w-56 shrink-0 flex-col border-r border-border-subtle bg-bg-muted p-3 sm:flex">
          <SettingsNavigation
            activePage={activePage}
            onPageChange={setActivePage}
            className="flex flex-col gap-1"
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border-subtle bg-bg-muted px-2 py-2 sm:hidden">
            <SettingsNavigation
              activePage={activePage}
              onPageChange={setActivePage}
              className="flex gap-1 overflow-x-auto"
            />
          </div>

          <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border-subtle bg-bg-default px-6 py-5 sm:px-8 sm:py-6">
            <DialogTitle className="text-2xl font-semibold tracking-[-0.02em]">
              {activeItem.label}
            </DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Close settings"
                  className="rounded-full"
                />
              }
            >
              <X aria-hidden="true" />
            </DialogClose>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-bg-muted">
            {activePage === 'general' ? <GeneralSettings /> : null}
            {activePage === 'pencil' ? <PencilSettings /> : null}
            {activePage === 'shortcuts' ? <ShortcutsSettings /> : null}
            {activePage === 'connection' ? <ConnectionSettings /> : null}
            {activePage === 'debug' ? <DebugSettings /> : null}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
