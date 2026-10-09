import { createRoot } from 'react-dom/client';
import './index.css';
import type { GraphShape } from '@whiteboard/shared';
import { createDefaultGraphProps } from '@/canvas/graph-defaults';
import { graphUtil } from '@/canvas/shapes/graph';
import { ensureGraphMath } from '@/canvas/graph-math';
import { useGraphAnimationStore } from '@/canvas/use-graph-animation-store';
const base = createDefaultGraphProps();
const shape = {
  id: 'g', type: 'graph', x: 0, y: 0, rotation: 0, index: 'a1',
  props: {
    ...base, w: 600, h: 400, showIntersections: true,
    expressions: [
      { ...base.expressions[0]!, id: 'f', expression: 'f(x)=sin(a*x)' },
      { ...base.expressions[0]!, id: 'p', expression: 'y=f(x)', color: '#4465e9' },
      { ...base.expressions[0]!, id: 'q', expression: 'y=x/4', color: '#e16919' },
    ],
    parameters: { a: { value: 1, min: -5, max: 5, step: 0.1 } },
  },
} as GraphShape;
const C = graphUtil.Component as React.FC<{ shape: GraphShape }>;
await ensureGraphMath();
createRoot(document.getElementById('root')!).render(<svg width={640} height={440}><C shape={shape} /></svg>);
(window as any).anim = useGraphAnimationStore;
