// @vitest-environment happy-dom
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import { Background } from './Background';

it('snapshots the reduced viewport paint layers', () => {
  const snapshots = [0.375, 1, 2.5].map((z) => {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <Background
        type="dot"
        camera={{ x: -17.25, y: 10.5, z }}
        width={800}
        height={600}
      />,
    );
    return {
      zoom: z,
      layers: [...host.querySelectorAll('rect')].map((rect) => ({
        fill: rect.getAttribute('fill'),
        opacity: rect.getAttribute('opacity'),
      })),
    };
  });
  expect(snapshots).toMatchInlineSnapshot(`
    [
      {
        "layers": [
          {
            "fill": "url(#bg-dot-16)",
            "opacity": "1",
          },
          {
            "fill": "url(#bg-dot-4)",
            "opacity": "0.2015008248727057",
          },
        ],
        "zoom": 0.375,
      },
      {
        "layers": [
          {
            "fill": "url(#bg-dot-4)",
            "opacity": "1",
          },
          {
            "fill": "url(#bg-dot-1)",
            "opacity": "0.08363039845779201",
          },
        ],
        "zoom": 1,
      },
      {
        "layers": [
          {
            "fill": "url(#bg-dot-4)",
            "opacity": "1",
          },
          {
            "fill": "url(#bg-dot-1)",
            "opacity": "0.35",
          },
        ],
        "zoom": 2.5,
      },
    ]
  `);
});

it('never lets a pattern tile clip its dot', () => {
  for (const x of [-17.25, 0, 0.02, 31.99]) {
    const host = document.createElement('div');
    host.innerHTML = renderToStaticMarkup(
      <Background
        type="dot"
        camera={{ x, y: x, z: 1 }}
        width={800}
        height={600}
      />,
    );
    for (const pattern of host.querySelectorAll('pattern')) {
      const size = Number(pattern.getAttribute('width'));
      const circle = pattern.querySelector('circle')!;
      const cx = Number(circle.getAttribute('cx'));
      const r = Number(circle.getAttribute('r'));
      expect(cx - r).toBeGreaterThan(0);
      expect(cx + r).toBeLessThan(size);
    }
  }
});

it('applies the dot alpha once, over every lattice', () => {
  const host = document.createElement('div');
  host.innerHTML = renderToStaticMarkup(
    <Background
      type="dot"
      camera={{ x: 0, y: 0, z: 1 }}
      width={800}
      height={600}
    />,
  );
  const group = host.querySelector('g')!;
  expect(group.getAttribute('style')).toContain('var(--grid-dot-alpha)');
  expect(group.querySelectorAll('rect').length).toBe(2);
  for (const circle of host.querySelectorAll('circle')) {
    expect(circle.getAttribute('fill')).toBe('var(--grid-dot-ink)');
  }
});
