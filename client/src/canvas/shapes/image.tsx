import { blobUrl } from '../../board/blobs';
import { boxBounds, boxHitTest, rotationTransform } from './box-geometry';
import type { ShapeUtil } from './types';

export const imageUtil: ShapeUtil<'image'> = {
  type: 'image',
  canResize: true,

  getDefaultProps: () => ({
    blobId: '',
    w: 0,
    h: 0,
    naturalWidth: 0,
    naturalHeight: 0,
  }),

  getBounds: (s) => boxBounds(s.x, s.y, s.props.w, s.props.h),

  hitTest: (s, p, tol) =>
    boxHitTest(s.x, s.y, s.props.w, s.props.h, s.rotation, p, tol),

  resize: (initial, nb) => ({
    x: nb.minX,
    y: nb.minY,
    props: {
      ...initial.props,
      w: Math.max(1, nb.maxX - nb.minX),
      h: Math.max(1, nb.maxY - nb.minY),
    },
  }),

  Component: ({ shape }) => {
    const { blobId, w, h } = shape.props;
    if (!blobId) return null;
    return (
      <g transform={rotationTransform(shape.x, shape.y, w, h, shape.rotation)}>
        <image
          href={blobUrl(blobId)}
          x={shape.x}
          y={shape.y}
          width={w}
          height={h}
          preserveAspectRatio="none"
        />
      </g>
    );
  },
};
