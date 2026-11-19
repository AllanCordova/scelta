import { describe, expect, it } from "vitest";
import { CARDS_PER_A4_SHEET, paginateCardsForPrint } from "./card-pagination";

function makeCards(count: number): number[] {
  return Array.from({ length: count }, (_, index) => index + 1);
}

describe("paginateCardsForPrint", () => {
  it("uses 8 cards per A4 sheet by default", () => {
    expect(CARDS_PER_A4_SHEET).toBe(8);
  });

  it("returns an empty array for 0 cards", () => {
    expect(paginateCardsForPrint([])).toEqual([]);
  });

  it("returns a single sheet for 1 card", () => {
    expect(paginateCardsForPrint(makeCards(1))).toEqual([[1]]);
  });

  it("fits 8 cards onto a single sheet", () => {
    const sheets = paginateCardsForPrint(makeCards(8));

    expect(sheets).toHaveLength(1);
    expect(sheets[0]).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it("splits 9 cards into sheets of 8 and 1", () => {
    const sheets = paginateCardsForPrint(makeCards(9));

    expect(sheets.map((sheet) => sheet.length)).toEqual([8, 1]);
    expect(sheets[1]).toEqual([9]);
  });

  it("splits 37 cards into sheets of [8, 8, 8, 8, 5]", () => {
    const cards = makeCards(37);
    const sheets = paginateCardsForPrint(cards);

    expect(sheets.map((sheet) => sheet.length)).toEqual([8, 8, 8, 8, 5]);
    expect(sheets.flat()).toEqual(cards);
  });

  it("supports custom perSheet values and rejects non-positive integers", () => {
    expect(paginateCardsForPrint(makeCards(5), 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(() => paginateCardsForPrint(makeCards(3), 0)).toThrow(RangeError);
    expect(() => paginateCardsForPrint(makeCards(3), -2)).toThrow(RangeError);
    expect(() => paginateCardsForPrint(makeCards(3), 2.5)).toThrow(RangeError);
  });
});
