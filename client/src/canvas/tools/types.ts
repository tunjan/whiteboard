import type { ComponentType } from 'react';
import type { Bounds, Point } from '@whiteboard/shared';
import type { Editor } from '../editor';

/** Pointer info passed to tool handlers, normalized to world coordinates. */
export interface ToolPointerInfo {
  /** Pointer position in world coordinates. */
  point: Point;
  /** Pointer position in container-relative screen pixels. */
  screenPoint: Point;
  /** Event timestamp in milliseconds, used for velocity-sensitive tools. */
  timestamp: number;
  /** Current screen-pixel-per-world-unit scale. */
  zoom: number;
  /** Pointer pressure 0..1 (0.5 for mouse without real pressure). */
  pressure: number;
  /** Browser pointer type, used by tools that distinguish mouse from pen input. */
  pointerType: string;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** PointerEvent.button (0 = primary). */
  button: number;
}

/** Ambient context every tool handler receives. */
export interface ToolContext {
  editor: Editor;
  /** Live visible page bounds, used to cull spatial interaction candidates. */
  getViewportBounds?: () => Bounds;
  /** Switch the active tool (e.g. revert to select after creating a shape). */
  setTool: (toolId: string) => void;
  /** Finish a creation interaction: revert to Select unless Tool Lock is on. */
  complete: () => void;
}

/**
 * A tool registers its hotkey, cursor, icon, and pointer handlers. The canvas
 * routes input to the active tool by looking it up in the registry — it has no
 * hardcoded tool logic.
 */
export interface Tool {
  id: string;
  label: string;
  /** Single-key hotkey (e.g. "r", "v"). */
  hotkey?: string;
  /** CSS cursor while this tool is active. */
  cursor?: string;
  icon?: ComponentType<{ className?: string }>;
  /** Hidden tools are activatable but not shown as flat toolbar buttons. */
  hidden?: boolean;
  /**
   * Deliver every coalesced hardware sample to `onPointerMove`, not just the
   * one position the browser dispatched.
   *
   * Only tools that *accumulate a point sequence* need this — ink smoothing is
   * an EMA over the samples, so their density shapes the curve. Tools that
   * merely track a current position (select, and the drag-to-create tools) must
   * leave this off: each sample there overwrites the previous one at the same
   * shape ids within a single frame, so processing 2-8 samples per event ran
   * the whole mutate → snapshot → reconcile pipeline once per sample to produce
   * a result only the last sample could be seen to have set.
   */
  wantsCoalescedSamples?: boolean;

  onEnter?(ctx: ToolContext): void;
  onExit?(ctx: ToolContext): void;
  onPointerDown?(info: ToolPointerInfo, ctx: ToolContext): void;
  onPointerMove?(info: ToolPointerInfo, ctx: ToolContext): void;
  onPointerUp?(info: ToolPointerInfo, ctx: ToolContext): void;
  /**
   * Abort the in-progress interaction without committing it — e.g. a one-finger
   * stroke is interrupted when a second finger lands and a pinch-zoom begins.
   * Tools should discard any pending shape/edit and restore pre-gesture state.
   */
  onCancel?(ctx: ToolContext): void;
  /**
   * Finalize the in-progress interaction, keeping what's been drawn — used when
   * the OS reclaims a pen/mouse pointer mid-stroke (a spurious pointercancel /
   * lostpointercapture). The canvas falls back to onCancel for tools that don't
   * implement this.
   */
  onCommit?(ctx: ToolContext): void;
  onDoubleClick?(info: ToolPointerInfo, ctx: ToolContext): void;
  /** Return true when the tool handled the key and global canvas shortcuts
   * should stop processing it. */
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): boolean | void;
  /** Modifier releases can change an active gesture without pointer movement. */
  onKeyUp?(e: KeyboardEvent, ctx: ToolContext): boolean | void;
}
