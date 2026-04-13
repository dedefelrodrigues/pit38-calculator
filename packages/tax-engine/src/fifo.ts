import Decimal from "decimal.js";
import type { Transaction, Lot, FifoMatch, FifoLotMatch } from "./types.js";

export interface FifoResult {
  /** One entry per processed SELL transaction, in chronological order. */
  matches: FifoMatch[];
  /** Lots that still have shares after all SELLs have been matched. */
  remainingLots: Lot[];
}

/**
 * Processes a mixed list of BUY and SELL transactions through FIFO lot matching.
 *
 * Rules:
 * - Transactions are sorted chronologically before processing.
 * - On the same calendar date, BUYs are processed before SELLs.
 * - Non-BUY/SELL transaction types are silently ignored.
 * - Selling more shares than available throws an Error.
 *
 * Commission handling:
 * - Buy commission is folded into `costPerSharePLN` (pro-rated per share),
 *   so partial-lot sells automatically carry the right proportional cost.
 * - Sell commission is recorded separately as `commissionSellPLN` on each
 *   FifoMatch and deducted when computing `gainLossPLN`.
 */
export function processFifo(transactions: Transaction[]): FifoResult {
  const sorted = [...transactions]
    .filter((tx) => tx.type === "BUY" || tx.type === "SELL")
    .sort((a, b) => {
      const dateCmp = a.date.localeCompare(b.date);
      if (dateCmp !== 0) return dateCmp;
      // Same date: BUYs before SELLs so an intraday buy is available immediately
      if (a.type === "BUY" && b.type === "SELL") return -1;
      if (a.type === "SELL" && b.type === "BUY") return 1;
      return 0;
    });

  // Per-symbol FIFO queues. Oldest lot is at index 0.
  const queues = new Map<string, Lot[]>();
  const matches: FifoMatch[] = [];

  for (const tx of sorted) {
    if (tx.type === "BUY") {
      const qty = tx.quantity!;

      // netAmountPLN = (grossAmount + commission) × fxRate  →  total PLN outflow
      // Dividing by quantity gives all-in cost per share (includes buy commission).
      const costPerSharePLN = tx.netAmountPLN.div(qty);

      const lot: Lot = {
        id: tx.id,
        symbol: tx.symbol,
        openDate: tx.date,
        originalQuantity: qty,
        remainingQuantity: qty,
        costPerSharePLN,
        sourceTxId: tx.id,
      };

      if (!queues.has(tx.symbol)) queues.set(tx.symbol, []);
      queues.get(tx.symbol)!.push(lot);
    } else {
      // SELL — consume from the front of the queue (FIFO)
      const queue = queues.get(tx.symbol) ?? [];
      let toAllocate = tx.quantity!;
      const lotMatches: FifoLotMatch[] = [];
      let totalCostPLN = new Decimal(0);

      for (const lot of queue) {
        if (toAllocate.lte(0)) break;

        const consumed = Decimal.min(toAllocate, lot.remainingQuantity);
        const costPLN = consumed.mul(lot.costPerSharePLN);

        lotMatches.push({
          lotId: lot.id,
          lotOpenDate: lot.openDate,
          quantityConsumed: consumed,
          costPerSharePLN: lot.costPerSharePLN,
          costPLN,
        });

        lot.remainingQuantity = lot.remainingQuantity.sub(consumed);
        totalCostPLN = totalCostPLN.add(costPLN);
        toAllocate = toAllocate.sub(consumed);
      }

      if (toAllocate.gt(0)) {
        throw new Error(
          `FIFO: insufficient shares to cover SELL of ${tx.quantity!.toString()} ` +
            `${tx.symbol} on ${tx.date} — short by ${toAllocate.toString()} shares`,
        );
      }

      // Drop fully consumed lots from the queue
      queues.set(
        tx.symbol,
        queue.filter((l) => l.remainingQuantity.gt(0)),
      );

      const revenueGrossPLN = tx.grossAmountPLN;
      const commissionSellPLN = tx.commissionPLN;

      matches.push({
        sellTxId: tx.id,
        symbol: tx.symbol,
        sellDate: tx.date,
        quantitySold: tx.quantity!,
        revenueGrossPLN,
        commissionSellPLN,
        costBasisPLN: totalCostPLN,
        gainLossPLN: revenueGrossPLN.sub(commissionSellPLN).sub(totalCostPLN),
        lots: lotMatches,
      });
    }
  }

  const remainingLots: Lot[] = [];
  for (const queue of queues.values()) {
    remainingLots.push(...queue);
  }

  return { matches, remainingLots };
}
