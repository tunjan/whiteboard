import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { EraserScribblePath } from './EraserTrail';
import type { EraserScribble } from './use-eraser-trail-store';

const scribble: EraserScribble = {
  id: 'remote-erase',
  points: [
    { x: 0, y: 0, pressure: 0.5 },
    { x: 10, y: 4, pressure: 0.5 },
    { x: 20, y: 2, pressure: 0.5 },
    { x: 30, y: 8, pressure: 0.5 },
  ],
  state: 'active',
  color: 'muted-1',
  size: 12,
  opacity: 0.8,
  taper: true,
};

describe('EraserScribblePath', () => {
  it('renders collaborator geometry in the peer color at low alpha', () => {
    const html = renderToStaticMarkup(
      <svg>
        <EraserScribblePath
          scribble={scribble}
          zoom={1}
          color="#2563eb"
          opacity={0.1}
        />
      </svg>,
    );

    expect(html).toContain('<path');
    expect(html).toContain('fill="#2563eb"');
    expect(html).toContain('opacity="0.1"');
  });

  it('widens from a point at the tail to full width under the pointer', () => {
    const straight = Array.from({ length: 8 }, (_, i) => ({
      x: i * 10,
      y: 0,
      pressure: 0.5,
    }));
    const html = renderToStaticMarkup(
      <svg>
        <EraserScribblePath
          scribble={{ ...scribble, points: straight }}
          zoom={1}
          color="#000"
          opacity={0.8}
        />
      </svg>,
    );

    const d = /d="([^"]+)"/.exec(html)?.[1] ?? '';
    // Tapering both ends closed the head with the same 0.01 needle arc as the
    // tail, so the ribbon read as a symmetric sliver instead of a stroke being
    // dragged: the pointer end has to carry a full half-width round cap.
    expect(d).toContain('a 6 6');
    expect(d).toContain('a 0.01 0.01');
  });

  it('swells from the contact patch as the ribbon lengthens', () => {
    const capOf = (length: number) => {
      const html = renderToStaticMarkup(
        <svg>
          <EraserScribblePath
            scribble={{
              ...scribble,
              points: Array.from({ length: 8 }, (_, i) => ({
                x: (i * length) / 7,
                y: 0,
                pressure: 0.5,
              })),
            }}
            zoom={1}
            color="#000"
            opacity={0.8}
          />
        </svg>,
      );
      return Number(/a (\d+(?:\.\d+)?) /.exec(html)?.[1]);
    };

    expect(capOf(8)).toBeLessThan(capOf(36));
    expect(capOf(36)).toBeLessThan(capOf(72));
    expect(capOf(72)).toBe(capOf(144));
  });

  it('draws a lone point as a round contact patch', () => {
    const html = renderToStaticMarkup(
      <svg>
        <EraserScribblePath
          scribble={{ ...scribble, points: [scribble.points[0]!] }}
          zoom={2}
          color="var(--color-muted-foreground)"
          opacity={0.8}
        />
      </svg>,
    );

    expect(html).toContain('A 1.5 1.5');
    expect(html).toContain('fill="var(--color-muted-foreground)"');
    expect(html).toContain('opacity="0.8"');
  });
});
