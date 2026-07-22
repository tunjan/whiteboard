import { getAuth } from '@/board/auth';

export interface Identity {
  name: string;
  color: string;
  isTutor: boolean;
}

/** The tutor's cursor color is reserved so students can always spot them. */
export const TUTOR_COLOR = '#e5484d';

const STUDENT_COLORS = [
  '#2f6df6',
  '#1ea672',
  '#f5a524',
  '#8b5cf6',
  '#0ea5e9',
  '#d6409f',
  '#f97316',
  '#14b8a6',
];

/** A darker shade of a peer colour, used for outlines on their own fill. */
export function outlineColor(color: string): string {
  return `color-mix(in srgb, ${color} 68%, #000)`;
}

function parseHex(color: string): [number, number, number] | null {
  const hex = color.trim().replace('#', '');
  const full =
    hex.length === 3
      ? hex
          .split('')
          .map((c) => c + c)
          .join('')
      : hex;
  if (!/^[0-9a-f]{6}$/i.test(full)) return null;
  return [
    Number.parseInt(full.slice(0, 2), 16),
    Number.parseInt(full.slice(2, 4), 16),
    Number.parseInt(full.slice(4, 6), 16),
  ];
}

/**
 * Black or white label text, whichever reads better on a peer colour. The
 * lighter palette entries (amber, orange) are barely legible under white.
 */
export function textOnColor(color: string): string {
  const rgb = parseHex(color);
  if (!rgb) return '#fff';
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // White is the house style, so keep it until its WCAG contrast drops below
  // 3:1 — strict max-contrast would flip mid-tone blues and reds to black too.
  return 1.05 / (luminance + 0.05) >= 3 ? '#fff' : '#101010';
}

const NAME_KEY = 'whiteboard:display-name';
const COLOR_KEY = 'whiteboard:cursor-color';

export function setStoredName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

function getStoredName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

/** A stable per-browser student color from the palette (never the tutor color). */
export function getOrAssignStudentColor(): string {
  let color = localStorage.getItem(COLOR_KEY);
  if (!color) {
    color =
      STUDENT_COLORS[Math.floor(Math.random() * STUDENT_COLORS.length)] ??
      '#2f6df6';
    localStorage.setItem(COLOR_KEY, color);
  }
  return color;
}

export interface ResolvedIdentity {
  identity: Identity | null;
  needsName: boolean;
  color: string;
}

/**
 * Authenticated → tutor (reserved color, name from session). Otherwise a
 * student: name from localStorage, or prompt for one.
 */
export async function resolveIdentity(): Promise<ResolvedIdentity> {
  const auth = await getAuth();
  if (auth.authenticated) {
    return {
      identity: {
        name: auth.name ?? 'Tutor',
        color: TUTOR_COLOR,
        isTutor: true,
      },
      needsName: false,
      color: TUTOR_COLOR,
    };
  }
  const color = getOrAssignStudentColor();
  const name = getStoredName();
  if (name) {
    return {
      identity: { name, color, isTutor: false },
      needsName: false,
      color,
    };
  }
  return { identity: null, needsName: true, color };
}
