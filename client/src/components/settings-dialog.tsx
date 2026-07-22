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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from '@/components/ui/field';
import { PanelLabel } from '@/components/ui/panel-label';
import { Slider } from '@/components/ui/slider';
import { Switch } from '@/components/ui/switch';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
import { type Theme, useThemeStore } from '@/use-theme-store';
import { Gauge, Keyboard, Monitor, PenTool, Wifi, X } from 'lucide-react';
import { useId, useState } from 'react';
import type { ComponentType } from 'react';

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
  icon: ComponentType<{ className?: string; 'aria-hidden'?: boolean | 'true' | 'false'; 'data-icon'?: string }>;
}

const SETTINGS_NAV: SettingsNavItem[] = [
  { id: 'general', label: 'General', icon: Monitor },
  { id: 'pencil', label: 'Pencil', icon: PenTool },
  { id: 'shortcuts', label: 'Shortcuts', icon: Keyboard },
  { id: 'connection', label: 'Connection', icon: Wifi },
  { id: 'debug', label: 'Debug', icon: Gauge },
];

const ACTIVE_SECTION_CLASS =
  'bg-bg-subtle text-content-emphasis hover:bg-bg-subtle hover:text-content-emphasis';

const ACTION_SHORTCUTS: Shortcut[] = [
  { label: 'Undo', keys: `${MOD} Z` },
  { label: 'Redo', keys: `${MOD} ⇧ Z` },
  { label: 'Copy / Cut / Paste', keys: `${MOD} C / X / V` },
  { label: 'Duplicate', keys: `${MOD} D` },
  { label: 'Group / Ungroup', keys: `${MOD} G / ${MOD} ⇧ G` },
  { label: 'Delete', keys: 'Delete' },
  { label: 'Select All', keys: `${MOD} A` },
  { label: 'Nudge (fine / coarse)', keys: 'Arrows / ⇧ Arrows' },
  { label: 'Bring Forward / Backward', keys: `${MOD} ] / [` },
  { label: 'Bring to Front / Back', keys: `${MOD} ⇧ ] / [` },
  { label: 'Zoom In / Out / Reset', keys: `${MOD} + / − / 0` },
  { label: 'Temporarily Disable Snapping', keys: 'Alt-drag' },
  { label: 'Pan', keys: 'Space-drag' },
  { label: 'Zoom', keys: `${MOD}-scroll / pinch` },
  { label: 'Back to Select', keys: 'Esc' },
];

function PreferenceRow({
  label,
  description,
  children,
  className,
  id,
  htmlFor,
}: {
  label: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
  id?: string;
  htmlFor?: string;
}) {
  return (
    <Field
      orientation="horizontal"
      className={cn(
        'min-h-16 border-b border-border-muted py-3 max-sm:flex-col max-sm:items-stretch',
        className,
      )}
    >
      <div className="flex min-w-0 flex-col gap-1">
        <FieldLabel id={id} htmlFor={htmlFor}>{label}</FieldLabel>
        {description ? (
          <FieldDescription>{description}</FieldDescription>
        ) : null}
      </div>
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
    <PreferenceRow label={label}>
      <div className="flex w-full max-w-80 items-center gap-3">
        <Slider
          className="flex-1"
          aria-label={label}
          min={min}
          max={max}
          step={step}
          value={value}
          onValueChange={(nextValue) =>
            onChange(Array.isArray(nextValue) ? nextValue[0]! : nextValue)
          }
        />
        <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted-foreground">
          {display}
        </span>
      </div>
    </PreferenceRow>
  );
}

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="shrink-0 rounded-sm border border-border-subtle bg-bg-muted px-2 py-1 font-mono text-xs text-content-subtle">
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
              'w-full justify-start gap-2.5 text-left max-sm:w-auto',
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
  const themeLabelId = useId();
  const snappingId = useId();
  const theme = useThemeStore((state) => state.theme);
  const setTheme = useThemeStore((state) => state.setTheme);
  const snappingEnabled = useCanvasUiStore((state) => state.snappingEnabled);
  const setSnappingEnabled = useCanvasUiStore(
    (state) => state.setSnappingEnabled,
  );

  return (
    <FieldGroup className="gap-0 px-4 py-2 sm:px-8 sm:py-3">
      <PreferenceRow label="Theme" id={themeLabelId}>
        <ToggleGroup
          aria-labelledby={themeLabelId}
          className="w-full max-w-56"
          value={[theme]}
          onValueChange={(value) => value[0] && setTheme(value[0] as Theme)}
        >
          <ToggleGroupItem value="light" className="max-sm:h-11">
            Light
          </ToggleGroupItem>
          <ToggleGroupItem value="dark" className="max-sm:h-11">
            Dark
          </ToggleGroupItem>
        </ToggleGroup>
      </PreferenceRow>

      <PreferenceRow label="Object Snapping" htmlFor={snappingId}>
        <Switch
          id={snappingId}
          aria-label="Object snapping"
          checked={snappingEnabled}
          onCheckedChange={setSnappingEnabled}
        />
      </PreferenceRow>
    </FieldGroup>
  );
}

function PencilSettings() {
  const endTaperId = useId();
  const simulatePressureId = useId();
  const restoreDefaultsId = useId();
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
    <FieldGroup className="gap-0 px-4 py-2 sm:px-8 sm:py-3">
      <SliderField
        label="Stroke Stabilisation"
        value={pencilStabilization}
        display={`${Math.round(pencilStabilization * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        onChange={setPencilStabilization}
      />
      <SliderField
        label="Pressure Response"
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
        onChange={pencilSmoothing ? setPencilSmoothing : () => {}}
      />
      <SliderField
        label="Start Taper"
        value={pencilStartTaper}
        display={`${Math.round(pencilStartTaper)}px`}
        min={0}
        max={50}
        step={1}
        onChange={setPencilStartTaper}
      />
      <PreferenceRow label="Taper End to a Point" htmlFor={endTaperId}>
        <Switch
          id={endTaperId}
          aria-label="Taper end to a point"
          checked={pencilEndTaper}
          onCheckedChange={setPencilEndTaper}
        />
      </PreferenceRow>
      <PreferenceRow label="Simulate Pressure" htmlFor={simulatePressureId}>
        <Switch
          id={simulatePressureId}
          aria-label="Simulate pressure"
          checked={pencilSimulatePressure}
          onCheckedChange={setPencilSimulatePressure}
        />
      </PreferenceRow>
      <PreferenceRow label="Pencil Settings" htmlFor={restoreDefaultsId}>
        <Button
          id={restoreDefaultsId}
          variant="outline"
          size="sm"
          className="max-sm:h-11"
          onClick={resetPencil}
        >
          Restore Defaults
        </Button>
      </PreferenceRow>
    </FieldGroup>
  );
}

function ShortcutList({ shortcuts }: { shortcuts: Shortcut[] }) {
  return (
    <div className="flex flex-col divide-y divide-border-muted border-y border-border-subtle">
      {shortcuts.map((shortcut) => (
        <div
          key={shortcut.label}
          className="flex min-h-10 items-center justify-between gap-3 py-2"
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
    <div className="grid gap-5 p-4 sm:p-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="flex min-w-0 flex-col gap-2">
        <PanelLabel as="h3" className="text-content-muted">
          Tools
        </PanelLabel>
        <ShortcutList shortcuts={toolShortcuts} />
      </section>
      <section className="flex min-w-0 flex-col gap-2">
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
    <FieldGroup className="gap-0 px-4 py-2 sm:px-8 sm:py-3">
      <PreferenceRow label="Board Connection">
        <div className="flex size-8 items-center justify-center rounded-full bg-bg-subtle [--surface-control-radius:9999px]">
          <ConnectionIndicator />
        </div>
      </PreferenceRow>
    </FieldGroup>
  );
}

function DebugSettings() {
  const performanceOverlayId = useId();
  const debugPerformance = useCanvasUiStore((state) => state.debugPerformance);
  const setDebugPerformance = useCanvasUiStore(
    (state) => state.setDebugPerformance,
  );

  return (
    <FieldGroup className="gap-0 px-4 py-2 sm:px-8 sm:py-3">
      <PreferenceRow
        label="Performance Overlay"
        description="Shows frame rate, worst frame time, shape count, and heap usage in the top-left corner of the canvas."
        htmlFor={performanceOverlayId}
      >
        <Switch
          id={performanceOverlayId}
          aria-label="Performance overlay"
          checked={debugPerformance}
          onCheckedChange={setDebugPerformance}
        />
      </PreferenceRow>
    </FieldGroup>
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
        className="!flex h-[min(52rem,calc(100dvh-2rem))] w-[calc(100%_-_2rem)] max-w-none gap-0 overflow-hidden border-border-subtle bg-bg-default p-0 sm:w-[min(64rem,calc(100%_-_4rem))] sm:max-w-none"
      >
        <aside className="hidden w-52 shrink-0 flex-col border-r border-border-subtle bg-bg-default p-3 sm:flex">
          <SettingsNavigation
            activePage={activePage}
            onPageChange={setActivePage}
            className="flex flex-col gap-1"
          />
        </aside>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-border-subtle bg-bg-default px-2 py-2 sm:hidden">
            <SettingsNavigation
              activePage={activePage}
              onPageChange={setActivePage}
              className="scrollbar-none flex gap-1 overflow-x-auto"
            />
          </div>

          <DialogHeader className="flex-row items-center justify-between gap-4 border-b border-border-subtle bg-bg-default px-4 py-3 sm:px-8 sm:py-4">
            <DialogTitle>{activeItem.label}</DialogTitle>
            <DialogClose
              render={
                <Button
                  variant="outline"
                  size="icon"
                  aria-label="Close settings"
                />
              }
            >
              <X aria-hidden="true" />
            </DialogClose>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto bg-bg-default">
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
