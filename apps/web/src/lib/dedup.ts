import type { Transaction } from "@pit38/tax-engine";

/**
 * Returns a deterministic fingerprint for a transaction based on its
 * observable content. Two rows from the same broker export will always
 * produce the same fingerprint, regardless of the randomly-generated ID.
 */
function fingerprint(tx: Transaction): string {
  return [
    tx.broker,
    tx.date,
    tx.type,
    tx.symbol,
    tx.currency,
    tx.grossAmount.toFixed(6),
    tx.quantity?.toFixed(6) ?? "",
  ].join("|");
}

/**
 * Merges `incoming` transactions into `existing`, skipping duplicates.
 * Returns the merged array and the count of duplicates skipped.
 */
export function mergeDedup(
  existing: Transaction[],
  incoming: Transaction[],
): { merged: Transaction[]; duplicatesSkipped: number } {
  const seen = new Set(existing.map(fingerprint));
  let duplicatesSkipped = 0;
  const toAdd: Transaction[] = [];

  for (const tx of incoming) {
    const fp = fingerprint(tx);
    if (seen.has(fp)) {
      duplicatesSkipped++;
    } else {
      seen.add(fp);
      toAdd.push(tx);
    }
  }

  return { merged: [...existing, ...toAdd], duplicatesSkipped };
}
