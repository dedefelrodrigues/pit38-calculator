import Decimal from "decimal.js";
import { describe, it, expect } from "vitest";
import type { Transaction } from "../src/types.js";
import { computeRunningPositions, computeOpenPositions } from "../src/portfolio.js";

// ---------------------------------------------------------------------------
// Helper — minimal enriched Transaction (fxRate = 1, all PLN)
// ---------------------------------------------------------------------------

let seq = 0;
function tx(
  overrides: Partial<Transaction> & Pick<Transaction, "type" | "date" | "symbol">,
): Transaction {
  const id = `tx-${++seq}`;
  const grossAmount = overrides.grossAmount ?? new Decimal(0);
  const commission = overrides.commission ?? new Decimal(0);
  return {
    id,
    broker: "test",
    currency: "PLN",
    grossAmount,
    commission,
    netAmount: overrides.netAmount ?? grossAmount,
    fxRate: new Decimal(1),
    fxDate: overrides.date,
    grossAmountPLN: grossAmount,
    commissionPLN: commission,
    netAmountPLN: overrides.netAmount ?? grossAmount,
    ...overrides,
  };
}

function d(n: number) {
  return new Decimal(n);
}

// ---------------------------------------------------------------------------
// computeRunningPositions
// ---------------------------------------------------------------------------

describe("computeRunningPositions — basic buy/sell", () => {
  const txs: Transaction[] = [
    tx({ type: "BUY",  date: "2023-01-10", symbol: "AAPL", quantity: d(10) }),
    tx({ type: "SELL", date: "2023-06-01", symbol: "AAPL", quantity: d(4) }),
    tx({ type: "SELL", date: "2023-09-01", symbol: "AAPL", quantity: d(6) }),
  ];

  it("position after first BUY = 10", () => {
    const map = computeRunningPositions(txs);
    expect(map.get(txs[0]!.id)?.toNumber()).toBe(10);
  });

  it("position after first SELL = 6", () => {
    const map = computeRunningPositions(txs);
    expect(map.get(txs[1]!.id)?.toNumber()).toBe(6);
  });

  it("position after second SELL = 0", () => {
    const map = computeRunningPositions(txs);
    expect(map.get(txs[2]!.id)?.toNumber()).toBe(0);
  });
});

describe("computeRunningPositions — stock split", () => {
  const buy   = tx({ type: "BUY",         date: "2023-01-10", symbol: "NVDA", quantity: d(5) });
  const split = tx({ type: "STOCK_SPLIT", date: "2023-06-10", symbol: "NVDA", quantity: d(10) }); // 10:1
  const sell  = tx({ type: "SELL",        date: "2023-09-01", symbol: "NVDA", quantity: d(50) });

  it("position after BUY = 5", () => {
    const map = computeRunningPositions([buy, split, sell]);
    expect(map.get(buy.id)?.toNumber()).toBe(5);
  });

  it("position after 10:1 split = 50", () => {
    const map = computeRunningPositions([buy, split, sell]);
    expect(map.get(split.id)?.toNumber()).toBe(50);
  });

  it("position after full SELL = 0", () => {
    const map = computeRunningPositions([buy, split, sell]);
    expect(map.get(sell.id)?.toNumber()).toBe(0);
  });
});

describe("computeRunningPositions — multiple symbols are independent", () => {
  const buyA  = tx({ type: "BUY",  date: "2023-01-10", symbol: "A", quantity: d(10) });
  const buyB  = tx({ type: "BUY",  date: "2023-01-10", symbol: "B", quantity: d(20) });
  const sellA = tx({ type: "SELL", date: "2023-06-01", symbol: "A", quantity: d(5) });

  it("A position after sellA = 5, B position unaffected = 20", () => {
    const map = computeRunningPositions([buyA, buyB, sellA]);
    expect(map.get(sellA.id)?.toNumber()).toBe(5);
    expect(map.get(buyB.id)?.toNumber()).toBe(20);
  });
});

describe("computeRunningPositions — same-day ordering (split before buy before sell)", () => {
  // On the same date: split should apply before BUY and before SELL
  const buy   = tx({ type: "BUY",         date: "2023-06-10", symbol: "XYZ", quantity: d(10) });
  const split = tx({ type: "STOCK_SPLIT", date: "2023-06-10", symbol: "XYZ", quantity: d(2) }); // 2:1 same day
  const sell  = tx({ type: "SELL",        date: "2023-06-10", symbol: "XYZ", quantity: d(5) });

  // Suppose 10 shares exist before this date (from a prior buy — not in this list,
  // so starting at 0). Chronological: split(0→0) → buy(0→10) → sell(10→5)
  it("position after sell = 5 (split on 0 is no-op, buy adds 10, sell removes 5)", () => {
    const map = computeRunningPositions([buy, split, sell]);
    expect(map.get(sell.id)?.toNumber()).toBe(5);
  });
});

describe("computeRunningPositions — non-stock transactions are ignored", () => {
  const dividend = tx({ type: "DIVIDEND", date: "2023-05-01", symbol: "AAPL" });
  const buyA     = tx({ type: "BUY",      date: "2023-01-10", symbol: "AAPL", quantity: d(3) });

  it("dividend txId not present in result map", () => {
    const map = computeRunningPositions([dividend, buyA]);
    expect(map.has(dividend.id)).toBe(false);
  });

  it("buy txId is present", () => {
    const map = computeRunningPositions([dividend, buyA]);
    expect(map.get(buyA.id)?.toNumber()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// computeOpenPositions
// ---------------------------------------------------------------------------

describe("computeOpenPositions", () => {
  it("returns only symbols with non-zero remaining position", () => {
    const txs: Transaction[] = [
      tx({ type: "BUY",  date: "2023-01-10", symbol: "A", quantity: d(10) }),
      tx({ type: "SELL", date: "2023-06-01", symbol: "A", quantity: d(10) }), // closed
      tx({ type: "BUY",  date: "2023-01-10", symbol: "B", quantity: d(5) }),
    ];
    const open = computeOpenPositions(txs);
    expect(open.has("A")).toBe(false);
    expect(open.get("B")?.toNumber()).toBe(5);
  });

  it("reflects stock splits", () => {
    const txs: Transaction[] = [
      tx({ type: "BUY",         date: "2023-01-10", symbol: "C", quantity: d(10) }),
      tx({ type: "STOCK_SPLIT", date: "2023-06-10", symbol: "C", quantity: d(3) }), // 3:1
    ];
    const open = computeOpenPositions(txs);
    expect(open.get("C")?.toNumber()).toBe(30);
  });

  it("empty list returns empty map", () => {
    expect(computeOpenPositions([])).toEqual(new Map());
  });
});
