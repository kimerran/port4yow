/**
 * BRAND §6 — suits are taxonomy, not ornament. Every project and stack item
 * carries exactly one suit.
 *
 * "Not ornament" is now literal: the suit pips have been removed from the site
 * along with the rest of the playing-card metaphor, and `SuitGlyph.astro` with
 * them. What survives is the taxonomy itself — four categories that the schema,
 * the seed and the admin UI all share, rendered everywhere as their category
 * names. The suit is the storage key; `SUIT_CATEGORY` is what a visitor reads.
 */
export const SUITS = ["diamonds", "spades", "hearts", "clubs"] as const;

export type Suit = (typeof SUITS)[number];

/**
 * The category each suit stands for, and the only form of the taxonomy that
 * reaches a visitor. Callers render this as text; nothing renders the suit name.
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
