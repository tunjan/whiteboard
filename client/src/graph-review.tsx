import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import type { GraphProps, GraphShape } from '@whiteboard/shared';
import { GraphPanelContent } from '@/components/graph-panel';
import { graphUtil } from '@/canvas/shapes/graph';
import { createDefaultGraphProps } from '@/canvas/graph-defaults';
import { editor } from '@/canvas/use-document-store';
import { ensureGraphMath } from '@/canvas/graph-math';
import { useThemeStore } from '@/use-theme-store';

// Mounts the real panel, and the plot it drives, with no board:
// `editor.updateShape` is redirected into local state so every control
// round-trips. `?theme=dark` for dark.
const dark = new URLSearchParams(location.search).get('theme') === 'dark';
useThemeStore.setState({ theme: dark ? 'dark' : 'light' });
setTimeout(() => document.documentElement.classList.toggle('dark', dark), 0);

const base = createDefaultGraphProps();
const initial: GraphShape[] = [
  {
    id: 'a', type: 'graph', x: 0, y: 0, rotation: 0, index: 'a1',
    props: {
      ...base,
      expressions: [
        { ...base.expressions[0]!, id: 'e1', expression: 'y=a*sin(x)' },
        { ...base.expressions[0]!, id: 'e2', expression: 'y=x^2-b', color: '#4465e9', dash: 'dashed' },
        { ...base.expressions[0]!, id: 'e3', expression: '(cos(t),sin(t))', color: '#e16919', visible: false },
        { ...base.expressions[0]!, id: 'e4', expression: 'y=sin(', color: '#099268' },
      ],
      parameters: {
        a: { value: 2, min: -5, max: 5, step: 0.1 },
        b: { value: 1, min: -10, max: 10, step: 0.1 },
      },
      showIntersections: true,
    },
  } as GraphShape,
  { id: 'b', type: 'graph', x: 0, y: 0, rotation: 0, index: 'a2', props: base } as GraphShape,
  {
    id: 'c', type: 'graph', x: 0, y: 0, rotation: 0, index: 'a3',
    props: {
      ...base,
      xScale: 'log',
      yScale: 'log',
      viewport: { xMin: 0.1, xMax: 1000, yMin: 0.01, yMax: 1e4 },
      expressions: [
        { ...base.expressions[0]!, id: 'c1', expression: 'y=x^2' },
        { ...base.expressions[0]!, id: 'c2', expression: 'y=100/x', color: '#4465e9' },
      ],
      showIntersections: true,
    },
  } as GraphShape,
  {
    id: 'd', type: 'graph', x: 0, y: 0, rotation: 0, index: 'a4',
    props: {
      ...base,
      angleUnit: 'deg',
      viewport: { xMin: -360, xMax: 360, yMin: -2, yMax: 2 },
      expressions: [{ ...base.expressions[0]!, id: 'd1', expression: 'y=sin(x)' }],
    },
  } as GraphShape,
];

function Review() {
  const [shapes, setShapes] = useState(initial);
  useEffect(() => {
    editor.updateShape = ((id: string, patch: { props?: Partial<GraphProps> }) =>
      setShapes((all) =>
        all.map((s) => (s.id === id ? { ...s, props: { ...s.props, ...patch.props } } : s)),
      )) as typeof editor.updateShape;
  }, []);
  return (
    <div className="flex min-h-dvh flex-wrap items-start gap-6 bg-canvas p-6">
      {shapes.map((shape) => (
        <div key={shape.id} className="flex items-start gap-3">
          <svg
            width={shape.props.w}
            height={shape.props.h}
            data-graph={shape.id}
            style={{ overflow: 'visible' }}
          >
            <graphUtil.Component shape={shape} />
          </svg>
          <GraphPanelContent shape={shape} />
        </div>
      ))}
    </div>
  );
}

await ensureGraphMath();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Review />
  </StrictMode>,
);
