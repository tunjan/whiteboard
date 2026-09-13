/** Shared screen-space appearance for the hover dot and temporary ink. */
export function LaserMark({ d }: { d: string }) {
  return (
    <g
      fill="none"
      stroke="#FF182B"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path
        d={d}
        strokeWidth={9}
        strokeOpacity={0.5}
        style={{ filter: 'blur(5px)' }}
      />
      <path d={d} strokeWidth={7.5} style={{ filter: 'blur(2px)' }} />
      <path d={d} strokeWidth={5.5} />
      <path d={d} strokeWidth={3.25} stroke="#FFF5F5" />
    </g>
  );
}
