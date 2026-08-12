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

/** A head cracked open, its cap tumbling off ahead of the blast. */
export const MindBlown: LucideIcon = createLucideIcon('mind-blown', [
  [
    'path',
    {
      d: 'M14 5.6L10.99 6.75L11.2 9.41L9 7.8L6.4 10.1L6.92 6.8L4.5 5.6L7.09 4.5L6.6 1.44L9 3.3L11.15 1.88L10.91 4.5Z',
      key: 'blast',
    },
  ],
  ['path', { d: 'M15.65 2.28A3.8 3.8 0 0 1 21.95 6.52Z', key: 'cap' }],
  [
    'path',
    {
      d: 'M5 12.4Q12 14.6 19 12.4V15a7 7 0 0 1-14 0ZM6.9 17a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM12.9 17a2.1 2.1 0 1 0 4.2 0a2.1 2.1 0 1 0 -4.2 0ZM10.2 19.8a1.8 1.8 0 1 0 3.6 0a1.8 1.8 0 1 0 -3.6 0Z',
      key: 'face',
    },
  ],
]);

/** Cranium with the jaw sitting a halo's width below it, so the gap reads as teeth. */
export const Skull: LucideIcon = createLucideIcon('skull-stamp', [
  [
    'path',
    {
      d: 'M12 1C6.2 1 2.6 5.7 2.6 11c0 2.3 1 4.2 2.7 5.4h13.4c1.7-1.2 2.7-3.1 2.7-5.4C21.4 5.7 17.8 1 12 1ZM5.7 9.4a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM12.5 9.4a2.9 2.9 0 1 1 5.8 0a2.9 2.9 0 1 1 -5.8 0ZM12 10.8l2.3 4.6H9.7Z',
      key: 'cranium',
    },
  ],
  [
    'path',
    { d: 'M8.2 19.8h7.6a1.2 1.2 0 0 1 0 2.4H8.2a1.2 1.2 0 0 1 0-2.4Z', key: 'jaw' },
  ],
]);
