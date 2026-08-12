import { getAuth } from '@/board/auth';

export interface Identity {
  name: string;
  color: string;
  isTutor: boolean;
}

/**
 * The tutor's cursor color is reserved so students can always spot them.
 * Mirrors `--color-danger` in index.css — that file is the single source of
 * truth for literal colors, but this math (parseHex/color-mix) needs its own
 * literal value, so it copies rather than reads the CSS custom property.
 */
export const TUTOR_COLOR = '#DC2626';

/**
 * Offered to students as their identity color (see NameDialog). A muted,
 * enterprise-soft set: hues spread evenly around the wheel at a low 36%
 * saturation, so they read as calm product colours rather than as the
 * saturated primaries a whiteboard normally reaches for.
 *
 * Every entry is tuned to the same relative luminance (~0.16) rather than to a
 * shared HSL lightness, because the identity colour has three jobs and equal
 * luminance is what makes all three hold at once:
 *
 *   - Cursor on the canvas — clears 3:1 against both the light (#F5F5F3) and
 *     dark (#0E0E10) canvas. Measured 4.56–4.62 and 3.83–3.87.
 *   - Cursor name tag — `textOnColor` resolves to white for every entry, so
 *     labels never flip mid-palette the way they did before.
 *   - Avatar — see `avatarTint`/`avatarInk` in board-chrome.
 *
 * Hues deliberately skip the 0–20 range: that is the reserved TUTOR_COLOR red
 * (nearest student colour is ΔE 60 away, so a tutor is never mistakable for a
 * student). Closest pair within the set is ΔE 20, comparable to the saturated
 * palette this replaced.
 */
export const STUDENT_COLORS = [
  '#4F70A8', // steel blue
  '#7762B5', // muted indigo
  '#9F50AB', // dusty violet
  '#AB517E', // dusty rose
  '#856B3F', // bronze
  '#627638', // olive
  '#3A7B64', // pine
  '#3D7881', // slate teal
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
  // 4.5:1 — the guideline's minimum for text under 18px, which this always is
  // (avatar initials, cursor name tags).
  return 1.05 / (luminance + 0.05) >= 4.5 ? '#fff' : '#101010';
}

const NAME_KEY = 'whiteboard:display-name';
const COLOR_KEY = 'whiteboard:cursor-color';

export function setStoredName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

export function setStoredColor(color: string): void {
  localStorage.setItem(COLOR_KEY, color);
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
