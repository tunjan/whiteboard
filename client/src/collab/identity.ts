import { getAuth } from '@/board/auth';
import { randomAvatarSeed } from './avatar';

export interface Identity {
  name: string;
  color: string;
  isTutor: boolean;
  /** Seed for this user's hand-drawn doodle avatar. */
  avatar: string;
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

const NAME_KEY = 'whiteboard:display-name';
const COLOR_KEY = 'whiteboard:cursor-color';
const AVATAR_KEY = 'whiteboard:avatar-seed';

export function setStoredName(name: string): void {
  localStorage.setItem(NAME_KEY, name);
}

function getStoredName(): string | null {
  return localStorage.getItem(NAME_KEY);
}

export function setStoredAvatar(seed: string): void {
  localStorage.setItem(AVATAR_KEY, seed);
}

/** A stable per-browser avatar seed, generated on first use. */
export function getOrAssignAvatar(): string {
  let seed = localStorage.getItem(AVATAR_KEY);
  if (!seed) {
    seed = randomAvatarSeed();
    localStorage.setItem(AVATAR_KEY, seed);
  }
  return seed;
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
  avatar: string;
}

/**
 * Authenticated → tutor (reserved color, name from session). Otherwise a
 * student: name from localStorage, or prompt for one.
 */
export async function resolveIdentity(): Promise<ResolvedIdentity> {
  const auth = await getAuth();
  const avatar = getOrAssignAvatar();
  if (auth.authenticated) {
    return {
      identity: {
        name: auth.name ?? 'Tutor',
        color: TUTOR_COLOR,
        isTutor: true,
        avatar,
      },
      needsName: false,
      color: TUTOR_COLOR,
      avatar,
    };
  }
  const color = getOrAssignStudentColor();
  const name = getStoredName();
  if (name) {
    return {
      identity: { name, color, isTutor: false, avatar },
      needsName: false,
      color,
      avatar,
    };
  }
  return { identity: null, needsName: true, color, avatar };
}
