import { describe, expect, it } from "vitest";
import { SUITS, SUIT_CATEGORY, suitFromEnum } from "../suits";

describe("BRAND §6 taxonomy", () => {
  it("has exactly the four suits", () => {
    expect([...SUITS]).toEqual(["diamonds", "spades", "hearts", "clubs"]);
  });

  // The categories are the contract BRAND §6 sets; a silent reword would
  // change what a screen reader announces.
  it.each([
    ["diamonds", "Product & client work"],
    ["spades", "Systems & backend"],
    ["hearts", "Open source"],
    ["clubs", "Infrastructure & tooling"],
  ])("%s reads as %s", (suit, category) => {
    expect(SUIT_CATEGORY[suit as (typeof SUITS)[number]]).toBe(category);
  });

  it("gives every suit a category", () => {
    for (const suit of SUITS) expect(SUIT_CATEGORY[suit]).toBeTruthy();
  });
});

describe("suitFromEnum", () => {
  it.each([
    ["DIAMONDS", "diamonds"],
    ["SPADES", "spades"],
    ["HEARTS", "hearts"],
    ["CLUBS", "clubs"],
  ])("maps the Prisma enum %s", (input, expected) => {
    expect(suitFromEnum(input)).toBe(expected);
  });

  it("throws on an unknown suit rather than guessing", () => {
    expect(() => suitFromEnum("JOKERS")).toThrow("Unknown suit: JOKERS");
  });
});
