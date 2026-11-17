import type { GraphViewport } from '@whiteboard/shared';

export interface GraphMathPreset {
  name: string;
  expression: string;
  description: string;
}

// Expressions are stored (and parsed) as ASCII math — the format the panel's
// mathfield reads and writes. LaTeX here would reach `tokenize` as a literal
// backslash and fail to parse, so every preset is covered by a test.
export const GRAPH_MATH_PRESETS: GraphMathPreset[] = [
  { name: 'Sine Wave', expression: 'y=sin(x)', description: 'Harmonic oscillation' },
  { name: 'Parabola', expression: 'y=a*x^2+b*x+c', description: 'Quadratic with dynamic parameters' },
  { name: 'Gaussian Bell', expression: 'y=exp(-x^2)', description: 'Normal distribution curve' },
  { name: 'Damped Wave', expression: 'y=exp(-0.2*x)*cos(2*x)', description: 'Decaying wave oscillator' },
  { name: 'Circle', expression: 'x^2+y^2=4', description: 'Implicit conic with radius 2' },
  { name: 'Hyperbola', expression: 'y=1/x', description: 'Inverse rational function' },
  { name: 'Cubic S-Curve', expression: 'y=x^3-3*x', description: 'Polynomial with local extrema' },
  { name: 'Absolute Value', expression: 'y=abs(x)', description: 'Piecewise linear ray' },
];

export interface GraphViewportPreset {
  name: string;
  shortLabel: string;
  viewport: GraphViewport;
  label: string;
  category: 'Standard & Zoom' | 'Trigonometric' | 'Special Domains';
  description: string;
}

export const GRAPH_VIEWPORT_PRESETS: readonly GraphViewportPreset[] = [
  {
    name: 'Standard',
    shortLabel: 'Standard',
    viewport: { xMin: -10, xMax: 10, yMin: -6, yMax: 6 },
    label: '[-10, 10]',
    category: 'Standard & Zoom',
    description: 'Cartesian center [-10, 10] × [-6, 6]',
  },
  {
    name: 'Trig 2π',
    shortLabel: '2π',
    viewport: { xMin: -2 * Math.PI, xMax: 2 * Math.PI, yMin: -2, yMax: 2 },
    label: '[-2π, 2π]',
    category: 'Trigonometric',
    description: 'Trig cycle [-2π, 2π] × [-2, 2]',
  },
  {
    name: 'Trig 4π',
    shortLabel: '4π',
    viewport: { xMin: -4 * Math.PI, xMax: 4 * Math.PI, yMin: -3, yMax: 3 },
    label: '[-4π, 4π]',
    category: 'Trigonometric',
    description: 'Extended cycle [-4π, 4π] × [-3, 3]',
  },
  {
    name: 'Quadrant I',
    shortLabel: 'Quad I',
    viewport: { xMin: 0, xMax: 10, yMin: 0, yMax: 10 },
    label: '[0, 10]',
    category: 'Special Domains',
    description: 'Positive domain [0, 10] × [0, 10]',
  },
  {
    name: 'Unit Box',
    shortLabel: 'Unit',
    viewport: { xMin: -2, xMax: 2, yMin: -2, yMax: 2 },
    label: '[-2, 2]',
    category: 'Standard & Zoom',
    description: 'Origin zoom [-2, 2] × [-2, 2]',
  },
  {
    name: 'Square 10×10',
    shortLabel: 'Square',
    viewport: { xMin: -5, xMax: 5, yMin: -5, yMax: 5 },
    label: '[-5, 5]',
    category: 'Standard & Zoom',
    description: 'Symmetric isotropic [-5, 5] × [-5, 5]',
  },
  {
    name: 'Wide View',
    shortLabel: 'Wide',
    viewport: { xMin: -50, xMax: 50, yMin: -30, yMax: 30 },
    label: '[-50, 50]',
    category: 'Standard & Zoom',
    description: 'Large domain [-50, 50] × [-30, 30]',
  },
] as const;
