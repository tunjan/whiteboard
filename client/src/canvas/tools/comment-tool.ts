import { CommentGlyph } from '@/components/ui/glyphs';
import { useCommentsStore } from '../use-comments-store';
import type { Tool, ToolPointerInfo } from './types';

/**
 * Click-to-place comment pins. Clicking empty canvas opens a draft composer at
 * that world point; the tool stays active afterward so multiple comments can be
 * dropped in a row (Miro behavior) — it never calls `ctx.complete()`. Clicks on
 * an existing pin are handled by the pin's own DOM handler in CommentsLayer,
 * which sits above the canvas, so this tool only ever sees empty-canvas clicks.
 */
export function createCommentTool(): Tool {
  const clearDraft = () => {
    useCommentsStore.getState().setDraft(null);
  };

  return {
    id: 'comment',
    label: 'Comment',
    hotkey: 'c',
    cursor: 'crosshair',
    icon: CommentGlyph,

    onPointerDown(info: ToolPointerInfo) {
      if (info.button !== 0) return;
      useCommentsStore.getState().setOpenThreadId(null);
      useCommentsStore.getState().setDraft({ x: info.point.x, y: info.point.y });
    },

    onCancel() {
      clearDraft();
    },

    onExit() {
      clearDraft();
    },
  };
}
