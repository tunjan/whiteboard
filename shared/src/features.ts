/**
 * Optional features a tutor can switch off, instance-wide (their defaults) or
 * per board. Core drawing — ink, shapes, text, images, pages, frames — is not
 * listed: a whiteboard without it is not one.
 *
 * Turning a feature off removes the ways to *create* it; shapes already on the
 * board keep rendering. Only the features that cost money or disk (`ai`,
 * `documents`, `media`) are also refused by the server — the rest declutter.
 */
export const FEATURES = [
  'ai',
  'stickers',
  'voice',
  'music',
  'comments',
  'documents',
  'media',
  'graphs',
  'equations',
  'construction',
  'templates',
  'laser',
] as const;

export type Feature = (typeof FEATURES)[number];
export type FeatureSet = Record<Feature, boolean>;

export const ALL_FEATURES: FeatureSet = Object.fromEntries(
  FEATURES.map((f) => [f, true]),
) as FeatureSet;

/** The tool that creates a feature's content, for the tools that have one. */
export const TOOL_FEATURE: Partial<Record<string, Feature>> = {
  sticker: 'stickers',
  comment: 'comments',
  graph: 'graphs',
  equation: 'equations',
  straightedge: 'construction',
  compass: 'construction',
  measure: 'construction',
  laser: 'laser',
};

/**
 * Stateless message the server sends a board's room after the tutor changes
 * its features, so every open client refetches them without a reload.
 */
export const FEATURES_MESSAGE = 'whiteboard:features';

/** Keeps only known keys with boolean values; anything else is dropped. */
export function parseFeatureSet(value: unknown): Partial<FeatureSet> {
  if (!value || typeof value !== 'object') return {};
  const out: Partial<FeatureSet> = {};
  for (const f of FEATURES) {
    const v = (value as Record<string, unknown>)[f];
    if (typeof v === 'boolean') out[f] = v;
  }
  return out;
}

/**
 * What a board actually offers: its own set if the tutor gave it one, else the
 * tutor's defaults, else everything — with AI off whenever the server has no
 * key to run it on.
 */
export function resolveFeatures(
  defaults: unknown,
  board: unknown,
  aiConfigured: boolean,
): FeatureSet {
  const resolved: FeatureSet = {
    ...ALL_FEATURES,
    ...parseFeatureSet(defaults),
    ...(board == null ? {} : parseFeatureSet(board)),
  };
  if (!aiConfigured) resolved.ai = false;
  return resolved;
}
