import { describe, it, expect } from "vitest";
import Decimal from "decimal.js";
import { processFifo } from "../src/fifo.js";
import type { Transaction } from "../src/types.js";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

/**
 * Builds a PLN-denominated Transaction (fxRate = 1, no FX conversion needed).
 * commission defaults to 0.
 */
function makePlnTx(opts: {
  id: string;
  date: string;
  type: "BUY" | "SELL";
  symbol: string;
  quantity: number;
  price: number;
  commission?: number;
}): Transaction {
  const qty = new Decimal(opts.quantity);
  const price = new Decimal(opts.price);
  const comm = new Decimal(opts.commission ?? 0);
  const gross = qty.mul(price);
  const net = opts.type === "BUY" ? gross.add(comm) : gross.sub(comm);
  const ONE = new Decimal(1);

  return {
    id: opts.id,
    broker: "test",
    date: opts.date,
    type: opts.type,
    symbol: opts.symbol,
    quantity: qty,
    pricePerShare: price,
    currency: "PLN",
    grossAmount: gross,
    commission: comm,
    netAmount: net,
    fxRate: ONE,
    fxDate: opts.date,
    grossAmountPLN: gross,
    commissionPLN: comm,
    netAmountPLN: net,
  };
}

/** Compare a Decimal to an expected number at 2-decimal-place precision. */
function expectPLN(actual: Decimal, expected: number, label = ""): void {
  expect(actual.toFixed(2), label).toBe(new Decimal(expected).toFixed(2));
}

// ---------------------------------------------------------------------------
// Golden Scenario 1 — Simple PLN equity, buy and sell same year
//
// Buy:  100 shares CDPROJKT @ 250.00 PLN  (2024-03-01)
// Sell: 100 shares CDPROJKT @ 310.00 PLN  (2024-11-15)
//
// Revenue:    31,000.00 PLN
// Cost basis: 25,000.00 PLN
// Net gain:    6,000.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 1: simple PLN equity, buy and sell same year", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-03-01",
      type: "BUY",
      symbol: "CDPROJKT",
      quantity: 100,
      price: 250,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-15",
      type: "SELL",
      symbol: "CDPROJKT",
      quantity: 100,
      price: 310,
    }),
  ];

  it("produces one match", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 31_000, "revenue");
    expectPLN(m.costBasisPLN, 25_000, "cost basis");
    expectPLN(m.commissionSellPLN, 0, "sell commission");
    expectPLN(m.gainLossPLN, 6_000, "gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });

  it("matched one lot — the single buy", () => {
    const { matches } = processFifo(txs);
    expect(matches[0]!.lots).toHaveLength(1);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 100);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 2 — Two lots, sell exactly the first lot
//
// Buy:  60 shares @ 40.00 PLN  (lot 1, 2024-01-10)
// Buy:  40 shares @ 60.00 PLN  (lot 2, 2024-04-20)
// Sell: 60 shares @ 80.00 PLN  (2024-11-05)
//
// FIFO:   60 from lot 1 (fully consumed)
// Cost:   2,400.00 PLN
// Revenue: 4,800.00 PLN
// Gain:    2,400.00 PLN
// Remaining: lot 2 — 40 shares @ 60.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 2: two lots, sell exactly the first lot", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "ABC",
      quantity: 60,
      price: 40,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-04-20",
      type: "BUY",
      symbol: "ABC",
      quantity: 40,
      price: 60,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-05",
      type: "SELL",
      symbol: "ABC",
      quantity: 60,
      price: 80,
    }),
  ];

  it("produces one match consuming only lot 1", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(1);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 60);
    expectPLN(matches[0]!.lots[0]!.costPLN, 2_400);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 4_800, "revenue");
    expectPLN(m.costBasisPLN, 2_400, "cost basis");
    expectPLN(m.gainLossPLN, 2_400, "gain");
  });

  it("leaves lot 2 intact with 40 shares @ 60", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 40, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 60, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 3 — Two lots, partial sell crosses lot boundary
//
// Buy:  50 shares @ 100.00 PLN  (lot 1, 2024-01-10)
// Buy:  50 shares @ 120.00 PLN  (lot 2, 2024-03-15)
// Sell: 70 shares @ 150.00 PLN  (2024-10-20)
//
// FIFO:   50 from lot 1 + 20 from lot 2
// Cost:   5,000 + 2,400 = 7,400.00 PLN
// Revenue: 10,500.00 PLN
// Gain:     3,100.00 PLN
// Remaining: lot 2 — 30 shares @ 120.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 3: two lots, partial sell crosses lot boundary", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "XYZ",
      quantity: 50,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-15",
      type: "BUY",
      symbol: "XYZ",
      quantity: 50,
      price: 120,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-10-20",
      type: "SELL",
      symbol: "XYZ",
      quantity: 70,
      price: 150,
    }),
  ];

  it("produces one match consuming both lots", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(2);
  });

  it("allocates 50 from lot 1 and 20 from lot 2", () => {
    const { matches } = processFifo(txs);
    const [l1, l2] = matches[0]!.lots;
    expectPLN(l1!.quantityConsumed, 50, "lot1 qty");
    expectPLN(l1!.costPLN, 5_000, "lot1 cost");
    expectPLN(l2!.quantityConsumed, 20, "lot2 qty");
    expectPLN(l2!.costPLN, 2_400, "lot2 cost");
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 10_500, "revenue");
    expectPLN(m.costBasisPLN, 7_400, "cost basis");
    expectPLN(m.gainLossPLN, 3_100, "gain");
  });

  it("leaves 30 shares remaining in lot 2 @ 120", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 30, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 120, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 4 — Two lots, sell all shares from both lots
//
// Buy:   60 shares @ 40.00 PLN  (lot 1, 2024-01-10)
// Buy:   40 shares @ 60.00 PLN  (lot 2, 2024-04-20)
// Sell: 100 shares @ 80.00 PLN  (2024-11-05)
//
// Cost:    2,400 + 2,400 = 4,800.00 PLN
// Revenue: 8,000.00 PLN
// Gain:    3,200.00 PLN
// Remaining: none
// ---------------------------------------------------------------------------
describe("Scenario 4: two lots, sell all shares from both lots", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "ABC",
      quantity: 60,
      price: 40,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-04-20",
      type: "BUY",
      symbol: "ABC",
      quantity: 40,
      price: 60,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-11-05",
      type: "SELL",
      symbol: "ABC",
      quantity: 100,
      price: 80,
    }),
  ];

  it("produces one match consuming both lots fully", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(2);
    expectPLN(matches[0]!.lots[0]!.quantityConsumed, 60);
    expectPLN(matches[0]!.lots[1]!.quantityConsumed, 40);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 8_000, "revenue");
    expectPLN(m.costBasisPLN, 4_800, "cost basis");
    expectPLN(m.gainLossPLN, 3_200, "gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 5 — Three lots, sell spans all three
//
// Buy:  30 shares @ 50.00 PLN  (lot 1, 2024-01-05)
// Buy:  30 shares @ 70.00 PLN  (lot 2, 2024-03-10)
// Buy:  40 shares @ 90.00 PLN  (lot 3, 2024-06-01)
// Sell: 80 shares @ 110.00 PLN (2024-12-01)
//
// FIFO:   30 from lot 1 + 30 from lot 2 + 20 from lot 3
// Cost:   1,500 + 2,100 + 1,800 = 5,400.00 PLN
// Revenue: 8,800.00 PLN
// Gain:    3,400.00 PLN
// Remaining: lot 3 — 20 shares @ 90.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 5: three lots, sell spans all three", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-05",
      type: "BUY",
      symbol: "DEF",
      quantity: 30,
      price: 50,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-10",
      type: "BUY",
      symbol: "DEF",
      quantity: 30,
      price: 70,
    }),
    makePlnTx({
      id: "b3",
      date: "2024-06-01",
      type: "BUY",
      symbol: "DEF",
      quantity: 40,
      price: 90,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-12-01",
      type: "SELL",
      symbol: "DEF",
      quantity: 80,
      price: 110,
    }),
  ];

  it("produces one match consuming three lots", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expect(matches[0]!.lots).toHaveLength(3);
  });

  it("allocates 30 / 30 / 20 across the three lots", () => {
    const { matches } = processFifo(txs);
    const [l1, l2, l3] = matches[0]!.lots;
    expectPLN(l1!.quantityConsumed, 30);
    expectPLN(l1!.costPLN, 1_500);
    expectPLN(l2!.quantityConsumed, 30);
    expectPLN(l2!.costPLN, 2_100);
    expectPLN(l3!.quantityConsumed, 20);
    expectPLN(l3!.costPLN, 1_800);
  });

  it("calculates revenue, cost, gain correctly", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expectPLN(m.revenueGrossPLN, 8_800, "revenue");
    expectPLN(m.costBasisPLN, 5_400, "cost basis");
    expectPLN(m.gainLossPLN, 3_400, "gain");
  });

  it("leaves 20 shares remaining in lot 3 @ 90", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 20);
    expectPLN(remainingLots[0]!.costPerSharePLN, 90);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 6 — Two sequential sells deplete lots in order
//
// Buy:  50 shares @ 100.00 PLN  (lot 1, 2024-01-10)
// Buy:  50 shares @ 120.00 PLN  (lot 2, 2024-03-15)
// Sell: 50 shares @ 140.00 PLN  (sell 1, 2024-07-01) → consumes lot 1
// Sell: 50 shares @ 160.00 PLN  (sell 2, 2024-11-20) → consumes lot 2
//
// Sell 1: revenue 7,000 / cost 5,000 / gain 2,000
// Sell 2: revenue 8,000 / cost 6,000 / gain 2,000
// Annual: revenue 15,000 / cost 11,000 / gain 4,000
// ---------------------------------------------------------------------------
describe("Scenario 6: two sequential sells deplete lots in order", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-10",
      type: "BUY",
      symbol: "GHI",
      quantity: 50,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-03-15",
      type: "BUY",
      symbol: "GHI",
      quantity: 50,
      price: 120,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-07-01",
      type: "SELL",
      symbol: "GHI",
      quantity: 50,
      price: 140,
    }),
    makePlnTx({
      id: "s2",
      date: "2024-11-20",
      type: "SELL",
      symbol: "GHI",
      quantity: 50,
      price: 160,
    }),
  ];

  it("produces two matches", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(2);
  });

  it("sell 1 consumes lot 1 entirely", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 50);
    expectPLN(m.revenueGrossPLN, 7_000, "revenue sell 1");
    expectPLN(m.costBasisPLN, 5_000, "cost sell 1");
    expectPLN(m.gainLossPLN, 2_000, "gain sell 1");
  });

  it("sell 2 consumes lot 2 entirely", () => {
    const { matches } = processFifo(txs);
    const m = matches[1]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 50);
    expectPLN(m.revenueGrossPLN, 8_000, "revenue sell 2");
    expectPLN(m.costBasisPLN, 6_000, "cost sell 2");
    expectPLN(m.gainLossPLN, 2_000, "gain sell 2");
  });

  it("aggregate annual gain is 4,000", () => {
    const { matches } = processFifo(txs);
    const totalGain = matches.reduce((acc, m) => acc.add(m.gainLossPLN), new Decimal(0));
    expectPLN(totalGain, 4_000, "total annual gain");
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 7 — Sell at a loss
//
// Buy:  100 shares @ 200.00 PLN  (2024-02-01)
// Sell: 100 shares @ 150.00 PLN  (2024-09-15)
//
// Revenue:  15,000.00 PLN
// Cost:     20,000.00 PLN
// Net loss:  -5,000.00 PLN  (no tax due; loss offsets other gains in the year)
// ---------------------------------------------------------------------------
describe("Scenario 7: sell at a loss", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-02-01",
      type: "BUY",
      symbol: "LOSS",
      quantity: 100,
      price: 200,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-09-15",
      type: "SELL",
      symbol: "LOSS",
      quantity: 100,
      price: 150,
    }),
  ];

  it("produces a negative gainLossPLN", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(1);
    expectPLN(matches[0]!.revenueGrossPLN, 15_000, "revenue");
    expectPLN(matches[0]!.costBasisPLN, 20_000, "cost");
    expectPLN(matches[0]!.gainLossPLN, -5_000, "loss");
  });

  it("gain is negative (a loss)", () => {
    const { matches } = processFifo(txs);
    expect(matches[0]!.gainLossPLN.isNegative()).toBe(true);
  });

  it("leaves no remaining lots", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Golden Scenario 8 — Interleaved buys and sells, partial lot carry-over
//
// Buy:  40 shares @ 80.00 PLN  (lot 1, 2024-01-15)
// Sell: 25 shares @ 100.00 PLN (sell 1, 2024-04-10)  ← 25 from lot 1
// Buy:  30 shares @ 90.00 PLN  (lot 2, 2024-05-20)   ← lot 1 now has 15 remaining
// Sell: 35 shares @ 110.00 PLN (sell 2, 2024-10-05)  ← 15 from lot 1 + 20 from lot 2
//
// Sell 1: revenue 2,500 / cost 2,000 / gain 500
// Sell 2: revenue 3,850 / cost 3,000 / gain 850
// Annual: revenue 6,350 / cost 5,000 / gain 1,350
// Remaining: lot 2 — 10 shares @ 90.00 PLN
// ---------------------------------------------------------------------------
describe("Scenario 8: interleaved buys and sells with partial lot carry-over", () => {
  const txs: Transaction[] = [
    makePlnTx({
      id: "b1",
      date: "2024-01-15",
      type: "BUY",
      symbol: "JKL",
      quantity: 40,
      price: 80,
    }),
    makePlnTx({
      id: "s1",
      date: "2024-04-10",
      type: "SELL",
      symbol: "JKL",
      quantity: 25,
      price: 100,
    }),
    makePlnTx({
      id: "b2",
      date: "2024-05-20",
      type: "BUY",
      symbol: "JKL",
      quantity: 30,
      price: 90,
    }),
    makePlnTx({
      id: "s2",
      date: "2024-10-05",
      type: "SELL",
      symbol: "JKL",
      quantity: 35,
      price: 110,
    }),
  ];

  it("produces two matches", () => {
    const { matches } = processFifo(txs);
    expect(matches).toHaveLength(2);
  });

  it("sell 1: 25 shares from lot 1 only", () => {
    const { matches } = processFifo(txs);
    const m = matches[0]!;
    expect(m.lots).toHaveLength(1);
    expectPLN(m.lots[0]!.quantityConsumed, 25, "qty from lot1");
    expectPLN(m.lots[0]!.costPLN, 2_000, "cost from lot1");
    expectPLN(m.revenueGrossPLN, 2_500, "revenue sell1");
    expectPLN(m.costBasisPLN, 2_000, "cost sell1");
    expectPLN(m.gainLossPLN, 500, "gain sell1");
  });

  it("sell 2: 15 from lot 1 remainder + 20 from lot 2", () => {
    const { matches } = processFifo(txs);
    const m = matches[1]!;
    expect(m.lots).toHaveLength(2);
    expectPLN(m.lots[0]!.quantityConsumed, 15, "qty from lot1 remainder");
    expectPLN(m.lots[0]!.costPLN, 1_200, "cost from lot1 remainder");
    expectPLN(m.lots[1]!.quantityConsumed, 20, "qty from lot2");
    expectPLN(m.lots[1]!.costPLN, 1_800, "cost from lot2");
    expectPLN(m.revenueGrossPLN, 3_850, "revenue sell2");
    expectPLN(m.costBasisPLN, 3_000, "cost sell2");
    expectPLN(m.gainLossPLN, 850, "gain sell2");
  });

  it("aggregate annual gain is 1,350", () => {
    const { matches } = processFifo(txs);
    const totalGain = matches.reduce((acc, m) => acc.add(m.gainLossPLN), new Decimal(0));
    expectPLN(totalGain, 1_350, "total annual gain");
  });

  it("leaves 10 shares remaining in lot 2 @ 90", () => {
    const { remainingLots } = processFifo(txs);
    expect(remainingLots).toHaveLength(1);
    expectPLN(remainingLots[0]!.remainingQuantity, 10, "remaining qty");
    expectPLN(remainingLots[0]!.costPerSharePLN, 90, "cost/share");
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("edge cases", () => {
  it("throws when selling more shares than available", () => {
    const txs: Transaction[] = [
      makePlnTx({
        id: "b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "ERR",
        quantity: 10,
        price: 100,
      }),
      makePlnTx({
        id: "s1",
        date: "2024-06-01",
        type: "SELL",
        symbol: "ERR",
        quantity: 20,
        price: 120,
      }),
    ];
    expect(() => processFifo(txs)).toThrow(/insufficient shares/i);
  });

  it("ignores non-BUY/SELL transaction types", () => {
    const ONE = new Decimal(1);
    const gross = new Decimal(100);
    const div: Transaction = {
      id: "d1",
      broker: "test",
      date: "2024-05-01",
      type: "DIVIDEND",
      symbol: "DIV",
      currency: "PLN",
      grossAmount: gross,
      commission: new Decimal(0),
      netAmount: gross,
      fxRate: ONE,
      fxDate: "2024-05-01",
      grossAmountPLN: gross,
      commissionPLN: new Decimal(0),
      netAmountPLN: gross,
    };
    const { matches, remainingLots } = processFifo([div]);
    expect(matches).toHaveLength(0);
    expect(remainingLots).toHaveLength(0);
  });

  it("handles multiple symbols independently", () => {
    const txs: Transaction[] = [
      makePlnTx({
        id: "a-b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "AAA",
        quantity: 10,
        price: 100,
      }),
      makePlnTx({
        id: "b-b1",
        date: "2024-01-01",
        type: "BUY",
        symbol: "BBB",
        quantity: 20,
        price: 50,
      }),
      makePlnTx({
        id: "a-s1",
        date: "2024-12-01",
        type: "SELL",
        symbol: "AAA",
        quantity: 10,
        price: 150,
      }),
      makePlnTx({
        id: "b-s1",
        date: "2024-12-01",
        type: "SELL",
        symbol: "BBB",
        quantity: 20,
        price: 75,
      }),
    ];
    const { matches, remainingLots } = processFifo(txs);
    expect(matches).toHaveLength(2);
    expect(remainingLots).toHaveLength(0);
    const aaMatch = matches.find((m) => m.symbol === "AAA")!;
    const bbMatch = matches.find((m) => m.symbol === "BBB")!;
    expectPLN(aaMatch.gainLossPLN, 500, "AAA gain");
    expectPLN(bbMatch.gainLossPLN, 500, "BBB gain");
  });
});
