import { useState } from 'react';
import type { ReactNode } from 'react';
import {
  ClipboardCopy,
  Download,
  EllipsisVertical,
  Eye,
  Gauge,
  Keyboard,
  Magnet,
  Moon,
  NotebookPen,
  PenTool,
  RotateCcw,
  Scaling,
  Volume2,
} from 'lucide-react';

import {
  copyBoardToPngClipboard,
  exportBoardToPng,
} from '@/canvas/export-png';
import {
  ATTENTION_AWAY_RANGE,
  ATTENTION_IDLE_RANGE,
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
  value,
  display,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  label: string;
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
        <span>{label}</span>
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
        <DropdownMenuCheckboxItem
          checked={pencilEndTaper}
          onCheckedChange={setPencilEndTaper}
        >
          Taper stroke ends
        </DropdownMenuCheckboxItem>
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
        {/* Stays open: the point of restoring defaults is watching the four
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
