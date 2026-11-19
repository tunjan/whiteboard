import { useEffect, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';
import {
  ClipboardCopy,
  Code,
  Download,
  EllipsisVertical,
  Eye,
  FileText,
  Focus,
  Gauge,
  Keyboard,
  Layers,
  ListChecks,
  Magnet,
  Moon,
  Mouse,
  NotebookPen,
  Pencil,
  PenTool,
  Pointer,
  RotateCcw,
  Scaling,
  Sparkles,
  Volume2,
  Zap,
} from 'lucide-react';
import { AiModelsDialog } from '@/components/ai-models-dialog';
import { boardKey } from '@/board/board-access';
import { useFeature } from '@/board/features';
import { getAuth } from '@/board/auth';
import { FeaturesSubmenu } from '@/components/feature-settings';
import { setAutoCheck, useAutoCheckStore } from '@/canvas/work-checker';

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
  type ShapeRendererChoice,
} from '@/canvas/use-canvas-ui-store';
import type { RasterCacheMode } from '@/canvas/raster-grid';
import { isCoarsePointer } from '@/canvas/platform';
import {
  FINGER_ACTIONS,
  type FingerAction,
} from '@/canvas/touch-input';
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
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { cn } from '@/lib/utils';
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
    <span className="flex-1 pl-4 text-right text-xs tabular-nums text-fg-subtle">
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
  inline = false,
  bipolar = false,
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
  /** Label, fader and readout on one line, for a panel of short labels. */
  inline?: boolean;
  /** Zero is mid-travel, so a fill from the left end would mean nothing. */
  bipolar?: boolean;
  onChange: (value: number) => void;
}) {
  const nudge = (direction: 1 | -1) => {
    const next = Math.min(max, Math.max(min, value + direction * step));
    // Steps like 0.05 accumulate float dust that the readout would show as a
    // percentage that never lands on a round number.
    onChange(Number(next.toFixed(4)));
  };

  const readout = (
    <span
      className={cn(
        'text-xs tabular-nums text-fg-subtle',
        inline && 'w-9 shrink-0 text-right',
      )}
    >
      {display}
    </span>
  );
  // The toolbar's opacity fader: an amount fills grey, not the blue that marks
  // a choice, and the thumb is a white pill big enough to read as one — at
  // half height the fill ringed it like an outline.
  const fader = (
    <Slider
      aria-label={label}
      className={cn(
        inline
          ? // A hairline track under a round thumb: a capsule this short, next
            // to a one-word label, reads as an on/off switch.
            'min-w-0 flex-1 [--wb-slider-thumb:0.875rem] [--wb-slider-track:0.25rem] [&_[data-slot=slider-range]]:bg-fg-subtle/60 [&_[data-slot=slider-thumb]]:h-[calc(var(--wb-slider-thumb)+2*var(--wb-slider-pad))] [&_[data-slot=slider-thumb]>span]:ring-1 [&_[data-slot=slider-thumb]>span]:ring-fg-subtle/30'
          : '[--wb-slider-thumb:1.125rem] [--wb-slider-track:1rem] [&_[data-slot=slider-range]]:bg-fg-subtle',
        bipolar && '[&_[data-slot=slider-range]]:bg-transparent',
      )}
      min={min}
      max={max}
      step={step}
      value={value}
      disabled={disabled}
      onValueChange={(next) =>
        onChange(Array.isArray(next) ? next[0]! : next)
      }
    />
  );

  return (
    <DropdownMenuItem
      closeOnClick={false}
      disabled={disabled}
      label={label}
      className={inline ? 'h-8 gap-3 py-0' : 'flex-col items-stretch gap-1.5 py-2'}
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.stopPropagation();
        // The thumb has focus and already moved the value itself.
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        nudge(event.key === 'ArrowRight' ? 1 : -1);
      }}
    >
      {inline ? (
        <>
          <span className="w-24 shrink-0">{label}</span>
          {fader}
          {readout}
        </>
      ) : (
        <>
          <span className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2">
              {icon}
              {label}
            </span>
            {readout}
          </span>
          {fader}
        </>
      )}
    </DropdownMenuItem>
  );
}

/**
 * A three-way choice as a menu row: label, then a segmented control, so the
 * value is set where it is read instead of a flyout deeper. ←/→ step it, as
 * they move a fader.
 */
function MenuChoiceItem<T extends string>({
  label,
  value,
  options,
  labels,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  labels: Record<T, string>;
  onChange: (value: T) => void;
}) {
  return (
    <DropdownMenuItem
      closeOnClick={false}
      label={label}
      className="h-9 justify-between gap-3 py-0"
      onKeyDown={(event) => {
        if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
        event.stopPropagation();
        event.preventDefault();
        const step = event.key === 'ArrowRight' ? 1 : -1;
        const index = Math.min(
          options.length - 1,
          Math.max(0, options.indexOf(value) + step),
        );
        onChange(options[index]!);
      }}
    >
      <span className="whitespace-nowrap">{label}</span>
      <ToggleGroup
        aria-label={label}
        value={[value]}
        // A pressed segment pressed again would empty the group.
        onValueChange={(next) => next[0] && onChange(next[0] as T)}
        className="shrink-0"
      >
        {options.map((option) => (
          <ToggleGroupItem
            key={option}
            value={option}
            tabIndex={-1}
            className="h-6 min-w-0 px-2 text-xs"
          >
            {labels[option]}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
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

/**
 * What one finger does, named for the outcome rather than the setting. "Auto"
 * says what it decides on, because a mode that changes behaviour the first
 * time a Pencil touches the glass is otherwise a surprise.
 */
const FINGER_ACTION_LABELS: Record<FingerAction, string> = {
  auto: 'Automatic',
  draw: 'Draws',
  pan: 'Moves the board',
};
const FINGER_ACTION_HINTS: Record<FingerAction, string> = {
  auto: 'Draws until a stylus is used on this device, then moves the board.',
  draw: 'A finger uses the selected tool, as a mouse would.',
  pan: 'Only a stylus or mouse draws. A tap still selects.',
};

/**
 * Touch preferences. Shown only where there is a touch screen: on a mouse-only
 * machine every option here describes something that cannot happen.
 */
function TouchSubmenu() {
  const fingerAction = useCanvasUiStore((s) => s.fingerAction);
  const setFingerAction = useCanvasUiStore((s) => s.setFingerAction);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Pointer />
        Finger
        <MenuValue>{FINGER_ACTION_LABELS[fingerAction]}</MenuValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-[min(17rem,calc(100vw-1rem))]">
        <DropdownMenuRadioGroup
          value={fingerAction}
          onValueChange={(value) => setFingerAction(value as FingerAction)}
        >
          {FINGER_ACTIONS.map((action) => (
            <DropdownMenuRadioItem key={action} value={action}>
              <span className="flex flex-col items-start gap-0.5">
                {FINGER_ACTION_LABELS[action]}
                <span className="text-fg-muted text-xs">
                  {FINGER_ACTION_HINTS[action]}
                </span>
              </span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** The width of the pen's panels, which hold one-line faders. */
const PEN_PANEL = 'w-[min(18rem,calc(100vw-1rem))]';

/**
 * The pen's feel: the board menu's Pen panel, and the tray's pen chevron.
 *
 * Only what changes how handwriting looks day to day is on the first level.
 * The rest is calibration: set once for a device, then left alone.
 */
export function PenSettingsItems() {
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
  const autoRefineHandwriting = useCanvasUiStore((s) => s.autoRefineHandwriting);
  const setAutoRefineHandwriting = useCanvasUiStore(
    (s) => s.setAutoRefineHandwriting,
  );
  const resetPencil = useCanvasUiStore((s) => s.resetPencil);

  return (
    <>
      <MenuSliderItem
        inline
        label="Stabilisation"
        value={pencilStabilization}
        display={`${Math.round(pencilStabilization * 100)}%`}
        min={0}
        max={1}
        step={0.01}
        onChange={setPencilStabilization}
      />
      <MenuSliderItem
        inline
        bipolar
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
      <DropdownMenuSeparator />
      <MenuChoiceItem
        label="Stroke ends"
        value={pencilEndTaper}
        options={END_TAPER_MODES}
        labels={END_TAPER_LABELS}
        onChange={setPencilEndTaper}
      />
      <DropdownMenuCheckboxItem
        checked={autoRefineHandwriting}
        onCheckedChange={setAutoRefineHandwriting}
      >
        Tidy mouse handwriting
      </DropdownMenuCheckboxItem>
      <DropdownMenuSeparator />
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>Advanced</DropdownMenuSubTrigger>
        <DropdownMenuSubContent className={PEN_PANEL}>
          <MenuSliderItem
            inline
            label="Tilt"
            value={pencilTilt}
            display={`${Math.round(pencilTilt * 100)}%`}
            min={0}
            max={1}
            step={0.05}
            onChange={setPencilTilt}
          />
          <MenuSliderItem
            inline
            label="Smoothing"
            value={pencilSmoothing}
            display={`${Math.round(pencilSmoothing * 100)}%`}
            min={0}
            max={1}
            step={0.01}
            onChange={setPencilSmoothing}
          />
          <MenuSliderItem
            inline
            label="Start taper"
            value={pencilStartTaper}
            display={`${Math.round(pencilStartTaper)}px`}
            min={0}
            max={50}
            step={1}
            onChange={setPencilStartTaper}
          />
          <DropdownMenuSeparator />
          <MenuChoiceItem
            label="Response"
            value={pencilPressureCurve}
            options={PRESSURE_CURVES}
            labels={PRESSURE_CURVE_LABELS}
            onChange={setPencilPressureCurve}
          />
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
          {/* Stays open: the point of restoring defaults is watching the
              faders snap back. */}
          <DropdownMenuItem closeOnClick={false} onClick={resetPencil}>
            <RotateCcw />
            Restore defaults
          </DropdownMenuItem>
        </DropdownMenuSubContent>
      </DropdownMenuSub>
    </>
  );
}

function PenSubmenu() {
  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <PenTool />
        Pen
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className={PEN_PANEL}>
        <PenSettingsItems />
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}

/** How each renderer reads on the trigger and in the list. */
const RENDERER_LABELS: Record<ShapeRendererChoice, string> = {
  auto: 'Auto',
  'dom-svg': 'DOM/SVG',
  'canvas-2d': 'Canvas 2D',
};

const RASTER_LABELS: Record<RasterCacheMode, string> = {
  auto: 'Auto',
  on: 'On',
  off: 'Off',
};

/**
 * Which engine draws the board.
 *
 * Here rather than behind a query parameter because the answer is a property of
 * the machine, not of the board: the Canvas2D layer is the one that holds a
 * zoom together on a big page, and the DOM/SVG layer is the one to fall back to
 * if anything on screen looks wrong. Switching remounts the shape layer, which
 * is a blink and no more — the document is untouched, and nobody else's board
 * changes.
 *
 * The raster cache belongs to the DOM/SVG layer alone, so it goes dim under the
 * other one rather than disappearing: a row that vanishes reads as a bug, and
 * the reason it is inert is worth showing.
 */
function RenderingSubmenu() {
  const shapeRenderer = useCanvasUiStore((s) => s.shapeRenderer);
  const setShapeRenderer = useCanvasUiStore((s) => s.setShapeRenderer);
  const rasterCache = useCanvasUiStore((s) => s.rasterCache);
  const setRasterCache = useCanvasUiStore((s) => s.setRasterCache);
  // Under `auto` the page may be on either layer, so the cache stays live.
  const svg = shapeRenderer !== 'canvas-2d';

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Layers />
        Rendering
        <MenuValue>{RENDERER_LABELS[shapeRenderer]}</MenuValue>
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent className="w-48">
        <DropdownMenuLabel>Engine</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={shapeRenderer}
          onValueChange={(value) =>
            setShapeRenderer(value as ShapeRendererChoice)
          }
        >
          {(
            Object.keys(RENDERER_LABELS) as ShapeRendererChoice[]
          ).map((id) => (
            <DropdownMenuRadioItem key={id} value={id}>
              {RENDERER_LABELS[id]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        <DropdownMenuLabel>
          Raster cache{svg ? '' : ' (DOM/SVG only)'}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={rasterCache}
          onValueChange={(value) => setRasterCache(value as RasterCacheMode)}
        >
          {(Object.keys(RASTER_LABELS) as RasterCacheMode[]).map((mode) => (
            <DropdownMenuRadioItem key={mode} value={mode} disabled={!svg}>
              {RASTER_LABELS[mode]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
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
  boardId,
  title,
  isTutor,
  onOpenNotes,
  onOpenShortcuts,
  onRenameTitle,
  trigger,
  triggerContent,
}: {
  boardId: string;
  title: string;
  isTutor: boolean;
  onOpenNotes: () => void;
  onOpenShortcuts: () => void;
  /** Tutors only. Present means the menu owns renaming. */
  onRenameTitle?: () => void;
  /**
   * The control that opens the menu, and what goes inside it. The board chrome
   * passes the board's own name, because these are the board's actions and the
   * name is the board. Split in two because `render` replaces the element, not
   * its children — the same shape every other trigger in this codebase uses.
   */
  trigger?: ReactElement;
  triggerContent?: ReactNode;
}) {
  const [exporting, setExporting] = useState(false);
  const [aiModelsOpen, setAiModelsOpen] = useState(false);
  // Auto-check is only offered where the server has a model to check with.
  const aiEnabled = useFeature('ai');
  // AI models are the operator's bill; another tutor on a hosted server has no say.
  const [isAdmin, setIsAdmin] = useState(false);
  useEffect(() => {
    if (isTutor) void getAuth().then((auth) => setIsAdmin(auth.isAdmin === true));
  }, [isTutor]);
  const autoCheck = useAutoCheckStore((s) => s.on);
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggle);
  const pngExportScale = useCanvasUiStore((s) => s.pngExportScale);
  const setPngExportScale = useCanvasUiStore((s) => s.setPngExportScale);
  const snappingEnabled = useCanvasUiStore((s) => s.snappingEnabled);
  const setSnappingEnabled = useCanvasUiStore((s) => s.setSnappingEnabled);
  const invertScroll = useCanvasUiStore((s) => s.invertScroll);
  const setInvertScroll = useCanvasUiStore((s) => s.setInvertScroll);
  const debugPerformance = useCanvasUiStore((s) => s.debugPerformance);
  const setDebugPerformance = useCanvasUiStore((s) => s.setDebugPerformance);
  const lowGraphics = useCanvasUiStore((s) => s.lowGraphics);
  const groundFade = useCanvasUiStore((s) => s.groundFade);
  const setGroundFade = useCanvasUiStore((s) => s.setGroundFade);
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
    <>
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          trigger ?? (
            <Button variant="ghost" size="icon-sm" aria-label="Board actions" />
          )
        }
      >
        {triggerContent ?? <EllipsisVertical />}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" sideOffset={8} className="w-60">
        <DropdownMenuGroup>
          {onRenameTitle && (
            <DropdownMenuItem onClick={onRenameTitle}>
              <Pencil />
              Rename board
            </DropdownMenuItem>
          )}
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
          {/* AGPL-3.0 §13: everyone using this deployment can get its source. */}
          <DropdownMenuItem render={<a href="/source" target="_blank" rel="noreferrer" />}>
            <Code />
            Source code
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
          <DropdownMenuLabel>Board file</DropdownMenuLabel>
          <DropdownMenuItem
            // Every page and asset, as the server has them; re-imported from
            // the home screen as a new board.
            render={
              <a
                href={`/api/boards/${encodeURIComponent(boardId)}/export?k=${encodeURIComponent(boardKey())}`}
                download
              />
            }
          >
            <Download />
            Export .board
          </DropdownMenuItem>
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
            checked={groundFade}
            onCheckedChange={setGroundFade}
          >
            <Focus />
            Fade grid edges
          </DropdownMenuCheckboxItem>
          <DropdownMenuCheckboxItem
            checked={snappingEnabled}
            onCheckedChange={setSnappingEnabled}
          >
            <Magnet />
            Object snapping
          </DropdownMenuCheckboxItem>
          {/* Names the device it acts on, because it deliberately does not act
              on the other one: a trackpad already follows the system's natural
              scrolling setting, and reversing it here would fight it. */}
          <DropdownMenuCheckboxItem
            checked={invertScroll}
            onCheckedChange={setInvertScroll}
          >
            <Mouse />
            Invert mouse scroll
          </DropdownMenuCheckboxItem>
          {aiEnabled && (
            <DropdownMenuCheckboxItem checked={autoCheck} onCheckedChange={setAutoCheck}>
              <ListChecks />
              Auto-check working
            </DropdownMenuCheckboxItem>
          )}
          <PenSubmenu />
          {isCoarsePointer() && <TouchSubmenu />}
          <SoundSubmenu />
          {isTutor && <AttentionSubmenu />}
          {isTutor && <FeaturesSubmenu boardId={boardId} />}
          {/* The operator's bill, so the operator's choice; app-wide, not per board. */}
          {isAdmin && (
            <DropdownMenuItem onClick={() => setAiModelsOpen(true)}>
              <Sparkles />
              AI models…
            </DropdownMenuItem>
          )}
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
          <RenderingSubmenu />
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

        <DropdownMenuSeparator />

        {/* Which build is running, for bug reports. Plain text, not an item:
            nothing to click, and the arrow keys should skip it. */}
        <div className="px-2 py-1.5 font-mono text-2xs tabular-nums text-fg-subtle select-text">
          v{__APP_VERSION__}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
    <AiModelsDialog open={aiModelsOpen} onOpenChange={setAiModelsOpen} />
    </>
  );
}
