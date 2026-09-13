import { useId, type CSSProperties } from 'react';

/** A gently undulating white silhouette, kept separate from interactive content. */
export function ToolbarPlate({ style }: { style?: CSSProperties }) {
  const id = useId();
  return (
    <span aria-hidden="true" className="tb-plate" style={style}>
      <svg
        viewBox="0 0 1000 100"
        preserveAspectRatio="none"
        className="tb-plate-art"
      >
        <defs>
          <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
            <stop className="tb-plate-top" />
            <stop offset="1" className="tb-plate-bottom" />
          </linearGradient>
        </defs>
        <path
          d="M52 3C88 0 107 13 147 9S207 0 261 5S358 2 419 4S513 0 574 6S658 10 721 5S800 9 857 5S927 0 953 5C981 10 997 27 997 51S983 89 956 94C925 101 887 92 843 95S761 92 707 95S620 99 567 95S478 100 420 95S327 99 279 94S200 99 158 94S102 100 58 95C23 94 3 77 3 52S22 6 52 3Z"
          fill={`url(#${id})`}
        />
      </svg>
    </span>
  );
}
