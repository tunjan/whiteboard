import type { Shape } from '@whiteboard/shared';
import { linkHostname } from './link-url';

function conciseText(value: string, fallback: string): string {
  const text = value.trim().replace(/\s+/g, ' ');
  if (!text) return fallback;
  return text.length > 48 ? `${text.slice(0, 47)}…` : text;
}

/** Human-readable shape names, used by the selection live announcements. */
export function canvasObjectLabel(shape: Shape, ordinal: number): string {
  switch (shape.type) {
    case 'text':
      return `Text: ${conciseText(shape.props.text, 'Empty text')}`;
    case 'equation':
      return `Equation${shape.props.tag ? ` (${shape.props.tag})` : ''}: ${conciseText(shape.props.latex, 'Empty equation')}`;
    case 'frame':
      return `Frame: ${conciseText(shape.props.name, `Frame ${ordinal + 1}`)}`;
    case 'line':
      return shape.props.label
        ? `Line: ${conciseText(shape.props.label, 'Line')}`
        : `Line ${ordinal + 1}`;
    case 'arrow':
      return shape.props.label
        ? `Arrow: ${conciseText(shape.props.label, 'Arrow')}`
        : `Arrow ${ordinal + 1}`;
    case 'polygon':
      return `${shape.props.kind[0]!.toUpperCase()}${shape.props.kind.slice(1)} ${ordinal + 1}`;
    case 'sticker':
      // A custom sticker's id is a generated one, so name it by position
      // rather than reading an opaque id out loud.
      return shape.props.blobId
        ? `Sticker ${ordinal + 1}`
        : `Sticker: ${shape.props.sticker.replaceAll('-', ' ')}`;
    case 'graph':
      return `Graph ${ordinal + 1}, ${shape.props.expressions.length} expressions`;
    case 'rectangle':
      return `Rectangle ${ordinal + 1}`;
    case 'ellipse':
      return `Ellipse ${ordinal + 1}`;
    case 'draw':
      return `Drawing ${ordinal + 1}`;
    case 'image':
      return `Image ${ordinal + 1}`;
    case 'video':
      return `Video ${ordinal + 1}`;
    case 'bookmark':
      // Read out the site, not the full URL: a query string is unlistenable.
      return `Link ${ordinal + 1}: ${linkHostname(shape.props.url)}`;
    case 'group':
      return `Group ${ordinal + 1}`;
  }
}
