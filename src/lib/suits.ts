/**
 * BRAND §6 — suits are taxonomy, not ornament. Every project and stack item
 * carries exactly one suit.
 *
 * This lives in a module rather than in `SuitGlyph.astro` because Astro forbids
 * exporting values from components (`astro/no-exports-from-components`), and
 * because the taxonomy is data the schema, the seed and the admin UI all share —
 * not a property of one component.
 */
export const SUITS = ["diamonds", "spades", "hearts", "clubs"] as const;

export type Suit = (typeof SUITS)[number];

/**
 * The category each suit stands for. Callers render this as text so the glyph is
 * never the only thing conveying meaning (BRAND §6, §9).
 */
export const SUIT_CATEGORY: Record<Suit, string> = {
  diamonds: "Product & client work",
  spades: "Systems & backend",
  hearts: "Open source",
  clubs: "Infrastructure & tooling",
};

/** Maps the Prisma `Suit` enum (uppercase) onto the component's lowercase key. */
export function suitFromEnum(value: string): Suit {
  const lower = value.toLowerCase();
  const match = SUITS.find((s) => s === lower);
  if (!match) throw new Error(`Unknown suit: ${value}`);
  return match;
}

/**
 * The same taxonomy as the Prisma `Suit` enum expects it — uppercase.
 *
 * Derived from `SUITS` rather than written out again: two hand-maintained lists
 * of the same four values drift, and the one that drifts is always the one
 * nobody renders.
 */
export const SUIT_ENUM_VALUES = SUITS.map((suit) => suit.toUpperCase()) as [
  "DIAMONDS",
  "SPADES",
  "HEARTS",
  "CLUBS",
];
