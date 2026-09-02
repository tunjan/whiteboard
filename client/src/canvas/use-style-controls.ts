import { useEffect, useRef } from 'react';
import type {
  ArrowTopology,
  FillStyle,
  FontFamily,
  FontWeight,
  LineSpline,
  StrokeDash,
  TextAlign,
  TextProps,
} from '@whiteboard/shared';
import { orthogonalRoute } from '@/canvas/shapes/connector-routing';
import { stabilizeTextPosition } from '@/canvas/shapes/text-measure';
import { editor, useDocumentStore } from '@/canvas/use-document-store';
import { useSelectionStore } from '@/canvas/use-selection-store';
import { paletteColors, useStyleStore } from '@/canvas/use-style-store';
import { useThemeStore } from '@/use-theme-store';

// Draw shapes take a fill too, but only once the stroke closed on itself — an
// open squiggle has no interior to paint.
const FILLABLE = new Set(['rectangle', 'ellipse', 'polygon', 'draw']);
const DASHABLE = new Set([
  'rectangle',
  'ellipse',
  'polygon',
  'line',
  'arrow',
  'draw',
]);

/** Which controls apply to what is being styled right now. */
export interface StyleFlags {
  color: boolean;
  size: boolean;
  fill: boolean;
  dash: boolean;
  opacity: boolean;
  font: boolean;
  align: boolean;
  arrows: boolean;
  lineOptions: boolean;
  connectorLabel: boolean;
}

export interface StyleControls {
  /** True when at least one control applies — i.e. when a style UI belongs on screen. */
  visible: boolean;
  show: StyleFlags;
  /**
   * The shape type the controls resolve to: the active tool's, or the
   * selection's, or `'mixed'` across an uneven selection. Useful as a remount
   * key, so a change of subject replays the entrance rather than morphing.
   */
  targetType: string | null;
  values: {
    color: string;
    size: number;
    fill: FillStyle;
    dash: StrokeDash;
    opacity: number;
    arrowStart: boolean;
    arrowEnd: boolean;
    arrowTopology: ArrowTopology;
    lineSpline: LineSpline;
    fontFamily: FontFamily;
    fontWeight: FontWeight;
    align: TextAlign;
    connectorLabel: string;
  };
  /**
   * Each setter writes the style store — so the next shape inherits it — and
   * then the same property onto every selected shape that carries it.
   */
  apply: {
    color: (value: string) => void;
    size: (value: number) => void;
    fill: (value: FillStyle) => void;
    dash: (value: StrokeDash) => void;
    opacity: (value: number) => void;
    arrowStart: (value: boolean) => void;
    arrowEnd: (value: boolean) => void;
    arrowTopology: (value: ArrowTopology) => void;
    lineSpline: (value: LineSpline) => void;
    fontFamily: (value: FontFamily) => void;
    fontWeight: (value: FontWeight) => void;
    align: (value: TextAlign) => void;
    connectorLabel: (value: string) => void;
  };
}

/**
 * Everything a style surface needs: which controls apply, what they currently
 * read, and what each one writes.
 *
 * Extracted from the style panel so the panel and the toolbar's satellite bar
 * cannot disagree about when a control belongs on screen or about what it
 * touches when it changes — the two questions that were the whole of that
 * component apart from its layout.
 */
export function useStyleControls(activeToolId: string): StyleControls {
  const {
    color,
    size,
    fill,
    dash,
    opacity,
    arrowStart,
    arrowEnd,
    arrowTopology,
    lineSpline,
    fontFamily,
    fontWeight,
    align,
  } = useStyleStore();
  const theme = useThemeStore((s) => s.theme);
  const {
    setColor,
    setSize,
    setFill,
    setDash,
    setOpacity,
    setArrowStart,
    setArrowEnd,
    setArrowTopology,
    setLineSpline,
    setFontFamily,
    setFontWeight,
    setAlign,
  } = useStyleStore.getState();
  const selectedIds = useSelectionStore((s) => s.selectedIds);

  // Only the *type* the selection resolves to is needed, so derive it inside
  // the selector and subscribe to that string. Subscribing to the page shapes
  // record instead would re-render the caller once per frame of every stroke,
  // because the record is a fresh object on every mutation.
  const selectedType = useDocumentStore((s) => {
    if (selectedIds.length === 0) return null;
    const firstId = selectedIds[0];
    const firstShape = firstId ? s.shapesById.get(firstId) : undefined;
    if (!firstShape) return null;
    const allSameType = selectedIds.every(
      (id) => id && s.shapesById.get(id)?.type === firstShape.type,
    );
    return allSameType ? firstShape.type : 'mixed';
  });
  // Whether the selection holds a stroke that closed on itself. Only those have
  // an interior, so the fill control would be inert on any other pen stroke.
  const hasClosedDraw = useDocumentStore((s) =>
    selectedIds.some((id) => {
      const shape = id ? s.shapesById.get(id) : undefined;
      return shape?.type === 'draw' && shape.props.isClosed;
    }),
  );
  const connectorLabel = useDocumentStore((s) => {
    if (selectedIds.length !== 1) return '';
    const id = selectedIds[0];
    const shape = id ? s.shapesById.get(id) : undefined;
    return shape && (shape.type === 'line' || shape.type === 'arrow')
      ? (shape.props.label ?? '')
      : '';
  });

  const stylable = (() => {
    // The eraser paints nothing, so every control here would be inert on it;
    // its one setting — object vs precision — rides on its toolbar button.
    if (
      activeToolId === 'hand' ||
      activeToolId === 'laser' ||
      activeToolId === 'eraser'
    ) {
      return false;
    }
    if (activeToolId === 'select') return selectedIds.length > 0;
    return true;
  })();

  const targetType =
    activeToolId !== 'select' ? activeToolId : selectedType;

  const visible =
    stylable && targetType !== 'graph' && targetType !== 'equation';

  const show: StyleFlags = {
    // Media and stickers carry fixed artwork colors. Frames do expose color for
    // their structural border and title, while opacity remains shape-level.
    color:
      targetType !== 'image' &&
      targetType !== 'sticker' &&
      targetType !== 'video' &&
      targetType !== 'bookmark',

    size:
      targetType === 'draw' ||
      targetType === 'highlighter' ||
      targetType === 'line' ||
      targetType === 'arrow' ||
      targetType === 'rectangle' ||
      targetType === 'ellipse' ||
      targetType === 'polygon' ||
      targetType === 'mixed',

    fill:
      targetType === 'rectangle' ||
      targetType === 'ellipse' ||
      targetType === 'polygon' ||
      targetType === 'mixed' ||
      (targetType === 'draw' && (activeToolId !== 'select' || hasClosedDraw)),

    dash:
      targetType === 'draw' ||
      targetType === 'line' ||
      targetType === 'arrow' ||
      targetType === 'rectangle' ||
      targetType === 'ellipse' ||
      targetType === 'polygon' ||
      targetType === 'mixed',

    // The highlighter fixes its own translucency — that is what separates a
    // highlight from a coloured band — so the slider would be inert while it is
    // the active tool. It returns for the selection, where it edits the stroke
    // that was drawn like it edits any other shape.
    opacity: activeToolId !== 'highlighter',

    font: targetType === 'text' || targetType === 'mixed',
    align: targetType === 'text' || targetType === 'mixed',
    arrows: targetType === 'arrow',
    lineOptions: targetType === 'line',
    connectorLabel:
      activeToolId === 'select' &&
      selectedIds.length === 1 &&
      (targetType === 'line' || targetType === 'arrow'),
  };

  // Switching theme keeps the same palette slot rather than stranding the pen
  // on a color that is no longer shown.
  const previousTheme = useRef(theme);
  useEffect(() => {
    if (previousTheme.current === theme) return;
    const from = paletteColors(previousTheme.current);
    const to = paletteColors(theme);
    previousTheme.current = theme;
    const slot = from.findIndex(
      (c) => c.value === useStyleStore.getState().color,
    );
    const next = slot >= 0 ? to[slot] : undefined;
    if (next) setColor(next.value);
  }, [theme]);

  const applyColor = (value: string) => {
    setColor(value);
    for (const id of selectedIds)
      editor.updateShape(id, { props: { color: value } });
  };

  const applySize = (value: number) => {
    setSize(value);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && shape.type !== 'text') {
        editor.updateShape(id, { props: { size: value } });
      }
    }
  };

  const applyFill = (value: FillStyle) => {
    setFill(value);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && FILLABLE.has(shape.type)) {
        editor.updateShape(id, { props: { fillStyle: value } });
      }
    }
  };

  const applyDash = (value: StrokeDash) => {
    setDash(value);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape && DASHABLE.has(shape.type)) {
        editor.updateShape(id, { props: { dash: value } });
      }
    }
  };

  // Sets the opacity of the current selection (any shape type) and the style
  // default new shapes inherit.
  const applyOpacity = (value: number) => {
    setOpacity(value);
    for (const id of selectedIds) editor.updateShape(id, { opacity: value });
  };

  const applyArrowTopology = (topology: ArrowTopology) => {
    setArrowTopology(topology);
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape?.type !== 'arrow' || shape.props.points.length < 2) continue;
      const first = shape.props.points[0]!;
      const last = shape.props.points[shape.props.points.length - 1]!;
      const length = Math.hypot(last.x - first.x, last.y - first.y);
      editor.updateShape(id, {
        props: {
          topology,
          points:
            topology === 'elbow' ? orthogonalRoute(first, last) : [first, last],
          bend:
            topology === 'arc'
              ? Math.abs(shape.props.bend ?? 0) >= 0.5
                ? shape.props.bend
                : Math.max(18, Math.min(80, length * 0.2))
              : 0,
        },
      });
    }
  };

  const applyArrowStart = (value: boolean) => {
    setArrowStart(value);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowStart: value } });
      }
    }
  };

  const applyArrowEnd = (value: boolean) => {
    setArrowEnd(value);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'arrow') {
        editor.updateShape(id, { props: { arrowEnd: value } });
      }
    }
  };

  const applyLineSpline = (spline: LineSpline) => {
    setLineSpline(spline);
    for (const id of selectedIds) {
      if (editor.getShape(id)?.type === 'line') {
        editor.updateShape(id, { props: { spline } });
      }
    }
  };

  const applyConnectorLabel = (label: string) => {
    const id = selectedIds[0];
    const shape = id ? editor.getShape(id) : undefined;
    if (shape && (shape.type === 'line' || shape.type === 'arrow')) {
      editor.updateShape(shape.id, { props: { label } });
    }
  };

  /**
   * Restyle every selected text, moving each box so the restyle grows it about
   * its anchored edge and its centre rather than pushing it right and down.
   */
  const applyTextProps = (patch: Partial<TextProps>) => {
    for (const id of selectedIds) {
      const shape = editor.getShape(id);
      if (shape?.type !== 'text') continue;
      const next = { ...shape.props, ...patch };
      const { x, y } = stabilizeTextPosition(shape, next);
      editor.updateShape(id, { x, y, props: patch });
    }
  };

  return {
    visible,
    show,
    targetType,
    values: {
      color,
      size,
      fill,
      dash,
      opacity,
      arrowStart,
      arrowEnd,
      arrowTopology: arrowTopology ?? 'straight',
      lineSpline: lineSpline ?? 'linear',
      fontFamily,
      fontWeight,
      align,
      connectorLabel,
    },
    apply: {
      color: applyColor,
      size: applySize,
      fill: applyFill,
      dash: applyDash,
      opacity: applyOpacity,
      arrowStart: applyArrowStart,
      arrowEnd: applyArrowEnd,
      arrowTopology: applyArrowTopology,
      lineSpline: applyLineSpline,
      fontFamily: (value: FontFamily) => {
        setFontFamily(value);
        applyTextProps({ fontFamily: value });
      },
      fontWeight: (value: FontWeight) => {
        setFontWeight(value);
        applyTextProps({ fontWeight: value });
      },
      align: (value: TextAlign) => {
        setAlign(value);
        applyTextProps({ align: value });
      },
      connectorLabel: applyConnectorLabel,
    },
  };
}
