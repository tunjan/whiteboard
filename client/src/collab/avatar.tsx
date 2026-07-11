import { createAvatar } from '@dicebear/core';
import { openPeeps } from '@dicebear/collection';

/**
 * Hand-drawn "Open Peeps" doodle avatars (DiceBear, generated fully
 * client-side). A user's avatar is just a seed string; the same seed always
 * renders the same face, so peers can generate it locally from awareness.
 */

/** A fresh random seed for a new avatar. */
export function randomAvatarSeed(): string {
  return Math.random().toString(36).slice(2, 10);
}

const dataUriCache = new Map<string, string>();

/** The avatar SVG for a seed as a data URI, memoized across renders. */
export function avatarDataUri(seed: string): string {
  const cached = dataUriCache.get(seed);
  if (cached) return cached;
  const uri = createAvatar(openPeeps, {
    seed,
    backgroundColor: ['transparent'],
  }).toDataUri();
  dataUriCache.set(seed, uri);
  return uri;
}

/** Fixed light-grey backdrop so the dark line-art reads in light and dark mode. */
const AVATAR_BG = '#E5E5E5';

/** A round doodle avatar on a grey backdrop. */
export function DoodleAvatar({
  seed,
  className,
  title,
}: {
  seed: string;
  className?: string;
  title?: string;
}) {
  return (
    <div className={className} style={{ background: AVATAR_BG }} title={title}>
      <img
        src={avatarDataUri(seed)}
        alt=""
        className="size-full object-cover"
        draggable={false}
      />
    </div>
  );
}
