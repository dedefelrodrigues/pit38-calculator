import Decimal from "decimal.js";
import type { Transaction } from "./types.js";

const ZERO = new Decimal(0);

const STOCK_TYPES = new Set(["BUY", "SELL", "STOCK_SPLIT"]);

// Same ordering used by the FIFO engine: on the same date, splits precede
// buys, buys precede sells — so position reflects the correct intraday state.
const TYPE_ORDER: Record<string, number> = { STOCK_SPLIT: 0, BUY: 1, SELL: 2 };

/**
 * Computes the running share position per symbol across all stock-type
 * transactions (BUY / SELL / STOCK_SPLIT), processed in chronological order.
 *
 * Returns a Map<txId, Decimal> where each entry is the position in that
 * symbol AFTER the transaction has been applied.
 *
 * - BUY:         position += quantity
 * - SELL:        position -= quantity
 * - STOCK_SPLIT: position *= quantity  (quantity = new-shares-per-old-share)
 *
 * Non-stock transactions (DIVIDEND, FEE, …) are ignored and will not appear
 * in the returned map.
 */
export function computeRunningPositions(
  transactions: Transaction[],
): Map<string, Decimal> {
  const stockTxs = transactions
    .filter((tx) => STOCK_TYPES.has(tx.type))
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3);
    });

  const symbolPos = new Map<string, Decimal>(); // symbol → current position
  const result = new Map<string, Decimal>();     // txId   → position after tx

  for (const tx of stockTxs) {
    const prev = symbolPos.get(tx.symbol) ?? ZERO;
    let next: Decimal;

    if (tx.type === "BUY") {
      next = prev.add(tx.quantity ?? ZERO);
    } else if (tx.type === "SELL") {
      next = prev.sub(tx.quantity ?? ZERO);
    } else {
      // STOCK_SPLIT: quantity = ratio (e.g. 10 for a 10:1 split)
      next = prev.mul(tx.quantity ?? ZERO);
    }

    symbolPos.set(tx.symbol, next);
    result.set(tx.id, next);
  }

  return result;
}

/**
 * Returns the current open position for every symbol that has a non-zero
 * remaining quantity after all transactions are applied.
 *
 * Convenience wrapper over `computeRunningPositions` for the Open Positions
 * page; avoids re-scanning the transaction list a second time.
 */
export function computeOpenPositions(
  transactions: Transaction[],
): Map<string, Decimal> {
  const stockTxs = transactions
    .filter((tx) => STOCK_TYPES.has(tx.type))
    .sort((a, b) => {
      const d = a.date.localeCompare(b.date);
      if (d !== 0) return d;
      return (TYPE_ORDER[a.type] ?? 3) - (TYPE_ORDER[b.type] ?? 3);
    });

  const symbolPos = new Map<string, Decimal>();

  for (const tx of stockTxs) {
    const prev = symbolPos.get(tx.symbol) ?? ZERO;
    let next: Decimal;

    if (tx.type === "BUY") {
      next = prev.add(tx.quantity ?? ZERO);
    } else if (tx.type === "SELL") {
      next = prev.sub(tx.quantity ?? ZERO);
    } else {
      next = prev.mul(tx.quantity ?? ZERO);
    }

    if (next.isZero()) {
      symbolPos.delete(tx.symbol);
    } else {
      symbolPos.set(tx.symbol, next);
    }
  }

  return symbolPos;
}
