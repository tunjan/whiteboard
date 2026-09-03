import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ClipboardCopy,
  Download,
  EllipsisVertical,
  Eye,
  FileText,
  Gauge,
  Keyboard,
  Magnet,
  Moon,
  NotebookPen,
  PenTool,
  RotateCcw,
  Scaling,
  Volume2,
  Zap,
} from 'lucide-react';

import {
  copyBoardToPngClipboard,
  exportBoardToPng,
} from '@/canvas/export-png';
import type {
  EndTaperMode,
  PencilPressureCurve,
} from '@/canvas/shapes/ink';
import {
  ATTENTION_AWAY_RANGE,
  ATTENTION_IDLE_RANGE,
  PDF_PAGE_LIMIT_RANGE,
  PNG_EXPORT_SCALES,
  useCanvasUiStore,
} from '@/canvas/use-canvas-ui-store';
import { formatAttentionDuration } from '@/collab/attention-state';
import { useVoiceStore } from '@/collab/voice/use-voice-store';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Slider } from '@/components/ui/slider';
import { useThemeStore } from '@/use-theme-store';

/**
 * The board's overflow menu — everything that used to live behind the ⋯ button
 * *and* everything that used to live in the settings dialog.
 *
 * The dialog is gone on purpose. It held five tabs, two of which were already
 * on screen or one row away (Connection just re-rendered the indicator that is
 * permanently docked top-right; Shortcuts was a shorter copy of the keyboard
 * shortcuts dialog this menu still opens). What was left — a handful of
 * toggles, one enum and seven pen values — is menu-shaped: state you flip and
 * immediately see on the canvas, not a form you fill in behind a scrim.
 *
 * Three groups, ordered by how far each row reaches: board-level dialogs, then
 * image output, then preferences. Section labels rather than more separators,
 * because ten rows need to be scannable and a rule between every pair of items
 * stops separating anything.
 *
 * Preferences read as state, never as verbs: `Dark mode ✓` rather than a row
 * that says "Light mode" while the board is dark. Checkmarks, not switches —
 * a switch inside a menu row gives one line two hit targets that disagree.
 */

/** Right-aligned current value on a submenu trigger, so the row answers itself
 *  without being opened. `flex-1` rather than `ml-auto`: the trigger's chevron
 *  already claims the free space, and two auto margins would split it. */
function MenuValue({ children }: { children: ReactNode }) {
  return (
    <span className="flex-1 pl-4 text-right font-mono text-2xs tabular-nums text-fg-subtle">
      {children}
    </span>
  );
}

/**
 * A continuous value as a menu row: label and readout on top, fader below.
 *
 * The row itself is the menu item, so ↑/↓ still step past it and typeahead
 * still finds it by name; ←/→ move the value. Those two keys have to be caught
 * here — inside a submenu the menu spends ArrowLeft on closing itself, which
 * would dismiss the pen panel on the first nudge.
 */
function MenuSliderItem({
  label,
  icon,
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
  /** Only for a row sitting among icon-bearing items; inside a submenu the
      trigger already carries the icon for the whole panel. */
  icon?: ReactNode;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (value: number) => void;
}) {
  const nudge = (direction: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    // Steps like 0.05 accumulate float dust that the readout would show as a
    // percentage that never lands on a round number.
    onChange(Number(next.toFixed(4)));
  };

  return (
    <DropdownMenuItem
      closeOnClick={false}
      disabled={disabled}
      label={label}
      className="flex-col items-stretch gap-1.5 py-2"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.stopPropagation();
        // The thumb has focus and already moved the value itself.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        nudge(event.key === 'ArrowRight' ? 1 : -1);
      }}
    >
      <span className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          {icon}
          {label}
        </span>
        <span className="font-mono text-2xs tabular-nums text-fg-subtle">
          {display}
        </span>
      </span>
      {/* Half the height of a standalone fader: the capsule is parameterised by
          those three custom properties precisely so it can shrink into a row
          without a second component. */}
      <Slider
        aria-label={label}
        className="[--wb-slider-pad:0.125rem] [--wb-slider-thumb:0.75rem] [--wb-slider-track:0.75rem]"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onValueChange={(next) =>
          onChange(Array.isArray(next) ? next[0]! : next)
        }
      />
    </DropdownMenuItem>
  );
}

/**
 * How the two pen enums are named in the menu.
 *
 * Named for what the pen does, not for the mechanism: "On flick" is a promise
 * about the gesture, where "velocity" would be a promise about a filter. The
 * orders are fixed here rather than derived from the union so the least
 * surprising option reads first.
 */
const END_TAPER_MODES: readonly EndTaperMode[] = ['off', 'velocity', 'full'];
const END_TAPER_LABELS: Record<EndTaperMode, string> = {
  off: 'Round',
  velocity: 'On flick',
  full: 'Always',
};

const PRESSURE_CURVES: readonly PencilPressureCurve[] = [
  'soft',
  'medium',
  'firm',
];
const PRESSURE_CURVE_LABELS: Record<PencilPressureCurve, string> = {
  soft: 'Soft',
  medium: 'Medium',
  firm: 'Firm',
};

function PenSubmenu() {
  const pencilStabilization = useCanvasUiStore((s) => s.pencilStabilization);
  const setPencilStabilization = useCanvasUiStore(
    (s) => s.setPencilStabilization,
  );
  const pencilThinning = useCanvasUiStore((s) => s.pencilThinning);
  const setPencilThinning = useCanvasUiStore((s) => s.setPencilThinning);
  const pencilSmoothing = useCanvasUiStore((s) => s.pencilSmoothing);
  const setPencilSmoothing = useCanvasUiStore((s) => s.setPencilSmoothing);
  const pencilStartTaper = useCanvasUiStore((s) => s.pencilStartTaper);
  const setPencilStartTaper = useCanvasUiStore((s) => s.setPencilStartTaper);
  const pencilEndTaper = useCanvasUiStore((s) => s.pencilEndTaper);
  const setPencilEndTaper = useCanvasUiStore((s) => s.setPencilEndTaper);
  const pencilPressureCurve = useCanvasUiStore((s) => s.pencilPressureCurve);
  const setPencilPressureCurve = useCanvasUiStore(
    (s) => s.setPencilPressureCurve,
  );
  const pencilTilt = useCanvasUiStore((s) => s.pencilTilt);
  const setPencilTilt = useCanvasUiStore((s) => s.setPencilTilt);
  const pencilSimulatePressure = useCanvasUiStore(
    (s) => s.pencilSimulatePressure,
  );
  const setPencilSimulatePressure = useCanvasUiStore(
    (s) => s.setPencilSimulatePressure,
  );
  const pencilPrediction = useCanvasUiStore((s) => s.pencilPrediction);
  const setPencilPrediction = useCanvasUiStore((s) => s.setPencilPrediction);
  const resetPencil = useCanvasUiStore((s) => s.resetPencil);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PenTool />
        Pen
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[min(16rem,calc(100vw-1rem))]">
        <MenuSliderItem
          label="Stabilisation"
          value={pencilStabilization}
          display={`${Math.round(pencilStabilization * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          onChange={setPencilStabilization}
        />
        <MenuSliderItem
          label="Pressure"
          value={pencilThinning}
          display={`${pencilThinning > 0 ? '+' : ''}${Math.round(
            pencilThinning * 100,
          )}%`}
          min={-1}
          max={1}
          step={0.05}
          onChange={setPencilThinning}
        />
        <MenuSliderItem
          label="Tilt"
          value={pencilTilt}
          display={`${Math.round(pencilTilt * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          onChange={setPencilTilt}
        />
        <MenuSliderItem
          label="Smoothing"
          value={pencilSmoothing}
          display={`${Math.round(pencilSmoothing * 100)}%`}
          min={0}
          max={1}
          step={0.01}
          onChange={setPencilSmoothing}
        />
        <MenuSliderItem
          label="Start taper"
          value={pencilStartTaper}
          display={`${Math.round(pencilStartTaper)}px`}
          min={0}
          max={50}
          step={1}
          onChange={setPencilStartTaper}
        />
        <DropdownMenuSeparator />
        {/* Two enums, each behind its own trigger carrying the current value,
            rather than six more rows in a panel that already holds five
            faders. Same shape as Resolution below. */}
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Stroke ends
            <MenuValue>{END_TAPER_LABELS[pencilEndTaper]}</MenuValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup
              value={pencilEndTaper}
              onValueChange={(value) =>
                setPencilEndTaper(value as EndTaperMode)
              }
            >
              {END_TAPER_MODES.map((mode) => (
                <DropdownMenuRadioItem key={mode} value={mode}>
                  {END_TAPER_LABELS[mode]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            Response
            <MenuValue>{PRESSURE_CURVE_LABELS[pencilPressureCurve]}</MenuValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-40">
            <DropdownMenuRadioGroup
              value={pencilPressureCurve}
              onValueChange={(value) =>
                setPencilPressureCurve(value as PencilPressureCurve)
              }
            >
              {PRESSURE_CURVES.map((curve) => (
                <DropdownMenuRadioItem key={curve} value={curve}>
                  {PRESSURE_CURVE_LABELS[curve]}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem
          checked={pencilSimulatePressure}
          onCheckedChange={setPencilSimulatePressure}
        >
          Simulate pressure
        </DropdownMenuCheckboxItem>
        <DropdownMenuCheckboxItem
          checked={pencilPrediction}
          onCheckedChange={setPencilPrediction}
        >
          Predict stroke ahead
        </DropdownMenuCheckboxItem>
        <DropdownMenuSeparator />
        {/* Stays open: the point of restoring defaults is watching the five
            faders above snap back. */}
        <DropdownMenuItem closeOnClick={false} onClick={resetPencil}>
          <RotateCcw />
          Restore defaults
        </DropdownMenuItem>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

function SoundSubmenu() {
  const soundEffectsEnabled = useVoiceStore((s) => s.soundEffectsEnabled);
  const setSoundEffectsEnabled = useVoiceStore((s) => s.setSoundEffectsEnabled);
  const soundEffectsVolume = useVoiceStore((s) => s.soundEffectsVolume);
  const setSoundEffectsVolume = useVoiceStore((s) => s.setSoundEffectsVolume);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Volume2 />
        Sound
        <MenuValue>
          {soundEffectsEnabled
            ? `${Math.round(soundEffectsVolume * 100)}%`
            : 'Off'}
        </MenuValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[min(15rem,calc(100vw-1rem))]">
        <DropdownMenuCheckboxItem
          checked={soundEffectsEnabled}
          onCheckedChange={setSoundEffectsEnabled}
        >
          Voice chat cues
        </DropdownMenuCheckboxItem>
        <MenuSliderItem
          label="Volume"
          value={soundEffectsVolume}
          display={`${Math.round(soundEffectsVolume * 100)}%`}
          min={0}
          max={1}
          step={0.05}
          disabled={!soundEffectsEnabled}
          onChange={setSoundEffectsVolume}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/**
 * Tutor-only. Every client publishes its own attention facts, but the thresholds
 * are applied by whoever is reading them — so these are the tutor's settings and
 * they take effect immediately, with nothing to sync to the student's machine.
 */
function AttentionSubmenu() {
  const enabled = useCanvasUiStore((s) => s.attentionAlertsEnabled);
  const setEnabled = useCanvasUiStore((s) => s.setAttentionAlertsEnabled);
  const idleSeconds = useCanvasUiStore((s) => s.attentionIdleSeconds);
  const setIdleSeconds = useCanvasUiStore((s) => s.setAttentionIdleSeconds);
  const awaySeconds = useCanvasUiStore((s) => s.attentionAwaySeconds);
  const setAwaySeconds = useCanvasUiStore((s) => s.setAttentionAwaySeconds);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Eye />
        Attention
        <MenuValue>{enabled ? 'On' : 'Off'}</MenuValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-60">
        <DropdownMenuCheckboxItem
          checked={enabled}
          onCheckedChange={setEnabled}
        >
          Watch for drifting
        </DropdownMenuCheckboxItem>
        <MenuSliderItem
          label="Idle after"
          value={idleSeconds}
          display={formatAttentionDuration(idleSeconds)}
          min={ATTENTION_IDLE_RANGE.min}
          max={ATTENTION_IDLE_RANGE.max}
          step={ATTENTION_IDLE_RANGE.step}
          disabled={!enabled}
          onChange={setIdleSeconds}
        />
        <MenuSliderItem
          label="Another window after"
          value={awaySeconds}
          display={formatAttentionDuration(awaySeconds)}
          min={ATTENTION_AWAY_RANGE.min}
          max={ATTENTION_AWAY_RANGE.max}
          step={ATTENTION_AWAY_RANGE.step}
          disabled={!enabled}
          onChange={setAwaySeconds}
        />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

export function BoardActionsMenu({
  title,
  isTutor,
  onOpenNotes,
  onOpenShortcuts,
}: {
  title: string;
  isTutor: boolean;
  onOpenNotes: () => void;
  onOpenShortcuts: () => void;
}) {
  const [exporting, setExporting] = useState(false);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const pngExportScale = useCanvasUiStore((s) => s.pngExportScale);
  const setPngExportScale = useCanvasUiStore((s) => s.setPngExportScale);
  const snappingEnabled = useCanvasUiStore((s) => s.snappingEnabled);
  const setSnappingEnabled = useCanvasUiStore((s) => s.setSnappingEnabled);
  const debugPerformance = useCanvasUiStore((s) => s.debugPerformance);
  const setDebugPerformance = useCanvasUiStore((s) => s.setDebugPerformance);
  const lowGraphics = useCanvasUiStore((s) => s.lowGraphics);
  const setLowGraphics = useCanvasUiStore((s) => s.setLowGraphics);
  const pdfPageLimit = useCanvasUiStore((s) => s.pdfPageLimit);
  const setPdfPageLimit = useCanvasUiStore((s) => s.setPdfPageLimit);

  const onExport = async () => {
    setExporting(true);
    try {
      await exportBoardToPng(title);
    } finally {
      setExporting(false);
    }
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button variant="ghost" size="icon-sm" aria-label="Board actions" />
        }
      >
        <EllipsisVertical />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          {isTutor && (
            <DropdownMenuItem onClick={onOpenNotes}>
              <NotebookPen />
              Student notes
            </DropdownMenuItem>
          )}
          <DropdownMenuItem onClick={onOpenShortcuts}>
            <Keyboard />
            Keyboard shortcuts
          </DropdownMenuItem>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Image</DropdownMenuLabel>
          <DropdownMenuItem
            // Not awaited: the clipboard write has to be issued while this
            // click is still the current task (see `writePngToClipboard`).
            onClick={() => {
              copyBoardToPngClipboard().catch((err: unknown) =>
                console.error('[clipboard] copy as PNG failed', err),
              );
            }}
          >
            <ClipboardCopy />
            Copy PNG
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={() => void onExport()}
            disabled={exporting}
          >
            <Download />
            Export PNG
          </DropdownMenuItem>
          {/* Resolution sits with the two actions it changes rather than in a
              preferences list, because it only ever means anything next to
              them — and the trigger carries the current multiplier so the
              choice is visible without opening it. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger>
              <Scaling />
              Resolution
              <MenuValue>{pngExportScale}×</MenuValue>
            </DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="w-36">
              <DropdownMenuRadioGroup
                value={pngExportScale}
                onValueChange={(value) => setPngExportScale(Number(value))}
              >
                {PNG_EXPORT_SCALES.map((scale) => (
                  <DropdownMenuRadioItem key={scale} value={scale}>
                    {scale}×
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuSub>
        </DropdownMenuGroup>

        <DropdownMenuSeparator />

        <DropdownMenuGroup>
          <DropdownMenuLabel>Preferences</DropdownMenuLabel>
          <DropdownMenuCheckboxItem
            checked={theme === 'dark'}
            onCheckedChange={() => toggleTheme()}
          >
            <Moon />
            Dark mode
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={snappingEnabled}
            onCheckedChange={setSnappingEnabled}
          >
            <Magnet />
            Object snapping
          </DropdownMenuCheckboxItem>
          <PenSubmenu />
          <SoundSubmenu />
          {isTutor && <AttentionSubmenu />}
          {/* A student's boards get the default and no control: how much of a
              document belongs on the board is the tutor's call, and the limit
              is only ever met while pasting one. */}
          {isTutor && (
            <MenuSliderItem
              label="PDF pages"
              icon={<FileText />}
              value={pdfPageLimit}
              display={`${pdfPageLimit}`}
              min={PDF_PAGE_LIMIT_RANGE.min}
              max={PDF_PAGE_LIMIT_RANGE.max}
              step={PDF_PAGE_LIMIT_RANGE.step}
              onChange={setPdfPageLimit}
            />
          )}
          {/* Sits next to the overlay because the two are used together: you
              turn the counter on to find out whether you want this off. */}
          <DropdownMenuCheckboxItem
            checked={lowGraphics}
            onCheckedChange={setLowGraphics}
          >
            <Zap />
            Low graphics
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={debugPerformance}
            onCheckedChange={setDebugPerformance}
          >
            <Gauge />
            Performance overlay
          </DropdownMenuCheckboxItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
