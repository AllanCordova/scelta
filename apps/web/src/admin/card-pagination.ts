/**
 * Number of voter access cards per A4 print sheet (2 columns x 4 rows),
 * sized to fit a >= 34mm QR code, voter name, short URL, and large code.
 */
export const CARDS_PER_A4_SHEET = 8;

/**
 * Splits a list of print cards into explicit A4 sheet pages of `perSheet` items.
 */
export function paginateCardsForPrint<T>(
  cards: readonly T[],
  perSheet: number = CARDS_PER_A4_SHEET,
): T[][] {
  if (!Number.isInteger(perSheet) || perSheet <= 0) {
    throw new RangeError("perSheet must be a positive integer.");
  }

  if (cards.length === 0) {
    return [];
  }

  const sheets: T[][] = [];
  for (let index = 0; index < cards.length; index += perSheet) {
    sheets.push(cards.slice(index, index + perSheet));
  }
  return sheets;
}
