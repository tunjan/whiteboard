import { createLucideIcon, type LucideIcon } from 'lucide-react';

/**
 * Stamps the lucide set has no art for. Authored in lucide's 24×24 box and
 * built with `createLucideIcon`, so `StickerArt`'s two-pass render treats them
 * exactly like the rest of the catalog.
 *
 * Both read as silhouettes, so interior detail — eyes, the skull's nose — is a
 * counter-wound subpath punched out of the same `d`, not a separate shape: the
 * colored pass fills whatever it draws, and would swallow a nested shape whole.
 * What shows through a punched hole is the white halo pass underneath, which is
 * also why the holes are drawn oversized — the colored pass's own stroke eats
 * roughly one unit of every edge.
 */

/** A head with its top blown off in a burst. */
export const MindBlown: LucideIcon = createLucideIcon('mind-blown', [
  [
    'path',
    {
      d: 'M12.00 0.30L13.03 3.21L15.82 1.88L14.49 4.67L17.40 5.70L14.49 6.73L15.82 9.52L13.03 8.19L12.00 11.10L10.97 8.19L8.18 9.52L9.51 6.73L6.60 5.70L9.51 4.67L8.18 1.88L10.97 3.21Z',
      key: 'blast',
    },
  ],
  [
    'path',
    {
      d: 'M4.6 12.2L7.4 13.8L9.7 12.2L12 13.8L14.3 12.2L16.6 13.8L19.4 12.2V15.4a7.4 7 0 0 1-14.8 0ZM7 16.4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM13 16.4a2 2 0 1 0 4 0a2 2 0 1 0 -4 0ZM10.2 19.9a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z',
      key: 'face',
    },
  ],
]);

/** Cranium and jaw in one piece, so it cannot read as a bulb on a stand. */
export const Skull: LucideIcon = createLucideIcon('skull-stamp', [
  [
    'path',
    {
      d: 'M12 1C6.2 1 2.6 5.7 2.6 11c0 2.5 1.1 4.6 3 5.9V20a2 2 0 0 0 2 2h8.8a2 2 0 0 0 2-2v-3.1c1.9-1.3 3-3.4 3-5.9C21.4 5.7 17.8 1 12 1ZM5.7 9.4a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM12.5 9.4a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM12 12.6l2.6 5H9.4Z',
      key: 'cranium',
    },
  ],
]);
